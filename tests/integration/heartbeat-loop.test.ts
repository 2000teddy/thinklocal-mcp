/**
 * Integration test for ADR-004 Phase 1 cron-heartbeat loop simulation.
 *
 * Simulates one polling loop iterating against a mocked inbox API,
 * validates the adaptive backoff sequence and the reset-on-message
 * behaviour required by the ADR.
 *
 * Generated via clink gemini (planner role) on 2026-04-09.
 * See: docs/architecture/ADR-004-cron-heartbeat.md
 */
import { describe, it, expect } from 'vitest';
import {
  nextInterval,
  type HeartbeatState,
} from '../../packages/daemon/src/heartbeat/interval.js';

interface MockInbox {
  unreadCount: () => Promise<number>;
  fetchMessages: () => Promise<Array<{ id: string }>>;
  markAsRead: (id: string) => Promise<void>;
}

describe('Heartbeat Loop Integration Simulation', () => {
  it('follows the expected interval pattern and handles message arrival', async () => {
    let pendingMessages: string[] = [];
    const readMessages = new Set<string>();

    const mockInbox: MockInbox = {
      unreadCount: async () => pendingMessages.length,
      fetchMessages: async () => pendingMessages.map((id) => ({ id })),
      markAsRead: async (id) => {
        readMessages.add(id);
      },
    };

    let state: HeartbeatState = { emptyPollCount: 0, lastIntervalMs: 0 };
    const intervalHistory: number[] = [];

    const runCycle = async () => {
      const count = await mockInbox.unreadCount();
      const hadMessages = count > 0;

      if (hadMessages) {
        const msgs = await mockInbox.fetchMessages();
        for (const m of msgs) await mockInbox.markAsRead(m.id);
        pendingMessages = [];
      }

      const result = nextInterval(state, hadMessages, 'lan');
      intervalHistory.push(result.intervalMs);
      state = result.nextState;
    };

    // Iterations 1-3: empty inbox, exponential backoff
    await runCycle();
    expect(intervalHistory[0]).toBe(5000);

    await runCycle();
    expect(intervalHistory[1]).toBe(10000);

    await runCycle();
    expect(intervalHistory[2]).toBe(20000);

    // Message arrives between iterations 3 and 4
    pendingMessages.push('msg-123');

    // Iteration 4: message found -> reset
    await runCycle();
    expect(intervalHistory[3]).toBe(5000);
    expect(readMessages.has('msg-123')).toBe(true);

    // Iteration 5: empty again, fresh backoff
    await runCycle();
    expect(intervalHistory[4]).toBe(5000);

    expect(intervalHistory).toEqual([5000, 10000, 20000, 5000, 5000]);
    expect(state.emptyPollCount).toBe(1);
  });
});
