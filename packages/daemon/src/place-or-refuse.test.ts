/**
 * T2.4 — Tests für Resource-Attribute + place-or-refuse.
 *
 *  - computeRamUsedPercent: cache-bewusst (available, nicht used) — sonst zählt
 *    Linux-Page-Cache als belegt und ein gesunder Knoten lehnt alles ab.
 *  - evaluatePlacement: strikte `>`-Schwelle.
 *  - TaskExecutor-Gate: bei RAM > Schwelle wird VOR dem Skill-Check abgelehnt
 *    (reason='capacity'); unterhalb fällt es normal durch.
 *  - Registry-Side-Map: setNodeResources/getNodeResources (non-repliziert).
 *  - config: placement-Defaults/Env/Range-Validierung.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import {
  computeRamUsedPercent,
  evaluatePlacement,
} from './resource-metrics.js';
import { CapabilityRegistry } from './registry.js';
import { TaskExecutor } from './task-executor.js';
import { TaskManager } from './tasks.js';
import { SkillManager } from './skills.js';
import { AuditLog } from './audit.js';
import { MeshEventBus } from './events.js';
import { loadConfig } from './config.js';

const NO_TOML = '/nonexistent/thinklocal-t24-test.toml';
function makeKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

describe('computeRamUsedPercent (cache-bewusst)', () => {
  it('rechnet mit available, nicht mit used', () => {
    // 16 GB total, 8 GB available (cache-bereinigt) → 50 %.
    expect(computeRamUsedPercent(16e9, 8e9)).toBeCloseTo(50, 5);
  });
  it('clamped/robust: total<=0 → 0; available>total → 0', () => {
    expect(computeRamUsedPercent(0, 0)).toBe(0);
    expect(computeRamUsedPercent(-1, 5)).toBe(0);
    expect(computeRamUsedPercent(8e9, 9e9)).toBe(0); // negativer used → 0
  });
  it('voll belegt → 100', () => {
    expect(computeRamUsedPercent(16e9, 0)).toBe(100);
  });
});

describe('evaluatePlacement (strikte > Schwelle)', () => {
  it.each([
    [89.9, 90, false],
    [90, 90, false], // genau == → akzeptieren
    [90.1, 90, true],
    [99.9, 90, true],
  ])('used=%s thr=%s → refuse=%s', (used, thr, refuse) => {
    const d = evaluatePlacement(used as number, thr as number);
    expect(d.refuse).toBe(refuse);
    if (refuse) expect(d.reason).toBe('capacity');
  });
});

describe('TaskExecutor place-or-refuse gate', () => {
  let dir: string;
  let registry: CapabilityRegistry;
  let audit: AuditLog;

  function buildExecutor(ramUsedPercent: number): TaskExecutor {
    registry = new CapabilityRegistry();
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
    const skills = new SkillManager(dir, 'agent', registry);
    const tasks = new TaskManager();
    const eventBus = new MeshEventBus();
    return new TaskExecutor({
      tasks,
      skills,
      audit,
      eventBus,
      agentId: 'agent',
      getRamUsedPercent: async () => ramUsedPercent,
      refuseRamPercent: 90,
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-t24-'));
  });
  afterEach(() => {
    audit?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('RAM > Schwelle → abgelehnt mit reason=capacity (vor dem Skill-Check)', async () => {
    const exec = buildExecutor(95);
    const r = await exec.handleTaskRequest('t1', 'irgendein.skill', {}, 'remote');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('capacity');
    expect(r.error).toMatch(/überlastet|RAM/);
  });

  it('RAM unter Schwelle → Gate inert, normaler Pfad (hier: Skill nicht vorhanden)', async () => {
    const exec = buildExecutor(40);
    const r = await exec.handleTaskRequest('t2', 'does.not.exist', {}, 'remote');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBeUndefined(); // NICHT capacity → echtes 404/Skill-fehlt
    expect(r.error).toMatch(/nicht verfuegbar/);
  });

  it('RAM-Messung wirft → FAIL-OPEN: keine Capacity-Ablehnung (normaler Pfad)', async () => {
    registry = new CapabilityRegistry();
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
    const exec = new TaskExecutor({
      tasks: new TaskManager(),
      skills: new SkillManager(dir, 'agent', registry),
      audit,
      eventBus: new MeshEventBus(),
      agentId: 'agent',
      getRamUsedPercent: async () => {
        throw new Error('si.mem boom');
      },
      refuseRamPercent: 90,
    });
    const r = await exec.handleTaskRequest('t3', 'does.not.exist', {}, 'remote');
    // Mess-Fehler darf NICHT als Kapazitäts-Ablehnung erscheinen → fail-open.
    expect(r.reason).toBeUndefined();
    expect(r.error).toMatch(/nicht verfuegbar/);
  });
});

describe('CapabilityRegistry node-resources side-map (T2.4)', () => {
  it('setNodeResources/getNodeResources speichert + liefert zurück', () => {
    const reg = new CapabilityRegistry();
    const uri = 'spiffe://thinklocal/node/12D3KooWX';
    expect(reg.getNodeResources(uri)).toBeUndefined();
    reg.setNodeResources(uri, {
      free_ram_bytes: 8e9,
      ram_used_percent: 50,
      cpu_load: 12.3,
      agent_count: 4,
    });
    const r = reg.getNodeResources(uri);
    expect(r).toBeDefined();
    expect(r?.free_ram_bytes).toBe(8e9);
    expect(r?.cpu_load).toBe(12.3);
    expect(r?.agent_count).toBe(4);
    expect(typeof r?.updated_at).toBe('string');
    expect(reg.getAllNodeResources()[uri]).toBeDefined();
  });
});

describe('config — T2.4 placement section', () => {
  const KEYS = ['TLMCP_PLACE_REFUSE_RAM_PERCENT', 'TLMCP_RESOURCE_REFRESH_INTERVAL_MS'];
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

  it('Defaults: refuse_ram_percent=90, refresh=15s', () => {
    withEnv({}, () => {
      const cfg = loadConfig(NO_TOML);
      expect(cfg.placement.refuse_ram_percent).toBe(90);
      expect(cfg.placement.resource_refresh_interval_ms).toBe(15_000);
    });
  });

  it('Env-Override greift', () => {
    withEnv({ TLMCP_PLACE_REFUSE_RAM_PERCENT: '85' }, () => {
      expect(loadConfig(NO_TOML).placement.refuse_ram_percent).toBe(85);
    });
  });

  it('lehnt Schwelle außerhalb 1..100 ab', () => {
    withEnv({ TLMCP_PLACE_REFUSE_RAM_PERCENT: '150' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow(/refuse_ram_percent/);
    });
  });
});
