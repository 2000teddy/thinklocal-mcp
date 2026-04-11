/**
 * config-rollback.ts — Config Rollback (Phase D3)
 *
 * Extends the config-revisions system (PR #96) with rollback capability.
 * Allows reverting to a previous configuration version.
 *
 * Uses the existing ConfigRevisions to list revisions and restore.
 */

import { ConfigRevisions, type ConfigRevisionRow } from './config-revisions.js';
import { writeFileSync, readFileSync } from 'node:fs';
import type { Logger } from 'pino';

export interface RollbackResult {
  ok: boolean;
  message: string;
  revision?: ConfigRevisionRow;
  applied_config?: Record<string, unknown>;
}

export class ConfigRollback {
  constructor(
    private store: ConfigRevisions,
    private configPath: string,
    private log?: Logger,
  ) {}

  /**
   * List available revisions to roll back to.
   */
  listRevisions(limit = 20): ConfigRevisionRow[] {
    return this.store.list(limit);
  }

  /**
   * Get a specific revision by ID.
   */
  getRevision(id: number): ConfigRevisionRow | undefined {
    return this.store.get(id);
  }

  /**
   * Rollback to a specific revision by restoring its "before" state.
   * Records a new revision with source='rollback'.
   */
  rollbackTo(revisionId: number): RollbackResult {
    const target = this.store.get(revisionId);
    if (!target) {
      return { ok: false, message: `Revision ${revisionId} not found` };
    }

    // The "before" snapshot of the target revision is what we want to restore
    const configToRestore = target.before_config;
    if (!configToRestore) {
      return { ok: false, message: `Revision ${revisionId} has no before_config snapshot` };
    }

    try {
      // Read current config as "before" for the rollback revision
      const currentConfig = readFileSync(this.configPath, 'utf-8');

      // Write the restored config
      writeFileSync(this.configPath, configToRestore, 'utf-8');

      // Record this rollback as a new revision
      // ConfigRevisions.record() takes DaemonConfig objects (parsed JSON)
      try {
        const currentParsed = JSON.parse(currentConfig);
        const restoredParsed = JSON.parse(configToRestore);
        this.store.record(currentParsed, restoredParsed, 'rollback');
      } catch {
        // If JSON parsing fails, skip recording the rollback revision
        this.log?.warn('Could not record rollback revision: config is not valid JSON');
      }

      this.log?.info(
        { revisionId, configPath: this.configPath },
        'Config rolled back successfully',
      );

      return {
        ok: true,
        message: `Rolled back to revision ${revisionId} (before state)`,
        revision: target,
        applied_config: JSON.parse(configToRestore),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log?.error({ err: msg, revisionId }, 'Config rollback failed');
      return { ok: false, message: `Rollback failed: ${msg}` };
    }
  }

  /**
   * Rollback to the previous revision (most recent change undone).
   */
  rollbackLast(): RollbackResult {
    const revisions = this.store.list(1);
    if (revisions.length === 0) {
      return { ok: false, message: 'No revisions to rollback' };
    }
    return this.rollbackTo(revisions[0].id);
  }
}
