import { describe, it, expect } from 'vitest';
import {
  TRUST_DOMAIN,
  peerIdToSpiffeUri,
  spiffeUriToPeerId,
  isCanonicalNodeUri,
  checkIdentityConsistency,
  spiffeFromSubjectAltName,
  authorizeHttpsSender,
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

  it('M3: rejects malformed URIs — whitespace (no trim) and reserved/illegal chars', () => {
    // no trim(): leading/trailing whitespace is NOT the same identity
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID} `)).toBeNull();
    expect(spiffeUriToPeerId(` spiffe://thinklocal/node/${PID}`)).toBeNull();
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID}\n`)).toBeNull();
    // reserved/illegal chars in the PeerID segment
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID}?x=1`)).toBeNull();
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID}#frag`)).toBeNull();
    expect(spiffeUriToPeerId('spiffe://thinklocal/node/has space')).toBeNull();
    expect(spiffeUriToPeerId('spiffe://thinklocal/node/under_score')).toBeNull();
    // the clean canonical form still parses
    expect(spiffeUriToPeerId(`spiffe://thinklocal/node/${PID}`)).toBe(PID);
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

  describe('spiffeFromSubjectAltName (mTLS peer-cert SAN parse)', () => {
    it('extracts the URI:spiffe entry', () => {
      expect(spiffeFromSubjectAltName(`DNS:foo, URI:${peerIdToSpiffeUri(PID)}, IP Address:10.0.0.1`)).toBe(peerIdToSpiffeUri(PID));
    });
    it('null when no SAN / no URI entry / empty', () => {
      expect(spiffeFromSubjectAltName(null)).toBeNull();
      expect(spiffeFromSubjectAltName(undefined)).toBeNull();
      expect(spiffeFromSubjectAltName('DNS:foo, IP Address:10.0.0.1')).toBeNull();
    });
  });

  describe('authorizeHttpsSender (ADR-022 §3 channel-bound HTTPS authz)', () => {
    const canonical = peerIdToSpiffeUri(PID);

    it('canonical sender + matching cert SAN → ok, verifiedPeerId set', () => {
      const r = authorizeHttpsSender(canonical, canonical);
      expect(r.ok).toBe(true);
      expect(r.verifiedPeerId).toBe(PID);
    });

    it('canonical sender + NO cert SAN → rejected (fail-closed)', () => {
      const r = authorizeHttpsSender(canonical, null);
      expect(r.ok).toBe(false);
      expect(r.verifiedPeerId).toBeUndefined();
    });

    it('SECURITY: canonical sender + cert SAN for a DIFFERENT PeerID → rejected', () => {
      const other = peerIdToSpiffeUri('12D3KooWDifferentPeerIDxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      const r = authorizeHttpsSender(canonical, other);
      expect(r.ok).toBe(false);
      expect(r.verifiedPeerId).toBeUndefined();
    });

    it('legacy host/<id> sender → ok, legacy:true, NO cert gate (migration compat)', () => {
      const r = authorizeHttpsSender('spiffe://thinklocal/host/cf00a5/agent/claude-code', null);
      expect(r.ok).toBe(true);
      expect(r.legacy).toBe(true);
      expect(r.verifiedPeerId).toBeUndefined();
    });

    it('SECURITY HIGH: non-canonical AND non-host/<id> URIs do NOT get the legacy bypass (fail-closed)', () => {
      // canonical-with-suffix (not parsed as canonical, not host) → reject
      expect(authorizeHttpsSender(`spiffe://thinklocal/node/${PID}/x`, null).ok).toBe(false);
      // foreign trust domain host URI → reject
      expect(authorizeHttpsSender('spiffe://evil/host/abc/agent/claude-code', null).ok).toBe(false);
      // unknown path shape → reject
      expect(authorizeHttpsSender('spiffe://thinklocal/weird/abc', null).ok).toBe(false);
      // not a spiffe URI → reject
      expect(authorizeHttpsSender('not-a-spiffe', null).ok).toBe(false);
      // bare host without /agent/<type> → reject (real legacy always has /agent/)
      expect(authorizeHttpsSender('spiffe://thinklocal/host/abc', null).ok).toBe(false);
    });
  });
});
