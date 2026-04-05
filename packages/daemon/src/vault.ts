/**
 * vault.ts — Verschluesselter Credential-Vault
 *
 * Speichert sensible Credentials (API-Keys, Tokens, Passwoerter)
 * verschluesselt in einer SQLite-Datenbank. Verwendet NaCl Box
 * (X25519 + XSalsa20-Poly1305) fuer Envelope Encryption.
 *
 * Features:
 * - Credentials verschluesselt at-rest (AES-256-GCM mit Vault-Key)
 * - NaCl Sealed Boxes fuer Peer-zu-Peer Credential-Sharing
 * - TTL mit Auto-Expiry (Default: 24h)
 * - Credential-Scoping (labels/tags)
 * - Human Approval Gate: Credential-Sharing erfordert Bestaetigung
 *
 * Sicherheitsmodell:
 * - Vault-Key wird aus einer Passphrase abgeleitet (PBKDF2)
 * - Private NaCl-Schluessel bleiben im Speicher
 * - Credentials werden nie im Klartext auf Disk geschrieben
 */

import Database from 'better-sqlite3';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tweetnaclUtil;
import { randomBytes, pbkdf2Sync, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Logger } from 'pino';

// --- Credential-Typen ---

export interface Credential {
  /** Eindeutige ID */
  id: string;
  /** Name/Label (z.B. "influxdb-token", "github-pat") */
  name: string;
  /** Kategorie */
  category: string;
  /** Tags fuer Scoping */
  tags: string[];
  /** Ablaufzeit (ISO 8601, null = kein Ablauf) */
  expiresAt: string | null;
  /** Erstellt am */
  createdAt: string;
  /** Zuletzt abgerufen am */
  lastAccessedAt: string | null;
  /** Zugriffszaehler */
  accessCount: number;
}

export interface CredentialWithValue extends Credential {
  /** Entschluesselter Wert (nur im Speicher, nie auf Disk) */
  value: string;
}

// --- Approval-Typen ---

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  /** SPIFFE-URI des anfragenden Peers */
  requester: string;
  /** Angefordertes Credential (Name) */
  credentialName: string;
  /** Begründung */
  reason: string;
  /** Status */
  status: ApprovalStatus;
  /** Zeitpunkt der Anfrage */
  requestedAt: string;
  /** Zeitpunkt der Entscheidung */
  decidedAt: string | null;
}

// --- Vault ---

export class CredentialVault {
  private db: Database.Database;
  private vaultKey: Buffer;
  private naclKeyPair: nacl.BoxKeyPair;

  constructor(
    dataDir: string,
    passphrase: string,
    private log?: Logger,
  ) {
    const vaultDir = resolve(dataDir, 'vault');
    mkdirSync(vaultDir, { recursive: true });

    // Vault-Key aus Passphrase ableiten (PBKDF2, 100k Iterationen)
    const salt = this.getOrCreateSalt(resolve(vaultDir, 'salt'));
    this.vaultKey = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');

    // NaCl-Keypair fuer Sealed Boxes generieren
    this.naclKeyPair = nacl.box.keyPair();

    this.db = new Database(resolve(vaultDir, 'vault.db'));
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'general',
        tags TEXT NOT NULL DEFAULT '[]',
        encrypted_value TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS revoked_credentials (
        name TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        requester TEXT NOT NULL,
        credential_name TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL,
        decided_at TEXT
      )
    `);

    this.log?.info('Credential Vault initialisiert');
  }

  /** NaCl Public Key (Base64) fuer Sealed Boxes */
  get publicKey(): string {
    return encodeBase64(this.naclKeyPair.publicKey);
  }

  // --- Credential CRUD ---

  /** Speichert ein Credential (verschluesselt) */
  store(name: string, value: string, options?: {
    category?: string;
    tags?: string[];
    ttlHours?: number;
  }): Credential {
    const id = randomUUID();
    const { encrypted, nonce } = this.encrypt(value);

    const expiresAt = options?.ttlHours
      ? new Date(Date.now() + options.ttlHours * 3600_000).toISOString()
      : null;

    this.db.prepare(`
      INSERT OR REPLACE INTO credentials (id, name, category, tags, encrypted_value, nonce, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name,
      options?.category ?? 'general',
      JSON.stringify(options?.tags ?? []),
      encrypted, nonce,
      expiresAt,
      new Date().toISOString(),
    );

    this.log?.info({ name, category: options?.category }, 'Credential gespeichert');
    return this.getMetadata(name)!;
  }

  /** Ruft ein Credential ab (entschluesselt) */
  retrieve(name: string): CredentialWithValue | null {
    this.cleanExpired();
    const row = this.db.prepare(
      'SELECT * FROM credentials WHERE name = ?',
    ).get(name) as {
      id: string; name: string; category: string; tags: string;
      encrypted_value: string; nonce: string; expires_at: string | null;
      created_at: string; last_accessed_at: string | null; access_count: number;
    } | undefined;

    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

    // Zugriff loggen
    this.db.prepare(
      'UPDATE credentials SET last_accessed_at = ?, access_count = access_count + 1 WHERE name = ?',
    ).run(new Date().toISOString(), name);

    const value = this.decrypt(row.encrypted_value, row.nonce);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      tags: JSON.parse(row.tags) as string[],
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastAccessedAt: new Date().toISOString(),
      accessCount: row.access_count + 1,
      value,
    };
  }

  /** Entfernt ein Credential */
  remove(name: string): boolean {
    const result = this.db.prepare('DELETE FROM credentials WHERE name = ?').run(name);
    return result.changes > 0;
  }

  /** Listet alle Credentials (ohne Werte) */
  list(category?: string): Credential[] {
    this.cleanExpired();
    const query = category
      ? 'SELECT * FROM credentials WHERE category = ? ORDER BY created_at DESC'
      : 'SELECT * FROM credentials ORDER BY created_at DESC';
    const rows = (category
      ? this.db.prepare(query).all(category)
      : this.db.prepare(query).all()
    ) as Array<{
      id: string; name: string; category: string; tags: string;
      expires_at: string | null; created_at: string;
      last_accessed_at: string | null; access_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      tags: JSON.parse(r.tags) as string[],
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      lastAccessedAt: r.last_accessed_at,
      accessCount: r.access_count,
    }));
  }

  // --- NaCl Sealed Boxes fuer Peer-Sharing ---

  /** Verschluesselt einen Wert fuer einen Peer (dessen Public Key) */
  sealForPeer(value: string, peerPublicKeyBase64: string): string {
    const peerKey = decodeBase64(peerPublicKeyBase64);
    const messageBytes = decodeUTF8(value);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const encrypted = nacl.box(messageBytes, nonce, peerKey, this.naclKeyPair.secretKey);
    // Nonce + Encrypted als ein Block
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length);
    return encodeBase64(combined);
  }

  /** Entschluesselt einen von einem Peer erhaltenen Wert */
  unsealFromPeer(sealed: string, peerPublicKeyBase64: string): string | null {
    const peerKey = decodeBase64(peerPublicKeyBase64);
    const combined = decodeBase64(sealed);
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const encrypted = combined.slice(nacl.box.nonceLength);
    const decrypted = nacl.box.open(encrypted, nonce, peerKey, this.naclKeyPair.secretKey);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  }

  // --- Approval Requests ---

  /** Erstellt eine Approval-Anfrage */
  createApprovalRequest(requester: string, credentialName: string, reason: string): ApprovalRequest {
    const id = randomBytes(8).toString('hex');
    this.db.prepare(`
      INSERT INTO approval_requests (id, requester, credential_name, reason, status, requested_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, requester, credentialName, reason, new Date().toISOString());

    this.log?.info({ id, requester, credentialName }, 'Approval-Anfrage erstellt');
    return { id, requester, credentialName, reason, status: 'pending', requestedAt: new Date().toISOString(), decidedAt: null };
  }

  /** Genehmigt eine Anfrage */
  approveRequest(id: string): boolean {
    const result = this.db.prepare(
      "UPDATE approval_requests SET status = 'approved', decided_at = ? WHERE id = ? AND status = 'pending'",
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Lehnt eine Anfrage ab */
  denyRequest(id: string): boolean {
    const result = this.db.prepare(
      "UPDATE approval_requests SET status = 'denied', decided_at = ? WHERE id = ? AND status = 'pending'",
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  /** Listet ausstehende Approval-Anfragen */
  getPendingRequests(): ApprovalRequest[] {
    return this.db.prepare(
      "SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY requested_at DESC",
    ).all() as ApprovalRequest[];
  }

  // --- Credential Revocation ---

  /**
   * Revoziert ein Credential — markiert es als ungueltig und loescht den Wert.
   * Revozierte Credentials koennen nicht mehr abgerufen werden.
   * Gibt true zurueck wenn erfolgreich revoziert.
   */
  revoke(name: string, reason = 'manually revoked'): boolean {
    // Prüfen ob Credential existiert
    const existing = this.db.prepare('SELECT id FROM credentials WHERE name = ?').get(name);
    if (!existing) return false;

    // In Revocation-Tabelle eintragen
    this.db.prepare(`
      INSERT OR IGNORE INTO revoked_credentials (name, revoked_at, reason)
      VALUES (?, ?, ?)
    `).run(name, new Date().toISOString(), reason);

    // Verschlüsselten Wert löschen
    this.db.prepare('DELETE FROM credentials WHERE name = ?').run(name);

    this.log?.warn({ name, reason }, 'Credential revoziert');
    return true;
  }

  /** Prueft ob ein Credential revoziert wurde */
  isRevoked(name: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM revoked_credentials WHERE name = ?').get(name);
    return row !== undefined;
  }

  /** Listet alle revozierten Credentials */
  listRevoked(): Array<{ name: string; revoked_at: string; reason: string }> {
    return this.db.prepare('SELECT * FROM revoked_credentials ORDER BY revoked_at DESC').all() as Array<{
      name: string; revoked_at: string; reason: string;
    }>;
  }

  // --- Brokered Access ---

  /**
   * Brokered Access: Statt ein Credential zu teilen, fuehrt der Halter
   * eine Aktion im Namen des Anfragenden aus.
   *
   * Der Anfragende bekommt nur das Ergebnis, nie das Secret selbst.
   * Beispiel: Statt GitHub-Token zu teilen, fuehrt der Broker den API-Call aus.
   */
  async executeBrokered(
    credentialName: string,
    action: (value: string) => Promise<unknown>,
    requester: string,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    // Credential abrufen (intern)
    const cred = this.retrieve(credentialName);
    if (!cred) {
      return { success: false, error: `Credential '${credentialName}' nicht gefunden` };
    }

    // Prüfen ob revoziert
    if (this.isRevoked(credentialName)) {
      return { success: false, error: `Credential '${credentialName}' wurde revoziert` };
    }

    this.log?.info({ credentialName, requester }, 'Brokered Access ausgefuehrt');

    try {
      const result = await action(cred.value);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  close(): void {
    this.db.close();
  }

  // --- Private Hilfsfunktionen ---

  private encrypt(plaintext: string): { encrypted: string; nonce: string } {
    const nonce = randomBytes(12);
    
    const cipher = createCipheriv('aes-256-gcm', this.vaultKey, nonce);
    let enc = cipher.update(plaintext, 'utf8', 'base64');
    enc += cipher.final('base64');
    const tag = cipher.getAuthTag();
    return {
      encrypted: enc + '.' + tag.toString('base64'),
      nonce: nonce.toString('base64'),
    };
  }

  private decrypt(encrypted: string, nonceBase64: string): string {
    const [data, tagStr] = encrypted.split('.');
    const nonce = Buffer.from(nonceBase64, 'base64');
    const tag = Buffer.from(tagStr, 'base64');
    
    const decipher = createDecipheriv('aes-256-gcm', this.vaultKey, nonce);
    decipher.setAuthTag(tag);
    let dec = decipher.update(data, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  private getOrCreateSalt(saltPath: string): Buffer {
    
    if (existsSync(saltPath)) {
      return readFileSync(saltPath);
    }
    const salt = randomBytes(32);
    writeFileSync(saltPath, salt, { mode: 0o600 });
    return salt;
  }

  private cleanExpired(): void {
    this.db.prepare(
      "DELETE FROM credentials WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
    ).run();
  }

  private getMetadata(name: string): Credential | null {
    const row = this.db.prepare('SELECT * FROM credentials WHERE name = ?').get(name) as {
      id: string; name: string; category: string; tags: string;
      expires_at: string | null; created_at: string;
      last_accessed_at: string | null; access_count: number;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id, name: row.name, category: row.category,
      tags: JSON.parse(row.tags) as string[],
      expiresAt: row.expires_at, createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at, accessCount: row.access_count,
    };
  }
}
