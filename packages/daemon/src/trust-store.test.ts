import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTrustedCaBundle, TrustStoreNotifier } from './trust-store.js';
import { PairingStore, type PairedPeer } from './pairing.js';

const FAKE_OWN_CA = `-----BEGIN CERTIFICATE-----
MIIBdzCCAR2gAwIBAgIUOWN_FAKE_OWN_CA_FAKE_OWN_CA_FAKE_Cw
-----END CERTIFICATE-----`;

const FAKE_PEER1_CA = `-----BEGIN CERTIFICATE-----
MIIBdzCCAR2gAwIBAgIUFAKE_PEER_ONE_FAKE_PEER_ONE_FAKE_00
-----END CERTIFICATE-----`;

const FAKE_PEER2_CA = `-----BEGIN CERTIFICATE-----
MIIBdzCCAR2gAwIBAgIUFAKE_PEER_TWO_FAKE_PEER_TWO_FAKE_00
-----END CERTIFICATE-----`;

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

    it('eigene CA wird nicht dedupliziert wenn ein Peer zufaellig denselben Text hat', () => {
      // Edge case: wenn die own CA identisch ist mit einer Peer CA,
      // taucht sie zweimal auf. Das ist OK — Node's tls.ca akzeptiert Duplikate.
      const store = new PairingStore(tmpDir);
      store.addPeer(makePeer('clone', FAKE_OWN_CA));

      const bundle = buildTrustedCaBundle(FAKE_OWN_CA, store);
      expect(bundle).toHaveLength(2);
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
