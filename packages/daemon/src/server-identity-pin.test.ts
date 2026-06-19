/**
 * Unit tests for ADR-028 D2b-pin: per-host TOFU pin for SPIFFE server identity.
 */
import { describe, it, expect } from 'vitest';
import {
  ServerIdentityPinStore,
  singleNormalizedIdFromCert,
  makePinningMeshCheckServerIdentity,
} from './server-identity-pin.js';

const NODE = 'spiffe://thinklocal/node/12D3KooWJcpi2JgLp32w1SYpkixVQDRScBumirEVcu1taTBDBgTN';
const OTHER = 'spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb';
const HOST_URI = 'spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code';
const san = (...uris: string[]) =>
  ({ subjectaltname: [...uris.map((u) => `URI:${u}`), 'IP Address:10.10.10.80'].join(', ') });

describe('ServerIdentityPinStore', () => {
  it('TOFU: first observe pins, repeat matches, divergent conflicts (pin unchanged)', () => {
    const s = new ServerIdentityPinStore();
    expect(s.has('h')).toBe(false);
    expect(s.observe('h', NODE)).toBe('pinned');
    expect(s.get('h')).toBe(NODE);
    expect(s.observe('h', NODE)).toBe('match');
    expect(s.observe('h', OTHER)).toBe('conflict');
    expect(s.get('h')).toBe(NODE); // conflict does NOT re-pin
    expect(s.size()).toBe(1);
  });

  it('pins are per host', () => {
    const s = new ServerIdentityPinStore();
    s.observe('a', NODE);
    s.observe('b', OTHER);
    expect(s.get('a')).toBe(NODE);
    expect(s.get('b')).toBe(OTHER);
  });
});

describe('singleNormalizedIdFromCert', () => {
  it('returns the single canonical id', () => {
    expect(singleNormalizedIdFromCert(san(NODE))).toBe(NODE);
  });
  it('normalizes a legacy host SAN', () => {
    expect(singleNormalizedIdFromCert(san(HOST_URI))).toBe(HOST_URI);
  });
  it('null on zero valid thinklocal SANs', () => {
    expect(singleNormalizedIdFromCert({ subjectaltname: 'IP Address:10.0.0.1' })).toBeNull();
    expect(singleNormalizedIdFromCert(san('spiffe://other/node/x'))).toBeNull();
    expect(singleNormalizedIdFromCert(undefined)).toBeNull();
  });
  it('null on ambiguous (>1 distinct) ids → no auto-pin', () => {
    expect(singleNormalizedIdFromCert(san(NODE, OTHER))).toBeNull();
  });
  it('a transition cert with the SAME id twice still pins (set dedups)', () => {
    expect(singleNormalizedIdFromCert(san(NODE, NODE))).toBe(NODE);
  });
});

describe('makePinningMeshCheckServerIdentity', () => {
  it('first contact pins, second contact with same identity passes', () => {
    const s = new ServerIdentityPinStore();
    const check = makePinningMeshCheckServerIdentity(s);
    expect(check('100.103.115.126', san(NODE))).toBeUndefined(); // TOFU pin
    expect(s.get('100.103.115.126')).toBe(NODE);
    expect(check('100.103.115.126', san(NODE))).toBeUndefined(); // enforced match
  });

  it('after pin, a DIFFERENT valid mesh identity for that host is rejected (anti-impersonation)', () => {
    const s = new ServerIdentityPinStore();
    const check = makePinningMeshCheckServerIdentity(s);
    expect(check('100.103.115.126', san(NODE))).toBeUndefined();
    expect(check('100.103.115.126', san(OTHER))).toBeInstanceOf(Error); // impersonation blocked
    expect(s.get('100.103.115.126')).toBe(NODE); // pin held
  });

  it('fail-closed: no valid SAN is rejected and nothing is pinned', () => {
    const s = new ServerIdentityPinStore();
    const check = makePinningMeshCheckServerIdentity(s);
    expect(check('h', { subjectaltname: 'IP Address:10.0.0.1' })).toBeInstanceOf(Error);
    expect(s.has('h')).toBe(false);
  });

  it('ambiguous SAN: accepted (TOFU) but NOT pinned (stays open until disambiguated)', () => {
    const s = new ServerIdentityPinStore();
    const check = makePinningMeshCheckServerIdentity(s);
    expect(check('h', san(NODE, OTHER))).toBeUndefined(); // valid thinklocal SAN present → TOFU ok
    expect(s.has('h')).toBe(false); // but ambiguous → no pin
  });
});
