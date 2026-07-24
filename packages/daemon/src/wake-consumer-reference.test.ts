// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wake-consumer-reference.test.ts — TL-11 konsumentenseitiger Wake-Kern.
 *
 * Bewacht die Garantien von `TL-11-wake-consumer-contract.md` aus **Konsumentensicht**: §4 Wire-Shape
 * (Payload unter `.data`, Top-Level-`reason` wird ignoriert), §4 Zero-Content/Toleranz, §3 Event-Typ-Filter,
 * §5 Cold-Start-Pflicht — und die Fail-safe-Zusage (wirft nie). Der Transport + `pokeCli()` bleiben bewusst
 * out-of-repo (Slice B) und sind hier NICHT Gegenstand.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretWakeFrame,
  coldStartSweepDecision,
  type WakeDecision,
} from './wake-consumer-reference.js';

const INSTANCE = 'claude-code-abc123';
const SPIFFE = 'spiffe://thinklocal/node/12D3KooTestPeerID';

/** Ein wohlgeformter `agent:wake`-Frame auf dem Draht (wie der Fanout ihn sendet, §4). */
function wakeFrame(data: Record<string, unknown>): Record<string, unknown> {
  return { type: 'agent:wake', timestamp: '2026-07-24T16:00:00.000Z', data };
}

function assertPoke(d: WakeDecision): asserts d is Extract<WakeDecision, { poke: true }> {
  expect(d.poke).toBe(true);
}
function assertNoPoke(d: WakeDecision): asserts d is Extract<WakeDecision, { poke: false }> {
  expect(d.poke).toBe(false);
}

describe('interpretWakeFrame — Positivpfad (§4)', () => {
  it('adressiertes agent:wake (Objekt) → poke mit instanceId/spiffeUri/reason aus .data', () => {
    const d = interpretWakeFrame(
      wakeFrame({ instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' }),
    );
    assertPoke(d);
    expect(d.trigger).toBe('wake');
    expect(d.reason).toBe('inbox');
    expect(d.instanceId).toBe(INSTANCE);
    expect(d.spiffeUri).toBe(SPIFFE);
  });

  it('akzeptiert denselben Frame auch als JSON-String (kein Doppel-Parse nötig)', () => {
    const d = interpretWakeFrame(
      JSON.stringify(wakeFrame({ instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox' })),
    );
    assertPoke(d);
    expect(d.instanceId).toBe(INSTANCE);
    expect(d.reason).toBe('inbox');
  });
});

describe('interpretWakeFrame — Wire-Shape-Guard (§4: Payload liegt unter .data)', () => {
  it('liest den Grund NICHT vom Top-Level: {type, reason:"TOPLEVEL", data:{}} → reason bleibt Default', () => {
    // Regression gegen die §6-Pseudocode-Fehlklasse (`ev.reason` statt `ev.data.reason`). Läse das Modul
    // top-level, käme hier 'TOPLEVEL' heraus.
    const d = interpretWakeFrame({ type: 'agent:wake', reason: 'TOPLEVEL', data: {} });
    assertPoke(d);
    expect(d.reason).toBe('inbox');
    expect(d.wireReason).toBeUndefined();
  });

  it('fehlendes .data → immer noch ein gültiges Wake (Zero-Content-Trigger), Default-Grund', () => {
    const d = interpretWakeFrame({ type: 'agent:wake', timestamp: 'x' });
    assertPoke(d);
    expect(d.reason).toBe('inbox');
    expect(d.wireReason).toBeUndefined();
    expect(d.instanceId).toBeUndefined();
    expect(d.spiffeUri).toBeUndefined();
  });

  it('.data ist ein Array (kein Objekt) → wie fehlendes .data behandelt', () => {
    const d = interpretWakeFrame({ type: 'agent:wake', data: ['nope'] });
    assertPoke(d);
    expect(d.reason).toBe('inbox');
  });
});

describe('interpretWakeFrame — Toleranz & Zero-Content (§4)', () => {
  it('unbekannter reason → trotzdem poke (tolerant), wireReason durchgereicht', () => {
    const d = interpretWakeFrame(wakeFrame({ instance_id: INSTANCE, reason: 'future-reason' }));
    assertPoke(d);
    expect(d.reason).toBe('future-reason');
    expect(d.wireReason).toBe('future-reason');
  });

  it('leerer reason-String → Default-Grund (nicht der leere String)', () => {
    const d = interpretWakeFrame(wakeFrame({ instance_id: INSTANCE, reason: '' }));
    assertPoke(d);
    expect(d.reason).toBe('inbox');
    expect(d.wireReason).toBeUndefined();
  });

  it('Zero-Content: etwaiger Nachrichteninhalt unter .data wird NICHT übernommen', () => {
    const d = interpretWakeFrame(
      wakeFrame({ instance_id: INSTANCE, spiffe_uri: SPIFFE, reason: 'inbox', message_id: 'm-1', body: 'secret' }),
    );
    assertPoke(d);
    // Die Decision trägt nur die drei erlaubten Felder + Trigger/Grund — kein message_id/body.
    const flat = JSON.stringify(d);
    expect(flat).not.toContain('m-1');
    expect(flat).not.toContain('secret');
  });
});

describe('interpretWakeFrame — Event-Typ-Filter (§3)', () => {
  it.each(['inbox:new', 'heartbeat', 'system:connected', 'system:subscribed'])(
    '%s → kein Poke (nur agent:wake pokt), observedType gesetzt',
    (type) => {
      const d = interpretWakeFrame({ type, data: { foo: 'bar' } });
      assertNoPoke(d);
      expect(d.ignore).toBe('not-a-wake-event');
      expect(d.observedType).toBe(type);
    },
  );

  it('Frame ohne type → kein Poke, kein observedType', () => {
    const d = interpretWakeFrame({ data: { reason: 'inbox' } });
    assertNoPoke(d);
    expect(d.ignore).toBe('not-a-wake-event');
    expect(d.observedType).toBeUndefined();
  });
});

describe('interpretWakeFrame — Fail-safe (wirft nie)', () => {
  it('unparsbarer String → ignore:unparseable', () => {
    const d = interpretWakeFrame('{nicht json');
    assertNoPoke(d);
    expect(d.ignore).toBe('unparseable');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['array', [{ type: 'agent:wake' }]],
    ['json-null-string', 'null'],
  ])('%s → ignore:not-an-object, kein Wurf', (_label, input) => {
    let d: WakeDecision = coldStartSweepDecision(); // Platzhalter, wird überschrieben
    expect(() => {
      d = interpretWakeFrame(input);
    }).not.toThrow();
    assertNoPoke(d);
    expect(d.ignore).toBe('not-an-object');
  });
});

describe('coldStartSweepDecision — §5 Cold-Start-Pflicht', () => {
  it('liefert einen Poke mit eigenem Trigger und Default-Grund', () => {
    const d = coldStartSweepDecision();
    assertPoke(d);
    expect(d.trigger).toBe('cold-start-sweep');
    expect(d.reason).toBe('inbox');
  });
});
