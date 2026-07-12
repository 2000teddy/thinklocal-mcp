// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect, vi } from 'vitest';
import { learnInboundPeer, type LearnInboundPeerDeps } from './inbound-peer-learner.js';

const PID = '12D3KooWLearnTestPeerAAAA';
const EXPECTED = `spiffe://thinklocal/node/${PID}`;

function deps(over: Partial<LearnInboundPeerDeps> = {}): LearnInboundPeerDeps {
  return {
    peerId: PID,
    senderUri: EXPECTED,
    remoteAddress: '10.10.10.55',
    port: 9440,
    certFingerprint: 'abcd1234',
    expectedSpiffeUri: EXPECTED,
    isAlreadyResolvable: () => false,
    rateLimitOk: () => true,
    fetchCard: async () => ({ spiffeUri: EXPECTED, publicKey: 'PK-LEARNED' }),
    record: vi.fn(),
    audit: vi.fn(),
    ...over,
  };
}

describe('learnInboundPeer (ADR-026)', () => {
  it('recorded: valider Card-SAN==attested + PublicKey → record + audit', async () => {
    const record = vi.fn();
    const audit = vi.fn();
    const r = await learnInboundPeer(deps({ record, audit }));
    expect(r).toBe('recorded');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ peerId: PID, publicKey: 'PK-LEARNED', spiffeUri: EXPECTED }));
    expect(audit).toHaveBeenCalledOnce();
  });

  it('skipped-resolvable: bereits auflösbar → kein Fetch/Record', async () => {
    const fetchCard = vi.fn();
    const record = vi.fn();
    const r = await learnInboundPeer(deps({ isAlreadyResolvable: () => true, fetchCard, record }));
    expect(r).toBe('skipped-resolvable');
    expect(fetchCard).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('rate-limited: Gate zu → kein Fetch', async () => {
    const fetchCard = vi.fn();
    const r = await learnInboundPeer(deps({ rateLimitOk: () => false, fetchCard }));
    expect(r).toBe('rate-limited');
    expect(fetchCard).not.toHaveBeenCalled();
  });

  it('rejected-identity: payload-sender != attestierte Transport-Identität → kein Fetch', async () => {
    const fetchCard = vi.fn();
    const record = vi.fn();
    const r = await learnInboundPeer(deps({ senderUri: 'spiffe://thinklocal/node/12D3KooWOTHER', fetchCard, record }));
    expect(r).toBe('rejected-identity');
    expect(fetchCard).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('rejected-identity: Card-SAN != attestierte PeerID → kein Record (Spoof-Schutz)', async () => {
    const record = vi.fn();
    const r = await learnInboundPeer(deps({
      record,
      fetchCard: async () => ({ spiffeUri: 'spiffe://thinklocal/node/12D3KooWFAKE', publicKey: 'PK-X' }),
    }));
    expect(r).toBe('rejected-identity');
    expect(record).not.toHaveBeenCalled();
  });

  it('rejected-identity: Card ohne publicKey → kein Record', async () => {
    const record = vi.fn();
    const r = await learnInboundPeer(deps({ record, fetchCard: async () => ({ spiffeUri: EXPECTED }) }));
    expect(r).toBe('rejected-identity');
    expect(record).not.toHaveBeenCalled();
  });

  it('fetch-failed: Card-Fetch wirft dauerhaft → fetch-failed nach Retries, kein Record', async () => {
    const record = vi.fn();
    const fetchCard = vi.fn(async () => { throw new Error('EHOSTUNREACH'); });
    const delay = vi.fn(async () => {});
    const r = await learnInboundPeer(deps({ record, fetchCard, delay, maxFetchAttempts: 3 }));
    expect(r).toBe('fetch-failed');
    expect(record).not.toHaveBeenCalled();
    expect(fetchCard).toHaveBeenCalledTimes(3); // ADR-035 A3: Retry
    expect(delay).toHaveBeenCalledTimes(2);     // zwischen den 3 Versuchen
  });

  it('ADR-035 A3: transienter Throw, dann Erfolg beim 2. Versuch → recorded (Wellen-Recovery)', async () => {
    const record = vi.fn();
    let n = 0;
    const fetchCard = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('ECONNREFUSED'); // Peer-HTTP noch nicht oben
      return { spiffeUri: EXPECTED, publicKey: 'PK-LEARNED' };
    });
    const delay = vi.fn(async () => {});
    const r = await learnInboundPeer(deps({ record, fetchCard, delay, maxFetchAttempts: 3 }));
    expect(r).toBe('recorded');
    expect(fetchCard).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledOnce();
  });

  it('ADR-035 A3: Backoff-Delays werden in Reihenfolge genutzt', async () => {
    const seen: number[] = [];
    const fetchCard = vi.fn(async () => { throw new Error('x'); });
    const delay = vi.fn(async (ms: number) => { seen.push(ms); });
    await learnInboundPeer(deps({ fetchCard, delay, maxFetchAttempts: 3, fetchBackoffMs: [100, 300, 900] }));
    expect(seen).toEqual([100, 300]); // vor Versuch 2 und 3
  });

  it('ADR-035 A3: ungültige Card (SAN-Mismatch) wird NICHT wiederholt → rejected-identity, 1 Fetch', async () => {
    const fetchCard = vi.fn(async () => ({ spiffeUri: 'spiffe://thinklocal/node/12D3KooWFAKE', publicKey: 'PK' }));
    const delay = vi.fn(async () => {});
    const r = await learnInboundPeer(deps({ fetchCard, delay, maxFetchAttempts: 3 }));
    expect(r).toBe('rejected-identity');
    expect(fetchCard).toHaveBeenCalledTimes(1); // erfolgreicher Fetch beendet die Schleife
    expect(delay).not.toHaveBeenCalled();
  });

  it('ADR-035 A3: maxFetchAttempts=1 → kein Retry (Alt-Verhalten)', async () => {
    const fetchCard = vi.fn(async () => { throw new Error('x'); });
    const delay = vi.fn(async () => {});
    const r = await learnInboundPeer(deps({ fetchCard, delay, maxFetchAttempts: 1 }));
    expect(r).toBe('fetch-failed');
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('MEDIUM: IPv4-mapped/IPv6 remoteAddress wird URL-sicher gebracketet (kein kaputter Endpoint)', async () => {
    const seen: string[] = [];
    const fetchCard = vi.fn(async (ep: string) => { seen.push(ep); return { spiffeUri: EXPECTED, publicKey: 'PK' }; });
    await learnInboundPeer(deps({ remoteAddress: '::ffff:10.10.10.80', fetchCard }));
    await learnInboundPeer(deps({ remoteAddress: 'fe80::1', fetchCard }));
    expect(seen[0]).toBe('https://10.10.10.80:9440'); // IPv4-mapped entmappt
    expect(seen[1]).toBe('https://[fe80::1]:9440');   // echtes IPv6 gebracketet
  });

  it('MEDIUM: leere remoteAddress → fetch-failed, kein Fetch/Record', async () => {
    const fetchCard = vi.fn();
    const record = vi.fn();
    const r = await learnInboundPeer(deps({ remoteAddress: '', fetchCard, record }));
    expect(r).toBe('fetch-failed');
    expect(fetchCard).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
