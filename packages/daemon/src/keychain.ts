/**
 * keychain.ts — OS-Keychain-Integration (macOS Keychain + Linux libsecret)
 *
 * Keine native npm-Dependencies — nutzt System-Befehle:
 * - macOS: `security` CLI (Keychain Access)
 * - Linux: `secret-tool` CLI (libsecret / GNOME Keyring)
 *
 * SECURITY: Alle Befehle nutzen execFileSync (Array-Argumente)
 * statt execSync (Shell-String) um Shell-Injection zu verhindern.
 *
 * Fallback: Wenn Keychain nicht verfuegbar, wird null zurueckgegeben
 * und der Vault nutzt die Datei-basierte Verschluesselung.
 */

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import type { Logger } from 'pino';

const SERVICE_NAME = 'thinklocal-mcp';
const PLATFORM = platform();

export interface KeychainStore {
  /** Speichert einen Wert im OS-Keychain */
  set(account: string, value: string): boolean;
  /** Liest einen Wert aus dem OS-Keychain */
  get(account: string): string | null;
  /** Loescht einen Wert aus dem OS-Keychain */
  delete(account: string): boolean;
  /** Prueft ob der Keychain verfuegbar ist */
  isAvailable(): boolean;
}

/**
 * Erstellt einen Keychain-Store fuer die aktuelle Plattform.
 * Gibt null zurueck wenn keine Keychain verfuegbar ist.
 */
export function createKeychainStore(log?: Logger): KeychainStore | null {
  if (PLATFORM === 'darwin') {
    const store = new MacOSKeychain(log);
    if (store.isAvailable()) return store;
  } else if (PLATFORM === 'linux') {
    const store = new LinuxSecretStore(log);
    if (store.isAvailable()) return store;
  }
  log?.debug({ platform: PLATFORM }, 'Kein OS-Keychain verfuegbar — Datei-Fallback');
  return null;
}

// --- macOS Keychain (security CLI) ---

class MacOSKeychain implements KeychainStore {
  constructor(private log?: Logger) {}

  isAvailable(): boolean {
    try {
      execFileSync('which', ['security'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch { return false; }
  }

  set(account: string, value: string): boolean {
    try {
      // Erst loeschen falls vorhanden (update = delete + add)
      this.delete(account);
      // SECURITY: execFileSync mit Array-Argumenten (keine Shell-Interpolation)
      execFileSync('security', [
        'add-generic-password', '-s', SERVICE_NAME, '-a', account, '-w', value, '-U',
      ], { stdio: 'ignore', timeout: 5000 });
      this.log?.debug({ account }, 'Keychain: Wert gespeichert (macOS)');
      return true;
    } catch (err) {
      this.log?.warn({ account, err }, 'Keychain: Speichern fehlgeschlagen');
      return false;
    }
  }

  get(account: string): string | null {
    try {
      const result = execFileSync('security', [
        'find-generic-password', '-s', SERVICE_NAME, '-a', account, '-w',
      ], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      return result.toString().trim();
    } catch {
      return null;
    }
  }

  delete(account: string): boolean {
    try {
      execFileSync('security', [
        'delete-generic-password', '-s', SERVICE_NAME, '-a', account,
      ], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false; // Nicht vorhanden
    }
  }
}

// --- Linux Secret Store (secret-tool / libsecret) ---

class LinuxSecretStore implements KeychainStore {
  constructor(private log?: Logger) {}

  isAvailable(): boolean {
    try {
      execFileSync('which', ['secret-tool'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch { return false; }
  }

  set(account: string, value: string): boolean {
    try {
      // SECURITY: Wert via stdin uebergeben, nicht als Shell-Argument
      execFileSync('secret-tool', [
        'store', '--label', `${SERVICE_NAME}: ${account}`,
        'service', SERVICE_NAME, 'account', account,
      ], { input: value, stdio: ['pipe', 'ignore', 'ignore'], timeout: 10_000 });
      this.log?.debug({ account }, 'Keychain: Wert gespeichert (Linux)');
      return true;
    } catch (err) {
      this.log?.warn({ account, err }, 'Keychain: Speichern fehlgeschlagen');
      return false;
    }
  }

  get(account: string): string | null {
    try {
      const result = execFileSync('secret-tool', [
        'lookup', 'service', SERVICE_NAME, 'account', account,
      ], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      const val = result.toString().trim();
      return val || null;
    } catch {
      return null;
    }
  }

  delete(account: string): boolean {
    try {
      execFileSync('secret-tool', [
        'clear', 'service', SERVICE_NAME, 'account', account,
      ], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
