/**
 * task-executor.ts — Automatische Task-Ausfuehrung fuer eingehende Requests
 *
 * Wenn ein TASK_REQUEST eingeht und der lokale Node den angeforderten
 * Skill besitzt, wird der Task automatisch akzeptiert und ausgefuehrt.
 *
 * Unterstuetzte Builtin-Skills:
 * - system.health, system.processes, system.network, system.disk
 *
 * Fuer externe Skills (Phase 3): Sandbox-Ausfuehrung
 */

import type { Logger } from 'pino';
import type { TaskManager } from './tasks.js';
import type { SkillManager } from './skills.js';
import type { AuditLog } from './audit.js';
import type { MeshEventBus } from './events.js';
import {
  systemHealth,
  systemProcesses,
  systemNetwork,
  systemDisk,
} from './builtin-skills/system-monitor.js';

export interface TaskExecutorDeps {
  tasks: TaskManager;
  skills: SkillManager;
  audit: AuditLog;
  eventBus: MeshEventBus;
  agentId: string;
  log?: Logger;
}

type SkillHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class TaskExecutor {
  /** Registrierte Skill-Handler (skill_id → Handler-Funktion) */
  private handlers = new Map<string, SkillHandler>();

  constructor(private deps: TaskExecutorDeps) {
    // Builtin-Skills registrieren
    this.registerBuiltinSkills();
  }

  /**
   * Verarbeitet einen eingehenden TASK_REQUEST.
   * Akzeptiert und fuehrt den Task aus wenn ein passender Skill vorhanden ist.
   */
  async handleTaskRequest(
    taskId: string,
    skillId: string,
    input: Record<string, unknown>,
    requester: string,
  ): Promise<{ accepted: boolean; result?: Record<string, unknown>; error?: string }> {
    const { tasks, audit, eventBus, agentId, log } = this.deps;

    // Pruefen ob wir den Skill haben
    const handler = this.handlers.get(skillId);
    if (!handler) {
      log?.debug({ skillId }, 'Task abgelehnt — Skill nicht vorhanden');
      return { accepted: false, error: `Skill '${skillId}' nicht verfuegbar` };
    }

    // Task akzeptieren
    const accepted = tasks.accept(taskId, agentId);
    if (!accepted) {
      return { accepted: false, error: 'Task konnte nicht akzeptiert werden' };
    }

    log?.info({ taskId, skillId, requester }, 'Task akzeptiert — fuehre aus...');
    eventBus.emit('task:accepted', { taskId, skillId, requester });
    audit.append('TASK_DELEGATE', requester, `${skillId} accepted`);

    // Skill ausfuehren
    try {
      const result = await handler(input);
      tasks.complete(taskId, result);
      log?.info({ taskId, skillId }, 'Task erfolgreich abgeschlossen');
      eventBus.emit('task:completed', { taskId, skillId });
      return { accepted: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      tasks.fail(taskId, errorMsg);
      log?.warn({ taskId, skillId, error: errorMsg }, 'Task fehlgeschlagen');
      eventBus.emit('task:failed', { taskId, skillId, error: errorMsg });
      return { accepted: true, error: errorMsg };
    }
  }

  /** Registriert einen Custom-Skill-Handler */
  registerHandler(skillId: string, handler: SkillHandler): void {
    this.handlers.set(skillId, handler);
    this.deps.log?.debug({ skillId }, 'Skill-Handler registriert');
  }

  /** Pruefen ob ein Skill-Handler vorhanden ist */
  hasHandler(skillId: string): boolean {
    return this.handlers.has(skillId);
  }

  private registerBuiltinSkills(): void {
    // system-monitor Skills
    this.handlers.set('system.health', async () => await systemHealth());
    this.handlers.set('system.processes', async (input) =>
      await systemProcesses((input['limit'] as number) ?? 10),
    );
    this.handlers.set('system.network', async () => await systemNetwork());
    this.handlers.set('system.disk', async () => await systemDisk());

    this.deps.log?.info({ skills: [...this.handlers.keys()] }, 'Builtin-Skill-Handler registriert');
  }
}
