// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * sweep-wiring.ts — TL-11 Reconciliation-Sweep: die Verdrahtung des in #322 gelandeten reinen Kerns.
 *
 * **Die Lücke, die das schließt.** `agent:wake` ist erklärtermaßen **best-effort/lossy** (ADR-043 §3):
 * es wird genau dann emittiert, wenn eine Nachricht eintrifft. War der Supervisor einer Instanz in
 * genau diesem Moment nicht verbunden (Neustart, Reconnect-Lücke, Crash), ist das Wake **weg** — die
 * Nachricht liegt im Postfach und **niemand** erfährt davon, bis der Konsument von sich aus pollt.
 * Der Sweep beantwortet die Frage nachträglich: *welche live registrierte Instanz hat ungelesene Post?*
 * — und weckt sie noch einmal.
 *
 * **Auslöser: `agentRegistry.on('register')`.** Genau dann meldet sich eine Instanz (neu oder nach
 * Neustart) beim Daemon — der Moment, in dem ihr Supervisor gerade wieder da ist. Der Hook existiert
 * bereits (`agent-registry.ts`); es braucht **keinen** neuen Timer und **keinen** Eingriff in die
 * sicherheitsgehärtete WS-Datei (ADR-047 §3 hatte den WS-Connect-Hook als die *teuerste* Variante
 * benannt, weil es ihn schlicht nicht gibt).
 *
 * **Eigener Coalescer (ADR-047 §3, Option 1).** Der Sweep benutzt eine **eigene** {@link WakeCoalescer}-
 * Instanz, nicht die des Emitters. Damit gilt beides gleichzeitig: der Sweep ist rate-begrenzt, **und**
 * er wird nicht vom laufenden Inbox-Verkehr geschluckt — sonst verpuffte er genau im Reconnect-Fenster,
 * das er beheben soll. Die §5-Zusage der Consumer-Spec liest sich damit als „≤ 1 Wake pro Instanz pro
 * Fenster **je Quelle**" — weiterhin eine harte Schranke. Zusätzliche Wakes sind ohnehin unschädlich:
 * die Spec hält in der **Idempotent**-Zeile fest „zwei Wakes == ein Wake … mehrfaches Wecken ist harmlos".
 *
 * **Default AUS.** Ohne gesetztes Flag wird `registerReconciliationSweep` gar nicht erst aufgerufen
 * (Regime wie TL-09b `TLMCP_APPROVAL_CHANNEL_ENABLED`) ⇒ **kein** Verhaltens-Delta gegenüber heute.
 *
 * **Fail-closed & fail-safe:** ohne routbare SPIFFE kein Wake (`computeSweepTargets`); jeder Fehler
 * — kaputter Zähler, werfender Bus — wird geschluckt und geloggt. Ein Sweep darf den Daemon **nie**
 * beeinträchtigen: er ist eine Nachbesserung, kein kritischer Pfad.
 *
 * **Nicht hier:** der letzte Hop Supervisor → CLI (TL-11 Slice B, out-of-repo/host-gated) und jede
 * Änderung am Emitter-Pfad selbst.
 */
import { computeSweepTargets, type LiveInstance } from './sweep-targets.js';
import { WakeCoalescer, DEFAULT_WAKE_COALESCE_MS, type WakeEventBus } from './wake-contract.js';

/** Nur die Registry-Fähigkeiten, die der Sweep braucht (strukturell — testbar ohne echte Registry). */
export interface SweepRegistry {
  on(
    listener: (reason: 'register' | 'unregister' | 'stale', entry: { instanceId: string }) => void,
  ): () => void;
  list(): ReadonlyArray<LiveInstance>;
}

export interface SweepDeps {
  registry: SweepRegistry;
  eventBus: WakeEventBus;
  /** Ungelesene Nachrichten dieser Instanz (im Daemon: `agentInbox.unreadCount({ forInstance })`). */
  unreadFor: (instanceId: string) => number;
  /** Uhr (injiziert; real `Date.now`). */
  now: () => number;
  /** Eigenes Coalesce-Fenster für den Sweep-Pfad. Default = das des Emitters. */
  coalesceMs?: number;
  log?: { info(obj: unknown, msg: string): void; warn(obj: unknown, msg: string): void };
}

/** Ergebnis eines Sweep-Laufs — für Tests und Diagnose. */
export interface SweepRun {
  /** Instanzen mit ungelesener Post (vor Coalescing). */
  readonly candidates: number;
  /** Tatsächlich emittierte Wakes (nach Coalescing). */
  readonly woken: readonly string[];
}

/**
 * Führt **einen** Sweep aus: Ziele bestimmen, coalescen, `agent:wake` emittieren. Wirft nie.
 *
 * Exportiert, damit ein Aufrufer den Sweep auch außerhalb des Registry-Hooks auslösen kann (z.B. beim
 * Start) — ohne dafür die Verdrahtung zu duplizieren.
 */
export function runReconciliationSweep(
  deps: SweepDeps,
  coalescer: WakeCoalescer,
  trigger: string,
): SweepRun {
  let live: readonly LiveInstance[] = [];
  try {
    live = deps.registry.list();
  } catch (error) {
    deps.log?.warn(
      { trigger, err: String(error) },
      '[wake-sweep] Registry nicht lesbar — Sweep übersprungen',
    );
    return { candidates: 0, woken: [] };
  }

  // `computeSweepTargets` ist selbst total (werfender Zähler ⇒ Instanz entfällt) — #322.
  const targets = computeSweepTargets(live, deps.unreadFor);
  const woken: string[] = [];

  for (const target of targets) {
    // Eigener Coalescer: der Sweep unterdrückt nur SICH SELBST, nicht der Inbox-Verkehr ihn.
    if (!coalescer.shouldWake(target.instanceId, deps.now())) continue;
    try {
      deps.eventBus.emit('agent:wake', {
        instance_id: target.instanceId,
        spiffe_uri: target.spiffeUri,
        reason: 'inbox',
      });
      woken.push(target.instanceId);
    } catch (error) {
      // Ein kaputter Bus darf den Sweep nicht abbrechen — die übrigen Instanzen bekommen ihr Wake.
      deps.log?.warn(
        { trigger, instance_id: target.instanceId, err: String(error) },
        '[wake-sweep] Wake konnte nicht emittiert werden',
      );
    }
  }

  if (woken.length > 0) {
    deps.log?.info(
      { trigger, candidates: targets.length, woken: woken.length },
      '[wake-sweep] Reconciliation-Wakes emittiert',
    );
  }
  return { candidates: targets.length, woken };
}

/**
 * Verdrahtet den Sweep auf `registry.on('register')`. Gibt eine Abmelde-Funktion zurück (Shutdown).
 *
 * **Nur `register` löst aus** — `unregister`/`stale` bedeuten, dass die Instanz gerade **weg** ist; sie
 * zu wecken wäre sinnlos und im `stale`-Fall sogar ein Wake an einen toten Konsumenten.
 */
export function registerReconciliationSweep(deps: SweepDeps): () => void {
  const coalescer = new WakeCoalescer(deps.coalesceMs ?? DEFAULT_WAKE_COALESCE_MS);

  return deps.registry.on((reason) => {
    if (reason !== 'register') return;
    try {
      runReconciliationSweep(deps, coalescer, 'agent-register');
    } catch (error) {
      // Listener laufen synchron im Registry-Pfad — hier darf NICHTS nach oben durchschlagen.
      deps.log?.warn({ err: String(error) }, '[wake-sweep] Sweep fehlgeschlagen (ignoriert)');
    }
  });
}
