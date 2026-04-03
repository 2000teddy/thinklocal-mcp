/**
 * tasks.ts — Task-Delegation und -Tracking zwischen Mesh-Peers
 *
 * Ermöglicht es einem Agent, Aufgaben an andere Agents zu delegieren.
 * Jeder Task durchläuft einen definierten Lifecycle:
 *   REQUESTED → ACCEPTED/REJECTED → (bei Accept) COMPLETED/FAILED
 *
 * Request/Response-Korrelation über correlation_id aus dem Message-Envelope.
 * Tasks werden mit TTL (Deadline) versehen und automatisch als TIMEOUT markiert.
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export type TaskState = 'requested' | 'accepted' | 'rejected' | 'completed' | 'failed' | 'timeout';

export interface Task {
  /** Eindeutige Task-ID */
  id: string;
  /** Correlation-ID (= Message correlation_id für Request/Response-Pairing) */
  correlationId: string;
  /** SPIFFE-URI des Auftraggebers */
  requester: string;
  /** SPIFFE-URI des Ausführenden (null bis Accept) */
  executor: string | null;
  /** Aktueller Zustand */
  state: TaskState;
  /** Benötigte Fähigkeit (skill_id) */
  skillId: string;
  /** Eingabedaten für den Task (JSON-serialisierbar) */
  input: Record<string, unknown>;
  /** Ergebnis des Tasks (erst nach Completion) */
  result: Record<string, unknown> | null;
  /** Fehlermeldung (bei Reject/Failed) */
  error: string | null;
  /** Erstellungszeitpunkt */
  createdAt: string;
  /** Deadline (ISO 8601, null = kein Timeout) */
  deadline: string | null;
  /** Letztes Update */
  updatedAt: string;
}

// --- Message-Payload-Typen für Tasks ---

export interface TaskRequestPayload {
  task_id: string;
  skill_id: string;
  input: Record<string, unknown>;
  deadline: string | null;
}

export interface TaskAcceptPayload {
  task_id: string;
}

export interface TaskRejectPayload {
  task_id: string;
  reason: string;
}

export interface TaskResultPayload {
  task_id: string;
  state: 'completed' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
}

// --- Task-Manager ---

export class TaskManager {
  /** Aktive Tasks (task_id → Task) */
  private tasks = new Map<string, Task>();
  /** Index: correlation_id → task_id für schnelles Lookup */
  private correlationIndex = new Map<string, string>();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private log?: Logger) {
    // Periodisch abgelaufene Tasks prüfen (alle 10s)
    this.timeoutTimer = setInterval(() => this.checkTimeouts(), 10_000);
  }

  /**
   * Erstellt einen neuen Task-Request.
   */
  createRequest(
    requester: string,
    skillId: string,
    input: Record<string, unknown>,
    deadlineMs?: number,
  ): Task {
    const id = randomUUID();
    const now = new Date();
    const deadline = deadlineMs
      ? new Date(now.getTime() + deadlineMs).toISOString()
      : null;

    const task: Task = {
      id,
      correlationId: id, // correlation_id = task_id bei Erstellung
      requester,
      executor: null,
      state: 'requested',
      skillId,
      input,
      result: null,
      error: null,
      createdAt: now.toISOString(),
      deadline,
      updatedAt: now.toISOString(),
    };

    this.tasks.set(id, task);
    this.correlationIndex.set(id, id);
    this.log?.info({ taskId: id, skillId, requester }, 'Task erstellt');
    return task;
  }

  /**
   * Akzeptiert einen Task (vom Executor aufgerufen).
   */
  accept(taskId: string, executor: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'requested') return null;

    task.state = 'accepted';
    task.executor = executor;
    task.updatedAt = new Date().toISOString();
    this.log?.info({ taskId, executor }, 'Task akzeptiert');
    return task;
  }

  /**
   * Lehnt einen Task ab.
   */
  reject(taskId: string, reason: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'requested') return null;

    task.state = 'rejected';
    task.error = reason;
    task.updatedAt = new Date().toISOString();
    this.log?.info({ taskId, reason }, 'Task abgelehnt');
    return task;
  }

  /**
   * Markiert einen Task als abgeschlossen.
   */
  complete(taskId: string, result: Record<string, unknown>): Task | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'accepted') return null;

    task.state = 'completed';
    task.result = result;
    task.updatedAt = new Date().toISOString();
    this.log?.info({ taskId }, 'Task abgeschlossen');
    return task;
  }

  /**
   * Markiert einen Task als fehlgeschlagen.
   */
  fail(taskId: string, error: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'accepted') return null;

    task.state = 'failed';
    task.error = error;
    task.updatedAt = new Date().toISOString();
    this.log?.warn({ taskId, error }, 'Task fehlgeschlagen');
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getTaskByCorrelation(correlationId: string): Task | undefined {
    const taskId = this.correlationIndex.get(correlationId);
    return taskId ? this.tasks.get(taskId) : undefined;
  }

  /** Alle Tasks eines bestimmten Zustands */
  getByState(state: TaskState): Task[] {
    return [...this.tasks.values()].filter((t) => t.state === state);
  }

  /** Alle Tasks (für Dashboard) */
  getAllTasks(): Task[] {
    return [...this.tasks.values()];
  }

  /** Aktive Tasks (requested oder accepted) */
  getActiveTasks(): Task[] {
    return [...this.tasks.values()].filter(
      (t) => t.state === 'requested' || t.state === 'accepted',
    );
  }

  stop(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private checkTimeouts(): void {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (
        task.deadline &&
        (task.state === 'requested' || task.state === 'accepted') &&
        new Date(task.deadline).getTime() < now
      ) {
        task.state = 'timeout';
        task.error = 'Deadline exceeded';
        task.updatedAt = new Date().toISOString();
        this.log?.warn({ taskId: task.id, deadline: task.deadline }, 'Task timeout');
      }
    }
  }
}
