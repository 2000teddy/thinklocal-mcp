/**
 * libp2p-autodial.test.ts — Regressionstests fuer ADR-020 Phase 1.1.
 *
 * Bug-Kontext: libp2p v3 dialt nach peer:discovery NICHT automatisch
 * (#onDiscoveryPeer macht nur peerStore.merge). Ohne expliziten Dial
 * bleibt das Mesh stumm und der RegistrySyncCoordinator bekommt nie
 * onPeerConnect — Hashes divergieren stabil.
 *
 * Diese Tests prueft die ActiveLibp2pRuntime-Hilfsmethoden gegen einen
 * Mock-Node:
 * - peer:discovery loest dial() aus
 * - Self-Discovery wird gefiltert
 * - Bereits-verbundene Peers werden nicht erneut gedialt
 * - Doppelte Discovery-Events erzeugen keine duplizierten Dials
 * - dialKnownPeers() iteriert ueber peerStore und dialt nicht-verbundene
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ActiveLibp2pRuntime,
  createInitialLibp2pState,
  extractPeerIdFromConnectionEvent,
  type Libp2pRuntimeConfig,
} from './libp2p-runtime.js';

function makeConfig(): Libp2pRuntimeConfig {
  return {
    enabled: true,
    bindHost: '127.0.0.1',
    listenPort: 9540,
    mdnsServiceTag: 'thinklocal-mcp',
    natTraversalEnabled: false,
    relayTransportEnabled: false,
    relayServiceEnabled: false,
    announceMultiaddrs: [],
  };
}

interface MockNodeOpts {
  /** PeerId, die der Mock-Node selbst hat (fuer Self-Filter-Tests) */
  peerId: string;
  /** Peers, fuer die getConnections nicht-leer zurueckgibt */
  connectedPeerIds?: string[];
  /** Peers, die peerStore.all() liefert */
  knownPeers?: Array<{ id: { toString(): string } }>;
}

function makeMockNode(opts: MockNodeOpts) {
  const listeners = new Map<string, Array<(evt: any) => void>>();
  const dialed: string[] = [];
  const connectedSet = new Set(opts.connectedPeerIds ?? []);

  const node = {
    peerId: { toString: () => opts.peerId },
    getMultiaddrs: () => [],
    addEventListener: (event: string, cb: (evt: any) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    },
    dial: vi.fn(async (peerIdObj: { toString(): string }) => {
      dialed.push(peerIdObj.toString());
      return undefined;
    }),
    getConnections: (peerIdObj?: { toString(): string }) => {
      if (!peerIdObj) return [];
      return connectedSet.has(peerIdObj.toString()) ? [{ id: peerIdObj }] : [];
    },
    handle: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    peerStore: {
      all: vi.fn(async () => opts.knownPeers ?? []),
    },
  };

  const fireDiscovery = (peerIdStr: string) => {
    const peerIdObj = { toString: () => peerIdStr };
    const cbs = listeners.get('peer:discovery') ?? [];
    for (const cb of cbs) cb({ detail: { id: peerIdObj, multiaddrs: [] } });
  };

  return { node, dialed, fireDiscovery, listeners };
}

function makeRuntime(node: any) {
  const config = makeConfig();
  const initialState = createInitialLibp2pState(config);
  const deps = {
    createLibp2p: vi.fn(async () => node),
    identify: () => ({}),
    mdns: () => ({}),
    noise: () => ({}),
    ping: () => ({}),
    tcp: () => ({}),
    yamux: () => ({}),
  };
  return new ActiveLibp2pRuntime(initialState, config, deps);
}

describe('ADR-020 Phase 1.1: extractPeerIdFromConnectionEvent (HIGH-Finding)', () => {
  // Regression fuer HIGH-Finding aus pal:codereview gpt-5.5:
  // libp2p peer:connect liefert detail als Connection-Objekt, dessen
  // generisches toString() "[object Object]" zurueckgibt. Naive
  // detail.toString() bekommt also einen Garbage-Key. Der Fix bevorzugt
  // detail.remotePeer.
  it('extrahiert remotePeer aus Connection-Event (libp2p v2/v3 Shape)', () => {
    const evt = {
      detail: {
        // Connection-Objekt mit generic toString
        toString: () => '[object Object]',
        remotePeer: { toString: () => 'real-peer-id' },
      },
    };
    expect(extractPeerIdFromConnectionEvent(evt)).toBe('real-peer-id');
  });

  it('akzeptiert detail als plain string (legacy Variante)', () => {
    expect(extractPeerIdFromConnectionEvent({ detail: 'plain-peer-id' })).toBe('plain-peer-id');
  });

  it('akzeptiert detail-Objekt mit sinnvoller toString (PeerId direkt)', () => {
    const evt = { detail: { toString: () => 'direct-peer-id' } };
    expect(extractPeerIdFromConnectionEvent(evt)).toBe('direct-peer-id');
  });

  it('lehnt generic [object Object] ab und liefert null', () => {
    const evt = { detail: { toString: () => '[object Object]' } };
    expect(extractPeerIdFromConnectionEvent(evt)).toBeNull();
  });

  it('toleriert null/undefined detail', () => {
    expect(extractPeerIdFromConnectionEvent({})).toBeNull();
    expect(extractPeerIdFromConnectionEvent({ detail: null })).toBeNull();
    expect(extractPeerIdFromConnectionEvent(null)).toBeNull();
  });

  it('greift auf detail.connection.remotePeer zurueck (alternative Shape)', () => {
    const evt = {
      detail: {
        toString: () => '[object Object]',
        connection: { remotePeer: { toString: () => 'nested-peer-id' } },
      },
    };
    expect(extractPeerIdFromConnectionEvent(evt)).toBe('nested-peer-id');
  });
});

describe('ADR-020 Phase 1.1: libp2p peer:discovery → auto-dial', () => {
  let mockNode: ReturnType<typeof makeMockNode>;
  let runtime: ActiveLibp2pRuntime;

  beforeEach(async () => {
    mockNode = makeMockNode({ peerId: 'self-peer' });
    runtime = makeRuntime(mockNode.node);
    await runtime.start();
  });

  it('dialt einen via peer:discovery entdeckten fremden Peer', async () => {
    mockNode.fireDiscovery('remote-peer-A');
    // Promise-Microtask-Queue flushen
    await new Promise((r) => setImmediate(r));
    expect(mockNode.dialed).toEqual(['remote-peer-A']);
    expect(mockNode.node.dial).toHaveBeenCalledTimes(1);
  });

  it('filtert Self-Discovery (eigene peerId wird nicht gedialt)', async () => {
    mockNode.fireDiscovery('self-peer');
    await new Promise((r) => setImmediate(r));
    expect(mockNode.dialed).toEqual([]);
    expect(mockNode.node.dial).not.toHaveBeenCalled();
  });

  it('dedupliziert mehrere peer:discovery-Events fuer denselben Peer (in-flight)', async () => {
    // Dial wird gleich aufgerufen, aber Promise resolved erst nach Mikrotask.
    // Innerhalb derselben Tick-Phase mehrere Events feuern → nur 1 Dial.
    mockNode.fireDiscovery('remote-peer-B');
    mockNode.fireDiscovery('remote-peer-B');
    mockNode.fireDiscovery('remote-peer-B');
    await new Promise((r) => setImmediate(r));
    expect(mockNode.node.dial).toHaveBeenCalledTimes(1);
  });

  it('dialt einen Peer nicht, der bereits eine offene Connection hat', async () => {
    // Mock-Node mit bereits verbundenem Peer
    const m = makeMockNode({ peerId: 'self', connectedPeerIds: ['remote-already-connected'] });
    const r = makeRuntime(m.node);
    await r.start();
    m.fireDiscovery('remote-already-connected');
    await new Promise((res) => setImmediate(res));
    expect(m.node.dial).not.toHaveBeenCalled();
  });

  it('dialKnownPeers iteriert ueber peerStore.all() und dialt nicht-verbundene Peers beim Start', async () => {
    const m = makeMockNode({
      peerId: 'self',
      knownPeers: [
        { id: { toString: () => 'stored-peer-1' } },
        { id: { toString: () => 'stored-peer-2' } },
      ],
    });
    const r = makeRuntime(m.node);
    await r.start();
    // start() ruft dialKnownPeers; Mikrotask-Queue flushen fuer .catch/.finally
    await new Promise((res) => setImmediate(res));
    expect(m.dialed.sort()).toEqual(['stored-peer-1', 'stored-peer-2']);
  });

  it('toleriert peerStore-API-Inkompatibilitaet (peerStore ohne all() crasht nicht)', async () => {
    const m = makeMockNode({ peerId: 'self' });
    // peerStore.all entfernen → defensive Fallback-Pfad
    delete (m.node.peerStore as any).all;
    const r = makeRuntime(m.node);
    await expect(r.start()).resolves.toBeUndefined();
  });

  it('stop() blockiert weitere Auto-Dials und leert dialingPeers (MEDIUM-Finding)', async () => {
    const m = makeMockNode({ peerId: 'self' });
    // Dial haengt — simuliert hangenden libp2p-Dial
    m.node.dial = vi.fn(() => new Promise(() => {}));
    const r = makeRuntime(m.node);
    await r.start();
    m.fireDiscovery('peer-A');
    expect(m.node.dial).toHaveBeenCalledTimes(1);
    await r.stop();
    // Nach stop: weitere Discovery-Events duerfen nicht mehr dialen
    m.fireDiscovery('peer-B');
    expect(m.node.dial).toHaveBeenCalledTimes(1); // immer noch 1
  });

  it('catches dial-Fehler still ohne Promise-Rejection', async () => {
    const m = makeMockNode({ peerId: 'self' });
    m.node.dial = vi.fn(async () => {
      throw new Error('peer offline');
    });
    const r = makeRuntime(m.node);
    await r.start();
    m.fireDiscovery('unreachable-peer');
    // Wenn der Fehler ungefangen waere, wuerde Vitest hier komplain.
    await new Promise((res) => setImmediate(res));
    expect(m.node.dial).toHaveBeenCalledTimes(1);
  });
});
