/**
 * token-store.test.ts — Tests fuer das Token-basierte Onboarding (ADR-016)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TokenStore,
  TOKEN_PREFIX,
  MAX_TTL_MS,
  MIN_TTL_MS,
  hashToken,
  type TokenAuditCallback,
} from './token-store.js';

const ADMIN_AGENT_ID = 'spiffe://thinklocal/host/admin-node/agent/claude-code';
const JOINER_AGENT_ID = 'spiffe://thinklocal/host/new-node/agent/gemini-cli';

describe('TokenStore', () => {
  let tmpDir: string;
  let store: TokenStore;
  let auditEvents: Array<{ action: string; tokenId: string; details?: string }>;
  let auditCallback: TokenAuditCallback;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'token-store-test-'));
    auditEvents = [];
    auditCallback = (action, tokenId, details) => {
      auditEvents.push({ action, tokenId, details });
    };
    store = new TokenStore(tmpDir, undefined, auditCallback);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Token Creation ---

  describe('createToken', () => {
    it('should create a token with correct format', () => {
      const result = store.createToken('test-node', ADMIN_AGENT_ID);

      expect(result.token).toMatch(new RegExp(`^${TOKEN_PREFIX}`));
      expect(result.id).toHaveLength(32); // 16 bytes hex
      expect(result.name).toBe('test-node');
      expect(result.expiresAt).toBeTruthy();

      // Expiration should be ~24h from now (default TTL)
      const expiresAt = new Date(result.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000); // > 23h
      expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000); // <= 24h + 1s tolerance
    });

    it('should generate unique tokens', () => {
      const t1 = store.createToken('node-1', ADMIN_AGENT_ID);
      const t2 = store.createToken('node-2', ADMIN_AGENT_ID);

      expect(t1.token).not.toBe(t2.token);
      expect(t1.id).not.toBe(t2.id);
    });

    it('should respect custom TTL', () => {
      const oneHourMs = 60 * 60 * 1000;
      const result = store.createToken('short-lived', ADMIN_AGENT_ID, oneHourMs);

      const expiresAt = new Date(result.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(59 * 60 * 1000); // > 59min
      expect(diffMs).toBeLessThanOrEqual(oneHourMs + 1000);
    });

    it('should reject empty name', () => {
      expect(() => store.createToken('', ADMIN_AGENT_ID)).toThrow('name must not be empty');
    });

    it('should reject name longer than 64 chars', () => {
      const longName = 'a'.repeat(65);
      expect(() => store.createToken(longName, ADMIN_AGENT_ID)).toThrow('64 characters');
    });

    it('should reject TTL below minimum', () => {
      expect(() => store.createToken('test', ADMIN_AGENT_ID, 1000)).toThrow('at least');
    });

    it('should reject TTL above maximum', () => {
      expect(() => store.createToken('test', ADMIN_AGENT_ID, MAX_TTL_MS + 1)).toThrow('at most');
    });

    it('should trim whitespace from name', () => {
      const result = store.createToken('  spaced-name  ', ADMIN_AGENT_ID);
      expect(result.name).toBe('spaced-name');
    });

    it('should fire audit callback on create', () => {
      const result = store.createToken('audited', ADMIN_AGENT_ID);
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].action).toBe('TOKEN_CREATE');
      expect(auditEvents[0].tokenId).toBe(result.id);
    });
  });

  // --- Token Validation ---

  describe('validateToken', () => {
    it('should validate a fresh token', () => {
      const created = store.createToken('valid-node', ADMIN_AGENT_ID);
      const result = store.validateToken(created.token);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.tokenId).toBe(created.id);
        expect(result.name).toBe('valid-node');
      }
    });

    it('should reject non-existent token', () => {
      const result = store.validateToken('tlmcp_nonexistent1234567890abcdefghijklmn');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('not_found');
      }
    });

    it('should reject token without prefix', () => {
      const result = store.validateToken('no-prefix-here');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('not_found');
      }
    });

    it('should reject empty string', () => {
      const result = store.validateToken('');
      expect(result.valid).toBe(false);
    });

    it('should reject expired token', () => {
      // Create with minimum TTL, then manipulate DB directly
      const created = store.createToken('expiring', ADMIN_AGENT_ID, MIN_TTL_MS);

      // Manipulate expires_at to the past via direct DB access
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      const pastDate = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE onboarding_tokens SET expires_at = ? WHERE id = ?').run(pastDate, created.id);

      const result = store.validateToken(created.token);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('expired');
      }
    });

    it('should reject already-used token', () => {
      const created = store.createToken('one-time', ADMIN_AGENT_ID);

      // Mark as used
      store.markUsed(created.id, JOINER_AGENT_ID);

      const result = store.validateToken(created.token);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('already_used');
      }
    });

    it('should reject revoked token', () => {
      const created = store.createToken('revokable', ADMIN_AGENT_ID);

      store.revokeToken(created.id);

      const result = store.validateToken(created.token);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('revoked');
      }
    });

    it('should fire audit callback on successful validation', () => {
      const created = store.createToken('audit-test', ADMIN_AGENT_ID);
      auditEvents = []; // Clear create event

      store.validateToken(created.token);

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].action).toBe('TOKEN_VALIDATE');
    });

    it('should fire audit callback on failed validation', () => {
      store.validateToken('tlmcp_doesnotexist0000000000000000000000');

      // Filter out create events
      const failEvents = auditEvents.filter(e => e.action === 'TOKEN_VALIDATE_FAIL');
      expect(failEvents).toHaveLength(1);
      expect(failEvents[0].action).toBe('TOKEN_VALIDATE_FAIL');
    });
  });

  // --- Mark Used ---

  describe('markUsed', () => {
    it('should mark token as used', () => {
      const created = store.createToken('use-me', ADMIN_AGENT_ID);

      store.markUsed(created.id, JOINER_AGENT_ID);

      const token = store.getToken(created.id);
      expect(token).not.toBeNull();
      expect(token!.usedAt).toBeTruthy();
      expect(token!.usedBy).toBe(JOINER_AGENT_ID);
    });

    it('should prevent double use', () => {
      const created = store.createToken('single-use', ADMIN_AGENT_ID);
      store.markUsed(created.id, JOINER_AGENT_ID);

      expect(() => store.markUsed(created.id, 'spiffe://thinklocal/host/other/agent/x')).toThrow('already used');
    });

    it('should throw for non-existent token', () => {
      expect(() => store.markUsed('nonexistent-id', JOINER_AGENT_ID)).toThrow('not found');
    });

    it('should fire TOKEN_USED audit event', () => {
      const created = store.createToken('audit-use', ADMIN_AGENT_ID);
      auditEvents = [];

      store.markUsed(created.id, JOINER_AGENT_ID);

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].action).toBe('TOKEN_USED');
      expect(auditEvents[0].details).toContain(JOINER_AGENT_ID);
    });
  });

  // --- Revoke ---

  describe('revokeToken', () => {
    it('should revoke an active token', () => {
      const created = store.createToken('revoke-me', ADMIN_AGENT_ID);

      const revoked = store.revokeToken(created.id);
      expect(revoked).toBe(true);

      const token = store.getToken(created.id);
      expect(token!.revokedAt).toBeTruthy();
    });

    it('should return false for non-existent token', () => {
      expect(store.revokeToken('no-such-id')).toBe(false);
    });

    it('should return false for already-revoked token', () => {
      const created = store.createToken('double-revoke', ADMIN_AGENT_ID);
      store.revokeToken(created.id);

      expect(store.revokeToken(created.id)).toBe(false);
    });

    it('should return false for already-used token', () => {
      const created = store.createToken('used-then-revoke', ADMIN_AGENT_ID);
      store.markUsed(created.id, JOINER_AGENT_ID);

      expect(store.revokeToken(created.id)).toBe(false);
    });

    it('should fire TOKEN_REVOKE audit event', () => {
      const created = store.createToken('audit-revoke', ADMIN_AGENT_ID);
      auditEvents = [];

      store.revokeToken(created.id);

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].action).toBe('TOKEN_REVOKE');
    });
  });

  // --- List Tokens ---

  describe('listActiveTokens', () => {
    it('should list only active tokens', () => {
      store.createToken('active-1', ADMIN_AGENT_ID);
      store.createToken('active-2', ADMIN_AGENT_ID);
      const used = store.createToken('will-use', ADMIN_AGENT_ID);
      const revoked = store.createToken('will-revoke', ADMIN_AGENT_ID);

      store.markUsed(used.id, JOINER_AGENT_ID);
      store.revokeToken(revoked.id);

      const active = store.listActiveTokens();
      expect(active).toHaveLength(2);
      expect(active.map(t => t.name).sort()).toEqual(['active-1', 'active-2']);
    });

    it('should exclude expired tokens', () => {
      const created = store.createToken('expires-soon', ADMIN_AGENT_ID, MIN_TTL_MS);

      // Manipulate expires_at to the past
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      const pastDate = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE onboarding_tokens SET expires_at = ? WHERE id = ?').run(pastDate, created.id);

      const active = store.listActiveTokens();
      expect(active).toHaveLength(0);
    });
  });

  describe('listAllTokens', () => {
    it('should list all tokens regardless of state', () => {
      store.createToken('active', ADMIN_AGENT_ID);
      const used = store.createToken('used', ADMIN_AGENT_ID);
      const revoked = store.createToken('revoked', ADMIN_AGENT_ID);

      store.markUsed(used.id, JOINER_AGENT_ID);
      store.revokeToken(revoked.id);

      const all = store.listAllTokens();
      expect(all).toHaveLength(3);
    });
  });

  // --- Prune ---

  describe('pruneExpired', () => {
    it('should remove expired+used tokens', () => {
      const created = store.createToken('prune-me', ADMIN_AGENT_ID, MIN_TTL_MS);
      store.markUsed(created.id, JOINER_AGENT_ID);

      // Manipulate expires_at to the past
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      const pastDate = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE onboarding_tokens SET expires_at = ? WHERE id = ?').run(pastDate, created.id);

      const pruned = store.pruneExpired();
      expect(pruned).toBe(1);

      expect(store.listAllTokens()).toHaveLength(0);
    });

    it('should NOT prune expired but unused tokens (admin might want to see them)', () => {
      const created = store.createToken('expired-unused', ADMIN_AGENT_ID, MIN_TTL_MS);

      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      const pastDate = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE onboarding_tokens SET expires_at = ? WHERE id = ?').run(pastDate, created.id);

      const pruned = store.pruneExpired();
      expect(pruned).toBe(0); // Not pruned — unused tokens kept for audit
    });
  });

  // --- Hash Verification ---

  describe('hashToken', () => {
    it('should produce consistent hashes', () => {
      const token = 'tlmcp_testtoken123';
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('should produce different hashes for different tokens', () => {
      expect(hashToken('tlmcp_aaa')).not.toBe(hashToken('tlmcp_bbb'));
    });

    it('should produce a 64-char hex string (SHA-256)', () => {
      expect(hashToken('tlmcp_test')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // --- Token Format ---

  describe('token format', () => {
    it('should start with tlmcp_ prefix', () => {
      const result = store.createToken('format-test', ADMIN_AGENT_ID);
      expect(result.token.startsWith(TOKEN_PREFIX)).toBe(true);
    });

    it('should contain base64url characters after prefix', () => {
      const result = store.createToken('format-test', ADMIN_AGENT_ID);
      const body = result.token.slice(TOKEN_PREFIX.length);
      // base64url: [A-Za-z0-9_-], no padding
      expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should have sufficient entropy (32 bytes = 43 base64url chars)', () => {
      const result = store.createToken('entropy-test', ADMIN_AGENT_ID);
      const body = result.token.slice(TOKEN_PREFIX.length);
      // 32 bytes in base64url = 43 chars (ceil(32 * 4/3))
      expect(body.length).toBe(43);
    });
  });

  // --- Persistence ---

  describe('persistence', () => {
    it('should survive store reopen', () => {
      const created = store.createToken('persist-test', ADMIN_AGENT_ID);
      store.close();

      // Reopen
      const store2 = new TokenStore(tmpDir);
      const token = store2.getToken(created.id);
      expect(token).not.toBeNull();
      expect(token!.name).toBe('persist-test');
      store2.close();

      // Re-assign for afterEach cleanup
      store = new TokenStore(tmpDir);
    });
  });

  // --- Edge Cases ---

  describe('edge cases', () => {
    it('should handle concurrent token creation', () => {
      const results = Array.from({ length: 50 }, (_, i) =>
        store.createToken(`node-${i}`, ADMIN_AGENT_ID),
      );

      const ids = new Set(results.map(r => r.id));
      expect(ids.size).toBe(50); // All unique

      const tokens = new Set(results.map(r => r.token));
      expect(tokens.size).toBe(50); // All unique
    });

    it('should work without audit callback', () => {
      const store2 = new TokenStore(tmpDir);
      const result = store2.createToken('no-audit', ADMIN_AGENT_ID);
      expect(result.token).toBeTruthy();

      const validated = store2.validateToken(result.token);
      expect(validated.valid).toBe(true);
      store2.close();
    });
  });
});
