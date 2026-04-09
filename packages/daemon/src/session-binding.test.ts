/**
 * Unit tests for session-binding orphan scan + fingerprint matching.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionState, type SessionState } from './session-state.js';
import { SessionBinding } from './session-binding.js';

function state(overrides: Partial<SessionState>): SessionState {
  return {
    instanceUuid: 'uuid-a',
    pid: 11111,
    startedAt: '2026-04-09T18:00:00.000Z',
    lastHeartbeat: '2026-04-09T18:00:00.000Z',
    cwd: '/tmp/project',
    gitBranch: 'main',
    agentType: 'claude-code',
    nativeSessionId: null,
    tailOffset: 0,
    historyVersion: 1,
    ...overrides,
  };
}

describe('SessionBinding', () => {
  let dir: string;
  let binding: SessionBinding;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-binding-'));
    // Inject a deterministic liveness check: only process.pid counts as alive.
    binding = new SessionBinding({
      dataDir: dir,
      isAlive: (pid) => pid === process.pid,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when no session directories exist', async () => {
    expect(await binding.listAllSessions()).toEqual([]);
    expect(await binding.listOrphans()).toEqual([]);
  });

  it('lists all sessions with liveness flags', async () => {
    await writeSessionState(dir, state({ instanceUuid: 'live', pid: process.pid }));
    await writeSessionState(dir, state({ instanceUuid: 'dead', pid: 99999 }));
    const all = await binding.listAllSessions();
    const byId = Object.fromEntries(all.map((e) => [e.state.instanceUuid, e]));
    expect(byId.live!.alive).toBe(true);
    expect(byId.dead!.alive).toBe(false);
  });

  it('listOrphans returns only dead sessions', async () => {
    await writeSessionState(dir, state({ instanceUuid: 'live', pid: process.pid }));
    await writeSessionState(dir, state({ instanceUuid: 'dead', pid: 99999 }));
    const orphans = await binding.listOrphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.state.instanceUuid).toBe('dead');
  });

  it('matches orphans by exact fingerprint', async () => {
    await writeSessionState(
      dir,
      state({ instanceUuid: 'match', pid: 99999, cwd: '/a', gitBranch: 'main', agentType: 'claude-code' }),
    );
    await writeSessionState(
      dir,
      state({ instanceUuid: 'wrong-cwd', pid: 99999, cwd: '/b', gitBranch: 'main', agentType: 'claude-code' }),
    );
    await writeSessionState(
      dir,
      state({ instanceUuid: 'wrong-type', pid: 99999, cwd: '/a', gitBranch: 'main', agentType: 'codex' }),
    );
    const found = await binding.findOrphansForFingerprint({
      cwd: '/a',
      gitBranch: 'main',
      agentType: 'claude-code',
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.state.instanceUuid).toBe('match');
  });

  it('ignores live sessions when matching fingerprints', async () => {
    await writeSessionState(
      dir,
      state({ instanceUuid: 'alive-match', pid: process.pid, cwd: '/a', gitBranch: 'main' }),
    );
    const found = await binding.findOrphansForFingerprint({
      cwd: '/a',
      gitBranch: 'main',
      agentType: 'claude-code',
    });
    expect(found).toEqual([]);
  });
});
