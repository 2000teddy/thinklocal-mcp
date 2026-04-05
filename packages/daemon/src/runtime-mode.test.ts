import { describe, expect, it } from 'vitest';
import { isLoopbackHost, resolveRuntimeSettings } from './runtime-mode.js';

describe('runtime-mode', () => {
  it('nutzt lokalen Default fuer local mode', () => {
    const settings = resolveRuntimeSettings({ mode: 'local', port: 9440 });
    expect(settings.bindHost).toBe('127.0.0.1');
    expect(settings.tlsEnabled).toBe(false);
    expect(settings.localDaemonUrl).toBe('http://localhost:9440');
  });

  it('nutzt TLS und 0.0.0.0 fuer lan mode', () => {
    const settings = resolveRuntimeSettings({ mode: 'lan', port: 9440 });
    expect(settings.bindHost).toBe('0.0.0.0');
    expect(settings.tlsEnabled).toBe(true);
    expect(settings.localDaemonUrl).toBe('https://localhost:9440');
  });

  it('erkennt Loopback-Hosts korrekt', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.42')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('10.10.10.55')).toBe(false);
  });
});
