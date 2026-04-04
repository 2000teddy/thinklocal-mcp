/**
 * influxdb.ts — Eingebauter Skill: InfluxDB 1.x Integration
 *
 * Stellt MCP-Tools fuer InfluxDB-Zugriff bereit:
 * - influxdb.query: InfluxQL-Queries ausfuehren (SELECT, SHOW)
 * - influxdb.databases: Datenbanken auflisten
 * - influxdb.measurements: Measurements einer Datenbank auflisten
 * - influxdb.write: Datenpunkte im Line-Protocol schreiben
 *
 * Wird automatisch beim Daemon-Start registriert wenn InfluxDB erreichbar ist.
 *
 * Konfiguration via Env:
 *   INFLUXDB_URL=http://localhost:8086 (Default)
 *   INFLUXDB_USERNAME (optional)
 *   INFLUXDB_PASSWORD (optional)
 */

import type { SkillManifest } from '../skills.js';

const INFLUXDB_URL = process.env['INFLUXDB_URL'] ?? 'http://localhost:8086';
const INFLUXDB_USERNAME = process.env['INFLUXDB_USERNAME'];
const INFLUXDB_PASSWORD = process.env['INFLUXDB_PASSWORD'];

export const INFLUXDB_MANIFEST: SkillManifest = {
  id: 'influxdb',
  version: '1.0.0',
  description: 'InfluxDB 1.x: Queries, Measurements, Writes via InfluxQL',
  author: '', // Wird beim Registrieren mit der Agent-ID befuellt
  integrity: 'builtin',
  runtime: 'node',
  entrypoint: 'builtin',
  dependencies: [],
  tools: ['influxdb.query', 'influxdb.databases', 'influxdb.measurements', 'influxdb.write'],
  resources: [],
  category: 'database',
  permissions: ['influxdb.read', 'influxdb.write'],
  requirements: { os: ['darwin', 'linux', 'win32'], services: ['influxdb'] },
  createdAt: new Date().toISOString(),
};

// --- Hilfsfunktionen ---

function authParams(): URLSearchParams {
  const params = new URLSearchParams();
  if (INFLUXDB_USERNAME) params.set('u', INFLUXDB_USERNAME);
  if (INFLUXDB_PASSWORD) params.set('p', INFLUXDB_PASSWORD);
  return params;
}

/**
 * Prueft ob nur lesende Queries erlaubt sind (SELECT, SHOW, kein DROP/DELETE/ALTER).
 * Gibt true zurueck wenn die Query sicher ist.
 */
function isSafeQuery(q: string): boolean {
  const upper = q.trim().toUpperCase();
  const dangerous = /^(DROP|DELETE|ALTER|CREATE|GRANT|REVOKE|KILL)\b/;
  return !dangerous.test(upper);
}

// --- Tool-Implementierungen ---

/**
 * Fuehrt eine InfluxQL-Query aus (nur SELECT/SHOW).
 * Fuer schreibende Operationen → influxdbWrite()
 */
export async function influxdbQuery(
  query: string,
  database?: string,
  epoch?: string,
): Promise<Record<string, unknown>> {
  if (!isSafeQuery(query)) {
    return { error: 'Nur SELECT und SHOW Queries erlaubt. Fuer Writes nutze influxdb.write.' };
  }

  const params = authParams();
  params.set('q', query);
  if (database) params.set('db', database);
  if (epoch) params.set('epoch', epoch);

  const res = await fetch(`${INFLUXDB_URL}/query?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    return { error: `InfluxDB Query fehlgeschlagen: ${res.status}`, detail: body };
  }

  const data = (await res.json()) as { results: Array<{ series?: unknown[]; error?: string }> };

  // Ergebnisse aufbereiten
  const results = data.results.map((r, i) => {
    if (r.error) return { statement: i, error: r.error };
    if (!r.series || r.series.length === 0) return { statement: i, series: [] };
    return { statement: i, series: r.series };
  });

  return { results };
}

/**
 * Listet alle Datenbanken auf.
 */
export async function influxdbDatabases(): Promise<Record<string, unknown>> {
  const params = authParams();
  params.set('q', 'SHOW DATABASES');

  const res = await fetch(`${INFLUXDB_URL}/query?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    return { error: `InfluxDB Fehler: ${res.status}`, detail: body };
  }

  const data = (await res.json()) as {
    results: Array<{ series?: Array<{ values?: string[][] }> }>;
  };

  const series = data.results[0]?.series?.[0]?.values;
  const databases = series ? series.map((v) => v[0]) : [];

  return { databases };
}

/**
 * Listet alle Measurements einer Datenbank auf.
 */
export async function influxdbMeasurements(database: string): Promise<Record<string, unknown>> {
  const params = authParams();
  params.set('q', 'SHOW MEASUREMENTS');
  params.set('db', database);

  const res = await fetch(`${INFLUXDB_URL}/query?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    return { error: `InfluxDB Fehler: ${res.status}`, detail: body };
  }

  const data = (await res.json()) as {
    results: Array<{ series?: Array<{ values?: string[][] }> }>;
  };

  const series = data.results[0]?.series?.[0]?.values;
  const measurements = series ? series.map((v) => v[0]) : [];

  return { database, measurements };
}

/**
 * Schreibt Datenpunkte im InfluxDB Line Protocol.
 * Format: "measurement,tag=value field=value timestamp"
 */
export async function influxdbWrite(
  database: string,
  lines: string,
  precision?: string,
): Promise<Record<string, unknown>> {
  const params = authParams();
  params.set('db', database);
  if (precision) params.set('precision', precision);

  const res = await fetch(`${INFLUXDB_URL}/write?${params.toString()}`, {
    method: 'POST',
    body: lines,
  });

  if (res.status === 204) {
    const lineCount = lines.trim().split('\n').length;
    return { success: true, points_written: lineCount };
  }

  const body = await res.text();
  return { error: `InfluxDB Write fehlgeschlagen: ${res.status}`, detail: body };
}

/**
 * Prueft ob InfluxDB erreichbar ist.
 */
export async function influxdbHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${INFLUXDB_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}
