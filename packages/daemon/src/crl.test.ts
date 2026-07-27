// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * crl.test.ts — Charakterisierungs-Test für `CertificateRevocationList` (`crl.ts`).
 *
 * WARUM DIESE DATEI EXISTIERT (TL-14a, Auflage-C-Grounding — `TL-14a-blocker-C-grounding.md`)
 * ------------------------------------------------------------------------------------------
 * Der Consensus (`TL-14a-consensus-result-D1-D6.md` §C) führt „**keine Revocation-Infrastruktur**" als
 * **blockierende** Auflage; sonnet-Vorschlag: eine **gepinnte Denylist kompromittierter Fingerprints**,
 * geprüft beim Connection-Setup. Der Ist-Zustand (code-verifiziert im Grounding): `crl.ts`
 * (`CertificateRevocationList`) **existiert bereits** als genau so eine Fingerprint-Denylist (`revoke`/
 * `isRevoked`, datei-persistiert), ist aber **0-Aufrufer-Dead-Code** und war **komplett ungetestet** — der
 * Datei-Kopf behauptet „geprüft beim Heartbeat und bei der Agent-Card-Verifikation", was NICHT verdrahtet ist.
 *
 * Dieser Test **charakterisiert das vorhandene Verhalten** (wie `tls-chain-characterization.test.ts` für
 * Auflage A), damit eine spätere C-Entscheidung („die bestehende `crl.ts` als pinned Denylist verdrahten"
 * vs. Neubau) auf einer bewachten Grundlage steht. **Kein Fix, keine Verdrahtung** — nur Ist-Verhalten
 * festgeschrieben. Nimmt die C-Entscheidung NICHT vorweg.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CertificateRevocationList } from './crl.js';

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tlmcp-crl-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FP_A = 'AA:BB:CC:DD:' + 'EE:'.repeat(10) + 'FF';
const FP_B = '11:22:33:44:' + '55:'.repeat(10) + '66';

describe('CertificateRevocationList — Charakterisierung (Ist-Verhalten, keine Verdrahtung)', () => {
  it('revoke → isRevoked=true für den Fingerprint, false für einen unbekannten', () => {
    const crl = new CertificateRevocationList(freshDir());
    expect(crl.isRevoked(FP_A)).toBe(false);
    crl.revoke(FP_A, 'compromised');
    expect(crl.isRevoked(FP_A)).toBe(true);
    expect(crl.isRevoked(FP_B)).toBe(false);
  });

  it('size + list spiegeln die Einträge; revoke ist idempotent je Fingerprint', () => {
    const crl = new CertificateRevocationList(freshDir());
    crl.revoke(FP_A, 'r1', 'agent-1');
    crl.revoke(FP_B, 'r2');
    crl.revoke(FP_A, 'r1-again'); // gleicher FP ⇒ überschreibt, kein Zuwachs
    expect(crl.size).toBe(2);
    const fps = crl.list().map((e) => e.fingerprint).sort();
    expect(fps).toEqual([FP_A, FP_B].sort());
    expect(crl.list().find((e) => e.fingerprint === FP_A)?.reason).toBe('r1-again');
  });

  it('unrevoke entfernt einen Eintrag (true), unbekannter Fingerprint ⇒ false', () => {
    const crl = new CertificateRevocationList(freshDir());
    crl.revoke(FP_A, 'x');
    expect(crl.unrevoke(FP_A)).toBe(true);
    expect(crl.isRevoked(FP_A)).toBe(false);
    expect(crl.unrevoke(FP_B)).toBe(false);
  });

  it('Persistenz: ein neuer Instanz-Load aus demselben dataDir sieht die Revozierung (Datei-persistiert)', () => {
    const dir = freshDir();
    new CertificateRevocationList(dir).revoke(FP_A, 'compromised', 'agent-9');
    // zweite Instanz lädt aus certs/crl.json
    const reloaded = new CertificateRevocationList(dir);
    expect(reloaded.isRevoked(FP_A)).toBe(true);
    expect(reloaded.list()[0]).toMatchObject({ fingerprint: FP_A, reason: 'compromised', agentId: 'agent-9' });
  });

  it('load ist fail-safe: fehlende Datei ⇒ leer; korrupte Datei ⇒ leer, kein Wurf', () => {
    // fehlende Datei
    expect(new CertificateRevocationList(freshDir()).size).toBe(0);
    // korrupte Datei
    const dir = freshDir();
    mkdirSync(resolve(dir, 'certs'), { recursive: true });
    writeFileSync(resolve(dir, 'certs', 'crl.json'), '{ das ist kein JSON');
    let crl: CertificateRevocationList | undefined;
    expect(() => {
      crl = new CertificateRevocationList(dir);
    }).not.toThrow();
    expect(crl?.size).toBe(0);
  });

  it('save schreibt atomar (tmp→rename): die JSON-Datei ist gültiges JSON-Array', () => {
    const dir = freshDir();
    const crl = new CertificateRevocationList(dir);
    crl.revoke(FP_A, 'x');
    const raw = readFileSync(resolve(dir, 'certs', 'crl.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
