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
import { evaluatePlacement } from './resource-metrics.js';
import {
  systemHealth,
  systemProcesses,
  systemNetwork,
  systemDisk,
} from './builtin-skills/system-monitor.js';
import {
  influxdbQuery,
  influxdbDatabases,
  influxdbMeasurements,
  influxdbWrite,
  influxdbHealthCheck,
} from './builtin-skills/influxdb.js';

export interface TaskExecutorDeps {
  tasks: TaskManager;
  skills: SkillManager;
  audit: AuditLog;
  eventBus: MeshEventBus;
  agentId: string;
  log?: Logger;
  /**
   * T2.4 place-or-refuse: liefert die aktuelle RAM-Auslastung in Prozent. Optional —
   * ohne Reader/Schwelle ist das Gate inert (Default-Verhalten unverändert).
   */
  getRamUsedPercent?: () => Promise<number>;
  /** T2.4: RAM-Schwelle (%), oberhalb derer neue Platzierung abgelehnt wird (>). */
  refuseRamPercent?: number;
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
  ): Promise<{ accepted: boolean; result?: Record<string, unknown>; error?: string; reason?: 'capacity' }> {
    const { tasks, audit, eventBus, agentId, log, getRamUsedPercent, refuseRamPercent } = this.deps;

    // T2.4 place-or-refuse: bei Überlast (RAM > Schwelle) keine neue Platzierung
    // annehmen — VOR dem Skill-Check, damit ein überlasteter Knoten gar nichts erst
    // einreiht. Gate ist inert, solange Reader + Schwelle nicht gesetzt sind.
    if (getRamUsedPercent && typeof refuseRamPercent === 'number') {
      // Fail-OPEN: kann die RAM-Auslastung nicht gemessen werden (flakiges
      // si.mem()), darf das NICHT jede Platzierung blockieren — lieber annehmen
      // als wegen eines Mess-Fehlers den Knoten lahmlegen.
      let ramUsedPercent: number | null = null;
      try {
        ramUsedPercent = await getRamUsedPercent();
      } catch (err) {
        log?.warn({ err, taskId, skillId }, '[place-or-refuse] RAM-Messung fehlgeschlagen — fail-open (Task wird angenommen)');
      }
      if (ramUsedPercent !== null && evaluatePlacement(ramUsedPercent, refuseRamPercent).refuse) {
        const msg = `Knoten überlastet: RAM ${ramUsedPercent.toFixed(1)}% > ${refuseRamPercent}% (place-or-refuse)`;
        log?.warn({ taskId, skillId, requester, ramUsedPercent, refuseRamPercent }, '[place-or-refuse] Task abgelehnt — RAM über Schwelle');
        audit.append('TASK_DELEGATE', requester, `${skillId} refused: RAM ${ramUsedPercent.toFixed(1)}% > ${refuseRamPercent}%`);
        eventBus.emit('task:refused', { taskId, skillId, requester, reason: 'capacity', ramUsedPercent });
        return { accepted: false, error: msg, reason: 'capacity' };
      }
    }

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

    // influxdb Skills (nur wenn erreichbar)
    influxdbHealthCheck().then((available) => {
      if (available) {
        this.handlers.set('influxdb.query', async (input) =>
          await influxdbQuery(
            input['query'] as string,
            input['database'] as string | undefined,
            input['epoch'] as string | undefined,
          ),
        );
        this.handlers.set('influxdb.databases', async () => await influxdbDatabases());
        this.handlers.set('influxdb.measurements', async (input) =>
          await influxdbMeasurements(input['database'] as string),
        );
        this.handlers.set('influxdb.write', async (input) =>
          await influxdbWrite(
            input['database'] as string,
            input['lines'] as string,
            input['precision'] as string | undefined,
          ),
        );
        this.deps.log?.info('InfluxDB Skill-Handler registriert');
      }
    });

    this.deps.log?.info({ skills: [...this.handlers.keys()] }, 'Builtin-Skill-Handler registriert');
  }
}
