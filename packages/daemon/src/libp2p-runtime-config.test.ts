/**
 * libp2p-runtime-config.test.ts — Regressionstests fuer ADR-020 Phase 1.1
 * Bug-Report #3 (Live-Befund 2026-05-19).
 *
 * Bug: libp2p v2+ benutzt `connectionEncrypters` (Plural mit -ers), NICHT
 * `connectionEncryption`. Der alte Key wurde silent ignoriert → kein Noise
 * im Config → jeder Dial scheiterte mit `EncryptionFailedError`.
 *
 * Diese Tests fangen das Pattern fuer alle Zukunft: wenn jemand den falschen
 * Key in der Daemon-Konfig setzt, schlagen sie an.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActiveLibp2pRuntime, createInitialLibp2pState, type Libp2pRuntimeConfig } from './libp2p-runtime.js';

const RUNTIME_SOURCE = readFileSync(
  resolve(__dirname, 'libp2p-runtime.ts'),
  'utf-8',
);

describe('Bug #3 Regression: libp2p config keys', () => {
  it('libp2p-runtime.ts verwendet `connectionEncrypters` (libp2p v2+ Key)', () => {
    expect(RUNTIME_SOURCE).toMatch(/connectionEncrypters:\s*\[/);
  });

  it('libp2p-runtime.ts verwendet NICHT mehr `connectionEncryption:` (libp2p v1 Key, silent ignored)', () => {
    // Wir erlauben das Wort im Kommentar/JSDoc, aber nicht als Objekt-Key.
    // Pattern matcht "connectionEncryption:" gefolgt von "[" (Array-Wert).
    expect(RUNTIME_SOURCE).not.toMatch(/^\s*connectionEncryption:\s*\[/m);
  });

  it('streamMuxers Key bleibt korrekt', () => {
    expect(RUNTIME_SOURCE).toMatch(/streamMuxers:\s*\[/);
  });
});

describe('Bug #3 Regression: createLibp2p wird mit connectionEncrypters aufgerufen', () => {
  it('Die Runtime injiziert noise via connectionEncrypters in die createLibp2p-Optionen', async () => {
    let capturedOptions: any = null;
    const fakeNode = {
      peerId: { toString: () => 'self' },
      getMultiaddrs: () => [],
      addEventListener: () => {},
      handle: () => {},
      start: () => {},
      stop: () => {},
      peerStore: {},
    };
    const config: Libp2pRuntimeConfig = {
      enabled: true,
      bindHost: '127.0.0.1',
      listenPort: 9540,
      mdnsServiceTag: 'test',
      natTraversalEnabled: false,
      relayTransportEnabled: false,
      relayServiceEnabled: false,
      announceMultiaddrs: [],
    };
    const noiseToken = Symbol('noise');
    const runtime = new ActiveLibp2pRuntime(
      createInitialLibp2pState(config),
      config,
      {
        createLibp2p: async (opts: Record<string, unknown>) => {
          capturedOptions = opts;
          return fakeNode;
        },
        identify: () => ({}),
        mdns: () => ({}),
        noise: () => noiseToken,
        ping: () => ({}),
        tcp: () => ({}),
        yamux: () => ({}),
      },
    );
    await runtime.start();

    expect(capturedOptions).toBeTruthy();
    expect(capturedOptions.connectionEncrypters).toBeDefined();
    expect(Array.isArray(capturedOptions.connectionEncrypters)).toBe(true);
    expect(capturedOptions.connectionEncrypters).toContain(noiseToken);
    // Sicherstellen dass der alte Key NICHT (mehr) gesetzt ist
    expect(capturedOptions.connectionEncryption).toBeUndefined();
  });
});
