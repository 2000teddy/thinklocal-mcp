// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * agent-card-mtls-wiring.test.ts — TL-11 CR-M2-Follow-up: mTLS-Wiring des ECHTEN `AgentCardServer`.
 *
 * Der cert-fixture-Slice (#283) hat die mTLS-Pflicht (`requestCert`/`rejectUnauthorized`) über einen
 * ZWEITEN Fastify-Harness mit demselben Vertrag geprüft — NICHT gegen die reale Klasse. CR-M2 hielt
 * ausdrücklich fest: „ein Regress von `requestCert` in agent-card.ts wird dort bewusst NICHT gefangen".
 * Diese Datei schließt genau diese Lücke: sie konstruiert den realen `AgentCardServer` mit einem
 * In-Memory-TLS-Bundle (mesh-CA + node-cert, kein Secret, kein Port-Listen, kein Host-Hop) und liest
 * die Flags direkt vom darunterliegenden Node-`tls.Server` (`fastify.server`) ab.
 *
 * Beweisziel (agent-card.ts:225-231): bei vorhandenem `opts.tls` wird der HTTPS-Server IMMER mit
 * `requestCert === true` UND `rejectUnauthorized === true` gebaut — ein Kippen einer der beiden Zeilen
 * (mTLS-Aufweichung) fällt hier sofort rot. Negativkontrolle: ohne `opts.tls` gibt es keinen
 * TLS-Server (kein `requestCert`), damit die Positivassertion aussagekräftig ist.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCardServer } from './agent-card.js';
import type { AgentCardServerOptions } from './agent-card.js';
import { createMeshCA, createNodeCert } from './tls.js';
import type { NodeCertBundle } from './tls.js';
import { loadOrCreateIdentity } from './identity.js';
import { loadConfig } from './config.js';
import type { AgentIdentity } from './identity.js';
import type { DaemonConfig } from './config.js';

const NO_TOML = '/nonexistent/thinklocal-tl11-mtls-wiring.toml';

/** Die zwei mTLS-Flags, wie der Node-`tls.Server` sie aus den `https`-Options als Instanzfelder ablegt. */
interface TlsServerFlags {
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
}

/** Liest die Flags vom realen darunterliegenden Node-Server der Fastify-Instanz (kein Listen nötig). */
function tlsFlags(server: AgentCardServer): TlsServerFlags {
  return server.getServer().server as unknown as TlsServerFlags;
}

describe('AgentCardServer — mTLS-Wiring (TL-11 CR-M2)', () => {
  let dir: string;
  let identity: AgentIdentity;
  let config: DaemonConfig;
  let tls: NodeCertBundle;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-mtls-'));
    identity = await loadOrCreateIdentity(dir, 'claude-code', 'test-host');
    config = loadConfig(NO_TOML);
    // In-Memory-Vertrauenskette (kein Secret, kein Disk-Persist): eigene Mesh-CA signiert das Node-Leaf.
    const ca = createMeshCA('thinklocal', 'test-host');
    tls = createNodeCert(ca, 'test-host', 'spiffe://thinklocal/host/test-host/agent/claude-code', [
      '127.0.0.1',
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeServer(opts: Partial<AgentCardServerOptions>): AgentCardServer {
    return new AgentCardServer({ identity, config, ...opts });
  }

  it('baut den HTTPS-Server mit requestCert=true UND rejectUnauthorized=true (mTLS erzwungen)', () => {
    const flags = tlsFlags(makeServer({ tls }));
    // Genau die zwei Zeilen agent-card.ts:229-230 — Kippen einer davon = mTLS-Loch = hier rot.
    expect(flags.requestCert).toBe(true);
    expect(flags.rejectUnauthorized).toBe(true);
  });

  it('ein aggregiertes trustedCaBundle schwächt die mTLS-Pflicht NICHT', () => {
    // Bundle-Pfad (eigene CA + gepairte Peer-CAs) darf nur die `ca`-Trust-Liste erweitern,
    // niemals requestCert/rejectUnauthorized aufweichen.
    const flags = tlsFlags(makeServer({ tls, trustedCaBundle: [tls.caCertPem] }));
    expect(flags.requestCert).toBe(true);
    expect(flags.rejectUnauthorized).toBe(true);
  });

  it('Negativkontrolle: ohne opts.tls kein TLS-Server → keine requestCert-Semantik', () => {
    // Beweist, dass die Positivassertion oben nicht trivial „immer true" ist: der Plain-HTTP-Server
    // trägt kein aktives requestCert.
    const flags = tlsFlags(makeServer({}));
    expect(flags.requestCert).not.toBe(true);
  });
});
