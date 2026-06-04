/**
 * model-selector.ts — RAM-basierte Modell-Auswahl fuer Observer-Agent
 *
 * Waehlt das passende Ollama-Modell basierend auf verfuegbarem System-RAM.
 * Headless Nodes haben oft wenig RAM (Raspberry Pi 4 GB), auf groesseren
 * Maschinen kann ein staerkeres Modell genutzt werden.
 *
 * Siehe ADR-018 + PRO_CON_THINKBIG.md fuer Hintergrund.
 */

import { totalmem } from 'node:os';

export interface ModelChoice {
  /** Ollama-Modell-Name (z.B. "qwen3.5:4b") */
  model: string;
  /** Geschaetzter RAM-Verbrauch des Modells in MB */
  modelRamMb: number;
  /** Beschreibung der Faehigkeiten */
  capability: 'basic' | 'standard' | 'advanced' | 'expert';
  /** Grund fuer die Auswahl (fuer Logs) */
  reason: string;
}

/**
 * Minimum-RAM unterhalb dessen der Observer nicht laeuft.
 * 4 GB = 4096 MB. Darunter bleibt dem System zu wenig RAM.
 */
const MIN_RAM_MB = 3800;

/**
 * RAM-Schwellen fuer die Modell-Auswahl (in MB).
 */
const THRESHOLDS = {
  basic: { min: 3800, model: 'qwen3.5:0.6b', ramMb: 800 },
  standard: { min: 7500, model: 'qwen3.5:4b', ramMb: 3000 },
  advanced: { min: 15000, model: 'gemma4:e4b', ramMb: 5000 },
  expert: { min: 31000, model: 'gemma4:26b', ramMb: 17000 },
} as const;

/**
 * Waehlt ein Modell basierend auf verfuegbarem RAM.
 *
 * @param totalRamMb Override (fuer Tests). Default: os.totalmem()
 * @returns ModelChoice oder null wenn zu wenig RAM
 */
export function selectModel(totalRamMb?: number): ModelChoice | null {
  const ramMb = totalRamMb ?? Math.floor(totalmem() / 1024 / 1024);

  if (ramMb < MIN_RAM_MB) {
    return null;
  }

  if (ramMb >= THRESHOLDS.expert.min) {
    return {
      model: THRESHOLDS.expert.model,
      modelRamMb: THRESHOLDS.expert.ramMb,
      capability: 'expert',
      reason: `${ramMb} MB RAM — expert model (32+ GB hardware)`,
    };
  }
  if (ramMb >= THRESHOLDS.advanced.min) {
    return {
      model: THRESHOLDS.advanced.model,
      modelRamMb: THRESHOLDS.advanced.ramMb,
      capability: 'advanced',
      reason: `${ramMb} MB RAM — advanced model (16-32 GB hardware)`,
    };
  }
  if (ramMb >= THRESHOLDS.standard.min) {
    return {
      model: THRESHOLDS.standard.model,
      modelRamMb: THRESHOLDS.standard.ramMb,
      capability: 'standard',
      reason: `${ramMb} MB RAM — standard model (8-16 GB hardware)`,
    };
  }
  return {
    model: THRESHOLDS.basic.model,
    modelRamMb: THRESHOLDS.basic.ramMb,
    capability: 'basic',
    reason: `${ramMb} MB RAM — basic model (4-8 GB hardware)`,
  };
}

/**
 * Override via Environment (z.B. TLMCP_OBSERVER_MODEL=qwen3.5:4b).
 * Nuetzlich fuer Testing oder manuelle Konfiguration.
 */
export function selectModelWithOverride(): ModelChoice | null {
  const override = process.env['TLMCP_OBSERVER_MODEL'];
  if (override) {
    return {
      model: override,
      modelRamMb: 0, // unknown
      capability: 'standard',
      reason: `Override via TLMCP_OBSERVER_MODEL=${override}`,
    };
  }
  return selectModel();
}
