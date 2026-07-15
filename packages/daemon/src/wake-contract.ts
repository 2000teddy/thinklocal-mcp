// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wake-contract.ts — ADR-043 (TL-11 Slice A): der Heartbeat-Weckruf-Kontrakt + das edge-driven
 * per-Instanz-Fanout. Formalisiert daemon-seitig, was ein „Wake" ist, damit der Out-of-Repo
 * Agent-Home-Supervisor ein wohldefiniertes Signal konsumieren kann. **Kein Transport hier.**
 *
 * Invarianten (CO opus+sonnet 2026-07-15):
 *  - **fail-closed Fanout:** unadressiert (`null`) oder nicht-live → `[]` (niemanden wecken); KEIN
 *    Broadcast-Fallback (der wäre 1→N-Amplifikation; der Coalescer begrenzt Rate PRO Instanz, nicht Fanout).
 *  - **Zero-Content:** `WakeSignal` trägt keinen Inhalt (nicht mal `message_id`/Count) — nur „prüfe dein
 *    Postfach"; idempotent (zwei Wakes = ein Wake) → Coalescing funktioniert; keine Exfiltration.
 */

/** Grund eines Weckrufs. Erweiterbar (heute nur Postfach). */
export type WakeReason = 'inbox';

/** Ein Weckruf an eine registrierte Agenten-Instanz — **inhaltsfrei**. */
export interface WakeSignal {
  readonly instanceId: string;
  readonly reason: WakeReason;
}

/**
 * Auflösung der Wake-Ziele — **fail-closed**. Eine adressierte, live Instanz → `[it]`. `null`/leer
 * (unadressiert/daemon-level) → `[]`. Adressiert-aber-nicht-live → `[]`. **Kein Broadcast** (Opt-in
 * wäre später additiv nachrüstbar; Rücknahme wäre Breaking).
 */
export function resolveWakeTargets(
  targetInstance: string | null | undefined,
  liveInstanceIds: readonly string[],
): string[] {
  if (targetInstance == null || targetInstance === '') return [];
  return liveInstanceIds.includes(targetInstance) ? [targetInstance] : [];
}

/** Default-Coalesce-Fenster (ms): N rasche Nachrichten → 1 Wake pro Instanz pro Fenster. */
export const DEFAULT_WAKE_COALESCE_MS = 2_000;

/** Per-Instanz-Dedup im Zeitfenster. `nowMs` wird übergeben (deterministisch/testbar). */
export class WakeCoalescer {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number = DEFAULT_WAKE_COALESCE_MS) {}

  /** true ⇒ jetzt wecken (und Zeit merken); false ⇒ im Fenster schon geweckt (unterdrücken). */
  shouldWake(instanceId: string, nowMs: number): boolean {
    const prev = this.last.get(instanceId);
    if (prev !== undefined && nowMs - prev < this.windowMs) return false;
    this.last.set(instanceId, nowMs);
    // CR-LOW: Einträge außerhalb des Fensters entfernen → beschränkt die Map bei Instanz-Churn
    // (der gerade gesetzte Eintrag hat Alter 0 und bleibt). Bounded, läuft nur beim tatsächlichen Wake.
    for (const [k, t] of this.last) {
      if (nowMs - t >= this.windowMs) this.last.delete(k);
    }
    return true;
  }
}

/**
 * Kombiniert Auflösung + Coalescing → die tatsächlich zu emittierenden `WakeSignal`s (≤ 1, da
 * `resolveWakeTargets` ≤ 1 Ziel liefert). Rein bis auf den Coalescer-Zustand.
 */
export function computeWakes(
  targetInstance: string | null | undefined,
  liveInstanceIds: readonly string[],
  coalescer: WakeCoalescer,
  nowMs: number,
): WakeSignal[] {
  const out: WakeSignal[] = [];
  for (const id of resolveWakeTargets(targetInstance, liveInstanceIds)) {
    if (coalescer.shouldWake(id, nowMs)) out.push({ instanceId: id, reason: 'inbox' });
  }
  return out;
}

// --- Verdrahtung (kein neuer Transport — nur ein eventBus-Subscriber) ---

/** Minimaler EventBus-Ausschnitt (strukturell — testbar ohne die konkrete MeshEventBus-Instanz). */
export interface WakeEventBus {
  on(type: 'inbox:new', handler: (event: { type: string; data: Record<string, unknown> }) => void): void;
  emit(type: 'agent:wake', data: Record<string, unknown>): void;
}

export interface WakeEmitterDeps {
  eventBus: WakeEventBus;
  /** Live registrierte Agenten-Instanz-IDs (im Daemon: `agentRegistry.list().map(e => e.instanceId)`). */
  listInstances: () => readonly string[];
  coalescer: WakeCoalescer;
  /** Uhr (injiziert; real `Date.now`). */
  now: () => number;
  log?: { warn(obj: unknown, msg: string): void };
}

/**
 * Abonniert `inbox:new`, liest `to_agent_instance`, berechnet die Wakes und emittiert `agent:wake`.
 * Unadressierte Nachricht → **kein** Wake + WARN-Log (operator-sichtbar). Kein neuer Transport —
 * der letzte Hop in den CLI-Prozess ist der Out-of-Repo Agent-Home-Supervisor (WS-`inbox:new`-Reuse).
 */
export function registerWakeEmitter(deps: WakeEmitterDeps): void {
  deps.eventBus.on('inbox:new', (event) => {
    const raw = event.data['to_agent_instance'];
    const targetInstance = typeof raw === 'string' && raw !== '' ? raw : null;
    const wakes = computeWakes(targetInstance, deps.listInstances(), deps.coalescer, deps.now());
    if (wakes.length === 0) {
      // CR-LOW: WARN nur wenn das Feld EXPLIZIT gesetzt und null ist (Loopback-Send an daemon-level =
      // echte Fehl-/Nicht-Adressierung). Fehlt das Feld ganz (Remote/Broadcast — erwartetes null), still
      // bleiben, sonst Alert-Fatigue auf normalem Mesh-Verkehr.
      if (targetInstance === null && 'to_agent_instance' in event.data) {
        deps.log?.warn(
          { from: event.data['from'], message_id: event.data['message_id'] },
          '[wake] lokaler Send ohne Ziel-Instanz → kein Wake (fail-closed)',
        );
      }
      return;
    }
    for (const w of wakes) {
      deps.eventBus.emit('agent:wake', { instance_id: w.instanceId, reason: w.reason });
    }
  });
}
