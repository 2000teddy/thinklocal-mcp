// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * service-dependencies.ts — generische Ableitung von systemd-`After=`/`Wants=`-Zeilen
 * aus den deklarierten externen Service-Abhängigkeiten der (eingebauten) Skills.
 *
 * Hintergrund (Boot-Race 2026-05-17): Ein Skill mit externer Abhängigkeit (z.B. der
 * InfluxDB-Skill braucht `influxdb.service`) muss seinen Daemon erst NACH dem Service
 * starten lassen, sonst ist der Skill bis zum nächsten Restart unsichtbar. Auf dem
 * influxdb-Host wurde das manuell via `After=influxdb.service`/`Wants=influxdb.service`
 * in der systemd-Unit gepatcht — dieses Modul spiegelt das **generisch** in den Installer:
 * die Service-Namen kommen aus den Skill-Manifests (`requirements.services`), NICHT
 * hartkodiert, und es werden nur Services berücksichtigt, deren systemd-Unit auf dem
 * Host tatsächlich existiert (sonst gäbe es auf Nicht-influxdb-Hosts ein hängendes
 * `Wants=` auf eine nicht vorhandene Unit).
 *
 * Reine Funktionen (Host-Probe injizierbar) → vollständig unit-testbar.
 */

import { INFLUXDB_MANIFEST } from './builtin-skills/influxdb.js';
import { SYSTEM_MONITOR_MANIFEST } from './builtin-skills/system-monitor.js';

interface ManifestWithServiceReq {
  requirements?: { services?: string[] };
}

/**
 * Sammelt die Vereinigung aller externen Service-Abhängigkeiten (`requirements.services`)
 * über eine Liste von Skill-Manifests. Eindeutig + sortiert (deterministisch).
 */
export function collectSkillServiceDeps(manifests: readonly ManifestWithServiceReq[]): string[] {
  const set = new Set<string>();
  for (const m of manifests) {
    for (const svc of m.requirements?.services ?? []) {
      if (svc.trim().length > 0) set.add(svc.trim());
    }
  }
  return [...set].sort();
}

/**
 * Externe systemd-Service-Deps der EINGEBAUTEN Skills — generisch aus den Manifests
 * abgeleitet (single source of truth für den Installer; aktuell: `influxdb`).
 */
export const BUILTIN_SKILL_SERVICE_DEPS: string[] = collectSkillServiceDeps([
  INFLUXDB_MANIFEST,
  SYSTEM_MONITOR_MANIFEST,
]);

/**
 * Erzeugt `After=<svc>.service`/`Wants=<svc>.service`-Zeilen für genau die Services aus
 * `services`, deren systemd-Unit auf dem Host existiert (`serviceUnitExists`). Für jeden
 * passenden Service eine After- UND eine Wants-Zeile (Ordering + Soft-Dependency, wie der
 * manuelle .56-Patch). Reihenfolge stabil (sortiert). Keine Duplikate.
 */
export function serviceUnitDependencyLines(
  services: readonly string[],
  serviceUnitExists: (svc: string) => boolean,
): string[] {
  const lines: string[] = [];
  for (const svc of [...new Set(services)].sort()) {
    if (serviceUnitExists(svc)) {
      lines.push(`After=${svc}.service`);
      lines.push(`Wants=${svc}.service`);
    }
  }
  return lines;
}
