// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * meldekanal.ts — ADR-036 (TL-09, Slice A): austauschbare Meldekanal-Abstraktion
 * mit Fail-safe Deny-Default (Design-Vorgabe 10).
 *
 * Ein `Meldekanal` legt einen angehaltenen schreibenden MCP-Aufruf einem Betreiber
 * zur Entscheidung vor (Telegram/Cockpit/CLI/…). Die `MeldekanalRegistry` wählt den
 * ersten **gesunden** Kanal; ist keiner erreichbar (inkl. leerer Liste), gilt die
 * eiserne Regel aus Kapitel 7.4: **kein Kanal ⇒ verweigert** (`denied-no-channel`).
 *
 * BEWUSST OHNE AUFRUFER (ADR-036 Slice A): `mcp-ingress.ts` bleibt in diesem Slice
 * unverändert (hartes 403). Das Ingress-Wiring (403 → `registry.requestApproval`,
 * hinter Env-Flag, Default = heutiges Verhalten) ist Slice B / TL-09b. Dieses Modul
 * ist die geprüfte Abstraktion VOR ihrer Verdrahtung, kein toter Code.
 *
 * Fail-closed-Invarianten (CO 2026-07-15, `pal:consensus` opus+sonnet):
 *  - `isHealthy` ist async + timeout-umhüllt; Fehler/Timeout ⇒ unhealthy → nächster Kanal.
 *  - Der erste gesunde Kanal ist TERMINAL (kein „frage bis einer Ja sagt").
 *  - `requestApproval` bekommt ein `AbortSignal`; bei Timeout bricht die Registry ab,
 *    das Timeout-Ergebnis ist terminal, eine späte Resolution wird verworfen.
 *  - Kanal-Rückgabewert wird normalisiert; unbekanntes Shape ⇒ `error`, nie `approved`.
 *  - `isApproved()` ist der EINZIGE erlaubte Auswertungspfad (Allowlist: nur `approved`).
 *
 * Reines Modul: kein I/O, keine Uhr außer `setTimeout` (Timeout), vollständig unit-testbar.
 */

/** Ergebnis einer Freigabe-Anfrage. Nur `approved` erlaubt einen schreibenden Aufruf. */
export type ApprovalOutcome =
  | 'approved' // ein Betreiber hat aktiv zugestimmt
  | 'rejected' // ein Betreiber hat aktiv abgelehnt
  | 'denied-no-channel' // kein erreichbarer Kanal — niemand wurde gefragt (Alarm-würdig)
  | 'timeout' // gesunder Kanal, aber keine rechtzeitige Entscheidung
  | 'error'; // Kanal warf oder lieferte ungültiges Ergebnis

/** Kontext, den ein Kanal dem Betreiber zur Entscheidung vorlegt. */
export interface ApprovalRequest {
  /** Stabiler Korrelations-Schlüssel (Kanal ↔ Audit). */
  readonly requestId: string;
  /** MCP-Server des Ziel-Aufrufs, z.B. "unifi". */
  readonly server: string;
  /** Werkzeugname aus `tools/call`, z.B. "block_client". */
  readonly tool: string;
  /** Ausführungsstufe, die das Gate auslöste ('gate' | 'consensus'). */
  readonly tier: string;
  /** Kanonischer SPIFFE-Sender-Principal. */
  readonly senderUri: string;
  /** Kurze, menschenlesbare Zusammenfassung. */
  readonly summary: string;
}

/** Entscheidung eines Kanals bzw. der Registry. */
export interface ApprovalDecision {
  readonly outcome: ApprovalOutcome;
  /** Kanal, der entschied (fehlt bei `denied-no-channel` ohne gewählten Kanal). */
  readonly channelId?: string;
  /** Optionale Diagnose (z.B. Fehlermeldung, Betreiber-Notiz). */
  readonly note?: string;
}

/** Ein austauschbarer Meldekanal. Implementierungen: Telegram, Cockpit, CLI, … (Slice B). */
export interface Meldekanal {
  /** Stabile Kanal-ID (Audit / Auswahl). */
  readonly id: string;
  /**
   * Liveness des Kanals (Netzwerk-Fakt, daher async). MUSS `signal` respektieren.
   * Wirft der Aufruf oder läuft er in den Timeout, wertet die Registry ihn als unhealthy.
   */
  isHealthy(signal: AbortSignal): Promise<boolean>;
  /**
   * Legt die Anfrage vor und wartet auf die Entscheidung. MUSS `signal` entgegennehmen und
   * bei `abort` (Timeout) die Pending-Anfrage invalidieren — eine spätere Betreiber-Antwort
   * darf NICHT nachträglich als Entscheidung wirken.
   */
  requestApproval(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}

/**
 * DER EINZIGE erlaubte Auswertungspfad. Allowlist: nur `approved` erlaubt den Aufruf.
 * Jeder andere (auch künftig neue) Ausgang ⇒ verweigert. Aufrufer dürfen NIE selbst
 * `outcome !== 'rejected'` o.ä. prüfen (das bräche die eiserne Regel bei neuen Enum-Werten).
 */
export function isApproved(decision: ApprovalDecision): boolean {
  return decision.outcome === 'approved';
}

/** Default-Timeouts (ms). Health kurz (nur Liveness), Approval lang (Mensch entscheidet). */
export const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

export interface MeldekanalRegistryOptions {
  /** Timeout für `isHealthy` (Default {@link DEFAULT_HEALTH_TIMEOUT_MS}). */
  readonly healthTimeoutMs?: number;
  /** Timeout für `requestApproval` (Default {@link DEFAULT_APPROVAL_TIMEOUT_MS}). */
  readonly approvalTimeoutMs?: number;
}

const VALID_OUTCOMES: ReadonlySet<string> = new Set<ApprovalOutcome>([
  'approved',
  'rejected',
  'denied-no-channel',
  'timeout',
  'error',
]);

type TimedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'timeout' }
  | { readonly ok: false; readonly reason: 'error'; readonly error: unknown };

/**
 * Führt `op(signal)` aus und rennt gegen einen Timeout. Bei Timeout wird `signal`
 * abgebrochen (der Kanal kann seine Pending-Anfrage invalidieren) und `{timeout}`
 * zurückgegeben; eine spätere Resolution/Rejection von `op` ist bereits behandelt
 * (kein Unhandled-Rejection) und wird verworfen. Reine Timeout-Hülle, wirft nicht.
 */
async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<TimedResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout({ kind: 'timeout' });
    }, timeoutMs);
  });
  try {
    // `Promise.resolve().then(() => op(...))` wandelt auch einen SYNCHRONEN Wurf von `op`
    // (z.B. ein nicht-async Kanal mit Guard-`throw`) in eine Rejection — sonst entkäme er
    // dieser Hülle und würde die ganze Registry-Kette abbrechen (fail-closed-Vertrag verletzt).
    // Das nachgelagerte .then(onFulfilled, onRejected) behandelt beide Ausgänge → auch eine
    // späte Rejection des abgebrochenen Aufrufs ist abgefangen (kein Unhandled-Rejection).
    const opWrapped = Promise.resolve()
      .then(() => op(controller.signal))
      .then(
        (value) => ({ kind: 'value' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      );
    const raced = await Promise.race([opWrapped, timeoutPromise]);
    if (raced.kind === 'value') return { ok: true, value: raced.value };
    if (raced.kind === 'error') return { ok: false, reason: 'error', error: raced.error };
    return { ok: false, reason: 'timeout' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errNote(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalisiert den (nicht vertrauenswürdig getypten) Kanal-Rückgabewert. Unbekanntes
 * Shape (kein Objekt, fehlendes/unbekanntes `outcome`) ⇒ `error` — nie versehentlich `approved`.
 */
function normalizeDecision(raw: unknown, channelId: string): ApprovalDecision {
  if (typeof raw !== 'object' || raw === null) {
    return { outcome: 'error', channelId, note: 'channel returned non-object decision' };
  }
  const outcome = (raw as { outcome?: unknown }).outcome;
  if (typeof outcome !== 'string' || !VALID_OUTCOMES.has(outcome)) {
    return { outcome: 'error', channelId, note: `channel returned unknown outcome: ${String(outcome)}` };
  }
  const note = (raw as { note?: unknown }).note;
  return {
    outcome: outcome as ApprovalOutcome,
    channelId,
    ...(typeof note === 'string' ? { note } : {}),
  };
}

/**
 * Hält N Meldekanäle und setzt die Fail-safe-Deny-Default-Regel an EINER Stelle durch.
 * Leer konstruiert ⇒ ein {@link DenyAllChannel} wird injiziert, sodass der Default-Pfad
 * beweisbar `denied-no-channel` liefert (kein Sonderpfad für „leere Liste").
 */
export class MeldekanalRegistry {
  private readonly channels: readonly Meldekanal[];
  private readonly healthTimeoutMs: number;
  private readonly approvalTimeoutMs: number;

  constructor(channels: readonly Meldekanal[] = [], opts: MeldekanalRegistryOptions = {}) {
    this.channels = channels.length > 0 ? [...channels] : [new DenyAllChannel()];
    this.healthTimeoutMs = opts.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.approvalTimeoutMs = opts.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  }

  /**
   * Wählt den ersten gesunden Kanal und gibt DESSEN Entscheidung zurück (terminal).
   * Kein gesunder Kanal ⇒ `denied-no-channel`. Wirft nicht.
   */
  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    for (const channel of this.channels) {
      const health = await withTimeout((signal) => channel.isHealthy(signal), this.healthTimeoutMs);
      // Unhealthy, Health-Fehler oder Health-Timeout ⇒ diesen Kanal überspringen (nicht abbrechen).
      if (!health.ok || health.value !== true) continue;

      // Erster gesunder Kanal = terminal. Seine Entscheidung gilt — kein zweiter Kanal.
      const res = await withTimeout(
        (signal) => channel.requestApproval(req, signal),
        this.approvalTimeoutMs,
      );
      if (!res.ok) {
        return res.reason === 'timeout'
          ? { outcome: 'timeout', channelId: channel.id }
          : { outcome: 'error', channelId: channel.id, note: errNote(res.error) };
      }
      return normalizeDecision(res.value, channel.id);
    }
    return { outcome: 'denied-no-channel' };
  }
}

/**
 * Eingebauter Kanal, der immer unhealthy ist und (falls doch gefragt) `denied-no-channel`
 * liefert. Macht eine leer/fehlkonfigurierte Registry beweisbar verweigernd.
 */
export class DenyAllChannel implements Meldekanal {
  readonly id = 'deny-all';

  async isHealthy(_signal: AbortSignal): Promise<boolean> {
    return false;
  }

  async requestApproval(_req: ApprovalRequest, _signal: AbortSignal): Promise<ApprovalDecision> {
    return { outcome: 'denied-no-channel', channelId: this.id };
  }
}
