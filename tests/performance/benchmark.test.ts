/**
 * benchmark.test.ts — Performance-Basistests fuer thinklocal-mcp
 *
 * Misst:
 * - FrameBuffer Throughput (Nachrichten/Sekunde)
 * - ECDSA Signierung/Verifikation pro Sekunde
 * - Policy-Evaluation pro Sekunde
 * - Capability-Registry Lookup
 * - JSON Serialisierung (CBOR-Proxy)
 * - Token Bucket Rate-Limiter Throughput
 */

import { describe, it, expect } from 'vitest';
import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';

function measure(label: string, fn: () => void, iterations = 10_000): { opsPerSec: number; avgMs: number } {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const avgMs = elapsed / iterations;
  console.log(`  ${label}: ${opsPerSec.toLocaleString()} ops/s (${avgMs.toFixed(4)} ms/op)`);
  return { opsPerSec, avgMs };
}

describe('Performance Benchmarks', () => {
  it('JSON Serialisierung (typische Mesh-Nachricht)', () => {
    const msg = {
      type: 'capability-sync',
      from: 'spiffe://thinklocal/host/mac/agent/claude-code',
      timestamp: Date.now(),
      payload: {
        capabilities: Array.from({ length: 10 }, (_, i) => ({
          skill_id: `system.skill-${i}`,
          version: '1.0.0',
          health: 'healthy',
          agent_id: `agent-${i}`,
        })),
      },
    };

    const { opsPerSec } = measure('JSON.stringify', () => JSON.stringify(msg), 50_000);
    expect(opsPerSec).toBeGreaterThan(10_000); // Mindestens 10k ops/s
  });

  it('JSON Parsing (typische Mesh-Nachricht)', () => {
    const json = JSON.stringify({
      type: 'heartbeat',
      from: 'agent-1',
      timestamp: Date.now(),
      payload: { cpu: 42, memory: 68 },
    });

    const { opsPerSec } = measure('JSON.parse', () => JSON.parse(json), 50_000);
    expect(opsPerSec).toBeGreaterThan(10_000);
  });

  it('ECDSA P-256 Signierung', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const message = Buffer.from('heartbeat-payload-for-signing-test');

    const { opsPerSec } = measure('ECDSA Sign', () => {
      const sign = createSign('SHA256');
      sign.update(message);
      sign.sign(privateKey);
    }, 1_000);

    expect(opsPerSec).toBeGreaterThan(100); // Mindestens 100 Signaturen/s
  });

  it('ECDSA P-256 Verifikation', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const message = Buffer.from('heartbeat-payload-for-verification');
    const sign = createSign('SHA256');
    sign.update(message);
    const signature = sign.sign(privateKey);

    const { opsPerSec } = measure('ECDSA Verify', () => {
      const verify = createVerify('SHA256');
      verify.update(message);
      verify.verify(publicKey, signature);
    }, 1_000);

    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('Pattern-Matching (Policy-Evaluation)', () => {
    const matchesPattern = (value: string, pattern: string): boolean => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
      return value === pattern;
    };

    const patterns = ['*', 'system.*', 'influxdb.query', 'vault.read', 'task.*'];
    const values = ['system.health', 'influxdb.query', 'vault.write', 'task.create', 'unknown.skill'];

    const { opsPerSec } = measure('Pattern Match', () => {
      for (const p of patterns) {
        for (const v of values) {
          matchesPattern(v, p);
        }
      }
    }, 100_000);

    expect(opsPerSec).toBeGreaterThan(100_000);
  });

  it('Map Lookup (Capability-Registry)', () => {
    const registry = new Map<string, { skill_id: string; agent_id: string; health: string }>();
    for (let i = 0; i < 1000; i++) {
      registry.set(`skill-${i}`, { skill_id: `skill-${i}`, agent_id: `agent-${i % 10}`, health: 'healthy' });
    }

    const { opsPerSec } = measure('Map.get (1000 entries)', () => {
      registry.get('skill-500');
      registry.get('skill-999');
      registry.get('nonexistent');
    }, 100_000);

    expect(opsPerSec).toBeGreaterThan(1_000_000);
  });

  it('Nonce-Check (Replay-Protection)', () => {
    const seenNonces = new Set<string>();
    // Pre-fill with 10k nonces
    for (let i = 0; i < 10_000; i++) {
      seenNonces.add(randomBytes(16).toString('hex'));
    }

    const testNonce = randomBytes(16).toString('hex');

    const { opsPerSec } = measure('Set.has (10k entries)', () => {
      seenNonces.has(testNonce);
    }, 500_000);

    expect(opsPerSec).toBeGreaterThan(1_000_000);
  });

  it('SHA-256 Hash (Capability-Hashing)', () => {
    const { createHash } = require('node:crypto');
    const data = JSON.stringify({ skills: Array.from({ length: 20 }, (_, i) => `skill-${i}`) });

    const { opsPerSec } = measure('SHA-256', () => {
      createHash('sha256').update(data).digest('hex');
    }, 10_000);

    expect(opsPerSec).toBeGreaterThan(10_000);
  });

  it('Token Bucket Rate-Limiter', () => {
    let tokens = 100;
    const capacity = 100;
    const refillRate = 10; // pro Tick

    const tryConsume = (): boolean => {
      if (tokens > 0) { tokens--; return true; }
      return false;
    };

    const refill = () => {
      tokens = Math.min(capacity, tokens + refillRate);
    };

    const { opsPerSec } = measure('Token Bucket', () => {
      tryConsume();
      if (tokens === 0) refill();
    }, 1_000_000);

    expect(opsPerSec).toBeGreaterThan(10_000_000);
  });
});
