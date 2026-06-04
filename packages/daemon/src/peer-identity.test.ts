import { describe, it, expect } from 'vitest';
import {
  TRUST_DOMAIN,
  peerIdToSpiffeUri,
  spiffeUriToPeerId,
  isCanonicalNodeUri,
  checkIdentityConsistency,
  spiffeFromSubjectAltName,
  authorizeHttpsSender,
  peerIdFromCertSan,
  spiffeUrisFromSubjectAltName,
  isAttestingIssuer,
  attestedPeerIdFromCert,
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

  describe('peerIdFromCertSan (ADR-022 Phase 0 accept-both bridge)', () => {
    it('canonical cert SAN → the PeerID (verified from the CA-signed cert, regardless of sender form)', () => {
      expect(peerIdFromCertSan(peerIdToSpiffeUri(PID))).toBe(PID);
    });

    it('no SAN → null', () => {
      expect(peerIdFromCertSan(null)).toBeNull();
    });

    it('legacy host/<id> cert SAN → null (no canonical PeerID to verify)', () => {
      expect(peerIdFromCertSan('spiffe://thinklocal/host/cf00a5/agent/claude-code')).toBeNull();
    });

    it('malformed / foreign / suffixed SAN → null (fail-closed, strict parse)', () => {
      expect(peerIdFromCertSan(`spiffe://thinklocal/node/${PID}/x`)).toBeNull();
      expect(peerIdFromCertSan(`spiffe://evil/node/${PID}`)).toBeNull();
      expect(peerIdFromCertSan('not-a-spiffe')).toBeNull();
    });

    it('accept-both: a legacy-sender peer presenting a canonical cert SAN still yields its PeerID', () => {
      // This is the Phase-1 case: cert reissued to node/<PeerID>, envelope.sender still legacy.
      // authorizeHttpsSender takes the legacy bypass, but peerIdFromCertSan still extracts the
      // crypto-attested PeerID so the receiver can mark it verified before the sender flips.
      const legacySender = 'spiffe://thinklocal/host/cf00a5/agent/claude-code';
      const canonicalCert = peerIdToSpiffeUri(PID);
      expect(authorizeHttpsSender(legacySender, canonicalCert).ok).toBe(true); // legacy bypass
      expect(peerIdFromCertSan(canonicalCert)).toBe(PID); // …and the PeerID is still recovered
    });
  });

  describe('spiffeUrisFromSubjectAltName (dual-SAN migration certs)', () => {
    it('extracts ALL URI:spiffe entries, in order', () => {
      const legacy = 'spiffe://thinklocal/host/cf00a5/agent/claude-code';
      const canonical = peerIdToSpiffeUri(PID);
      const san = `DNS:foo, URI:${legacy}, URI:${canonical}, IP Address:10.0.0.1`;
      expect(spiffeUrisFromSubjectAltName(san)).toEqual([legacy, canonical]);
    });

    it('finds the canonical SAN even when the legacy SAN is listed FIRST (order-independent)', () => {
      const legacy = 'spiffe://thinklocal/host/cf00a5/agent/claude-code';
      const canonical = peerIdToSpiffeUri(PID);
      const sans = spiffeUrisFromSubjectAltName(`URI:${legacy}, URI:${canonical}`);
      expect(sans.find((u) => peerIdFromCertSan(u) !== null)).toBe(canonical);
    });

    it('empty / no-URI → []', () => {
      expect(spiffeUrisFromSubjectAltName(null)).toEqual([]);
      expect(spiffeUrisFromSubjectAltName('DNS:foo, IP Address:10.0.0.1')).toEqual([]);
    });
  });

  describe('isAttestingIssuer (CA pin for PeerID attestation)', () => {
    const FP = 'AB:CD:EF:01:23:45:67:89';
    it('empty pin set → false (Phase-0 default → inert)', () => {
      expect(isAttestingIssuer(FP, [])).toBe(false);
    });
    it('null/undefined issuer → false', () => {
      expect(isAttestingIssuer(null, [FP])).toBe(false);
      expect(isAttestingIssuer(undefined, [FP])).toBe(false);
    });
    it('matches regardless of colons / case', () => {
      expect(isAttestingIssuer(FP, ['abcdef0123456789'])).toBe(true);
      expect(isAttestingIssuer('abcdef0123456789', [FP])).toBe(true);
    });
    it('non-matching issuer → false', () => {
      expect(isAttestingIssuer(FP, ['00:11:22:33'])).toBe(false);
    });
  });

  describe('attestedPeerIdFromCert (ADR-022 WS-2 HIGH: issuer-pinned attestation)', () => {
    const PIN = 'AB:CD:EF:01';
    const canonical = peerIdToSpiffeUri(PID);
    const legacy = 'spiffe://thinklocal/host/cf00a5/agent/claude-code';

    it('canonical SAN + attesting issuer → the PeerID', () => {
      expect(attestedPeerIdFromCert([canonical], PIN, [PIN])).toBe(PID);
    });

    it('SECURITY HIGH: canonical SAN but NON-attesting (e.g. malicious paired) CA → null (no spoof)', () => {
      // A malicious paired CA in the mTLS trust bundle mints node/<victim>; without the
      // issuer pin this would falsely attest the victim's PeerID. Issuer not pinned → null.
      expect(attestedPeerIdFromCert([canonical], 'DE:AD:BE:EF', [PIN])).toBeNull();
    });

    it('SECURITY HIGH: empty pin set (Phase-0 default) → null even with a valid-looking issuer', () => {
      expect(attestedPeerIdFromCert([canonical], PIN, [])).toBeNull();
    });

    it('no canonical SAN (legacy-only cert) → null', () => {
      expect(attestedPeerIdFromCert([legacy], PIN, [PIN])).toBeNull();
    });

    it('dual-SAN cert (legacy first) + attesting issuer → still attests the canonical PeerID', () => {
      expect(attestedPeerIdFromCert([legacy, canonical], PIN, [PIN])).toBe(PID);
    });
  });
});
