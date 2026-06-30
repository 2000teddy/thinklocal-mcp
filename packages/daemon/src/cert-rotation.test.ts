/**
 * cert-rotation.test.ts — Verhaltens-Tests für die @deprecated LEGACY-Utilities in
 * `cert-rotation.ts` (totes Modul, kein Produktions-Importeur — siehe
 * `cert-rotation-recheck.test.ts`). Die Tests bleiben erhalten, damit die manuell
 * aufrufbaren Utilities (trustReset/auditCerts/rotateCert) ihr dokumentiertes Verhalten
 * behalten, solange sie nicht entfernt werden. Der LAUFZEIT-Pfad ist `loadOrCreateTlsBundle`
 * (Reissue beim Start) + `cert-expiry-monitor.ts` (Live-Alert, T2.1) — NICHT dieses Modul.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import forge from 'node-forge';
import { auditCerts, rotateCert, trustReset } from './cert-rotation.js';

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlmcp-cert-rotation-'));
  mkdirSync(join(dir, 'tls'), { recursive: true });
  mkdirSync(join(dir, 'pairing'), { recursive: true });
  mkdirSync(join(dir, 'certs'), { recursive: true });
  return dir;
}

function writeDummyRuntimeFiles(dir: string): void {
  writeFileSync(join(dir, 'tls', 'node.crt.pem'), 'cert');
  writeFileSync(join(dir, 'tls', 'node.key.pem'), 'key');
  writeFileSync(join(dir, 'certs', 'node.crt'), 'legacy-cert');
  writeFileSync(join(dir, 'certs', 'node.key'), 'legacy-key');
}

function markTokenOnboarded(dir: string): void {
  writeFileSync(join(dir, 'tls', 'ca.crt.pem'), createCertPem(30));
}

function createCertPem(daysLeft: number): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${Math.abs(daysLeft)}`;
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + daysLeft * 24 * 3600_000);
  const attrs = [{ name: 'commonName', value: `cert-${daysLeft}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe('cert-rotation canonical runtime paths', () => {
  it('rotateCert removes canonical TLS node cert material only', () => {
    const dir = makeDataDir();
    try {
      writeDummyRuntimeFiles(dir);

      expect(rotateCert(dir)).toBe(true);

      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(false);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(false);
      expect(existsSync(join(dir, 'certs', 'node.crt'))).toBe(true);
      expect(existsSync(join(dir, 'certs', 'node.key'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rotateCert fails closed for token-onboarded TLS without a local CA key', () => {
    const dir = makeDataDir();
    try {
      writeDummyRuntimeFiles(dir);
      markTokenOnboarded(dir);

      expect(rotateCert(dir)).toBe(false);

      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(true);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('trustReset removes canonical TLS material and paired-peers.json', () => {
    const dir = makeDataDir();
    try {
      writeDummyRuntimeFiles(dir);
      writeFileSync(join(dir, 'pairing', 'paired-peers.json'), '[]');
      writeFileSync(join(dir, 'pairing-store.json'), 'legacy');
      writeFileSync(join(dir, 'certs', 'crl.json'), '[]');

      expect(trustReset(dir)).toEqual({ certsRemoved: 3, pairingReset: true });

      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(false);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(false);
      expect(existsSync(join(dir, 'pairing', 'paired-peers.json'))).toBe(false);
      expect(existsSync(join(dir, 'pairing-store.json'))).toBe(true);
      expect(existsSync(join(dir, 'certs', 'crl.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('trustReset fails closed for token-onboarded TLS without a local CA key', () => {
    const dir = makeDataDir();
    try {
      writeDummyRuntimeFiles(dir);
      markTokenOnboarded(dir);
      writeFileSync(join(dir, 'pairing', 'paired-peers.json'), '[]');

      expect(trustReset(dir)).toEqual({ certsRemoved: 0, pairingReset: false });

      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(true);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(true);
      expect(existsSync(join(dir, 'pairing', 'paired-peers.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auditCerts reads current tls/*.crt.pem files', () => {
    const dir = makeDataDir();
    try {
      writeFileSync(join(dir, 'tls', 'node.crt.pem'), createCertPem(45));
      writeFileSync(join(dir, 'tls', 'ca.crt.pem'), createCertPem(365));
      writeFileSync(join(dir, 'certs', 'node.crt'), createCertPem(45));

      const result = auditCerts(dir);

      expect(result.total).toBe(2);
      expect(result.valid).toBe(2);
      expect(result.details.map((d) => d.file).sort()).toEqual(['ca.crt.pem', 'node.crt.pem']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
