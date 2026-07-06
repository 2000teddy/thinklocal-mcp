// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mcp-stdio-remote-skill.test.ts — Regressionstests fuer Bug #2 aus dem
 * ADR-020 Phase 1.1 Bug-Report.
 *
 * Bug: execute_remote_skill schickte HTTP-Bytes an einen HTTPS-Port, weil
 * `peerProto` aus dem lokalen `RUNTIME_MODE` abgeleitet wurde. Wenn die
 * mcp-stdio-Subprocess-Umgebung kein TLMCP_RUNTIME_MODE hatte (haeufig bei
 * via Claude-Code-MCP-Harness gespawnten Prozessen auf Linux-Hosts),
 * defaultete RUNTIME_MODE auf 'local' → peerProto auf 'http'. Resultat:
 * "Parse Error: Expected HTTP/, RTSP/ or ICE/" beim Aufruf eines
 * HTTPS-only-Peers.
 *
 * Fix: Remote-Peers laufen im Production-Mesh grundsaetzlich mit mTLS+HTTPS,
 * unabhaengig vom lokalen RUNTIME_MODE.
 */

import { describe, it, expect } from 'vitest';
import { buildRemotePeerUrl } from './mcp-stdio.js';

describe('Bug #2 Regression: buildRemotePeerUrl waehlt immer HTTPS fuer Remote-Peers', () => {
  it('liefert https:// fuer LAN-IP + Standard-Port', () => {
    expect(buildRemotePeerUrl('10.10.10.52', 9440)).toBe('https://10.10.10.52:9440');
  });

  it('liefert https:// auch fuer abweichende Ports', () => {
    expect(buildRemotePeerUrl('10.10.10.94', 9540)).toBe('https://10.10.10.94:9540');
  });

  it('liefert https:// fuer Hostname-Format', () => {
    expect(buildRemotePeerUrl('Minimac.local', 9440)).toBe('https://Minimac.local:9440');
  });

  it('liefert niemals http:// — auch nicht fuer localhost (Remote-Peer-Pfad)', () => {
    // Selbst wenn der Aufrufer aus Versehen localhost uebergeben sollte
    // (was im normalen Flow nicht passiert, weil peer.host immer eine
    // andere Maschine ist), darf das Schema nie http sein — der Mesh ist
    // mTLS-only.
    const url = buildRemotePeerUrl('localhost', 9440);
    expect(url.startsWith('https://')).toBe(true);
  });
});
