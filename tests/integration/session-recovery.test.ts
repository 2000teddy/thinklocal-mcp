/**
 * ADR-006 Phase 1 — Integration test: crash + resume E2E
 *
 * Simulates the full lifecycle:
 *   1. An agent-instance creates its session dir + initial state.
 *   2. A native jsonl file grows by a few turns.
 *   3. The watcher ingests them + regenerates HISTORY.md.
 *   4. The agent "crashes" (we just mark its pid as 99999).
 *   5. A replacement agent uses `SessionBinding.findOrphansForFingerprint`
 *      with the same (cwd, branch, type) and finds the orphan.
 *   6. The new agent reads HISTORY.md + the persisted event log.
 *   7. More turns are appended; a new watcher continues the ingest
 *      from the persisted `tailOffset`.
 *
 * This test is the backstop against architectural regressions —
 * individual units can be correct but their composition can still
 * drift.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionEventsStore } from '../../packages/daemon/src/session-events.js';
import { SessionWatcher } from '../../packages/daemon/src/session-watcher.js';
import { SessionBinding } from '../../packages/daemon/src/session-binding.js';
import { parseClaudeCodeBuffer } from '../../packages/daemon/src/session-adapters/claude-code-adapter.js';
import {
  writeSessionState,
  readSessionState,
  type SessionState,
} from '../../packages/daemon/src/session-state.js';
import { renderHistoryMarkdown } from '../../packages/daemon/src/recovery-generator.js';
import { writeAtomic } from '../../packages/daemon/src/atomic-write.js';

const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;

describe('ADR-006 Phase 1 — crash + resume integration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-sess-e2e-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers state after a simulated crash and continues ingest', async () => {
    const INSTANCE = 'uuid-e2e';
    const jsonl = join(dir, 'native.jsonl');
    writeFileSync(jsonl, '');

    // 1. Initial state — the "first" agent.
    const initialState: SessionState = {
      instanceUuid: INSTANCE,
      pid: process.pid,
      startedAt: '2026-04-09T18:00:00.000Z',
      lastHeartbeat: '2026-04-09T18:00:00.000Z',
      cwd: '/tmp/e2e-project',
      gitBranch: 'feature/adr-006',
      agentType: 'claude-code',
      nativeSessionId: 'native-1',
      tailOffset: 0,
      historyVersion: 1,
    };
    await writeSessionState(dir, initialState);

    const store = new SessionEventsStore({ dataDir: dir });
    try {
      const watcher = new SessionWatcher({
        store,
        parseBuffer: parseClaudeCodeBuffer,
        dataDir: dir,
      });

      // 2. First batch of turns.
      appendFileSync(
        jsonl,
        line({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'Implement ADR-006 Phase 1' }] },
          sessionId: INSTANCE,
          timestamp: '2026-04-09T18:00:01.000Z',
        }),
      );
      appendFileSync(
        jsonl,
        line({
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Ich werde die Module bauen.' },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } },
            ],
          },
          sessionId: INSTANCE,
          timestamp: '2026-04-09T18:00:02.000Z',
        }),
      );

      // 3. Watcher ingest.
      let liveState: SessionState = { ...initialState };
      const res = await watcher.tick(jsonl, liveState);
      liveState = res.newState;
      expect(res.newEvents).toBe(2);
      expect(store.count(INSTANCE)).toBe(2);

      // 4. Write HISTORY.md via recovery-generator + atomic write.
      const events = store.list(INSTANCE);
      const md = renderHistoryMarkdown({
        state: liveState,
        events,
        now: () => new Date('2026-04-09T18:00:03.000Z'),
      });
      const historyPath = join(dir, 'sessions', INSTANCE, 'HISTORY.md');
      await writeAtomic(historyPath, md);
      expect(existsSync(historyPath)).toBe(true);
      const historyContent = readFileSync(historyPath, 'utf8');
      expect(historyContent).toContain('Implement ADR-006 Phase 1');
      expect(historyContent).toContain('/a.ts');
      expect(historyContent).toContain('Ich werde die Module bauen');

      // 5. Simulate crash — rewrite state.json with dead pid.
      const crashed: SessionState = { ...liveState, pid: 99999 };
      await writeSessionState(dir, crashed);

      // 6. New agent starts, uses SessionBinding to find the orphan.
      const binding = new SessionBinding({
        dataDir: dir,
        isAlive: (pid) => pid === process.pid,
      });
      const orphans = await binding.findOrphansForFingerprint({
        cwd: '/tmp/e2e-project',
        gitBranch: 'feature/adr-006',
        agentType: 'claude-code',
      });
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.state.instanceUuid).toBe(INSTANCE);

      // 7. New agent takes over: reads state + persisted events,
      //    continues ingest from the stored tailOffset.
      const recovered = (await readSessionState(dir, INSTANCE))!;
      expect(recovered.tailOffset).toBeGreaterThan(0);
      expect(store.count(INSTANCE)).toBe(2); // still has prior events

      // New agent adopts the session and updates pid.
      const resumed: SessionState = { ...recovered, pid: process.pid };
      await writeSessionState(dir, resumed);

      // More turns arrive.
      appendFileSync(
        jsonl,
        line({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'Run tests' }] },
          sessionId: INSTANCE,
          timestamp: '2026-04-09T18:01:00.000Z',
        }),
      );

      const res2 = await watcher.tick(jsonl, resumed);
      expect(res2.newEvents).toBe(1);
      expect(store.count(INSTANCE)).toBe(3);
      expect(res2.newState.tailOffset).toBeGreaterThan(recovered.tailOffset);

      // 8. Binding no longer lists the orphan (pid is alive again).
      const remaining = await binding.findOrphansForFingerprint({
        cwd: '/tmp/e2e-project',
        gitBranch: 'feature/adr-006',
        agentType: 'claude-code',
      });
      expect(remaining).toEqual([]);
    } finally {
      store.close();
    }
  });
});
