// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * telegram-gateway.test.ts — Tests fuer den Mesh→Telegram Event-Sink.
 *
 * Fokus: `formatMeshEventForTelegram` (reine Funktion, ohne Bot/Polling).
 * Regression-Schutz fuer den T2.1/T2.2-Follow-up: die Alert-Events
 * `system:cert_expiry` und `system:skill_health` MUESSEN den Operator erreichen
 * (vorher fielen sie durch den Switch in den Void).
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
