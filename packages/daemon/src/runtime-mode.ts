// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { isIP } from 'node:net';

export type RuntimeMode = 'local' | 'lan';

export interface RuntimeSettings {
  mode: RuntimeMode;
  bindHost: string;
  tlsEnabled: boolean;
  localDaemonUrl: string;
}

export function parseRuntimeMode(value?: string | null): RuntimeMode {
  return value === 'local' ? 'local' : 'lan';
}

/**
 * Leitet den Runtime-Modus aus CLI-Flags ab: `--local` → local, `--lan` → lan,
 * sonst `fallback`. Reine Funktion (shared zwischen CLI-Befehlen) — damit die
 * Modus-Wahl konsistent ist und Befehle wie `restart` ihre Flags nicht verlieren.
 */
export function runtimeModeFromFlags(flags: readonly string[], fallback: RuntimeMode = 'local'): RuntimeMode {
  if (flags.includes('--local')) return 'local';
  if (flags.includes('--lan')) return 'lan';
  return fallback;
}

export function resolveRuntimeSettings(args: {
  bindHost?: string | null;
  mode?: string | null;
  port: number;
  tlsEnabled?: boolean | null;
}): RuntimeSettings {
  const mode = parseRuntimeMode(args.mode);
  let bindHost = args.bindHost?.trim() || (mode === 'local' ? '127.0.0.1' : '0.0.0.0');
  // Enforce: local mode MUST bind to loopback only (security invariant)
  if (mode === 'local' && !isLoopbackHost(bindHost)) {
    bindHost = '127.0.0.1';
  }
  const tlsEnabled = args.tlsEnabled ?? (mode === 'lan');
  const proto = tlsEnabled ? 'https' : 'http';
  return {
    mode,
    bindHost,
    tlsEnabled,
    localDaemonUrl: `${proto}://localhost:${args.port}`,
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost') return true;
  if (normalized === '127.0.0.1') return true;
  if (normalized === '::1') return true;
  if (normalized === '::ffff:127.0.0.1') return true;
  if (isIP(normalized) === 4 && normalized.startsWith('127.')) return true;
  return false;
}
