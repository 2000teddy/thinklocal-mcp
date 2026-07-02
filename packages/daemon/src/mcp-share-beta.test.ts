/**
 * mcp-share-beta.test.ts — v5 Spur 3 T3.1 (Modell B Beta, Christian-Gate Q1 = JA):
 * Regressionsguard, dass die AUSGELIEFERTE `config/daemon.toml` `pal` + `unifi` als
 * geteilte MCPs deklariert (remote-forward-only) und korrekt zu `mcp:pal`/`mcp:unifi`
 * gebaut werden. Verhindert ein stilles Zurückrutschen der Beta-Share-Deklaration.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadConfig } from './config.js';
import { buildSharedMcpCapabilities } from './mcp-registration.js';
import { enabledSharedMcps, parseSharedMcpConfig } from './mcp-share-config.js';

// packages/daemon/src → Repo-Wurzel/config/daemon.toml
const REPO_CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'config', 'daemon.toml');
const SELF = 'spiffe://thinklocal/node/12D3KooWHUB';
const NOW = '2026-07-01T00:00:00.000Z';

describe('config/daemon.toml — Modell-B-Beta-Share (T3.1)', () => {
  it('deklariert pal + unifi als geteilt (share=true, default-open)', () => {
    const cfg = loadConfig(REPO_CONFIG);
    const enabled = enabledSharedMcps(parseSharedMcpConfig(cfg.mcp.share)).map((d) => d.server);
    expect(enabled).toContain('pal');
    expect(enabled).toContain('unifi');
  });

  it('teilt KEINE knotengebundene Hardware (e3dc/idm) im Beta-Forward', () => {
    const cfg = loadConfig(REPO_CONFIG);
    const enabled = enabledSharedMcps(parseSharedMcpConfig(cfg.mcp.share)).map((d) => d.server);
    expect(enabled).not.toContain('e3dc');
    expect(enabled).not.toContain('idm');
  });

  it('baut mcp:pal + mcp:unifi als category=mcp mit read-only-Beta-Stufe self', () => {
    const cfg = loadConfig(REPO_CONFIG);
    const { capabilities, skipped } = buildSharedMcpCapabilities(cfg.mcp.share, SELF, NOW);
    expect(skipped).toEqual([]);
    const byId = new Map(capabilities.map((c) => [c.skill_id, c]));
    const pal = byId.get('mcp:pal');
    const unifi = byId.get('mcp:unifi');
    expect(pal?.category).toBe('mcp');
    expect(unifi?.category).toBe('mcp');
    expect(pal?.agent_id).toBe(SELF);
    // read-only-Beta (query / network.read, hohes Trust) → abgeleitete Stufe self.
    // (execution_tier ist am CRDT-Eintrag gestrippt; Ableitung erfolgt im Resolver —
    //  hier verifizieren wir, dass der Bau OHNE Skip/gate-Erzwingung durchläuft.)
    expect(capabilities.map((c) => c.skill_id).sort()).toEqual(['mcp:pal', 'mcp:unifi']);
  });
});
