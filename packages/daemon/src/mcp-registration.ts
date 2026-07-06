// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-registration.ts — ADR-028 D4-a (Registrierungs-Slice): komponiert den
 * Shared-MCP-Config-Vertrag (`mcp-share-config`) mit dem Capability-Modell
 * (`mcp-service-registry`) zu registrierbaren CRDT-`Capability`s und schreibt sie
 * in die lokale Registry — owner-gegated by construction (eigene `agent_id`).
 *
 * Reine Komposition + dünner Registrar (Registry injizierbar) → unit-testbar.
 * KEIN Routing/Endpoint/Cert/Flag, KEIN Deploy. Die Boot-Verdrahtung (Config-Pfad
 * `mcp.share` lesen + Aufruf beim Start) ist der unmittelbare Folge-Slice.
 *
 * Zwei-Stufen-Fehlerverhalten (bewusst):
 *  - **Strukturell falsche Config** (non-array, fehlender server/description, …):
 *    `parseSharedMcpConfig` wirft → Boot soll fail-fast scheitern (klarer Operator-Fehler).
 *  - **Einzelner Eintrag**, den der Parser strukturell akzeptiert, aber
 *    `buildMcpCapability` ablehnt (z.B. Servername-Charset/Kanonisierung): wird
 *    **geloggt + übersprungen**, bricht NICHT den Boot.
 */
import type { Logger } from 'pino';
import type { Capability } from './registry.js';
import { buildMcpCapability } from './mcp-service-registry.js';
import { parseSharedMcpConfig, enabledSharedMcps } from './mcp-share-config.js';

/** Ergebnis der Komposition: registrierbare Capabilities + übersprungene Einträge. */
export interface SharedMcpBuildResult {
  /** Saubere Basis-`Capability`s (execution_tier gestrippt — CRDT hält nur das Schema). */
  capabilities: Capability[];
  /** Einzeln verworfene Einträge mit Grund (Boot-fail-soft). */
  skipped: Array<{ server: string; reason: string }>;
}

/**
 * Reine Komposition: rohe `mcp.share`-Config → enabled Shared-MCPs (default-open)
 * → registrierbare Basis-`Capability`s. `agentId` = eigene SPIFFE-Identität,
 * `nowIso` = Zeitstempel vom Aufrufer (reines Modul ruft keine Uhr). Wirft nur bei
 * strukturell ungültiger Config (über `parseSharedMcpConfig`); einzelne ungültige
 * Server werden in `skipped` gesammelt statt zu werfen.
 */
export function buildSharedMcpCapabilities(rawShareConfig: unknown, agentId: string, nowIso: string): SharedMcpBuildResult {
  const capabilities: Capability[] = [];
  const skipped: Array<{ server: string; reason: string }> = [];
  for (const decl of enabledSharedMcps(parseSharedMcpConfig(rawShareConfig))) {
    try {
      // execution_tier gehört NICHT ins CRDT (registry.register blacklistet es nicht) →
      // hier explizit strippen; resolveMcp leitet die Stufe ohnehin aus permissions/trust_level ab.
      const { execution_tier: _tier, ...cap } = buildMcpCapability({
        server: decl.server,
        description: decl.description,
        tools: decl.tools,
        version: decl.version,
        permissions: decl.permissions,
        trust_level: decl.trust_level,
        agent_id: agentId,
        updated_at: nowIso,
      });
      void _tier;
      capabilities.push(cap);
    } catch (err) {
      skipped.push({ server: decl.server, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { capabilities, skipped };
}

/**
 * Phantom-Announce-Guard (ADR-032): filtert das Build-Ergebnis fürs Announcen.
 * `serve_shared=true` → unverändert durchreichen (dieser Node ist Provider);
 * `serve_shared=false` → KEINE Capabilities announcen (die deklarierten wandern
 * mit klarem Grund nach `skipped`), damit ein Nicht-Provider (Spoke, der nur das
 * fleet-weite Template ausliefert) keine `mcp:*`-Phantom-Provider ins CRDT gossipt.
 *
 * Bewusst NUR eine Provider-Designation, keine Reachability-Probe: solange local-exec
 * (Q1) zurückgestellt ist, gibt es keinen lokalen Serve-Prozess zu proben. Eine echte
 * Liveness-Probe supersediert diesen Gate, sobald das lokale Serving landet.
 */
export function guardSharedMcpAnnounce(serveShared: boolean, result: SharedMcpBuildResult): SharedMcpBuildResult {
  if (serveShared) return result;
  return {
    capabilities: [],
    skipped: [
      ...result.capabilities.map((c) => ({ server: c.skill_id, reason: 'serve_shared=false (phantom-announce-guard)' })),
      ...result.skipped,
    ],
  };
}

/** Minimale Registry-Schnittstelle für den Registrar (injizierbar/testbar). */
export interface CapabilityRegistrar {
  register(capability: Capability): void;
}

/**
 * Registriert die gebauten Shared-MCP-Capabilities in der lokalen Registry
 * (owner-gegated: eigene `agent_id`). Loggt übersprungene Einträge und die
 * registrierten Server. Liefert die Anzahl registrierter Capabilities.
 */
export function registerSharedMcps(registry: CapabilityRegistrar, result: SharedMcpBuildResult, log?: Logger): number {
  for (const cap of result.capabilities) {
    registry.register(cap);
  }
  if (result.skipped.length > 0) {
    log?.warn({ skipped: result.skipped }, '[mcp-share] ungültige Shared-MCP-Einträge übersprungen (Boot nicht abgebrochen)');
  }
  if (result.capabilities.length > 0) {
    log?.info(
      { count: result.capabilities.length, servers: result.capabilities.map((c) => c.skill_id) },
      '[mcp-share] Shared-MCPs als Capabilities registriert (Discovery default-open)',
    );
  }
  return result.capabilities.length;
}
