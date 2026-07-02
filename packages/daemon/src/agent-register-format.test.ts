/**
 * Unit-Tests für die A1-Registrierungs-Diagnose (`agent-register-format.ts`):
 * ein HTTP-Fehler (z.B. 500) muss als solcher (Status + Body) sichtbar sein,
 * nicht als „daemon unreachable" fehlgedeutet.
 */
import { describe, it, expect } from 'vitest';
import { formatRegisterOutcome, formatUnregisterOutcome } from './agent-register-format.js';

const ID = 'mcp-stdio-4242';

describe('formatRegisterOutcome', () => {
  it('ok → "registered as <id>"', () => {
    expect(formatRegisterOutcome(ID, { kind: 'ok' })).toBe(`[mcp-stdio] registered as ${ID}`);
  });

  it('http (500) → zeigt Status + Body (NICHT „unreachable")', () => {
    const msg = formatRegisterOutcome(ID, {
      kind: 'http',
      status: 500,
      body: '{"error":"daemon misconfiguration: cannot derive instance SPIFFE URI"}',
    });
    expect(msg).toContain('registration failed: HTTP 500');
    expect(msg).toContain('daemon misconfiguration');
    expect(msg).not.toContain('unreachable');
  });

  it('error (Transport) → „daemon unreachable" mit Ursache', () => {
    const msg = formatRegisterOutcome(ID, { kind: 'error', message: 'connect ECONNREFUSED 127.0.0.1:9440' });
    expect(msg).toContain('registration skipped (daemon unreachable)');
    expect(msg).toContain('ECONNREFUSED');
  });

  it('http-Body wird auf eine Zeile normalisiert + gekürzt', () => {
    const long = 'x'.repeat(500);
    const msg = formatRegisterOutcome(ID, { kind: 'http', status: 502, body: `line1\n${long}` });
    expect(msg).toContain('HTTP 502');
    expect(msg).not.toContain('\n');
    expect(msg.endsWith('…')).toBe(true);
  });
});

describe('formatUnregisterOutcome', () => {
  it('ok → null (kein Rauschen; „unregister sent" wird separat geschrieben)', () => {
    expect(formatUnregisterOutcome(ID, { kind: 'ok' })).toBeNull();
  });

  it('http → präzise Zeile mit Status + id', () => {
    const msg = formatUnregisterOutcome(ID, { kind: 'http', status: 404, body: 'not found' });
    expect(msg).toContain(`unregister ${ID} failed: HTTP 404`);
    expect(msg).toContain('not found');
  });

  it('error → „daemon unreachable" mit Ursache + id', () => {
    const msg = formatUnregisterOutcome(ID, { kind: 'error', message: 'socket hang up' });
    expect(msg).toContain(`unregister ${ID} failed (daemon unreachable)`);
    expect(msg).toContain('socket hang up');
  });
});
