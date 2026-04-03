/**
 * pairing.ts — SPAKE2 PIN-basiertes Trust-Bootstrap
 *
 * Implementiert die Erstverbindung zweier Agents über eine PIN-Zeremonie:
 *
 * 1. Node A generiert eine 6-stellige PIN und zeigt sie im Terminal an
 * 2. Node B empfängt die PIN vom Benutzer (manuelle Eingabe)
 * 3. Beide Nodes führen SPAKE2 durch — bei gleicher PIN entsteht
 *    ein gemeinsamer Schlüssel (Shared Secret)
 * 4. Über den Shared Secret tauschen sie ihre CA-Zertifikate aus
 * 5. Der Peer wird als vertrauenswürdig gespeichert (Pairing-Persistenz)
 *
 * Nach dem Pairing vertrauen sich die Nodes gegenseitig und können
 * mTLS-Verbindungen aufbauen.
 */

import { randomInt, createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

// --- PIN-Generierung ---

/** Generiert eine 6-stellige numerische PIN */
export function generatePin(): string {
  return String(randomInt(100_000, 999_999));
}

// --- Paired Peers Persistenz ---

export interface PairedPeer {
  /** SPIFFE-URI des gepaarten Peers */
  agentId: string;
  /** Public Key (PEM) des Peers */
  publicKeyPem: string;
  /** CA-Zertifikat (PEM) des Peers (für Cross-Mesh mTLS) */
  caCertPem: string;
  /** SHA-256 Fingerprint des Public Keys */
  fingerprint: string;
  /** Zeitpunkt des Pairings */
  pairedAt: string;
  /** Hostname des Peers beim Pairing */
  hostname: string;
}

export class PairingStore {
  private peers: Map<string, PairedPeer> = new Map();
  private filePath: string;

  constructor(
    dataDir: string,
    private log?: Logger,
  ) {
    const pairingDir = resolve(dataDir, 'pairing');
    mkdirSync(pairingDir, { recursive: true });
    this.filePath = resolve(pairingDir, 'paired-peers.json');
    this.load();
  }

  /** Speichert einen neuen gepaarten Peer */
  addPeer(peer: PairedPeer): void {
    this.peers.set(peer.agentId, peer);
    this.save();
    this.log?.info({ agentId: peer.agentId, hostname: peer.hostname }, 'Peer gepaart und gespeichert');
  }

  /** Prüft ob ein Peer bereits gepaart ist */
  isPaired(agentId: string): boolean {
    return this.peers.has(agentId);
  }

  /** Gibt einen gepaarten Peer zurück */
  getPeer(agentId: string): PairedPeer | undefined {
    return this.peers.get(agentId);
  }

  /** Alle gepaarten Peers */
  getAllPeers(): PairedPeer[] {
    return [...this.peers.values()];
  }

  /** Entfernt einen Peer (Unpair) */
  removePeer(agentId: string): boolean {
    const removed = this.peers.delete(agentId);
    if (removed) {
      this.save();
      this.log?.info({ agentId }, 'Peer-Pairing entfernt');
    }
    return removed;
  }

  private save(): void {
    const data = JSON.stringify([...this.peers.values()], null, 2);
    writeFileSync(this.filePath, data, { mode: 0o600 });
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const peers = JSON.parse(raw) as PairedPeer[];
      for (const peer of peers) {
        this.peers.set(peer.agentId, peer);
      }
      this.log?.info({ count: this.peers.size }, 'Gepaarte Peers geladen');
    } catch (err) {
      this.log?.warn({ err }, 'Fehler beim Laden der Pairing-Daten');
    }
  }
}

// --- SPAKE2 Handshake-Hilfsfunktionen ---

/**
 * Leitet einen symmetrischen Schlüssel aus dem SPAKE2 Shared Secret ab.
 * Verwendet HKDF-ähnliche Ableitung mit SHA-256.
 */
export function deriveKey(sharedSecret: Buffer, context: string): Buffer {
  return createHash('sha256')
    .update(sharedSecret)
    .update(context)
    .digest();
}

/**
 * Verschlüsselt Daten mit AES-256-GCM unter Verwendung des abgeleiteten Schlüssels.
 * Für den sicheren Austausch von CA-Zertifikaten nach dem SPAKE2 Handshake.
 */
export function encryptWithKey(key: Buffer, plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Entschlüsselt Daten mit AES-256-GCM.
 */
export function decryptWithKey(
  key: Buffer,
  ciphertext: string,
  iv: string,
  tag: string,
): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Pairing-Nachrichten ---

export interface PairingInitMessage {
  type: 'pairing_init';
  /** SPIFFE-URI des initiierenden Nodes */
  agentId: string;
  /** Hostname */
  hostname: string;
  /** SPAKE2 Message (Base64) */
  spakeMessage: string;
}

export interface PairingResponseMessage {
  type: 'pairing_response';
  agentId: string;
  hostname: string;
  spakeMessage: string;
}

export interface PairingConfirmMessage {
  type: 'pairing_confirm';
  /** Verschlüsseltes CA-Zertifikat + Public Key */
  encryptedPayload: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
}

export interface PairingPayload {
  agentId: string;
  publicKeyPem: string;
  caCertPem: string;
  hostname: string;
  fingerprint: string;
}
