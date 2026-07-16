// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * capability-skeleton.ts — TL-21 Skelett-Auskunft (Kap. 06, zweistufige Offenlegung).
 *
 * Reine Projektion vorhandener `Capability`-Daten in eine kompakte „Name + ein Satz"-Übersicht,
 * dedupliziert pro `skill_id` über Provider. Kein State, kein I/O, deterministisch (kein Date/Random).
 * Siehe docs/architecture/TL-21-skeleton-disclosure.md.
 */

import type { Capability, CapabilityHealth } from './registry.js';

/** Ein Skelett-Eintrag: das Minimum für die Erst-Orientierung (Details via /api/capabilities?skill_id=). */
export interface CapabilitySkeletonEntry {
  skill_id: string;
  /** Erster Satz von `description` (kompakt). */
  summary: string;
  category: string;
  /** Anzahl anbietender Agenten für diesen Skill. */
  providers: number;
  /** Aggregiert: healthy, wenn ≥1 Provider healthy; sonst degraded, wenn ≥1 degraded; sonst offline. */
  health: CapabilityHealth;
}

/** Harte Obergrenze für `summary`, falls die Beschreibung keinen Satz-Terminator enthält. */
const SUMMARY_MAX_LEN = 160;

/**
 * Erster Satz eines Textes: bis zum ersten `.`/`!`/`?`, das von Whitespace oder Textende gefolgt wird
 * (der Lookahead verhindert das Zerschneiden an Dezimalzahlen wie „v3.14"). **Das Ergebnis wird IMMER auf
 * `SUMMARY_MAX_LEN` gekappt** (mit `…`, wenn gekürzt) — auch wenn ein Terminator gefunden wurde: ein
 * (untrusted, CRDT-basierter) 8-KB-„Ein-Satz" darf die Übersicht nicht sprengen (Kap.-06-Kompaktheit).
 * Leere/whitespace-only Eingabe → leerer String. Rein, deterministisch. Abkürzungen (`z.B.`) bleiben eine
 * bewusste Heuristik-Grenze (ohne Wörterbuch nicht auflösbar).
 */
export function firstSentence(text: string): string {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return '';
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed);
  const sentence = (match ? match[0] : trimmed).trim();
  if (sentence.length <= SUMMARY_MAX_LEN) return sentence;
  return sentence.slice(0, SUMMARY_MAX_LEN).trimEnd() + '…';
}

/** Rangfolge für die „gesund-bevorzugte" Provider-Wahl (kleiner = bevorzugt). */
const HEALTH_RANK: Record<CapabilityHealth, number> = { healthy: 0, degraded: 1, offline: 2 };
/** Defensiv: unbekannter (malformed/forged CRDT-)Health-Wert rankt hinter `offline` — kein NaN-Comparator. */
const healthRank = (h: CapabilityHealth): number => HEALTH_RANK[h] ?? 3;
/** Fixe, locale-unabhängige String-Ordnung (strikte Cross-Host-Determinismus-Invariante §5.3). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Baut die deduplizierte Skelett-Übersicht: ein Eintrag pro `skill_id`, sortiert nach `skill_id`.
 * `summary`/`category` stammen vom gesund-bevorzugten Provider (Rang, dann lexikografisch `agent_id`);
 * `health` ist über alle Provider aggregiert. Rein, deterministisch (kein Date/Random).
 */
export function buildCapabilitySkeleton(capabilities: Capability[]): CapabilitySkeletonEntry[] {
  const bySkill = new Map<string, Capability[]>();
  for (const c of capabilities) {
    const list = bySkill.get(c.skill_id);
    if (list) list.push(c);
    else bySkill.set(c.skill_id, [c]);
  }

  const entries: CapabilitySkeletonEntry[] = [];
  for (const [skill_id, providers] of bySkill) {
    // Gesund-bevorzugter Provider: erst nach Health-Rang, dann lexikografisch nach agent_id (stabil).
    const preferred = [...providers].sort(
      (a, b) => healthRank(a.health) - healthRank(b.health) || cmpStr(a.agent_id, b.agent_id),
    )[0];
    const health: CapabilityHealth = providers.some((p) => p.health === 'healthy')
      ? 'healthy'
      : providers.some((p) => p.health === 'degraded')
        ? 'degraded'
        : 'offline';
    entries.push({
      skill_id,
      summary: firstSentence(preferred.description),
      category: preferred.category,
      providers: providers.length,
      health,
    });
  }

  return entries.sort((a, b) => cmpStr(a.skill_id, b.skill_id));
}
