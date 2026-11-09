// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * telegram-gateway.test.ts — Tests fuer den Mesh→Telegram Event-Sink.
 *
 * Fokus: `formatMeshEventForTelegram` (reine Funktion, ohne Bot/Polling).
 * Regression-Schutz fuer den T2.1/T2.2-Follow-up: die Alert-Events
 * `system:cert_expiry` und `system:skill_health` MUESSEN den Operator erreichen
 * (vorher fielen sie durch den Switch in den Void).
 *
 * TL-18 (2026-11-09): dasselbe gilt fuer `task:refused` — die place-or-refuse-
 * Ablehnung war bis dahin im `default`-Zweig und erreichte keinen Operator.
 *
 * TL-15 (2026-11-09): `system:clock_skew` ist der dritte Alert-Event dieser Art —
 * flap-gedaempft im Monitor, hier kommt nur ein Zustandswechsel an.
 */
import { describe, it, expect } from 'vitest';
import { formatMeshEventForTelegram } from './telegram-gateway.js';
import type { MeshEvent, MeshEventType } from './events.js';

const TS = '12:00:00';

function ev(type: MeshEventType, data: Record<string, unknown> = {}): MeshEvent {
  return { type, timestamp: '2026-06-30T12:00:00.000Z', data };
}

describe('formatMeshEventForTelegram', () => {
  // --- T2.2: Skill-Health (der eigentliche Slice) ---
  describe('system:skill_health', () => {
    it('ungesunder Flip → ⚠️ mit Fehlerzahl + lastError', () => {
      const out = formatMeshEventForTelegram(
        ev('system:skill_health', {
          skillId: 'influxdb',
          from: 'healthy',
          to: 'unhealthy',
          consecutiveFailures: 3,
          lastError: 'ECONNREFUSED',
        }),
        TS,
      );
      expect(out).not.toBeNull();
      expect(out).toContain('⚠️');
      expect(out).toContain('influxdb');
      expect(out).toContain('ungesund');
      expect(out).toContain('healthy→unhealthy');
      expect(out).toContain('3 Fehler');
      expect(out).toContain('ECONNREFUSED');
    });

    it('Recovery-Flip → ✅ "wieder gesund", kein Fehler-Suffix', () => {
      const out = formatMeshEventForTelegram(
        ev('system:skill_health', {
          skillId: 'influxdb',
          from: 'unhealthy',
          to: 'healthy',
          consecutiveFailures: 0,
        }),
        TS,
      );
      expect(out).toContain('✅');
      expect(out).toContain('wieder gesund');
      expect(out).not.toContain('—'); // kein lastError-Suffix
    });
  });

  // --- T2.1: Cert-Ablauf-Alert ---
  describe('system:cert_expiry', () => {
    it('warn-Tier → 🟠 WARNUNG, kein Neustart-Hinweis', () => {
      const out = formatMeshEventForTelegram(
        ev('system:cert_expiry', { daysLeft: 20, tier: 'warn' }),
        TS,
      );
      expect(out).toContain('🟠 WARNUNG');
      expect(out).toContain('20 Tag');
      expect(out).not.toContain('Reissue');
    });

    it('critical-Tier → 🔴 KRITISCH + Neustart-Hinweis', () => {
      const out = formatMeshEventForTelegram(
        ev('system:cert_expiry', { daysLeft: 5, tier: 'critical' }),
        TS,
      );
      expect(out).toContain('🔴 KRITISCH');
      expect(out).toContain('5 Tag');
      expect(out).toContain('Reissue');
    });
  });

  // --- TL-15: Uhr-Abweichung eines Partners ---
  describe('system:clock_skew (TL-15)', () => {
    /** Payload-Form wie `index.ts` sie aus einer ClockSkewTransition baut. */
    function skew(over: Record<string, unknown> = {}): MeshEvent {
      return ev('system:clock_skew', {
        agentId: 'spiffe://thinklocal/node/12D3KooWX',
        from: 'ok',
        to: 'skewed',
        skewMs: 12_345,
        rttMs: 18,
        thresholdMs: 5000,
        confirmations: 3,
        ...over,
      });
    }

    it('wird zugestellt und nennt Peer, Betrag, Richtung und Schwelle', () => {
      const out = formatMeshEventForTelegram(skew(), TS);
      expect(out).toContain('⏱️');
      expect(out).toContain(TS);
      expect(out).toContain('Uhr-Abweichung');
      expect(out).toContain('spiffe://thinklocal/node/12D3KooWX');
      expect(out).toContain('12.3 s vor');
      expect(out).toContain('Schwelle 5.0 s');
    });

    it('nachlaufende Uhr → Richtung "nach", Betrag ohne Vorzeichen', () => {
      const out = formatMeshEventForTelegram(skew({ skewMs: -7100 }), TS);
      expect(out).toContain('7.1 s nach');
      expect(out).not.toContain('-7.1');
    });

    it('Erholung (to=ok) → eigene Formulierung mit ✅', () => {
      const out = formatMeshEventForTelegram(
        skew({ from: 'skewed', to: 'ok', skewMs: 240 }),
        TS,
      );
      expect(out).toContain('✅');
      expect(out).toContain('behoben');
      expect(out).toContain('laeuft jetzt 0.2 s vor');
      expect(out).not.toContain('⏱️');
    });

    it('nicht endlicher Messwert → ehrliche Aussage statt NaN', () => {
      // Deckt den Fall ab, den die erste Fassung ueber `typeof === 'number'` durchliess
      // (CR-Runde 1, LOW-3): `typeof NaN === 'number'` ist true.
      expect(formatMeshEventForTelegram(skew({ skewMs: NaN }), TS)).toContain('Abweichung unbekannt');
      expect(formatMeshEventForTelegram(skew({ skewMs: Infinity }), TS)).toContain('Abweichung unbekannt');
      expect(formatMeshEventForTelegram(skew({ skewMs: '12345' }), TS)).toContain('Abweichung unbekannt');
    });

    it('fehlender Messwert → ehrliche Aussage, nie undefined/NaN', () => {
      const out = formatMeshEventForTelegram(
        skew({ skewMs: undefined }),
        TS,
      );
      expect(out).toContain('Abweichung unbekannt');
      expect(out).toContain('Schwelle 5.0 s');
      expect(out).not.toMatch(/undefined|NaN|null/);
    });

    it('fehlende Schwelle → kein leeres Klammerpaar', () => {
      const out = formatMeshEventForTelegram(skew({ thresholdMs: undefined }), TS);
      expect(out).toContain('12.3 s vor');
      expect(out).not.toContain('()');
      expect(out).not.toContain('Schwelle');
    });
  });

  // --- TL-18: place-or-refuse-Ablehnung (der eigentliche Slice) ---
  describe('task:refused (TL-18)', () => {
    /** Payload-Form wie `task-executor.ts:155` sie emittiert. */
    function refused(over: Record<string, unknown> = {}): MeshEvent {
      return ev('task:refused', {
        taskId: 't1',
        skillId: 'system.health',
        requester: 'spiffe://thinklocal/host/h/agent/a',
        reason: 'capacity',
        limit: 'ram',
        ramUsedPercent: 95.5,
        cpuLoad: null,
        agentCount: null,
        ...over,
      });
    }

    it('wird ueberhaupt zugestellt (nicht null) — das war der Befund', () => {
      expect(formatMeshEventForTelegram(refused(), TS)).not.toBeNull();
    });

    it('RAM-Limit → Skill, Messwert und Anfrager im Text', () => {
      const out = formatMeshEventForTelegram(refused(), TS);
      expect(out).toContain('🚫');
      expect(out).toContain(TS);
      expect(out).toContain('abgelehnt');
      expect(out).toContain('system.health');
      expect(out).toContain('RAM 95.5 %');
      expect(out).toContain('spiffe://thinklocal/host/h/agent/a');
    });

    it('CPU-Limit → CPU-Messwert statt RAM', () => {
      const out = formatMeshEventForTelegram(
        refused({ limit: 'cpu', ramUsedPercent: 40, cpuLoad: 97.2 }),
        TS,
      );
      expect(out).toContain('CPU 97.2 %');
      expect(out).not.toContain('RAM');
    });

    it('glatter Prozentwert → trotzdem eine Dezimalstelle (Paritaet zur Audit-Zeile)', () => {
      const out = formatMeshEventForTelegram(refused({ ramUsedPercent: 91 }), TS);
      expect(out).toContain('RAM 91.0 %');
    });

    it('agent_count-Limit → Ganzzahl ohne Dezimalstelle', () => {
      const out = formatMeshEventForTelegram(
        refused({ limit: 'agents', ramUsedPercent: 40, agentCount: 25 }),
        TS,
      );
      expect(out).toContain('agent_count 25');
      expect(out).not.toContain('25.0');
    });

    it('fehlender Messwert → Dimensionsname, nie undefined/NaN', () => {
      const out = formatMeshEventForTelegram(
        refused({ limit: 'ram', ramUsedPercent: null }),
        TS,
      );
      expect(out).toContain('RAM-Auslastung');
      expect(out).not.toMatch(/undefined|NaN|null/);
    });

    it('unbekanntes limit → neutrale Formulierung, kein Roh-Dump', () => {
      const out = formatMeshEventForTelegram(
        refused({ limit: 'kuehlschrank', ramUsedPercent: null }),
        TS,
      );
      expect(out).toContain('Auslastung');
      expect(out).not.toContain('kuehlschrank');
    });

    it('ohne requester → kein leeres Anfrage-Suffix', () => {
      const out = formatMeshEventForTelegram(refused({ requester: undefined }), TS);
      expect(out).not.toContain('Anfrage:');
      expect(out).toContain('RAM 95.5 %');
    });
  });

  // --- Regression: bestehende 6 Cases bleiben unveraendert ---
  describe('bestehende Events (Regression)', () => {
    it('peer:join / peer:leave', () => {
      expect(formatMeshEventForTelegram(ev('peer:join', { agentId: 'a1' }), TS)).toContain('a1');
      expect(formatMeshEventForTelegram(ev('peer:leave', { agentId: 'a1' }), TS)).toContain('a1');
    });
    it('task:completed / task:failed', () => {
      expect(formatMeshEventForTelegram(ev('task:completed', { skillId: 's1' }), TS)).toContain('s1');
      const f = formatMeshEventForTelegram(ev('task:failed', { skillId: 's1', error: 'boom' }), TS);
      expect(f).toContain('s1');
      expect(f).toContain('boom');
    });
    it('system:startup / system:shutdown', () => {
      expect(formatMeshEventForTelegram(ev('system:startup', { agentId: 'a1' }), TS)).toContain('a1');
      expect(formatMeshEventForTelegram(ev('system:shutdown'), TS)).toContain('gestoppt');
    });
  });

  // --- Spam-Unterdrueckung: alles andere → null ---
  describe('nicht weitergeleitete Events', () => {
    it.each<MeshEventType>(['peer:heartbeat', 'capability:synced', 'audit:new', 'task:created'])(
      '%s → null (kein Spam)',
      (type) => {
        expect(formatMeshEventForTelegram(ev(type), TS)).toBeNull();
      },
    );
  });
});
