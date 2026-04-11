/**
 * config-rollback.test.ts — Tests fuer Config Rollback (Phase D3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigRollback } from './config-rollback.js';
import { ConfigRevisions } from './config-revisions.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ConfigRollback', () => {
  let dataDir: string;
  let store: ConfigRevisions;
  let rollback: ConfigRollback;
  let configPath: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rollback-test-'));
    store = new ConfigRevisions(dataDir);
    configPath = join(dataDir, 'daemon.toml');

    // Write initial config as JSON
    writeFileSync(configPath, JSON.stringify({ port: 9440, mode: 'lan' }));
    rollback = new ConfigRollback(store, configPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists empty revisions initially', () => {
    expect(rollback.listRevisions()).toEqual([]);
  });

  it('rollbackLast returns error when no revisions', () => {
    const result = rollback.rollbackLast();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('No revisions');
  });

  it('rollbackTo returns error for non-existent revision', () => {
    const result = rollback.rollbackTo(999);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('rolls back to a previous revision', () => {
    const before = { port: 9440, mode: 'lan' };
    const after = { port: 9441, mode: 'federated' };

    // Simulate a config change (record takes DaemonConfig objects)
    store.record(before, after, 'manual');
    writeFileSync(configPath, JSON.stringify(after));

    // Rollback to revision 1 (restores the "before" state)
    const result = rollback.rollbackTo(1);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Rolled back');

    // Config file should be restored to the "before" JSON
    const restored = readFileSync(configPath, 'utf-8');
    expect(JSON.parse(restored)).toEqual(before);
  });

  it('rollbackLast undoes the most recent change', () => {
    const v1 = { version: 1 };
    const v2 = { version: 2 };
    const v3 = { version: 3 };

    store.record(v1, v2, 'manual');
    store.record(v2, v3, 'manual');
    writeFileSync(configPath, JSON.stringify(v3));

    // Rollback last change (v3 → v2)
    const result = rollback.rollbackLast();
    expect(result.ok).toBe(true);

    const restored = readFileSync(configPath, 'utf-8');
    expect(JSON.parse(restored)).toEqual(v2);
  });

  it('records rollback as a new revision with source=rollback', () => {
    const v1 = { version: 1 };
    const v2 = { version: 2 };

    store.record(v1, v2, 'manual');
    writeFileSync(configPath, JSON.stringify(v2));

    rollback.rollbackTo(1);

    // There should now be 2 revisions: the original change + the rollback
    const revisions = rollback.listRevisions();
    expect(revisions.length).toBe(2);
    expect(revisions[0].source).toBe('rollback');
  });

  it('getRevision returns a specific revision', () => {
    store.record({ a: 1 }, { a: 2 }, 'manual');
    const rev = rollback.getRevision(1);
    expect(rev).toBeDefined();
    expect(rev!.source).toBe('manual');
  });
});
