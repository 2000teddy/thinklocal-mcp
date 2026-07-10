// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-mcporter-exec.ts — TL07 (Kap. 7.7, Folge-Slice zur local-exec-Naht): die REALE
 * Owner-seitige local-exec-Primitive. Uebersetzt einen eingehenden MCP-JSON-RPC-Aufruf
 * (`tools/list` / `tools/call`) in einen `mcporter`-CLI-Aufruf und dessen Ausgabe zurueck
 * in eine `McpIngressResponse`. Erfuellt den `McpLocalExec`-Vertrag der Naht in
 * `mcp-forward-executor.ts` (fehlt sie → 501; vorhanden → lokaler Serve).
 *
 * mcporter-Vertrag (aus `mcporter call --help` / `mcporter list --help` abgeleitet, nicht
 * geraten — grounded 2026-07-10):
 *   tools/list  →  `mcporter list <server> --json`
 *   tools/call  →  `mcporter call <server>.<tool> --args '<json>' --output json --timeout <ms>`
 *   Exit 0 = Erfolg, stdout = das (von mcporter aus den MCP-`content`-Bloecken
 *   entpackte) Tool-Result als JSON. Exit != 0 = Fehler (stderr traegt den Grund).
 *
 * Sicherheit: KEINE Shell — der Prozess wird mit Argument-VEKTOR gestartet (`execFile`),
 * `<server>.<tool>` und `--args <json>` sind je EIN Token → keine Flag-/Shell-Injection.
 * `server` ist bereits kanonisiert (`[a-z0-9._-]`); `tool` wird zusaetzlich validiert.
 *
 * Rein + injizierbar: die Prozess-Primitive (`run`) ist austauschbar → die Uebersetzungs-
 * und Fehler-Logik ist ohne echten `spawn` unit-testbar.
 */
import { execFile } from 'node:child_process';
import type { Logger } from 'pino';
import type { McpIngressResponse } from './mcp-ingress.js';
import type { McpLocalExec, McpLocalExecRequest } from './mcp-forward-executor.js';
import { canonicalizeServerName } from './mcp-service-registry.js';

/** Aufschlag auf den mcporter-`--timeout`, bevor der Prozess hart gekillt wird: so meldet
 *  mcporter seinen eigenen (sauberen) Timeout als 502, und ein 504 (Prozess-Kill) bedeutet
 *  wirklich „haengender Prozess", nicht bloss ein langsames Tool (CR-LOW: Timeout-Race). */
export const PROC_TIMEOUT_GRACE_MS = 2000;

/** Ergebnis eines Prozess-Laufs (neutralisiert von child_process-Details). */
export interface ProcRunResult {
  /** Exit-Code (null bei Signal-Kill / Timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** true, wenn der Lauf per Timeout abgebrochen wurde. */
  timedOut: boolean;
}
/** Injizierbare Prozess-Primitive (real: `execFile`). Wirft NICHT — Fehler landen im Ergebnis. */
export type ProcRunner = (bin: string, argv: readonly string[], opts: { timeoutMs: number }) => Promise<ProcRunResult>;

export interface McporterLocalExecDeps {
  /** Pfad/Name des mcporter-Binaries. Default `'mcporter'` (aus PATH). */
  mcporterBin?: string;
  /** Prozess-Primitive; Default `execFileRunner`. */
  run?: ProcRunner;
  log?: Logger;
}

/** Erlaubter Tool-Name: MUSS alphanumerisch beginnen (kein fuehrendes `-` → kein CLI-Flag-Bruch),
 *  danach `[A-Za-z0-9._-]`. Verhindert, dass ein Payload-Tool zu einem Flag/Selector-Bruch wird. */
const TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Maximale stdout/stderr-Groesse (Schutz gegen Runaway-Output). */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** Reale `execFile`-basierte Prozess-Primitive (kein Shell, Timeout mit Kill). */
export const execFileRunner: ProcRunner = (bin, argv, opts) =>
  new Promise((resolve) => {
    execFile(
      bin,
      [...argv],
      { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // execFile setzt err.killed=true bei Timeout; err.code ist der Exit-Code (number)
        // ODER ein String wie 'ENOENT' bei Spawn-Fehlern (dann → generisch 1).
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        const killed = Boolean(e?.killed);
        let code: number | null;
        if (killed) code = null;
        else if (e && typeof e.code === 'number') code = e.code;
        else if (e) code = 1;
        else code = 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '', timedOut: killed });
      },
    );
  });

/** Minimale JSON-RPC-Sicht auf das eingehende Payload. */
interface JsonRpcCall {
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
}

/**
 * Baut den mcporter-Argument-Vektor fuer einen MCP-Aufruf. Reine Funktion → separat testbar.
 * Liefert `null` + Grund, wenn das Payload nicht unterstuetzt/valide ist (fail-closed).
 */
export function buildMcporterArgv(
  server: string,
  payload: unknown,
  timeoutMs: number,
): { argv: string[] } | { error: string } {
  const call = (typeof payload === 'object' && payload !== null ? payload : {}) as JsonRpcCall;
  const method = call.method;
  if (method === 'tools/list') {
    return { argv: ['list', server, '--json'] };
  }
  if (method === 'tools/call') {
    const name = call.params?.name;
    if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
      return { error: 'tools/call ohne gueltigen params.name' };
    }
    const args = call.params?.arguments ?? {};
    return {
      argv: ['call', `${server}.${name}`, '--args', JSON.stringify(args), '--output', 'json', '--timeout', String(timeoutMs)],
    };
  }
  return { error: `nicht unterstuetzte MCP-Methode: ${String(method)}` };
}

/**
 * Baut die reale local-exec-Primitive. Uebersetzt `tools/list`/`tools/call` → mcporter-CLI,
 * fuehrt aus und mappt Ergebnis/Fehler auf `{status, body}`:
 *  - Exit 0 + JSON-stdout           → 200, `{jsonrpc:'2.0', id, result:<stdout>}`
 *  - nicht unterstuetztes Payload   → 400
 *  - Timeout                        → 504
 *  - Exit != 0 / non-JSON-stdout    → 502 (+ gekuerzter Grund)
 */
export function createMcporterLocalExec(deps: McporterLocalExecDeps = {}): McpLocalExec {
  const bin = deps.mcporterBin ?? 'mcporter';
  const run = deps.run ?? execFileRunner;
  return async function mcporterLocalExec(req: McpLocalExecRequest): Promise<McpIngressResponse> {
    // CR-LOW: Servername kanonisieren (planMcpRoute reicht den rohen Route-Namen durch) →
    // ein gross-/whitespace-abweichender, aber gueltig aufgeloester Aufruf trifft mcporter
    // mit dem kanonischen Namen statt in einen 502 zu laufen.
    const server = canonicalizeServerName(req.server);
    const built = buildMcporterArgv(server, req.payload, req.timeoutMs);
    if ('error' in built) {
      return { status: 400, body: { error: built.error, server } };
    }
    // Prozess-Timeout = mcporter-Timeout + Grace (s. PROC_TIMEOUT_GRACE_MS).
    const proc = await run(bin, built.argv, { timeoutMs: req.timeoutMs + PROC_TIMEOUT_GRACE_MS });
    if (proc.timedOut) {
      deps.log?.warn({ server }, '[mcporter-exec] Prozess-Timeout (haengend)');
      return { status: 504, body: { error: 'mcporter timeout', server } };
    }
    if (proc.code !== 0) {
      const detail = (proc.stderr || proc.stdout || '').slice(0, 300);
      deps.log?.warn({ server, code: proc.code, detail }, '[mcporter-exec] Exit != 0');
      return { status: 502, body: { error: 'mcporter exec failed', server, detail } };
    }
    let result: unknown;
    try {
      result = proc.stdout.trim() ? JSON.parse(proc.stdout) : {};
    } catch {
      return { status: 502, body: { error: 'mcporter lieferte kein JSON', server, detail: proc.stdout.slice(0, 200) } };
    }
    const id = (typeof req.payload === 'object' && req.payload !== null ? (req.payload as JsonRpcCall).id : undefined) ?? null;
    return { status: 200, body: { jsonrpc: '2.0', id, result } };
  };
}
