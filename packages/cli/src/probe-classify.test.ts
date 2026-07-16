// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * probe-classify.test.ts — deckt die vier Klassen (down/tls/timeout/unknown) sowie die
 * Phantom-ROT-Kern-Invariante ab: ein TLS/mTLS-Reset (Port antwortet) wird NIE als „down"
 * (likelyUp=false) gemeldet, ein echtes down NIE als „up".
 */
import { describe, it, expect } from 'vitest';
import { classifyProbeError, type ProbeErrorKind } from './probe-classify.js';

/** Baut einen undici-artigen `fetch failed`-Fehler mit `cause.code`/`cause.message`. */
function fetchFailed(cause: { code?: string; message?: string; name?: string }): TypeError {
  const err = new TypeError('fetch failed');
  (err as unknown as { cause: unknown }).cause = { name: 'Error', ...cause };
  return err;
}

describe('classifyProbeError', () => {
  it('ECONNREFUSED → down, likelyUp=false (kein Listener)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.10.10.55:9440' }));
    expect(v.kind).toBe('down');
    expect(v.likelyUp).toBe(false);
    expect(v.code).toBe('ECONNREFUSED');
  });

  it('ENOTFOUND / EAI_AGAIN → down (DNS)', () => {
    expect(classifyProbeError(fetchFailed({ code: 'ENOTFOUND' })).kind).toBe('down');
    expect(classifyProbeError(fetchFailed({ code: 'EAI_AGAIN' })).kind).toBe('down');
  });

  it('EHOSTUNREACH / ENETUNREACH → down (Routing)', () => {
    expect(classifyProbeError(fetchFailed({ code: 'EHOSTUNREACH' })).kind).toBe('down');
    expect(classifyProbeError(fetchFailed({ code: 'ENETUNREACH' })).kind).toBe('down');
  });

  it('ECONNRESET → tls, likelyUp=TRUE (http:// gegen TLS-Port / mTLS-Reset)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'ECONNRESET', message: 'read ECONNRESET' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('UND_ERR_SOCKET "other side closed" → tls (mTLS ohne Client-Cert)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'UND_ERR_SOCKET', message: 'other side closed' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('ERR_SSL_WRONG_VERSION_NUMBER → tls (https-Client gegen http, oder umgekehrt)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'wrong version number' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('Cert-Vertrauensbruch (UNABLE_TO_VERIFY_LEAF_SIGNATURE) → tls (Port spricht TLS)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('ERR_TLS_CERT_ALTNAME_INVALID → tls (fehlender IP/100.x-SAN, bekannter Blocker)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: "Host: 10.10.10.55. is not in the cert's altnames" }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('HPE_* HTTP-Parse-Fehler → tls (Nicht-HTTP-Bytes = TLS-Alert zurück)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'HPE_INVALID_CONSTANT', message: 'Expected HTTP/' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('"socket hang up" ohne Code → tls (Port antwortete, riss ab)', () => {
    const v = classifyProbeError(fetchFailed({ message: 'socket hang up' }));
    expect(v.kind).toBe('tls');
    expect(v.likelyUp).toBe(true);
  });

  it('AbortSignal.timeout (TimeoutError) → timeout, likelyUp=false', () => {
    const v = classifyProbeError(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
    expect(v.kind).toBe('timeout');
    expect(v.likelyUp).toBe(false);
  });

  it('AbortError → timeout', () => {
    expect(classifyProbeError(Object.assign(new Error('aborted'), { name: 'AbortError' })).kind).toBe('timeout');
  });

  it('UND_ERR_CONNECT_TIMEOUT → timeout', () => {
    expect(classifyProbeError(fetchFailed({ code: 'UND_ERR_CONNECT_TIMEOUT' })).kind).toBe('timeout');
  });

  it('unbekannter Code → unknown, likelyUp=false (konservativ, kein Über-Claim)', () => {
    const v = classifyProbeError(fetchFailed({ code: 'ESOMETHING_NEW', message: 'weird' }));
    expect(v.kind).toBe('unknown');
    expect(v.likelyUp).toBe(false);
    expect(v.code).toBe('ESOMETHING_NEW');
  });

  it('null/undefined/leerer Fehler → unknown, kein Crash', () => {
    expect(classifyProbeError(null).kind).toBe('unknown');
    expect(classifyProbeError(undefined).kind).toBe('unknown');
    expect(classifyProbeError({}).kind).toBe('unknown');
  });

  it('Kern-Invariante: KEIN down-Code wird je likelyUp, KEIN tls-Reset je „down"', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']) {
      const v = classifyProbeError(fetchFailed({ code }));
      expect(v.likelyUp).toBe(false);
      expect(v.kind).toBe<ProbeErrorKind>('down');
    }
    for (const code of ['ECONNRESET', 'EPROTO', 'UND_ERR_SOCKET', 'ERR_SSL_WRONG_VERSION_NUMBER']) {
      const v = classifyProbeError(fetchFailed({ code }));
      expect(v.kind).not.toBe('down');
      expect(v.likelyUp).toBe(true);
    }
  });
});
