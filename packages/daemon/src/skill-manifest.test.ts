import { describe, it, expect } from 'vitest';
import { validateManifest, createExampleManifest } from './skill-manifest.js';

describe('SkillManifest', () => {
  const validManifest = {
    id: 'influxdb.query',
    version: '1.0.0',
    description: 'Queries InfluxDB 1.x databases via HTTP API',
    author_agent: 'spiffe://thinklocal/host/influxdb/agent/claude-code',
    category: 'database',
    runtime: 'node',
    entrypoint: 'influxdb.ts',
    permissions: ['network.read'],
    dependencies: [],
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
    output_schema: {
      type: 'object',
      properties: { results: { type: 'array' } },
    },
    tags: ['influxdb', 'database', 'monitoring'],
  };

  it('akzeptiert gueltiges Manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('lehnt fehlende Pflichtfelder ab', () => {
    const result = validateManifest({ id: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('lehnt ungueltige Skill-ID ab (Grossbuchstaben)', () => {
    const result = validateManifest({ ...validManifest, id: 'MySkill' });
    expect(result.valid).toBe(false);
  });

  it('lehnt ungueltige Version ab', () => {
    const result = validateManifest({ ...validManifest, version: 'latest' });
    expect(result.valid).toBe(false);
  });

  it('lehnt unbekannte Kategorie ab', () => {
    const result = validateManifest({ ...validManifest, category: 'unknown' });
    expect(result.valid).toBe(false);
  });

  it('lehnt unbekannte Runtime ab', () => {
    const result = validateManifest({ ...validManifest, runtime: 'lua' });
    expect(result.valid).toBe(false);
  });

  it('lehnt ungueltige Permissions ab', () => {
    const result = validateManifest({ ...validManifest, permissions: ['admin.root'] });
    expect(result.valid).toBe(false);
  });

  it('lehnt zu kurze Beschreibung ab', () => {
    const result = validateManifest({ ...validManifest, description: 'short' });
    expect(result.valid).toBe(false);
  });

  it('lehnt zusaetzliche Properties ab', () => {
    const result = validateManifest({ ...validManifest, evil: 'data' });
    expect(result.valid).toBe(false);
  });

  it('createExampleManifest erstellt gueltiges Manifest', () => {
    const manifest = createExampleManifest(
      'my-skill',
      'spiffe://thinklocal/host/test/agent/claude-code',
    );
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });
});
