// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * peer-cache.test.ts — ADR-035 A1 / TL-26: Locator-only Peer-Cache (rein, deterministisch).
 *
 * Schwerpunkt: die CO-Invarianten (kein publicKey auf Platte) + fail-closed-Parsing (Müll/Schema-
 * Bruch/abgelaufen/Zukunft/Duplikat/Cap). `nowMs` injiziert → keine echten Timer/Date.now.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeCache,
  parseCache,
  mergeLocators,
  PEER_CACHE_TTL_MS,
  PEER_CACHE_MAX,
  PEER_CACHE_SCHEMA,
  type PeerCacheLocator,
} from './peer-cache.js';

const PID = '12D3KooWPeerCacheTestAAAA';
const URI = `spiffe://thinklocal/node/${PID}`;
const FP = 'a'.repeat(64);
const NOW = 1_700_000_000_000;

function loc(over: Partial<PeerCacheLocator> = {}): PeerCacheLocator {
  return { peerId: PID, spiffeUri: URI, endpoint: 'https://10.10.10.55:9440', certFingerprint: FP, lastSeen: NOW, ...over };
}

describe('peer-cache serialize/parse (ADR-035 A1)', () => {
  it('Roundtrip: valider Locator überlebt serialize→parse', () => {
    const out = parseCache(serializeCache([loc()]), NOW);
    expect(out).toEqual([loc()]);
  });

  it('SECURITY: serializeCache schreibt NIE einen publicKey (auch wenn übergeben)', () => {
    const raw = serializeCache([{ ...loc(), publicKey: 'PK-SECRET' } as PeerCacheLocator & { publicKey: string }]);
    expect(raw).not.toContain('publicKey');
    expect(raw).not.toContain('PK-SECRET');
    const parsed = JSON.parse(raw) as { schema: number; entries: Record<string, unknown>[] };
    expect(parsed.schema).toBe(PEER_CACHE_SCHEMA);
    expect(Object.keys(parsed.entries[0] ?? {}).sort()).toEqual(['certFingerprint', 'endpoint', 'lastSeen', 'peerId', 'spiffeUri']);
  });

  it('fail-closed: kaputtes JSON → []', () => {
    expect(parseCache('{not json', NOW)).toEqual([]);
    expect(parseCache('null', NOW)).toEqual([]);
    expect(parseCache('42', NOW)).toEqual([]);
  });

  it('fail-closed: falsche Schema-Version → []', () => {
    const raw = JSON.stringify({ schema: 999, entries: [loc()] });
    expect(parseCache(raw, NOW)).toEqual([]);
  });

  it('fail-closed: entries kein Array → []', () => {
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: {} }), NOW)).toEqual([]);
  });

  it('abgelaufene Einträge (now - lastSeen > TTL) werden verworfen', () => {
    const old = loc({ lastSeen: NOW - PEER_CACHE_TTL_MS - 1 });
    const fresh = loc({ peerId: '12D3KooWFreshBBBB', spiffeUri: 'spiffe://thinklocal/node/12D3KooWFreshBBBB', lastSeen: NOW - 1000 });
    const out = parseCache(serializeCache([old, fresh]), NOW);
    expect(out.map((l) => l.peerId)).toEqual(['12D3KooWFreshBBBB']);
  });

  it('genau an der TTL-Grenze bleibt gültig (<=)', () => {
    const edge = loc({ lastSeen: NOW - PEER_CACHE_TTL_MS });
    expect(parseCache(serializeCache([edge]), NOW)).toHaveLength(1);
  });

  it('Zukunfts-Timestamp (Clock-Skew/Tamper, > now+60s) wird verworfen', () => {
    const future = loc({ lastSeen: NOW + 120_000 });
    expect(parseCache(serializeCache([future]), NOW)).toEqual([]);
  });

  it('nicht-kanonische (Legacy host/<id>) URI → verworfen', () => {
    const legacy = loc({ spiffeUri: 'spiffe://thinklocal/host/abc/agent/claude', peerId: 'abc' });
    expect(parseCache(serializeCache([legacy]), NOW)).toEqual([]);
  });

  it('peerId != aus spiffeUri abgeleitete PeerID → verworfen (Tamper-Schutz)', () => {
    const raw = JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), peerId: '12D3KooWMismatchCCCC' }] });
    expect(parseCache(raw, NOW)).toEqual([]);
  });

  it('ungültiger Endpoint / Fingerprint → verworfen', () => {
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), endpoint: 'http://x' }] }), NOW)).toEqual([]);
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), certFingerprint: 'xyz' }] }), NOW)).toEqual([]);
  });

  it('CR-LOW: Port außerhalb 1–65535 → verworfen (A2-Dial-Kandidat)', () => {
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), endpoint: 'https://10.10.10.55:99999' }] }), NOW)).toEqual([]);
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), endpoint: 'https://10.10.10.55:0' }] }), NOW)).toEqual([]);
    expect(parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [{ ...loc(), endpoint: 'https://10.10.10.55:9440' }] }), NOW)).toHaveLength(1);
  });

  it('Duplikat nach peerId: neuestes lastSeen gewinnt', () => {
    const a = loc({ lastSeen: NOW - 5000, endpoint: 'https://10.10.10.55:9440' });
    const b = loc({ lastSeen: NOW - 100, endpoint: 'https://10.10.10.56:9440' });
    const out = parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries: [a, b] }), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.endpoint).toBe('https://10.10.10.56:9440');
  });

  it('LRU-Cap: nur die `cap` neuesten bleiben, nach lastSeen absteigend', () => {
    const entries = Array.from({ length: 5 }, (_, i) => {
      const p = `12D3KooWCapTest${'A'.repeat(i + 1)}`;
      return loc({ peerId: p, spiffeUri: `spiffe://thinklocal/node/${p}`, lastSeen: NOW - i * 1000 });
    });
    const out = parseCache(JSON.stringify({ schema: PEER_CACHE_SCHEMA, entries }), NOW, PEER_CACHE_TTL_MS, 3);
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.lastSeen)).toEqual([NOW, NOW - 1000, NOW - 2000]);
  });

  it('Default-Cap-Konstante ist 512', () => {
    expect(PEER_CACHE_MAX).toBe(512);
  });
});

describe('peer-cache mergeLocators (ADR-035 A1, CR MEDIUM / CO §6.3)', () => {
  it('Union: geladener offline-Peer bleibt erhalten neben live-Peer', () => {
    const loaded = [loc({ peerId: '12D3KooWLoadedOfflineDDDD', spiffeUri: 'spiffe://thinklocal/node/12D3KooWLoadedOfflineDDDD', lastSeen: NOW - 2 * 24 * 60 * 60_000 })];
    const live = [loc({ lastSeen: NOW })];
    const merged = mergeLocators(live, loaded);
    expect(merged.map((l) => l.peerId).sort()).toEqual(['12D3KooWLoadedOfflineDDDD', PID]);
  });

  it('peerId-Kollision: Live-Eintrag (frischeres lastSeen) gewinnt', () => {
    const loaded = [loc({ lastSeen: NOW - 100_000, endpoint: 'https://10.10.10.99:9440' })];
    const live = [loc({ lastSeen: NOW, endpoint: 'https://10.10.10.55:9440' })];
    const merged = mergeLocators(live, loaded);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.endpoint).toBe('https://10.10.10.55:9440');
    expect(merged[0]?.lastSeen).toBe(NOW);
  });

  it('leere live-Menge → geladene bleiben (kein Durability-Verlust beim Flush)', () => {
    const loaded = [loc()];
    expect(mergeLocators([], loaded)).toEqual(loaded);
  });

  it('Roundtrip: merge → serialize → parse behält beide (innerhalb TTL)', () => {
    const loaded = [loc({ peerId: '12D3KooWLoadedEEEE', spiffeUri: 'spiffe://thinklocal/node/12D3KooWLoadedEEEE', lastSeen: NOW - 1000 })];
    const live = [loc({ lastSeen: NOW })];
    const out = parseCache(serializeCache(mergeLocators(live, loaded)), NOW);
    expect(out).toHaveLength(2);
  });
});
