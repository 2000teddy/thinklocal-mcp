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

/**
 * Obergrenze für den **Inhalt** von `summary` (vor einem etwaigen Ellipsis). Wird gekürzt, hängt
 * `firstSentence` `…` an → das Ergebnis hat höchstens `SUMMARY_MAX_LEN` Inhalts-Code-Einheiten **plus**
 * das optionale `…` (max. `SUMMARY_MAX_LEN + 1` Code-Einheiten). Der Cap greift, falls die Beschreibung
 * keinen Satz-Terminator enthält — oder der „erste Satz" pathologisch lang ist (untrusted CRDT-Daten).
 */
const SUMMARY_MAX_LEN = 160;

/**
 * Total-fail-safe String-Sicht auf runtime-untypisierte CRDT-Felder: `Capability` ist typisiert `string`,
 * aber die Wire-/Registry-Herkunft ist untyped (`importPeerCapabilities` schema-validiert weder
 * `description` noch `skill_id`/`agent_id`/`category`). Ein geschmiedeter Nicht-String (`123`, `{}`, `[]`)
 * würde `.trim()`/Comparator/Map-Key sprengen → hier deterministisch auf `''` normalisiert (nie werfen).
 */
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Erster Satz eines Textes: bis zum ersten `.`/`!`/`?`, das von Whitespace oder Textende gefolgt wird
 * (der Lookahead verhindert das Zerschneiden an Dezimalzahlen wie „v3.14"). **Der Inhalt wird IMMER auf
 * `SUMMARY_MAX_LEN` gekappt** (mit angehängtem `…`, wenn gekürzt — Ergebnis ≤ `SUMMARY_MAX_LEN + 1`) —
 * auch wenn ein Terminator gefunden wurde: ein (untrusted, CRDT-basierter) 8-KB-„Ein-Satz" darf die
 * Übersicht nicht sprengen (Kap.-06-Kompaktheit). **Nicht-String / leere / whitespace-only Eingabe →
 * leerer String** (total: `description` ist runtime-untyped, s. `asStr`). Rein, deterministisch.
 * Abkürzungen (`z.B.`) bleiben eine bewusste Heuristik-Grenze (ohne Wörterbuch nicht auflösbar).
 */
export function firstSentence(text: unknown): string {
  const trimmed = asStr(text).trim();
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
 *
 * **Total gegen malformed CRDT-Daten (CR-MEDIUM):** die Projektion ist eine *additive Read-View* — eine
 * einzelne geschmiedete Capability (`skill_id`/`agent_id`/`category`/`description` non-string) darf sie
 * NICHT in einen 500er kippen. Ein Eintrag ohne verwertbaren `skill_id` (Grouping-Key) ist unprojektierbar
 * → **übersprungen** (bounded, kein Crash, kein garbage-Key); die weichen Anzeigefelder werden über `asStr`
 * normalisiert; `health` ist bereits defensiv (`healthRank ?? 3`, `some(=== 'healthy')`).
 */
export function buildCapabilitySkeleton(capabilities: Capability[]): CapabilitySkeletonEntry[] {
  const bySkill = new Map<string, Capability[]>();
  for (const c of capabilities) {
    // skill_id ist Grouping-/Sort-Key: non-string/leer → nicht projektierbar → skip (total, bounded).
    const skill_id = asStr((c as { skill_id?: unknown }).skill_id);
    if (skill_id === '') continue;
    const list = bySkill.get(skill_id);
    if (list) list.push(c);
    else bySkill.set(skill_id, [c]);
  }

  const entries: CapabilitySkeletonEntry[] = [];
  for (const [skill_id, providers] of bySkill) {
    // Gesund-bevorzugter Provider: erst nach Health-Rang, dann lexikografisch nach agent_id (stabil).
    // agent_id über asStr → deterministischer Comparator auch bei geschmiedetem non-string agent_id.
    const preferred = [...providers].sort(
      (a, b) =>
        healthRank(a.health) - healthRank(b.health) ||
        cmpStr(asStr((a as { agent_id?: unknown }).agent_id), asStr((b as { agent_id?: unknown }).agent_id)),
    )[0];
    const health: CapabilityHealth = providers.some((p) => p.health === 'healthy')
      ? 'healthy'
      : providers.some((p) => p.health === 'degraded')
        ? 'degraded'
        : 'offline';
    entries.push({
      skill_id,
      // firstSentence + asStr sind beide total gegen non-string CRDT-Werte (kein throw).
      summary: firstSentence(preferred.description),
      category: asStr((preferred as { category?: unknown }).category),
      providers: providers.length,
      health,
    });
  }

  return entries.sort((a, b) => cmpStr(a.skill_id, b.skill_id));
}
