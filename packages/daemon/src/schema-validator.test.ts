import { describe, it, expect } from 'vitest';
import { SchemaValidator } from './schema-validator.js';

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  const skillInputSchema = {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      database: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    },
    additionalProperties: false,
  };

  const skillOutputSchema = {
    type: 'object',
    required: ['results'],
    properties: {
      results: { type: 'array' },
      count: { type: 'integer', minimum: 0 },
    },
  };

  describe('validateTaskInput', () => {
    it('akzeptiert gueltigen Input', () => {
      const result = validator.validateTaskInput(
        { query: 'SELECT * FROM cpu', database: 'telegraf', limit: 100 },
        skillInputSchema,
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('lehnt fehlende Pflichtfelder ab', () => {
      const result = validator.validateTaskInput(
        { database: 'telegraf' },
        skillInputSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('lehnt falschen Typ ab', () => {
      const result = validator.validateTaskInput(
        { query: 123 },
        skillInputSchema,
      );
      expect(result.valid).toBe(false);
    });

    it('lehnt zusaetzliche Properties ab', () => {
      const result = validator.validateTaskInput(
        { query: 'SELECT 1', evil: 'payload' },
        skillInputSchema,
      );
      expect(result.valid).toBe(false);
    });

    it('lehnt leeren String ab (minLength)', () => {
      const result = validator.validateTaskInput(
        { query: '' },
        skillInputSchema,
      );
      expect(result.valid).toBe(false);
    });

    it('lehnt zu grossen limit ab', () => {
      const result = validator.validateTaskInput(
        { query: 'SELECT 1', limit: 9999 },
        skillInputSchema,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('validateTaskOutput', () => {
    it('akzeptiert gueltigen Output', () => {
      const result = validator.validateTaskOutput(
        { results: [{ time: '2026-01-01', value: 42 }], count: 1 },
        skillOutputSchema,
      );
      expect(result.valid).toBe(true);
    });

    it('lehnt fehlende results ab', () => {
      const result = validator.validateTaskOutput(
        { count: 0 },
        skillOutputSchema,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Cache', () => {
    it('cached Validators nach Schema-ID', () => {
      const schema = { $id: 'test-cache', type: 'string' };
      validator.validate('hello', schema);
      validator.validate('world', schema);
      expect(validator.cacheSize).toBeGreaterThan(0);
    });

    it('clearCache leert den Cache', () => {
      validator.clearCache();
      expect(validator.cacheSize).toBe(0);
    });
  });
});
