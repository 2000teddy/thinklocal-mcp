/**
 * ADR-008 Phase B PR B1 — Skill Manifest tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSkillManifest,
  listInstalledSkills,
  installSkill,
  computeManifestHash,
  type SkillManifest,
  MANIFEST_FORMAT_VERSION,
} from './skill-manifest.js';

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'thinklocal-influxdb',
    version: '1.0.0',
    description: 'Query and write InfluxDB time-series data',
    origin: 'spiffe://thinklocal/host/68f7cd8e330acfe3/agent/claude-code',
    capabilities: ['influxdb.query', 'influxdb.write'],
    format_version: MANIFEST_FORMAT_VERSION,
    ...overrides,
  };
}

describe('Skill Manifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-skills-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('installSkill()', () => {
    it('creates the skill directory with manifest.json', () => {
      const skill = installSkill(makeManifest(), undefined, dir);
      expect(existsSync(join(skill.dirPath, 'manifest.json'))).toBe(true);
      expect(skill.manifest.name).toBe('thinklocal-influxdb');
      expect(skill.hasPrompt).toBe(false);
      expect(skill.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('creates SKILL.md when prompt content is provided', () => {
      const skill = installSkill(makeManifest(), '# InfluxDB Skill\n\nQuery time-series data.', dir);
      expect(skill.hasPrompt).toBe(true);
      expect(existsSync(join(skill.dirPath, 'SKILL.md'))).toBe(true);
    });

    it('overwrites existing skill (idempotent)', () => {
      installSkill(makeManifest({ version: '1.0.0' }), 'v1', dir);
      const v2 = installSkill(makeManifest({ version: '2.0.0' }), 'v2', dir);
      expect(v2.manifest.version).toBe('2.0.0');
      const reread = readSkillManifest(v2.dirPath)!;
      expect(reread.manifest.version).toBe('2.0.0');
    });
  });

  describe('readSkillManifest()', () => {
    it('reads a valid manifest', () => {
      const skillDir = join(dir, 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'manifest.json'),
        JSON.stringify(makeManifest({ name: 'test-skill' })),
      );
      const skill = readSkillManifest(skillDir);
      expect(skill).not.toBeNull();
      expect(skill!.manifest.name).toBe('test-skill');
      expect(skill!.manifest.capabilities).toEqual(['influxdb.query', 'influxdb.write']);
    });

    it('returns null for missing directory', () => {
      expect(readSkillManifest('/nonexistent')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const skillDir = join(dir, 'skills', 'bad');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'manifest.json'), 'not json');
      expect(readSkillManifest(skillDir)).toBeNull();
    });

    it('returns null for manifest missing required fields', () => {
      const skillDir = join(dir, 'skills', 'incomplete');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'manifest.json'), '{"name":"x"}');
      expect(readSkillManifest(skillDir)).toBeNull();
    });

    it('detects whether SKILL.md exists', () => {
      const skillDir = join(dir, 'skills', 'with-prompt');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'manifest.json'),
        JSON.stringify(makeManifest({ name: 'with-prompt' })),
      );
      expect(readSkillManifest(skillDir)!.hasPrompt).toBe(false);
      writeFileSync(join(skillDir, 'SKILL.md'), '# Prompt');
      expect(readSkillManifest(skillDir)!.hasPrompt).toBe(true);
    });
  });

  describe('listInstalledSkills()', () => {
    it('returns [] for empty/missing skills dir', () => {
      expect(listInstalledSkills(dir)).toEqual([]);
    });

    it('lists all valid skills in the directory', () => {
      installSkill(makeManifest({ name: 'skill-a' }), 'prompt-a', dir);
      installSkill(makeManifest({ name: 'skill-b' }), undefined, dir);
      mkdirSync(join(dir, 'skills', 'empty-dir'), { recursive: true });
      const list = listInstalledSkills(dir);
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.manifest.name).sort()).toEqual(['skill-a', 'skill-b']);
    });
  });

  describe('computeManifestHash()', () => {
    it('produces a stable hash', () => {
      const m = makeManifest();
      expect(computeManifestHash(m)).toBe(computeManifestHash(m));
    });

    it('differs when any field changes', () => {
      const a = makeManifest();
      const b = makeManifest({ version: '2.0.0' });
      expect(computeManifestHash(a)).not.toBe(computeManifestHash(b));
    });

    it('ignores the signature field', () => {
      const a = makeManifest();
      const b = { ...makeManifest(), signature: 'some-sig' };
      expect(computeManifestHash(a)).toBe(computeManifestHash(b));
    });
  });

  describe('forward compatibility', () => {
    it('preserves unknown fields in manifest', () => {
      const manifest = { ...makeManifest(), futureField: 'hello', anotherOne: 42 };
      const skill = installSkill(manifest, undefined, dir);
      const reread = readSkillManifest(skill.dirPath)!;
      expect((reread.manifest as Record<string, unknown>).futureField).toBe('hello');
      expect((reread.manifest as Record<string, unknown>).anotherOne).toBe(42);
    });
  });

  // Regression for Gemini-Pro retroactive CR CRITICAL (2026-04-11):
  // Path-traversal via manifest.name was possible before sanitizeSkillName.
  describe('security: path-traversal prevention', () => {
    it('rejects ../../etc/passwd as skill name', () => {
      expect(() => installSkill(makeManifest({ name: '../../etc/passwd' }), undefined, dir)).toThrow(
        /path traversal/i,
      );
    });

    it('rejects names with slashes', () => {
      expect(() => installSkill(makeManifest({ name: 'a/b' }), undefined, dir)).toThrow();
    });

    it('rejects "." and ".." as names', () => {
      expect(() => installSkill(makeManifest({ name: '.' }), undefined, dir)).toThrow();
      expect(() => installSkill(makeManifest({ name: '..' }), undefined, dir)).toThrow();
    });

    it('rejects names with special characters', () => {
      expect(() => installSkill(makeManifest({ name: 'skill;rm -rf /' }), undefined, dir)).toThrow();
    });

    it('accepts valid kebab-case names', () => {
      expect(() => installSkill(makeManifest({ name: 'thinklocal-influxdb' }), undefined, dir)).not.toThrow();
      expect(() => installSkill(makeManifest({ name: 'my_skill.v2' }), undefined, dir)).not.toThrow();
    });
  });
});
