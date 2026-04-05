import { describe, expect, it } from 'vitest';
import {
  createInitialLibp2pState,
  getLibp2pListenMultiaddrs,
  getLibp2pProtocolList,
  resolveLibp2pEnabled,
  resolveLibp2pListenPort,
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
});
