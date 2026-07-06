// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-share-config.ts — ADR-028 D4-a (Teil 2, Config-Vertrag): parst + validiert
 * die operator-seitige Deklaration „welche lokalen MCPs werden geteilt".
 *
 * Reine Funktionen (kein I/O, kein CRDT-/Netz-Wiring, keine `mcp-service-registry`-
 * Abhängigkeit) → unabhängig von #185 und vollständig unit-testbar. Die spätere
 * Registrierung (D4-a-Teil-2-Wiring, gestackt auf #185) konsumiert diese
 * Deklarationen und baut daraus via `buildMcpCapability` die CRDT-Einträge.
 *
 * Arbeitslinie (ADR-028-D4, auf main): **Discovery default-open** — eine als shared
 * deklarierte MCP ist per Default geteilt (`share=true`); **opt-out** ausschließlich
 * über explizites `share=false`. KEIN opt-in-Allowlist, KEINE deny-by-default-per-Agent-
 * Logik. Aussagekräftige `description` ist Pflicht (damit fremde Agents ohne Vorwissen
 * entscheiden können). Die Ausführungsstufe (self/gate/consensus) wird NICHT hier,
 * sondern bei der Registrierung aus `permissions`/`trust_level` abgeleitet.
 */

/** Eine validierte Shared-MCP-Deklaration (default-open aufgelöst). */
export interface SharedMcpDeclaration {
  /** Roher Servername (Kanonisierung erfolgt bei der Registrierung, nicht hier). */
  server: string;
  /** Aussagekräftige Beschreibung — Pflicht. */
  description: string;
  /** Angebotene Tools/Capabilities (für die Beschreibung). */
  tools: string[];
  /** SemVer (Default `0.0.0`, wenn nicht angegeben). */
  version: string;
  /** Benötigte Berechtigungen → Grundlage der Stufen-Ableitung bei der Registrierung. */
  permissions: string[];
  /** Trust-Level 0–5 (Default 3, wenn nicht angegeben). */
  trust_level: number;
  /** Aufgelöst: default `true` (default-open); nur explizites `share=false` opted out. */
  share: boolean;
}

/** Default-Trust für eine lokal deklarierte MCP, wenn nicht gesetzt. */
export const DEFAULT_MCP_TRUST_LEVEL = 3;

interface RawEntry {
  server?: unknown;
  description?: unknown;
  tools?: unknown;
  version?: unknown;
  permissions?: unknown;
  trust_level?: unknown;
  share?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function asStringArray(v: unknown, field: string, server: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new Error(`mcp-share-config: "${field}" für MCP "${server}" muss ein String-Array sein`);
  }
  return [...(v as string[])];
}

/**
 * Parst eine rohe Config (z.B. aus `[[mcp.share]]`-TOML-Tabellen) in validierte
 * Deklarationen. `undefined`/`null` → `[]` (keine geteilten MCPs). Fehlerhafte
 * Einträge führen zu einem klaren Throw (fail-fast beim Boot, kein stilles Verschlucken).
 * **Default-open:** fehlendes `share` → `true`; nur `share === false` opted out.
 */
export function parseSharedMcpConfig(raw: unknown): SharedMcpDeclaration[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('mcp-share-config: Shared-MCP-Config muss ein Array von Tabellen sein');
  }
  return raw.map((entryUnknown, i) => {
    if (typeof entryUnknown !== 'object' || entryUnknown === null) {
      throw new Error(`mcp-share-config: Eintrag #${i} ist keine Tabelle`);
    }
    const entry = entryUnknown as RawEntry;
    if (!isNonEmptyString(entry.server)) {
      throw new Error(`mcp-share-config: Eintrag #${i} braucht einen nicht-leeren "server"`);
    }
    const server = entry.server;
    if (!isNonEmptyString(entry.description)) {
      throw new Error(`mcp-share-config: MCP "${server}" braucht eine aussagekräftige "description" (Arbeitslinie)`);
    }
    let trust_level = DEFAULT_MCP_TRUST_LEVEL;
    if (entry.trust_level !== undefined) {
      if (typeof entry.trust_level !== 'number' || !Number.isFinite(entry.trust_level) || entry.trust_level < 0 || entry.trust_level > 5) {
        throw new Error(`mcp-share-config: "trust_level" für MCP "${server}" muss eine Zahl 0–5 sein`);
      }
      trust_level = entry.trust_level;
    }
    if (entry.share !== undefined && typeof entry.share !== 'boolean') {
      throw new Error(`mcp-share-config: "share" für MCP "${server}" muss ein Boolean sein`);
    }
    const version = entry.version === undefined ? '0.0.0' : entry.version;
    if (typeof version !== 'string') {
      throw new Error(`mcp-share-config: "version" für MCP "${server}" muss ein String sein`);
    }
    return {
      server,
      description: entry.description,
      tools: asStringArray(entry.tools, 'tools', server),
      version,
      permissions: asStringArray(entry.permissions, 'permissions', server),
      trust_level,
      // Default-open: nur explizites false opted out.
      share: entry.share === false ? false : true,
    };
  });
}

/**
 * Die tatsächlich zu announcenden MCPs (default-open): alle deklarierten außer den
 * per `share=false` ausgenommenen. Reine Filter-Funktion (keine Allowlist-Logik).
 */
export function enabledSharedMcps(decls: readonly SharedMcpDeclaration[]): SharedMcpDeclaration[] {
  return decls.filter((d) => d.share);
}
