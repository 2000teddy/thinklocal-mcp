// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-service-registry.ts — ADR-028 D4-a: reines Modell + Auflösung für geteilte
 * MCP-Server als namespaced Capabilities im bestehenden CRDT (ADR-020).
 *
 * Reine Funktionen (kein I/O, keine Uhr, kein CRDT-/Netz-Wiring) → vollständig
 * unit-testbar. Live-Registrierung, `/api/capabilities`-Filter und das Routing
 * (`/api/mcp/<server>`) sind bewusst NICHT hier (D4-a-Teil-2 / D4-b).
 *
 * Arbeitslinie (ADR-028-D4-Patch 2026-06-19): **Discovery default-open** — kein
 * Allowlist-Filter, keine deny-by-default-per-Agent-Logik. Das Ausführungsrisiko
 * wird über die **Ausführungsstufe** `self | gate | consensus` gesteuert, NICHT
 * über die Sichtbarkeit. `execution_tier` ist aus `permissions`/`trust_level`
 * ableitbar (hier `deriveExecutionTier`).
 *
 * Designloch geschlossen (minimal): die `Capability` (registry.ts) verlangt
 * `agent_id` + `updated_at` (+ `health`), die in der vorgeschlagenen Signatur
 * fehlten. Sie sind umgebungsabhängig (eigene Node-Identität / Zeitstempel) und
 * werden daher als Eingaben übergeben (`agent_id`, `updated_at`) bzw. defaulten
 * (`health='healthy'`; die echte Laufzeit-Liveness besitzt die ADR-021-Side-Map).
 */
import type { Capability, CapabilityHealth } from './registry.js';

/** Präfix-Namespace für MCP-Service-Capabilities in der CRDT-`capabilities`-Map. */
export const MCP_CATEGORY = 'mcp';
/** `skill_id`-Präfix: `mcp:<server>`. */
export const MCP_SKILL_PREFIX = 'mcp:';

/** Ausführungsstufe (ADR-028-D4): Discovery offen, Risiko über die Stufe. */
export type McpExecutionTier = 'self' | 'gate' | 'consensus';

/** Trust-Level (0–5), unter dem selbst Read-only mindestens `gate` braucht. */
export const LOW_TRUST_GATE_THRESHOLD = 2;

/**
 * Permission-Tokens (case-insensitive, Teilstring-Match), die eine Stufe erzwingen.
 * Konservativ: destruktiv → consensus; schreibend/credential → gate; sonst read → self.
 */
const CONSENSUS_TOKENS = ['admin', 'delete', 'destroy', 'remove', 'reboot', 'shutdown', 'wipe', 'factory'];
const GATE_TOKENS = ['write', 'credential', 'secret', 'control', 'set', 'configure', 'update', 'create', 'send', 'actuate', 'switch'];
const SELF_TOKENS = ['read', 'query', 'list', 'get', 'view', 'convert', 'render', 'search', 'status'];

function classify(token: string): McpExecutionTier | 'unknown' {
  const t = token.toLowerCase();
  if (CONSENSUS_TOKENS.some((k) => t.includes(k))) return 'consensus';
  if (GATE_TOKENS.some((k) => t.includes(k))) return 'gate';
  if (SELF_TOKENS.some((k) => t.includes(k))) return 'self';
  return 'unknown';
}

const RANK: Record<McpExecutionTier, number> = { self: 0, gate: 1, consensus: 2 };
/** Höhere der beiden Stufen (self<gate<consensus). Exportiert für die Ingress-Kombination
 *  aus Capability-Stufe (pro Server) und Werkzeug-Stufe (pro Tool). */
export function maxTier(a: McpExecutionTier, b: McpExecutionTier): McpExecutionTier {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Erlaubter MCP-Servername-Zeichenraum nach Kanonisierung. */
const SERVER_NAME_RE = /^[a-z0-9._-]+$/;
/** Kanonisiert einen Servernamen (trim + lowercase) — Build und Resolve MÜSSEN dasselbe nutzen (kein Split-Brain `mcp:Unifi` vs `mcp:unifi`). Reine Funktion, wirft NICHT. */
export function canonicalizeServerName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Leitet die Ausführungsstufe rein aus `permissions` + `trust_level` ab.
 * - Keine Permissions → read-only → `self`.
 * - Höchste durch ein Token erzwungene Stufe gewinnt (self<gate<consensus).
 * - **Unbekanntes** (nicht klassifizierbares) Token → fail-closed auf mind. `gate`
 *   (ADR-028-D4: „unklare Stufe → mindestens gate"; nie auf der Discovery-Ebene).
 * - Niedriges Trust (`< LOW_TRUST_GATE_THRESHOLD`) hebt `self` auf `gate` (Read von
 *   einem wenig vertrauten Provider braucht Approval), senkt aber NIE eine Stufe.
 */
export function deriveExecutionTier(permissions: readonly string[], trustLevel: number): McpExecutionTier {
  let tier: McpExecutionTier = 'self';
  for (const p of permissions) {
    const c = classify(p);
    tier = maxTier(tier, c === 'unknown' ? 'gate' : c);
  }
  // CR-MEDIUM (gpt-5.3-codex): ungültiges trustLevel (NaN/Infinity) darf NICHT fail-open
  // bleiben (NaN < 2 === false) → als niedrigstes Vertrauen behandeln (fail-closed → gate).
  const normalizedTrust = Number.isFinite(trustLevel) ? trustLevel : LOW_TRUST_GATE_THRESHOLD - 1;
  if (tier === 'self' && normalizedTrust < LOW_TRUST_GATE_THRESHOLD) {
    tier = 'gate';
  }
  return tier;
}

/**
 * Werkzeug-Verben (Präfix des Tool-Namens, `verb_object`-Konvention) → Stufe.
 * Präfix-/Verb-basiert (nicht Substring), damit z.B. `get_switch_stack` NICHT wegen
 * „switch" fälschlich als schreibend gilt — maßgeblich ist das führende Verb (`get`).
 */
const DESTRUCTIVE_VERBS = new Set([
  'delete', 'destroy', 'remove', 'wipe', 'factory', 'reset', 'revoke', 'purge', 'forget',
  'reboot', 'shutdown', 'drop', 'clear', 'flush', 'erase',
]);
const WRITE_VERBS = new Set([
  'create', 'update', 'set', 'add', 'enable', 'disable', 'block', 'unblock', 'authorize',
  'deauthorize', 'reauthorize', 'restart', 'adopt', 'provision', 'assign', 'move', 'rename',
  'configure', 'send', 'actuate', 'switch', 'apply', 'start', 'stop', 'kick', 'ban', 'write',
  'edit', 'modify', 'grant', 'deny', 'put', 'post', 'patch', 'upsert', 'toggle', 'trigger',
  'run', 'exec', 'execute', 'invoke',
]);
const READ_VERBS = new Set([
  'list', 'get', 'describe', 'read', 'show', 'search', 'query', 'find', 'stat', 'stats',
  'count', 'fetch', 'view', 'status', 'info', 'inspect', 'export', 'ls',
]);

/** Minimale JSON-RPC-Sicht für die Werkzeug-Stufen-Ableitung. */
interface McpCallView {
  method?: unknown;
  params?: { name?: unknown };
}

/**
 * Leitet die **Werkzeug-Stufe** aus dem MCP-JSON-RPC-Payload ab (pro Tool, ADR-033 /
 * Entscheidung 2 — „lesend≠schreibend" am selben Server). Rein, wirft NICHT.
 *  - Nur `tools/call` ruft ein potenziell mutierendes Werkzeug auf → Verb klassifizieren.
 *  - `tools/list` (und jede andere Metadaten-Methode) ist lesend → `self`.
 *  - `tools/call` ohne gültigen `params.name` → `gate` (fail-closed, ungültiger Call).
 *  - Unbekanntes Verb → `gate` (fail-closed; ADR-028-D4: „unklare Stufe → mindestens gate").
 * Die EFFEKTIVE Stufe am Ingress ist `maxTier(Capability-Stufe, Werkzeug-Stufe)` — die
 * Werkzeug-Stufe kann also nur ANHEBEN, nie eine Capability-Stufe absenken.
 */
export function deriveToolTier(payload: unknown): McpExecutionTier {
  const call = (typeof payload === 'object' && payload !== null ? payload : {}) as McpCallView;
  if (call.method !== 'tools/call') return 'self';
  const name = call.params?.name;
  if (typeof name !== 'string' || name.trim() === '') return 'gate';
  const verb = name.toLowerCase().match(/^[a-z]+/)?.[0] ?? '';
  if (DESTRUCTIVE_VERBS.has(verb)) return 'consensus';
  if (WRITE_VERBS.has(verb)) return 'gate';
  if (READ_VERBS.has(verb)) return 'self';
  return 'gate';
}

/**
 * Extrahiert den Werkzeugnamen aus einem `tools/call`-Payload (ADR-037: für den Freigabe-Kontext
 * am Ingress). Rein, wirft NICHT. Kein `tools/call` bzw. kein gültiger Name → `''` (der Aufrufer
 * behandelt leer fail-closed / als „unbekanntes Tool").
 */
export function deriveToolName(payload: unknown): string {
  const call = (typeof payload === 'object' && payload !== null ? payload : {}) as McpCallView;
  if (call.method !== 'tools/call') return '';
  const name = call.params?.name;
  return typeof name === 'string' ? name.trim() : '';
}

/**
 * ADR-039 (TL-08 Slice 1): gepflegte Werkzeugklassen je *governed* Server — ersetzt für bekannte
 * Server die Verb-Heuristik durch eine autoritative Read-only-Allowlist.
 */
export interface ServerToolClasses {
  /** Tools, die als lesend (`self`) durchgehen. **Exakter** Toolname (trim, kein lowercase). */
  readonly readOnly: ReadonlySet<string>;
  /** Optional: Tools, die zwingend `consensus` brauchen (Eskalation über die Heuristik hinaus). */
  readonly consensus?: ReadonlySet<string>;
}

/**
 * unifi Read-only-Allowlist — Snapshot live `tools/list` 2026-07-15 (67 Tools; 27 read-only).
 * Credential-/PII-nahe Reads (wlan/voucher/radius/vpn) sind BEWUSST ausgeschlossen (ADR-039 CO-B):
 * sie mutieren nicht, exfiltrieren aber Secrets/PII → werden gegatet („mutation ≠ sensitivity" = Slice 2).
 * `locate_device` (LED-Aktuation) ist korrekt kein Read (Heuristik → gate).
 */
const UNIFI_READ_ONLY: ReadonlySet<string> = new Set<string>([
  'get_acl_rule', 'get_application_info', 'get_client', 'get_device', 'get_device_stats', 'get_dns_policy',
  'get_firewall_policy', 'get_firewall_zone', 'get_lag', 'get_mc_lag_domain',
  'get_switch_stack', 'get_traffic_matching_list',
  'list_acl_rules', 'list_clients', 'list_devices', 'list_dns_policies', 'list_firewall_policies',
  'list_firewall_zones', 'list_lags', 'list_mc_lag_domains', 'list_pending_devices',
  'list_sites', 'list_switch_stacks', 'list_traffic_matching_lists',
]);

/** Gepflegte Klassen-Map je *governed* Server (kanonischer Servername als Schlüssel). */
export const SERVER_TOOL_CLASSES: Readonly<Record<string, ServerToolClasses>> = {
  unifi: { readOnly: UNIFI_READ_ONLY },
};

/**
 * Werkzeug-Stufe unter Berücksichtigung der gepflegten Server-Klassen-Map (ADR-039). Rein, wirft nie.
 *  - **Ungoverned** Server (kein Map-Eintrag) → `deriveToolTier(payload)` (heutiges Verhalten).
 *  - **Governed**, Methode ≠ `tools/call` (z.B. `tools/list`) → `deriveToolTier(payload)` (→ `self`);
 *    ohne diese Delegation bräche Discovery am governed Server (Toolname `''` → unlisted → gate → 403).
 *  - **Governed**, `tools/call`: Tool in `readOnly` → `self`; in `consensus` → `consensus`; sonst
 *    `maxTier('gate', deriveToolTier(payload))` (mind. gate, `consensus` bei destruktivem Verb — **nie
 *    Downgrade**, unlisted/mis-verbtes Read geht **nie** als `self` durch).
 * Servername wird kanonisiert (sonst wäre `/api/mcp/UNIFI` ein Governance-Bypass). Toolname exakt.
 */
export function deriveToolTierForServer(server: string, payload: unknown): McpExecutionTier {
  const classes = SERVER_TOOL_CLASSES[canonicalizeServerName(server)];
  if (!classes) return deriveToolTier(payload);
  const call = (typeof payload === 'object' && payload !== null ? payload : {}) as McpCallView;
  if (call.method !== 'tools/call') return deriveToolTier(payload);
  const name = deriveToolName(payload);
  if (name !== '' && classes.readOnly.has(name)) return 'self';
  if (name !== '' && classes.consensus?.has(name)) return 'consensus';
  // Governed + unlisted: Verb auf dem GETRIMMTEN Namen klassifizieren (nicht den rohen Payload an
  // `deriveToolTier` delegieren — sonst entkäme `" delete_network "` als gate statt consensus,
  // CR-MEDIUM). `maxTier('gate', …)` hält die Untergrenze; destruktives Verb hebt auf consensus.
  return maxTier('gate', deriveToolTier({ method: 'tools/call', params: { name } }));
}

export interface BuildMcpCapabilityInput {
  /** MCP-Server-Name, z.B. "unifi", "markitdown" → `skill_id="mcp:unifi"`. */
  server: string;
  /** Aussagekräftige Beschreibung (was der MCP tut) — für fremde Agents ohne Vorwissen. */
  description: string;
  /** Angebotene Tools/Capabilities des MCP (werden in die description gefaltet — die CRDT-`Capability` hat (noch) kein eigenes tools-Feld). */
  tools?: readonly string[];
  /** SemVer aus dem MCP-Manifest. */
  version: string;
  /** Benötigte Berechtigungen → Grundlage der Stufen-Ableitung. */
  permissions?: readonly string[];
  /** Trust-Level 0–5. */
  trust_level: number;
  /** SPIFFE-Identität des servierenden Nodes (eigene). Designloch-Closure (s. Kopf). */
  agent_id: string;
  /** ISO-8601-Zeitstempel (vom Aufrufer; reines Modul ruft keine Uhr). */
  updated_at: string;
  /** Optional; Default `healthy`. Echte Liveness besitzt die ADR-021-Side-Map. */
  health?: CapabilityHealth;
}

/** MCP-Service-Capability inkl. der abgeleiteten Stufe (für Resolver/Anzeige). */
export interface McpServiceCapability extends Capability {
  execution_tier: McpExecutionTier;
}

/**
 * Baut die CRDT-`Capability` für einen geteilten MCP-Server (default-open).
 * `skill_id="mcp:<server>"`, `category="mcp"`; Tools werden in die `description`
 * gefaltet; `execution_tier` wird abgeleitet und zusätzlich am Objekt geführt.
 */
export function buildMcpCapability(input: BuildMcpCapabilityInput): McpServiceCapability {
  const server = canonicalizeServerName(input.server);
  if (!SERVER_NAME_RE.test(server)) {
    throw new Error(`buildMcpCapability: invalid server name (allowed ${SERVER_NAME_RE}, canonicalized lower-case): ${JSON.stringify(input.server)}`);
  }
  const permissions = [...(input.permissions ?? [])];
  const tier = deriveExecutionTier(permissions, input.trust_level);
  const tools = input.tools ?? [];
  const description = tools.length > 0 ? `${input.description} (Tools: ${tools.join(', ')})` : input.description;
  return {
    skill_id: `${MCP_SKILL_PREFIX}${server}`,
    category: MCP_CATEGORY,
    version: input.version,
    description,
    agent_id: input.agent_id,
    health: input.health ?? 'healthy',
    trust_level: input.trust_level,
    permissions,
    updated_at: input.updated_at,
    execution_tier: tier,
  };
}

/** True, wenn die Capability ein MCP-Service-Eintrag ist. */
export function isMcpCapability(cap: Pick<Capability, 'category' | 'skill_id'>): boolean {
  return cap.category === MCP_CATEGORY && cap.skill_id.startsWith(MCP_SKILL_PREFIX);
}

/** Eine aufgelöste MCP-Bedienung: welcher Node serviert + Stufe. */
export interface McpResolution {
  /** SPIFFE-Identität des servierenden Nodes. */
  agent_id: string;
  /** `mcp:<server>`. */
  skill_id: string;
  description: string;
  version: string;
  trust_level: number;
  health: CapabilityHealth;
  execution_tier: McpExecutionTier;
}

/**
 * Löst „wer serviert `mcp:<server>`" aus der (replizierten) Capability-Liste auf.
 * **Default-open:** KEIN Allowlist-Filter, KEINE deny-by-default-per-Agent-Logik —
 * jeder gesunde Provider wird geliefert (Multi-Provider). Offline-Provider
 * (`health==='offline'`) werden übersprungen (Routing-Hygiene, kein Trust-Gate).
 * Stufe wird pro Provider aus dessen `permissions`/`trust_level` abgeleitet.
 * Liefert ein (ggf. leeres) Array; leer ist kein Fehler — der Aufrufer entscheidet.
 */
export function resolveMcp(server: string, capabilities: readonly Capability[]): McpResolution[] {
  const target = `${MCP_SKILL_PREFIX}${canonicalizeServerName(server)}`;
  const out: McpResolution[] = [];
  for (const cap of capabilities) {
    if (cap.category !== MCP_CATEGORY) continue;
    if (cap.skill_id !== target) continue;
    if (cap.health === 'offline') continue;
    out.push({
      agent_id: cap.agent_id,
      skill_id: cap.skill_id,
      description: cap.description,
      version: cap.version,
      trust_level: cap.trust_level,
      health: cap.health,
      execution_tier: deriveExecutionTier(cap.permissions, cap.trust_level),
    });
  }
  return out;
}
