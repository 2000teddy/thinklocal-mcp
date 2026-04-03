/**
 * skills.ts — Skill-Management und -Transfer zwischen Mesh-Peers
 *
 * Ein Skill ist ein portables MCP-Server-Paket mit:
 * - Manifest (Metadaten, Abhängigkeiten, Berechtigungen)
 * - Entrypoint (ausführbarer Code)
 * - Signatur (Ed25519 für Integritätsprüfung)
 *
 * Skills können zwischen Peers angekündigt (ANNOUNCE) und
 * übertragen (TRANSFER) werden. Jeder Skill durchläuft:
 *   ANNOUNCED → REQUESTED → TRANSFERRING → INSTALLED / FAILED
 *
 * Phase 2: Nur Metadaten-Austausch + Registry-Integration
 * Phase 3: Tatsächlicher Code-Transfer mit Signaturprüfung + Sandboxing
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import type { CapabilityRegistry } from './registry.js';

// --- Skill-Manifest ---

export interface SkillManifest {
  /** Eindeutige Skill-ID (z.B. "influxdb-query") */
  id: string;
  /** SemVer-Version */
  version: string;
  /** Menschenlesbare Beschreibung */
  description: string;
  /** SPIFFE-URI des Autors */
  author: string;
  /** SHA-256 Hash des Skill-Pakets */
  integrity: string;
  /** Runtime: node, python, wasm, docker */
  runtime: 'node' | 'python' | 'wasm' | 'docker';
  /** Einstiegspunkt relativ zum Skill-Verzeichnis */
  entrypoint: string;
  /** npm/pip-Abhängigkeiten */
  dependencies: string[];
  /** MCP Tools die der Skill bereitstellt */
  tools: string[];
  /** MCP Resources die der Skill bereitstellt */
  resources: string[];
  /** Kategorie */
  category: string;
  /** Benötigte Berechtigungen */
  permissions: string[];
  /** Minimale Systemanforderungen */
  requirements: {
    os?: string[];
    minMemoryMB?: number;
    services?: string[];
  };
  /** Erstellungszeitpunkt */
  createdAt: string;
}

// --- Skill-Transfer-Status ---

export type SkillTransferState = 'announced' | 'requested' | 'transferring' | 'installed' | 'failed';

export interface SkillTransferRecord {
  /** Transfer-ID */
  id: string;
  /** Skill-Manifest */
  manifest: SkillManifest;
  /** Quell-Agent (SPIFFE-URI) */
  source: string;
  /** Ziel-Agent (SPIFFE-URI) */
  target: string;
  /** Aktueller Zustand */
  state: SkillTransferState;
  /** Fehlermeldung bei FAILED */
  error: string | null;
  /** Zeitstempel */
  requestedAt: string;
  updatedAt: string;
}

// --- Message-Payloads für Skill-Nachrichten ---

export interface SkillAnnouncePayload {
  /** Angekündigte Skill-Manifeste */
  skills: SkillManifest[];
}

export interface SkillRequestPayload {
  /** Angeforderter Skill (ID + Version) */
  skill_id: string;
  version: string;
}

export interface SkillTransferPayload {
  /** Skill-Manifest */
  manifest: SkillManifest;
  /** Transfer-ID */
  transfer_id: string;
  /**
   * In Phase 2: nur Metadaten (code_available = false)
   * In Phase 3: Base64-kodiertes Skill-Paket
   */
  code_available: boolean;
}

// --- Skill-Manager ---

export class SkillManager {
  /** Lokale Skills (skill_id → Manifest) */
  private localSkills = new Map<string, SkillManifest>();
  /** Laufende Transfers */
  private transfers = new Map<string, SkillTransferRecord>();
  /** Persistenz-Pfad */
  private skillsDir: string;
  private manifestPath: string;

  constructor(
    dataDir: string,
    private agentId: string,
    private registry: CapabilityRegistry,
    private log?: Logger,
  ) {
    this.skillsDir = resolve(dataDir, 'skills');
    this.manifestPath = resolve(this.skillsDir, 'installed.json');
    mkdirSync(this.skillsDir, { recursive: true });
    this.loadInstalled();
  }

  /**
   * Registriert einen lokalen Skill und meldet ihn in der Capability Registry an.
   */
  registerLocal(manifest: SkillManifest): void {
    this.localSkills.set(manifest.id, manifest);
    this.saveInstalled();

    // In der Capability Registry als Capability registrieren
    this.registry.register({
      skill_id: manifest.id,
      version: manifest.version,
      description: manifest.description,
      agent_id: this.agentId,
      health: 'healthy',
      trust_level: 3,
      updated_at: new Date().toISOString(),
      category: manifest.category,
      permissions: manifest.permissions,
    });

    this.log?.info({ skillId: manifest.id, version: manifest.version }, 'Lokaler Skill registriert');
  }

  /**
   * Entfernt einen lokalen Skill.
   */
  unregisterLocal(skillId: string): void {
    this.localSkills.delete(skillId);
    this.saveInstalled();
    this.registry.unregister(this.agentId, skillId);
    this.log?.info({ skillId }, 'Lokaler Skill entfernt');
  }

  /**
   * Gibt alle lokalen Skill-Manifeste zurück (für SKILL_ANNOUNCE).
   */
  getLocalSkills(): SkillManifest[] {
    return [...this.localSkills.values()];
  }

  /**
   * Gibt ein lokales Skill-Manifest zurück.
   */
  getSkill(skillId: string): SkillManifest | undefined {
    return this.localSkills.get(skillId);
  }

  /**
   * Verarbeitet eine eingehende SKILL_ANNOUNCE-Nachricht.
   * Registriert angekündigte Skills als Remote-Capabilities.
   */
  handleAnnounce(senderAgentId: string, payload: SkillAnnouncePayload): number {
    let imported = 0;
    for (const manifest of payload.skills) {
      // Nur Skills registrieren die wir nicht schon lokal haben
      if (this.localSkills.has(manifest.id)) continue;

      this.registry.register({
        skill_id: manifest.id,
        version: manifest.version,
        description: manifest.description,
        agent_id: senderAgentId,
        health: 'healthy',
        trust_level: 2, // Remote-Skills haben niedrigeres Trust-Level
        updated_at: new Date().toISOString(),
        category: manifest.category,
        permissions: manifest.permissions,
      });
      imported++;
    }

    this.log?.info({ from: senderAgentId, imported }, 'Skill-Announcements verarbeitet');
    return imported;
  }

  /**
   * Erstellt einen Transfer-Request für einen Remote-Skill.
   */
  requestTransfer(skillId: string, version: string, source: string): SkillTransferRecord {
    const record: SkillTransferRecord = {
      id: randomUUID(),
      manifest: {
        id: skillId,
        version,
        description: '',
        author: source,
        integrity: '',
        runtime: 'node',
        entrypoint: '',
        dependencies: [],
        tools: [],
        resources: [],
        category: '',
        permissions: [],
        requirements: {},
        createdAt: new Date().toISOString(),
      },
      source,
      target: this.agentId,
      state: 'requested',
      error: null,
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.transfers.set(record.id, record);
    this.log?.info({ transferId: record.id, skillId, source }, 'Skill-Transfer angefordert');
    return record;
  }

  /**
   * Verarbeitet eine eingehende SKILL_TRANSFER-Antwort.
   * In Phase 2: nur Manifest-Update, kein Code-Transfer.
   */
  handleTransferResponse(payload: SkillTransferPayload): SkillTransferRecord | null {
    const record = this.transfers.get(payload.transfer_id);
    if (!record) return null;

    record.manifest = payload.manifest;
    record.updatedAt = new Date().toISOString();

    if (payload.code_available) {
      // Phase 3: Code-Transfer + Installation
      record.state = 'installed';
      this.registerLocal(payload.manifest);
    } else {
      // Phase 2: Nur Metadaten empfangen
      record.state = 'announced';
      this.log?.info({ transferId: record.id }, 'Skill-Metadaten empfangen (Code-Transfer in Phase 3)');
    }

    return record;
  }

  /** Alle laufenden Transfers */
  getTransfers(): SkillTransferRecord[] {
    return [...this.transfers.values()];
  }

  /** Transfer nach ID */
  getTransfer(id: string): SkillTransferRecord | undefined {
    return this.transfers.get(id);
  }

  private saveInstalled(): void {
    const data = JSON.stringify([...this.localSkills.values()], null, 2);
    writeFileSync(this.manifestPath, data, { mode: 0o644 });
  }

  private loadInstalled(): void {
    if (!existsSync(this.manifestPath)) return;
    try {
      const raw = readFileSync(this.manifestPath, 'utf-8');
      const skills = JSON.parse(raw) as SkillManifest[];
      for (const skill of skills) {
        this.localSkills.set(skill.id, skill);
      }
      this.log?.info({ count: this.localSkills.size }, 'Installierte Skills geladen');
    } catch (err) {
      this.log?.warn({ err }, 'Fehler beim Laden der Skills');
    }
  }
}
