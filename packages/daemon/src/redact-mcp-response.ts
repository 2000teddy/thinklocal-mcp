// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * redact-mcp-response.ts — ADR-041 (TL-08 Slice 2b): owner-seitige, **fail-closed** Feld-Redaction für
 * sensitive credential-/PII-Reads (ADR-039/040 `sensitive`-Set).
 *
 * **Deny-by-default Feld-Allowlist** (kein Secret-Denylist — die failt open auf Unknown-unknowns): beim
 * Tiefen-Walk überlebt NUR ein safe-gelisteter Key (rekursiv), jeder andere Key → `[REDACTED]`. Ein
 * Unknown-unknown ist damit eine sichtbare Lücke (over-redaction), **kein Leak**.
 *
 * **Policy R (CO):** die Redaction ist UNCONDITIONAL — Approval regelt den Zugriff auf den Aufruf, nie
 * auf das Secret. Secrets verlassen den Owner-Daemon nie unredigiert.
 *
 * **Rein, mutiert die Eingabe nicht → idempotent.** Bounded (Tiefe/Node-Cap → fail-closed, nie
 * truncate-and-pass). `null`/Skalar-Ergebnis eines sensitiven Tools ⇒ fail-closed (nie passthrough).
 */
import { SERVER_TOOL_CLASSES, canonicalizeServerName } from './mcp-service-registry.js';

/** Maskierungs-Marker für ein redigiertes Feld. */
export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;

export type RedactionOutcome = 'passthrough' | 'redacted' | 'fail-closed';

export interface RedactionResult {
  readonly outcome: RedactionOutcome;
  /** Der (ggf. projizierte / durch eine Notiz ersetzte) Ergebniswert. */
  readonly result: unknown;
  readonly reason?: string;
}

/**
 * Deny-by-default per-server Safe-Feld-Allowlist: nur diese Keys überleben für ein sensitives Tool.
 * **2b: `unifi` ist LEER** (maximale Redaction) — die Mechanik steht, die Feld-Kuratierung (mit echten
 * Output-Schemata + nested-JSON) ist Slice 2c unter Security-CR. Leere Liste ⇒ alle Datenfelder redigiert.
 */
export const SERVER_SAFE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  unifi: new Set<string>([]),
};

interface Bounds {
  nodes: number;
}

/**
 * Projiziert `value` deny-by-default gegen `safe`: safe-gelisteter Objekt-Key → Wert bleibt (rekursiv),
 * jeder andere Objekt-Key → `[REDACTED]`. Arrays: elementweise rekursiv. Primitive (die nur unter einem
 * safe-Key hier ankommen) bleiben. Rein (baut neue Werte). `ok=false` ⇒ Rahmen überschritten ⇒ fail-closed.
 */
export function redactByAllowlist(
  value: unknown,
  safe: ReadonlySet<string>,
  depth = 0,
  bounds: Bounds = { nodes: 0 },
  underSafeKey = false,
): { ok: boolean; value: unknown } {
  if (depth > MAX_DEPTH) return { ok: false, value: undefined };
  // CR-HIGH: ein Skalar (auch ein ARRAY-Element, das keinen Key hat) überlebt NUR im erlaubten Kontext
  // (Wert eines safe-gelisteten Keys). Ein Skalar auf Top-Ebene oder als Array-Element in nicht-erlaubtem
  // Kontext → redigiert. Sonst leakt `list_vouchers → ["CODE1", ...]` (Array skalarer Secrets).
  if (value === null || typeof value !== 'object') {
    return { ok: true, value: underSafeKey ? value : REDACTED };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const el of value) {
      if (++bounds.nodes > MAX_NODES) return { ok: false, value: undefined };
      // Array-Elemente erben den Kontext (unter safe-Key → erlaubt; sonst → nicht erlaubt).
      const r = redactByAllowlist(el, safe, depth + 1, bounds, underSafeKey);
      if (!r.ok) return { ok: false, value: undefined };
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++bounds.nodes > MAX_NODES) return { ok: false, value: undefined };
    if (safe.has(k)) {
      // safe-Key → Wert im erlaubten Kontext rekursiv (Objekt-Kinder werden trotzdem governt).
      const r = redactByAllowlist(v, safe, depth + 1, bounds, true);
      if (!r.ok) return { ok: false, value: undefined };
      out[k] = r.value;
    } else {
      out[k] = REDACTED; // deny-by-default: unbekannter Key → redigiert (kein Recurse, kein Leak)
    }
  }
  return { ok: true, value: out };
}

/** Ob `tool` auf `server` als sensitiv (credential-/PII-Read) klassifiziert ist. Kanonisierter Server. */
export function isSensitiveTool(server: string, tool: string): boolean {
  return tool !== '' && (SERVER_TOOL_CLASSES[canonicalizeServerName(server)]?.sensitive?.has(tool) ?? false);
}

/** Selbstbeschreibende, secret-freie Notiz, die den Ergebniswert ersetzt (200, kein 5xx). */
function notice(outcome: RedactionOutcome, server: string, tool: string): Record<string, unknown> {
  return { thinklocalRedaction: outcome, server, tool };
}

/**
 * Redigiert das Tool-Ergebnis owner-seitig. `passthrough` für nicht-sensitive Tools; `redacted`
 * (deny-by-default projiziert) bzw. `fail-closed` (Skalar/`null`-Ergebnis oder Rahmen überschritten)
 * für sensitive. Servername kanonisiert (konsistent zur Klassen-Map). Wirft nie.
 */
export function redactSensitiveResult(server: string, tool: string, result: unknown): RedactionResult {
  const canon = canonicalizeServerName(server);
  if (!isSensitiveTool(canon, tool)) return { outcome: 'passthrough', result };
  // Ein sensitives Tool MUSS ein projizierbares Objekt/Array liefern — ein Skalar/null ist nicht
  // sicher projizierbar ⇒ fail-closed (nie das rohe Ergebnis durchreichen).
  if (result === null || typeof result !== 'object') {
    return { outcome: 'fail-closed', result: notice('fail-closed', canon, tool), reason: 'non-object-result' };
  }
  const projected = redactByAllowlist(result, SERVER_SAFE_FIELDS[canon] ?? new Set<string>());
  if (!projected.ok) {
    return { outcome: 'fail-closed', result: notice('fail-closed', canon, tool), reason: 'bounds-exceeded' };
  }
  return { outcome: 'redacted', result: projected.value, reason: 'sensitive-tool' };
}
