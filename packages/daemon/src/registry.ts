/**
 * registry.ts — CRDT-basierte verteilte Capability Registry
 *
 * Verwendet Automerge für konfliktfreie Datensynchronisation zwischen Peers.
 * Jeder Node hält eine lokale Kopie der Registry und synchronisiert
 * Änderungen über die Gossip-Nachrichten im Mesh.
 *
 * Die Registry speichert Capabilities (Skills, Services, Connectors)
 * pro Agent mit Versionierung und Health-Status.
 */

import * as Automerge from '@automerge/automerge';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

// --- Capability-Schema ---

export type CapabilityHealth = 'healthy' | 'degraded' | 'offline';

export interface Capability {
  /** Eindeutige Skill-ID (z.B. "influxdb.read") */
  skill_id: string;
  /** SemVer-Version */
  version: string;
  /** Menschenlesbare Beschreibung */
  description: string;
  /** Agent-ID (SPIFFE-URI) des Anbieters */
  agent_id: string;
  /** Gesundheitsstatus */
  health: CapabilityHealth;
  /** Trust-Level (0-5) */
  trust_level: number;
  /** Letzte Aktualisierung (ISO 8601) */
  updated_at: string;
  /** Kategorie (z.B. "database", "monitoring", "ai") */
  category: string;
  /** Benötigte Berechtigungen */
  permissions: string[];
  /**
   * ADR-021: Routing-relevante Verfügbarkeit aus dem Skill-Health-Monitor.
   * Optional (Back-Compat mit älteren CRDT-Dokumenten). Routing filtert standardmäßig
   * auf `availability !== 'unhealthy'`. NUR der Owner-Daemon schreibt sein eigenes Feld.
   */
  availability?: 'healthy' | 'unhealthy';
  /** ADR-021: Zeitpunkt des letzten Health-Checks (ISO 8601). */
  last_checked_at?: string;
  /** ADR-021: aufeinanderfolgende Fehlschläge (Debug/Ops-Sicht). */
  consecutive_failures?: number;
}

/** Automerge-Dokument-Schema für die Registry */
export interface RegistryDoc {
  /** Map: skill_key → Capability (key = `${agent_id}::${skill_id}`) */
  capabilities: Record<string, Capability>;
  /**
   * @deprecated Wird seit ADR-020 v2.1 nicht mehr beschrieben — Status-
   * Metadaten gehoeren ausserhalb des CRDT (siehe RegistrySyncCoordinator).
   * Feld bleibt im Schema, damit Genesis-Doc-Kompatibilitaet erhalten ist;
   * neue Eintraege werden NICHT mehr hinzugefuegt.
   */
  last_sync: Record<string, string>;
}

// --- Registry-Klasse ---

/**
 * Genesis-Blob fuer das Mesh-weit geteilte Automerge-Doc. Alle Daemons
 * MUESSEN denselben Blob-String aus diesem Code laden — dann landen sie
 * im selben History-Tree und ihre Aenderungen sind via Automerge-Sync
 * konfliktfrei mergebar.
 *
 * Begruendung siehe ADR-020 v1.0. Der Blob wurde am 2026-05-19 einmalig
 * mit `packages/daemon/scripts/produce-genesis-blob.mjs` produziert.
 *
 * WICHTIG (verifiziert 2026-05-19): Automerge 2.x ist zwischen Process-Runs
 * NICHT bit-deterministisch — auch nicht mit festgenagelter Actor-ID.
 * Wiederholtes Ausfuehren des Skripts liefert einen semantisch
 * aequivalenten, aber NICHT byte-identischen Blob. Quelle der Wahrheit
 * ist deshalb dieser eingebettete String (Code-as-Truth).
 *
 * AENDERUNGS-VERBOT (operationell): solange ein Mesh online ist, darf
 * dieser Blob NICHT geaendert werden. Aenderung wuerde neugestartete
 * Daemons in einen anderen History-Tree zwingen — Sync ist dann tot.
 */
const GENESIS_PLACEHOLDER = '__GENESIS_PLACEHOLDER__';
export const REGISTRY_GENESIS_BLOB_BASE64: string =
  'hW9Kg16BiJYAiAEBFAAAAAAAAAAAAAAAAAAAAAAAAAAAAX/b6h1vWAAj/O5p9GMPxjsfm+qr6huLTNRz9haWGiK1BgECAwITAiMGQAJWAgcVGCECIwI0AUICVgKAAQJ/AH8BfwJ/l76w0AZ/AH8HfgxjYXBhYmlsaXRpZXMJbGFzdF9zeW5jAgACAQICAAIAAgAA';

let cachedGenesis: Automerge.Doc<RegistryDoc> | null = null;

function loadGenesisDoc(): Automerge.Doc<RegistryDoc> {
  if (cachedGenesis !== null) {
    return Automerge.clone(cachedGenesis);
  }
  // Production-Guard + Dev-Bootstrap-Pfad. Falls jemand
  // REGISTRY_GENESIS_BLOB_BASE64 versehentlich wieder auf den Placeholder
  // setzt, greift dieser Check. Typisierung der Konstante auf `string`
  // (oben) verhindert dass TypeScript den Vergleich als immer-falsch
  // narrowt — robuster als ein `as string`-Cast hier.
  if (REGISTRY_GENESIS_BLOB_BASE64 === GENESIS_PLACEHOLDER) {
    if (process.env.NODE_ENV === 'production' && !process.env.TLMCP_ALLOW_BOOTSTRAP_GENESIS) {
      throw new Error(
        'REGISTRY_GENESIS_BLOB_BASE64 must be replaced with a real genesis blob ' +
          'before production deploy. Set TLMCP_ALLOW_BOOTSTRAP_GENESIS=1 to override.',
      );
    }
    // Bootstrap-Modus: produziere Genesis on-the-fly. ACHTUNG: Bei dieser
    // Variante muss ein Peer zuerst seinen save() per anderem Kanal an
    // alle anderen verteilen, sonst klappt Sync nicht. Geeignet fuer
    // Single-Node-Test und initialen Bootstrap.
    const doc = Automerge.from({ capabilities: {}, last_sync: {} }) as Automerge.Doc<RegistryDoc>;
    cachedGenesis = doc;
    return Automerge.clone(doc);
  }
  const buf = Buffer.from(REGISTRY_GENESIS_BLOB_BASE64, 'base64');
  const doc = Automerge.load<RegistryDoc>(new Uint8Array(buf));

  // MEDIUM/LOW-FIX (CR GPT-5.4 + PC GPT-5.4): Fail-fast Schema-Check beim
  // Boot. Wenn der Blob ladbar ist aber nicht die kanonische Genesis-Struktur
  // enthaelt (capabilities + last_sync als leere PLAIN-Object-Maps + genau
  // ein History-Head), wuerden Sync-Fehler erst viel spaeter und obskurer
  // auftauchen. Hier scheitert der Daemon-Start sofort.
  //
  // Wichtig: Array.isArray-Check, weil `[]` auch `typeof === 'object'` ist
  // und sonst die Validierung umgehen wuerde (PC-Finding MEDIUM).
  if (!isEmptyRecord(doc.capabilities) || !isEmptyRecord(doc.last_sync)) {
    throw new Error(
      'REGISTRY_GENESIS_BLOB_BASE64 hat nicht die kanonische Genesis-Struktur ' +
        '(capabilities + last_sync als leere Maps). Code-as-Truth verletzt — ' +
        'siehe ADR-020 v1.0.',
    );
  }

  // PC-Finding LOW: Single-Root-Invariante auch zur Laufzeit pruefen
  // (nicht nur im Test). Mehrere Heads im Genesis wuerden Daemons in
  // unterschiedliche Sub-Trees splitten.
  const heads = Automerge.getHeads(doc);
  if (heads.length !== 1) {
    throw new Error(
      `REGISTRY_GENESIS_BLOB_BASE64 hat ${heads.length} Heads statt 1 ` +
        '(Single-Root-Doc-Invariante verletzt) — siehe ADR-020 v1.0.',
    );
  }

  cachedGenesis = doc;
  return Automerge.clone(cachedGenesis);
}

/**
 * Prueft ob `value` ein leeres Plain-Object (kein Array, nicht null) ist.
 * Wichtig: `[]` ist auch `typeof === 'object'` — wuerde sonst durchrutschen.
 */
function isEmptyRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  );
}

export class CapabilityRegistry {
  private doc: Automerge.Doc<RegistryDoc>;

  constructor(private log?: Logger) {
    this.doc = loadGenesisDoc();
    this.log?.debug('Capability Registry initialisiert (aus Genesis)');
  }

  /**
   * Registriert oder aktualisiert eine Capability.
   */
  register(capability: Capability): void {
    const key = this.makeKey(capability.agent_id, capability.skill_id);
    this.doc = Automerge.change(this.doc, (d) => {
      d.capabilities[key] = {
        ...capability,
        updated_at: new Date().toISOString(),
      };
    });
    this.log?.info({ skill: capability.skill_id, agent: capability.agent_id }, 'Capability registriert');
  }

  /**
   * Entfernt eine Capability.
   */
  unregister(agentId: string, skillId: string): void {
    const key = this.makeKey(agentId, skillId);
    this.doc = Automerge.change(this.doc, (d) => {
      delete d.capabilities[key];
    });
    this.log?.info({ skill: skillId, agent: agentId }, 'Capability entfernt');
  }

  /**
   * ADR-021: Setzt das `availability`-Attribut einer EIGENEN Capability (Skill-Health).
   * Owner-only by construction: der Aufrufer übergibt seine eigene `agentId`; es wird
   * ausschließlich der exakte Key (agentId+skillId) angefasst — kein Fremd-Namespace.
   * Liefert true, wenn die Capability existierte und aktualisiert wurde. Schreibt nur
   * bei einem echten State-Flip (Aufrufer = onTransition) → minimaler CRDT-Hash-Churn.
   */
  setAvailability(
    agentId: string,
    skillId: string,
    availability: 'healthy' | 'unhealthy',
    consecutiveFailures: number,
    lastCheckedAt: string,
  ): boolean {
    const key = this.makeKey(agentId, skillId);
    let updated = false;
    this.doc = Automerge.change(this.doc, (d) => {
      const cap = d.capabilities[key];
      if (!cap) return;
      // CR gpt-5.5 LOW: idempotent — kein CRDT-Write (kein updated_at-Churn), wenn der
      // routing-relevante State unverändert ist. last_checked_at allein triggert nichts.
      if (cap.availability === availability && cap.consecutive_failures === consecutiveFailures) {
        return;
      }
      cap.availability = availability;
      cap.consecutive_failures = consecutiveFailures;
      cap.last_checked_at = lastCheckedAt;
      cap.updated_at = new Date().toISOString();
      updated = true;
    });
    if (updated) {
      this.log?.info({ skill: skillId, agent: agentId, availability }, '[skill-health] Capability-availability aktualisiert');
    }
    return updated;
  }

  /**
   * Markiert alle Capabilities eines Agents als offline.
   */
  markAgentOffline(agentId: string): void {
    this.doc = Automerge.change(this.doc, (d) => {
      for (const [key, cap] of Object.entries(d.capabilities)) {
        if (cap.agent_id === agentId) {
          d.capabilities[key].health = 'offline';
          d.capabilities[key].updated_at = new Date().toISOString();
        }
      }
    });
  }

  /**
   * Sucht (routing-relevant) Capabilities nach skill_id.
   * ADR-021 (CR gpt-5.5 HIGH): filtert `availability === 'unhealthy'` heraus — sonst
   * würde ein registrierter-aber-ausgefallener Skill weiter geroutet (genau das, was das
   * availability-Attribut statt Remove verhindern soll). Back-Compat: fehlendes Feld
   * (alte Capabilities) gilt als verfügbar.
   */
  findBySkill(skillId: string): Capability[] {
    return Object.values(this.doc.capabilities).filter(
      (c) => c.skill_id === skillId && c.health !== 'offline' && c.availability !== 'unhealthy',
    );
  }

  /**
   * Sucht (routing-relevant) Capabilities nach Kategorie. Filtert unhealthy heraus (s.o.).
   */
  findByCategory(category: string): Capability[] {
    return Object.values(this.doc.capabilities).filter(
      (c) => c.category === category && c.health !== 'offline' && c.availability !== 'unhealthy',
    );
  }

  /**
   * Gibt alle Capabilities eines Agents zurück.
   */
  getAgentCapabilities(agentId: string): Capability[] {
    return Object.values(this.doc.capabilities).filter((c) => c.agent_id === agentId);
  }

  /**
   * Gibt alle bekannten Capabilities zurück.
   */
  getAllCapabilities(): Capability[] {
    return Object.values(this.doc.capabilities);
  }

  /**
   * Berechnet einen Hash über alle Capabilities (für kompakte Announcements).
   */
  getCapabilityHash(): string {
    return this.hashCapabilities(Object.values(this.doc.capabilities));
  }

  /**
   * ADR-020 v2.4: Automerge-Heads als Konvergenz-Identifier. Bei Sync-
   * Konvergenz haben beide Peers identische Heads — verlaesslicher als
   * der capability-feld-spezifische getCapabilityHash() (der z.B.
   * description-Aenderungen unsichtbar macht).
   */
  getHeads(): string[] {
    return Automerge.getHeads(this.doc);
  }

  /**
   * Berechnet einen Hash über eine gegebene Liste von Capabilities.
   * Wird vom Gossip genutzt um nur eigene Capabilities zu hashen.
   */
  hashCapabilities(capabilities: Capability[]): string {
    // ADR-021 (CR gpt-5.5 MEDIUM): `availability` ist routing-relevant und muss in den
    // Hash, damit ein healthy↔unhealthy-Flip als Capability-Change sichtbar ist. NICHT
    // `last_checked_at` aufnehmen (würde bei jedem Check churnen) — nur der semantische State.
    const keys = capabilities
      .map((c) => `${c.agent_id}::${c.skill_id}:${c.version}:${c.health}:${c.availability ?? 'healthy'}`)
      .sort();
    return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 16);
  }

  // --- Automerge Sync ---

  /**
   * Exportiert den aktuellen Zustand als Automerge-Binary für Sync.
   */
  save(): Uint8Array {
    return Automerge.save(this.doc);
  }

  /**
   * Lädt einen gespeicherten Zustand.
   */
  load(data: Uint8Array): void {
    this.doc = Automerge.load<RegistryDoc>(data);
    this.log?.debug('Registry aus gespeichertem Zustand geladen');
  }

  /**
   * Generiert einen Sync-State für einen Peer.
   */
  generateSyncMessage(peerState: Automerge.SyncState): [Automerge.SyncState, Uint8Array | null] {
    const [newSyncState, message] = Automerge.generateSyncMessage(this.doc, peerState);
    return [newSyncState, message];
  }

  /**
   * Empfängt eine Sync-Nachricht von einem Peer.
   */
  receiveSyncMessage(
    peerState: Automerge.SyncState,
    message: Uint8Array,
  ): [Automerge.SyncState] {
    const [newDoc, newSyncState] = Automerge.receiveSyncMessage(this.doc, peerState, message);
    this.doc = newDoc;
    this.log?.debug('Registry-Sync-Nachricht empfangen');
    return [newSyncState];
  }

  /**
   * Initialisiert einen neuen Sync-State für einen Peer.
   */
  initSyncState(): Automerge.SyncState {
    return Automerge.initSyncState();
  }

  /**
   * Importiert Capabilities aus einem Peer-Registry-Export.
   * Übernimmt alle Capabilities, die lokal nicht existieren oder neuer sind.
   */
  importPeerCapabilities(capabilities: Capability[]): number {
    let imported = 0;
    this.doc = Automerge.change(this.doc, (d) => {
      for (const cap of capabilities) {
        const key = `${cap.agent_id}::${cap.skill_id}`;
        const existing = d.capabilities[key];
        if (!existing || new Date(cap.updated_at) > new Date(existing.updated_at)) {
          d.capabilities[key] = { ...cap };
          imported++;
        }
      }
    });
    if (imported > 0) {
      this.log?.info({ imported }, 'Peer-Capabilities importiert');
    }
    return imported;
  }

  /**
   * Entfernt alle Capabilities eines bestimmten Agents (z.B. wenn Peer offline geht).
   * Verhindert Stale-Capability-Relay im Gossip.
   */
  removePeerCapabilities(agentId: string): number {
    let removed = 0;
    this.doc = Automerge.change(this.doc, (d) => {
      for (const key of Object.keys(d.capabilities)) {
        if (d.capabilities[key]?.agent_id === agentId) {
          delete d.capabilities[key];
          removed++;
        }
      }
    });
    if (removed > 0) {
      this.log?.info({ agentId, removed }, 'Peer-Capabilities entfernt (Peer offline)');
    }
    return removed;
  }

  /**
   * Exportiert alle Capabilities als Array (für Peer-Sync).
   */
  exportCapabilities(): Capability[] {
    return Object.values(this.doc.capabilities);
  }

  /**
   * Markiert Capabilities als stale wenn updated_at aelter als maxAge ist.
   * Setzt health auf 'degraded' fuer stale Capabilities.
   * Gibt die Anzahl der markierten Capabilities zurueck.
   */
  markStaleCapabilities(maxAgeMs: number = 5 * 60 * 1000): number {
    const now = Date.now();
    let marked = 0;
    this.doc = Automerge.change(this.doc, (d) => {
      for (const key of Object.keys(d.capabilities)) {
        const cap = d.capabilities[key];
        if (!cap || cap.health === 'offline') continue;
        const age = now - new Date(cap.updated_at).getTime();
        if (age > maxAgeMs && cap.health === 'healthy') {
          cap.health = 'degraded';
          marked++;
        }
      }
    });
    if (marked > 0) {
      this.log?.info({ marked, maxAgeMs }, 'Stale Capabilities als degraded markiert');
    }
    return marked;
  }

  /**
   * Gibt Capabilities zurueck die aelter als maxAge sind.
   */
  getStaleCapabilities(maxAgeMs: number = 5 * 60 * 1000): Capability[] {
    const now = Date.now();
    return Object.values(this.doc.capabilities).filter((c) => {
      const age = now - new Date(c.updated_at).getTime();
      return age > maxAgeMs;
    });
  }

  private makeKey(agentId: string, skillId: string): string {
    return `${agentId}::${skillId}`;
  }
}
