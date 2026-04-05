/**
 * skill-deps.ts — Skill-Dependency-Resolution
 *
 * Loest Abhaengigkeiten zwischen Skills auf (wie npm/pip).
 * Jeder Skill kann andere Skills als Dependency deklarieren.
 * Vor der Installation werden alle Dependencies geprueft.
 */

import type { Capability } from './registry.js';
import { satisfiesRange } from './semver.js';
import type { Logger } from 'pino';

export interface SkillDependency {
  /** Skill-ID der Dependency */
  skillId: string;
  /** SemVer-Range (z.B. "^1.0.0", ">=2.0.0") */
  versionRange: string;
  /** Optional? (default: false = required) */
  optional?: boolean;
}

export interface DependencyCheckResult {
  /** Alle Dependencies erfuellt? */
  satisfied: boolean;
  /** Fehlende Dependencies */
  missing: Array<{ skillId: string; versionRange: string; reason: string }>;
  /** Erfuellte Dependencies */
  resolved: Array<{ skillId: string; version: string; agentId: string }>;
}

/**
 * Prueft ob alle Dependencies eines Skills im Mesh verfuegbar sind.
 */
export function checkDependencies(
  dependencies: SkillDependency[],
  availableCapabilities: Capability[],
  log?: Logger,
): DependencyCheckResult {
  const missing: DependencyCheckResult['missing'] = [];
  const resolved: DependencyCheckResult['resolved'] = [];

  for (const dep of dependencies) {
    // Alle Capabilities mit dieser Skill-ID finden
    const candidates = availableCapabilities.filter(
      (c) => c.skill_id === dep.skillId && c.health !== 'offline',
    );

    if (candidates.length === 0) {
      if (!dep.optional) {
        missing.push({
          skillId: dep.skillId,
          versionRange: dep.versionRange,
          reason: 'Nicht im Mesh verfuegbar',
        });
      }
      continue;
    }

    // Version pruefen
    const matching = candidates.find((c) => satisfiesRange(c.version, dep.versionRange));
    if (matching) {
      resolved.push({
        skillId: matching.skill_id,
        version: matching.version,
        agentId: matching.agent_id,
      });
    } else if (!dep.optional) {
      missing.push({
        skillId: dep.skillId,
        versionRange: dep.versionRange,
        reason: `Verfuegbar aber Version inkompatibel (hat: ${candidates.map((c) => c.version).join(', ')})`,
      });
    }
  }

  const satisfied = missing.length === 0;
  if (!satisfied) {
    log?.warn({ missing: missing.length }, 'Skill-Dependencies nicht erfuellt');
  }

  return { satisfied, missing, resolved };
}

/**
 * Berechnet die Installationsreihenfolge (topologische Sortierung).
 * Gibt die Skills in der Reihenfolge zurueck in der sie installiert werden muessen.
 */
export function resolveInstallOrder(
  skillDeps: Map<string, string[]>, // skillId → [dependency-skillIds]
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>(); // Zyklus-Erkennung
  const order: string[] = [];

  function visit(skillId: string): boolean {
    if (visited.has(skillId)) return true;
    if (visiting.has(skillId)) return false; // Zyklus!

    visiting.add(skillId);
    const deps = skillDeps.get(skillId) ?? [];
    for (const dep of deps) {
      if (!visit(dep)) return false;
    }
    visiting.delete(skillId);
    visited.add(skillId);
    order.push(skillId);
    return true;
  }

  for (const skillId of skillDeps.keys()) {
    if (!visit(skillId)) return null; // Zyklus entdeckt
  }

  return order;
}
