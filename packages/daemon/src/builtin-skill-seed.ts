/**
 * Seeds repository-shipped neutral skills into the runtime skills directory.
 *
 * ADR-008 skills are discovered from `~/.thinklocal/skills`, while built-in
 * skill definitions live in the repository/package. This bridge keeps the
 * neutral manifest flow intact: built-ins are copied through installSkill()
 * instead of being special-cased in discovery.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { installSkill, type SkillManifest } from './skill-manifest.js';

export interface SeedBuiltinSkillsOptions {
  dataDir: string;
  sourceDir?: string;
  ownAgentId: string;
  log?: Logger;
}

export interface SeedBuiltinSkillsResult {
  sourceDir: string;
  installed: string[];
  manifests: SkillManifest[];
  skipped: string[];
}

export function seedBuiltinSkills(options: SeedBuiltinSkillsOptions): SeedBuiltinSkillsResult {
  const sourceDir = options.sourceDir
    ?? process.env['TLMCP_BUILTIN_SKILLS_DIR']
    ?? resolve(process.cwd(), 'skills', 'builtin');
  const result: SeedBuiltinSkillsResult = { sourceDir, installed: [], manifests: [], skipped: [] };

  if (!existsSync(sourceDir)) {
    options.log?.debug({ sourceDir }, 'Builtin-Skill-Quelle nicht vorhanden');
    return result;
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = resolve(sourceDir, entry.name);
    const manifestPath = resolve(skillDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      result.skipped.push(entry.name);
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SkillManifest;
      const promptPath = resolve(skillDir, 'SKILL.md');
      const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : undefined;
      const installedManifest = { ...manifest, origin: manifest.origin || options.ownAgentId };
      installSkill(installedManifest, prompt, options.dataDir);
      result.installed.push(installedManifest.name);
      result.manifests.push(installedManifest);
    } catch (err) {
      result.skipped.push(entry.name);
      options.log?.warn(
        { skillDir, err: err instanceof Error ? err.message : String(err) },
        'Builtin-Skill konnte nicht installiert werden',
      );
    }
  }

  if (result.installed.length > 0) {
    options.log?.info(
      { skills: result.installed, sourceDir },
      'Builtin-Skills in Runtime-Skill-Verzeichnis installiert',
    );
  }

  return result;
}
