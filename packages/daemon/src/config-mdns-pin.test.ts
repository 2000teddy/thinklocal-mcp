/**
 * config-mdns-pin.test.ts — Regression fuer das .55-Workaround-Flag
 * `disable_mdns_interface_pin` (CR-LOW gpt-5.5, 2026-06-08).
 *
 * Verifiziert die Config-/Env-Verdrahtung von loadConfig():
 * - Default ist false (Linux/Standard-Nodes pinnen wie bisher)
 * - TLMCP_DISABLE_MDNS_INTERFACE_PIN=1 → true (opt-in)
 * - TLMCP_DISABLE_MDNS_INTERFACE_PIN=0 → explizit false
 *
 * Siehe discovery.ts (resolveBonjourOptions) + ADR-019.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

// Nicht-existenter Pfad → loadConfig faellt auf DEFAULTS zurueck (kein TOML-Merge),
// so testen wir ausschliesslich den Default + Env-Override-Pfad.
const NO_TOML = join(tmpdir(), 'thinklocal-nonexistent-config-xyz.toml');

describe('loadConfig: disable_mdns_interface_pin (.55-Workaround)', () => {
  afterEach(() => {
    delete process.env['TLMCP_DISABLE_MDNS_INTERFACE_PIN'];
  });

  it('Default ist false (kein Env, kein TOML)', () => {
    delete process.env['TLMCP_DISABLE_MDNS_INTERFACE_PIN'];
    const cfg = loadConfig(NO_TOML);
    expect(cfg.discovery.disable_mdns_interface_pin).toBe(false);
  });

  it('TLMCP_DISABLE_MDNS_INTERFACE_PIN=1 → true', () => {
    process.env['TLMCP_DISABLE_MDNS_INTERFACE_PIN'] = '1';
    const cfg = loadConfig(NO_TOML);
    expect(cfg.discovery.disable_mdns_interface_pin).toBe(true);
  });

  it('TLMCP_DISABLE_MDNS_INTERFACE_PIN=0 → false (explizites Opt-out)', () => {
    process.env['TLMCP_DISABLE_MDNS_INTERFACE_PIN'] = '0';
    const cfg = loadConfig(NO_TOML);
    expect(cfg.discovery.disable_mdns_interface_pin).toBe(false);
  });
});
