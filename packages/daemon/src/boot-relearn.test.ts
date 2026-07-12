// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * boot-relearn.test.ts — ADR-035 A2 / TL-27: proaktives Boot-Re-Learn (rein, deterministisch).
 *
 * Schwerpunkt: die CO-Invarianten — INV-A2-1 (Fetch bekommt expectedSpiffeUri zum Pinnen; Card-SAN
 * muss matchen) und INV-A2-2 (Endpoint-Subnetz-Gate, SSRF/Loopback fail-closed). Delay injiziert.
 */
import { describe, it, expect, vi } from 'vitest';
import { relearnPeer, isReLearnHostAllowed, readCappedText, type ReLearnPeerDeps } from './boot-relearn.js';

/** Fake-ByteStream aus vorgegebenen Chunks für readCappedText-Tests. */
function fakeStream(chunks: Uint8Array[]): { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } {
  let i = 0;
  let cancelled = false;
  return {
    getReader() {
      return {
        read: async () => (cancelled || i >= chunks.length ? { done: true } : { done: false, value: chunks[i++] }),
        cancel: async () => { cancelled = true; },
      };
    },
  };
}
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const PID = '12D3KooWReLearnTestAAAA';
const EXPECTED = `spiffe://thinklocal/node/${PID}`;

function deps(over: Partial<ReLearnPeerDeps> = {}): ReLearnPeerDeps {
  return {
    peerId: PID,
    expectedSpiffeUri: EXPECTED,
    endpoint: 'https://10.10.10.55:9440',
    host: '10.10.10.55',
    isAlreadyResolvable: () => false,
    isEndpointAllowed: () => true,
    rateLimitOk: () => true,
    fetchCardPinned: async () => ({ spiffeUri: EXPECTED, publicKey: 'PK-RELEARNED' }),
    record: vi.fn(),
    audit: vi.fn(),
    ...over,
  };
}

describe('relearnPeer (ADR-035 A2)', () => {
  it('recorded: gepinnter Fetch + valide Card → record + audit', async () => {
    const record = vi.fn();
    const audit = vi.fn();
    const r = await relearnPeer(deps({ record, audit }));
    expect(r).toBe('recorded');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ peerId: PID, publicKey: 'PK-RELEARNED', spiffeUri: EXPECTED }));
    expect(audit).toHaveBeenCalledOnce();
  });

  it('INV-A2-1: fetchCardPinned wird MIT expectedSpiffeUri aufgerufen (Pin-Ziel durchgereicht)', async () => {
    const fetchCardPinned = vi.fn(async () => ({ spiffeUri: EXPECTED, publicKey: 'PK' }));
    await relearnPeer(deps({ fetchCardPinned }));
    expect(fetchCardPinned).toHaveBeenCalledWith('https://10.10.10.55:9440', EXPECTED);
  });

  it('INV-A2-1: Card-SAN != expected → rejected-identity, kein record', async () => {
    const record = vi.fn();
    const fetchCardPinned = vi.fn(async () => ({ spiffeUri: 'spiffe://thinklocal/node/12D3KooWOtherBBBB', publicKey: 'PK-OTHER' }));
    const r = await relearnPeer(deps({ record, fetchCardPinned }));
    expect(r).toBe('rejected-identity');
    expect(record).not.toHaveBeenCalled();
  });

  it('kein publicKey in der Card → rejected-identity', async () => {
    const record = vi.fn();
    const r = await relearnPeer(deps({ record, fetchCardPinned: async () => ({ spiffeUri: EXPECTED }) }));
    expect(r).toBe('rejected-identity');
    expect(record).not.toHaveBeenCalled();
  });

  it('INV-A2-2: Endpoint nicht erlaubt → endpoint-blocked, KEIN Fetch', async () => {
    const fetchCardPinned = vi.fn();
    const r = await relearnPeer(deps({ isEndpointAllowed: () => false, fetchCardPinned }));
    expect(r).toBe('endpoint-blocked');
    expect(fetchCardPinned).not.toHaveBeenCalled();
  });

  it('bereits auflösbar → skipped-resolvable, KEIN Fetch/Gate', async () => {
    const fetchCardPinned = vi.fn();
    const r = await relearnPeer(deps({ isAlreadyResolvable: () => true, fetchCardPinned }));
    expect(r).toBe('skipped-resolvable');
    expect(fetchCardPinned).not.toHaveBeenCalled();
  });

  it('rate-limited → rate-limited, KEIN Fetch', async () => {
    const fetchCardPinned = vi.fn();
    const r = await relearnPeer(deps({ rateLimitOk: () => false, fetchCardPinned }));
    expect(r).toBe('rate-limited');
    expect(fetchCardPinned).not.toHaveBeenCalled();
  });

  it('Wellen-Recovery: transienter Throw → Erfolg beim 2. Versuch (recorded)', async () => {
    let n = 0;
    const fetchCardPinned = vi.fn(async () => {
      if (++n === 1) throw new Error('ECONNREFUSED');
      return { spiffeUri: EXPECTED, publicKey: 'PK' };
    });
    const delay = vi.fn(async () => {});
    const r = await relearnPeer(deps({ fetchCardPinned, delay }));
    expect(r).toBe('recorded');
    expect(fetchCardPinned).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('Retries erschöpft → fetch-failed', async () => {
    const fetchCardPinned = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const delay = vi.fn(async () => {});
    const r = await relearnPeer(deps({ fetchCardPinned, delay, maxFetchAttempts: 3 }));
    expect(r).toBe('fetch-failed');
    expect(fetchCardPinned).toHaveBeenCalledTimes(3);
  });

  it('Backoff-Reihenfolge wird eingehalten', async () => {
    const seen: number[] = [];
    const fetchCardPinned = vi.fn(async () => { throw new Error('x'); });
    const delay = vi.fn(async (ms: number) => { seen.push(ms); });
    await relearnPeer(deps({ fetchCardPinned, delay, maxFetchAttempts: 4, fetchBackoffMs: [10, 20, 30] }));
    expect(seen).toEqual([10, 20, 30]); // letzter Wert wiederverwendet beim 3. Delay
  });
});

describe('isReLearnHostAllowed (INV-A2-2, SSRF-Gate)', () => {
  it('private RFC1918-IP ohne Policy → erlaubt', () => {
    expect(isReLearnHostAllowed('10.10.10.55')).toBe(true);
    expect(isReLearnHostAllowed('192.168.1.5')).toBe(true);
    expect(isReLearnHostAllowed('172.16.0.9')).toBe(true);
  });

  it('öffentliche IP ohne Policy → verworfen', () => {
    expect(isReLearnHostAllowed('8.8.8.8')).toBe(false);
    expect(isReLearnHostAllowed('1.1.1.1')).toBe(false);
  });

  it('Loopback / link-local / unspezifiziert → verworfen', () => {
    expect(isReLearnHostAllowed('127.0.0.1')).toBe(false);
    expect(isReLearnHostAllowed('::1')).toBe(false);
    expect(isReLearnHostAllowed('169.254.1.1')).toBe(false);
    expect(isReLearnHostAllowed('fe80::1')).toBe(false);
    expect(isReLearnHostAllowed('0.0.0.0')).toBe(false);
  });

  it('Hostname (kein IP-Literal) → verworfen (kein DNS-Rebinding-Vektor)', () => {
    expect(isReLearnHostAllowed('evil.example.com')).toBe(false);
    expect(isReLearnHostAllowed('localhost')).toBe(false);
  });

  it('mit allowed_mesh_cidrs: nur Mitglieder erlaubt', () => {
    expect(isReLearnHostAllowed('10.10.10.55', ['10.10.10.0/24'])).toBe(true);
    expect(isReLearnHostAllowed('10.10.11.55', ['10.10.10.0/24'])).toBe(false);
    // öffentliche IP, aber explizit in Policy → erlaubt (Operator-Entscheidung)
    expect(isReLearnHostAllowed('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
  });

  it('IPv4-mapped IPv6 wird entmappt geprüft', () => {
    expect(isReLearnHostAllowed('::ffff:10.10.10.55')).toBe(true);
    expect(isReLearnHostAllowed('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('readCappedText (CR MED — Body-Byte-Limit)', () => {
  it('Body unter dem Limit → dekodierter Text (auch über mehrere Chunks)', async () => {
    const out = await readCappedText(fakeStream([enc('{"a":1'), enc(',"b":2}')]), 1024);
    expect(out).toBe('{"a":1,"b":2}');
  });

  it('Body über dem Limit → null (Stream abgebrochen)', async () => {
    const out = await readCappedText(fakeStream([enc('x'.repeat(200)), enc('y'.repeat(200))]), 256);
    expect(out).toBeNull();
  });

  it('leerer Body → leerer String', async () => {
    expect(await readCappedText(fakeStream([]), 1024)).toBe('');
  });

  it('genau am Limit → noch akzeptiert', async () => {
    expect(await readCappedText(fakeStream([enc('abcd')]), 4)).toBe('abcd');
  });
});
