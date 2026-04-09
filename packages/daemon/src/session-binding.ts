/**
 * ADR-006 Phase 1 — Session Binding (orphan scan + fingerprint matching)
 *
 * At daemon boot, scan `~/.thinklocal/sessions/` for directories
 * that contain a `state.json` whose `pid` is no longer alive.
 * Each such directory is an orphan: the agent crashed, ran out
 * of tokens, or otherwise died without a clean unregister.
 *
 * When a new agent starts, it calls `findOrphansForFingerprint()`
 * with `(cwd, gitBranch, agentType)`. The binding module returns:
 *
 *   - 0 orphans → start a fresh session
 *   - 1 orphan  → auto-resume (clear match)
 *   - N orphans → caller should prompt the user (application-layer
 *                 decision; binding stays neutral)
 *
 * The match is **application-layer routing**, not cryptographically
 * attested — exactly as ADR-005 and ADR-006 spell out.
 *
 * See: docs/architecture/ADR-006-session-persistence.md §Architektur/6
 */
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultSessionsRoot, readSessionState, isPidAlive, type SessionState } from './session-state.js';

export interface SessionFingerprint {
  cwd: string;
  gitBranch: string;
  agentType: string;
}

export interface OrphanSession {
  state: SessionState;
  /** Absolute path to the session's directory. */
  sessionDirPath: string;
}

export interface SessionBindingOptions {
  dataDir?: string;
  /** Override `process.kill`-based liveness check for tests. */
  isAlive?: (pid: number | null | undefined) => boolean;
}

export class SessionBinding {
  private readonly dataDir?: string;
  private readonly isAlive: (pid: number | null | undefined) => boolean;

  constructor(opts: SessionBindingOptions = {}) {
    this.dataDir = opts.dataDir;
    this.isAlive = opts.isAlive ?? isPidAlive;
  }

  /**
   * Enumerate every session directory on disk. Returns both live
   * and orphaned entries; the caller can filter as needed.
   */
  async listAllSessions(): Promise<Array<{ state: SessionState; path: string; alive: boolean }>> {
    const root = defaultSessionsRoot(this.dataDir);
    if (!existsSync(root)) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const out: Array<{ state: SessionState; path: string; alive: boolean }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const uuid = entry.name;
      const state = await readSessionState(this.dataDir, uuid).catch(() => null);
      if (!state) continue;
      out.push({
        state,
        path: resolve(root, uuid),
        alive: this.isAlive(state.pid),
      });
    }
    return out;
  }

  /** Return only the orphaned sessions (PID dead). */
  async listOrphans(): Promise<OrphanSession[]> {
    const all = await this.listAllSessions();
    return all
      .filter((e) => !e.alive)
      .map((e) => ({ state: e.state, sessionDirPath: e.path }));
  }

  /**
   * Find orphaned sessions whose fingerprint matches the caller's
   * `(cwd, gitBranch, agentType)`. Strict equality on all three
   * fields — the fingerprint is the primary routing key for
   * auto-resume.
   */
  async findOrphansForFingerprint(fp: SessionFingerprint): Promise<OrphanSession[]> {
    const orphans = await this.listOrphans();
    return orphans.filter(
      (o) =>
        o.state.cwd === fp.cwd &&
        o.state.gitBranch === fp.gitBranch &&
        o.state.agentType === fp.agentType,
    );
  }
}
