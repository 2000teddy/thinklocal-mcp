/**
 * crl.ts — Certificate Revocation List (CRL)
 *
 * Einfache In-Memory + Datei-persistierte CRL fuer das Mesh.
 * Revozierte Zertifikats-Fingerprints werden beim Heartbeat
 * und bei der Agent-Card-Verifikation geprueft.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Logger } from 'pino';

export interface CRLEntry {
  /** SHA-256 Fingerprint des revozierten Zertifikats */
  fingerprint: string;
  /** Revozierungszeitpunkt (ISO 8601) */
  revokedAt: string;
  /** Grund fuer die Revozierung */
  reason: string;
  /** Agent-ID des revozierten Nodes */
  agentId?: string;
}

export class CertificateRevocationList {
  private entries = new Map<string, CRLEntry>();
  private filePath: string;

  constructor(
    dataDir: string,
    private log?: Logger,
  ) {
    this.filePath = resolve(dataDir, 'certs', 'crl.json');
    this.load();
  }

  /** Revoziert ein Zertifikat */
  revoke(fingerprint: string, reason: string, agentId?: string): void {
    const entry: CRLEntry = {
      fingerprint,
      revokedAt: new Date().toISOString(),
      reason,
      agentId,
    };
    this.entries.set(fingerprint, entry);
    this.save();
    this.log?.warn({ fingerprint, reason, agentId }, 'Zertifikat revoziert');
  }

  /** Prueft ob ein Zertifikat revoziert ist */
  isRevoked(fingerprint: string): boolean {
    return this.entries.has(fingerprint);
  }

  /** Gibt alle revozierten Eintraege zurueck */
  list(): CRLEntry[] {
    return [...this.entries.values()];
  }

  /** Anzahl revozierter Zertifikate */
  get size(): number {
    return this.entries.size;
  }

  /** Entfernt einen Eintrag (z.B. nach Neuausstellung) */
  unrevoke(fingerprint: string): boolean {
    const deleted = this.entries.delete(fingerprint);
    if (deleted) {
      this.save();
      this.log?.info({ fingerprint }, 'Zertifikat-Revozierung aufgehoben');
    }
    return deleted;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as CRLEntry[];
      for (const entry of data) {
        this.entries.set(entry.fingerprint, entry);
      }
      this.log?.debug({ count: this.entries.size }, 'CRL geladen');
    } catch (err) {
      this.log?.warn({ err }, 'CRL laden fehlgeschlagen');
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // SECURITY: Atomic write — tmp-Datei schreiben, dann rename (verhindert Race Conditions)
      const tmpPath = this.filePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify([...this.entries.values()], null, 2));
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      this.log?.warn({ err }, 'CRL speichern fehlgeschlagen');
    }
  }
}
