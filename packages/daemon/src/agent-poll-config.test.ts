// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit-Tests für agent-poll-config.ts (A5): Auflösung der Agent-Poll-Kadenz aus Env + Mode-Defaults,
 * inkl. Abgrenzung von TLMCP_HEARTBEAT_MS (dieses Modul betrifft NUR den Inbox-Poll, nicht den
 * Daemon-Peer-Heartbeat) und fail-safe-Verhalten bei Fehlkonfiguration.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAgentPollConfig,
  AGENT_POLL_MODE_DEFAULTS,
} from './agent-poll-config.js';

describe('resolveAgentPollConfig', () => {
  it('lan-Default: 5s → 30s ohne Env', () => {
    expect(resolveAgentPollConfig({}, 'lan')).toEqual({ initialMs: 5_000, maxMs: 30_000 });
  });

  it('local-Default: 2s → 15s ohne Env', () => {
    expect(resolveAgentPollConfig({}, 'local')).toEqual({ initialMs: 2_000, maxMs: 15_000 });
  });

  it('Env-Overrides gewinnen über die Mode-Defaults', () => {
    const r = resolveAgentPollConfig(
      { TLMCP_AGENT_POLL_INITIAL_MS: '1000', TLMCP_AGENT_POLL_MAX_MS: '8000' },
      'lan',
    );
    expect(r).toEqual({ initialMs: 1_000, maxMs: 8_000 });
  });

  it('nur INITIAL gesetzt → MAX bleibt Mode-Default (aber ≥ initial)', () => {
    expect(resolveAgentPollConfig({ TLMCP_AGENT_POLL_INITIAL_MS: '3000' }, 'lan')).toEqual({
      initialMs: 3_000,
      maxMs: 30_000,
    });
  });

  it('ungültige/≤0 Env-Werte → Fallback auf Mode-Default (fail-safe, kein Crash)', () => {
    expect(
      resolveAgentPollConfig(
        { TLMCP_AGENT_POLL_INITIAL_MS: 'abc', TLMCP_AGENT_POLL_MAX_MS: '-5' },
        'lan',
      ),
    ).toEqual({ initialMs: 5_000, maxMs: 30_000 });
    expect(resolveAgentPollConfig({ TLMCP_AGENT_POLL_INITIAL_MS: '0' }, 'local')).toEqual({
      initialMs: 2_000,
      maxMs: 15_000,
    });
  });

  it('Invariante maxMs ≥ initialMs: fehlkonfiguriertes max < initial wird auf initial angehoben', () => {
    const r = resolveAgentPollConfig(
      { TLMCP_AGENT_POLL_INITIAL_MS: '10000', TLMCP_AGENT_POLL_MAX_MS: '3000' },
      'lan',
    );
    expect(r).toEqual({ initialMs: 10_000, maxMs: 10_000 });
  });

  it('unbekannter Mode → lan-Fallback (defensiv)', () => {
    expect(resolveAgentPollConfig({}, 'bogus' as unknown as 'lan')).toEqual(
      AGENT_POLL_MODE_DEFAULTS.lan,
    );
  });
});
