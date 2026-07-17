// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tl11-wake-wire.conformance.test.ts — TL-11 Draht-Ebenen-Conformance (Scaffold, KW30).
 *
 * WARUM DIESE DATEI EXISTIERT
 * ---------------------------
 * ADR-043 + `TL-11-wake-consumer-contract.md` pinnen den Wake-Kontrakt, gegen den der (Out-of-Repo)
 * Agent-Home-Supervisor (TL-11 Slice B) gebaut wird. Aber die §2–§5-Garantien der Consumer-Spec sind
 * bislang NUR auf Pure-Function-/Routing-Ebene bewacht (`wake-contract.test.ts`, `websocket.test.ts`:
 * `matchesSubscription`/`rejectsAgentFilter`/`isLoopbackIp` — reine Funktionen, kein Socket). Es fehlte ein
 * Test, der den **realen `/ws`-Socket** so treibt, wie der Supervisor ihn trifft: connect → subscribe →
 * `agent:wake`-Frame empfangen. Diese Datei schließt genau diese Lücke — **strictly in-repo, kein Deploy,
 * keine Certs-Fixtures nötig für die hier grünen Fälle** — und de-riskt Slice B über die Unit-Ebene hinaus.
 *
 * DECKUNGSGRENZE (bewusst, ehrlich)
 * ---------------------------------
 * Grün hier (über echten Loopback-Socket erreichbar): §3 Subscribe-Form, §4 Zero-Content-Wire-Shape,
 * §3/§5 directed deny-by-default + Match, §8.1 Frame-Pfad, §2 Loopback-Positivpfad.
 * NICHT hier (brauchen mTLS-Cert-Fixtures bzw. eine Nicht-Loopback-Bindung → eigener, schwererer Slice,
 * als `it.todo` markiert): §2 mTLS-Pflicht (cert-lose/`ws://`-Verbindung TLS-reset) und der Nicht-Loopback-
 * `4003`-Reject (req.ip ist auf einem 127.0.0.1-Harness immer Loopback; ohne trustProxy nicht spoofbar).
 *
 * WIRE-SHAPE-BEFUND (vom Scaffold aufgedeckt)
 * ------------------------------------------
 * Der Fanout (`websocket.ts:266`) sendet `JSON.stringify(event)` = das GANZE `MeshEvent`
 * (`{type, timestamp, data}`). Auf dem Draht ist der Wake also `{type:'agent:wake', timestamp,
 * data:{instance_id, spiffe_uri, reason}}` — der Payload liegt unter **`.data`**. Die Referenz in
 * Consumer-Spec §6 las `ev.reason` (statt `ev.data.reason`); mit diesem Slice auf `ev.data.reason` korrigiert.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MeshEventBus } from './events.js';
import { registerWebSocket } from './websocket.js';

// ── Harness: echter Fastify-Server + registerWebSocket, lauschend auf 127.0.0.1:<ephemeral> (Loopback). ──
// Plain HTTP genügt für die hier grünen Fälle: der Loopback-Gate (§2) prüft `req.ip`, nicht TLS; die
// mTLS-Pflicht ist eine cardServer-TLS-Config-Schicht (eigener it.todo-Slice mit Cert-Fixtures).
interface WireHarness {
  bus: MeshEventBus;
  port: number;
  app: FastifyInstance;
  close: () => Promise<void>;
}

const openHarnesses: WireHarness[] = [];
const openSockets: WebSocket[] = [];

async function startWakeWireHarness(): Promise<WireHarness> {
  const bus = new MeshEventBus();
  const app = Fastify({ logger: false });
  await registerWebSocket(app, bus);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (addr == null || typeof addr === 'string') throw new Error('kein TCP-Port vom Harness');
  const harness: WireHarness = {
    bus,
    port: addr.port,
    app,
    close: async () => {
      await app.close();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

/** Öffnet einen echten WS-Client (undici-global) gegen den Harness und wartet auf `open`. */
function openClient(port: number, query: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
  openSockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('WS-Client-Fehler beim Connect')), { once: true });
  });
}

/** Nächste Nachricht eines bestimmten `type` (verwirft davorliegende, z.B. `system:connected`). */
function waitForType(ws: WebSocket, type: string, timeoutMs = 1000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(`timeout: kein Frame vom Typ ${type}`));
    }, timeoutMs);
    const onMsg = (ev: MessageEvent): void => {
      const parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
      if (parsed['type'] === type) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(parsed);
      }
    };
    ws.addEventListener('message', onMsg);
  });
}

/**
 * Sammelt alle Frames bis zu einem Same-Socket-Barrier: sendet einen `subscribe`-Frame und wartet auf
 * dessen `system:subscribed`-Antwort. Da ein einzelner WS-Socket die Reihenfolge erhält, sind alle Wakes,
 * die JEMALS an diesen Socket gegangen wären, VOR der Antwort eingetroffen → deterministischer Negativ-Test
 * (kein willkürliches sleep). `agentSetsFilter=false` hält den Frame filter-frei (ändert nur die Event-Liste).
 */
function collectUntilBarrier(ws: WebSocket, barrierEvents: string[]): Promise<Record<string, unknown>[]> {
  const seen: Record<string, unknown>[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('timeout: kein Barrier-Frame (system:subscribed)'));
    }, 1000);
    const onMsg = (ev: MessageEvent): void => {
      const parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
      if (parsed['type'] === 'system:subscribed') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(seen);
        return;
      }
      if (parsed['type'] !== 'system:connected') seen.push(parsed);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ type: 'subscribe', events: barrierEvents }));
  });
}

const SPIFFE = 'spiffe://thinklocal/node/12D3KooTestPeerID';
const INSTANCE = 'claude-code-abc123';
const q = (s: string): string => encodeURIComponent(s);

afterEach(async () => {
  for (const ws of openSockets.splice(0)) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
  for (const h of openHarnesses.splice(0)) {
    await h.close();
  }
});

describe('TL-11 Wake-Wire-Conformance (echter /ws-Socket, Loopback)', () => {
  it('§3: Connect mit Query-Subscribe → system:connected spiegelt agentFilter', async () => {
    const h = await startWakeWireHarness();
    const ws = await openClient(h.port, `?subscribe=agent:wake&agent=${q(SPIFFE)}`);
    const welcome = await waitForType(ws, 'system:connected');
    const data = welcome['data'] as Record<string, unknown>;
    expect(data['agentFilter']).toBe(SPIFFE);
    expect(data['subscription']).toEqual(['agent:wake']);
  });

  it('§4: adressierter, gefilterter Client → genau 1 Zero-Content agent:wake, Payload unter .data', async () => {
    const h = await startWakeWireHarness();
    const ws = await openClient(h.port, `?subscribe=agent:wake&agent=${q(SPIFFE)}`);
    await waitForType(ws, 'system:connected');
    const got = waitForType(ws, 'agent:wake');
    // Emittiert exakt wie der Wake-Emitter (registerWakeEmitter): Zero-Content-Payload.
    h.bus.emit('agent:wake', { instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    const frame = await got;
    // Wire-Shape-Wahrheit: {type, timestamp, data:{...}} — Payload NESTED unter .data.
    expect(frame['type']).toBe('agent:wake');
    const payload = frame['data'] as Record<string, unknown>;
    expect(payload).toEqual({ instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    // Zero-Content-Invariante: KEIN Nachrichteninhalt (kein message_id / count / body) auf dem Draht.
    const flat = JSON.stringify(frame);
    expect(flat).not.toContain('message_id');
    expect(flat).not.toContain('"count"');
    expect(flat).not.toContain('body');
  });

  it('§3 directed match: Filter = instance_id (statt SPIFFE) empfängt den Wake ebenfalls', async () => {
    const h = await startWakeWireHarness();
    const ws = await openClient(h.port, `?subscribe=agent:wake&agent=${q(INSTANCE)}`);
    await waitForType(ws, 'system:connected');
    const got = waitForType(ws, 'agent:wake');
    h.bus.emit('agent:wake', { instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    expect((await got)['type']).toBe('agent:wake');
  });

  it('§3/§5 deny-by-default: UNGEFILTERTER Client bekommt NIE ein agent:wake (Leak D1 zu)', async () => {
    const h = await startWakeWireHarness();
    // Abonniert agent:wake OHNE agent-Filter → directed deny-by-default.
    const ws = await openClient(h.port, `?subscribe=agent:wake`);
    await waitForType(ws, 'system:connected');
    h.bus.emit('agent:wake', { instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    // Same-Socket-Barrier: nach system:subscribed sind alle etwaigen Wakes bereits durch → deterministisch.
    const seen = await collectUntilBarrier(ws, ['heartbeat']);
    expect(seen.filter((m) => m['type'] === 'agent:wake')).toHaveLength(0);
  });

  it('§3/§5 directed drop: falscher agent-Filter → kein Wake (nicht das Ziel)', async () => {
    const h = await startWakeWireHarness();
    const ws = await openClient(h.port, `?subscribe=agent:wake&agent=${q('spiffe://thinklocal/node/SOMEONE-ELSE')}`);
    await waitForType(ws, 'system:connected');
    h.bus.emit('agent:wake', { instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    const seen = await collectUntilBarrier(ws, ['heartbeat']);
    expect(seen.filter((m) => m['type'] === 'agent:wake')).toHaveLength(0);
  });

  it('§8.1 Frame-Pfad (Loopback): agent-Filter per subscribe-Frame gesetzt → Wake wird zugestellt', async () => {
    const h = await startWakeWireHarness();
    // Connect OHNE agent (kein Filter am Query-Pfad), dann Filter per Frame — von Loopback erlaubt.
    const ws = await openClient(h.port, `?subscribe=agent:wake`);
    await waitForType(ws, 'system:connected');
    const subscribed = waitForType(ws, 'system:subscribed');
    ws.send(JSON.stringify({ type: 'subscribe', events: ['agent:wake'], agent: SPIFFE }));
    const sub = await subscribed;
    expect((sub['data'] as Record<string, unknown>)['agentFilter']).toBe(SPIFFE);
    const got = waitForType(ws, 'agent:wake');
    h.bus.emit('agent:wake', { instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' });
    expect((await got)['type']).toBe('agent:wake');
  });

  it('§2 Loopback-Positivpfad: agent-gefilterter Connect von 127.0.0.1 wird NICHT geschlossen (kein 4003)', async () => {
    const h = await startWakeWireHarness();
    const ws = await openClient(h.port, `?subscribe=agent:wake&agent=${q(SPIFFE)}`);
    // Erfolgreicher system:connected-Empfang beweist: der Loopback-Gate hat den Filter zugelassen.
    const welcome = await waitForType(ws, 'system:connected');
    expect(welcome['type']).toBe('system:connected');
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // ── Deckungsgrenze: braucht mTLS-Cert-Fixtures bzw. Nicht-Loopback-Bindung (eigener, schwererer Slice) ──
  it.todo(
    '§2 mTLS-Pflicht: cert-lose / ws://-Verbindung wird auf TLS-Ebene resettet — braucht cardServer-TLS + Client-Cert-Fixtures',
  );
  it.todo(
    '§2 Nicht-Loopback → Close 4003: agent-Filter von ≠127.0.0.1 abgelehnt — braucht Bindung an ein Nicht-Loopback-Interface (req.ip ohne trustProxy = Socket-Peer)',
  );
});
