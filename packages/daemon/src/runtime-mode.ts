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

export function resolveRuntimeSettings(args: {
  bindHost?: string | null;
  mode?: string | null;
  port: number;
  tlsEnabled?: boolean | null;
}): RuntimeSettings {
  const mode = parseRuntimeMode(args.mode);
  const bindHost = args.bindHost?.trim() || (mode === 'local' ? '127.0.0.1' : '0.0.0.0');
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
