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
  ramUsedPercent: number;
}

/**
 * Reine Entscheidung: Platzierung ablehnen, wenn die RAM-Auslastung die Schwelle
 * **überschreitet** (strikt `>`). Bei genau `== refuseRamPercent` wird akzeptiert.
 */
export function evaluatePlacement(ramUsedPercent: number, refuseRamPercent: number): PlacementDecision {
  if (Number.isFinite(ramUsedPercent) && ramUsedPercent > refuseRamPercent) {
    return { refuse: true, reason: 'capacity', ramUsedPercent };
  }
  return { refuse: false, ramUsedPercent };
}
