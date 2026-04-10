/**
 * ADR-008 Phase B PR B2 — Claude Code Skill Adapter tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderClaudeSkillMarkdown,
  installClaudeSkill,
} from './skill-adapter-claude.js';
import { installSkill, type SkillManifest, MANIFEST_FORMAT_VERSION } from './skill-manifest.js';

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

describe('skill-adapter-claude', () => {
  let dataDir: string;
  let claudeDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tlmcp-adapter-'));
    claudeDir = mkdtempSync(join(tmpdir(), 'claude-skills-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
  });

  describe('renderClaudeSkillMarkdown()', () => {
    it('renders with custom prompt content', () => {
      const md = renderClaudeSkillMarkdown(makeManifest(), '# My Custom Prompt\n\nDo the thing.');
      expect(md).toContain('---');
      expect(md).toContain('name: thinklocal-influxdb');
      expect(md).toContain('version: 1.0.0');
      expect(md).toContain('origin: spiffe://');
      expect(md).toContain('source: thinklocal-mesh');
      expect(md).toContain('# My Custom Prompt');
    });

    it('auto-generates a prompt from manifest when no SKILL.md', () => {
      const md = renderClaudeSkillMarkdown(makeManifest());
      expect(md).toContain('# thinklocal-influxdb');
      expect(md).toContain('Query and write InfluxDB');
      expect(md).toContain('`influxdb.query`');
      expect(md).toContain('`influxdb.write`');
      expect(md).toContain('automatically discovered');
    });

    it('includes required MCP tools section when present', () => {
      const manifest = makeManifest({ requires: { mcp_tools: ['influxdb_query', 'influxdb_write'] } });
      const md = renderClaudeSkillMarkdown(manifest);
      expect(md).toContain('## Required MCP Tools');
      expect(md).toContain('`influxdb_query`');
    });
  });

  describe('installClaudeSkill()', () => {
    it('creates a .md file in the target directory', () => {
      const skill = installSkill(makeManifest(), '# InfluxDB\n\nQuery data.', dataDir);
      const result = installClaudeSkill(skill, claudeDir);
      expect(result.written).toBe(true);
      expect(result.outputPath).toContain('thinklocal-influxdb.md');
      expect(existsSync(result.outputPath)).toBe(true);
      const content = readFileSync(result.outputPath, 'utf8');
      expect(content).toContain('name: thinklocal-influxdb');
      expect(content).toContain('# InfluxDB');
    });

    it('skips write when content is identical (idempotent)', () => {
      const skill = installSkill(makeManifest(), '# Test', dataDir);
      const first = installClaudeSkill(skill, claudeDir);
      expect(first.written).toBe(true);
      const second = installClaudeSkill(skill, claudeDir);
      expect(second.written).toBe(false);
    });

    it('overwrites when content changes', () => {
      const skill1 = installSkill(makeManifest({ version: '1.0.0' }), '# v1', dataDir);
      installClaudeSkill(skill1, claudeDir);
      const skill2 = installSkill(makeManifest({ version: '2.0.0' }), '# v2', dataDir);
      const result = installClaudeSkill(skill2, claudeDir);
      expect(result.written).toBe(true);
      expect(readFileSync(result.outputPath, 'utf8')).toContain('version: 2.0.0');
    });

    it('generates auto-prompt when SKILL.md is missing', () => {
      const skill = installSkill(makeManifest(), undefined, dataDir);
      const result = installClaudeSkill(skill, claudeDir);
      expect(result.written).toBe(true);
      const content = readFileSync(result.outputPath, 'utf8');
      expect(content).toContain('automatically discovered');
    });
  });
});
