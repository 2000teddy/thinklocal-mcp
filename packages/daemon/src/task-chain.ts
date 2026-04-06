/**
 * task-chain.ts — Multi-Step-Task-Chains
 *
 * Ermoeglicht die Verkettung von Tasks: Agent A → Agent B → Agent C.
 * Jeder Schritt verwendet das Ergebnis des vorherigen als Input.
 *
 * Use-Cases:
 * - Daten abfragen → transformieren → speichern
 * - Health-Check → Alert → Notification
 * - Code generieren → testen → deployen
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

export interface ChainStep {
  /** Skill-ID die ausgefuehrt werden soll */
  skillId: string;
  /** Optionaler Input (wird mit vorherigem Ergebnis gemerged) */
  input?: Record<string, unknown>;
  /** Optionaler Ziel-Agent (sonst Auto-Routing) */
  targetAgent?: string;
  /** Timeout fuer diesen Schritt in ms (default: 30s) */
  timeoutMs?: number;
  /** Bedingung: Nur ausfuehren wenn voheriger Schritt erfolgreich (default: true) */
  onlyOnSuccess?: boolean;
}

export interface ChainResult {
  chainId: string;
  status: 'completed' | 'failed' | 'partial';
  steps: Array<{
    skillId: string;
    status: 'completed' | 'failed' | 'skipped';
    result?: unknown;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
}

export type StepExecutor = (
  skillId: string,
  input: Record<string, unknown>,
  targetAgent?: string,
  timeoutMs?: number,
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

/**
 * Fuehrt eine Kette von Tasks sequenziell aus.
 * Jeder Schritt bekommt das Ergebnis des vorherigen als Input.
 */
export async function executeChain(
  steps: ChainStep[],
  executor: StepExecutor,
  log?: Logger,
): Promise<ChainResult> {
  const chainId = randomUUID();
  const startTime = Date.now();
  const results: ChainResult['steps'] = [];
  let lastResult: unknown = null;

  log?.info({ chainId, steps: steps.length }, 'Task-Chain gestartet');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();

    // Input zusammenstellen: Schritt-Input + vorheriges Ergebnis
    const input: Record<string, unknown> = {
      ...(step.input ?? {}),
      _previousResult: lastResult,
      _chainId: chainId,
      _stepIndex: i,
    };

    try {
      const result = await executor(
        step.skillId,
        input,
        step.targetAgent,
        step.timeoutMs ?? 30_000,
      );

      const durationMs = Date.now() - stepStart;

      if (result.success) {
        lastResult = result.result;
        results.push({
          skillId: step.skillId,
          status: 'completed',
          result: result.result,
          durationMs,
        });
        log?.debug({ chainId, step: i, skillId: step.skillId, durationMs }, 'Chain-Schritt abgeschlossen');
      } else {
        results.push({
          skillId: step.skillId,
          status: 'failed',
          error: result.error,
          durationMs,
        });
        log?.warn({ chainId, step: i, skillId: step.skillId, error: result.error }, 'Chain-Schritt fehlgeschlagen');

        // Nachfolgende Schritte uebersprungen wenn onlyOnSuccess (default: true)
        // Schritte mit onlyOnSuccess === false werden trotz Fehler ausgefuehrt
        for (let j = i + 1; j < steps.length; j++) {
          if (steps[j].onlyOnSuccess ?? true) {
            results.push({
              skillId: steps[j].skillId,
              status: 'skipped',
              durationMs: 0,
            });
          }
        }

        return {
          chainId,
          status: 'partial',
          steps: results,
          totalDurationMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      results.push({
        skillId: step.skillId,
        status: 'failed',
        error: String(err),
        durationMs,
      });

      return {
        chainId,
        status: 'failed',
        steps: results,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  log?.info({ chainId, totalDurationMs: Date.now() - startTime }, 'Task-Chain abgeschlossen');

  return {
    chainId,
    status: 'completed',
    steps: results,
    totalDurationMs: Date.now() - startTime,
  };
}
