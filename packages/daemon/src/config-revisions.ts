/**
 * ADR-007 Phase A PR A2 — Config-Revisions
 *
 * Every configuration change (daemon.toml write, env-override applied,
 * mesh-propagated setting) gets a full before/after snapshot stored in
 * an append-only SQLite table. This enables:
 *
 *   - "What changed?" → `changedKeys` column shows which top-level keys differ
 *   - "When?" → `created_at` timestamp
 *   - "Why?" → `source` field (manual, mesh, rollback, env)
 *   - "Roll back" → `thinklocal config rollback <id>` (Phase D follow-up)
 *
 * Inspired by Paperclip's `agentConfigRevisions` table but adapted
 * for thinklocal's decentralised, TOML-based config model.
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase A PR A2
 * See: BORG.md §2 Step 4 (every pattern → concrete PR)
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';
import type { DaemonConfig } from './config.js';

export type ConfigChangeSource = 'manual' | 'mesh' | 'rollback' | 'env' | 'bootstrap';

export interface ConfigRevisionRow {
  id: number;
  before_config: string; // JSON snapshot
  after_config: string; // JSON snapshot
  changed_keys: string; // comma-separated top-level keys
  source: ConfigChangeSource;
  note: string | null;
  created_at: string; // ISO 8601
}

export class ConfigRevisions {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly log?: Logger;

  constructor(dataDir: string, log?: Logger) {
    const dir = resolve(dataDir, 'config');
    mkdirSync(dir, { recursive: true });
    const dbPath = resolve(dir, 'revisions.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.log = log;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        before_config TEXT NOT NULL,
        after_config TEXT NOT NULL,
        changed_keys TEXT NOT NULL,
        source TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_config_rev_created
        ON config_revisions (created_at DESC);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO config_revisions
        (before_config, after_config, changed_keys, source, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Record a config change. Computes `changedKeys` automatically by
   * comparing the top-level keys of `before` and `after`.
   *
   * Returns the revision id. If nothing changed (before === after on
   * all top-level keys) the write is skipped and `null` is returned.
   */
  record(
    before: DaemonConfig,
    after: DaemonConfig,
    source: ConfigChangeSource,
    note?: string,
  ): number | null {
    const changed = diffTopLevelKeys(before, after);
    if (changed.length === 0) {
      this.log?.debug('[config-revisions] no changes detected, skipping');
      return null;
    }
    const info = this.insertStmt.run(
      JSON.stringify(before),
      JSON.stringify(after),
      changed.join(','),
      source,
      note ?? null,
      new Date().toISOString(),
    );
    const id = info.lastInsertRowid as number;
    this.log?.info(
      { id, changed, source },
      '[config-revisions] recorded',
    );
    return id;
  }

  /** Get the most recent N revisions (newest first). */
  list(limit = 20): ConfigRevisionRow[] {
    return this.db
      .prepare('SELECT * FROM config_revisions ORDER BY id DESC LIMIT ?')
      .all(limit) as ConfigRevisionRow[];
  }

  /** Get a single revision by id. */
  get(id: number): ConfigRevisionRow | undefined {
    return this.db
      .prepare('SELECT * FROM config_revisions WHERE id = ?')
      .get(id) as ConfigRevisionRow | undefined;
  }

  /** Total number of revisions stored. */
  count(): number {
    return (
      this.db.prepare('SELECT COUNT(*) as n FROM config_revisions').get() as {
        n: number;
      }
    ).n;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Compare two DaemonConfig objects and return the list of top-level
 * keys that differ. Uses JSON.stringify per section for deep equality.
 */
function diffTopLevelKeys(a: DaemonConfig, b: DaemonConfig): string[] {
  const aRec = a as unknown as Record<string, unknown>;
  const bRec = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(aRec[key]) !== JSON.stringify(bRec[key])) {
      changed.push(key);
    }
  }
  return changed.sort();
}

/** Exported for tests only. */
export const __test__ = { diffTopLevelKeys };
