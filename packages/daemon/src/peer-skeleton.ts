// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * peer-skeleton.ts — TL-21 Skelett-Auskunft für Peers (Kap. 06, Kontext-Ökonomie).
 *
 * Reine, kompakte Projektion vorhandener `MeshPeer`-Daten in eine „ein Eintrag pro Peer"-Übersicht:
 * `agent_id` + `name` + `status` + Zähler statt der vollen Agent-Card. Kein State, kein I/O,
 * deterministisch (kein Date/Random). Analog zu `capability-skeleton.ts` (Slice 1/2).
 *
 * Zweck: `GET /api/peers` liefert je (online-)Peer die **volle** Agent-Card inkl. der kompletten
 * `capabilities`-Arrays (agents/skills/services/connectors) und des numerischen `health`-Objekts —
 * für die Erst-Orientierung „wer ist im Mesh?" ist das zu viel. Diese Skelett-Sicht ersetzt die
 * Arrays durch **Zähler** und die volle Card durch wenige Signale. Details bleiben auf Abruf über
 * den unveränderten `GET /api/peers`.
 *
 * Siehe docs/architecture/TL-21-skeleton-disclosure.md §4.
 */

import type { MeshPeer, PeerStatus } from './mesh.js';

/** Ein Skelett-Eintrag: das Minimum für die Erst-Orientierung (Details via GET /api/peers). */
export interface PeerSkeletonEntry {
  agent_id: string;
  name: string;
  /** Heartbeat-Status des Peers (verbatim aus der Mesh-Sicht). */
  status: PeerStatus;
  /** Agent-Card-Version, falls eine Card vorliegt; sonst `null`. */
  version: string | null;
  /** Anzahl der von diesem Peer angebotenen Skills (0, falls keine Card / kein Array). */
  skills: number;
  /** Worker-Auslastung 0–100 aus der Agent-Card, falls vorhanden; sonst `null`. */
  load_percent: number | null;
}

/** Die drei gültigen Heartbeat-Zustände (defensiver Filter gegen geschmiedete `status`-Werte). */
const VALID_STATUS: ReadonlySet<PeerStatus> = new Set<PeerStatus>(['online', 'offline', 'unknown']);

/**
 * Total-fail-safe String-Sicht auf runtime-untypisierte Felder: `MeshPeer.agentId`/`name` sind
 * typisiert `string`, aber `agentCard` stammt aus der Wire-/Peer-Quelle. Ein geschmiedeter
 * Nicht-String würde einen Comparator/Sort sprengen → hier deterministisch auf `''` normalisiert.
 */
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Endliche Zahl oder `null` (NaN/Infinity/non-number → `null`; kein NaN-Vergleich, kein Overclaim). */
const asFiniteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Fixe, locale-unabhängige String-Ordnung (Cross-Host-Determinismus, analog capability-skeleton). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Zählt die Skills der Agent-Card total gegen malformed/fehlende Daten: nur ein echtes Array zählt,
 * alles andere (kein Card, `skills` non-array, geforgt) → `0`. Kein throw, deterministisch.
 */
function skillCount(peer: MeshPeer): number {
  const skills = (peer.agentCard as { capabilities?: { skills?: unknown } } | null)?.capabilities
    ?.skills;
  return Array.isArray(skills) ? skills.length : 0;
}

/**
 * Baut die kompakte Peer-Skelett-Übersicht: ein Eintrag pro übergebenem Peer, sortiert nach `agent_id`
 * (stabil, locale-unabhängig). Rein, deterministisch (kein Date/Random), total gegen malformed
 * Agent-Card-Daten — eine geschmiedete Card kippt die additive Read-View NICHT in einen 500er.
 *
 * `status` wird gegen die drei gültigen Zustände geprüft; ein unbekannter (geforgter) Wert fällt
 * defensiv auf `'unknown'` zurück, statt einen frei erfundenen String durchzureichen.
 */
export function buildPeerSkeleton(peers: MeshPeer[]): PeerSkeletonEntry[] {
  const entries: PeerSkeletonEntry[] = [];
  for (const p of peers) {
    const card = p.agentCard;
    const status: PeerStatus = VALID_STATUS.has(p.status) ? p.status : 'unknown';
    entries.push({
      agent_id: asStr(p.agentId),
      name: asStr(p.name),
      status,
      version: card ? asStr(card.version) || null : null,
      skills: skillCount(p),
      load_percent: card
        ? asFiniteOrNull((card as { worker?: { load_percent?: unknown } }).worker?.load_percent)
        : null,
    });
  }
  return entries.sort((a, b) => cmpStr(a.agent_id, b.agent_id));
}

/** Envelope der Peer-Skelett-Übersicht (`{ peers, count }`). Kein I/O, deterministisch. */
export interface PeerOverview {
  peers: PeerSkeletonEntry[];
  count: number;
}

/**
 * EINE Quelle der Wahrheit für die TL-21-Peer-Übersicht-Nutzlast — analog `buildCapabilityOverview`.
 * Vom REST-Endpoint `GET /api/peers/overview` benutzt (ein späteres MCP-Tool könnte denselben
 * Builder teilen → strukturelle Parität statt Drift). `count` ist immer `peers.length`.
 */
export function buildPeerOverview(peers: MeshPeer[]): PeerOverview {
  const skeleton = buildPeerSkeleton(peers);
  return { peers: skeleton, count: skeleton.length };
}
