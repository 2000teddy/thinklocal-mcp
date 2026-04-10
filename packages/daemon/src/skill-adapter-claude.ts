/**
 * ADR-008 Phase B PR B2 — Claude Code Skill Adapter
 *
 * First agent-specific adapter: transforms a neutral skill manifest
 * + SKILL.md into a Claude Code compatible skill file at
 * `<project>/.claude/skills/<name>.md` or `~/.claude/skills/<name>.md`.
 *
 * Claude Code Skills are markdown files that the agent reads as
 * system-level instructions. This adapter generates them from the
 * neutral `manifest.json` + `SKILL.md` pair, prepending a metadata
 * header so the origin and version are traceable.
 *
 * Future adapters (Codex, Gemini) will follow the same interface
 * but generate their native format (custom instructions, system
 * prompts, etc).
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase B PR B2
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { SkillManifest, InstalledSkill } from './skill-manifest.js';

export interface AdapterResult {
  /** Path where the Claude Code skill file was written. */
  outputPath: string;
  /** Whether the file was created (true) or already existed with same content (false). */
  written: boolean;
}

/**
 * Default Claude Code skills directories. Claude Code looks for
 * skills in `<cwd>/.claude/skills/` first, then `~/.claude/skills/`.
 * We default to the global user-level path.
 */
export function defaultClaudeSkillsDir(): string {
  return resolve(homedir(), '.claude', 'skills');
}

/**
 * Generate the Claude Code skill markdown from a neutral manifest + prompt.
 *
 * Format:
 * ```markdown
 * ---
 * name: <skill-name>
 * version: <version>
 * origin: <spiffe-uri>
 * source: thinklocal-mesh
 * ---
 *
 * <SKILL.md content>
 * ```
 *
 * If no SKILL.md exists in the neutral skill, a minimal placeholder
 * is generated from the manifest description and capabilities.
 */
export function renderClaudeSkillMarkdown(
  manifest: SkillManifest,
  prompt?: string,
): string {
  const header = [
    '---',
    `name: ${manifest.name}`,
    `version: ${manifest.version}`,
    `origin: ${manifest.origin}`,
    `source: thinklocal-mesh`,
    `capabilities: ${manifest.capabilities.join(', ')}`,
    '---',
    '',
  ].join('\n');

  if (prompt) {
    return `${header}${prompt}`;
  }

  // Auto-generate a minimal prompt from the manifest.
  const lines = [
    header,
    `# ${manifest.name}`,
    '',
    manifest.description,
    '',
    '## Capabilities',
    '',
    ...manifest.capabilities.map((c) => `- \`${c}\``),
    '',
    '## Usage',
    '',
    `This skill was automatically discovered from a ThinkLocal mesh peer.`,
    `Origin: ${manifest.origin}`,
    '',
  ];
  if (manifest.requires?.mcp_tools?.length) {
    lines.push('## Required MCP Tools', '');
    for (const tool of manifest.requires.mcp_tools) {
      lines.push(`- \`${tool}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Install a skill as a Claude Code skill file.
 *
 * @param skill     The neutral installed skill (from skill-manifest.ts)
 * @param targetDir Override the Claude Code skills directory (for tests)
 * @returns path where the file was written + whether it was actually written
 */
export function installClaudeSkill(
  skill: InstalledSkill,
  targetDir?: string,
): AdapterResult {
  const dir = targetDir ?? defaultClaudeSkillsDir();
  mkdirSync(dir, { recursive: true });

  const prompt = skill.hasPrompt
    ? readFileSync(resolve(skill.dirPath, 'SKILL.md'), 'utf8')
    : undefined;

  const content = renderClaudeSkillMarkdown(skill.manifest, prompt);
  const outputPath = resolve(dir, `${skill.manifest.name}.md`);

  // Avoid unnecessary writes (preserves file mtime for watchers).
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, 'utf8');
    if (existing === content) {
      return { outputPath, written: false };
    }
  }

  writeFileSync(outputPath, content);
  return { outputPath, written: true };
}
