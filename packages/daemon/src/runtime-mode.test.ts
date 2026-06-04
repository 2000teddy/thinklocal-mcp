import { describe, expect, it } from 'vitest';
import { isLoopbackHost, resolveRuntimeSettings, runtimeModeFromFlags } from './runtime-mode.js';

describe('runtimeModeFromFlags (CLI flag → mode; restart must forward these)', () => {
  it('--lan → lan', () => {
    expect(runtimeModeFromFlags(['--lan'])).toBe('lan');
  });
  it('--local → local', () => {
    expect(runtimeModeFromFlags(['--local'])).toBe('local');
  });
  it('no flag → fallback (default local; explicit fallback respected)', () => {
    expect(runtimeModeFromFlags([])).toBe('local');
    expect(runtimeModeFromFlags([], 'lan')).toBe('lan');
  });
  it('REGRESSION: empty flags (the old restart bug) yields the fallback, not the intended --lan', () => {
    // The restart bug dropped flags → cmdStart received [] → fallback, NOT 'lan'.
    // With the fix, restart forwards ['--lan'] so the mode resolves to 'lan'.
    expect(runtimeModeFromFlags([], 'local')).toBe('local'); // what the bug produced
    expect(runtimeModeFromFlags(['--lan'], 'local')).toBe('lan'); // what the fix forwards
  });
  it('--local wins when both present', () => {
    expect(runtimeModeFromFlags(['--local', '--lan'])).toBe('local');
  });
});

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
