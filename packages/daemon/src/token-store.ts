/**
 * token-store.ts — SQLite-backed Onboarding Token Store
 *
 * Verwaltet Bearer-Tokens fuer das Token-basierte Onboarding (ADR-016).
 * Tokens sind single-use, TTL-begrenzt und werden als SHA-256 Hash
 * in SQLite gespeichert. Der Klartext wird nur bei der Erstellung
 * zurueckgegeben und nie persistiert.
 *
 * Sicherheitsmodell:
 * - 256 Bit Entropie (crypto.randomBytes(32), base64url)
 * - SHA-256 Hash in DB (kein Klartext)
 * - Single-Use (nach erstem validate+markUsed ungueltig)
 * - TTL-begrenzt (max 7 Tage, default 24h)
 * - Explizite Revokation moeglich
 * - Audit-Integration via optionalem Callback
 */

import Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';

// --- Constants ---

/** Token prefix for log/config recognition (like ghp_, sk-) */
const TOKEN_PREFIX = 'tlmcp_';

/** Maximum TTL: 7 days in milliseconds */
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default TTL: 24 hours in milliseconds */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum TTL: 5 minutes in milliseconds */
const MIN_TTL_MS = 5 * 60 * 1000;

/** Token entropy: 32 bytes (256 bit) */
const TOKEN_BYTES = 32;

// --- Types ---

export interface OnboardingToken {
  /** Internal UUID (not the actual token) */
  id: string;
  /** Human-readable name ("influxdb-node") */
  name: string;
  /** SHA-256 hash of the raw token */
  tokenHash: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
  /** ISO 8601 timestamp when the token was used, null if unused */
  usedAt: string | null;
  /** SPIFFE-URI of the node that used the token */
  usedBy: string | null;
  /** ISO 8601 timestamp when the token was revoked, null if not revoked */
  revokedAt: string | null;
  /** SPIFFE-URI of the admin who created the token */
  createdBy: string;
}

export interface TokenCreateResult {
  /** The raw token (only returned once, never stored) */
  token: string;
  /** Internal ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
}

export type TokenValidationResult =
  | { valid: true; tokenId: string; name: string }
  | { valid: false; reason: 'not_found' | 'expired' | 'already_used' | 'revoked' };

/** Optional audit callback — decoupled from AuditLog to avoid circular deps */
export type TokenAuditCallback = (
  action: 'TOKEN_CREATE' | 'TOKEN_VALIDATE' | 'TOKEN_VALIDATE_FAIL' | 'TOKEN_USED' | 'TOKEN_REVOKE',
  tokenId: string,
  details?: string,
) => void;

// --- Implementation ---

export class TokenStore {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private findByHashStmt: Database.Statement;
  private findByIdStmt: Database.Statement;
  private markUsedStmt: Database.Statement;
  private revokeStmt: Database.Statement;
  private listActiveStmt: Database.Statement;
  private listAllStmt: Database.Statement;
  private pruneStmt: Database.Statement;

  constructor(
    dataDir: string,
    private log?: Logger,
    private auditCallback?: TokenAuditCallback,
  ) {
    const dbDir = resolve(dataDir, 'tokens');
    mkdirSync(dbDir, { recursive: true });

    this.db = new Database(resolve(dbDir, 'onboarding-tokens.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS onboarding_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT,
        revoked_at TEXT,
        created_by TEXT NOT NULL
      )
    `);

    // Create index for hash lookup (primary query path)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_hash ON onboarding_tokens(token_hash)
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO onboarding_tokens (id, name, token_hash, created_at, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.findByHashStmt = this.db.prepare(`
      SELECT * FROM onboarding_tokens WHERE token_hash = ?
    `);

    this.findByIdStmt = this.db.prepare(`
      SELECT * FROM onboarding_tokens WHERE id = ?
    `);

    this.markUsedStmt = this.db.prepare(`
      UPDATE onboarding_tokens SET used_at = ?, used_by = ? WHERE id = ?
    `);

    this.revokeStmt = this.db.prepare(`
      UPDATE onboarding_tokens SET revoked_at = ? WHERE id = ?
    `);

    this.listActiveStmt = this.db.prepare(`
      SELECT * FROM onboarding_tokens
      WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC
    `);

    this.listAllStmt = this.db.prepare(`
      SELECT * FROM onboarding_tokens ORDER BY created_at DESC
    `);

    this.pruneStmt = this.db.prepare(`
      DELETE FROM onboarding_tokens
      WHERE expires_at < ? AND used_at IS NOT NULL
    `);

    this.log?.info('TokenStore initialisiert');
  }

  /**
   * Creates a new onboarding token.
   *
   * @param name    Human-readable label (e.g. "influxdb-node")
   * @param ttlMs   Time-to-live in milliseconds (default: 24h, max: 7d, min: 5min)
   * @param createdBy SPIFFE-URI of the admin creating the token
   * @returns The raw token (shown once), ID, name, and expiration
   * @throws Error if name is empty or TTL out of bounds
   */
  createToken(name: string, createdBy: string, ttlMs: number = DEFAULT_TTL_MS): TokenCreateResult {
    // Validate name
    if (!name || name.trim().length === 0) {
      throw new Error('Token name must not be empty');
    }
    if (name.length > 64) {
      throw new Error('Token name must be 64 characters or less');
    }

    // Validate TTL
    if (ttlMs < MIN_TTL_MS) {
      throw new Error(`TTL must be at least ${MIN_TTL_MS / 60_000} minutes`);
    }
    if (ttlMs > MAX_TTL_MS) {
      throw new Error(`TTL must be at most ${MAX_TTL_MS / (24 * 60 * 60_000)} days`);
    }

    // Generate token
    const rawBytes = randomBytes(TOKEN_BYTES);
    const rawToken = TOKEN_PREFIX + rawBytes.toString('base64url');
    const tokenHash = hashToken(rawToken);

    // Generate UUID-like ID
    const id = randomBytes(16).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    this.insertStmt.run(
      id,
      name.trim(),
      tokenHash,
      now.toISOString(),
      expiresAt.toISOString(),
      createdBy,
    );

    this.log?.info({ tokenId: id, name, expiresAt: expiresAt.toISOString() }, 'Onboarding-Token erstellt');
    this.auditCallback?.('TOKEN_CREATE', id, `name=${name}, ttl=${ttlMs}ms`);

    return {
      token: rawToken,
      id,
      name: name.trim(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Validates a raw token string.
   *
   * Checks:
   * 1. Token exists (by hash lookup)
   * 2. Token is not expired
   * 3. Token has not been used
   * 4. Token has not been revoked
   *
   * IMPORTANT: This does NOT mark the token as used. Call markUsed() after
   * the join operation succeeds, so a failed join attempt doesn't consume the token.
   */
  validateToken(rawToken: string): TokenValidationResult {
    if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) {
      return { valid: false, reason: 'not_found' };
    }

    const tokenHash = hashToken(rawToken);
    const row = this.findByHashStmt.get(tokenHash) as OnboardingTokenRow | undefined;

    if (!row) {
      this.log?.debug('Token-Validierung fehlgeschlagen: nicht gefunden');
      this.auditCallback?.('TOKEN_VALIDATE_FAIL', 'unknown', 'reason=not_found');
      return { valid: false, reason: 'not_found' };
    }

    // Check revocation first (explicit admin action takes priority)
    if (row.revoked_at) {
      this.log?.debug({ tokenId: row.id }, 'Token-Validierung fehlgeschlagen: widerrufen');
      this.auditCallback?.('TOKEN_VALIDATE_FAIL', row.id, 'reason=revoked');
      return { valid: false, reason: 'revoked' };
    }

    // Check single-use
    if (row.used_at) {
      this.log?.debug({ tokenId: row.id }, 'Token-Validierung fehlgeschlagen: bereits verwendet');
      this.auditCallback?.('TOKEN_VALIDATE_FAIL', row.id, 'reason=already_used');
      return { valid: false, reason: 'already_used' };
    }

    // Check TTL
    const now = new Date();
    const expiresAt = new Date(row.expires_at);
    if (now > expiresAt) {
      this.log?.debug({ tokenId: row.id, expiresAt: row.expires_at }, 'Token-Validierung fehlgeschlagen: abgelaufen');
      this.auditCallback?.('TOKEN_VALIDATE_FAIL', row.id, 'reason=expired');
      return { valid: false, reason: 'expired' };
    }

    this.log?.debug({ tokenId: row.id, name: row.name }, 'Token validiert');
    this.auditCallback?.('TOKEN_VALIDATE', row.id, `name=${row.name}`);

    return { valid: true, tokenId: row.id, name: row.name };
  }

  /**
   * Marks a token as used after a successful join.
   *
   * @param tokenId The internal token ID (from validateToken result)
   * @param usedBy  SPIFFE-URI of the node that joined
   * @throws Error if token not found
   */
  markUsed(tokenId: string, usedBy: string): void {
    const row = this.findByIdStmt.get(tokenId) as OnboardingTokenRow | undefined;
    if (!row) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    if (row.used_at) {
      throw new Error(`Token already used: ${tokenId}`);
    }

    const now = new Date().toISOString();
    this.markUsedStmt.run(now, usedBy, tokenId);

    this.log?.info({ tokenId, usedBy }, 'Onboarding-Token als verwendet markiert');
    this.auditCallback?.('TOKEN_USED', tokenId, `usedBy=${usedBy}`);
  }

  /**
   * Revokes a token, making it permanently invalid.
   *
   * @param tokenId The internal token ID
   * @returns true if revoked, false if not found or already revoked/used
   */
  revokeToken(tokenId: string): boolean {
    const row = this.findByIdStmt.get(tokenId) as OnboardingTokenRow | undefined;
    if (!row) return false;
    if (row.revoked_at || row.used_at) return false;

    const now = new Date().toISOString();
    this.revokeStmt.run(now, tokenId);

    this.log?.info({ tokenId, name: row.name }, 'Onboarding-Token widerrufen');
    this.auditCallback?.('TOKEN_REVOKE', tokenId, `name=${row.name}`);

    return true;
  }

  /**
   * Lists active (not used, not revoked, not expired) tokens.
   */
  listActiveTokens(): OnboardingToken[] {
    const now = new Date().toISOString();
    const rows = this.listActiveStmt.all(now) as OnboardingTokenRow[];
    return rows.map(rowToToken);
  }

  /**
   * Lists all tokens (including used/revoked/expired).
   */
  listAllTokens(): OnboardingToken[] {
    const rows = this.listAllStmt.all() as OnboardingTokenRow[];
    return rows.map(rowToToken);
  }

  /**
   * Removes expired+used tokens from the database.
   * Called periodically to keep the DB small.
   *
   * @returns Number of pruned tokens
   */
  pruneExpired(): number {
    const now = new Date().toISOString();
    const result = this.pruneStmt.run(now);
    if (result.changes > 0) {
      this.log?.info({ pruned: result.changes }, 'Abgelaufene Tokens bereinigt');
    }
    return result.changes;
  }

  /**
   * Gets a single token by ID (for admin display).
   */
  getToken(tokenId: string): OnboardingToken | null {
    const row = this.findByIdStmt.get(tokenId) as OnboardingTokenRow | undefined;
    return row ? rowToToken(row) : null;
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// --- Internal helpers ---

/** SQLite row shape (snake_case) */
interface OnboardingTokenRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
  created_by: string;
}

/** Computes SHA-256 hash of a raw token string */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Converts a DB row (snake_case) to the public interface (camelCase) */
function rowToToken(row: OnboardingTokenRow): OnboardingToken {
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
  };
}

// --- Exported constants for testing ---
export { TOKEN_PREFIX, MAX_TTL_MS, DEFAULT_TTL_MS, MIN_TTL_MS, TOKEN_BYTES };

// --- Exported helper for external hash verification ---
export { hashToken };
