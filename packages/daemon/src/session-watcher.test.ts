/**
 * Unit + light integration tests for the SessionWatcher.
 * Uses a temp jsonl file and the real SessionEventsStore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionEventsStore } from './session-events.js';
import { SessionWatcher } from './session-watcher.js';
import { parseClaudeCodeBuffer } from './session-adapters/claude-code-adapter.js';
import {
  writeSessionState,
  stateFilePath,
  readSessionState,
  type SessionState,
} from './session-state.js';

function baseState(instanceUuid = 'inst-1'): SessionState {
  return {
    instanceUuid,
    pid: process.pid,
    startedAt: '2026-04-09T18:00:00.000Z',
    lastHeartbeat: '2026-04-09T18:00:00.000Z',
    cwd: '/tmp/project',
    gitBranch: 'main',
    agentType: 'claude-code',
    nativeSessionId: 'native-1',
    tailOffset: 0,
    historyVersion: 1,
  };
}

describe('SessionWatcher', () => {
  let dir: string;
  let store: SessionEventsStore;
  let watcher: SessionWatcher;
  let jsonl: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-watcher-'));
    store = new SessionEventsStore({ dataDir: dir });
    watcher = new SessionWatcher({
      store,
      parseBuffer: parseClaudeCodeBuffer,
      dataDir: dir,
    });
    jsonl = join(dir, 'session.jsonl');
    writeFileSync(jsonl, '');
    await writeSessionState(dir, baseState());
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;

  it('returns zero when the file is empty', async () => {
    const state = baseState();
    const res = await watcher.tick(jsonl, state);
    expect(res.newEvents).toBe(0);
    expect(res.tailOffset).toBe(0);
  });

  it('ingests newly-appended lines and advances the tail offset', async () => {
    const state = baseState();
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    appendFileSync(
      jsonl,
      line({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:02.000Z',
      }),
    );
    const res = await watcher.tick(jsonl, state);
    expect(res.newEvents).toBe(2);
    expect(res.tailOffset).toBeGreaterThan(0);
    expect(store.count('inst-1')).toBe(2);
  });

  it('persists tailOffset + lastHeartbeat + historyVersion to state.json', async () => {
    const state = baseState();
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    await watcher.tick(jsonl, state);
    expect(existsSync(stateFilePath(dir, 'inst-1'))).toBe(true);
    const persisted = await readSessionState(dir, 'inst-1');
    expect(persisted!.tailOffset).toBeGreaterThan(0);
    expect(persisted!.historyVersion).toBe(2);
  });

  it('is idempotent across repeated ticks without new data', async () => {
    let state = baseState();
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    const first = await watcher.tick(jsonl, state);
    state = first.newState;
    const again = await watcher.tick(jsonl, state);
    expect(again.newEvents).toBe(0);
    expect(store.count('inst-1')).toBe(1);
  });

  it('defers a half-written tail line until the newline arrives', async () => {
    let state = baseState();
    writeFileSync(jsonl, '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"half"}]},"sessionId":"inst-1","timestamp":"2026-04-09T18:00:01.000Z"');
    const first = await watcher.tick(jsonl, state);
    state = first.newState;
    expect(first.newEvents).toBe(0);

    // Now complete the line.
    appendFileSync(jsonl, '}\n');
    const second = await watcher.tick(jsonl, state);
    expect(second.newEvents).toBe(1);
  });

  // Regression test for Gemini-Pro CR HIGH #1: concurrent tick()
  // calls for the same instance used to race on state.json, losing
  // events when the later atomic-write clobbered the earlier one.
  // The in-watcher lock now serialises them — the store dedupes
  // the second call's parse via UNIQUE(instance_uuid, seq).
  it('serialises concurrent tick() calls for the same instance (CR HIGH #1 regression)', async () => {
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'a' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    const stateA = baseState();
    const stateB = baseState();
    const [r1, r2] = await Promise.all([
      watcher.tick(jsonl, stateA),
      watcher.tick(jsonl, stateB),
    ]);
    // Exactly one tick writes the event; the store refuses the
    // second call's duplicate.
    const totalIngested = r1.newEvents + r2.newEvents;
    expect(totalIngested).toBe(1);
    expect(store.count('inst-1')).toBe(1);
    const persisted = await readSessionState(dir, 'inst-1');
    expect(persisted!.tailOffset).toBeGreaterThan(0);
  });

  it('returns newState in the IngestResult for callers that prefer immutable updates (CR LOW #5)', async () => {
    const state = baseState();
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    const result = await watcher.tick(jsonl, state);
    expect(result.newState).toBeDefined();
    expect(result.newState.instanceUuid).toBe('inst-1');
    expect(result.newState.tailOffset).toBe(result.tailOffset);
    expect(result.newState.historyVersion).toBe(state.historyVersion + 1);
  });

  it('invokes onEventsIngested exactly when new events are appended', async () => {
    const calls: SessionState[] = [];
    const w = new SessionWatcher({
      store,
      parseBuffer: parseClaudeCodeBuffer,
      dataDir: dir,
      onEventsIngested: (st) => {
        calls.push(st);
      },
    });
    let state = baseState();
    appendFileSync(
      jsonl,
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        sessionId: 'inst-1',
        timestamp: '2026-04-09T18:00:01.000Z',
      }),
    );
    const r = await w.tick(jsonl, state);
    state = r.newState;
    expect(calls).toHaveLength(1);
    await w.tick(jsonl, state);
    // Still one call — no new events on the idle tick.
    expect(calls).toHaveLength(1);
  });
});

// small convenience re-import because vitest does not auto-import existsSync
import { existsSync } from 'node:fs';
