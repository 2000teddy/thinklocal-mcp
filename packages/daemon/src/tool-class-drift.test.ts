// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * tool-class-drift.test.ts — ADR-042 (TL-08 Slice 2c). Deckt den live Drift-Check-Seam: konsistent
 * (info, kein warn), Drift (stale/unclassified → warn), ungoverned → null, Fetch-Fehler → null + warn.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkToolClassDrift, type DriftLogger } from './tool-class-drift.js';
import unifiFixture from './fixtures/unifi-tools-2026-07-15.json' with { type: 'json' };

function fakeLog(): DriftLogger & { warns: unknown[]; infos: unknown[] } {
  const warns: unknown[] = [];
  const infos: unknown[] = [];
  return {
    warns,
    infos,
    warn: ((obj: unknown) => warns.push(obj)) as DriftLogger['warn'],
    info: ((obj: unknown) => infos.push(obj)) as DriftLogger['info'],
  };
}

const FULL = unifiFixture as string[];

describe('checkToolClassDrift (ADR-042)', () => {
  it('konsistent (volles Inventar) → kein Drift, info geloggt, KEIN warn', async () => {
    const log = fakeLog();
    const drift = await checkToolClassDrift('unifi', async () => FULL, log);
    expect(drift).not.toBeNull();
    expect(drift?.staleReadOnly).toEqual([]);
    expect(drift?.unclassified).toEqual([]);
    expect(log.warns).toHaveLength(0);
    expect(log.infos).toHaveLength(1);
  });

  it('Drift: entferntes readOnly-Tool → staleReadOnly + warn', async () => {
    const log = fakeLog();
    const drift = await checkToolClassDrift('unifi', async () => FULL.filter((t) => t !== 'list_clients'), log);
    expect(drift?.staleReadOnly).toContain('list_clients');
    expect(log.warns).toHaveLength(1);
  });

  it('Drift: neues unklassifiziertes Read-Tool → unclassified + warn', async () => {
    const log = fakeLog();
    const drift = await checkToolClassDrift('unifi', async () => [...FULL, 'list_newthing'], log);
    expect(drift?.unclassified).toEqual(['list_newthing']);
    expect(log.warns).toHaveLength(1);
  });

  it('ungoverned Server (pal) → null (nichts zu prüfen)', async () => {
    const log = fakeLog();
    const fetch = vi.fn(async () => ['chat', 'list_models']);
    expect(await checkToolClassDrift('pal', fetch, log)).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); // gar nicht erst gefetcht
  });

  it('Kanonisierung: UNIFI (uppercase) wird als governed erkannt', async () => {
    const drift = await checkToolClassDrift('UNIFI', async () => FULL);
    expect(drift).not.toBeNull();
  });

  it('Fetch-Fehler → null + warn (fail-safe, kein Crash)', async () => {
    const log = fakeLog();
    const drift = await checkToolClassDrift('unifi', async () => {
      throw new Error('mesh unreachable');
    }, log);
    expect(drift).toBeNull();
    expect(log.warns).toHaveLength(1);
  });
});
