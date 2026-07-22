// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wire-feature.test.ts — ADR-046 §2 fail-closed Consumer-Kern (`supportsFeature`).
 *
 * Sperrt die non-negotiable Invariante fest: annonciertes Feature vorhanden ⇒ true; ALLES andere
 * (absent/unknown/leer/malformed/non-string) ⇒ false. „absent ⇒ assume yes" darf nie regressieren.
 */
import { describe, it, expect } from 'vitest';
import { supportsFeature } from './wire-feature.js';

describe('supportsFeature — positiver Pfad', () => {
  it('feature in der annoncierten Liste → true', () => {
    expect(supportsFeature(['order-envelope-v2'], 'order-envelope-v2')).toBe(true);
  });

  it('eines von mehreren annoncierten Features → true', () => {
    expect(supportsFeature(['a', 'order-envelope-v2', 'b'], 'order-envelope-v2')).toBe(true);
  });
});

describe('supportsFeature — fail-closed (der ADR-046-Kern)', () => {
  it('undefined Liste (Peer ohne Advertisement, z.B. alte Version) → false, NICHT assume-yes', () => {
    expect(supportsFeature(undefined, 'order-envelope-v2')).toBe(false);
  });

  it('null Liste → false', () => {
    expect(supportsFeature(null, 'order-envelope-v2')).toBe(false);
  });

  it('leere Liste → false', () => {
    expect(supportsFeature([], 'order-envelope-v2')).toBe(false);
  });

  it('feature NICHT in der Liste → false', () => {
    expect(supportsFeature(['other-feature'], 'order-envelope-v2')).toBe(false);
  });

  it('exakter Match erforderlich (kein Präfix/Teilstring) → false', () => {
    expect(supportsFeature(['order-envelope-v20'], 'order-envelope-v2')).toBe(false);
    expect(supportsFeature(['order-envelope'], 'order-envelope-v2')).toBe(false);
  });
});

describe('supportsFeature — total gegen malformed/geforgte Daten (kein throw)', () => {
  it('Nicht-Array (geforgt: String/Objekt/Zahl) → false', () => {
    expect(supportsFeature('order-envelope-v2', 'order-envelope-v2')).toBe(false);
    expect(supportsFeature({ 0: 'order-envelope-v2' }, 'order-envelope-v2')).toBe(false);
    expect(supportsFeature(42, 'order-envelope-v2')).toBe(false);
  });

  it('Liste mit non-string-Elementen matcht einen string-feature nie → false, kein throw', () => {
    expect(supportsFeature([123, null, { x: 1 }], 'order-envelope-v2')).toBe(false);
    // gemischt: der echte string-Treffer zählt trotzdem
    expect(supportsFeature([123, 'order-envelope-v2', null], 'order-envelope-v2')).toBe(true);
  });

  it('leeres/nicht-string feature → false (kein Match auf leere/geforgte Abfrage)', () => {
    expect(supportsFeature(['order-envelope-v2'], '')).toBe(false);
    expect(supportsFeature([''], '')).toBe(false); // leeres feature bleibt false, auch wenn '' gelistet
    expect(supportsFeature(['x'], 123 as unknown as string)).toBe(false);
    expect(supportsFeature(['x'], undefined as unknown as string)).toBe(false);
  });
});
