/**
 * skill-manifest.ts — Skill-Manifest-Schema und Validierung
 *
 * Definiert das JSON-Schema fuer Skill-Pakete im thinklocal-mcp Mesh.
 * Jeder Skill muss ein gueltiges Manifest haben um installiert zu werden.
 */

import { Validator } from '@cfworker/json-schema';
import type { Logger } from 'pino';

// --- Skill-Manifest TypeScript-Typen ---

export type SkillRuntime = 'node' | 'wasm' | 'docker' | 'python' | 'binary';

export interface SkillManifest {
  /** Eindeutige Skill-ID (z.B. "influxdb.query") */
  id: string;
  /** SemVer-Version */
  version: string;
  /** Menschenlesbare Beschreibung */
  description: string;
  /** SPIFFE-URI des Autors */
  author_agent: string;
  /** Kategorie (z.B. "database", "monitoring", "ai") */
  category: string;
  /** Runtime-Umgebung */
  runtime: SkillRuntime;
  /** Einstiegspunkt (relativ zum Skill-Verzeichnis) */
  entrypoint: string;
  /** Benoetigte Berechtigungen */
  permissions: string[];
  /** Abhaengigkeiten (andere Skill-IDs) */
  dependencies: string[];
  /** Input-Schema (JSON Schema draft-07) */
  input_schema: Record<string, unknown>;
  /** Output-Schema (JSON Schema draft-07) */
  output_schema: Record<string, unknown>;
  /** Minimale thinklocal-Version */
  min_version?: string;
  /** Tags fuer Discovery */
  tags?: string[];
}

// --- JSON Schema fuer das Manifest selbst ---

export const SKILL_MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://thinklocal.dev/schemas/skill-manifest.json',
  type: 'object',
  required: ['id', 'version', 'description', 'author_agent', 'category', 'runtime', 'entrypoint', 'permissions', 'input_schema', 'output_schema'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-z][a-z0-9._-]*$',
      minLength: 2,
      maxLength: 64,
      description: 'Eindeutige Skill-ID (lowercase, dots/hyphens erlaubt)',
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+',
      description: 'SemVer-Version',
    },
    description: {
      type: 'string',
      minLength: 10,
      maxLength: 500,
      description: 'Menschenlesbare Beschreibung',
    },
    author_agent: {
      type: 'string',
      pattern: '^spiffe://',
      description: 'SPIFFE-URI des Autors',
    },
    category: {
      type: 'string',
      enum: ['database', 'monitoring', 'ai', 'automation', 'networking', 'security', 'storage', 'messaging', 'custom'],
    },
    runtime: {
      type: 'string',
      enum: ['node', 'wasm', 'docker', 'python', 'binary'],
    },
    entrypoint: {
      type: 'string',
      minLength: 1,
      description: 'Relativer Pfad zum Einstiegspunkt',
    },
    permissions: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['system.read', 'system.write', 'network.read', 'network.write', 'fs.read', 'fs.write', 'credential.read', 'credential.write', 'process.execute'],
      },
      description: 'Benoetigte Berechtigungen',
    },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
      default: [],
      description: 'Abhaengige Skill-IDs',
    },
    input_schema: {
      type: 'object',
      description: 'JSON Schema fuer Skill-Input',
    },
    output_schema: {
      type: 'object',
      description: 'JSON Schema fuer Skill-Output',
    },
    min_version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+',
      description: 'Minimale thinklocal-Version',
    },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 32 },
      maxItems: 10,
      description: 'Tags fuer Discovery',
    },
  },
} as const;

// --- Validierung ---

const manifestValidator = new Validator(SKILL_MANIFEST_SCHEMA);

/**
 * Validiert ein Skill-Manifest gegen das Schema.
 * Gibt Fehlermeldungen zurueck wenn ungueltig.
 */
export function validateManifest(manifest: unknown, log?: Logger): { valid: boolean; errors: string[] } {
  const result = manifestValidator.validate(manifest);
  if (!result.valid) {
    const errors = result.errors.map((e) => `${e.instanceLocation}: ${e.error}`);
    log?.warn({ errors }, 'Skill-Manifest ungueltig');
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}

/**
 * Erstellt ein Beispiel-Manifest fuer einen neuen Skill.
 */
export function createExampleManifest(skillId: string, authorAgent: string): SkillManifest {
  return {
    id: skillId,
    version: '1.0.0',
    description: `${skillId} — Beschreibung des Skills`,
    author_agent: authorAgent,
    category: 'custom',
    runtime: 'node',
    entrypoint: 'index.ts',
    permissions: ['system.read'],
    dependencies: [],
    input_schema: {
      type: 'object',
      properties: {},
    },
    output_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
    tags: [skillId],
  };
}
