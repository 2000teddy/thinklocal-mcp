import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillManager, type SkillManifest } from './skills.js';
import { CapabilityRegistry } from './registry.js';

function makeManifest(id: string, overrides?: Partial<SkillManifest>): SkillManifest {
  return {
    id,
    version: '1.0.0',
    description: `Test skill: ${id}`,
    author: 'spiffe://thinklocal/host/test/agent/claude-code',
    integrity: 'sha256:abc123',
    runtime: 'node',
    entrypoint: 'index.js',
    dependencies: [],
    tools: [`${id}.execute`],
    resources: [],
    category: 'test',
    permissions: ['network.local'],
    requirements: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SkillManager — Skill-Verwaltung und -Transfer', () => {
  const agentA = 'spiffe://thinklocal/host/a/agent/claude-code';
  const agentB = 'spiffe://thinklocal/host/b/agent/gemini-cli';

  it('registriert einen lokalen Skill und meldet ihn in der Registry an', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();
    const manager = new SkillManager(tmpDir, agentA, registry);

    const manifest = makeManifest('influxdb-query');
    manager.registerLocal(manifest);

    expect(manager.getSkill('influxdb-query')).toBeTruthy();
    expect(manager.getLocalSkills()).toHaveLength(1);

    // In Registry als Capability sichtbar
    const caps = registry.findBySkill('influxdb-query');
    expect(caps).toHaveLength(1);
    expect(caps[0].agent_id).toBe(agentA);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('entfernt einen Skill aus Registry und lokaler Liste', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();
    const manager = new SkillManager(tmpDir, agentA, registry);

    manager.registerLocal(makeManifest('temp-skill'));
    expect(manager.getLocalSkills()).toHaveLength(1);

    manager.unregisterLocal('temp-skill');
    expect(manager.getLocalSkills()).toHaveLength(0);
    expect(registry.findBySkill('temp-skill')).toHaveLength(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('verarbeitet SKILL_ANNOUNCE von einem Peer', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();
    const manager = new SkillManager(tmpDir, agentA, registry);

    const imported = manager.handleAnnounce(agentB, {
      skills: [
        makeManifest('remote-skill-1'),
        makeManifest('remote-skill-2'),
      ],
    });

    expect(imported).toBe(2);
    expect(registry.findBySkill('remote-skill-1')).toHaveLength(1);
    expect(registry.findBySkill('remote-skill-1')[0].agent_id).toBe(agentB);
    expect(registry.findBySkill('remote-skill-1')[0].trust_level).toBe(2); // Remote = niedrigerer Trust

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignoriert Announcements fuer bereits lokal vorhandene Skills', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();
    const manager = new SkillManager(tmpDir, agentA, registry);

    manager.registerLocal(makeManifest('my-skill'));
    const imported = manager.handleAnnounce(agentB, {
      skills: [makeManifest('my-skill')],
    });

    expect(imported).toBe(0); // Nicht importiert weil lokal vorhanden

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('erstellt einen Transfer-Request', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();
    const manager = new SkillManager(tmpDir, agentA, registry);

    const transfer = manager.requestTransfer('remote-skill', '1.0.0', agentB);
    expect(transfer.id).toBeTruthy();
    expect(transfer.state).toBe('requested');
    expect(transfer.source).toBe(agentB);

    expect(manager.getTransfers()).toHaveLength(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persistiert installierte Skills', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skills-'));
    const registry = new CapabilityRegistry();

    // Installiere Skills
    const manager1 = new SkillManager(tmpDir, agentA, registry);
    manager1.registerLocal(makeManifest('persistent-skill'));

    // Neuer Manager aus gleichem Verzeichnis
    const registry2 = new CapabilityRegistry();
    const manager2 = new SkillManager(tmpDir, agentA, registry2);
    expect(manager2.getLocalSkills()).toHaveLength(1);
    expect(manager2.getSkill('persistent-skill')?.version).toBe('1.0.0');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
