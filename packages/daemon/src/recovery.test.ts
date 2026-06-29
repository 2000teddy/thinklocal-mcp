import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import forge from 'node-forge';
import { runRecoveryChecks } from './recovery.js';

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlmcp-recovery-'));
  mkdirSync(join(dir, 'tls'), { recursive: true });
  mkdirSync(join(dir, 'certs'), { recursive: true });
  return dir;
}

function createExpiringCertPem(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0103';
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 3 * 24 * 3600_000);
  const attrs = [{ name: 'commonName', value: 'expiring-node' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe('runRecoveryChecks canonical certificate paths', () => {
  it('deletes expiring canonical TLS node material, not legacy certs/node files', async () => {
    const dir = makeDataDir();
    try {
      writeFileSync(join(dir, 'tls', 'node.crt.pem'), createExpiringCertPem());
      writeFileSync(join(dir, 'tls', 'node.key.pem'), 'key');
      writeFileSync(join(dir, 'certs', 'node.crt'), 'legacy-cert');
      writeFileSync(join(dir, 'certs', 'node.key'), 'legacy-key');

      const results = await runRecoveryChecks(dir, 0);
      const certResult = results.find((r) => r.issue === 'cert_expired');

      expect(certResult).toMatchObject({ recovered: true });
      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(false);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(false);
      expect(existsSync(join(dir, 'certs', 'node.crt'))).toBe(true);
      expect(existsSync(join(dir, 'certs', 'node.key'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed for expiring token-onboarded TLS without a local CA key', async () => {
    const dir = makeDataDir();
    try {
      writeFileSync(join(dir, 'tls', 'ca.crt.pem'), createExpiringCertPem());
      writeFileSync(join(dir, 'tls', 'node.crt.pem'), createExpiringCertPem());
      writeFileSync(join(dir, 'tls', 'node.key.pem'), 'key');

      const results = await runRecoveryChecks(dir, 0);
      const certResult = results.find((r) => r.issue === 'cert_expired');

      expect(certResult).toMatchObject({ recovered: false });
      expect(certResult?.action).toContain('Re-Enroll');
      expect(existsSync(join(dir, 'tls', 'node.crt.pem'))).toBe(true);
      expect(existsSync(join(dir, 'tls', 'node.key.pem'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
