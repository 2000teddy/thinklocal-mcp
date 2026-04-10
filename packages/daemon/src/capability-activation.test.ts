/**
 * ADR-008 Phase B PR B3 — Capability Activation State tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityActivationStore } from './capability-activation.js';

const PEER = 'spiffe://thinklocal/host/abc/agent/claude-code';

describe('CapabilityActivationStore', () => {
  let dir: string;
  let store: CapabilityActivationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-cap-'));
    store = new CapabilityActivationStore(dir);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('discover()', () => {
    it('creates a new entry in discovered state', () => {
      const id = store.discover('influxdb.query', '1.0.0', PEER, 'hash-abc');
      expect(id).toBeGreaterThan(0);
      const row = store.get('influxdb.query', PEER)!;
      expect(row.state).toBe('discovered');
      expect(row.version).toBe('1.0.0');
      expect(row.manifest_hash).toBe('hash-abc');
    });

    it('updates version+hash on re-discovery (drift detection)', () => {
      store.discover('influxdb.query', '1.0.0', PEER, 'hash-1');
      store.discover('influxdb.query', '2.0.0', PEER, 'hash-2');
      const row = store.get('influxdb.query', PEER)!;
      expect(row.version).toBe('2.0.0');
      expect(row.manifest_hash).toBe('hash-2');
    });
  });

  describe('state transitions', () => {
    it('discovered → active', () => {
      store.discover('cap-a', '1.0', PEER);
      expect(store.activate('cap-a', PEER)).toBe(true);
      expect(store.get('cap-a', PEER)!.state).toBe('active');
      expect(store.get('cap-a', PEER)!.activated_at).not.toBeNull();
    });

    it('active → suspended', () => {
      store.discover('cap-a', '1.0', PEER);
      store.activate('cap-a', PEER);
      expect(store.suspend('cap-a', PEER, 'maintenance')).toBe(true);
      const row = store.get('cap-a', PEER)!;
      expect(row.state).toBe('suspended');
      expect(row.suspended_at).not.toBeNull();
      expect(JSON.parse(row.metadata_json!).suspend_reason).toBe('maintenance');
    });

    it('suspended → active (reactivation)', () => {
      store.discover('cap-a', '1.0', PEER);
      store.activate('cap-a', PEER);
      store.suspend('cap-a', PEER);
      expect(store.activate('cap-a', PEER)).toBe(true);
      expect(store.get('cap-a', PEER)!.state).toBe('active');
    });

    it('any non-revoked → revoked', () => {
      store.discover('cap-a', '1.0', PEER);
      expect(store.revoke('cap-a', PEER, 'compromised')).toBe(true);
      expect(store.get('cap-a', PEER)!.state).toBe('revoked');
    });

    it('revoked → revoked is a no-op', () => {
      store.discover('cap-a', '1.0', PEER);
      store.revoke('cap-a', PEER);
      expect(store.revoke('cap-a', PEER)).toBe(false);
    });

    it('revoked cannot be activated', () => {
      store.discover('cap-a', '1.0', PEER);
      store.revoke('cap-a', PEER);
      expect(store.activate('cap-a', PEER)).toBe(false);
      expect(store.get('cap-a', PEER)!.state).toBe('revoked');
    });

    it('discovered cannot be suspended (must activate first)', () => {
      store.discover('cap-a', '1.0', PEER);
      expect(store.suspend('cap-a', PEER)).toBe(false);
    });
  });

  describe('queries', () => {
    beforeEach(() => {
      store.discover('cap-a', '1.0', PEER);
      store.activate('cap-a', PEER);
      store.discover('cap-b', '1.0', PEER);
      store.discover('cap-c', '1.0', PEER);
      store.activate('cap-c', PEER);
      store.suspend('cap-c', PEER);
    });

    it('listActive returns only active capabilities', () => {
      const active = store.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]!.capability_id).toBe('cap-a');
    });

    it('listByState returns correct counts', () => {
      expect(store.listByState('discovered')).toHaveLength(1);
      expect(store.listByState('active')).toHaveLength(1);
      expect(store.listByState('suspended')).toHaveLength(1);
    });

    it('countByState aggregates correctly', () => {
      const counts = store.countByState();
      expect(counts.discovered).toBe(1);
      expect(counts.active).toBe(1);
      expect(counts.suspended).toBe(1);
      expect(counts.revoked).toBe(0);
    });

    it('isActive is the execution gate', () => {
      expect(store.isActive('cap-a', PEER)).toBe(true);
      expect(store.isActive('cap-b', PEER)).toBe(false);
      expect(store.isActive('cap-c', PEER)).toBe(false);
      expect(store.isActive('nonexistent', PEER)).toBe(false);
    });
  });

  describe('persistence', () => {
    it('survives re-opens', () => {
      store.discover('cap-a', '1.0', PEER);
      store.activate('cap-a', PEER);
      store.close();
      const store2 = new CapabilityActivationStore(dir);
      expect(store2.isActive('cap-a', PEER)).toBe(true);
      store2.close();
    });
  });
});
