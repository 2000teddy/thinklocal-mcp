import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { libp2pPeerIdString } from './libp2p-identity.js';
import { peerIdToSpiffeUri } from './peer-identity.js';
import {
  CERT_POP_DOMAIN,
  buildCertPopMessage,
  signCertPop,
  verifyCertPop,
  sha256Hex,
  type CertPopFields,
} from './cert-pop.js';

const CA_FP = 'ab:cd:ef:01:23:45';

let key: PrivateKey;
let peerId: string;
let fields: CertPopFields;

beforeAll(async () => {
  key = await generateKeyPair('Ed25519');
  peerId = libp2pPeerIdString(key);
  fields = {
    caFingerprint: CA_FP,
    nonce: 'nonce-abc',
    peerId,
    spiffeUri: peerIdToSpiffeUri(peerId),
    csrPublicKeyHash: sha256Hex('dummy-csr-spki'),
  };
});

describe('cert-pop — PoP scope serialization', () => {
  it('is deterministic and starts with the (length-prefixed) domain separator', () => {
    const a = buildCertPopMessage(fields);
    const b = buildCertPopMessage(fields);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // domain bytes appear right after the 4-byte length prefix
    const domain = new TextDecoder().decode(a.slice(4, 4 + CERT_POP_DOMAIN.length));
    expect(domain).toBe(CERT_POP_DOMAIN);
  });

  it('length-prefixing prevents field-boundary ambiguity (a|bc != ab|c)', () => {
    const m1 = buildCertPopMessage({ ...fields, nonce: 'a', peerId: 'bc' });
    const m2 = buildCertPopMessage({ ...fields, nonce: 'ab', peerId: 'c' });
    expect(Buffer.from(m1).equals(Buffer.from(m2))).toBe(false);
  });

  it('any field change changes the message', () => {
    const base = Buffer.from(buildCertPopMessage(fields));
    for (const k of ['caFingerprint', 'nonce', 'peerId', 'spiffeUri', 'csrPublicKeyHash'] as const) {
      const changed = Buffer.from(buildCertPopMessage({ ...fields, [k]: fields[k] + 'X' }));
      expect(base.equals(changed)).toBe(false);
    }
  });
});

describe('cert-pop — sign / verify round-trip', () => {
  it('valid PoP verifies', async () => {
    const sig = await signCertPop(key, fields);
    const raw = key.publicKey.raw;
    const r = await verifyCertPop(raw, fields, sig, CA_FP);
    expect(r.ok).toBe(true);
  });

  it('CA fingerprint compared normalized (colons/case)', async () => {
    const sig = await signCertPop(key, fields);
    const r = await verifyCertPop(key.publicKey.raw, fields, sig, 'ABCDEF012345');
    expect(r.ok).toBe(true);
  });

  it('SECURITY: tampering any signed field → reject', async () => {
    const sig = await signCertPop(key, fields);
    const tampered = { ...fields, nonce: 'different-nonce' };
    const r = await verifyCertPop(key.publicKey.raw, tampered, sig, CA_FP);
    expect(r.ok).toBe(false);
  });

  it('SECURITY: wrong expected CA fingerprint → reject', async () => {
    const sig = await signCertPop(key, fields);
    const r = await verifyCertPop(key.publicKey.raw, fields, sig, 'deadbeef');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CA-Fingerprint/);
  });

  it('SECURITY: PeerID not derived from the presented public key → reject', async () => {
    const other = await generateKeyPair('Ed25519');
    const sig = await signCertPop(key, fields);
    // present a DIFFERENT pubkey than the one that signed / that peerId derives from
    const r = await verifyCertPop(other.publicKey.raw, fields, sig, CA_FP);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/PeerID|Signatur/);
  });

  it('SECURITY: non-canonical requested SPIFFE URI → reject', async () => {
    const bad = { ...fields, spiffeUri: `spiffe://thinklocal/host/abc/agent/claude-code` };
    const sig = await signCertPop(key, bad);
    const r = await verifyCertPop(key.publicKey.raw, bad, sig, CA_FP);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/SPIFFE-URI/);
  });

  it('SECURITY: signature from a different key → reject', async () => {
    const other = await generateKeyPair('Ed25519');
    const otherPeerId = libp2pPeerIdString(other);
    const otherFields = { ...fields, peerId: otherPeerId, spiffeUri: peerIdToSpiffeUri(otherPeerId) };
    const sigFromKey = await signCertPop(key, otherFields); // wrong signer
    const r = await verifyCertPop(other.publicKey.raw, otherFields, sigFromKey, CA_FP);
    expect(r.ok).toBe(false);
  });
});
