/**
 * RE-CHECK Cert/Rotation (KW27, WOCHENPLAN Z62-66) — Verdikt als Test.
 *
 * Frage: Feuert die Cert-„Auto-Rotation"? Und ist `cert-rotation.ts`
 * (rotateCert/needsRotation/auditCerts) der scharfe Laufzeitpfad?
 *
 * VERDIKT (empirisch hier festgenagelt):
 *  A) Die EINZIGE reale Cert-Erneuerung ist `loadOrCreateTlsBundle()` (tls.ts),
 *     die beim DAEMON-(NEU-)START läuft. Sie behält ein Node-Cert nur, wenn
 *     `daysLeft > 7` (+ Identität/CA/Key-Match) — sonst REISSUE. Es gibt KEINEN
 *     laufenden Timer/Scheduler: auf einem durchlaufenden Daemon „rotiert"
 *     nichts; erst der nächste Start erneuert ein ablaufendes Cert.
 *  B) `cert-rotation.ts` ist totes Modul: KEIN Produktionscode (daemon/cli)
 *     importiert es — nur sein eigener Test. Es ist daher NICHT der scharfe Pfad.
 *
 * Folge: Für einen langlebigen Daemon, der nicht neu startet, IST der
 * Cert-Ablauf (z.B. 2026-09-02) ein reales Risiko → rechtfertigt T2.1
 * (laufende Rotation / proaktiver Reissue-Trigger). Siehe Verdikt-Doku.
 */
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeshCA, loadOrCreateTlsBundle, getCertDaysLeft, extractSpiffeUri } from './tls.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SPIFFE = 'spiffe://thinklocal/host/recheck/agent/claude-code';

/** Mintet ein von `ca` signiertes Node-Cert mit gewähltem notAfter + SPIFFE-SAN. */
function mintNodeCert(
  ca: ReturnType<typeof createMeshCA>,
  spiffeUri: string,
  notAfter: Date,
): { certPem: string; keyPem: string } {
  const caCert = forge.pki.certificateFromPem(ca.caCertPem);
  const caKey = forge.pki.privateKeyFromPem(ca.caKeyPem);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0' + Math.abs((notAfter.getTime() % 99991) + 17).toString(16);
  cert.validity.notBefore = new Date(Date.now() - HOUR);
  cert.validity.notAfter = notAfter;
  cert.setSubject([{ name: 'commonName', value: 'node' }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { name: 'subjectAltName', altNames: [{ type: 6, value: spiffeUri }] as any },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function setupTlsDir(ca: ReturnType<typeof createMeshCA>, node: { certPem: string; keyPem: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlmcp-cert-recheck-'));
  const tls = join(dir, 'tls');
  mkdirSync(tls, { recursive: true });
  writeFileSync(join(tls, 'ca.crt.pem'), ca.caCertPem);
  writeFileSync(join(tls, 'ca.key.pem'), ca.caKeyPem);
  writeFileSync(join(tls, 'node.crt.pem'), node.certPem);
  writeFileSync(join(tls, 'node.key.pem'), node.keyPem);
  return dir;
}

describe('RE-CHECK A — reale Rotation = startup-load reissue (tls.ts), KEIN Timer', () => {
  it('Node-Cert mit ~30 Tagen Restlaufzeit → WIRD BEHALTEN (kein vorzeitiges Rotieren)', () => {
    const ca = createMeshCA('thinklocal', 'recheck');
    const node = mintNodeCert(ca, SPIFFE, new Date(Date.now() + 30 * DAY + HOUR));
    const dir = setupTlsDir(ca, node);
    try {
      const bundle = loadOrCreateTlsBundle(dir, 'node', SPIFFE, undefined, 'recheck');
      expect(bundle.certPem).toBe(node.certPem); // unverändert wiederverwendet
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Node-Cert mit ~3 Tagen Restlaufzeit (≤7) → REISSUE beim Load (Rotation feuert)', () => {
    const ca = createMeshCA('thinklocal', 'recheck');
    const node = mintNodeCert(ca, SPIFFE, new Date(Date.now() + 3 * DAY));
    const dir = setupTlsDir(ca, node);
    try {
      const bundle = loadOrCreateTlsBundle(dir, 'node', SPIFFE, undefined, 'recheck');
      // Frisch ausgestellt: anderes Cert, volle Restlaufzeit, gleiche Identität.
      expect(bundle.certPem).not.toBe(node.certPem);
      expect(extractSpiffeUri(bundle.certPem)).toBe(SPIFFE);
      expect(getCertDaysLeft(dir)).toBeGreaterThan(80);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Load-Idempotenz: ein gültiges Cert wird über wiederholte Loads NICHT gechurnt', () => {
    // Hinweis: Der „kein laufender Timer"-Teil des Verdikts ist CODE-seitig belegt
    // (kein setInterval/Scheduler ruft loadOrCreateTlsBundle/Reissue — der einzige
    // Timer im Daemon ist der SQLite-Maintenance-Task). Dieser Test belegt das
    // schwächere, aber notwendige Komplement: loadOrCreateTlsBundle ist idempotent —
    // ein gültiges Cert wird bei wiederholtem Load stabil wiederverwendet, nicht ersetzt.
    const ca = createMeshCA('thinklocal', 'recheck');
    const node = mintNodeCert(ca, SPIFFE, new Date(Date.now() + 30 * DAY + HOUR));
    const dir = setupTlsDir(ca, node);
    try {
      const a = loadOrCreateTlsBundle(dir, 'node', SPIFFE, undefined, 'recheck');
      const b = loadOrCreateTlsBundle(dir, 'node', SPIFFE, undefined, 'recheck');
      expect(a.certPem).toBe(node.certPem);
      expect(b.certPem).toBe(node.certPem);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('RE-CHECK B — cert-rotation.ts ist totes Modul (NICHT der scharfe Pfad)', () => {
  it('Kein Produktions-Source (daemon/cli) importiert cert-rotation', () => {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/daemon/src
    const repoRoot = resolve(here, '../../..');
    const roots = [
      resolve(repoRoot, 'packages/daemon/src'),
      resolve(repoRoot, 'packages/cli/src'),
    ];
    const importers: string[] = [];
    for (const root of roots) {
      let files: string[];
      try {
        files = readdirSync(root, { recursive: true }) as string[];
      } catch {
        continue; // Root existiert evtl. nicht (cli optional)
      }
      for (const rel of files) {
        if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue;
        if (rel.endsWith('cert-rotation.ts')) continue; // die Definition selbst
        const src = readFileSync(join(root, rel), 'utf8');
        if (/from\s+['"][^'"]*cert-rotation(\.js)?['"]/.test(src)) {
          importers.push(rel);
        }
      }
    }
    expect(importers).toEqual([]);
  });
});
