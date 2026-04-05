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
}

/** Automerge-Dokument-Schema für die Registry */
export interface RegistryDoc {
  /** Map: skill_key → Capability (key = `${agent_id}::${skill_id}`) */
  capabilities: Record<string, Capability>;
  /** Letzte Sync-Zeit pro Peer */
  last_sync: Record<string, string>;
}

// --- Registry-Klasse ---

export class CapabilityRegistry {
  private doc: Automerge.Doc<RegistryDoc>;

  constructor(private log?: Logger) {
    this.doc = Automerge.init<RegistryDoc>();
    this.doc = Automerge.change(this.doc, (d) => {
      d.capabilities = {};
      d.last_sync = {};
    });
    this.log?.debug('Capability Registry initialisiert');
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
   * Sucht Capabilities nach skill_id.
   */
  findBySkill(skillId: string): Capability[] {
    return Object.values(this.doc.capabilities).filter(
      (c) => c.skill_id === skillId && c.health !== 'offline',
    );
  }

  /**
   * Sucht Capabilities nach Kategorie.
   */
  findByCategory(category: string): Capability[] {
    return Object.values(this.doc.capabilities).filter(
      (c) => c.category === category && c.health !== 'offline',
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
    const keys = Object.keys(this.doc.capabilities).sort();
    const data = keys
      .map((k) => `${k}:${this.doc.capabilities[k].version}:${this.doc.capabilities[k].health}`)
      .join('|');
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
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

  private makeKey(agentId: string, skillId: string): string {
    return `${agentId}::${skillId}`;
  }
}
