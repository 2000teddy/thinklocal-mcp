// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * agent-poll-config.ts — A5: Konfiguration des **Agent-Empfangs-Loops** (Inbox-Polling, ADR-004).
 *
 * WICHTIGE ABGRENZUNG (Christian, 2026-07-03): Dies ist **NICHT** der Daemon-Peer-Heartbeat.
 * Es gibt im System zwei getrennte periodische Takte, die nie verwechselt werden dürfen:
 *
 *   1. `TLMCP_HEARTBEAT_MS` → `mesh.heartbeat_interval_ms` (config.ts): der **Daemon-zu-Daemon**-
 *      Liveness-Heartbeat im Mesh (Peer online/offline nach 3 Missed Beats). Läuft im Daemon,
 *      betrifft die Peer-Topologie.
 *   2. `TLMCP_AGENT_POLL_INITIAL_MS` / `TLMCP_AGENT_POLL_MAX_MS` (dieses Modul): der Takt, mit dem
 *      ein **Agent** (via Supervisor/Hook, AUSSERHALB des LLM) seine lokale Inbox auf neue
 *      Nachrichten abfragt. Betrifft NICHT die Mesh-Topologie, sondern nur die Zustell-Latenz an
 *      den Agenten. Adaptiv: schnell (`initialMs`) solange Verkehr da ist, Backoff bis `maxMs` im
 *      Leerlauf → 0 LLM-Tokens im Leerlauf (der Poll ist ein REST-Loopback-Call, kein LLM-Turn).
 *
 * Reine Funktionen (kein I/O, keine Uhr) → vollständig unit-testbar.
 */
import type { RuntimeMode } from './runtime-mode.js';

/** Adaptive Poll-Kadenz des Agent-Empfangs-Loops (getrennt vom Daemon-Heartbeat). */
export interface AgentPollConfig {
  /** Kürzestes Intervall (aktiver Zustand). Nach jedem Zyklus mit Verkehr wird hierauf zurückgesetzt. */
  initialMs: number;
  /** Längstes Intervall (Leerlauf-Backoff-Obergrenze). */
  maxMs: number;
}

/**
 * Mode-abhängige Defaults (ADR-004). `lan` = normaler Mesh-Betrieb (5s aktiv → 30s Leerlauf);
 * `local` = Einzelrechner/Entwicklung, etwas straffer.
 */
export const AGENT_POLL_MODE_DEFAULTS: Record<RuntimeMode, AgentPollConfig> = {
  lan: { initialMs: 5_000, maxMs: 30_000 },
  local: { initialMs: 2_000, maxMs: 15_000 },
};

/** Positive, endliche Ganzzahl aus einer Env-Variable — sonst (fehlt/ungültig/≤0) der Fallback. */
function readIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Löst die Agent-Poll-Kadenz aus Env-Overrides + Mode-Defaults auf. Reine Funktion, wirft nicht.
 *
 * - `TLMCP_AGENT_POLL_INITIAL_MS` / `TLMCP_AGENT_POLL_MAX_MS` überschreiben den jeweiligen Default;
 *   fehlend/ungültig/≤0 → Mode-Default (fail-safe, kein Crash bei Fehlkonfiguration).
 * - **Invariante `maxMs ≥ initialMs`:** ein fehlkonfiguriertes `maxMs < initialMs` wird auf `initialMs`
 *   angehoben (nie ein Backoff, der kürzer als das aktive Intervall ist).
 */
export function resolveAgentPollConfig(
  env: Record<string, string | undefined>,
  mode: RuntimeMode,
): AgentPollConfig {
  const defaults = AGENT_POLL_MODE_DEFAULTS[mode] ?? AGENT_POLL_MODE_DEFAULTS.lan;
  const initialMs = readIntEnv(env['TLMCP_AGENT_POLL_INITIAL_MS'], defaults.initialMs);
  const maxMs = Math.max(readIntEnv(env['TLMCP_AGENT_POLL_MAX_MS'], defaults.maxMs), initialMs);
  return { initialMs, maxMs };
}
