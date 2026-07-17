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
 * `agent:wake`-Frame empfangen. Diese Datei schließt genau diese Lücke — **strictly in-repo, kein Deploy** —
 * und de-riskt Slice B über die Unit-Ebene hinaus.
 *
 * DECKUNG (bewusst, ehrlich)
 * --------------------------
 * Grün über echten Loopback-Socket: §3 Subscribe-Form, §4 Zero-Content-Wire-Shape, §3/§5 directed
 * deny-by-default + Match, §8.1 Frame-Pfad, §2 Loopback-Positivpfad.
 * §2 mTLS-Pflicht (KW30 cert-fixture Slice): ein zweiter Harness fährt Fastify mit DEMSELBEN mTLS-Vertrag,
 * den der cardServer produktiv setzt — `https` + requestCert + rejectUnauthorized (agent-card.ts:229-230) —
 * mit In-Memory-CA/Server-/Client-Leaf (node-forge) hoch → gültiges Client-Cert erreicht /ws
 * (system:connected), cert-lose bzw. `ws://`-Verbindungen werden auf TLS-Ebene resettet. ABGRENZUNG (CR-M2):
 * dies beweist die mTLS-SEMANTIK des /ws-Handlers unter diesen Flags, NICHT die Produktions-Verdrahtung
 * selbst (der Harness repliziert die Flags, statt agent-card.ts zu importieren) — ein Regress, der
 * `requestCert` in agent-card.ts umlegt, wird hier NICHT gefangen (eigener Cardserver-Wiring-Test = Follow-up).
 * §2 Nicht-Loopback-`4003`-Reject: ein dritter Harness bindet an eine echte Nicht-Loopback-IPv4 der
 * Maschine (kein trustProxy → req.ip = Socket-Peer, nicht spoofbar) → agent-gefilterter Connect wird mit
 * `4003` geschlossen. Auf reinen Loopback-Hosts (keine externe IPv4) wird NUR dieser eine Fall via
 * `it.skipIf` übersprungen (statt falsch grün); der isLoopbackIp-Prädikatstest bleibt unit-bewacht.
 *
 * WIRE-SHAPE-BEFUND (vom Scaffold aufgedeckt)
 * ------------------------------------------
 * Der Fanout (`websocket.ts:266`) sendet `JSON.stringify(event)` = das GANZE `MeshEvent`
 * (`{type, timestamp, data}`). Auf dem Draht ist der Wake also `{type:'agent:wake', timestamp,
 * data:{instance_id, spiffe_uri, reason}}` — der Payload liegt unter **`.data`**. Die Referenz in
 * Consumer-Spec §6 las `ev.reason` (statt `ev.data.reason`); mit diesem Slice auf `ev.data.reason` korrigiert.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { networkInterfaces } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import forge from 'node-forge';
import { WebSocket as WsClient, Agent } from 'undici';
import { MeshEventBus } from './events.js';
import { registerWebSocket } from './websocket.js';

// ── Harness: echter Fastify-Server + registerWebSocket, lauschend auf 127.0.0.1:<ephemeral> (Loopback). ──
// Plain HTTP genügt für die Loopback-Routing-Fälle: der Loopback-Gate (§2) prüft `req.ip`, nicht TLS. Die
// mTLS-Pflicht ist eine cardServer-TLS-Config-Schicht → eigener `startMtlsWakeWireHarness` (Cert-Fixtures).
interface WireHarness {
  bus: MeshEventBus;
  port: number;
  app: FastifyInstance;
  close: () => Promise<void>;
}

const openHarnesses: WireHarness[] = [];
const openSockets: Array<{ close: () => void }> = [];
const openAgents: Agent[] = [];

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

// ── §2 mTLS-Fixtures: In-Memory-CA + Server-/Client-Leaf (node-forge), nur für diese Datei. ──
// Die mTLS-Pflicht ist eine Transport-Schicht des cardServers (Fastify `https` + requestCert), NICHT Teil
// von registerWebSocket. Dieser Harness setzt denselben Vertrag (requestCert+rejectUnauthorized, wie
// agent-card.ts:229-230) real auf → der /ws-Pfad ist unter diesen Flags nur über mTLS erreichbar (cert-los/
// `ws://` → TLS-Reset). Er repliziert die Flags (statt agent-card.ts zu importieren) → siehe ABGRENZUNG CR-M2.
let certSerial = 0x10;
function makeTestCa(): { caCertPem: string; caCert: forge.pki.Certificate; caKey: forge.pki.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 864e5);
  const attrs = [{ name: 'commonName', value: 'tl11 wire test ca' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { caCertPem: forge.pki.certificateToPem(cert), caCert: cert, caKey: keys.privateKey };
}

function issueLeaf(
  caCert: forge.pki.Certificate,
  caKey: forge.pki.PrivateKey,
  cn: string,
  serverSan: boolean,
): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = (certSerial++).toString(16).padStart(4, '0');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 864e5);
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer(caCert.subject.attributes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extensions: any[] = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
  ];
  if (serverSan) {
    extensions.push({
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' }, // DNS
        { type: 7, ip: '127.0.0.1' }, // IP
      ],
    });
  }
  cert.setExtensions(extensions);
  cert.sign(caKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

interface MtlsHarness extends WireHarness {
  tls: { caPem: string; clientCertPem: string; clientKeyPem: string };
}

/** Fastify mit echtem mTLS-Transport (requestCert + rejectUnauthorized) + registerWebSocket, Loopback. */
async function startMtlsWakeWireHarness(): Promise<MtlsHarness> {
  const ca = makeTestCa();
  const server = issueLeaf(ca.caCert, ca.caKey, 'localhost', true);
  const client = issueLeaf(ca.caCert, ca.caKey, 'tl11-test-client', false);
  const bus = new MeshEventBus();
  const app = Fastify({
    logger: false,
    https: {
      key: server.keyPem,
      cert: server.certPem,
      ca: ca.caCertPem,
      requestCert: true,
      rejectUnauthorized: true,
    },
  });
  await registerWebSocket(app, bus);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (addr == null || typeof addr === 'string') throw new Error('kein TCP-Port vom mTLS-Harness');
  const harness: MtlsHarness = {
    bus,
    port: addr.port,
    app,
    tls: { caPem: ca.caCertPem, clientCertPem: client.certPem, clientKeyPem: client.keyPem },
    close: async () => {
      await app.close();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

/** Öffnet einen echten wss-Client (undici) mit den gegebenen TLS-connect-Optionen; trackt Socket+Agent. */
function openWssClient(port: number, path: string, connect: Agent.Options['connect']): WsClient {
  const agent = new Agent({ connect });
  openAgents.push(agent);
  const ws = new WsClient(`wss://127.0.0.1:${port}/ws${path}`, { dispatcher: agent });
  openSockets.push(ws);
  return ws;
}

/**
 * Verbindungs-Ausgang eines undici-Clients: 'open' (Handshake ok), 'error' (TLS/Transport-Reset) oder
 * 'timeout' (weder noch). Der 'timeout'-Sentinel ist bewusst von 'error' getrennt (CR-M1): ein Negativ-Test
 * MUSS ein echtes Reset-Event sehen (`.toBe('error')`) — ein bloßes Hängen (kein Reset) fällt dann als
 * 'timeout' laut durch, statt fälschlich als „kein open" grün zu werden.
 */
function connectOutcome(ws: WsClient, timeoutMs = 2500): Promise<'open' | 'error' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve('open'); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); resolve('error'); }, { once: true });
  });
}

/** Nächste Nachricht eines bestimmten `type` von einem undici-Client (analog waitForType). */
function waitForClientType(ws: WsClient, type: string, timeoutMs = 1500): Promise<Record<string, unknown>> {
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

/** Wartet auf den WS-Close-Code (z.B. 4003). */
function waitForCloseCode(ws: WsClient, timeoutMs = 2500): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: kein close-Frame')), timeoutMs);
    ws.addEventListener(
      'close',
      (ev) => {
        clearTimeout(timer);
        resolve((ev as unknown as { code: number }).code);
      },
      { once: true },
    );
  });
}

// ── §2 Nicht-Loopback: Bindung an eine echte Nicht-Loopback-IPv4 (falls vorhanden). ──
// req.ip = Socket-Peer (kein trustProxy → nicht spoofbar). Auf einem 127.0.0.1-Harness ist req.ip immer
// Loopback; erst eine echte Nicht-Loopback-Bindung treibt den 4003-Reject-Pfad. Auf reinen Loopback-Hosts
// (keine externe IPv4) wird der Test übersprungen (ehrliche Deckungsgrenze) statt falsch grün zu sein.
function findNonLoopbackIpv4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      // Link-Local (169.254.x, APIPA) ausschließen — nicht zuverlässig verbindbar (CR-L3, Flake-Vermeidung).
    if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    }
  }
  return null;
}
const NON_LOOPBACK_IPV4 = findNonLoopbackIpv4();

async function startNonLoopbackHarness(ip: string): Promise<WireHarness> {
  const bus = new MeshEventBus();
  const app = Fastify({ logger: false });
  await registerWebSocket(app, bus);
  await app.listen({ port: 0, host: ip });
  const addr = app.server.address();
  if (addr == null || typeof addr === 'string') throw new Error('kein TCP-Port vom Nicht-Loopback-Harness');
  const harness: WireHarness = { bus, port: addr.port, app, close: async () => { await app.close(); } };
  openHarnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const ws of openSockets.splice(0)) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
  // undici-Agents schließen — sonst halten Keep-Alive-Sockets den Event-Loop offen (Test-Hang).
  for (const a of openAgents.splice(0)) {
    try {
      await a.close();
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

  // ── §2 mTLS-Pflicht (echter cardServer-TLS-Transport + In-Memory-Cert-Fixtures) ──
  it('§2 mTLS: gültiges Client-Cert → /ws über wss erreichbar (system:connected)', async () => {
    const h = await startMtlsWakeWireHarness();
    const ws = openWssClient(h.port, `?subscribe=agent:wake&agent=${q(SPIFFE)}`, {
      ca: h.tls.caPem,
      cert: h.tls.clientCertPem,
      key: h.tls.clientKeyPem,
      servername: 'localhost',
    });
    // Message-Listener VOR dem open-await anhängen (CR-L2): system:connected kommt direkt nach dem
    // 101-Upgrade — sonst latenter Race (Frame vor Listener → 1500ms-Timeout, Flake).
    const connected = waitForClientType(ws, 'system:connected');
    expect(await connectOutcome(ws)).toBe('open');
    const welcome = await connected;
    expect(welcome['type']).toBe('system:connected');
  });

  it('§2 mTLS-Pflicht: Client OHNE Cert → auf TLS-Ebene resettet (kein system:connected)', async () => {
    const h = await startMtlsWakeWireHarness();
    // CA vertraut (Server-Cert validiert), aber KEIN Client-Cert präsentiert → requestCert+rejectUnauthorized reset.
    const ws = openWssClient(h.port, `?subscribe=agent:wake&agent=${q(SPIFFE)}`, {
      ca: h.tls.caPem,
      servername: 'localhost',
    });
    expect(await connectOutcome(ws)).toBe('error');
  });

  it('§2 mTLS-Pflicht: Plaintext ws:// gegen den TLS-Port → TLS-Reset', async () => {
    const h = await startMtlsWakeWireHarness();
    const ws = new WsClient(`ws://127.0.0.1:${h.port}/ws?subscribe=agent:wake`);
    openSockets.push(ws);
    expect(await connectOutcome(ws)).toBe('error');
  });

  // ── §2 Nicht-Loopback → 4003 (echte Nicht-Loopback-Bindung; auf reinen Loopback-Hosts übersprungen) ──
  it.skipIf(NON_LOOPBACK_IPV4 == null)(
    '§2 Nicht-Loopback → Close 4003: agent-Filter von ≠Loopback-req.ip wird abgelehnt',
    async () => {
      const ip = NON_LOOPBACK_IPV4 as string;
      const h = await startNonLoopbackHarness(ip);
      // Connect von/zu einer echten Nicht-Loopback-IPv4 → req.ip ist nicht-Loopback → 4003.
      const ws = new WsClient(`ws://${ip}:${h.port}/ws?subscribe=agent:wake&agent=${q(SPIFFE)}`);
      openSockets.push(ws);
      expect(await waitForCloseCode(ws)).toBe(4003);
    },
  );
});
