/**
 * ADR-030 (T1.3) — Tests für SQLite WAL-Checkpoint + Retention.
 *
 * Deckt ab:
 *  - AuditLog.checkpoint() / prunePeerEventsOlderThan() (peer_audit_events),
 *    und dass die lokale signierte audit_events-Chain dabei UNANGETASTET bleibt.
 *  - CapabilityActivationStore.checkpoint() / pruneRevokedOlderThan().
 *  - config.ts: retention-Defaults + Env-Overrides (inkl. 0 = deaktiviert, Validierung).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import Database from 'better-sqlite3';
import { AuditLog } from './audit.js';
import { CapabilityActivationStore } from './capability-activation.js';
import { loadConfig } from './config.js';

const DAY_MS = 86_400_000;
const NO_TOML = '/nonexistent/thinklocal-retention-test.toml';

function makeKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

describe('AuditLog — ADR-030 checkpoint + retention', () => {
  let dir: string;
  let audit: AuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-retention-audit-'));
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
  });
  afterEach(() => {
    audit.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('checkpoint() läuft und lässt die Daten intakt', () => {
    audit.append('PEER_JOIN', 'peer-1', 'hello');
    audit.append('HEARTBEAT', 'peer-1', 'beat');
    const before = audit.count();
    const result = audit.checkpoint() as Array<{ busy: number; checkpointed: number }>;
    // busy===0 beweist, dass der Checkpoint tatsächlich lief (nicht von einer
    // anderen Verbindung blockiert) — sonst wäre das -wal nicht gekürzt worden.
    expect(result[0]?.busy).toBe(0);
    expect(audit.count()).toBe(before);
    expect(audit.getEvents(10).length).toBe(before);
  });

  it('prunePeerEventsOlderThan() löscht alte peer_audit_events, behält neue', () => {
    expect(
      audit.importPeerEvent({
        timestamp: isoDaysAgo(100),
        event_type: 'PEER_JOIN',
        agent_id: 'remote',
        signature: 'sig',
        entry_hash: 'hash-old',
      }),
    ).toBe(true);
    expect(
      audit.importPeerEvent({
        timestamp: isoDaysAgo(1),
        event_type: 'PEER_JOIN',
        agent_id: 'remote',
        signature: 'sig',
        entry_hash: 'hash-new',
      }),
    ).toBe(true);

    const deleted = audit.prunePeerEventsOlderThan(90 * DAY_MS);
    expect(deleted).toBe(1);

    // Re-Import beweist den Verbleib: neuer Hash existiert noch (→ false),
    // alter Hash wurde gelöscht (→ true, wird neu eingefügt).
    expect(audit.importPeerEvent({
      timestamp: isoDaysAgo(1), event_type: 'PEER_JOIN', agent_id: 'remote',
      signature: 'sig', entry_hash: 'hash-new',
    })).toBe(false);
    expect(audit.importPeerEvent({
      timestamp: isoDaysAgo(100), event_type: 'PEER_JOIN', agent_id: 'remote',
      signature: 'sig', entry_hash: 'hash-old',
    })).toBe(true);
  });

  it('Retention rührt die lokale signierte audit_events-Chain NICHT an', () => {
    audit.append('PEER_JOIN', 'peer-1', 'a');
    audit.append('HEARTBEAT', 'peer-1', 'b');
    audit.append('PEER_LEAVE', 'peer-1', 'c');
    const localBefore = audit.count();
    audit.importPeerEvent({
      timestamp: isoDaysAgo(100), event_type: 'PEER_JOIN', agent_id: 'remote',
      signature: 'sig', entry_hash: 'hash-old',
    });

    audit.prunePeerEventsOlderThan(1 * DAY_MS); // löscht den alten Peer-Event

    // Lokale Chain unverändert …
    expect(audit.count()).toBe(localBefore);
    // … und appendt nach dem Prune weiter sauber (Chain-Head intakt).
    audit.append('HEARTBEAT', 'peer-1', 'd');
    expect(audit.count()).toBe(localBefore + 1);
  });

  it('prunePeerEventsOlderThan(0) ist ein No-Op', () => {
    audit.importPeerEvent({
      timestamp: isoDaysAgo(100), event_type: 'PEER_JOIN', agent_id: 'remote',
      signature: 'sig', entry_hash: 'hash-old',
    });
    expect(audit.prunePeerEventsOlderThan(0)).toBe(0);
    expect(audit.prunePeerEventsOlderThan(-5)).toBe(0);
    // Beweis: alter Event noch da (Re-Import → false).
    expect(audit.importPeerEvent({
      timestamp: isoDaysAgo(100), event_type: 'PEER_JOIN', agent_id: 'remote',
      signature: 'sig', entry_hash: 'hash-old',
    })).toBe(false);
  });
});

describe('CapabilityActivationStore — ADR-030 checkpoint + retention', () => {
  let dir: string;
  let store: CapabilityActivationStore;
  const PEER = 'spiffe://thinklocal/host/abc/agent/claude-code';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-retention-cap-'));
    store = new CapabilityActivationStore(dir);
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('checkpoint() läuft und lässt die Daten intakt', () => {
    store.discover('skill.a', '1.0.0', PEER, 'hash-a');
    const result = store.checkpoint() as Array<{ busy: number }>;
    expect(result[0]?.busy).toBe(0);
    expect(store.get('skill.a', PEER)).not.toBeNull();
  });

  it('pruneRevokedOlderThan() löscht alte revoked-Zeilen, behält aktive/neue', () => {
    // Eine alte revoked, eine frisch revoked, eine aktive.
    store.discover('skill.old', '1.0.0', PEER, 'h1');
    store.revoke('skill.old', PEER, 'gone');
    store.discover('skill.recent', '1.0.0', PEER, 'h2');
    store.revoke('skill.recent', PEER, 'gone');
    store.discover('skill.active', '1.0.0', PEER, 'h3');
    store.activate('skill.active', PEER);

    // revoked_at von skill.old künstlich auf 100 Tage zurücksetzen (deterministisch).
    const dbPath = join(dir, 'capabilities', 'activation.db');
    const seed = new Database(dbPath);
    seed
      .prepare(
        `UPDATE capability_activations SET revoked_at = ? WHERE capability_id = 'skill.old'`,
      )
      .run(isoDaysAgo(100));
    seed.close();

    const deleted = store.pruneRevokedOlderThan(90 * DAY_MS);
    expect(deleted).toBe(1);
    expect(store.get('skill.old', PEER)).toBeNull(); // alt + revoked → weg
    expect(store.get('skill.recent', PEER)).not.toBeNull(); // frisch revoked → bleibt
    expect(store.get('skill.active', PEER)).not.toBeNull(); // aktiv → bleibt
  });

  it('pruneRevokedOlderThan(0) ist ein No-Op', () => {
    store.discover('skill.old', '1.0.0', PEER, 'h1');
    store.revoke('skill.old', PEER, 'gone');
    const dbPath = join(dir, 'capabilities', 'activation.db');
    const seed = new Database(dbPath);
    seed
      .prepare(`UPDATE capability_activations SET revoked_at = ? WHERE capability_id = 'skill.old'`)
      .run(isoDaysAgo(100));
    seed.close();
    expect(store.pruneRevokedOlderThan(0)).toBe(0);
    expect(store.get('skill.old', PEER)).not.toBeNull();
  });
});

describe('config — ADR-030 retention section', () => {
  const KEYS = [
    'TLMCP_RETENTION_CHECKPOINT_MS',
    'TLMCP_PEER_AUDIT_MAX_AGE_DAYS',
    'TLMCP_REVOKED_CAP_MAX_AGE_DAYS',
  ];
  function withEnv(overrides: Record<string, string>, fn: () => void): void {
    const saved = new Map<string, string | undefined>();
    for (const k of KEYS) saved.set(k, process.env[k]);
    try {
      for (const k of KEYS) Reflect.deleteProperty(process.env, k);
      for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
      fn();
    } finally {
      for (const k of KEYS) {
        const orig = saved.get(k);
        if (orig === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = orig;
      }
    }
  }

  it('liefert die Defaults', () => {
    withEnv({}, () => {
      const cfg = loadConfig(NO_TOML);
      expect(cfg.retention.checkpoint_interval_ms).toBe(3_600_000);
      expect(cfg.retention.peer_audit_max_age_days).toBe(90);
      expect(cfg.retention.revoked_capability_max_age_days).toBe(90);
    });
  });

  it('übernimmt Env-Overrides inkl. 0 (= deaktiviert)', () => {
    withEnv(
      {
        TLMCP_RETENTION_CHECKPOINT_MS: '60000',
        TLMCP_PEER_AUDIT_MAX_AGE_DAYS: '0',
        TLMCP_REVOKED_CAP_MAX_AGE_DAYS: '30',
      },
      () => {
        const cfg = loadConfig(NO_TOML);
        expect(cfg.retention.checkpoint_interval_ms).toBe(60000);
        expect(cfg.retention.peer_audit_max_age_days).toBe(0);
        expect(cfg.retention.revoked_capability_max_age_days).toBe(30);
      },
    );
  });

  it('lehnt ungültige Werte ab (negatives Alter, nicht-positives Intervall)', () => {
    withEnv({ TLMCP_PEER_AUDIT_MAX_AGE_DAYS: '-1' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow();
    });
    withEnv({ TLMCP_RETENTION_CHECKPOINT_MS: '0' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow();
    });
  });
});
