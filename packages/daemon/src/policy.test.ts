/**
 * policy.test.ts — Verhaltens-Tests für die @deprecated LEGACY `PolicyEngine` (`policy.ts`),
 * ein totes Modul (0 Produktions-Importeure). Die Tests bleiben erhalten, damit die Engine
 * ihr dokumentiertes Verhalten behält, solange sie nicht entfernt wird. Der reale,
 * verdrahtete Autorisierungs-Pfad ist mTLS/Trust + `isApprovedPeerSender` (ADR-026) +
 * Vault-Approval-Flow — NICHT diese Engine (und auch nicht das ebenfalls unverdrahtete
 * `approval-gates.ts`). Siehe `policy.ts`-Header.
 */
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from './policy.js';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('PolicyEngine', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'policy-test-'));

  it('erlaubt Skill-Ausfuehrung standardmaessig', () => {
    const engine = new PolicyEngine(tempDir);
    const decision = engine.evaluate('skill.execute', 'spiffe://test/agent', 'system.health');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it('erfordert Approval fuer Skill-Installation', () => {
    const engine = new PolicyEngine(tempDir);
    const decision = engine.evaluate('skill.install', 'spiffe://test/agent', 'new-skill');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  it('erfordert immer Approval fuer Credential-Sharing', () => {
    const engine = new PolicyEngine(tempDir);
    const decision = engine.evaluate('credential.share', 'spiffe://test/agent', 'github-token');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  it('deny-by-default wenn keine Policy matched', () => {
    const engine = new PolicyEngine(tempDir);
    // task.delegate hat keine Default-Policy
    const decision = engine.evaluate('task.delegate', 'spiffe://test/agent', 'some-task');
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBeNull();
  });

  it('Custom Policy ueberschreibt Default', () => {
    const engine = new PolicyEngine(tempDir);
    engine.addPolicy({
      name: 'block-influxdb',
      description: 'Blockiere InfluxDB-Zugriff fuer bestimmten Agent',
      action: 'skill.execute',
      subject: 'spiffe://thinklocal/host/untrusted/agent/*',
      resource: 'influxdb.*',
      effect: 'deny',
      priority: 50,
    });

    const blocked = engine.evaluate('skill.execute', 'spiffe://thinklocal/host/untrusted/agent/test', 'influxdb.query');
    expect(blocked.allowed).toBe(false);

    // Anderer Agent darf weiterhin
    const allowed = engine.evaluate('skill.execute', 'spiffe://thinklocal/host/trusted/agent/test', 'influxdb.query');
    expect(allowed.allowed).toBe(true);
  });

  it('Wildcard-Pattern matcht alle', () => {
    const engine = new PolicyEngine(tempDir);
    const decision = engine.evaluate('peer.connect', 'any-agent', 'any-resource');
    expect(decision.allowed).toBe(true);
  });

  it('Prefix-Pattern matcht korrekt', () => {
    const engine = new PolicyEngine(tempDir);
    engine.addPolicy({
      name: 'allow-db-skills',
      description: 'Erlaube alle Datenbank-Skills',
      action: 'skill.execute',
      subject: '*',
      resource: 'db.*',
      effect: 'allow',
      priority: 10,
    });

    const matched = engine.evaluate('skill.execute', 'any', 'db.query');
    expect(matched.allowed).toBe(true);
    expect(matched.matchedPolicy).toBe('allow-db-skills');
  });

  it('listPolicies gibt alle Policies zurueck', () => {
    const engine = new PolicyEngine(tempDir);
    const policies = engine.listPolicies();
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some((p) => p.name === 'default-credential-share')).toBe(true);
  });

  it('removePolicy entfernt Policy', () => {
    const engine = new PolicyEngine(tempDir);
    engine.addPolicy({
      name: 'temp-policy',
      description: 'Temporaer',
      action: 'skill.execute',
      subject: '*',
      resource: '*',
      effect: 'deny',
    });
    expect(engine.removePolicy('temp-policy')).toBe(true);
    expect(engine.removePolicy('nonexistent')).toBe(false);
  });

  // Deckt den konvertierten createHash-Pfad ab (require → import).
  it('getVersion liefert stabilen 16-stelligen Hash, der sich bei Änderung ändert', () => {
    const engine = new PolicyEngine(tempDir);
    const v1 = engine.getVersion();
    expect(v1).toMatch(/^[0-9a-f]{16}$/);
    expect(engine.getVersion()).toBe(v1); // deterministisch
    engine.addPolicy({ name: 'v-test', description: 'x', action: 'skill.execute', subject: '*', resource: 'z.*', effect: 'deny' });
    expect(engine.getVersion()).not.toBe(v1); // Änderung wirkt
  });

  // Deckt den konvertierten writeFileSync-Pfad ab (require → import).
  it('save schreibt nur Custom-Policies nach policies.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'policy-save-'));
    const engine = new PolicyEngine(dir);
    engine.addPolicy({ name: 'custom-x', description: 'x', action: 'skill.execute', subject: '*', resource: 'z.*', effect: 'deny' });
    engine.save();
    const written = JSON.parse(readFileSync(join(dir, 'policies.json'), 'utf8')) as Array<{ name: string }>;
    expect(written.some((p) => p.name === 'custom-x')).toBe(true);
    expect(written.some((p) => p.name.startsWith('default-'))).toBe(false); // nur Custom
  });
});

describe('policy.ts ist totes Modul + @deprecated markiert (Cleanup-Guard)', () => {
  it('kein Produktions-Source (daemon/cli) importiert policy.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/daemon/src
    const repoRoot = resolve(here, '../../..');
    const roots = [resolve(repoRoot, 'packages/daemon/src'), resolve(repoRoot, 'packages/cli/src')];
    const importers: string[] = [];
    for (const root of roots) {
      let files: string[];
      try {
        files = readdirSync(root, { recursive: true }) as string[];
      } catch {
        continue; // cli optional
      }
      for (const rel of files) {
        if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue;
        if (rel.endsWith('policy.ts')) continue; // die Definition selbst
        // discovery-policy.ts ist ein ANDERES, lebendes Modul → nicht mitzählen
        if (rel.endsWith('discovery-policy.ts')) continue;
        const src = readFileSync(join(root, rel), 'utf8');
        if (/from\s+['"][^'"]*\/policy(\.js)?['"]/.test(src)) {
          importers.push(rel);
        }
      }
    }
    expect(importers).toEqual([]);
  });

  it('policy.ts ist als @deprecated/Legacy markiert + zeigt auf den kanonischen AUTHZ-Pfad', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, 'policy.ts'), 'utf8');
    expect(src, 'Deprecation-Marker fehlt').toMatch(/@deprecated/);
    // Verweise auf den REAL verdrahteten AUTHZ-Pfad (nicht das unverdrahtete approval-gates).
    expect(src, 'Verweis auf isApprovedPeerSender fehlt').toMatch(/isApprovedPeerSender/);
    expect(src, 'Verweis auf den Vault-Approval-Flow fehlt').toMatch(/createApprovalRequest/);
  });
});
