import { describe, it, expect } from 'vitest';
import { PolicyEngine } from './policy.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
