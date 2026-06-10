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

describe('loadConfig: ADR-025 mdns_enabled + preferred_interfaces', () => {
  afterEach(() => {
    delete process.env['TLMCP_MDNS_ENABLED'];
    delete process.env['TLMCP_PREFERRED_INTERFACES'];
  });

  it('Defaults: mdns_enabled=true, preferred_interfaces=[]', () => {
    const cfg = loadConfig(NO_TOML);
    expect(cfg.discovery.mdns_enabled).toBe(true);
    expect(cfg.discovery.preferred_interfaces).toEqual([]);
  });

  it('TLMCP_MDNS_ENABLED=0 → false (static-only)', () => {
    process.env['TLMCP_MDNS_ENABLED'] = '0';
    expect(loadConfig(NO_TOML).discovery.mdns_enabled).toBe(false);
  });

  it('TLMCP_MDNS_ENABLED=1 → true', () => {
    process.env['TLMCP_MDNS_ENABLED'] = '1';
    expect(loadConfig(NO_TOML).discovery.mdns_enabled).toBe(true);
  });

  it('TLMCP_PREFERRED_INTERFACES="en10,en0" → geparste, getrimmte Liste', () => {
    process.env['TLMCP_PREFERRED_INTERFACES'] = ' en10 , en0 ';
    expect(loadConfig(NO_TOML).discovery.preferred_interfaces).toEqual(['en10', 'en0']);
  });
});

describe('loadConfig: ADR-026 auto_register_authenticated_peers', () => {
  afterEach(() => { delete process.env['TLMCP_AUTO_REGISTER_AUTH_PEERS']; });

  it('Default ist true', () => {
    expect(loadConfig(NO_TOML).discovery.auto_register_authenticated_peers).toBe(true);
  });
  it('TLMCP_AUTO_REGISTER_AUTH_PEERS=0 → false', () => {
    process.env['TLMCP_AUTO_REGISTER_AUTH_PEERS'] = '0';
    expect(loadConfig(NO_TOML).discovery.auto_register_authenticated_peers).toBe(false);
  });
  it('TLMCP_AUTO_REGISTER_AUTH_PEERS=1 → true', () => {
    process.env['TLMCP_AUTO_REGISTER_AUTH_PEERS'] = '1';
    expect(loadConfig(NO_TOML).discovery.auto_register_authenticated_peers).toBe(true);
  });
});
