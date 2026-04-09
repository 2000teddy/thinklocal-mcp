/**
 * Unit tests for the ADR-006 session-state schema + helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSessionState,
  readSessionState,
  stateFilePath,
  isPidAlive,
  type SessionState,
} from './session-state.js';

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    instanceUuid: 'uuid-alpha',
    pid: 12345,
    startedAt: '2026-04-09T18:00:00.000Z',
    lastHeartbeat: '2026-04-09T18:00:00.000Z',
    cwd: '/tmp/project',
    gitBranch: 'main',
    agentType: 'claude-code',
    nativeSessionId: 'sess-xyz',
    tailOffset: 0,
    historyVersion: 1,
    ...overrides,
  };
}

describe('session-state helpers', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-sess-state-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and re-reads a state.json round-trip', async () => {
    const state = makeState();
    await writeSessionState(dir, state);
    const path = stateFilePath(dir, state.instanceUuid);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('"uuid-alpha"');

    const loaded = await readSessionState(dir, state.instanceUuid);
    expect(loaded).toEqual(state);
  });

  it('creates the session directory if it does not exist', async () => {
    await writeSessionState(dir, makeState({ instanceUuid: 'fresh-uuid' }));
    expect(existsSync(stateFilePath(dir, 'fresh-uuid'))).toBe(true);
  });

  it('returns null when the state file is absent', async () => {
    const loaded = await readSessionState(dir, 'never-created');
    expect(loaded).toBeNull();
  });

  it('isPidAlive handles edge cases', () => {
    expect(isPidAlive(null)).toBe(false);
    expect(isPidAlive(undefined)).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(process.pid)).toBe(true); // our own pid is alive
    expect(isPidAlive(2147483646)).toBe(false); // vanishingly unlikely pid
  });
});
