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
      // Abgelaufen?
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
        this.skills.delete(skillId);
        removed++;
        this.log?.info({ skillId }, 'Skill entfernt (abgelaufen)');
        continue;
      }

      // Seit X Tagen nicht genutzt?
      if (entry.lastUsedAt) {
        const lastUsed = new Date(entry.lastUsedAt).getTime();
        if (now - lastUsed > unusedDays * 86400_000 && entry.status !== 'active') {
          this.skills.delete(skillId);
          removed++;
          this.log?.info({ skillId, daysSinceUse: Math.floor((now - lastUsed) / 86400_000) }, 'Skill entfernt (ungenutzt)');
          continue;
        }
      } else if (entry.usageCount === 0) {
        // Nie genutzt und installiert vor > unusedDays
        const installed = new Date(entry.installedAt).getTime();
        if (now - installed > unusedDays * 86400_000) {
          this.skills.delete(skillId);
          removed++;
          this.log?.info({ skillId }, 'Skill entfernt (nie genutzt)');
        }
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
