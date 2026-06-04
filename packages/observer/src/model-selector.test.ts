import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { selectModel, selectModelWithOverride } from './model-selector.js';

describe('selectModel', () => {
  it('returns null for less than 4 GB RAM', () => {
    expect(selectModel(2048)).toBeNull();
    expect(selectModel(3000)).toBeNull();
    expect(selectModel(3799)).toBeNull();
  });

  it('selects basic model for 4-8 GB', () => {
    const result = selectModel(4096);
    expect(result).not.toBeNull();
    expect(result!.capability).toBe('basic');
    expect(result!.model).toBe('qwen3.5:0.6b');
  });

  it('selects standard model for 8-16 GB', () => {
    const result = selectModel(8192);
    expect(result!.capability).toBe('standard');
    expect(result!.model).toBe('qwen3.5:4b');
  });

  it('selects advanced model for 16-32 GB', () => {
    const result = selectModel(16384);
    expect(result!.capability).toBe('advanced');
    expect(result!.model).toBe('gemma4:e4b');
  });

  it('selects expert model for 32+ GB', () => {
    const result = selectModel(32768);
    expect(result!.capability).toBe('expert');
    expect(result!.model).toBe('gemma4:26b');
  });

  it('selects expert model for 128 GB (MacBook Pro)', () => {
    const result = selectModel(131072);
    expect(result!.capability).toBe('expert');
  });

  it('includes reason string with RAM amount', () => {
    const result = selectModel(8192);
    expect(result!.reason).toContain('8192');
  });

  it('uses os.totalmem() when no override provided', () => {
    const result = selectModel();
    // Just check it returns *something* (we don't know the test machine RAM)
    expect(result === null || typeof result.model === 'string').toBe(true);
  });
});

describe('selectModelWithOverride', () => {
  const originalEnv = process.env['TLMCP_OBSERVER_MODEL'];

  beforeEach(() => {
    delete process.env['TLMCP_OBSERVER_MODEL'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['TLMCP_OBSERVER_MODEL'] = originalEnv;
    } else {
      delete process.env['TLMCP_OBSERVER_MODEL'];
    }
  });

  it('returns env override when set', () => {
    process.env['TLMCP_OBSERVER_MODEL'] = 'qwen3.5:4b';
    const result = selectModelWithOverride();
    expect(result!.model).toBe('qwen3.5:4b');
    expect(result!.reason).toContain('Override');
  });

  it('falls back to RAM-based selection when env not set', () => {
    const result = selectModelWithOverride();
    // Can't assert specific model — depends on test machine RAM
    if (result) {
      expect(result.reason).not.toContain('Override');
    }
  });
});
