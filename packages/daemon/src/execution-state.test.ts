/**
 * ADR-009 Phase C PR C1 — Execution State tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionStateStore, type ExecutionLifecycleState } from './execution-state.js';

describe('ExecutionStateStore', () => {
  let dir: string;
  let store: ExecutionStateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-exec-'));
    store = new ExecutionStateStore(dir);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('create()', () => {
    it('creates an execution in accepted state', () => {
      const id = store.create('inst-1', 'task_request', 'msg-abc');
      const row = store.get(id)!;
      expect(row.lifecycle_state).toBe('accepted');
      expect(row.instance_uuid).toBe('inst-1');
      expect(row.execution_type).toBe('task_request');
      expect(row.message_id).toBe('msg-abc');
      expect(row.started_at).not.toBeNull();
    });
  });

  describe('valid transitions', () => {
    it('accepted → running → completed', () => {
      const id = store.create('inst-1');
      expect(store.transition(id, 'running')).toBe(true);
      expect(store.get(id)!.lifecycle_state).toBe('running');
      expect(store.transition(id, 'completed')).toBe(true);
      expect(store.get(id)!.lifecycle_state).toBe('completed');
      expect(store.get(id)!.completed_at).not.toBeNull();
    });

    it('accepted → running → failed', () => {
      const id = store.create('inst-1');
      store.transition(id, 'running');
      expect(store.transition(id, 'failed')).toBe(true);
      expect(store.get(id)!.lifecycle_state).toBe('failed');
    });

    it('accepted → aborted (cancel before start)', () => {
      const id = store.create('inst-1');
      expect(store.transition(id, 'aborted')).toBe(true);
    });

    it('running → aborted', () => {
      const id = store.create('inst-1');
      store.transition(id, 'running');
      expect(store.transition(id, 'aborted')).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    it('accepted → completed (must go through running)', () => {
      const id = store.create('inst-1');
      expect(store.transition(id, 'completed')).toBe(false);
    });

    it('completed → running (terminal state)', () => {
      const id = store.create('inst-1');
      store.transition(id, 'running');
      store.transition(id, 'completed');
      expect(store.transition(id, 'running')).toBe(false);
    });

    it('failed → completed (terminal state)', () => {
      const id = store.create('inst-1');
      store.transition(id, 'running');
      store.transition(id, 'failed');
      expect(store.transition(id, 'completed')).toBe(false);
    });

    it('unknown execution_id returns false', () => {
      expect(store.transition('nonexistent', 'running')).toBe(false);
    });
  });

  describe('queries', () => {
    it('listByInstance returns executions for a specific instance', () => {
      store.create('inst-1', 'task_request');
      store.create('inst-1', 'skill_execute');
      store.create('inst-2', 'task_request');
      expect(store.listByInstance('inst-1')).toHaveLength(2);
      expect(store.listByInstance('inst-2')).toHaveLength(1);
    });

    it('listByInstance filters by state', () => {
      const id1 = store.create('inst-1');
      store.transition(id1, 'running');
      store.create('inst-1'); // stays accepted
      expect(store.listByInstance('inst-1', 'running')).toHaveLength(1);
      expect(store.listByInstance('inst-1', 'accepted')).toHaveLength(1);
    });

    it('countByState aggregates correctly', () => {
      const id1 = store.create('inst-1');
      store.transition(id1, 'running');
      store.create('inst-1');
      store.create('inst-1');
      const counts = store.countByState();
      expect(counts.running).toBe(1);
      expect(counts.accepted).toBe(2);
      expect(counts.completed).toBe(0);
    });
  });

  describe('persistence', () => {
    it('survives re-opens', () => {
      const id = store.create('inst-1');
      store.transition(id, 'running');
      store.close();
      const store2 = new ExecutionStateStore(dir);
      expect(store2.get(id)!.lifecycle_state).toBe('running');
      store2.close();
    });
  });
});
