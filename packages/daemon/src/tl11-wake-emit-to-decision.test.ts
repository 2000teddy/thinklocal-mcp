// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tl11-wake-emit-to-decision.test.ts — TL-11 Brücke: **echter Emitter → echte Draht-Serialisierung →
 * konsumentenseitige Entscheidung** (`interpretWakeFrame`). Socket-frei, deterministisch.
 *
 * WELCHE LÜCKE DIESE DATEI SCHLIESST
 * ----------------------------------
 * Es gibt drei Test-Ebenen für den TL-11-Wake — aber keine verband bisher die **beiden Enden**:
 *  1. `wake-contract.test.ts` — der Emitter (reine Funktionen).
 *  2. `tl11-wake-wire.conformance.test.ts` — der Emitter über einen **echten `/ws`-Socket** (Draht-Shape).
 *  3. `wake-consumer-reference.test.ts` — der Konsument-Kern `interpretWakeFrame` gegen **hand-gebaute** Frames.
 *
 * Niemand bewies: entscheidet der Kern (#331) korrekt über den Frame, den der Daemon **tatsächlich
 * emittiert und serialisiert**? Ein Drift **genau dazwischen** (Emitter legt den Payload flach statt unter
 * `.data`; die Bus-Hülle ändert sich; Zusatzfelder lecken) bliebe in allen drei Ebenen grün, während der
 * Out-of-Repo-Supervisor (Slice B) falsch entscheidet. Diese Datei fährt die **volle Kette ohne Socket**:
 * `inbox:new` → echter `registerWakeEmitter` → echter `MeshEventBus` (`{type,timestamp,data}`-Hülle) →
 * **dieselbe Serialisierung wie der Draht** (`websocket.ts:266` `JSON.stringify(event)` aus dem `onAny`-Kanal,
 * `websocket.ts:265`) → `interpretWakeFrame`. Uhr + Live-Liste injiziert (kein `sleep`, kein Fake-Timer).
 *
 * ABGRENZUNG: Der **Transport** (Socket, mTLS, Loopback-Gate, gerichtetes Routing) ist NICHT Gegenstand —
 * den deckt `tl11-wake-wire.conformance.test.ts`. Hier geht es allein um die Konsistenz **Emit-Bytes ↔
 * Konsumenten-Entscheidung**. De-riskt den letzten Hop weiter; entfernt den Slice-B-Blocker NICHT.
 */
import { describe, it, expect } from 'vitest';
import { MeshEventBus, type MeshEvent } from './events.js';
import {
  registerWakeEmitter,
  WakeCoalescer,
  DEFAULT_WAKE_COALESCE_MS,
  type WakeEventBus,
} from './wake-contract.js';
import { interpretWakeFrame } from './wake-consumer-reference.js';

const INSTANCE = 'claude-code-abc123';
const SPIFFE = 'spiffe://thinklocal/node/12D3KooTestPeerID';

interface EmitterOpts {
  live: readonly string[];
  spiffe?: (instanceId: string) => string | null;
  coalesceMs?: number;
  now?: () => number;
}

/**
 * Verdrahtet den ECHTEN Emitter auf einen echten Bus und fängt die emittierten `agent:wake`-Frames
 * **exakt so ab, wie der Draht sie sendet**: über `onAny` (derselbe Kanal wie `websocket.ts:265`) und
 * `JSON.stringify(event)` (dieselbe Serialisierung wie `websocket.ts:266`). Rückgabe: die Wire-Strings.
 */
function wireFramesFor(bus: MeshEventBus, opts: EmitterOpts): string[] {
  const wire: string[] = [];
  bus.onAny((event: MeshEvent) => {
    if (event.type === 'agent:wake') wire.push(JSON.stringify(event));
  });
  registerWakeEmitter({
    eventBus: bus as unknown as WakeEventBus,
    listInstances: () => opts.live,
    resolveSpiffe: opts.spiffe ?? ((id): string | null => (id === INSTANCE ? SPIFFE : null)),
    coalescer: new WakeCoalescer(opts.coalesceMs ?? DEFAULT_WAKE_COALESCE_MS),
    now: opts.now ?? ((): number => Date.now()),
  });
  return wire;
}

/** Eine eingehende Mesh-Nachricht, wie der Inbox-Pfad sie meldet (`to_agent_instance` optional). */
function inboxNew(bus: MeshEventBus, toAgentInstance: string | null): void {
  bus.emit('inbox:new', {
    message_id: 'm-secret-1',
    from: 'spiffe://thinklocal/node/12D3KooSender',
    body: 'top-secret-payload',
    ...(toAgentInstance === null ? {} : { to_agent_instance: toAgentInstance }),
  });
}

describe('TL-11 Emit→Decision-Brücke (echter Emitter, echte Draht-Bytes, kein Socket)', () => {
  it('adressiert + live + SPIFFE → der emittierte Draht-Frame poket den Konsumenten korrekt', () => {
    const bus = new MeshEventBus();
    const wire = wireFramesFor(bus, { live: [INSTANCE] });

    inboxNew(bus, INSTANCE);

    expect(wire).toHaveLength(1);
    // Der Kern (#331) entscheidet über GENAU die Bytes, die der Daemon sendet.
    const decision = interpretWakeFrame(wire[0]);
    expect(decision.poke).toBe(true);
    if (decision.poke) {
      expect(decision.trigger).toBe('wake');
      expect(decision.reason).toBe('inbox');
      expect(decision.instanceId).toBe(INSTANCE);
      expect(decision.spiffeUri).toBe(SPIFFE);
    }
  });

  it('der emittierte Frame hat die {type,timestamp,data}-Hülle mit Payload unter .data (Weld-Anker)', () => {
    const bus = new MeshEventBus();
    const wire = wireFramesFor(bus, { live: [INSTANCE] });
    inboxNew(bus, INSTANCE);

    const parsed = JSON.parse(wire[0]) as Record<string, unknown>;
    expect(parsed['type']).toBe('agent:wake');
    expect(typeof parsed['timestamp']).toBe('string');
    // Genau diese Verschachtelung ist der Grund, warum interpretWakeFrame unter `.data` liest (§4).
    expect(parsed['data']).toEqual({ instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
  });

  it('Zero-Content bleibt durch die ganze Kette erhalten: kein Nachrichteninhalt auf dem Draht/in der Decision', () => {
    const bus = new MeshEventBus();
    const wire = wireFramesFor(bus, { live: [INSTANCE] });
    inboxNew(bus, INSTANCE); // die inbox:new trägt message_id + body

    // Weder message_id noch body reisen mit — nicht auf dem Draht …
    expect(wire[0]).not.toContain('m-secret-1');
    expect(wire[0]).not.toContain('top-secret-payload');
    // … noch in der Konsumenten-Entscheidung.
    const decision = interpretWakeFrame(wire[0]);
    const flat = JSON.stringify(decision);
    expect(flat).not.toContain('m-secret-1');
    expect(flat).not.toContain('top-secret-payload');
  });

  it('coalesced: zwei rasche inbox:new → genau EIN Draht-Frame → genau EIN Poke', () => {
    const bus = new MeshEventBus();
    // Uhr steht → beide Nachrichten liegen im selben Coalesce-Fenster.
    const wire = wireFramesFor(bus, { live: [INSTANCE], now: () => 1_000 });

    inboxNew(bus, INSTANCE);
    inboxNew(bus, INSTANCE);

    expect(wire).toHaveLength(1);
    expect(interpretWakeFrame(wire[0]).poke).toBe(true);
  });

  it('fail-closed (live Instanz ohne SPIFFE): kein Draht-Frame → der Konsument bekommt nichts zu poken', () => {
    const bus = new MeshEventBus();
    const wire = wireFramesFor(bus, { live: [INSTANCE], spiffe: () => null });

    inboxNew(bus, INSTANCE);

    // Der Emitter emittiert fail-closed nicht → es gibt keinen Frame, über den der Kern entscheiden könnte.
    expect(wire).toHaveLength(0);
  });

  it('fail-closed (Ziel nicht live): kein Draht-Frame', () => {
    const bus = new MeshEventBus();
    const wire = wireFramesFor(bus, { live: [] });

    inboxNew(bus, INSTANCE);

    expect(wire).toHaveLength(0);
  });
});
