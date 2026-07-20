// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * ca-cert-expiry.test.ts — ADR-045 Vorbedingung B (TL-14a)
 *
 * Deckt die neue CA-/Intermediate-Expiry-Quelle `getCaCertDaysLeft` (tls.ts) +
 * das `subject`-Label des Ablauf-Monitors (`cert-expiry-monitor.ts`) ab. Vorher
 * sah der Live-Monitor NUR das Node-Leaf → eine ablaufende CA lief lautlos ab.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeshCA, createNodeCert, getCertDaysLeft, getCaCertDaysLeft } from './tls.js';
import { runCertExpiryCheck, type CertExpiryMonitorDeps } from './cert-expiry-monitor.js';

function withTlsDir(fn: (dataDir: string) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'tlmcp-ca-expiry-'));
  mkdirSync(join(dataDir, 'tls'), { recursive: true });
  try {
    fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('getCaCertDaysLeft — CA/Intermediate-Restlaufzeit (ADR-045 Vorbedingung B)', () => {
  it('liest `tls/ca.crt.pem` und liefert eine positive Restlaufzeit (~CA_VALIDITY_DAYS)', () => {
    withTlsDir((dataDir) => {
      const ca = createMeshCA('thinklocal', 'ca-expiry-test');
      writeFileSync(join(dataDir, 'tls', 'ca.crt.pem'), ca.caCertPem);
      const daysLeft = getCaCertDaysLeft(dataDir);
      expect(daysLeft).not.toBeNull();
      // CA-Validity = 365 d; Slack für Rundung/Laufzeit.
      expect(daysLeft as number).toBeGreaterThan(360);
      expect(daysLeft as number).toBeLessThanOrEqual(365);
    });
  });

  it('null, wenn `ca.crt.pem` fehlt oder unparsebar ist', () => {
    withTlsDir((dataDir) => {
      expect(getCaCertDaysLeft(dataDir)).toBeNull();
      writeFileSync(join(dataDir, 'tls', 'ca.crt.pem'), 'nicht-pem-muell');
      expect(getCaCertDaysLeft(dataDir)).toBeNull();
    });
  });

  it('liest eine ANDERE Datei als getCertDaysLeft (CA vs. Node-Leaf getrennt)', () => {
    withTlsDir((dataDir) => {
      // Nur die CA schreiben, KEIN node.crt.pem.
      const ca = createMeshCA('thinklocal', 'ca-only');
      writeFileSync(join(dataDir, 'tls', 'ca.crt.pem'), ca.caCertPem);
      expect(getCaCertDaysLeft(dataDir)).not.toBeNull(); // CA sichtbar
      expect(getCertDaysLeft(dataDir)).toBeNull(); // Node-Leaf fehlt → getrennte Quelle

      // Umgekehrt: nur das Node-Leaf schreiben.
      const leaf = createNodeCert(ca, 'node', 'spiffe://thinklocal/node/CA-EXPIRY-PEERID', []);
      rmSync(join(dataDir, 'tls', 'ca.crt.pem'));
      writeFileSync(join(dataDir, 'tls', 'node.crt.pem'), leaf.certPem);
      expect(getCaCertDaysLeft(dataDir)).toBeNull(); // CA weg
      expect(getCertDaysLeft(dataDir)).not.toBeNull(); // Node-Leaf sichtbar
    });
  });
});

describe('cert-expiry-monitor — subject-Label (Node vs. CA)', () => {
  function makeDeps(
    daysLeft: number | null,
    subject?: string,
  ): { deps: CertExpiryMonitorDeps; appends: Array<{ type: string; details?: string }> } {
    const appends: Array<{ type: string; details?: string }> = [];
    const deps: CertExpiryMonitorDeps = {
      getDaysLeft: () => daysLeft,
      ...(subject ? { subject } : {}),
      thresholds: { warnDays: 30, criticalDays: 7 },
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      audit: { append: (type, _peerId, details) => appends.push({ type, details }) },
      eventBus: { emit: () => {} },
    };
    return { deps, appends };
  }

  it('subject "CA" landet im Audit-Detail bei warn/critical', () => {
    const { deps, appends } = makeDeps(5, 'CA'); // < criticalDays → critical
    const tier = runCertExpiryCheck(deps);
    expect(tier).toBe('critical');
    expect(appends).toHaveLength(1);
    expect(appends[0]?.details).toMatch(/"subject":"CA"/);
  });

  it('Default-subject bleibt "Node" (unveränderter Node-Pfad)', () => {
    const { deps, appends } = makeDeps(20); // warn
    const tier = runCertExpiryCheck(deps);
    expect(tier).toBe('warn');
    expect(appends[0]?.details).toMatch(/"subject":"Node"/);
    // Der bestehende Vertrag (Neustart-Hinweis + daysLeft) bleibt erhalten.
    expect(appends[0]?.details).toMatch(/Neustart/);
    expect(appends[0]?.details).toMatch(/20/);
  });

  it('ok/unknown schreiben KEIN Audit-Event (subject-unabhängig)', () => {
    expect(runCertExpiryCheck(makeDeps(40, 'CA').deps)).toBe('ok');
    expect(runCertExpiryCheck(makeDeps(null, 'CA').deps)).toBe('unknown');
  });
});
