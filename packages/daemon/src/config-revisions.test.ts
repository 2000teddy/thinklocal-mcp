/**
 * ADR-007 Phase A PR A2 — Config-Revisions tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigRevisions, __test__ } from './config-revisions.js';
import type { DaemonConfig } from './config.js';

const { diffTopLevelKeys } = __test__;

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    daemon: {
      port: 9440,
      bind_host: '0.0.0.0',
      hostname: 'test',
      runtime_mode: 'lan',
      tls_enabled: true,
      agent_type: 'claude-code',
      data_dir: '/tmp/.thinklocal',
    },
    mesh: { heartbeat_interval_ms: 10000, heartbeat_timeout_missed: 3 },
    discovery: { mdns_service_type: '_thinklocal._tcp', static_peers: [] },
    libp2p: {
      enabled: true,
      listen_port: 9540,
      mdns_service_tag: 'thinklocal-mcp',
      nat_traversal_enabled: true,
      relay_transport_enabled: true,
      relay_service_enabled: false,
      announce_multiaddrs: [],
    },
    logging: { level: 'info' },
    ...overrides,
  } as DaemonConfig;
}

describe('diffTopLevelKeys', () => {
  it('returns [] for identical configs', () => {
    const a = makeConfig();
    expect(diffTopLevelKeys(a, structuredClone(a))).toEqual([]);
  });

  it('detects changed daemon section', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, port: 9441 } });
    expect(diffTopLevelKeys(a, b)).toEqual(['daemon']);
  });

  it('detects multiple changed sections', () => {
    const a = makeConfig();
    const b = makeConfig({
      daemon: { ...a.daemon, port: 9441 },
      logging: { level: 'debug' },
    });
    expect(diffTopLevelKeys(a, b)).toEqual(['daemon', 'logging']);
  });
});

describe('ConfigRevisions', () => {
  let dir: string;
  let revs: ConfigRevisions;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-config-rev-'));
    revs = new ConfigRevisions(dir);
  });

  afterEach(() => {
    revs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a config change and returns the revision id', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, port: 9441 } });
    const id = revs.record(a, b, 'manual', 'changed port');
    expect(id).toBeGreaterThan(0);
    expect(revs.count()).toBe(1);
  });

  it('skips recording when nothing changed', () => {
    const a = makeConfig();
    const id = revs.record(a, structuredClone(a), 'manual');
    expect(id).toBeNull();
    expect(revs.count()).toBe(0);
  });

  it('stores full before/after JSON snapshots', () => {
    const a = makeConfig();
    const b = makeConfig({ logging: { level: 'debug' } });
    const id = revs.record(a, b, 'env')!;
    const row = revs.get(id)!;
    expect(row.source).toBe('env');
    expect(row.changed_keys).toBe('logging');
    expect(JSON.parse(row.before_config).logging.level).toBe('info');
    expect(JSON.parse(row.after_config).logging.level).toBe('debug');
  });

  it('lists revisions newest first', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, port: 9441 } });
    const c = makeConfig({ logging: { level: 'debug' } });
    revs.record(a, b, 'manual', 'first');
    revs.record(b, c, 'mesh', 'second');
    const list = revs.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.note).toBe('second');
    expect(list[1]!.note).toBe('first');
  });

  it('records rollback source correctly', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, port: 9441 } });
    revs.record(a, b, 'manual');
    revs.record(b, a, 'rollback', 'reverting port change');
    const list = revs.list();
    expect(list[0]!.source).toBe('rollback');
    expect(list[0]!.changed_keys).toBe('daemon');
  });

  it('persists across re-opens', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, port: 9441 } });
    revs.record(a, b, 'manual');
    revs.close();
    const revs2 = new ConfigRevisions(dir);
    expect(revs2.count()).toBe(1);
    revs2.close();
  });

  it('handles the bootstrap source', () => {
    const a = makeConfig();
    const b = makeConfig({ daemon: { ...a.daemon, tls_enabled: false } });
    const id = revs.record(a, b, 'bootstrap')!;
    expect(revs.get(id)!.source).toBe('bootstrap');
  });
});
