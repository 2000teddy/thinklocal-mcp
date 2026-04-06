/**
 * task-queue.ts — Task-Priorisierung und Queue-Management
 *
 * Verwaltet eine priorisierte Warteschlange fuer Task-Requests.
 * Hoehere Prioritaet = wird zuerst ausgefuehrt.
 * Begrenzte Parallelitaet (max concurrent tasks).
 */

import type { Logger } from 'pino';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

const PRIORITY_VALUES: Record<TaskPriority, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 0,
};

export interface QueuedTask {
  id: string;
  skillId: string;
  input: unknown;
  priority: TaskPriority;
  requesterId: string;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface TaskQueueConfig {
  /** Max parallele Tasks (default: 5) */
  maxConcurrent?: number;
  /** Max Queue-Laenge (default: 100) */
  maxQueueSize?: number;
}

/**
 * Priorisierte Task-Queue mit begrenzter Parallelitaet.
 */
export class TaskQueue {
  private queue: QueuedTask[] = [];
  private running = new Map<string, QueuedTask>();
  private completed: QueuedTask[] = [];
  private maxConcurrent: number;
  private maxQueueSize: number;
  private processing = false; // SECURITY: Verhindert Race Conditions bei parallelem processNext()
  private executor?: (task: QueuedTask) => Promise<{ result?: unknown; error?: string }>;

  constructor(
    config?: TaskQueueConfig,
    private log?: Logger,
  ) {
    this.maxConcurrent = config?.maxConcurrent ?? 5;
    this.maxQueueSize = config?.maxQueueSize ?? 100;
  }

  /** Registriert den Task-Executor */
  setExecutor(fn: (task: QueuedTask) => Promise<{ result?: unknown; error?: string }>): void {
    this.executor = fn;
  }

  /**
   * Fuegt einen Task in die Queue ein.
   * Gibt die Task-ID zurueck oder null wenn Queue voll.
   */
  enqueue(task: Omit<QueuedTask, 'enqueuedAt' | 'status'>): string | null {
    if (this.queue.length >= this.maxQueueSize) {
      this.log?.warn({ skillId: task.skillId, queueSize: this.queue.length }, 'Task-Queue voll');
      return null;
    }

    const queued: QueuedTask = {
      ...task,
      enqueuedAt: Date.now(),
      status: 'queued',
    };

    // Einsortieren nach Prioritaet (hoechste zuerst)
    const insertIdx = this.queue.findIndex(
      (t) => PRIORITY_VALUES[t.priority] < PRIORITY_VALUES[queued.priority],
    );
    if (insertIdx === -1) {
      this.queue.push(queued);
    } else {
      this.queue.splice(insertIdx, 0, queued);
    }

    this.log?.debug({ id: task.id, skillId: task.skillId, priority: task.priority, position: insertIdx === -1 ? this.queue.length : insertIdx }, 'Task eingereiht');

    // Versuche sofort auszufuehren
    this.processNext();

    return task.id;
  }

  /** Verarbeitet den naechsten Task wenn Kapazitaet frei.
   *  SECURITY: Mutex-Flag verhindert Race Conditions bei parallelen Aufrufen.
   */
  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (!this.executor) return;
    if (this.running.size >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    const task = this.queue.shift()!;
    task.status = 'running';
    task.startedAt = Date.now();
    this.running.set(task.id, task);
    this.processing = false;

    try {
      const result = await this.executor(task);
      task.status = result.error ? 'failed' : 'completed';
      task.result = result.result;
      task.error = result.error;
    } catch (err) {
      task.status = 'failed';
      task.error = String(err);
    } finally {
      task.completedAt = Date.now();
      this.running.delete(task.id);
      this.completed.push(task);
      // Nur letzte 200 behalten
      if (this.completed.length > 200) {
        this.completed = this.completed.slice(-200);
      }
      // Naechsten Task starten (nach Cleanup des Flags)
      this.processNext();
    }
  }

  /** Queue-Status */
  getStats(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    maxConcurrent: number;
  } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: this.completed.filter((t) => t.status === 'completed').length,
      failed: this.completed.filter((t) => t.status === 'failed').length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /** Gibt einen spezifischen Task zurueck */
  getTask(id: string): QueuedTask | undefined {
    return this.queue.find((t) => t.id === id)
      ?? this.running.get(id)
      ?? this.completed.find((t) => t.id === id);
  }

  /** Entfernt einen Task aus der Queue (nur wenn noch nicht gestartet) */
  cancel(id: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }
}
