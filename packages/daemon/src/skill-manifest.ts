/**
 * ADR-008 Phase B PR B1 — Skill Manifest (v2)
 *
 * Agent-neutral skill description format. A "skill" is a directory
 * in `~/.thinklocal/skills/<name>/` containing:
 *
 *   manifest.json  — this schema (metadata, capabilities, origin)
 *   SKILL.md       — human/agent-readable instruction prompt
 *
 * The manifest is the machine-readable part; the SKILL.md is what an
 * LLM agent reads as instructions. Agent-specific adapters (Claude
 * Code, Codex, Gemini) can transform both into their native format.
 *
 * Skills can be:
 *   - Built-in: shipped with the daemon install
 *   - Discovered: received from peers via Mesh transport
 *   - User-created: manually added to the skills directory
 *
 * The manifest format is intentionally simple and forward-compatible:
 * unknown fields are preserved, not rejected. This allows newer
 * daemons to add fields without breaking older consumers.
 *
 * Replaces the previous skill-manifest.ts (Phase 3) with the
 * Paperclip-inspired agent-neutral format from BORG.md.
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase B PR B1
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/** Current manifest schema version. Bump on breaking changes. */
export const MANIFEST_FORMAT_VERSION = 1;

export interface SkillManifest {
  /** Unique skill name (directory name, kebab-case). */
  name: string;
  /** SemVer version. */
  version: string;
  /** One-line description for discovery UIs. */
  description: string;
  /** SPIFFE-URI of the peer that originally announced this skill. */
  origin: string;
  /** List of capability identifiers this skill provides. */
  capabilities: string[];
  /** Optional: MCP tools required to execute this skill. */
  requires?: { mcp_tools?: string[] };
  /** Ed25519 signature of the manifest JSON (minus the signature field). */
  signature?: string;
  /** Format version for forward compatibility. */
  format_version: number;
  /** Additional fields from newer versions are preserved. */
  [key: string]: unknown;
}

export interface InstalledSkill {
  manifest: SkillManifest;
  /** Absolute path to the skill directory. */
  dirPath: string;
  /** Whether a SKILL.md prompt file exists. */
  hasPrompt: boolean;
  /** SHA-256 hash of manifest.json content (for activation-state dedup). */
  manifestHash: string;
}

/** Default skills directory. */
export function defaultSkillsDir(dataDir?: string): string {
  return resolve(dataDir ?? resolve(homedir(), '.thinklocal'), 'skills');
}

/**
 * Read a single skill manifest from a directory.
 * Returns null if the directory or manifest.json is missing/invalid.
 */
export function readSkillManifest(skillDir: string): InstalledSkill | null {
  const manifestPath = resolve(skillDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as SkillManifest;
    if (!parsed.name || !parsed.version || !parsed.capabilities) return null;
    return {
      manifest: parsed,
      dirPath: skillDir,
      hasPrompt: existsSync(resolve(skillDir, 'SKILL.md')),
      manifestHash: createHash('sha256').update(raw).digest('hex'),
    };
  } catch {
    return null;
  }
}

/**
 * Scan the skills directory and return all valid installed skills.
 */
export function listInstalledSkills(dataDir?: string): InstalledSkill[] {
  const dir = defaultSkillsDir(dataDir);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const skills: InstalledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = readSkillManifest(resolve(dir, entry.name));
    if (skill) skills.push(skill);
  }
  return skills;
}

/**
 * Install a skill from its manifest + prompt content.
 * Creates `~/.thinklocal/skills/<name>/manifest.json` + optional `SKILL.md`.
 * Overwrites existing if present (idempotent, latest version wins).
 */
export function installSkill(
  manifest: SkillManifest,
  prompt?: string,
  dataDir?: string,
): InstalledSkill {
  const dir = resolve(defaultSkillsDir(dataDir), manifest.name);
  mkdirSync(dir, { recursive: true });
  const raw = JSON.stringify(manifest, null, 2);
  writeFileSync(resolve(dir, 'manifest.json'), raw);
  if (prompt) {
    writeFileSync(resolve(dir, 'SKILL.md'), prompt);
  }
  return {
    manifest,
    dirPath: dir,
    hasPrompt: prompt !== undefined,
    manifestHash: createHash('sha256').update(raw).digest('hex'),
  };
}

/**
 * Build a manifest hash for comparison (activation-state dedup,
 * drift detection). Excludes the signature field so the hash
 * is stable across re-signing.
 */
export function computeManifestHash(manifest: SkillManifest): string {
  const { signature: _sig, ...rest } = manifest;
  return createHash('sha256')
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest('hex');
}
