// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * task-skeleton.ts — TL-21 Skelett-Auskunft für Tasks (Kap. 06, Kontext-Ökonomie), Slice 5.
 *
 * Reine, kompakte Projektion vorhandener `Task`-Daten in eine „ein Eintrag pro Task"-Übersicht plus
 * ein Status-Histogramm. Kein State, kein I/O, deterministisch (kein Date/Random). Analog zu
 * `peer-skeleton.ts` (Slice 3/4) und `capability-skeleton.ts` (Slice 1/2).
 *
 * Zweck: `GET /api/tasks` liefert je Task u.a. `requester`/`executor`-SPIFFE-URIs, `deadline`,
 * `updated_at` und die (potenziell großen) `error`-Texte; die vollen `input`/`result`-Blobs hängen
 * am Task-Objekt. Für die Erst-Orientierung „was läuft gerade?" ist das zu viel. Diese Skelett-Sicht
 * ersetzt die Blobs durch **Signale** (`has_result`/`has_error`) und stellt ein aggregiertes
 * `by_state`-Histogramm voran. Details bleiben auf Abruf über das unveränderte `GET /api/tasks`.
 *
 * Siehe docs/architecture/TL-21-skeleton-disclosure.md §4 (Slice 5).
 */

import type { Task, TaskState } from './tasks.js';

/** Die sechs gültigen Task-Zustände (defensiver Filter gegen geschmiedete/malformed `state`-Werte). */
const VALID_STATES: readonly TaskState[] = [
  'requested',
  'accepted',
  'rejected',
  'completed',
  'failed',
  'timeout',
];
const VALID_STATE_SET: ReadonlySet<TaskState> = new Set<TaskState>(VALID_STATES);

/** Ein Skelett-Eintrag: das Minimum für die Erst-Orientierung (Details via GET /api/tasks). */
export interface TaskSkeletonEntry {
  id: string;
  skill_id: string;
  /** Task-Zustand; ein unbekannter (geforgter) Wert fällt defensiv auf `'requested'` zurück. */
  state: TaskState;
  /** SPIFFE-URI des Ausführenden, falls zugewiesen; sonst `null`. */
  executor: string | null;
  /** Signal statt des vollen `result`-Blobs: liegt bereits ein Ergebnis vor? */
  has_result: boolean;
  /** Signal statt des (potenziell großen) `error`-Textes: ist ein Fehler gesetzt? */
  has_error: boolean;
}

/** Status-Histogramm über alle sechs `TaskState` (jeder Schlüssel immer präsent, Default 0). */
export type TaskStateHistogram = Record<TaskState, number>;

/**
 * Total-fail-safe String-Sicht auf runtime-untypisierte Felder: `Task.id`/`skillId` sind typisiert
 * `string`, aber ein geschmiedeter Nicht-String würde einen Comparator/Sort sprengen → hier
 * deterministisch auf `''` normalisiert (Parität zu `peer-skeleton.asStr`).
 */
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Fixe, locale-unabhängige String-Ordnung (Cross-Host-Determinismus, analog peer-skeleton). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Geprüfter `TaskState` oder Fallback `'requested'` (kein frei erfundener String im Eintrag). */
const asState = (v: unknown): TaskState =>
  VALID_STATE_SET.has(v as TaskState) ? (v as TaskState) : 'requested';

/**
 * Baut die kompakte Task-Skelett-Übersicht: ein Eintrag pro übergebenem Task, sortiert nach `id`
 * (stabil, locale-unabhängig). Rein, deterministisch (kein Date/Random), total gegen malformed
 * Task-Daten — ein geschmiedetes Feld kippt die additive Read-View NICHT in einen 500er.
 */
export function buildTaskSkeleton(tasks: Task[]): TaskSkeletonEntry[] {
  const entries: TaskSkeletonEntry[] = [];
  for (const t of tasks) {
    entries.push({
      id: asStr(t.id),
      skill_id: asStr(t.skillId),
      state: asState(t.state),
      executor: typeof t.executor === 'string' ? t.executor : null,
      has_result: t.result != null,
      has_error: t.error != null,
    });
  }
  return entries.sort((a, b) => cmpStr(a.id, b.id));
}

/**
 * Aggregiert die Task-Zustände zu einem Histogramm. Jeder der sechs `TaskState` ist als Schlüssel
 * garantiert präsent (Default 0). Ein malformed/geforgter `state` wird über `asState` auf
 * `'requested'` normalisiert und dort gezählt — kein frei erfundener Histogramm-Schlüssel.
 */
export function buildTaskHistogram(tasks: Task[]): TaskStateHistogram {
  const histogram = Object.fromEntries(VALID_STATES.map((s) => [s, 0])) as TaskStateHistogram;
  for (const t of tasks) {
    histogram[asState(t.state)] += 1;
  }
  return histogram;
}

/** Envelope der Task-Skelett-Übersicht (`{ tasks, count, by_state }`). Kein I/O, deterministisch. */
export interface TaskOverview {
  tasks: TaskSkeletonEntry[];
  count: number;
  by_state: TaskStateHistogram;
}

/**
 * EINE Quelle der Wahrheit für die TL-21-Task-Übersicht-Nutzlast — analog `buildPeerOverview`.
 * Von REST `GET /api/tasks/overview` UND MCP-Tool `list_tasks_overview` benutzt (same-source
 * `TaskManager.getAllTasks()`) → strukturelle Parität statt Drift. `count` ist immer `tasks.length`.
 */
export function buildTaskOverview(tasks: Task[]): TaskOverview {
  const skeleton = buildTaskSkeleton(tasks);
  return { tasks: skeleton, count: skeleton.length, by_state: buildTaskHistogram(tasks) };
}
