// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tool-class-drift.ts — ADR-042 (TL-08 Slice 2c): **live** Drift-Check-Verdrahtung für die gepflegte
 * Server-Klassen-Map (ADR-039/040). Ergänzt den reinen Snapshot-Lint `computeToolClassDrift` um einen
 * testbaren Seam gegen ein **live** `tools/list`.
 *
 * **Secret-sicher:** `tools/list` liefert nur Tool-Namen + Input-Schemata, nie Werte — kein Credential-Risiko
 * (im Gegensatz zum Aufruf der Tools selbst). Fail-safe: ein Fetch-Fehler → `null` + warn, nie ein Crash.
 */
import type { Logger } from 'pino';
import {
  SERVER_TOOL_CLASSES,
  canonicalizeServerName,
  computeToolClassDrift,
  type ToolClassDrift,
} from './mcp-service-registry.js';

/** Liefert die live Tool-Namen eines Servers (real: `mcp_list_tools`/Mesh-Proxy). Secret-sicher. */
export type ToolListFetcher = (server: string) => Promise<readonly string[]>;

/** Minimaler Logger-Ausschnitt (testbar ohne pino-Instanz). */
export type DriftLogger = Pick<Logger, 'warn' | 'info'>;

/**
 * Prüft eine governed Server-Klassen-Map gegen ihr **live** Inventar. Warn-loggt Drift
 * (`staleReadOnly`/`staleSensitive`/`unclassified` = Kurations-Signal). Ungoverned Server → `null`
 * (nichts zu prüfen). Fetch-Fehler → `null` + warn (fail-safe). Gibt den Drift (oder `null`) zurück.
 */
export async function checkToolClassDrift(
  server: string,
  fetchTools: ToolListFetcher,
  log?: DriftLogger,
): Promise<ToolClassDrift | null> {
  const canon = canonicalizeServerName(server);
  const classes = SERVER_TOOL_CLASSES[canon];
  if (!classes) return null; // ungoverned — keine Map, kein Drift-Begriff
  let live: readonly string[];
  try {
    live = await fetchTools(server);
  } catch (err) {
    log?.warn({ server: canon, err: err instanceof Error ? err.message : String(err) },
      '[tool-class] Drift-Check: tools/list-Fetch fehlgeschlagen');
    return null;
  }
  const drift = computeToolClassDrift(classes, live);
  const hasDrift =
    drift.staleReadOnly.length > 0 || drift.staleSensitive.length > 0 || drift.unclassified.length > 0;
  if (hasDrift) {
    log?.warn(
      { server: canon, ...drift },
      '[tool-class] Drift erkannt — Klassen-Map kuratieren (stale = entfernt/vertippt; unclassified = neues Tool)',
    );
  } else {
    log?.info({ server: canon, live: live.length }, '[tool-class] Drift-Check: Klassen-Map konsistent');
  }
  return drift;
}
