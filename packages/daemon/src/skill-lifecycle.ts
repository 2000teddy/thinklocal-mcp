/**
 * skill-lifecycle.ts — Skill Lifecycle Management
 *
 * Verhindert dass sich veraltete Skills ansammeln.
 * Implementiert:
 * - Expiry-Policies: Skills verfallen nach konfigurierter Zeit
 * - Usage-Tracking: Zählt wie oft ein Skill genutzt wird
 * - Deprecation-Workflow: Markiert Skills als deprecated vor dem Loeschen
 * - Garbage Collection: Entfernt ungenutzte/abgelaufene Skills
 */

import type { Logger } from 'pino';

export type SkillStatus = 'active' | 'deprecated' | 'expired' | 'disabled';

export interface SkillLifecycleEntry {
  skillId: string;
  status: SkillStatus;
  installedAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  deprecatedAt?: string;
  deprecationReason?: string;
  expiresAt?: string;
}

export class SkillLifecycleManager {
  private skills = new Map<string, SkillLifecycleEntry>();

  constructor(
    private defaultExpiryDays: number = 90,
    private log?: Logger,
  ) {}

  /** Registriert einen neuen Skill */
  register(skillId: string, expiryDays?: number): void {
    const days = expiryDays ?? this.defaultExpiryDays;
    const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();

    this.skills.set(skillId, {
      skillId,
      status: 'active',
      installedAt: new Date().toISOString(),
      lastUsedAt: null,
      usageCount: 0,
      expiresAt,
    });
    this.log?.info({ skillId, expiresAt }, 'Skill registriert');
  }

  /** Vermerkt eine Nutzung */
  recordUsage(skillId: string): void {
    const entry = this.skills.get(skillId);
    if (!entry) return;
    entry.lastUsedAt = new Date().toISOString();
    entry.usageCount++;
  }

  /** Markiert einen Skill als deprecated */
  deprecate(skillId: string, reason: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry) return false;
    entry.status = 'deprecated';
    entry.deprecatedAt = new Date().toISOString();
    entry.deprecationReason = reason;
    this.log?.warn({ skillId, reason }, 'Skill als deprecated markiert');
    return true;
  }

  /** Deaktiviert einen Skill (kann reaktiviert werden) */
  disable(skillId: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry) return false;
    entry.status = 'disabled';
    return true;
  }

  /** Reaktiviert einen deaktivierten Skill */
  enable(skillId: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry || entry.status === 'expired') return false;
    entry.status = 'active';
    return true;
  }

  /**
   * Garbage Collection: Entfernt abgelaufene und lange ungenutzte Skills.
   * Gibt die Anzahl entfernter Skills zurueck.
   */
  gc(unusedDays = 30): number {
    const now = Date.now();
    let removed = 0;

    for (const [skillId, entry] of this.skills) {
      // SECURITY: Active Skills werden NIE per GC geloescht (nur expired/deprecated/disabled)
      if (entry.status === 'active') {
        // Aber abgelaufene Skills werden markiert
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
          entry.status = 'expired';
          this.log?.info({ skillId }, 'Skill als expired markiert');
        }
        continue;
      }

      // Abgelaufen?
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
        this.skills.delete(skillId);
        removed++;
        this.log?.info({ skillId }, 'Skill entfernt (abgelaufen)');
        continue;
      }

      // Seit X Tagen nicht genutzt? (nur deprecated/disabled)
      const lastActivity = entry.lastUsedAt ?? entry.installedAt;
      const lastActivityTime = new Date(lastActivity).getTime();
      if (now - lastActivityTime > unusedDays * 86400_000) {
        this.skills.delete(skillId);
        removed++;
        this.log?.info({ skillId, status: entry.status, daysSinceActivity: Math.floor((now - lastActivityTime) / 86400_000) }, 'Skill entfernt (ungenutzt)');
      }
    }

    return removed;
  }

  /** Gibt alle Skills mit Status zurueck */
  list(): SkillLifecycleEntry[] {
    return [...this.skills.values()];
  }

  /** Gibt einen spezifischen Skill zurueck */
  get(skillId: string): SkillLifecycleEntry | undefined {
    return this.skills.get(skillId);
  }

  /** Statistik */
  getStats(): {
    total: number;
    active: number;
    deprecated: number;
    expired: number;
    disabled: number;
    totalUsage: number;
  } {
    const entries = [...this.skills.values()];
    return {
      total: entries.length,
      active: entries.filter((e) => e.status === 'active').length,
      deprecated: entries.filter((e) => e.status === 'deprecated').length,
      expired: entries.filter((e) => e.status === 'expired').length,
      disabled: entries.filter((e) => e.status === 'disabled').length,
      totalUsage: entries.reduce((sum, e) => sum + e.usageCount, 0),
    };
  }
}
