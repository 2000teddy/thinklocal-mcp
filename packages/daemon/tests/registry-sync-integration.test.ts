import { describe, it, expect, afterEach } from 'vitest';
import { wireRegistrySync } from '../src/registry-sync-libp2p-adapter.js';
import { CapabilityRegistry, type Capability } from '../src/registry.js';
import {
  LIBP2P_PROTOCOLS,
  type Libp2pRuntime,
  type Libp2pStreamLike,
  type Libp2pProtocolHandler,
  type Libp2pPeerEvents,
  type Libp2pRuntimeState,
} from '../src/libp2p-runtime.js';

/**
 * Mock-Libp2p-Runtime: emuliert dialProtocol + Stream-Plumbing. Wenn Node A
 * dialProtocol(B, ...) aufruft, wird der Frame an Bs registrierten
 * Protocol-Handler weitergereicht. So testen wir den vollen Wiring-Stack
 * (Coordinator + Adapter + Protocol-Handler) ohne echtes libp2p.
 */
class MockLibp2pNode {
  private handlers = new Map<string, Libp2pProtocolHandler>();
  private events: Libp2pPeerEvents = {};
  public hungUpPeers: string[] = [];
  public connectedTo = new Set<string>();
  /** Peer-Verzeichnis (von außen gepflegt) */
  public peerNodes = new Map<string, MockLibp2pNode>();

  setHandlers(handlers: Record<string, Libp2pProtocolHandler>, events: Libp2pPeerEvents): void {
    for (const [proto, fn] of Object.entries(handlers)) this.handlers.set(proto, fn);
    this.events = events;
  }

  async dialProtocol(peerId: string, protocol: string): Promise<Libp2pStreamLike> {
    const remote = this.peerNodes.get(peerId);
    if (!remote) throw new Error(`peer ${peerId} not reachable`);
    const handler = remote.handlers.get(protocol);
    if (!handler) throw new Error(`peer ${peerId} has no handler for ${protocol}`);

    // Stream: source = vom Caller geschriebene Frames, sink = consumer
    let sinkFrames: Uint8Array[] = [];
    let sinkResolve!: () => void;
    let sinkDone = false;
    const sinkComplete = new Promise<void>((r) => { sinkResolve = r; });

    const stream: Libp2pStreamLike = {
      source: (async function* () {
        await sinkComplete;
        for (const frame of sinkFrames) yield frame;
      })(),
      sink: async (src) => {
        for await (const chunk of src) sinkFrames.push(chunk);
        sinkDone = true;
        sinkResolve();
      },
      close: async () => {
        if (!sinkDone) sinkResolve();
      },
      abort: () => {
        if (!sinkDone) sinkResolve();
      },
    };

    // Remote-Handler bekommt die peerId, die der REMOTE-Node fuer UNS hat
    // (nicht die ID, die wir fuer ihn haben — das ist die Richtungs-Falle).
    let myIdOnRemote = 'unknown';
    for (const [id, node] of remote.peerNodes.entries()) {
      if (node === this) {
        myIdOnRemote = id;
        break;
      }
    }
    handler(stream, myIdOnRemote).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('mock remote handler threw:', err);
    });

    return stream;
  }

  async hangUp(peerId: string): Promise<void> {
    this.hungUpPeers.push(peerId);
    this.connectedTo.delete(peerId);
  }

  /** Test-Helper: triggert peer:connect Hook auf der lokalen Seite. */
  emitPeerConnect(peerId: string): void {
    this.connectedTo.add(peerId);
    this.events.onPeerConnect?.(peerId);
  }

  emitPeerDisconnect(peerId: string): void {
    this.connectedTo.delete(peerId);
    this.events.onPeerDisconnect?.(peerId);
  }

}

function makeRuntime(node: MockLibp2pNode): Libp2pRuntime {
  const state: Libp2pRuntimeState = {
    enabled: true,
    available: true,
    status: 'ready',
    peerId: 'mock',
    listenMultiaddrs: [],
    connectedPeers: 0,
    noise: true,
    mdns: false,
    multiplexer: { enabled: true, name: 'yamux', protocols: [], openStreams: 0, streamsByProtocol: {} },
    nat: {
      enabled: false,
      reachability: 'unknown',
      strategy: 'disabled',
      autoNAT: false,
      relayTransport: false,
      relayService: false,
      holePunching: false,
      observedMultiaddrs: [],
      announceMultiaddrs: [],
      relayReservations: 0,
      reason: null,
    },
    reason: null,
  };
  return {
    start: async () => undefined,
    stop: async () => undefined,
    getState: () => state,
    dialProtocol: (peerId, protocol) => node.dialProtocol(peerId, protocol),
    hangUpPeer: (peerId) => node.hangUp(peerId),
    getConnectedPeerIds: () => Array.from(node.connectedTo),
  };
}

function cap(agentId: string, skillId: string): Capability {
  return {
    skill_id: skillId,
    version: '1.0.0',
    description: skillId,
    agent_id: agentId,
    health: 'healthy',
    trust_level: 3,
    updated_at: '2026-05-18T12:00:00Z',
    category: 'test',
    permissions: [],
  };
}

describe('RegistrySync Integration (Coordinator + Adapter + Mock-libp2p)', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });

  it('zwei Nodes konvergieren via vollem Wiring-Stack', async () => {
    const regA = new CapabilityRegistry();
    const regB = new CapabilityRegistry();
    regA.register(cap('agentA', 'capA'));
    regB.register(cap('agentB', 'capB'));

    const nodeA = new MockLibp2pNode();
    const nodeB = new MockLibp2pNode();
    nodeA.peerNodes.set('peerB', nodeB);
    nodeB.peerNodes.set('peerA', nodeA);

    const syncA = wireRegistrySync({ registry: regA, intervalMs: 200, roundTimeoutMs: 1_000 });
    const syncB = wireRegistrySync({ registry: regB, intervalMs: 200, roundTimeoutMs: 1_000 });
    nodeA.setHandlers(syncA.protocolHandlers, syncA.peerEvents);
    nodeB.setHandlers(syncB.protocolHandlers, syncB.peerEvents);
    syncA.setRuntime(makeRuntime(nodeA));
    syncB.setRuntime(makeRuntime(nodeB));

    cleanup.push(() => syncA.coordinator.stop());
    cleanup.push(() => syncB.coordinator.stop());

    // peer:connect von beiden Seiten triggern
    nodeA.emitPeerConnect('peerB');
    nodeB.emitPeerConnect('peerA');

    // Poll bis konvergiert (max 5s)
    const deadline = Date.now() + 5_000;
    let converged = false;
    while (Date.now() < deadline && !converged) {
      await new Promise((r) => setTimeout(r, 50));
      const hashA = regA.hashCapabilities(regA.getAllCapabilities());
      const hashB = regB.hashCapabilities(regB.getAllCapabilities());
      const lenA = regA.getAllCapabilities().length;
      const lenB = regB.getAllCapabilities().length;
      converged = hashA === hashB && lenA === 2 && lenB === 2;
    }
    expect(converged, `A=${regA.getAllCapabilities().map(c => c.skill_id).join(',')} B=${regB.getAllCapabilities().map(c => c.skill_id).join(',')}`).toBe(true);
  });

  it('3-Node Partition A vs {B,C}: B und C konvergieren, A nicht', async () => {
    const regA = new CapabilityRegistry();
    const regB = new CapabilityRegistry();
    const regC = new CapabilityRegistry();
    regA.register(cap('agentA', 'capA'));
    regB.register(cap('agentB', 'capB'));
    regC.register(cap('agentC', 'capC'));

    const nA = new MockLibp2pNode();
    const nB = new MockLibp2pNode();
    const nC = new MockLibp2pNode();
    // Partition: A nur mit sich, B+C verbunden
    nB.peerNodes.set('peerC', nC);
    nC.peerNodes.set('peerB', nB);

    const sA = wireRegistrySync({ registry: regA, intervalMs: 200, roundTimeoutMs: 500 });
    const sB = wireRegistrySync({ registry: regB, intervalMs: 200, roundTimeoutMs: 500 });
    const sC = wireRegistrySync({ registry: regC, intervalMs: 200, roundTimeoutMs: 500 });
    nA.setHandlers(sA.protocolHandlers, sA.peerEvents);
    nB.setHandlers(sB.protocolHandlers, sB.peerEvents);
    nC.setHandlers(sC.protocolHandlers, sC.peerEvents);
    sA.setRuntime(makeRuntime(nA));
    sB.setRuntime(makeRuntime(nB));
    sC.setRuntime(makeRuntime(nC));
    cleanup.push(() => sA.coordinator.stop());
    cleanup.push(() => sB.coordinator.stop());
    cleanup.push(() => sC.coordinator.stop());

    nB.emitPeerConnect('peerC');
    nC.emitPeerConnect('peerB');

    // B+C konvergieren (jeweils 2 caps)
    const deadline = Date.now() + 5_000;
    let bcConverged = false;
    while (Date.now() < deadline && !bcConverged) {
      await new Promise((r) => setTimeout(r, 50));
      const hashB = regB.hashCapabilities(regB.getAllCapabilities());
      const hashC = regC.hashCapabilities(regC.getAllCapabilities());
      bcConverged = hashB === hashC && regB.getAllCapabilities().length === 2;
    }
    expect(bcConverged).toBe(true);

    // A bleibt bei nur seiner capA (partitioniert)
    expect(regA.getAllCapabilities().length).toBe(1);
    expect(regA.getAllCapabilities()[0].skill_id).toBe('capA');
    // A hat einen anderen Hash als {B,C}
    expect(regA.hashCapabilities(regA.getAllCapabilities())).not.toBe(
      regB.hashCapabilities(regB.getAllCapabilities()),
    );
  });
});
