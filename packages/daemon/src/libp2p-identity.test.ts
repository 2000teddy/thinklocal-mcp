// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOrCreateLibp2pPrivateKey,
  libp2pPeerIdString,
  LIBP2P_KEY_FILENAME,
} from './libp2p-identity.js';

const mkTmp = () => mkdtempSync(join(tmpdir(), 'tlmcp-libp2p-key-'));

describe('libp2p-identity — ADR-022 #0 persisted, stable PeerID', () => {
  // DAS Akzeptanzkriterium: der exakte Gegenbeweis zu den zwei Smoke-Tests vom
  // 2026-06-03, die je eine ANDERE PeerID zeigten.
  it('ACCEPTANCE: two consecutive loads (= two restarts) yield the SAME PeerID', async () => {
    const dir = mkTmp();
    const first = await loadOrCreateLibp2pPrivateKey(dir);
    expect(first.generated).toBe(true);

    const second = await loadOrCreateLibp2pPrivateKey(dir);
    expect(second.generated).toBe(false); // geladen, nicht neu erzeugt
    expect(second.peerId).toBe(first.peerId); // STABIL
    expect(libp2pPeerIdString(second.privateKey)).toBe(first.peerId);
  });

  it('different data dirs → different PeerIDs (kein versehentliches Teilen)', async () => {
    const a = await loadOrCreateLibp2pPrivateKey(mkTmp());
    const b = await loadOrCreateLibp2pPrivateKey(mkTmp());
    expect(b.peerId).not.toBe(a.peerId);
  });

  it('persists the key file with 0600 (owner-only)', async () => {
    const dir = mkTmp();
    await loadOrCreateLibp2pPrivateKey(dir);
    const mode = statSync(join(dir, 'keys', LIBP2P_KEY_FILENAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('warns when an existing key file has too-open perms', async () => {
    const dir = mkTmp();
    await loadOrCreateLibp2pPrivateKey(dir);
    chmodSync(join(dir, 'keys', LIBP2P_KEY_FILENAME), 0o644);
    const warn = vi.fn();
    const log = { warn, info: vi.fn() } as unknown as import('pino').Logger;
    const r = await loadOrCreateLibp2pPrivateKey(dir, log);
    expect(r.generated).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('fail-loud with a contextual error on a corrupt key file (no silent regen)', async () => {
    const dir = mkTmp();
    await loadOrCreateLibp2pPrivateKey(dir);
    writeFileSync(join(dir, 'keys', LIBP2P_KEY_FILENAME), Buffer.from('not-a-valid-protobuf'));
    await expect(loadOrCreateLibp2pPrivateKey(dir)).rejects.toThrow(/[Kk]orrupte|Ungültige/);
  });

  it('HIGH 2: two PARALLEL loads on the same empty dataDir converge to ONE PeerID (no overwrite race)', async () => {
    const dir = mkTmp();
    const [a, b] = await Promise.all([
      loadOrCreateLibp2pPrivateKey(dir),
      loadOrCreateLibp2pPrivateKey(dir),
    ]);
    // Both must end up with the SAME identity (not two divergent keys).
    expect(a.peerId).toBe(b.peerId);
    // Exactly one actually generated; the other loaded the winner's key.
    expect([a.generated, b.generated].filter(Boolean).length).toBe(1);
    // A subsequent (restart) load is stable too.
    const c = await loadOrCreateLibp2pPrivateKey(dir);
    expect(c.generated).toBe(false);
    expect(c.peerId).toBe(a.peerId);
  });
});
