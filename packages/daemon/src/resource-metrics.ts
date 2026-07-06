// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * resource-metrics.ts — T2.4 (V5 Spur 2)
 *
 * Liefert die Resource-Attribute eines Knotens (free_ram, cpu_load) und die reine
 * place-or-refuse-Entscheidung (>X % RAM → neue Platzierung ablehnen).
 *
 * WICHTIG (cache-bewusst): Unter Linux zählt `mem.used` den reklamierbaren
 * Page-Cache als belegt. Ein gesunder Knoten mit viel Cache sähe damit „>90 %"
 * aus und würde JEDE Platzierung faelschlich ablehnen. Wir rechnen deshalb mit
 * `mem.available` (cache-bereinigt): used% = (total − available) / total.
 */
import * as si from 'systeminformation';

export interface ResourceMetrics {
  free_ram_bytes: number;
  total_ram_bytes: number;
  ram_used_percent: number;
  cpu_load: number;
}

/** Cache-bewusster RAM-Auslastungsgrad in Prozent (0..100). */
export function computeRamUsedPercent(totalBytes: number, availableBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const avail = Number.isFinite(availableBytes) ? Math.max(0, availableBytes) : 0;
  const used = Math.max(0, totalBytes - avail);
  return Math.min(100, (used / totalBytes) * 100);
}

/** Schneller RAM-Check für den place-or-refuse-Hot-Path (nur si.mem()). */
export async function readRamUsedPercent(): Promise<number> {
  const mem = await si.mem();
  const available = (mem.available ?? mem.free) as number;
  return computeRamUsedPercent(mem.total, available);
}

/** Voller Resource-Snapshot für die periodische Registry-Aktualisierung. */
export async function readResourceMetrics(): Promise<ResourceMetrics> {
  const [mem, load] = await Promise.all([si.mem(), si.currentLoad()]);
  const available = (mem.available ?? mem.free) as number;
  return {
    free_ram_bytes: available,
    total_ram_bytes: mem.total,
    ram_used_percent: computeRamUsedPercent(mem.total, available),
    cpu_load: Math.round(load.currentLoad * 10) / 10,
  };
}

export interface PlacementDecision {
  refuse: boolean;
  reason?: 'capacity';
  /** Welche Dimension die Ablehnung ausgelöst hat (für Log/Audit/Event). */
  limit?: 'ram' | 'cpu' | 'agents';
  ramUsedPercent: number;
}

/**
 * T2.4-Folge: aktueller Auslastungs-Snapshot für die place-or-refuse-Entscheidung.
 * Jede Dimension ist optional/nullable — eine nicht gemessene Dimension (null/undefined)
 * wird übersprungen (fail-open pro Dimension), nicht als 0 behandelt.
 */
export interface PlacementMetrics {
  /** Cache-bewusste RAM-Auslastung 0..100. */
  ramUsedPercent?: number | null;
  /** CPU-Last 0..100 (geglätteter si.currentLoad-Snapshot). */
  cpuLoad?: number | null;
  /** Anzahl lokal registrierter Agenten. */
  agentCount?: number | null;
}

/**
 * T2.4-Folge: Schwellen pro Dimension. `0`/undefined = Dimension deaktiviert
 * (kein Refuse). RAM ist per config immer aktiv (1..100); CPU/agent_count sind
 * standardmäßig deaktiviert und per config/env opt-in.
 */
export interface PlacementLimits {
  refuseRamPercent?: number;
  refuseCpuPercent?: number;
  refuseAgentCount?: number;
}

/** Eine Dimension ist überschritten, wenn die Schwelle aktiv (>0) und der Wert strikt größer ist. */
function exceeds(value: number | null | undefined, limit: number | undefined): boolean {
  return (
    typeof limit === 'number' &&
    limit > 0 &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > limit
  );
}

/**
 * Reine Multi-Dimension-Entscheidung: lehnt ab, sobald die ERSTE aktive Schwelle
 * (Priorität RAM → CPU → agent_count) strikt überschritten ist. Bei `==` wird
 * akzeptiert. Nicht gemessene/deaktivierte Dimensionen werden übersprungen.
 */
export function evaluatePlacementMetrics(
  metrics: PlacementMetrics,
  limits: PlacementLimits,
): PlacementDecision {
  const ram = typeof metrics.ramUsedPercent === 'number' ? metrics.ramUsedPercent : NaN;
  if (exceeds(metrics.ramUsedPercent, limits.refuseRamPercent)) {
    return { refuse: true, reason: 'capacity', limit: 'ram', ramUsedPercent: ram };
  }
  if (exceeds(metrics.cpuLoad, limits.refuseCpuPercent)) {
    return { refuse: true, reason: 'capacity', limit: 'cpu', ramUsedPercent: ram };
  }
  if (exceeds(metrics.agentCount, limits.refuseAgentCount)) {
    return { refuse: true, reason: 'capacity', limit: 'agents', ramUsedPercent: ram };
  }
  return { refuse: false, ramUsedPercent: ram };
}

/**
 * Reine Entscheidung (RAM-only, Back-Compat-Wrapper): Platzierung ablehnen, wenn die
 * RAM-Auslastung die Schwelle **überschreitet** (strikt `>`). Bei genau
 * `== refuseRamPercent` wird akzeptiert. Delegiert an {@link evaluatePlacementMetrics}.
 *
 * Hinweis: für gültige Schwellen (config erzwingt RAM 1..100) identisch zum alten
 * Verhalten. Bewusste Abweichung nur bei `refuseRamPercent <= 0`: das gilt jetzt als
 * „deaktiviert" (kein Refuse) statt „immer Refuse" — konsistent mit der 0-=-aus-Semantik
 * der neuen CPU/agent_count-Dimensionen. Über config unerreichbar.
 */
export function evaluatePlacement(ramUsedPercent: number, refuseRamPercent: number): PlacementDecision {
  return evaluatePlacementMetrics({ ramUsedPercent }, { refuseRamPercent });
}
