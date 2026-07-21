// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { buildTaskSkeleton, buildTaskHistogram, buildTaskOverview } from './task-skeleton.js';
import type { Task, TaskState } from './tasks.js';

/** Minimal-Task mit nur den vom Skelett gelesenen Feldern; Rest über Defaults (Test-Fixture). */
function task(p: Partial<Task> & { id: string }): Task {
  return {
    correlationId: p.id,
    requester: 'spiffe://thinklocal/host/h/agent/req',
    executor: null,
    state: 'requested' as TaskState,
    skillId: 'skill.default',
    input: {},
    result: null,
    error: null,
    createdAt: '2026-07-21T09:00:00.000Z',
    deadline: null,
    updatedAt: '2026-07-21T09:00:00.000Z',
    ...p,
  } as Task;
}

/** Erwartetes Null-Histogramm (alle sechs Zustände auf 0) für kompakte Assertions. */
const ZERO_HISTOGRAM = {
  requested: 0,
  accepted: 0,
  rejected: 0,
  completed: 0,
  failed: 0,
  timeout: 0,
};

describe('buildTaskSkeleton', () => {
  it('projiziert einen Task auf die kompakten Signal-Felder', () => {
    const out = buildTaskSkeleton([
      task({
        id: 't1',
        skillId: 'influxdb.read',
        state: 'completed',
        executor: 'spiffe://thinklocal/host/h/agent/exec',
        result: { rows: 5 },
        error: null,
      }),
    ]);
    expect(out).toEqual([
      {
        id: 't1',
        skill_id: 'influxdb.read',
        state: 'completed',
        executor: 'spiffe://thinklocal/host/h/agent/exec',
        has_result: true,
        has_error: false,
      },
    ]);
  });

  it('ersetzt volle Blobs durch Signale: input/result/error tauchen NICHT auf', () => {
    const out = buildTaskSkeleton([
      task({ id: 't', input: { secret: 'x' }, result: { big: 'blob' }, error: 'boom' }),
    ]);
    const keys = Object.keys(out[0]).sort();
    expect(keys).toEqual(['executor', 'has_error', 'has_result', 'id', 'skill_id', 'state']);
    expect(out[0].has_result).toBe(true);
    expect(out[0].has_error).toBe(true);
  });

  it('Task ohne Executor/Result/Error → executor null, Signale false', () => {
    const out = buildTaskSkeleton([task({ id: 't', state: 'requested' })]);
    expect(out[0]).toMatchObject({ executor: null, has_result: false, has_error: false });
  });

  it('sortiert deterministisch nach id (locale-unabhängig)', () => {
    const out = buildTaskSkeleton([
      task({ id: 'charlie' }),
      task({ id: 'alpha' }),
      task({ id: 'bravo' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('ein Eintrag pro Task (keine Deduplizierung — Tasks sind bereits distinkt)', () => {
    expect(buildTaskSkeleton([task({ id: 'a' }), task({ id: 'b' })])).toHaveLength(2);
  });

  it('leere Eingabe → leeres Ergebnis', () => {
    expect(buildTaskSkeleton([])).toEqual([]);
  });
});

describe('buildTaskSkeleton — total gegen malformed Daten (kein 500er)', () => {
  it('unbekannter/geschmiedeter state fällt auf requested zurück', () => {
    const out = buildTaskSkeleton([task({ id: 't', state: 'PWNED' as unknown as TaskState })]);
    expect(out[0].state).toBe('requested');
  });

  it('non-string id/skillId werden auf leeren String normalisiert (kein Sort-Crash)', () => {
    const out = buildTaskSkeleton([
      task({ id: 123 as unknown as string, skillId: { evil: true } as unknown as string }),
    ]);
    expect(out[0].id).toBe('');
    expect(out[0].skill_id).toBe('');
  });

  it('non-string executor (geforgt) → null statt durchgereicht', () => {
    const out = buildTaskSkeleton([task({ id: 't', executor: 42 as unknown as string })]);
    expect(out[0].executor).toBeNull();
  });

  it('result/error undefined (statt null) → Signale false, kein throw', () => {
    const out = buildTaskSkeleton([
      task({ id: 't', result: undefined as unknown as null, error: undefined as unknown as null }),
    ]);
    expect(out[0]).toMatchObject({ has_result: false, has_error: false });
  });
});

describe('buildTaskHistogram', () => {
  it('zählt je Zustand und hält alle sechs Schlüssel präsent (Default 0)', () => {
    const out = buildTaskHistogram([
      task({ id: '1', state: 'requested' }),
      task({ id: '2', state: 'requested' }),
      task({ id: '3', state: 'completed' }),
      task({ id: '4', state: 'failed' }),
    ]);
    expect(out).toEqual({
      requested: 2,
      accepted: 0,
      rejected: 0,
      completed: 1,
      failed: 1,
      timeout: 0,
    });
  });

  it('leere Eingabe → Null-Histogramm mit allen Schlüsseln', () => {
    expect(buildTaskHistogram([])).toEqual(ZERO_HISTOGRAM);
  });

  it('malformed state wird als requested gezählt (kein erfundener Schlüssel)', () => {
    const out = buildTaskHistogram([task({ id: 't', state: 'HACK' as unknown as TaskState })]);
    expect(out).toEqual({ ...ZERO_HISTOGRAM, requested: 1 });
    expect(Object.keys(out).sort()).toEqual([
      'accepted',
      'completed',
      'failed',
      'rejected',
      'requested',
      'timeout',
    ]);
  });

  it('Summe des Histogramms === Anzahl Tasks', () => {
    const tasks = [
      task({ id: '1', state: 'accepted' }),
      task({ id: '2', state: 'timeout' }),
      task({ id: '3', state: 'rejected' }),
    ];
    const out = buildTaskHistogram(tasks);
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    expect(sum).toBe(tasks.length);
  });
});

describe('buildTaskOverview', () => {
  it('Envelope { tasks, count, by_state } mit count === tasks.length', () => {
    const out = buildTaskOverview([
      task({ id: 'a', state: 'requested' }),
      task({ id: 'b', state: 'completed' }),
    ]);
    expect(out.count).toBe(2);
    expect(out.tasks).toHaveLength(2);
    expect(out.count).toBe(out.tasks.length);
    expect(out.by_state).toEqual({ ...ZERO_HISTOGRAM, requested: 1, completed: 1 });
  });

  it('leere Eingabe → { tasks: [], count: 0, by_state: Null-Histogramm }', () => {
    expect(buildTaskOverview([])).toEqual({ tasks: [], count: 0, by_state: ZERO_HISTOGRAM });
  });

  it('Histogramm zählt auch übersprungene/malformed Einträge konsistent zur count', () => {
    const out = buildTaskOverview([task({ id: 't', state: 'BOGUS' as unknown as TaskState })]);
    const sum = Object.values(out.by_state).reduce((a, b) => a + b, 0);
    expect(sum).toBe(out.count);
  });

  // Doc-Invariante (TL-21 §4 Slice 5, CR-MEDIUM): ein geforgter state wird KONSISTENT auf
  // 'requested' normalisiert — im Eintrag UND im Histogramm dort gezählt (nicht übersprungen).
  // Sperrt gegen eine doc-getriebene Regression, die die by_state-Summe von count entkoppeln würde.
  it('malformed state erscheint als requested im Eintrag UND im by_state-Histogramm', () => {
    const out = buildTaskOverview([task({ id: 't', state: 'BOGUS' as unknown as TaskState })]);
    expect(out.tasks[0].state).toBe('requested');
    expect(out.by_state).toEqual({ ...ZERO_HISTOGRAM, requested: 1 });
  });
});
