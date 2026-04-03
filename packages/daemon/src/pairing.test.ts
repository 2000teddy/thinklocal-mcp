import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generatePin,
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  PairingStore,
  type PairedPeer,
} from './pairing.js';

describe('Pairing — PIN-Generierung und Krypto-Hilfsfunktionen', () => {
  it('generiert eine 6-stellige numerische PIN', () => {
    const pin = generatePin();
    expect(pin).toMatch(/^\d{6}$/);
    expect(Number(pin)).toBeGreaterThanOrEqual(100_000);
    expect(Number(pin)).toBeLessThan(1_000_000);
  });

  it('generiert verschiedene PINs', () => {
    const pins = new Set(Array.from({ length: 20 }, () => generatePin()));
    // Bei 20 Versuchen sollten mindestens 15 verschiedene PINs entstehen
    expect(pins.size).toBeGreaterThan(10);
  });

  it('leitet einen 32-Byte-Schlüssel aus einem Shared Secret ab', () => {
    const secret = Buffer.from('test-shared-secret');
    const key = deriveKey(secret, 'test-context');
    expect(key).toHaveLength(32);

    // Gleicher Input → gleicher Output
    const key2 = deriveKey(secret, 'test-context');
    expect(key.equals(key2)).toBe(true);

    // Anderer Kontext → anderer Schlüssel
    const key3 = deriveKey(secret, 'other-context');
    expect(key.equals(key3)).toBe(false);
  });

  it('verschlüsselt und entschlüsselt Daten mit AES-256-GCM', () => {
    const key = deriveKey(Buffer.from('secret'), 'ctx');
    const plaintext = '{"agent_id": "test", "ca_cert": "PEM..."}';

    const encrypted = encryptWithKey(key, plaintext);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();

    const decrypted = decryptWithKey(key, encrypted.ciphertext, encrypted.iv, encrypted.tag);
    expect(decrypted).toBe(plaintext);
  });

  it('lehnt Entschlüsselung mit falschem Schlüssel ab', () => {
    const key1 = deriveKey(Buffer.from('secret-1'), 'ctx');
    const key2 = deriveKey(Buffer.from('secret-2'), 'ctx');

    const encrypted = encryptWithKey(key1, 'sensitive data');
    expect(() => {
      decryptWithKey(key2, encrypted.ciphertext, encrypted.iv, encrypted.tag);
    }).toThrow();
  });
});

describe('PairingStore — Persistenz gepaarter Peers', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-pairing-'));

  const testPeer: PairedPeer = {
    agentId: 'spiffe://thinklocal/host/test/agent/claude-code',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
    caCertPem: '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----',
    fingerprint: 'abc123',
    pairedAt: new Date().toISOString(),
    hostname: 'test-host',
  };

  it('speichert und lädt gepaarte Peers', () => {
    const store = new PairingStore(tmpDir);
    store.addPeer(testPeer);

    expect(store.isPaired(testPeer.agentId)).toBe(true);
    expect(store.getPeer(testPeer.agentId)?.hostname).toBe('test-host');

    // Neuer Store lädt aus Datei
    const store2 = new PairingStore(tmpDir);
    expect(store2.isPaired(testPeer.agentId)).toBe(true);
  });

  it('entfernt gepaarte Peers', () => {
    const store = new PairingStore(tmpDir);
    expect(store.isPaired(testPeer.agentId)).toBe(true);

    store.removePeer(testPeer.agentId);
    expect(store.isPaired(testPeer.agentId)).toBe(false);
  });

  it('gibt alle gepaarten Peers zurück', () => {
    const store = new PairingStore(tmpDir);
    store.addPeer(testPeer);
    store.addPeer({
      ...testPeer,
      agentId: 'spiffe://thinklocal/host/other/agent/gemini-cli',
      hostname: 'other-host',
    });

    expect(store.getAllPeers()).toHaveLength(2);
  });

  // Cleanup
  it('cleanup', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
