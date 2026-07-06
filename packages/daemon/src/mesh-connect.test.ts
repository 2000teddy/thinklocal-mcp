// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import {
  resolveOutboundConnectPolicy,
  buildConnectorOptions,
  buildMeshConnector,
  wrapConnectorWithDebug,
  type LooseConnector,
} from './mesh-connect.js';

const TLS = { ca: 'ca-pem', cert: 'cert-pem', key: 'key-pem' };

describe('resolveOutboundConnectPolicy', () => {
  it('Default: alle Flags aus', () => {
    expect(resolveOutboundConnectPolicy({})).toEqual({ debug: false, disablePinning: false, spiffeServerIdentity: false });
  });
  it('TLMCP_DEBUG_CONNECT=1 → debug', () => {
    expect(resolveOutboundConnectPolicy({ TLMCP_DEBUG_CONNECT: '1' }).debug).toBe(true);
  });
  it('TLMCP_DISABLE_OUTBOUND_PINNING=1 → disablePinning', () => {
    expect(resolveOutboundConnectPolicy({ TLMCP_DISABLE_OUTBOUND_PINNING: '1' }).disablePinning).toBe(true);
  });
  it('TLMCP_SPIFFE_SERVER_IDENTITY=1 → spiffeServerIdentity (ADR-028 D2b)', () => {
    expect(resolveOutboundConnectPolicy({ TLMCP_SPIFFE_SERVER_IDENTITY: '1' }).spiffeServerIdentity).toBe(true);
  });
  it('andere Werte als "1" zählen nicht', () => {
    const p = resolveOutboundConnectPolicy({ TLMCP_DEBUG_CONNECT: 'true', TLMCP_DISABLE_OUTBOUND_PINNING: '0' });
    expect(p).toEqual({ debug: false, disablePinning: false, spiffeServerIdentity: false });
  });
});

describe('buildConnectorOptions', () => {
  it('Default (kein disablePinning): nur TLS-Optionen, KEIN autoSelectFamily, KEIN localAddress, KEIN checkServerIdentity', () => {
    const o = buildConnectorOptions(TLS, { debug: false, disablePinning: false, spiffeServerIdentity: false });
    expect(o).toMatchObject({ ca: 'ca-pem', cert: 'cert-pem', key: 'key-pem', rejectUnauthorized: true });
    expect('autoSelectFamily' in o).toBe(false);
    expect('localAddress' in o).toBe(false);
    expect('checkServerIdentity' in o).toBe(false); // Node-Default-altname (= bisheriges Verhalten)
  });
  it('disablePinning: autoSelectFamily=false, localAddress NICHT gesetzt (Default-Source)', () => {
    const o = buildConnectorOptions(TLS, { debug: false, disablePinning: true, spiffeServerIdentity: false });
    expect(o['autoSelectFamily']).toBe(false);
    expect('localAddress' in o).toBe(false); // kein Source-Bind
    expect(o['rejectUnauthorized']).toBe(true); // mTLS bleibt scharf
  });
  it('spiffeServerIdentity OHNE injizierten Checker → wirft (D2b-pin Downgrade-Schutz, CR-MEDIUM)', () => {
    expect(() =>
      buildConnectorOptions(TLS, { debug: false, disablePinning: false, spiffeServerIdentity: true }),
    ).toThrow(/D2b-pin|kein.*TOFU-Fallback|checkServerIdentity injiziert/i);
  });
  it('spiffeServerIdentity: injizierter (pinnender) Checker wird durchgereicht, rejectUnauthorized bleibt true (ADR-028 D2b-pin)', () => {
    const injected = (host: string): Error | undefined =>
      host === 'blocked' ? new Error('pinned-mismatch') : undefined;
    const o = buildConnectorOptions(TLS, { debug: false, disablePinning: false, spiffeServerIdentity: true }, injected);
    expect(o.checkServerIdentity).toBe(injected);
    expect(o['rejectUnauthorized']).toBe(true); // Chain-Validierung NIE geschwächt
    expect(o.checkServerIdentity?.('blocked', { subjectaltname: '' })).toBeInstanceOf(Error);
    expect(o.checkServerIdentity?.('ok', { subjectaltname: '' })).toBeUndefined();
  });
});

describe('buildMeshConnector', () => {
  it('liefert in allen Flag-Kombinationen eine Connector-Funktion', () => {
    for (const debug of [false, true]) {
      for (const disablePinning of [false, true]) {
        const c = buildMeshConnector(TLS, { debug, disablePinning });
        expect(typeof c).toBe('function');
      }
    }
  });
});

describe('wrapConnectorWithDebug — Passthrough (CR-LOW)', () => {
  const opts = buildConnectorOptions(TLS, { debug: true, disablePinning: false });

  it('reicht einen FEHLER genau einmal an den Aufrufer-Callback weiter (nicht geschluckt)', () => {
    const boom = Object.assign(new Error('EHOSTUNREACH'), { code: 'EHOSTUNREACH', address: '10.10.10.94', port: 9440 });
    const base: LooseConnector = (_o, cb) => cb(boom);
    const wrapped = wrapConnectorWithDebug(base, opts);
    const calls: Array<[unknown, unknown]> = [];
    wrapped({ hostname: '10.10.10.94', port: 9440 }, (err, sock) => calls.push([err, sock]));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(boom);
  });

  it('reicht ERFOLG (socket) genau einmal weiter', () => {
    const fakeSock = { localAddress: '10.10.10.55', localPort: 51000, remoteAddress: '10.10.10.94', remoteFamily: 'IPv4' };
    const base: LooseConnector = (_o, cb) => cb(null, fakeSock);
    const wrapped = wrapConnectorWithDebug(base, opts);
    const calls: Array<[unknown, unknown]> = [];
    wrapped({ hostname: '10.10.10.94', port: 9440 }, (err, sock) => calls.push([err, sock]));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeNull();
    expect(calls[0][1]).toBe(fakeSock);
  });

  it('ruft die Base genau einmal mit den Original-Optionen auf', () => {
    let baseCalls = 0;
    let seenOpts: unknown;
    const base: LooseConnector = (o, cb) => { baseCalls++; seenOpts = o; cb(null, {}); };
    const wrapped = wrapConnectorWithDebug(base, opts);
    const passed = { hostname: 'peer', port: 9440 };
    wrapped(passed, () => {});
    expect(baseCalls).toBe(1);
    expect(seenOpts).toBe(passed);
  });
});
