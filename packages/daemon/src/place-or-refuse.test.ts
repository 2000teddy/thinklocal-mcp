// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
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
  evaluatePlacementMetrics,
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

describe('evaluatePlacementMetrics (RAM + CPU + agent_count)', () => {
  it('CPU > Schwelle → refuse limit=cpu; == → accept; 0=deaktiviert → übersprungen', () => {
    expect(evaluatePlacementMetrics({ cpuLoad: 96 }, { refuseCpuPercent: 95 })).toMatchObject({
      refuse: true,
      reason: 'capacity',
      limit: 'cpu',
    });
    expect(evaluatePlacementMetrics({ cpuLoad: 95 }, { refuseCpuPercent: 95 }).refuse).toBe(false);
    // 0 = deaktiviert: selbst hohe Last refused nicht
    expect(evaluatePlacementMetrics({ cpuLoad: 99 }, { refuseCpuPercent: 0 }).refuse).toBe(false);
  });

  it('agent_count > Schwelle → refuse limit=agents; == → accept', () => {
    expect(evaluatePlacementMetrics({ agentCount: 21 }, { refuseAgentCount: 20 })).toMatchObject({
      refuse: true,
      limit: 'agents',
    });
    expect(evaluatePlacementMetrics({ agentCount: 20 }, { refuseAgentCount: 20 }).refuse).toBe(false);
    expect(evaluatePlacementMetrics({ agentCount: 999 }, { refuseAgentCount: 0 }).refuse).toBe(false);
  });

  it('Priorität RAM → CPU → agents (RAM gewinnt, wenn mehrere überschritten)', () => {
    const d = evaluatePlacementMetrics(
      { ramUsedPercent: 95, cpuLoad: 99, agentCount: 99 },
      { refuseRamPercent: 90, refuseCpuPercent: 95, refuseAgentCount: 20 },
    );
    expect(d).toMatchObject({ refuse: true, limit: 'ram' });
  });

  it('null/undefined-Dimension wird übersprungen (fail-open pro Dimension)', () => {
    // RAM nicht gemessen (null), aber CPU überschritten → CPU greift
    const d = evaluatePlacementMetrics(
      { ramUsedPercent: null, cpuLoad: 99 },
      { refuseRamPercent: 90, refuseCpuPercent: 95 },
    );
    expect(d).toMatchObject({ refuse: true, limit: 'cpu' });
    // keine Dimension überschritten → accept
    expect(evaluatePlacementMetrics({ ramUsedPercent: null, cpuLoad: null, agentCount: null }, {
      refuseRamPercent: 90,
      refuseCpuPercent: 95,
      refuseAgentCount: 20,
    }).refuse).toBe(false);
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

  /** Executor mit allen drei Dimensionen (CPU/agent_count opt-in). RAM unter Schwelle (40). */
  function buildExecutorMulti(opts: {
    cpuLoad?: number | null;
    refuseCpuPercent?: number;
    agentCount?: number;
    refuseAgentCount?: number;
  }): TaskExecutor {
    registry = new CapabilityRegistry();
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
    return new TaskExecutor({
      tasks: new TaskManager(),
      skills: new SkillManager(dir, 'agent', registry),
      audit,
      eventBus: new MeshEventBus(),
      agentId: 'agent',
      getRamUsedPercent: async () => 40, // RAM unauffällig
      refuseRamPercent: 90,
      getCpuLoad: () => opts.cpuLoad ?? null,
      refuseCpuPercent: opts.refuseCpuPercent ?? 0,
      getAgentCount: () => opts.agentCount ?? 0,
      refuseAgentCount: opts.refuseAgentCount ?? 0,
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

  it('CPU > Schwelle (RAM ok) → abgelehnt mit reason=capacity, error nennt CPU', async () => {
    const exec = buildExecutorMulti({ cpuLoad: 97, refuseCpuPercent: 95 });
    const r = await exec.handleTaskRequest('t4', 'irgendein.skill', {}, 'remote');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('capacity');
    expect(r.error).toMatch(/CPU/);
  });

  it('agent_count > Schwelle (RAM ok) → abgelehnt mit reason=capacity, error nennt agent_count', async () => {
    const exec = buildExecutorMulti({ agentCount: 25, refuseAgentCount: 20 });
    const r = await exec.handleTaskRequest('t5', 'irgendein.skill', {}, 'remote');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('capacity');
    expect(r.error).toMatch(/agent_count/);
  });

  it('CPU/agent_count deaktiviert (Schwelle 0) → Gate inert trotz hoher Werte', async () => {
    const exec = buildExecutorMulti({ cpuLoad: 99, refuseCpuPercent: 0, agentCount: 999, refuseAgentCount: 0 });
    const r = await exec.handleTaskRequest('t6', 'does.not.exist', {}, 'remote');
    expect(r.reason).toBeUndefined(); // keine Capacity-Ablehnung → normaler Skill-fehlt-Pfad
    expect(r.error).toMatch(/nicht verfuegbar/);
  });

  it('CPU unbekannt (Reader liefert null) → CPU-Dimension übersprungen, kein Refuse', async () => {
    const exec = buildExecutorMulti({ cpuLoad: null, refuseCpuPercent: 95 });
    const r = await exec.handleTaskRequest('t7', 'does.not.exist', {}, 'remote');
    expect(r.reason).toBeUndefined();
  });

  it('RAM-Reader WIRFT, aber CPU > Schwelle → RAM übersprungen, CPU greift (per-Dimension fail-open)', async () => {
    registry = new CapabilityRegistry();
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
    const exec = new TaskExecutor({
      tasks: new TaskManager(),
      skills: new SkillManager(dir, 'agent', registry),
      audit,
      eventBus: new MeshEventBus(),
      agentId: 'agent',
      getRamUsedPercent: async () => {
        throw new Error('si.mem flaky');
      },
      refuseRamPercent: 90,
      getCpuLoad: () => 98,
      refuseCpuPercent: 95,
    });
    const r = await exec.handleTaskRequest('t8', 'irgendein.skill', {}, 'remote');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('capacity');
    expect(r.error).toMatch(/CPU/); // RAM-Dimension übersprungen, CPU löst aus
  });

  it('CPU-Reader WIRFT → CPU-Dimension übersprungen (kein Crash, kein Refuse)', async () => {
    registry = new CapabilityRegistry();
    audit = new AuditLog(dir, makeKey(), 'spiffe://test/host/x/agent/y');
    const exec = new TaskExecutor({
      tasks: new TaskManager(),
      skills: new SkillManager(dir, 'agent', registry),
      audit,
      eventBus: new MeshEventBus(),
      agentId: 'agent',
      getRamUsedPercent: async () => 40,
      refuseRamPercent: 90,
      getCpuLoad: () => {
        throw new Error('side-map boom');
      },
      refuseCpuPercent: 95,
    });
    const r = await exec.handleTaskRequest('t9', 'does.not.exist', {}, 'remote');
    expect(r.reason).toBeUndefined(); // Reader-Crash darf Request nicht crashen/ablehnen
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
  const KEYS = [
    'TLMCP_PLACE_REFUSE_RAM_PERCENT',
    'TLMCP_RESOURCE_REFRESH_INTERVAL_MS',
    'TLMCP_PLACE_REFUSE_CPU_PERCENT',
    'TLMCP_PLACE_REFUSE_AGENT_COUNT',
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

  it('Defaults: refuse_ram_percent=90, refresh=15s, CPU/agent_count=0 (aus)', () => {
    withEnv({}, () => {
      const cfg = loadConfig(NO_TOML);
      expect(cfg.placement.refuse_ram_percent).toBe(90);
      expect(cfg.placement.resource_refresh_interval_ms).toBe(15_000);
      expect(cfg.placement.refuse_cpu_percent).toBe(0);
      expect(cfg.placement.refuse_agent_count).toBe(0);
    });
  });

  it('Env-Override greift (RAM/CPU/agent_count)', () => {
    withEnv(
      {
        TLMCP_PLACE_REFUSE_RAM_PERCENT: '85',
        TLMCP_PLACE_REFUSE_CPU_PERCENT: '95',
        TLMCP_PLACE_REFUSE_AGENT_COUNT: '32',
      },
      () => {
        const cfg = loadConfig(NO_TOML);
        expect(cfg.placement.refuse_ram_percent).toBe(85);
        expect(cfg.placement.refuse_cpu_percent).toBe(95);
        expect(cfg.placement.refuse_agent_count).toBe(32);
      },
    );
  });

  it('CPU-Schwelle außerhalb 0..100 wird abgelehnt', () => {
    withEnv({ TLMCP_PLACE_REFUSE_CPU_PERCENT: '150' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow(/refuse_cpu_percent/);
    });
  });

  it('lehnt Schwelle außerhalb 1..100 ab', () => {
    withEnv({ TLMCP_PLACE_REFUSE_RAM_PERCENT: '150' }, () => {
      expect(() => loadConfig(NO_TOML)).toThrow(/refuse_ram_percent/);
    });
  });
});
