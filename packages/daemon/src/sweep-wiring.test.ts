// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * sweep-wiring.test.ts — TL-11 Reconciliation-Sweep, Verdrahtung.
 *
 * Kernfrage: schließt der Sweep die Reconnect-Lücke, **ohne** den regulären Wake-Pfad zu stören und
 * **ohne** den Daemon gefährden zu können?
 */
import { describe, it, expect, vi } from 'vitest';
import {
  registerReconciliationSweep,
  runReconciliationSweep,
  sweepInstance,
  type SweepDeps,
} from './sweep-wiring.js';
import { WakeCoalescer } from './wake-contract.js';
import { AgentRegistry } from './agent-registry.js';

const A = { instanceId: 'a', spiffeUri: 'spiffe://thinklocal/node/AAA' };
const B = { instanceId: 'b', spiffeUri: 'spiffe://thinklocal/node/BBB' };

/** Sammelt emittierte Events. */
function busSpy(): { bus: SweepDeps['eventBus']; emitted: Array<Record<string, unknown>> } {
  const emitted: Array<Record<string, unknown>> = [];
  return {
    emitted,
    bus: {
      on: () => {},
      emit: (_type, data) => {
        emitted.push(data);
      },
    } as unknown as SweepDeps['eventBus'],
  };
}

/** Minimale Registry-Attrappe mit steuerbarem Listener. */
function fakeRegistry(live: Array<{ instanceId: string; spiffeUri: string }>): {
  registry: SweepDeps['registry'];
  fire: (reason: 'register' | 'unregister' | 'stale', instanceId?: string) => void;
  unsubscribed: () => boolean;
} {
  let listener:
    | ((r: 'register' | 'unregister' | 'stale', e: { instanceId: string }) => void)
    | null = null;
  let off = false;
  return {
    registry: {
      on: (l) => {
        listener = l;
        return () => {
          off = true;
        };
      },
      list: () => live,
    },
    fire: (reason, instanceId = 'a') => listener?.(reason, { instanceId }),
    unsubscribed: () => off,
  };
}

function deps(over: Partial<SweepDeps> = {}): SweepDeps {
  const { bus } = busSpy();
  return {
    registry: fakeRegistry([A]).registry,
    eventBus: bus,
    unreadFor: () => 0,
    now: () => 1_000,
    ...over,
  };
}

describe('runReconciliationSweep — weckt genau die Instanzen mit ungelesener Post', () => {
  it('Instanz mit Post ⇒ ein gerichtetes agent:wake mit SPIFFE', () => {
    const { bus, emitted } = busSpy();
    const run = runReconciliationSweep(
      deps({
        registry: fakeRegistry([A, B]).registry,
        eventBus: bus,
        unreadFor: (id) => (id === 'a' ? 2 : 0),
      }),
      new WakeCoalescer(),
      'test',
    );

    expect(run).toEqual({ candidates: 1, woken: ['a'] });
    expect(emitted).toEqual([{ instance_id: 'a', spiffe_uri: A.spiffeUri, reason: 'inbox' }]);
  });

  it('niemand hat Post ⇒ kein Wake', () => {
    const { bus, emitted } = busSpy();
    const run = runReconciliationSweep(
      deps({ registry: fakeRegistry([A, B]).registry, eventBus: bus }),
      new WakeCoalescer(),
      'test',
    );

    expect(run).toEqual({ candidates: 0, woken: [] });
    expect(emitted).toEqual([]);
  });

  it('Instanz ohne routbare SPIFFE wird nicht geweckt (fail-closed, #322)', () => {
    const { bus, emitted } = busSpy();
    const noSpiffe = { instanceId: 'c', spiffeUri: '' };

    runReconciliationSweep(
      deps({ registry: fakeRegistry([noSpiffe]).registry, eventBus: bus, unreadFor: () => 5 }),
      new WakeCoalescer(),
      'test',
    );

    expect(emitted).toEqual([]);
  });

  it('das Wake ist inhaltsfrei — keine Nachrichtendaten reisen mit', () => {
    const { bus, emitted } = busSpy();
    runReconciliationSweep(
      deps({ registry: fakeRegistry([A]).registry, eventBus: bus, unreadFor: () => 7 }),
      new WakeCoalescer(),
      'test',
    );

    // Insbesondere NICHT die Anzahl ungelesener Nachrichten (das wäre Metadaten-Leak).
    expect(Object.keys(emitted[0] ?? {}).sort()).toEqual(['instance_id', 'reason', 'spiffe_uri']);
    expect(JSON.stringify(emitted)).not.toContain('7');
  });
});

describe('runReconciliationSweep — eigener Coalescer (ADR-047 §3 Option 1)', () => {
  it('zwei Sweeps im selben Fenster ⇒ nur ein Wake', () => {
    const { bus, emitted } = busSpy();
    const d = deps({ registry: fakeRegistry([A]).registry, eventBus: bus, unreadFor: () => 1 });
    const coalescer = new WakeCoalescer();

    runReconciliationSweep(d, coalescer, 'test');
    runReconciliationSweep(d, coalescer, 'test');

    expect(emitted).toHaveLength(1);
  });

  it('nach Ablauf des Fensters weckt der nächste Sweep wieder', () => {
    const { bus, emitted } = busSpy();
    let nowMs = 1_000;
    const d = deps({
      registry: fakeRegistry([A]).registry,
      eventBus: bus,
      unreadFor: () => 1,
      now: () => nowMs,
    });
    const coalescer = new WakeCoalescer(100);

    runReconciliationSweep(d, coalescer, 'test');
    nowMs += 500;
    runReconciliationSweep(d, coalescer, 'test');

    expect(emitted).toHaveLength(2);
  });

  it('der Sweep-Coalescer ist vom Emitter-Coalescer getrennt — Inbox-Verkehr schluckt ihn nicht', () => {
    const { bus, emitted } = busSpy();
    const d = deps({ registry: fakeRegistry([A]).registry, eventBus: bus, unreadFor: () => 1 });

    // Der Emitter hat dieselbe Instanz gerade geweckt — sein Coalescer ist „belegt".
    const emitterCoalescer = new WakeCoalescer();
    expect(emitterCoalescer.shouldWake('a', 1_000)).toBe(true);

    // Der Sweep benutzt SEINEN eigenen und wird davon nicht unterdrückt. Genau das verhindert,
    // dass der Sweep im Reconnect-Fenster verpufft, das er beheben soll.
    runReconciliationSweep(d, new WakeCoalescer(), 'test');

    expect(emitted).toHaveLength(1);
  });
});

describe('runReconciliationSweep — fail-safe: nichts darf den Daemon treffen', () => {
  it('werfende Registry ⇒ Sweep übersprungen, kein Wurf', () => {
    const { bus, emitted } = busSpy();
    const registry = {
      on: (): (() => void) => () => {},
      list: (): never => {
        throw new Error('registry kaputt');
      },
    };
    const warn = vi.fn();

    const run = runReconciliationSweep(
      deps({ registry, eventBus: bus, log: { info: vi.fn(), warn } }),
      new WakeCoalescer(),
      'test',
    );

    expect(run).toEqual({ candidates: 0, woken: [] });
    expect(emitted).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('werfender Bus ⇒ die übrigen Instanzen bekommen ihr Wake trotzdem', () => {
    const emitted: string[] = [];
    const bus = {
      on: () => {},
      emit: (_t: string, data: Record<string, unknown>) => {
        if (data['instance_id'] === 'a') throw new Error('bus kaputt');
        emitted.push(String(data['instance_id']));
      },
    } as unknown as SweepDeps['eventBus'];

    const run = runReconciliationSweep(
      deps({
        registry: fakeRegistry([A, B]).registry,
        eventBus: bus,
        unreadFor: () => 1,
        log: { info: vi.fn(), warn: vi.fn() },
      }),
      new WakeCoalescer(),
      'test',
    );

    expect(emitted).toEqual(['b']);
    expect(run.woken).toEqual(['b']); // 'a' scheiterte und wird NICHT als geweckt gemeldet
  });

  it('werfender Zähler ⇒ diese Instanz entfällt, wirft nicht', () => {
    const { bus, emitted } = busSpy();

    expect(() =>
      runReconciliationSweep(
        deps({
          registry: fakeRegistry([A, B]).registry,
          eventBus: bus,
          unreadFor: (id) => {
            if (id === 'a') throw new Error('db kaputt');
            return 3;
          },
        }),
        new WakeCoalescer(),
        'test',
      ),
    ).not.toThrow();

    expect(emitted.map((e) => e['instance_id'])).toEqual(['b']);
  });
});

describe('registerReconciliationSweep — Auslöser', () => {
  it('nur `register` löst aus, nicht `unregister`/`stale`', () => {
    const { bus, emitted } = busSpy();
    const fake = fakeRegistry([A]);
    registerReconciliationSweep(
      deps({ registry: fake.registry, eventBus: bus, unreadFor: () => 1 }),
    );

    fake.fire('unregister');
    fake.fire('stale');
    expect(emitted).toEqual([]); // eine weggefallene Instanz zu wecken wäre sinnlos

    fake.fire('register');
    expect(emitted).toHaveLength(1);
  });

  it('gibt eine Abmelde-Funktion zurück (Shutdown)', () => {
    const fake = fakeRegistry([A]);
    const off = registerReconciliationSweep(deps({ registry: fake.registry }));

    expect(fake.unsubscribed()).toBe(false);
    off();
    expect(fake.unsubscribed()).toBe(true);
  });

  it('gegen die ECHTE AgentRegistry: eine Registrierung weckt eine Instanz mit Post', () => {
    const { bus, emitted } = busSpy();
    const registry = new AgentRegistry({ heartbeatIntervalMs: 10_000 });

    registerReconciliationSweep({
      registry: registry as unknown as SweepDeps['registry'],
      eventBus: bus,
      unreadFor: () => 1,
      now: () => 1_000,
    });

    registry.register({
      instanceId: 'a',
      agentType: 'claude-code',
      spiffeUri: A.spiffeUri,
      pid: 4242,
    });

    expect(emitted).toEqual([{ instance_id: 'a', spiffe_uri: A.spiffeUri, reason: 'inbox' }]);
  });
});

describe('sweepInstance / Hook — zielgerichtet statt flaechendeckend (CR-Fund agy, HIGH)', () => {
  it('fragt den Zaehler GENAU EINMAL — nicht einmal pro registrierter Instanz', () => {
    const { bus } = busSpy();
    const asked: string[] = [];
    const fake = fakeRegistry([
      A,
      B,
      { instanceId: 'c', spiffeUri: 'spiffe://thinklocal/node/CCC' },
    ]);

    registerReconciliationSweep(
      deps({
        registry: fake.registry,
        eventBus: bus,
        unreadFor: (id) => {
          asked.push(id);
          return 1;
        },
      }),
    );

    fake.fire('register', 'b');

    // Vorher wurde die ganze Registry gefegt (N Abfragen je Registrierung ⇒ M×N bei Massen-Reconnect).
    expect(asked).toEqual(['b']);
  });

  it('weckt genau die registrierende Instanz, nicht ihre Nachbarn', () => {
    const { bus, emitted } = busSpy();
    const fake = fakeRegistry([A, B]);

    registerReconciliationSweep(
      deps({ registry: fake.registry, eventBus: bus, unreadFor: () => 1 }),
    );
    fake.fire('register', 'b');

    expect(emitted).toEqual([{ instance_id: 'b', spiffe_uri: B.spiffeUri, reason: 'inbox' }]);
  });

  it('unbekannte Instanz-ID im Ereignis ⇒ kein Wake, kein Wurf', () => {
    const { bus, emitted } = busSpy();
    const fake = fakeRegistry([A]);

    registerReconciliationSweep(
      deps({ registry: fake.registry, eventBus: bus, unreadFor: () => 1 }),
    );

    expect(() => fake.fire('register', 'gibt-es-nicht')).not.toThrow();
    expect(emitted).toEqual([]);
  });

  it('sweepInstance: ohne Post kein Wake, ohne SPIFFE kein Wake', () => {
    const { bus, emitted } = busSpy();
    const noSpiffe = { instanceId: 'c', spiffeUri: '' };
    const d = deps({ registry: fakeRegistry([A, noSpiffe]).registry, eventBus: bus });

    sweepInstance({ ...d, unreadFor: () => 0 }, new WakeCoalescer(), 'a', 'test');
    sweepInstance({ ...d, unreadFor: () => 5 }, new WakeCoalescer(), 'c', 'test');

    expect(emitted).toEqual([]);
  });

  it('sweepInstance: werfende Registry ⇒ uebersprungen, kein Wurf', () => {
    const { bus } = busSpy();
    const registry = {
      on: (): (() => void) => () => {},
      list: (): never => {
        throw new Error('registry kaputt');
      },
    };

    const run = sweepInstance(
      deps({ registry, eventBus: bus, log: { info: vi.fn(), warn: vi.fn() } }),
      new WakeCoalescer(),
      'a',
      'test',
    );

    expect(run).toEqual({ candidates: 0, woken: [] });
  });
});
