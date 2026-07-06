// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, expect, it } from 'vitest';
import {
  ActiveLibp2pRuntime,
  createInitialLibp2pState,
  getLibp2pListenMultiaddrs,
  getLibp2pProtocolList,
  resolveNatReachability,
  resolveLibp2pEnabled,
  resolveLibp2pListenPort,
  resolveLibp2pMdnsEnabled,
} from './libp2p-runtime.js';

describe('libp2p-runtime', () => {
  it('leitet IPv4 multiaddr aus bind host und port ab', () => {
    expect(getLibp2pListenMultiaddrs('0.0.0.0', 9540)).toEqual(['/ip4/0.0.0.0/tcp/9540']);
    expect(getLibp2pListenMultiaddrs('127.0.0.1', 9541)).toEqual(['/ip4/127.0.0.1/tcp/9541']);
  });

  it('liefert disabled state wenn libp2p abgeschaltet ist', () => {
    const state = createInitialLibp2pState({
      enabled: false,
      bindHost: '127.0.0.1',
      listenPort: 9540,
      mdnsServiceTag: 'thinklocal-mcp',
      natTraversalEnabled: false,
      relayTransportEnabled: false,
      relayServiceEnabled: false,
      announceMultiaddrs: [],
    });

    expect(state.enabled).toBe(false);
    expect(state.status).toBe('disabled');
    expect(state.reason).toContain('disabled');
  });

  it('liefert degradierten bootstrap state wenn libp2p aktiviert ist', () => {
    const state = createInitialLibp2pState({
      enabled: true,
      bindHost: '0.0.0.0',
      listenPort: 9540,
      mdnsServiceTag: 'thinklocal-mcp',
      natTraversalEnabled: true,
      relayTransportEnabled: true,
      relayServiceEnabled: false,
      announceMultiaddrs: [],
    });

    expect(state.enabled).toBe(true);
    expect(state.status).toBe('degraded');
    expect(state.noise).toBe(true);
    expect(state.mdns).toBe(true);
    expect(state.listenMultiaddrs).toEqual(['/ip4/0.0.0.0/tcp/9540']);
    expect(state.multiplexer.enabled).toBe(true);
    expect(state.multiplexer.name).toBe('yamux');
    expect(state.multiplexer.protocols).toEqual(getLibp2pProtocolList());
    expect(state.multiplexer.openStreams).toBe(0);
    expect(state.nat.enabled).toBe(true);
    expect(state.nat.strategy).toBe('hybrid');
  });

  it('resolveLibp2pMdnsEnabled: default an, bei disableMdnsInterfacePin aus (.55-Fix)', () => {
    expect(resolveLibp2pMdnsEnabled({})).toBe(true);
    expect(resolveLibp2pMdnsEnabled({ disableMdnsInterfacePin: false })).toBe(true);
    expect(resolveLibp2pMdnsEnabled({ disableMdnsInterfacePin: true })).toBe(false);
  });

  it('resolveLibp2pMdnsEnabled: ADR-025 mdnsEnabled=false schaltet auch libp2p-mDNS aus', () => {
    expect(resolveLibp2pMdnsEnabled({ mdnsEnabled: true })).toBe(true);
    expect(resolveLibp2pMdnsEnabled({ mdnsEnabled: undefined })).toBe(true);
    expect(resolveLibp2pMdnsEnabled({ mdnsEnabled: false })).toBe(false);
    // beide Quellen kombiniert: eine reicht zum Abschalten
    expect(resolveLibp2pMdnsEnabled({ disableMdnsInterfacePin: false, mdnsEnabled: false })).toBe(false);
  });

  it('createInitialLibp2pState meldet mdns:false wenn disableMdnsInterfacePin (.55-Fix)', () => {
    const state = createInitialLibp2pState({
      enabled: true,
      bindHost: '0.0.0.0',
      listenPort: 9540,
      mdnsServiceTag: 'thinklocal-mcp',
      natTraversalEnabled: true,
      relayTransportEnabled: true,
      relayServiceEnabled: false,
      announceMultiaddrs: [],
      disableMdnsInterfacePin: true,
    });
    expect(state.mdns).toBe(false);
    // libp2p selbst bleibt aktiv (degraded bootstrap) — nur die mDNS-Discovery ist aus.
    expect(state.enabled).toBe(true);
    expect(state.noise).toBe(true);
  });

  it('aktiviert libp2p standardmaessig nur im lan mode', () => {
    expect(resolveLibp2pEnabled({ runtimeMode: 'local' })).toBe(false);
    expect(resolveLibp2pEnabled({ runtimeMode: 'lan' })).toBe(true);
    expect(resolveLibp2pEnabled({ runtimeMode: 'local', explicitEnvOverride: '1' })).toBe(true);
  });

  it('leitet den Listen-Port von daemon.port ab wenn nichts explizit gesetzt ist', () => {
    expect(resolveLibp2pListenPort({
      daemonPort: 9440,
      configuredPort: 9540,
      explicitPortConfigured: false,
    })).toBe(9540);
    expect(resolveLibp2pListenPort({
      daemonPort: 9442,
      configuredPort: 9540,
      explicitPortConfigured: false,
    })).toBe(9542);
    expect(resolveLibp2pListenPort({
      daemonPort: 9442,
      configuredPort: 9777,
      explicitPortConfigured: true,
    })).toBe(9777);
  });

  it('enthaelt definierte logische Protokollkanaele fuer Multiplexing', () => {
    expect(getLibp2pProtocolList()).toEqual([
      '/thinklocal/mesh/heartbeat/1.0.0',
      '/thinklocal/mesh/registry/1.0.0',
      '/thinklocal/mesh/tasks/1.0.0',
      '/thinklocal/mesh/audit/1.0.0',
    ]);
  });

  it('klassifiziert relay und public reachability korrekt', () => {
    expect(resolveNatReachability({
      enabled: true,
      announceMultiaddrs: ['/ip4/203.0.113.5/tcp/9540'],
      observedMultiaddrs: [],
      relayTransport: true,
    })).toBe('public');
    expect(resolveNatReachability({
      enabled: true,
      announceMultiaddrs: ['/ip4/10.0.0.5/tcp/9540/p2p-circuit'],
      observedMultiaddrs: [],
      relayTransport: true,
    })).toBe('relay');
    expect(resolveNatReachability({
      enabled: true,
      announceMultiaddrs: ['/ip4/10.0.0.5/tcp/9540'],
      observedMultiaddrs: [],
      relayTransport: true,
    })).toBe('private');
  });
});

describe('ActiveLibp2pRuntime.dialProtocol/hangUpPeer — PeerId-Objekt statt String (getPeerId-Drift-Fix)', () => {
  const cfg = {
    enabled: true, bindHost: '0.0.0.0', listenPort: 9540, mdnsServiceTag: 'thinklocal-mcp',
    natTraversalEnabled: false, relayTransportEnabled: false, relayServiceEnabled: false, announceMultiaddrs: [],
  };
  const PID = '12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb';

  function rtWithStubNode() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = new ActiveLibp2pRuntime(createInitialLibp2pState(cfg as any), cfg as any, {} as any);
    const calls: { dial?: unknown; hangup?: unknown } = {};
    (rt as unknown as { node: unknown }).node = {
      dialProtocol: async (peer: unknown) => {
        calls.dial = peer;
        return { source: [], sink: async () => {}, close: async () => {}, abort: () => {} };
      },
      hangUp: async (peer: unknown) => { calls.hangup = peer; },
    };
    return { rt, calls };
  }

  it('dialProtocol übergibt ein PeerId-OBJEKT (kein String), das auf die Eingabe round-trippt + PeerId-Shape hat', async () => {
    const { rt, calls } = rtWithStubNode();
    await rt.dialProtocol(PID, '/thinklocal/mesh/registry/1.0.0');
    expect(typeof calls.dial).not.toBe('string');
    expect((calls.dial as { toString(): string }).toString()).toBe(PID);
    // echte libp2p-PeerId-API (nicht nur ein String-Wrapper):
    expect(typeof (calls.dial as { toCID?: unknown }).toCID).toBe('function');
  });

  it('dialProtocol wirft bei ungültiger PeerID mit Kontext (kein kryptischer getPeerId-TypeError)', async () => {
    const { rt } = rtWithStubNode();
    await expect(rt.dialProtocol('not-a-valid-peerid', '/x')).rejects.toThrow(/ungültige PeerID 'not-a-valid-peerid'/);
  });

  it('hangUpPeer übergibt ebenfalls ein PeerId-OBJEKT (kein String)', async () => {
    const { rt, calls } = rtWithStubNode();
    await rt.hangUpPeer(PID);
    expect(typeof calls.hangup).not.toBe('string');
    expect((calls.hangup as { toString(): string }).toString()).toBe(PID);
  });
});

// B7-Repro: nagelt den ORIGINAL-Fehlermodus `multiaddrs[0].getPeerId is not a function` fest und
// belegt, dass der Fix (String→PeerId via toPeerId) ihn verhindert. Der Mock-Node bildet das
// libp2p-v2-Verhalten nach: ein nackter STRING wird intern als Multiaddr behandelt → `.getPeerId()`
// auf einem Nicht-Multiaddr → exakt jener TypeError; ein echtes PeerId-Objekt (hat `.toCID`) wird
// akzeptiert. So ist der Regressionstest an die reale Fehlersignatur gebunden, nicht nur ans
// Soll-Verhalten.
describe('ActiveLibp2pRuntime — B7-Repro: getPeerId-TypeError-Failure-Mode (Capability-Count-Drift)', () => {
  const cfg = {
    enabled: true, bindHost: '0.0.0.0', listenPort: 9540, mdnsServiceTag: 'thinklocal-mcp',
    natTraversalEnabled: false, relayTransportEnabled: false, relayServiceEnabled: false, announceMultiaddrs: [],
  };
  const PID = '12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb';

  // libp2p-v2-ähnlicher dialProtocol: String → Multiaddr-Pfad → `multiaddrs[0].getPeerId()` (TypeError).
  function libp2pV2LikeDial(peer: unknown): unknown {
    const isPeerIdObject =
      peer !== null && typeof peer === 'object' && typeof (peer as { toCID?: unknown }).toCID === 'function';
    if (!isPeerIdObject) {
      const multiaddrs = [peer]; // libp2p behandelt den String als Multiaddr-artig
      // genau hier entstand der Produktiv-Fehler: .getPeerId existiert auf dem Nicht-Multiaddr nicht.
      return (multiaddrs[0] as unknown as { getPeerId: () => unknown }).getPeerId();
    }
    return { source: [], sink: async () => {}, close: async () => {}, abort: () => {} };
  }

  it('REPRO: ein nackter String löst exakt `getPeerId is not a function` aus (Original-Bug)', () => {
    expect(() => libp2pV2LikeDial(PID)).toThrow(/getPeerId is not a function/);
  });

  it('FIX: rt.dialProtocol speist den libp2p-v2-Mock mit einem PeerId-Objekt → KEIN getPeerId-TypeError', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = new ActiveLibp2pRuntime(createInitialLibp2pState(cfg as any), cfg as any, {} as any);
    let dialed: unknown;
    (rt as unknown as { node: unknown }).node = {
      dialProtocol: async (peer: unknown) => {
        dialed = peer;
        return libp2pV2LikeDial(peer); // wirft NUR, wenn peer ein String wäre
      },
      hangUp: async () => {},
    };
    // Mit dem Fix (toPeerId) erreicht den Mock ein PeerId-Objekt → der getPeerId-Pfad wird nie betreten.
    await expect(rt.dialProtocol(PID, '/thinklocal/mesh/registry/1.0.0')).resolves.toBeDefined();
    expect(typeof dialed).not.toBe('string');
    expect(typeof (dialed as { toCID?: unknown }).toCID).toBe('function');
  });

  it('FIX: hangUpPeer speist den Mock ebenfalls mit PeerId-Objekt → kein getPeerId-TypeError', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = new ActiveLibp2pRuntime(createInitialLibp2pState(cfg as any), cfg as any, {} as any);
    let hungUp: unknown;
    (rt as unknown as { node: unknown }).node = {
      hangUp: async (peer: unknown) => {
        hungUp = peer;
        // dieselbe libp2p-v2-Mimik: String würde getPeerId triggern.
        if (!(peer !== null && typeof peer === 'object' && typeof (peer as { toCID?: unknown }).toCID === 'function')) {
          ([peer] as unknown as { getPeerId: () => unknown }[])[0].getPeerId();
        }
      },
    };
    await expect(rt.hangUpPeer(PID)).resolves.toBeUndefined();
    expect(typeof hungUp).not.toBe('string');
  });
});
