/**
 * schema-validator.ts — JSON Schema Validierung fuer Task-Input/Output
 *
 * Verwendet @cfworker/json-schema (lightweight, draft-07+).
 * Validiert Task-Payloads gegen Skill-definierte Schemas.
 *
 * Architektur:
 * - Jeder Skill definiert input_schema + output_schema (JSON Schema)
 * - Vor Task-Ausfuehrung: Input gegen input_schema validieren
 * - Nach Task-Ausfuehrung: Output gegen output_schema validieren
 * - Validators werden gecached pro Schema-ID
 */

import { Validator } from '@cfworker/json-schema';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

export interface SchemaDefinition {
  /** JSON Schema (draft-07 oder neuer) */
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Schema-Validator mit Cache fuer wiederholte Validierungen.
 */
export class SchemaValidator {
  private cache = new Map<string, Validator>();

  constructor(private log?: Logger) {}

  /**
   * Validiert Daten gegen ein JSON Schema.
   * Cached den Validator fuer wiederholte Aufrufe.
   */
  validate(data: unknown, schema: SchemaDefinition, label = 'data'): ValidationResult {
    const schemaId = (schema['$id'] as string) ??
      createHash('sha256').update(JSON.stringify(schema)).digest('hex');

    let validator = this.cache.get(schemaId);
    if (!validator) {
      validator = new Validator(schema);
      this.cache.set(schemaId, validator);
    }

    const result = validator.validate(data);

    if (!result.valid) {
      const errors = result.errors.map(
        (e) => `${e.instanceLocation}: ${e.error}`,
      );
      this.log?.warn({ label, errors }, 'Schema-Validierung fehlgeschlagen');
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Validiert Task-Input gegen das input_schema eines Skills.
   * Wirft bei ungueltigem Input einen Fehler.
   */
  validateTaskInput(input: unknown, inputSchema: SchemaDefinition): ValidationResult {
    return this.validate(input, inputSchema, 'task-input');
  }

  /**
   * Validiert Task-Output gegen das output_schema eines Skills.
   * Loggt Warnungen bei ungueltigem Output (wirft nicht).
   */
  validateTaskOutput(output: unknown, outputSchema: SchemaDefinition): ValidationResult {
    return this.validate(output, outputSchema, 'task-output');
  }

  /** Cache leeren */
  clearCache(): void {
    this.cache.clear();
  }

  /** Anzahl gecachter Validators */
  get cacheSize(): number {
    return this.cache.size;
  }
}
