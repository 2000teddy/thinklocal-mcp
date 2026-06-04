import { describe, it, expect } from 'vitest';
import {
  collectSkillServiceDeps,
  serviceUnitDependencyLines,
  BUILTIN_SKILL_SERVICE_DEPS,
} from './service-dependencies.js';

describe('collectSkillServiceDeps', () => {
  it('vereinigt + sortiert + dedupliziert die requirements.services', () => {
    expect(
      collectSkillServiceDeps([
        { requirements: { services: ['influxdb'] } },
        { requirements: { services: ['influxdb', 'ollama'] } },
        { requirements: { os: ['linux'] } as { services?: string[] } },
        {},
      ]),
    ).toEqual(['influxdb', 'ollama']);
  });

  it('leere Liste → []', () => {
    expect(collectSkillServiceDeps([{}, { requirements: {} }])).toEqual([]);
  });

  it('die eingebauten Skills deklarieren influxdb (system-monitor hat keine)', () => {
    expect(BUILTIN_SKILL_SERVICE_DEPS).toEqual(['influxdb']);
  });
});

describe('serviceUnitDependencyLines (Boot-Race-Schutz, generisch + host-conditional)', () => {
  it('influxdb-abhängiger Agent, Service-Unit vorhanden → After=/Wants=influxdb.service', () => {
    const lines = serviceUnitDependencyLines(['influxdb'], (svc) => svc === 'influxdb');
    expect(lines).toEqual(['After=influxdb.service', 'Wants=influxdb.service']);
  });

  it('Agent OHNE externe Service-Abhängigkeit → keine Zeilen', () => {
    expect(serviceUnitDependencyLines([], () => true)).toEqual([]);
  });

  it('deklarierte Abhängigkeit, aber Service-Unit NICHT auf dem Host → keine Zeilen (kein hängendes Wants=)', () => {
    expect(serviceUnitDependencyLines(['influxdb'], () => false)).toEqual([]);
  });

  it('mehrere Deps, nur vorhandene werden emittiert (sortiert, ohne Duplikate)', () => {
    const present = new Set(['influxdb']);
    const lines = serviceUnitDependencyLines(['ollama', 'influxdb', 'influxdb'], (svc) => present.has(svc));
    expect(lines).toEqual(['After=influxdb.service', 'Wants=influxdb.service']);
  });
});
