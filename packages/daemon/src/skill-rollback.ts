/**
 * skill-rollback.ts — Rollback-Mechanismus bei fehlgeschlagener Skill-Installation
 *
 * Speichert vor jeder Skill-Installation einen Snapshot.
 * Bei Fehlschlag wird der vorherige Zustand wiederhergestellt.
 */

import { existsSync, mkdirSync, cpSync, rmSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

export class SkillRollback {
  private backupDir: string;

  constructor(
    dataDir: string,
    private log?: Logger,
  ) {
    this.backupDir = resolve(dataDir, 'skill-backups');
    mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Erstellt einen Backup-Snapshot eines Skills vor der Installation.
   * Gibt die Backup-ID zurueck (oder null wenn kein vorheriger Zustand).
   */
  createBackup(skillId: string, skillDir: string): string | null {
    if (!existsSync(skillDir)) return null;

    const backupId = `${skillId}-${Date.now()}`;
    const backupPath = resolve(this.backupDir, backupId);

    try {
      cpSync(skillDir, backupPath, { recursive: true });
      this.log?.info({ skillId, backupId }, 'Skill-Backup erstellt');
      return backupId;
    } catch (err) {
      this.log?.warn({ skillId, err }, 'Skill-Backup fehlgeschlagen');
      return null;
    }
  }

  /**
   * Stellt einen Skill aus einem Backup wieder her.
   */
  restore(backupId: string, targetDir: string): boolean {
    const backupPath = resolve(this.backupDir, backupId);
    if (!existsSync(backupPath)) {
      this.log?.warn({ backupId }, 'Backup nicht gefunden');
      return false;
    }

    try {
      // Aktuellen (fehlgeschlagenen) Zustand entfernen
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true });
      }
      // Backup wiederherstellen
      renameSync(backupPath, targetDir);
      this.log?.info({ backupId }, 'Skill aus Backup wiederhergestellt');
      return true;
    } catch (err) {
      this.log?.warn({ backupId, err }, 'Skill-Rollback fehlgeschlagen');
      return false;
    }
  }

  /**
   * Entfernt ein Backup (nach erfolgreicher Installation).
   */
  removeBackup(backupId: string): void {
    const backupPath = resolve(this.backupDir, backupId);
    try {
      if (existsSync(backupPath)) {
        rmSync(backupPath, { recursive: true });
      }
    } catch { /* ok */ }
  }

  /**
   * Rauemt alte Backups auf (aelter als maxAge).
   */
  cleanOldBackups(maxAgeMs: number = 7 * 24 * 3600_000): number {
    // Backup-IDs enthalten Timestamp: "skillId-1234567890"
    let cleaned = 0;
    const now = Date.now();
    try {
      const { readdirSync } = require('node:fs');
      const entries = readdirSync(this.backupDir) as string[];
      for (const entry of entries) {
        const parts = entry.split('-');
        const ts = Number(parts[parts.length - 1]);
        if (ts && now - ts > maxAgeMs) {
          rmSync(resolve(this.backupDir, entry), { recursive: true });
          cleaned++;
        }
      }
    } catch { /* ok */ }
    return cleaned;
  }
}
