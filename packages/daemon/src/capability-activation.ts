/**
 * ADR-008 Phase B PR B3 — Capability Activation State
 *
 * 4-state model for tracking whether a discovered capability is
 * actually usable on this node:
 *
 *   discovered → active → suspended → revoked
 *
 * - **discovered**: seen in Mesh CRDT, not yet locally activated.
 * - **active**: validated + policy-passed, can be used by agents.
 * - **suspended**: admin-override, temporarily disabled.
 * - **revoked**: permanently removed (security incident).
 *
 * Default transition: `discovered → active` is AUTOMATIC for signed
 * skills from paired peers (the "ioBroker moment"). Approval gates
 * (from PR A3) only gate sensitive operations, not normal discovery.
 *
 * The `metadata_json` column is reserved for future state extensions
 * (e.g. `quarantined`, `deprecated`) without schema migration.
 *
 * Multi-model consensus 2026-04-10: GPT-5.1 + Claude Opus endorsed
 * 4 states, Gemini-Pro wanted 5 — compromise: 4 now, metadata_json
 * for extensibility.
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md Phase B PR B3
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';

export type CapabilityState = 'discovered' | 'active' | 'suspended' | 'revoked';

export interface CapabilityActivationRow {
  id: number;
  capability_id: string;
  version: string;
  origin_peer: string;
  state: CapabilityState;
  manifest_hash: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  metadata_json: string | null;
  updated_at: string;
}

export class CapabilityActivationStore {
  private readonly db: Database.Database;
  private readonly log?: Logger;

  constructor(dataDir: string, log?: Logger) {
    const dir = resolve(dataDir, 'capabilities');
    mkdirSync(dir, { recursive: true });
    this.db = new Database(resolve(dir, 'activation.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.log = log;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capability_activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capability_id TEXT NOT NULL,
        version TEXT NOT NULL,
        origin_peer TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'discovered'
          CHECK(state IN ('discovered','active','suspended','revoked')),
        manifest_hash TEXT,
        activated_at TEXT,
        suspended_at TEXT,
        revoked_at TEXT,
        metadata_json TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(capability_id, origin_peer)
      );
      CREATE INDEX IF NOT EXISTS idx_cap_state ON capability_activations (state);
      CREATE INDEX IF NOT EXISTS idx_cap_origin ON capability_activations (origin_peer);
    `);
  }

  /**
   * Record a newly discovered capability. If it already exists from
   * the same origin, update its version + hash (drift detection).
   * Returns the row id.
   */
  discover(
    capabilityId: string,
    version: string,
    originPeer: string,
    manifestHash?: string,
  ): number {
    const now = new Date().toISOString();
    const existing = this.get(capabilityId, originPeer);
    if (existing) {
      // Update version + hash if changed, keep state.
      this.db
        .prepare(
          `UPDATE capability_activations SET version = ?, manifest_hash = ?, updated_at = ? WHERE id = ?`,
        )
        .run(version, manifestHash ?? null, now, existing.id);
      return existing.id;
    }
    const info = this.db
      .prepare(
        `INSERT INTO capability_activations (capability_id, version, origin_peer, state, manifest_hash, updated_at) VALUES (?, ?, ?, 'discovered', ?, ?)`,
      )
      .run(capabilityId, version, originPeer, manifestHash ?? null, now);
    this.log?.info({ capabilityId, version, originPeer }, '[capability] discovered');
    return info.lastInsertRowid as number;
  }

  /**
   * Activate a discovered capability. Only `discovered` and `suspended`
   * states can transition to `active`.
   */
  activate(capabilityId: string, originPeer: string): boolean {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `UPDATE capability_activations SET state = 'active', activated_at = ?, updated_at = ? WHERE capability_id = ? AND origin_peer = ? AND state IN ('discovered', 'suspended')`,
      )
      .run(now, now, capabilityId, originPeer);
    if (info.changes > 0) {
      this.log?.info({ capabilityId, originPeer }, '[capability] activated');
    }
    return info.changes > 0;
  }

  /**
   * Suspend an active capability (admin-override).
   * Only `active` state can transition to `suspended`.
   */
  suspend(capabilityId: string, originPeer: string, reason?: string): boolean {
    const now = new Date().toISOString();
    // Merge reason into existing metadata instead of overwriting.
    // (Gemini-Pro retroactive CR MEDIUM: metadata_json merge)
    const current = this.get(capabilityId, originPeer);
    if (!current || current.state !== 'active') {
      return false;
    }
    const existingMeta = current.metadata_json ? JSON.parse(current.metadata_json) as Record<string, unknown> : {};
    const merged = reason ? { ...existingMeta, suspend_reason: reason } : existingMeta;
    const info = this.db
      .prepare(
        `UPDATE capability_activations SET state = 'suspended', suspended_at = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND state = 'active'`,
      )
      .run(now, Object.keys(merged).length > 0 ? JSON.stringify(merged) : null, now, current.id);
    if (info.changes > 0) {
      this.log?.info({ capabilityId, originPeer, reason }, '[capability] suspended');
    }
    return info.changes > 0;
  }

  /**
   * Permanently revoke a capability (security incident).
   * Any non-revoked state can transition to `revoked`.
   */
  revoke(capabilityId: string, originPeer: string, reason?: string): boolean {
    const now = new Date().toISOString();
    // Merge reason into existing metadata (Gemini-Pro retroactive CR MEDIUM)
    const current = this.get(capabilityId, originPeer);
    if (!current || current.state === 'revoked') {
      return false;
    }
    const existingMeta = current.metadata_json ? JSON.parse(current.metadata_json) as Record<string, unknown> : {};
    const merged = reason ? { ...existingMeta, revoke_reason: reason } : existingMeta;
    const info = this.db
      .prepare(
        `UPDATE capability_activations SET state = 'revoked', revoked_at = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND state != 'revoked'`,
      )
      .run(now, Object.keys(merged).length > 0 ? JSON.stringify(merged) : null, now, current.id);
    if (info.changes > 0) {
      this.log?.warn({ capabilityId, originPeer, reason }, '[capability] REVOKED');
    }
    return info.changes > 0;
  }

  /** Get a specific capability activation. */
  get(capabilityId: string, originPeer: string): CapabilityActivationRow | null {
    return (
      this.db
        .prepare(
          'SELECT * FROM capability_activations WHERE capability_id = ? AND origin_peer = ?',
        )
        .get(capabilityId, originPeer) as CapabilityActivationRow | undefined
    ) ?? null;
  }

  /** List all capabilities in a given state. */
  listByState(state: CapabilityState): CapabilityActivationRow[] {
    return this.db
      .prepare('SELECT * FROM capability_activations WHERE state = ? ORDER BY updated_at DESC')
      .all(state) as CapabilityActivationRow[];
  }

  /** List all active capabilities (the primary runtime query). */
  listActive(): CapabilityActivationRow[] {
    return this.listByState('active');
  }

  /** Count capabilities per state. */
  countByState(): Record<CapabilityState, number> {
    const rows = this.db
      .prepare(
        'SELECT state, COUNT(*) as n FROM capability_activations GROUP BY state',
      )
      .all() as Array<{ state: CapabilityState; n: number }>;
    const counts: Record<CapabilityState, number> = {
      discovered: 0,
      active: 0,
      suspended: 0,
      revoked: 0,
    };
    for (const row of rows) {
      counts[row.state] = row.n;
    }
    return counts;
  }

  /** Check if a capability is active (the gate for execution). */
  isActive(capabilityId: string, originPeer: string): boolean {
    const row = this.get(capabilityId, originPeer);
    return row?.state === 'active';
  }

  close(): void {
    this.db.close();
  }
}
