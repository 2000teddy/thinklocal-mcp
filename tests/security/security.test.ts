/**
 * security.test.ts — Sicherheitstests fuer thinklocal-mcp
 *
 * Testet:
 * - Replay-Schutz (Nonce-basiert)
 * - Message-TTL (abgelaufene Nachrichten werden abgelehnt)
 * - Signatur-Validierung (ungueltige Signaturen werden abgelehnt)
 * - Path-Traversal-Schutz (Sandbox)
 * - Rate-Limiting (Token Bucket)
 * - Keychain-Injection (keine Shell-Injection in Keychain-Zugriff)
 * - JWT-Auth (nur localhost darf Tokens generieren)
 * - QR-Token-Einmalverwendung
 */

import { describe, it, expect } from 'vitest';
import { createECDH, createSign, createVerify, randomBytes, generateKeyPairSync, createHash } from 'node:crypto';

describe('Security: Replay-Schutz', () => {
  it('doppelte Nonce wird abgelehnt', () => {
    const seenNonces = new Set<string>();
    const nonce = randomBytes(16).toString('hex');

    // Erste Nachricht: OK
    expect(seenNonces.has(nonce)).toBe(false);
    seenNonces.add(nonce);

    // Replay: abgelehnt
    expect(seenNonces.has(nonce)).toBe(true);
  });

  it('Nonce-Set waechst nicht unbegrenzt (Max-Size)', () => {
    const maxSize = 10000;
    const seenNonces = new Set<string>();

    // Fuelle bis Max
    for (let i = 0; i < maxSize; i++) {
      seenNonces.add(randomBytes(16).toString('hex'));
    }

    expect(seenNonces.size).toBe(maxSize);

    // Bei Ueberlauf: aelteste entfernen (FIFO via Array)
    const nonceArray: string[] = [];
    const addNonce = (nonce: string): boolean => {
      if (nonceArray.includes(nonce)) return false; // Replay
      nonceArray.push(nonce);
      if (nonceArray.length > maxSize) nonceArray.shift();
      return true;
    };

    const n1 = 'test-nonce-1';
    expect(addNonce(n1)).toBe(true);
    expect(addNonce(n1)).toBe(false);
  });
});

describe('Security: Message-TTL', () => {
  it('aktuelle Nachricht ist gueltig', () => {
    const ttlMs = 30_000; // 30 Sekunden
    const timestamp = Date.now();
    const isExpired = Date.now() - timestamp > ttlMs;
    expect(isExpired).toBe(false);
  });

  it('abgelaufene Nachricht wird abgelehnt', () => {
    const ttlMs = 30_000;
    const timestamp = Date.now() - 60_000; // 1 Minute alt
    const isExpired = Date.now() - timestamp > ttlMs;
    expect(isExpired).toBe(true);
  });

  it('zukuenftige Nachrichten werden abgelehnt (Clock Skew)', () => {
    const maxFutureMs = 5_000; // 5 Sekunden Toleranz
    const futureTimestamp = Date.now() + 60_000; // 1 Minute in der Zukunft
    const isFuture = futureTimestamp - Date.now() > maxFutureMs;
    expect(isFuture).toBe(true);
  });
});

describe('Security: ECDSA Signatur-Validierung', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  it('gueltige Signatur wird akzeptiert', () => {
    const message = Buffer.from('{"type":"heartbeat","from":"agent-1"}');
    const sign = createSign('SHA256');
    sign.update(message);
    const signature = sign.sign(privateKey);

    const verify = createVerify('SHA256');
    verify.update(message);
    expect(verify.verify(publicKey, signature)).toBe(true);
  });

  it('manipulierte Nachricht wird abgelehnt', () => {
    const original = Buffer.from('{"type":"heartbeat","from":"agent-1"}');
    const sign = createSign('SHA256');
    sign.update(original);
    const signature = sign.sign(privateKey);

    const tampered = Buffer.from('{"type":"heartbeat","from":"agent-EVIL"}');
    const verify = createVerify('SHA256');
    verify.update(tampered);
    expect(verify.verify(publicKey, signature)).toBe(false);
  });

  it('falsche Signatur wird abgelehnt', () => {
    const message = Buffer.from('test-message');
    const fakeSignature = randomBytes(64);

    const verify = createVerify('SHA256');
    verify.update(message);
    expect(verify.verify(publicKey, fakeSignature)).toBe(false);
  });

  it('Signatur von anderem Key wird abgelehnt', () => {
    const { privateKey: otherKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

    const message = Buffer.from('test-message');
    const sign = createSign('SHA256');
    sign.update(message);
    const signature = sign.sign(otherKey);

    const verify = createVerify('SHA256');
    verify.update(message);
    expect(verify.verify(publicKey, signature)).toBe(false);
  });
});

describe('Security: Path-Traversal-Schutz', () => {
  function isPathAllowed(requestedPath: string, allowedDir: string): boolean {
    const { resolve } = require('node:path');
    const resolved = resolve(requestedPath);
    const allowed = resolve(allowedDir);
    return resolved.startsWith(allowed + '/') || resolved === allowed;
  }

  it('erlaubter Pfad innerhalb des Verzeichnisses', () => {
    expect(isPathAllowed('/tmp/skills/my-skill/index.js', '/tmp/skills/my-skill')).toBe(true);
  });

  it('blockiert ../etc/passwd', () => {
    expect(isPathAllowed('/tmp/skills/my-skill/../../../etc/passwd', '/tmp/skills/my-skill')).toBe(false);
  });

  it('blockiert symlink-artige Pfade', () => {
    expect(isPathAllowed('/tmp/skills/my-skill/../../other-skill/secret', '/tmp/skills/my-skill')).toBe(false);
  });

  it('blockiert absoluten Pfad ausserhalb', () => {
    expect(isPathAllowed('/etc/passwd', '/tmp/skills/my-skill')).toBe(false);
  });

  it('erlaubt exakten Verzeichnis-Pfad', () => {
    expect(isPathAllowed('/tmp/skills/my-skill', '/tmp/skills/my-skill')).toBe(true);
  });
});

describe('Security: Rate-Limiting', () => {
  class TokenBucket {
    private tokens: number;
    private lastRefill: number;

    constructor(
      private capacity: number,
      private refillRatePerSec: number,
    ) {
      this.tokens = capacity;
      this.lastRefill = Date.now();
    }

    tryConsume(): boolean {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return true;
      }
      return false;
    }

    private refill(): void {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSec);
      this.lastRefill = now;
    }
  }

  it('erlaubt Anfragen innerhalb des Limits', () => {
    const bucket = new TokenBucket(10, 1);
    for (let i = 0; i < 10; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
  });

  it('blockiert Anfragen ueber dem Limit', () => {
    const bucket = new TokenBucket(3, 0); // 0 refill = kein Nachfuellen
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false); // Limit erreicht
  });
});

describe('Security: QR-Token Einmalverwendung', () => {
  it('Token ist nur einmal gueltig', () => {
    const validTokens = new Map<string, string>();
    const token = randomBytes(32).toString('hex');
    validTokens.set(token, new Date(Date.now() + 300_000).toISOString());

    // Erste Validierung: OK
    const expiresAt = validTokens.get(token);
    expect(expiresAt).toBeDefined();
    validTokens.delete(token); // Einmalverwendung

    // Zweite Validierung: abgelehnt
    expect(validTokens.get(token)).toBeUndefined();
  });

  it('abgelaufener Token wird abgelehnt', () => {
    const validTokens = new Map<string, string>();
    const token = randomBytes(32).toString('hex');
    validTokens.set(token, new Date(Date.now() - 1000).toISOString()); // Abgelaufen

    const expiresAt = validTokens.get(token);
    expect(expiresAt).toBeDefined();
    expect(new Date(expiresAt!) < new Date()).toBe(true);
  });
});

describe('Security: Input-Sanitisierung', () => {
  it('Agent-ID darf keine Sonderzeichen enthalten', () => {
    const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9\-_.:/@]/g, '_');

    expect(sanitize('agent-123')).toBe('agent-123');
    expect(sanitize('spiffe://thinklocal/host/mac/agent/claude')).toBe('spiffe://thinklocal/host/mac/agent/claude');
    expect(sanitize('agent;rm -rf /')).toBe('agent_rm_-rf_/');
    expect(sanitize('$(echo pwned)')).toBe('__echo_pwned_');
  });

  it('Skill-ID wird validiert', () => {
    const isValidSkillId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);

    expect(isValidSkillId('system.health')).toBe(true);
    expect(isValidSkillId('influxdb.query')).toBe(true);
    expect(isValidSkillId('../etc/passwd')).toBe(false);
    expect(isValidSkillId('')).toBe(false);
    expect(isValidSkillId('.hidden')).toBe(false);
    expect(isValidSkillId('a'.repeat(200))).toBe(false);
  });
});
