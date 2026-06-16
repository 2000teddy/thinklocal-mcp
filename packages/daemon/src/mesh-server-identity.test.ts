/**
 * Unit tests for ADR-028 D2b SPIFFE server-identity verification.
 * Focus: the auth-bypass modes the CO (gpt-5.3-codex) flagged must all fail-closed.
 */
import { describe, it, expect } from 'vitest';
import { verifyMeshServerIdentity, makeMeshCheckServerIdentity } from './mesh-server-identity.js';

const NODE = 'spiffe://thinklocal/node/12D3KooWJcpi2JgLp32w1SYpkixVQDRScBumirEVcu1taTBDBgTN';
const HOST = 'spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code';
const san = (...uris: string[]) =>
  ({ subjectaltname: [...uris.map((u) => `URI:${u}`), 'IP Address:10.10.10.80'].join(', ') });

describe('verifyMeshServerIdentity', () => {
  it('accepts a valid canonical node SAN (TOFU, no expected)', () => {
    expect(verifyMeshServerIdentity('100.103.115.126', san(NODE))).toBeUndefined();
  });

  it('accepts a valid legacy host SAN', () => {
    expect(verifyMeshServerIdentity('10.10.10.80', san(HOST))).toBeUndefined();
  });

  it('fail-closed: no SAN at all', () => {
    expect(verifyMeshServerIdentity('h', { subjectaltname: 'IP Address:10.0.0.1' })).toBeInstanceOf(Error);
    expect(verifyMeshServerIdentity('h', { subjectaltname: undefined })).toBeInstanceOf(Error);
    expect(verifyMeshServerIdentity('h', undefined)).toBeInstanceOf(Error);
  });

  it('fail-closed: wrong trust domain is NOT a valid SAN', () => {
    expect(verifyMeshServerIdentity('h', san('spiffe://other/node/abc'))).toBeInstanceOf(Error);
    // lookalike trust domain must not pass the exact prefix check
    expect(
      verifyMeshServerIdentity('h', san('spiffe://thinklocal-evil/node/12D3KooWJcpi2JgLp32w1SYpkixVQDRScBumirEVcu1taTBDBgTN')),
    ).toBeInstanceOf(Error);
  });

  it('fail-closed: malformed thinklocal SAN', () => {
    expect(verifyMeshServerIdentity('h', san('spiffe://thinklocal/bogus/x'))).toBeInstanceOf(Error);
  });

  it('expected-id match (pinned) accepts', () => {
    expect(verifyMeshServerIdentity('100.x', san(NODE), { expectedSpiffeId: NODE })).toBeUndefined();
  });

  it('expected-id MISMATCH fails closed (anti-impersonation)', () => {
    const other = 'spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb';
    // a valid mesh cert for a DIFFERENT node must not satisfy the pin
    expect(verifyMeshServerIdentity('100.x', san(other), { expectedSpiffeId: NODE })).toBeInstanceOf(Error);
  });

  it('expected-id checked against ALL SANs (transition cert: legacy + canonical)', () => {
    expect(verifyMeshServerIdentity('h', san(HOST, NODE), { expectedSpiffeId: NODE })).toBeUndefined();
    expect(verifyMeshServerIdentity('h', san(HOST, NODE), { expectedSpiffeId: HOST })).toBeUndefined();
  });

  it('fail-closed: invalid expectedSpiffeId is rejected, not silently skipped', () => {
    expect(verifyMeshServerIdentity('h', san(NODE), { expectedSpiffeId: 'not-a-uri' })).toBeInstanceOf(Error);
  });
});

describe('makeMeshCheckServerIdentity', () => {
  it('TOFU when no resolver: valid SAN passes', () => {
    const check = makeMeshCheckServerIdentity();
    expect(check('100.103.115.126', san(NODE))).toBeUndefined();
  });

  it('fail-closed when the resolver throws (CR LOW)', () => {
    const check = makeMeshCheckServerIdentity(() => {
      throw new Error('registry unavailable');
    });
    expect(check('100.103.115.126', san(NODE))).toBeInstanceOf(Error);
  });

  it('enforces the resolver-provided pin per host', () => {
    const check = makeMeshCheckServerIdentity((h) => (h === '100.103.115.126' ? NODE : undefined));
    expect(check('100.103.115.126', san(NODE))).toBeUndefined();
    const other = 'spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb';
    expect(check('100.103.115.126', san(other))).toBeInstanceOf(Error); // pinned host, wrong identity
    expect(check('10.10.10.99', san(other))).toBeUndefined(); // unpinned host → TOFU
  });
});
