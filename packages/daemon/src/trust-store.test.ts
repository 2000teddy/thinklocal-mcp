import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTrustedCaBundle, TrustStoreNotifier } from './trust-store.js';
import { PairingStore, type PairedPeer } from './pairing.js';
import { createMeshCA } from './tls.js';

// Generate real (in-memory) CA certs so the X509Certificate validation in
// buildTrustedCaBundle accepts them. PR #83 (GPT-5.4 retro-review of #75)
// added parse-validation which rejected the old FAKE hardcoded strings.
let FAKE_OWN_CA: string;
let FAKE_PEER1_CA: string;
let FAKE_PEER2_CA: string;

beforeAll(() => {
  FAKE_OWN_CA = createMeshCA('thinklocal', 'testownca00000000').caCertPem;
  FAKE_PEER1_CA = createMeshCA('thinklocal', 'testpeer00000001').caCertPem;
  FAKE_PEER2_CA = createMeshCA('thinklocal', 'testpeer00000002').caCertPem;
});

function makePeer(id: string, caCertPem: string): PairedPeer {
  return {
    agentId: id,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----`,
    caCertPem,
    fingerprint: 'fake-fingerprint-' + id,
    pairedAt: new Date().toISOString(),
    hostname: 'host-' + id,
  };
}

describe('trust-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'thinklocal-trust-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('buildTrustedCaBundle', () => {
    it('enthaelt immer die eigene CA an Position 0', () => {
      const bundle = buildTrustedCaBundle(FAKE_OWN_CA);
      expect(bundle).toHaveLength(1);
      expect(bundle[0]).toBe(FAKE_OWN_CA);
    });

    it('funktioniert ohne PairingStore (frischer Node)', () => {
      const bundle = buildTrustedCaBundle(FAKE_OWN_CA, undefined);
      expect(bundle).toEqual([FAKE_OWN_CA]);
    });

    it('fuegt CAs aller gepairten Peers an', () => {
      const store = new PairingStore(tmpDir);
      store.addPeer(makePeer('peer1', FAKE_PEER1_CA));
      store.addPeer(makePeer('peer2', FAKE_PEER2_CA));

      const bundle = buildTrustedCaBundle(FAKE_OWN_CA, store);
      expect(bundle).toHaveLength(3);
      expect(bundle[0]).toBe(FAKE_OWN_CA);
      expect(bundle).toContain(FAKE_PEER1_CA);
      expect(bundle).toContain(FAKE_PEER2_CA);
    });

    it('ignoriert Peers mit ungueltigem caCertPem (kein BEGIN CERTIFICATE)', () => {
      const store = new PairingStore(tmpDir);
      store.addPeer(makePeer('valid', FAKE_PEER1_CA));
      store.addPeer(makePeer('invalid', 'not-a-pem'));
      store.addPeer(makePeer('empty', ''));

      const bundle = buildTrustedCaBundle(FAKE_OWN_CA, store);
      expect(bundle).toEqual([FAKE_OWN_CA, FAKE_PEER1_CA]);
    });

    it('dedupliziert eigene CA wenn ein Peer zufaellig denselben Text hat', () => {
      // PR #83 (GPT-5.4 retro): buildTrustedCaBundle dedupliziert per SHA-256
      // der PEM-Bytes. Wenn ein Peer dieselbe CA hat wie wir, soll sie nur
      // einmal im Bundle stehen — sonst wird das Bundle unnoetig gross und
      // das Debugging erschwert.
      const store = new PairingStore(tmpDir);
      store.addPeer(makePeer('clone', FAKE_OWN_CA));

      const bundle = buildTrustedCaBundle(FAKE_OWN_CA, store);
      expect(bundle).toHaveLength(1);
      expect(bundle[0]).toBe(FAKE_OWN_CA);
    });
  });

  describe('TrustStoreNotifier', () => {
    it('rebuild() liefert das aktuelle Bundle', () => {
      const store = new PairingStore(tmpDir);
      const notifier = new TrustStoreNotifier(FAKE_OWN_CA, store);

      expect(notifier.current()).toEqual([FAKE_OWN_CA]);

      store.addPeer(makePeer('peer1', FAKE_PEER1_CA));
      const bundle = notifier.rebuild();
      expect(bundle).toEqual([FAKE_OWN_CA, FAKE_PEER1_CA]);
    });

    it('onChange-Listener wird bei rebuild() getriggert', () => {
      const store = new PairingStore(tmpDir);
      const notifier = new TrustStoreNotifier(FAKE_OWN_CA, store);

      const received: string[][] = [];
      notifier.onChange((bundle) => received.push(bundle));

      store.addPeer(makePeer('peer1', FAKE_PEER1_CA));
      notifier.rebuild();

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([FAKE_OWN_CA, FAKE_PEER1_CA]);
    });

    it('mehrere Listener werden alle aufgerufen', () => {
      const store = new PairingStore(tmpDir);
      const notifier = new TrustStoreNotifier(FAKE_OWN_CA, store);

      let calls = 0;
      notifier.onChange(() => calls++);
      notifier.onChange(() => calls++);
      notifier.onChange(() => calls++);

      notifier.rebuild();
      expect(calls).toBe(3);
    });

    it('fehlerhafter Listener bricht die Schleife nicht ab', () => {
      const store = new PairingStore(tmpDir);
      const notifier = new TrustStoreNotifier(FAKE_OWN_CA, store);

      let secondCalled = false;
      notifier.onChange(() => {
        throw new Error('boom');
      });
      notifier.onChange(() => {
        secondCalled = true;
      });

      expect(() => notifier.rebuild()).not.toThrow();
      expect(secondCalled).toBe(true);
    });

    it('current() triggert keine Listener', () => {
      const store = new PairingStore(tmpDir);
      const notifier = new TrustStoreNotifier(FAKE_OWN_CA, store);

      let called = false;
      notifier.onChange(() => (called = true));

      notifier.current();
      expect(called).toBe(false);
    });
  });
});
