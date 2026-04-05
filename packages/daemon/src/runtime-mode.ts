import { isIP } from 'node:net';

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost') return true;
  if (normalized === '127.0.0.1') return true;
  if (normalized === '::1') return true;
  if (normalized === '::ffff:127.0.0.1') return true;
  if (isIP(normalized) === 4 && normalized.startsWith('127.')) return true;
  return false;
}
