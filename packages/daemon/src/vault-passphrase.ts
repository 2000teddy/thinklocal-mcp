import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { createKeychainStore, type KeychainStore } from './keychain.js';

const KEYCHAIN_ACCOUNT = 'vault-passphrase';

export interface VaultPassphraseDeps {
  keychain?: KeychainStore | null;
}

/**
 * Laedt die Vault-Passphrase aus Env, OS-Keychain oder Dateifallback.
 * Es gibt absichtlich keinen hardcoded Default.
 */
export function loadOrCreateVaultPassphrase(
  dataDir: string,
  envPassphrase?: string,
  log?: Logger,
  deps?: VaultPassphraseDeps,
): string {
  if (envPassphrase && envPassphrase.trim()) {
    return envPassphrase;
  }

  const keychain = deps?.keychain ?? createKeychainStore(log);
  const passphrasePath = resolve(dataDir, 'vault', 'passphrase');

  const fromKeychain = keychain?.get(KEYCHAIN_ACCOUNT);
  if (fromKeychain) {
    return fromKeychain;
  }

  if (existsSync(passphrasePath)) {
    const fromFile = readFileSync(passphrasePath, 'utf-8').trim();
    if (fromFile) {
      keychain?.set(KEYCHAIN_ACCOUNT, fromFile);
      return fromFile;
    }
  }

  const generated = randomBytes(32).toString('hex');
  if (keychain?.set(KEYCHAIN_ACCOUNT, generated)) {
    log?.info('Vault-Passphrase generiert und im OS-Keychain gespeichert');
    return generated;
  }

  mkdirSync(resolve(dataDir, 'vault'), { recursive: true });
  writeFileSync(passphrasePath, `${generated}\n`, { mode: 0o600 });
  log?.warn('Vault-Passphrase generiert und als Datei gespeichert (Keychain nicht verfuegbar)');
  return generated;
}
