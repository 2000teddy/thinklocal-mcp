/**
 * Unit tests for the ADR-006 SessionEventsStore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionEventsStore, type SessionEventInput } from './session-events.js';

function makeEvent(overrides: Partial<SessionEventInput> = {}): SessionEventInput {
  return {
    instanceUuid: 'inst-1',
    seq: 0,
    timestamp: '2026-04-09T18:00:00.000Z',
    eventType: 'user_message',
    payload: { text: 'hi' },
    adapterVersion: 'claude-code/1.0',
    ...overrides,
  };
}

describe('SessionEventsStore', () => {
  let dir: string;
  let store: SessionEventsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-events-'));
    store = new SessionEventsStore({ dataDir: dir });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends new events and reports counts', () => {
    expect(store.append(makeEvent({ seq: 0 }))).toBe(true);
    expect(store.append(makeEvent({ seq: 1, eventType: 'assistant_message' }))).toBe(true);
    expect(store.count('inst-1')).toBe(2);
    expect(store.latestSeq('inst-1')).toBe(1);
  });

  it('is idempotent on duplicate (instance_uuid, seq)', () => {
    expect(store.append(makeEvent({ seq: 5 }))).toBe(true);
    expect(store.append(makeEvent({ seq: 5 }))).toBe(false);
    expect(store.count('inst-1')).toBe(1);
  });

  it('separates events by instance', () => {
    store.append(makeEvent({ instanceUuid: 'a', seq: 0 }));
    store.append(makeEvent({ instanceUuid: 'a', seq: 1 }));
    store.append(makeEvent({ instanceUuid: 'b', seq: 0 }));
    expect(store.count('a')).toBe(2);
    expect(store.count('b')).toBe(1);
    expect(store.latestSeq('empty')).toBe(-1);
  });

  it('lists events in chronological order', () => {
    store.append(makeEvent({ seq: 2, payload: { text: 'c' } }));
    store.append(makeEvent({ seq: 0, payload: { text: 'a' } }));
    store.append(makeEvent({ seq: 1, payload: { text: 'b' } }));
    const list = store.list('inst-1');
    expect(list.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(list.map((e) => JSON.parse(e.payload).text)).toEqual(['a', 'b', 'c']);
  });

  it('persists across instances (reopened store sees prior data)', () => {
    store.append(makeEvent({ seq: 0 }));
    store.close();
    const store2 = new SessionEventsStore({ dataDir: dir });
    expect(store2.count('inst-1')).toBe(1);
    store2.close();
  });

  it('stores adapter version for migration support', () => {
    store.append(makeEvent({ seq: 0, adapterVersion: 'claude-code/2.0' }));
    const row = store.list('inst-1')[0]!;
    expect(row.adapter_version).toBe('claude-code/2.0');
  });
});
