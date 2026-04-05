import { describe, it, expect } from 'vitest';
import { executeChain, type StepExecutor } from './task-chain.js';

describe('TaskChain', () => {
  const successExecutor: StepExecutor = async (skillId, input) => ({
    success: true,
    result: { skillId, input, value: 42 },
  });

  const failExecutor: StepExecutor = async (skillId) => ({
    success: false,
    error: `${skillId} failed`,
  });

  it('fuehrt alle Schritte erfolgreich aus', async () => {
    const result = await executeChain([
      { skillId: 'step1' },
      { skillId: 'step2' },
      { skillId: 'step3' },
    ], successExecutor);

    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('stoppt bei Fehler und markiert Rest als skipped', async () => {
    let callCount = 0;
    const mixedExecutor: StepExecutor = async (skillId) => {
      callCount++;
      if (callCount === 2) return { success: false, error: 'boom' };
      return { success: true, result: { ok: true } };
    };

    const result = await executeChain([
      { skillId: 'ok1' },
      { skillId: 'fail' },
      { skillId: 'skipped' },
    ], mixedExecutor);

    expect(result.status).toBe('partial');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[2].status).toBe('skipped');
  });

  it('uebergibt vorheriges Ergebnis als _previousResult', async () => {
    const inputs: Record<string, unknown>[] = [];
    const trackingExecutor: StepExecutor = async (_skillId, input) => {
      inputs.push(input);
      return { success: true, result: { step: inputs.length } };
    };

    await executeChain([
      { skillId: 'a' },
      { skillId: 'b' },
    ], trackingExecutor);

    expect(inputs[0]['_previousResult']).toBeNull();
    expect(inputs[1]['_previousResult']).toEqual({ step: 1 });
  });

  it('hat eindeutige chainId', async () => {
    const r1 = await executeChain([{ skillId: 'x' }], successExecutor);
    const r2 = await executeChain([{ skillId: 'x' }], successExecutor);
    expect(r1.chainId).not.toBe(r2.chainId);
  });

  it('misst Gesamtdauer', async () => {
    const result = await executeChain([{ skillId: 'a' }], successExecutor);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
