/**
 * agent-register-format.ts — reine Formatierung der stderr-Diagnose für die
 * Instanz-Registrierung/-Abmeldung in `mcp-stdio.ts` (A1 / Mesh-Messaging).
 *
 * Zuvor verschluckte `registerWithDaemon()` JEDEN Fehler pauschal als
 * „registration skipped (daemon unreachable)" — auch einen HTTP 500. Diese
 * Helfer trennen die drei Fälle sauber, damit ein echter Server-Fehler
 * (Status + Body) sichtbar wird statt als „unreachable" fehlgedeutet.
 *
 * Rein + seiteneffektfrei → unit-testbar ohne Daemon/Netz/`main()`.
 */

/** Ergebnis eines Registry-Calls gegen den lokalen Daemon. */
export type DaemonCallOutcome =
  | { kind: 'ok' }
  /** HTTP-Antwort mit non-2xx-Status (Daemon erreicht, aber Fehler). */
  | { kind: 'http'; status: number; body: string }
  /** Transport-Fehler (Daemon nicht erreichbar / TLS / DNS). */
  | { kind: 'error'; message: string };

/** Body-Auszug auf eine sinnvolle Länge kürzen (eine Diagnosezeile). */
const MAX_BODY = 300;
function snippet(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_BODY ? `${oneLine.slice(0, MAX_BODY)}…` : oneLine;
}

/** Diagnosezeile für die Registrierung (immer eine Zeile, ohne Trailing-Newline). */
export function formatRegisterOutcome(instanceId: string, outcome: DaemonCallOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `[mcp-stdio] registered as ${instanceId}`;
    case 'http':
      return `[mcp-stdio] registration failed: HTTP ${outcome.status} — ${snippet(outcome.body)}`;
    case 'error':
      return `[mcp-stdio] registration skipped (daemon unreachable): ${outcome.message}`;
  }
}

/**
 * Diagnosezeile für die Abmeldung. Erfolg → `null` (die „unregister sent"-Zeile
 * wird separat geschrieben; kein Rauschen). Fehler → präzise Zeile.
 */
export function formatUnregisterOutcome(instanceId: string, outcome: DaemonCallOutcome): string | null {
  switch (outcome.kind) {
    case 'ok':
      return null;
    case 'http':
      return `[mcp-stdio] unregister ${instanceId} failed: HTTP ${outcome.status} — ${snippet(outcome.body)}`;
    case 'error':
      return `[mcp-stdio] unregister ${instanceId} failed (daemon unreachable): ${outcome.message}`;
  }
}
