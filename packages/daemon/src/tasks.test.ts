import { describe, it, expect, afterEach } from 'vitest';
import { TaskManager } from './tasks.js';

describe('TaskManager — Task-Delegation und -Tracking', () => {
  let manager: TaskManager;

  afterEach(() => {
    manager?.stop();
  });

  it('erstellt einen Task-Request', () => {
    manager = new TaskManager();
    const task = manager.createRequest(
      'spiffe://thinklocal/host/a/agent/claude-code',
      'influxdb.read',
      { query: 'SELECT * FROM cpu' },
    );

    expect(task.id).toBeTruthy();
    expect(task.state).toBe('requested');
    expect(task.skillId).toBe('influxdb.read');
    expect(task.requester).toContain('claude-code');
    expect(task.executor).toBeNull();
  });

  it('durchläuft den kompletten Task-Lifecycle', () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', { data: 42 });

    // Accept
    const accepted = manager.accept(task.id, 'executor');
    expect(accepted?.state).toBe('accepted');
    expect(accepted?.executor).toBe('executor');

    // Complete
    const completed = manager.complete(task.id, { result: 'ok' });
    expect(completed?.state).toBe('completed');
    expect(completed?.result).toEqual({ result: 'ok' });
  });

  it('lehnt einen Task ab', () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', {});

    const rejected = manager.reject(task.id, 'Keine Kapazität');
    expect(rejected?.state).toBe('rejected');
    expect(rejected?.error).toBe('Keine Kapazität');
  });

  it('markiert einen Task als fehlgeschlagen', () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', {});
    manager.accept(task.id, 'executor');

    const failed = manager.fail(task.id, 'Connection timeout');
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toBe('Connection timeout');
  });

  it('verhindert ungültige State-Übergänge', () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', {});

    // Kann nicht completen ohne Accept
    expect(manager.complete(task.id, {})).toBeNull();

    // Kann nicht zweimal akzeptieren
    manager.accept(task.id, 'exec-1');
    expect(manager.accept(task.id, 'exec-2')).toBeNull();
  });

  it('findet Tasks nach Correlation-ID', () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', {});

    const found = manager.getTaskByCorrelation(task.correlationId);
    expect(found?.id).toBe(task.id);
  });

  it('filtert Tasks nach State', () => {
    manager = new TaskManager();
    manager.createRequest('r', 'skill-1', {});
    manager.createRequest('r', 'skill-2', {});
    const t3 = manager.createRequest('r', 'skill-3', {});
    manager.accept(t3.id, 'e');

    expect(manager.getByState('requested')).toHaveLength(2);
    expect(manager.getByState('accepted')).toHaveLength(1);
    expect(manager.getActiveTasks()).toHaveLength(3);
  });

  it('erkennt Timeout bei abgelaufener Deadline', async () => {
    manager = new TaskManager();
    const task = manager.createRequest('requester', 'skill-1', {}, 50); // 50ms Deadline

    await new Promise((r) => setTimeout(r, 100));

    // Manuell Timeout-Check auslösen (normalerweise alle 10s)
    // @ts-expect-error — Private Method für Test aufrufen
    manager.checkTimeouts();

    const updated = manager.getTask(task.id);
    expect(updated?.state).toBe('timeout');
    expect(updated?.error).toBe('Deadline exceeded');
  });
});
