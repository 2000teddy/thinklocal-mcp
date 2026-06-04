import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedBuiltinSkills } from './builtin-skill-seed.js';
import { MANIFEST_FORMAT_VERSION } from './skill-manifest.js';

const OWN_ID = 'spiffe://thinklocal/host/local/agent/claude-code';

describe('seedBuiltinSkills', () => {
  let dataDir: string;
  let sourceDir: string;

  beforeEach(() => {
    dataDir = mkdtemp('tlmcp-data-');
    sourceDir = mkdtemp('tlmcp-builtin-');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    delete process.env['TLMCP_BUILTIN_SKILLS_DIR'];
  });

  it('installs neutral builtin skills into the runtime skills directory', () => {
    const skillDir = join(sourceDir, 'thinklocal-ollama-agents');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'manifest.json'),
      JSON.stringify({
        name: 'thinklocal-ollama-agents',
        version: '1.0.0',
        description: 'Expose Ollama agents',
        origin: 'builtin',
        capabilities: ['ollama.agent.delegate'],
        format_version: MANIFEST_FORMAT_VERSION,
      }),
    );
    writeFileSync(join(skillDir, 'SKILL.md'), '# Ollama Agents\n');

    const result = seedBuiltinSkills({ dataDir, sourceDir, ownAgentId: OWN_ID });

    expect(result.installed).toEqual(['thinklocal-ollama-agents']);
    expect(result.manifests[0]!.capabilities).toEqual(['ollama.agent.delegate']);
    const installedManifest = join(dataDir, 'skills', 'thinklocal-ollama-agents', 'manifest.json');
    const installedPrompt = join(dataDir, 'skills', 'thinklocal-ollama-agents', 'SKILL.md');
    expect(existsSync(installedManifest)).toBe(true);
    expect(existsSync(installedPrompt)).toBe(true);
    expect(JSON.parse(readFileSync(installedManifest, 'utf8')).capabilities).toEqual([
      'ollama.agent.delegate',
    ]);
  });

  it('uses ownAgentId as origin when a builtin manifest leaves origin empty', () => {
    const skillDir = join(sourceDir, 'local-only');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'manifest.json'),
      JSON.stringify({
        name: 'local-only',
        version: '1.0.0',
        description: 'Local skill',
        origin: '',
        capabilities: ['local.do'],
        format_version: MANIFEST_FORMAT_VERSION,
      }),
    );

    seedBuiltinSkills({ dataDir, sourceDir, ownAgentId: OWN_ID });

    const manifest = JSON.parse(
      readFileSync(join(dataDir, 'skills', 'local-only', 'manifest.json'), 'utf8'),
    );
    expect(manifest.origin).toBe(OWN_ID);
  });

  it('returns an empty result when sourceDir is missing', () => {
    const result = seedBuiltinSkills({
      dataDir,
      sourceDir: join(sourceDir, 'missing'),
      ownAgentId: OWN_ID,
    });

    expect(result.installed).toEqual([]);
    expect(result.manifests).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

function mkdtemp(prefix: string): string {
  return join(tmpdir(), `${prefix}${Math.random().toString(16).slice(2)}`);
}
