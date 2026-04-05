import { describe, it, expect } from 'vitest';
import { checkDependencies, resolveInstallOrder } from './skill-deps.js';
import type { Capability } from './registry.js';

describe('SkillDependencies', () => {
  const capabilities: Capability[] = [
    { skill_id: 'influxdb.query', version: '1.2.0', description: '', agent_id: 'a', health: 'healthy', trust_level: 1, updated_at: '', category: '', permissions: [] },
    { skill_id: 'system.health', version: '2.0.0', description: '', agent_id: 'b', health: 'healthy', trust_level: 1, updated_at: '', category: '', permissions: [] },
  ];

  describe('checkDependencies', () => {
    it('erfuellt wenn alle Dependencies vorhanden', () => {
      const result = checkDependencies([
        { skillId: 'influxdb.query', versionRange: '^1.0.0' },
      ], capabilities);
      expect(result.satisfied).toBe(true);
      expect(result.resolved).toHaveLength(1);
    });

    it('fehlgeschlagen wenn Dependency fehlt', () => {
      const result = checkDependencies([
        { skillId: 'nonexistent.skill', versionRange: '>=1.0.0' },
      ], capabilities);
      expect(result.satisfied).toBe(false);
      expect(result.missing).toHaveLength(1);
    });

    it('fehlgeschlagen wenn Version inkompatibel', () => {
      const result = checkDependencies([
        { skillId: 'influxdb.query', versionRange: '>=2.0.0' },
      ], capabilities);
      expect(result.satisfied).toBe(false);
      expect(result.missing[0].reason).toContain('inkompatibel');
    });

    it('optionale Dependency ignoriert wenn fehlend', () => {
      const result = checkDependencies([
        { skillId: 'optional.skill', versionRange: '>=1.0.0', optional: true },
      ], capabilities);
      expect(result.satisfied).toBe(true);
    });
  });

  describe('resolveInstallOrder', () => {
    it('topologische Sortierung korrekt', () => {
      const deps = new Map([
        ['c', ['b']],
        ['b', ['a']],
        ['a', []],
      ]);
      const order = resolveInstallOrder(deps);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('erkennt Zyklen', () => {
      const deps = new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]);
      expect(resolveInstallOrder(deps)).toBeNull();
    });

    it('unabhaengige Skills in beliebiger Reihenfolge', () => {
      const deps = new Map([
        ['a', []],
        ['b', []],
      ]);
      const order = resolveInstallOrder(deps);
      expect(order).toHaveLength(2);
      expect(order).toContain('a');
      expect(order).toContain('b');
    });
  });
});
