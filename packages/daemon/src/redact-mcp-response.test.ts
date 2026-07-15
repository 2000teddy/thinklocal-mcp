// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * redact-mcp-response.test.ts — ADR-041 (TL-08 Slice 2b). Deckt die fail-closed-Invarianten der
 * owner-seitigen Redaction (CO opus+sonnet): deny-by-default (unbekannter Key → redigiert), fail-closed
 * bei Skalar/Rahmen-Überschreitung, purity/idempotenz, und „wired ≠ exposed" (Gate-still-blocks).
 */
import { describe, it, expect } from 'vitest';
import {
  redactByAllowlist,
  redactSensitiveResult,
  REDACTED,
} from './redact-mcp-response.js';
import { deriveToolTierForServer, SERVER_TOOL_CLASSES } from './mcp-service-registry.js';

describe('redactByAllowlist (deny-by-default Projektion)', () => {
  const safe = new Set(['ssid', 'data', 'vlan', 'items']);

  it('safe-Key überlebt (rekursiv), unbekannter Key → [REDACTED]', () => {
    const r = redactByAllowlist(
      { ssid: 'home', x_passphrase: 'sekret', data: { vlan: 5, x_key: 'z' } },
      safe,
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ ssid: 'home', x_passphrase: REDACTED, data: { vlan: 5, x_key: REDACTED } });
  });

  it('Arrays: elementweise projiziert', () => {
    const r = redactByAllowlist({ items: [{ ssid: 'a', pw: 'x' }, { ssid: 'b', pw: 'y' }] }, safe);
    expect(r.value).toEqual({ items: [{ ssid: 'a', pw: REDACTED }, { ssid: 'b', pw: REDACTED }] });
  });

  it('leere Safe-Liste → alle Keys redigiert', () => {
    const r = redactByAllowlist({ a: 1, b: { c: 2 } }, new Set<string>());
    expect(r.value).toEqual({ a: REDACTED, b: REDACTED });
  });

  it('CR-HIGH: Top-Level-Array skalarer Secrets → alle Elemente redigiert (kein Leak)', () => {
    // list_vouchers-Shape: nichts ist safe-gelistet → jedes Skalar-Element muss redigiert werden.
    const r = redactByAllowlist(['ABCD-1234', 'EFGH-5678'], new Set<string>());
    expect(r.ok).toBe(true);
    expect(r.value).toEqual([REDACTED, REDACTED]);
    expect(JSON.stringify(r.value)).not.toContain('ABCD-1234');
  });

  it('CR-HIGH: gemischtes Array (Objekt + skalares Secret) → beide redigiert', () => {
    const r = redactByAllowlist([{ ssid: 'a', pw: 'x' }, 'S3CR3T'], new Set(['ssid']));
    expect(r.value).toEqual([{ ssid: 'a', pw: REDACTED }, REDACTED]);
  });

  it('safe-Key mit Array skalarer Werte → Elemente überleben (erlaubter Kontext)', () => {
    const r = redactByAllowlist({ ssids: ['home', 'guest'], x_pw: 's' }, new Set(['ssids']));
    expect(r.value).toEqual({ ssids: ['home', 'guest'], x_pw: REDACTED });
  });

  it('mutiert die Eingabe nicht (purity)', () => {
    const input = { ssid: 'home', x_passphrase: 'sekret' };
    redactByAllowlist(input, safe);
    expect(input.x_passphrase).toBe('sekret');
  });

  it('bounded: zu tiefe Struktur → ok=false (fail-closed)', () => {
    let deep: Record<string, unknown> = { data: 'leaf' };
    for (let i = 0; i < 40; i++) deep = { data: deep };
    expect(redactByAllowlist(deep, safe).ok).toBe(false);
  });

  it('bounded: zu viele Nodes → ok=false (fail-closed)', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 10_050; i++) wide[`k${i}`] = i;
    expect(redactByAllowlist(wide, safe).ok).toBe(false);
  });
});

describe('redactSensitiveResult (ADR-041, owner-seitig)', () => {
  it('nicht-sensitives Tool → passthrough (byte-unverändert)', () => {
    const body = { count: 2, data: [{ mac: 'aa' }] };
    const r = redactSensitiveResult('unifi', 'list_clients', body);
    expect(r.outcome).toBe('passthrough');
    expect(r.result).toBe(body);
  });

  it('SECURITY: sensitives Tool (get_wlan) → redacted, kein Secret im Ergebnis (leere Safe-Liste)', () => {
    const r = redactSensitiveResult('unifi', 'get_wlan', { ssid: 'home', x_passphrase: 'TOPSECRET' });
    expect(r.outcome).toBe('redacted');
    expect(JSON.stringify(r.result)).not.toContain('TOPSECRET');
    expect(r.result).toEqual({ ssid: REDACTED, x_passphrase: REDACTED });
  });

  it('SECURITY CR-HIGH: sensitives Tool mit Top-Level-Array skalarer Secrets → alle redigiert', () => {
    const r = redactSensitiveResult('unifi', 'list_vouchers', ['ABCD-1234', 'EFGH-5678']);
    expect(r.outcome).toBe('redacted');
    expect(JSON.stringify(r.result)).not.toContain('ABCD-1234');
    expect(r.result).toEqual([REDACTED, REDACTED]);
  });

  it('fail-closed: sensitives Tool mit Skalar-/null-Ergebnis → Notiz statt Rohwert', () => {
    for (const scalar of ['a-raw-string-secret', 42, null]) {
      const r = redactSensitiveResult('unifi', 'list_wlans', scalar);
      expect(r.outcome).toBe('fail-closed');
      expect(r.result).toMatchObject({ thinklocalRedaction: 'fail-closed', server: 'unifi', tool: 'list_wlans' });
      expect(JSON.stringify(r.result)).not.toContain('a-raw-string-secret');
    }
  });

  it('fail-closed: sensitives Tool mit Rahmen-Überschreitung (Node-Cap) → Notiz', () => {
    // Leere Safe-Liste ⇒ keine Rekursion; der Node-Cap greift über die BREITE des Top-Objekts.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 10_050; i++) wide[`k${i}`] = i;
    const r = redactSensitiveResult('unifi', 'get_network', wide);
    expect(r.outcome).toBe('fail-closed');
  });

  it('Kanonisierung: UNIFI (uppercase) wird als governed/sensitive erkannt', () => {
    expect(redactSensitiveResult('UNIFI', 'get_wlan', { x: 1 }).outcome).toBe('redacted');
  });

  it('idempotent: erneutes Redigieren eines redigierten Ergebnisses bleibt stabil', () => {
    const once = redactSensitiveResult('unifi', 'get_wlan', { ssid: 'home', x_passphrase: 'S' });
    const twice = redactSensitiveResult('unifi', 'get_wlan', once.result);
    expect(twice.outcome).toBe('redacted');
    expect(JSON.stringify(twice.result)).not.toContain('home');
  });
});

// „wired ≠ exposed": 2b verdrahtet den Redactor, aber ALLE 10 sensitiven Tools bleiben am Ingress gegatet.
describe('Gate-still-blocks-Regression (ADR-041 — kein Gate-Flip in 2b)', () => {
  const callFor = (name: string): unknown => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });
  it('jedes sensitive unifi-Tool → deriveToolTierForServer = gate (nicht self)', () => {
    const sensitive = SERVER_TOOL_CLASSES['unifi']?.sensitive;
    expect(sensitive && sensitive.size).toBe(10);
    for (const tool of sensitive ?? []) {
      expect(deriveToolTierForServer('unifi', callFor(tool))).not.toBe('self');
    }
  });
});
