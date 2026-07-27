// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * cert-monitor-wiring.test.ts — ADR-045 Vorbedingung B: die Monitor-Verdrahtung ist regressionsfest.
 *
 * #297 lieferte die B-Funktionsteile (`getCaCertDaysLeft`, `subject`-Label) samt Unit-Tests — aber die
 * Auswahl „welcher Monitor liest welche Quelle" lag inline in `index.ts` und war ungetestet. Dieser Test
 * bewacht `buildCertExpiryMonitorSpecs`: der Daemon startet **zwei** Monitore, Node-Leaf UND CA/Intermediate,
 * mit den **richtigen** Quellen und getrennten `subject`s. Ein versehentliches „beide lesen `node.crt.pem`"
 * oder ein weggefallener CA-Monitor wird dadurch rot.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMeshCA, createNodeCert } from './tls.js';
import { buildCertExpiryMonitorSpecs } from './cert-monitor-wiring.js';

const THRESHOLDS = { warnDays: 30, criticalDays: 7 };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Legt ein dataDir mit optionalem `tls/node.crt.pem` und/oder `tls/ca.crt.pem` an. */
function makeDataDir(opts: { node?: boolean; ca?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'tlmcp-monwire-'));
  dirs.push(dir);
  const tlsDir = resolve(dir, 'tls');
  mkdirSync(tlsDir, { recursive: true });
  const ca = createMeshCA('thinklocal', 'monwire');
  if (opts.ca) writeFileSync(resolve(tlsDir, 'ca.crt.pem'), ca.caCertPem);
  if (opts.node) {
    const node = createNodeCert(ca, 'localhost', 'spiffe://thinklocal/node/12D3KooMonWire', ['127.0.0.1']);
    writeFileSync(resolve(tlsDir, 'node.crt.pem'), node.certPem);
  }
  return dir;
}

describe('buildCertExpiryMonitorSpecs — Vorbedingung-B-Verdrahtung', () => {
  it('liefert genau zwei Monitore mit den subjects "Node" und "CA"', () => {
    const specs = buildCertExpiryMonitorSpecs(makeDataDir({ node: true, ca: true }), THRESHOLDS);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.subject)).toEqual(['Node', 'CA']);
  });

  it('reicht die Schwellen an beide Monitore durch', () => {
    const specs = buildCertExpiryMonitorSpecs(makeDataDir({ node: true, ca: true }), THRESHOLDS);
    for (const s of specs) expect(s.thresholds).toEqual(THRESHOLDS);
  });

  it('der Node-Monitor liest `node.crt.pem`, der CA-Monitor `ca.crt.pem` (getrennte Quellen)', () => {
    // Nur node.crt.pem vorhanden ⇒ Node-Quelle liefert einen Wert, CA-Quelle null.
    const nodeOnly = buildCertExpiryMonitorSpecs(makeDataDir({ node: true, ca: false }), THRESHOLDS);
    expect(nodeOnly[0]?.getDaysLeft()).not.toBeNull(); // 'Node' sieht node.crt.pem
    expect(nodeOnly[1]?.getDaysLeft()).toBeNull(); //     'CA' sieht keine ca.crt.pem

    // Nur ca.crt.pem vorhanden ⇒ umgekehrt (beweist: die beiden Monitore lesen NICHT dieselbe Datei).
    const caOnly = buildCertExpiryMonitorSpecs(makeDataDir({ node: false, ca: true }), THRESHOLDS);
    expect(caOnly[0]?.getDaysLeft()).toBeNull(); //     'Node' sieht keine node.crt.pem
    expect(caOnly[1]?.getDaysLeft()).not.toBeNull(); // 'CA' sieht ca.crt.pem
  });

  it('die getDaysLeft-Closures machen beim Bauen KEIN I/O (lesen erst beim Aufruf)', () => {
    // Ein nicht-existentes dataDir darf beim BAUEN nicht werfen; erst der Aufruf liefert null.
    const specs = buildCertExpiryMonitorSpecs('/nonexistent-datadir-xyz', THRESHOLDS);
    expect(specs).toHaveLength(2);
    expect(specs[0]?.getDaysLeft()).toBeNull();
    expect(specs[1]?.getDaysLeft()).toBeNull();
  });
});
