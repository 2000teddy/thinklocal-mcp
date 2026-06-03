import { describe, it, expect } from 'vitest';
import {
  TRUST_DOMAIN,
  peerIdToSpiffeUri,
  spiffeUriToPeerId,
  isCanonicalNodeUri,
  checkIdentityConsistency,
} from './peer-identity.js';

const PID = '12D3KooWCn86Frs2pqSkffVaoFsuHA7fByGZ7rULVqGcesk2RrJF';

describe('peer-identity — ADR-022 PeerID-rooted identity', () => {
  it('trust domain is the fixed "thinklocal" (no .mesh variant)', () => {
    expect(TRUST_DOMAIN).toBe('thinklocal');
  });

  it('derives canonical SPIFFE URI from PeerID', () => {
    expect(peerIdToSpiffeUri(PID)).toBe(`spiffe://thinklocal/node/${PID}`);
  });

  it('round-trips PeerID <-> canonical URI', () => {
    expect(spiffeUriToPeerId(peerIdToSpiffeUri(PID))).toBe(PID);
  });

  it('is strict: a trailing path suffix is NOT canonical (fail-closed, CR MEDIUM)', () => {
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID}/agent/claude-code`)).toBeNull();
    expect(isCanonicalNodeUri(`spiffe://thinklocal/node/${PID}/extra`)).toBe(false);
  });

  it('returns null for a legacy host/<id> URI (migration case)', () => {
    expect(spiffeUriToPeerId('spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code')).toBeNull();
    expect(isCanonicalNodeUri('spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code')).toBe(false);
    expect(isCanonicalNodeUri(peerIdToSpiffeUri(PID))).toBe(true);
  });

  it('rejects a foreign trust domain', () => {
    expect(spiffeUriToPeerId(`spiffe://evil/node/${PID}`)).toBeNull();
  });

  describe('checkIdentityConsistency (§Startup-Assertion)', () => {
    it('consistent when all three agree on the PeerID-derived URI', () => {
      const uri = peerIdToSpiffeUri(PID);
      const r = checkIdentityConsistency({ authzSpiffe: uri, certSan: uri, peerId: PID });
      expect(r.consistent).toBe(true);
      expect(r.divergences).toEqual([]);
      expect(r.expected).toBe(uri);
    });

    it('flags the live drift (host/<id> authz + hostname cert SAN vs PeerID)', () => {
      const r = checkIdentityConsistency({
        authzSpiffe: 'spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code',
        certSan: 'spiffe://thinklocal/host/ThinkHub/agent/claude-code',
        peerId: PID,
      });
      expect(r.consistent).toBe(false);
      expect(r.divergences.length).toBe(2); // authz mismatch + cert-SAN mismatch
      expect(r.expected).toBe(peerIdToSpiffeUri(PID));
    });

    it('is inconsistent (not crash) when peerId is missing', () => {
      const r = checkIdentityConsistency({ authzSpiffe: 'x', certSan: 'x', peerId: null });
      expect(r.consistent).toBe(false);
      expect(r.expected).toBeNull();
    });

    it('notes when cert SAN is unreadable but does not falsely pass', () => {
      const uri = peerIdToSpiffeUri(PID);
      const r = checkIdentityConsistency({ authzSpiffe: uri, certSan: null, peerId: PID });
      expect(r.consistent).toBe(false);
      expect(r.divergences.some((d) => /Cert-SAN nicht lesbar/.test(d))).toBe(true);
    });
  });
});
