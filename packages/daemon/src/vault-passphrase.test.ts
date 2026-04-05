import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadOrCreateVaultPassphrase } from './vault-passphrase.js';
import type { KeychainStore } from './keychain.js';

function createFakeKeychain(): KeychainStore {
  const store = new Map<string, string>();
  return {
    set(account: string, value: string): boolean {
      store.set(account, value);
      return true;
    },
    get(account: string): string | null {
      return store.get(account) ?? null;
    },
    delete(account: string): boolean {
      return store.delete(account);
    },
    isAvailable(): boolean {
      return true;
    },
  };
}

describe('loadOrCreateVaultPassphrase', () => {
  it('bevorzugt explizite Env-Passphrase', () => {
    const passphrase = loadOrCreateVaultPassphrase('/tmp/irrelevant', 'explicit-secret');
    expect(passphrase).toBe('explicit-secret');
  });

  it('persistiert eine generierte Passphrase im Keychain-Store', () => {
    const keychain = createFakeKeychain();
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-vault-passphrase-'));

    try {
      const first = loadOrCreateVaultPassphrase(tmpDir, undefined, undefined, { keychain });
      const second = loadOrCreateVaultPassphrase(tmpDir, undefined, undefined, { keychain });
      expect(first).toBe(second);
      expect(first).toHaveLength(64);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('nutzt Dateifallback wenn kein Keychain verfuegbar ist', () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-vault-passphrase-file-'));

    try {
      const first = loadOrCreateVaultPassphrase(tmpDir, undefined, undefined, { keychain: null });
      const second = loadOrCreateVaultPassphrase(tmpDir, undefined, undefined, { keychain: null });
      const persisted = readFileSync(resolve(tmpDir, 'vault', 'passphrase'), 'utf-8').trim();

      expect(first).toBe(second);
      expect(first).toBe(persisted);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
