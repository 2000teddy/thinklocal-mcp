// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generatePin,
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  PairingStore,
  isHostIdSpiffeUri,
  HOST_ID_URI_PATTERN,
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

describe('PairingStore.isPairedByPublicKey — CR-MEDIUM (#159): pubkey-basiertes Pairing (ADR-022 Flip)', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-pairing-fp-'));
  const pubkeyPem = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZ...stable-signing-key...\n-----END PUBLIC KEY-----';
  const fp = createHash('sha256').update(pubkeyPem).digest('hex');

  const peer: PairedPeer = {
    agentId: 'spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code', // Legacy-URI beim Pairing
    publicKeyPem: pubkeyPem,
    caCertPem: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
    fingerprint: fp,
    pairedAt: new Date().toISOString(),
    hostname: 'th02',
  };

  it('erkennt einen gepairten Peer über seinen Public-Key — auch wenn die URI sich (durch Flip) ändert', () => {
    const store = new PairingStore(tmpDir);
    store.addPeer(peer);
    // Nach dem Flip kommt der Peer unter der KANONISCHEN URI — URI-Lookup schlägt fehl,
    // aber der (stabile) Public-Key matcht → weiterhin als gepairt erkannt.
    const canonicalUri = 'spiffe://thinklocal/node/12D3KooWMu7EkUK2XNB1jaWr7JGKDueNgTiVcCHG78VU23DdkrJV';
    expect(store.isPaired(canonicalUri)).toBe(false); // URI-gekeyt: nein
    expect(store.isPairedByPublicKey(pubkeyPem)).toBe(true); // pubkey-gekeyt: ja
  });

  it('lehnt einen fremden Public-Key ab (fail-closed)', () => {
    const store = new PairingStore(tmpDir);
    store.addPeer(peer);
    expect(store.isPairedByPublicKey('-----BEGIN PUBLIC KEY-----\nUNKNOWN\n-----END PUBLIC KEY-----')).toBe(false);
    expect(store.isPairedByPublicKey('')).toBe(false);
  });

  it('cleanup', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Bug #4 (ADR-020 Phase 1.1 Bug-Report): isHostIdSpiffeUri', () => {
  it('akzeptiert korrekte Host-ID-URI (16 Hex-Zeichen)', () => {
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code')).toBe(true);
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/68f7cd8e330acfe3/agent/gemini-cli')).toBe(true);
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/0000000000000000/agent/x')).toBe(true);
  });

  it('lehnt hostname-basierte Legacy-URI ab', () => {
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/iobroker/agent/claude-code')).toBe(false);
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/MacBook-Pro-314.local/agent/claude-code')).toBe(false);
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/Minimac.local/agent/claude-code')).toBe(false);
  });

  it('lehnt URI mit zu wenigen Hex-Zeichen ab', () => {
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/abc123/agent/x')).toBe(false);
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/abcdef1234567890a/agent/x')).toBe(false); // 17 hex
  });

  it('lehnt URI mit Nicht-Hex-Zeichen ab', () => {
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/abcdef123456789g/agent/x')).toBe(false); // 'g' nicht hex
    expect(isHostIdSpiffeUri('spiffe://thinklocal/host/ABCDEF1234567890/agent/x')).toBe(false); // uppercase nicht akzeptiert
  });

  it('lehnt falsches Schema ab', () => {
    expect(isHostIdSpiffeUri('http://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code')).toBe(false);
    expect(isHostIdSpiffeUri('spiffe://other/host/b4768fe0e2dfd41f/agent/claude-code')).toBe(false);
  });

  it('Pattern ist exportiert und ein RegExp', () => {
    expect(HOST_ID_URI_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe('Bug #4: PairingStore-Startup-Warning bei Legacy-URIs', () => {
  it('loggt warn wenn Legacy-Eintrag erkannt wird', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'pairing-legacy-'));
    const warns: any[] = [];
    const fakeLog: any = {
      info: () => {},
      warn: (obj: any, msg: string) => warns.push({ obj, msg }),
    };

    // Pre-populate paired-peers.json with one legacy and one current entry
    const file = resolve(tmpDir, 'pairing');
    require('node:fs').mkdirSync(file, { recursive: true });
    require('node:fs').writeFileSync(
      resolve(file, 'paired-peers.json'),
      JSON.stringify([
        {
          agentId: 'spiffe://thinklocal/host/iobroker/agent/claude-code',
          publicKeyPem: '',
          caCertPem: '',
          fingerprint: 'x',
          pairedAt: '2026-04-13',
          hostname: 'iobroker',
        },
        {
          agentId: 'spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code',
          publicKeyPem: '',
          caCertPem: '',
          fingerprint: 'y',
          pairedAt: '2026-04-07',
          hostname: 'iobroker-new',
        },
      ]),
    );

    new PairingStore(tmpDir, fakeLog);

    const legacyWarn = warns.find((w) => typeof w.msg === 'string' && w.msg.includes('Legacy'));
    expect(legacyWarn).toBeDefined();
    expect(legacyWarn.obj.legacyCount).toBe(1);
    expect(legacyWarn.obj.legacyUris).toContain('spiffe://thinklocal/host/iobroker/agent/claude-code');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('kein warn wenn alle Eintraege Host-ID-Format haben', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'pairing-clean-'));
    const warns: any[] = [];
    const fakeLog: any = {
      info: () => {},
      warn: (obj: any, msg: string) => warns.push({ obj, msg }),
    };
    const file = resolve(tmpDir, 'pairing');
    require('node:fs').mkdirSync(file, { recursive: true });
    require('node:fs').writeFileSync(
      resolve(file, 'paired-peers.json'),
      JSON.stringify([
        {
          agentId: 'spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code',
          publicKeyPem: '',
          caCertPem: '',
          fingerprint: 'y',
          pairedAt: '2026-04-07',
          hostname: 'iobroker',
        },
      ]),
    );

    new PairingStore(tmpDir, fakeLog);

    const legacyWarn = warns.find((w) => typeof w.msg === 'string' && w.msg.includes('Legacy'));
    expect(legacyWarn).toBeUndefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
