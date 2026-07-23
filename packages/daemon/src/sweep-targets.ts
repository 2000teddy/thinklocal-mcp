// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * sweep-targets.ts — TL-11 Reconciliation-Sweep: die reine Ziel-Auswahl (KEINE Verdrahtung).
 *
 * Wakes sind erklärtermaßen **best-effort/lossy** (ADR-043 §3): fällt ein WS-Konsument in genau dem
 * Moment aus, in dem sein `agent:wake` emittiert wird, bleibt die Nachricht liegen, bis er das Postfach
 * von sich aus pollt. Ein **Reconciliation-Sweep** schließt diese Reconnect-Lücke, indem er fragt:
 * *welche live registrierte Instanz hat ungelesene Post?* Genau diese Frage — und **nur** sie —
 * beantwortet dieses Modul.
 *
 * **Bewusst NICHT hier entschieden** (das sind die offenen Punkte aus `ADR-047` §3, und dieses Modul
 * nimmt keinen davon vorweg):
 *  - **Ob** der Daemon überhaupt sweept (oder die Cold-Start-Pflicht beim Konsumenten bleibt) —
 *    Aufrufer-Frage; dieses Modul hat **0 Aufrufer**.
 *  - **Wann** gesweept wird (periodisch, bei WS-(Re-)Connect, bei `agentRegistry.on('register')`) —
 *    Aufrufer-Frage, die Signatur kennt keine Uhr und keinen Trigger.
 *  - **Ob** ein Sweep-Wake den {@link WakeCoalescer} passiert, umgeht oder einen **eigenen** Coalescer
 *    bekommt — Aufrufer-Frage: hier wird nichts unterdrückt und nichts emittiert, es wird nur
 *    **ausgewählt**. (Der Emitter wendet Coalescing ebenfalls erst NACH der Ziel-Auflösung an,
 *    `wake-contract.ts` `computeWakes`.)
 *  - **Opt-in/Env-Flag** — Aufrufer-Frage.
 *
 * **Fail-closed & deterministisch**, konsistent zum Emitter:
 *  - Ohne verwertbare `spiffeUri` ⇒ **kein** Ziel (ein un-routbares Wake wäre ein Leak-/Broadcast-Kandidat
 *    — dieselbe Regel wie `wake-contract.ts` beim SPIFFE-Guard).
 *  - `unreadFor` liefert nichts Positives / etwas Unbrauchbares / **wirft** ⇒ **kein** Ziel („unbekannt"
 *    weckt nicht). Die Funktion wirft nie.
 *  - Ergebnis stabil nach `instanceId` sortiert; keine Uhr, kein Zufall.
 */

/** Eine live registrierte Agenten-Instanz (Ausschnitt aus `AgentRegistryEntry`, strukturell). */
export interface LiveInstance {
  readonly instanceId: string;
  readonly spiffeUri: string;
}

/** Eine Instanz, die ungelesene Post hat und routbar ist ⇒ Kandidat für einen Sweep-Wake. */
export interface SweepTarget {
  readonly instanceId: string;
  readonly spiffeUri: string;
  readonly unread: number;
}

/** Locale-unabhängiger, stabiler Vergleich (kein `localeCompare` — Determinismus über Hosts hinweg). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Wählt aus den live registrierten Instanzen diejenigen mit ungelesener Post.
 *
 * @param live     live registrierte Instanzen (im Daemon: `agentRegistry.list()`).
 * @param unreadFor Zähler für ungelesene Nachrichten **dieser** Instanz (im Daemon:
 *   `(id) => agentInbox.unreadCount({ forInstance: id })`). **Achtung, bewusst dem Aufrufer überlassen:**
 *   `unreadCount` zählt mit gesetztem `forInstance` per Default **keine** Legacy-Zeilen
 *   (`to_agent_instance IS NULL`) — ob ein Sweep die auch sehen soll, ist eine Aufrufer-/Vertragsfrage
 *   (`includeLegacy`), keine dieses Moduls.
 * @returns stabil nach `instanceId` sortierte Kandidaten. Wirft nie.
 */
export function computeSweepTargets(
  live: readonly LiveInstance[],
  unreadFor: (instanceId: string) => number,
): SweepTarget[] {
  if (!Array.isArray(live)) return [];
  const out: SweepTarget[] = [];
  const seen = new Set<string>();

  for (const entry of live) {
    if (entry == null || typeof entry !== 'object') continue;
    const { instanceId, spiffeUri } = entry as { instanceId?: unknown; spiffeUri?: unknown };
    if (typeof instanceId !== 'string' || instanceId === '') continue;
    // Ohne routbare SPIFFE-URI gäbe es kein zustellbares Wake → gar nicht erst als Ziel führen.
    if (typeof spiffeUri !== 'string' || spiffeUri === '') continue;
    if (seen.has(instanceId)) continue; // doppelte Registry-Einträge: erster gewinnt, deterministisch

    let unread: number;
    try {
      unread = unreadFor(instanceId);
    } catch {
      // Zähler kaputt/nicht verfügbar ⇒ „unbekannt", und unbekannt weckt nicht.
      continue;
    }
    if (typeof unread !== 'number' || !Number.isFinite(unread) || unread <= 0) continue;

    seen.add(instanceId);
    out.push({ instanceId, spiffeUri, unread });
  }

  return out.sort((a, b) => cmpStr(a.instanceId, b.instanceId));
}
