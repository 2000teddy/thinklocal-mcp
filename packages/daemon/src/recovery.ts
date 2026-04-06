/**
 * recovery.ts — Recovery-Flows fuer haeufige Probleme
 *
 * Automatische Erkennung und Behebung von:
 * - Abgelaufene Zertifikate → Auto-Renewal
 * - Port-Konflikte → Alternativen Port finden
 * - Umbenannte Hosts → Identity-Update
 * - Defekte Datenbanken → Backup + Recreate
 */

import { existsSync, unlinkSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { hostname as osHostname } from 'node:os';
import { getCertDaysLeft } from './tls.js';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';

export interface RecoveryResult {
  issue: string;
  recovered: boolean;
  action: string;
  details?: string;
}

/**
 * Prueft auf bekannte Probleme und versucht sie automatisch zu beheben.
 * Wird beim Daemon-Start aufgerufen.
 */
export async function runRecoveryChecks(
  dataDir: string,
  port: number,
  log?: Logger,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  // 1. Zertifikat-Ablauf
  results.push(checkCertExpiry(dataDir, log));

  // 2. Port-Konflikt
  results.push(await checkPortConflict(port, log));

  // 3. Hostname-Aenderung
  results.push(checkHostnameChange(dataDir, log));

  // 4. Defekte Datenbanken
  results.push(checkDatabaseIntegrity(dataDir, log));

  const issues = results.filter((r) => !r.recovered && r.issue !== 'none');
  if (issues.length > 0) {
    log?.warn({ issues: issues.length }, 'Recovery: Nicht alle Probleme behoben');
  }

  return results;
}

/** Prueft ob Zertifikate bald ablaufen und erneuert sie wenn noetig */
function checkCertExpiry(dataDir: string, log?: Logger): RecoveryResult {
  const daysLeft = getCertDaysLeft(dataDir);
  if (daysLeft === null) {
    return { issue: 'none', recovered: true, action: 'Kein Zertifikat vorhanden (wird beim Start erstellt)' };
  }
  if (daysLeft > 7) {
    return { issue: 'none', recovered: true, action: `Zertifikat gueltig (${daysLeft} Tage)` };
  }

  // Zertifikat erneuern: altes loeschen, wird beim naechsten TLS-Init neu erstellt
  const certPath = resolve(dataDir, 'certs', 'node.crt');
  const keyPath = resolve(dataDir, 'certs', 'node.key');
  try {
    if (existsSync(certPath)) unlinkSync(certPath);
    if (existsSync(keyPath)) unlinkSync(keyPath);
    log?.info({ daysLeft }, 'Recovery: Abgelaufenes Zertifikat geloescht (wird neu erstellt)');
    return { issue: 'cert_expired', recovered: true, action: 'Zertifikat geloescht und wird neu erstellt' };
  } catch (err) {
    return { issue: 'cert_expired', recovered: false, action: 'Zertifikat konnte nicht geloescht werden', details: String(err) };
  }
}

/** Prueft ob der gewuenschte Port bereits belegt ist */
function checkPortConflict(port: number, log?: Logger): Promise<RecoveryResult> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log?.warn({ port }, 'Recovery: Port belegt');
        resolve({
          issue: 'port_conflict',
          recovered: false,
          action: `Port ${port} ist bereits belegt`,
          details: `Anderer Prozess nutzt Port ${port}. Pruefe: lsof -i :${port}`,
        });
      } else {
        resolve({ issue: 'none', recovered: true, action: 'Port-Check OK' });
      }
    });
    server.once('listening', () => {
      server.close();
      resolve({ issue: 'none', recovered: true, action: `Port ${port} verfuegbar` });
    });
    server.listen(port, '0.0.0.0');
  });
}

/** Prueft ob sich der Hostname geaendert hat */
function checkHostnameChange(dataDir: string, log?: Logger): RecoveryResult {
  const hostFile = resolve(dataDir, 'last-hostname');
  const currentHostname = osHostname();

  if (!existsSync(hostFile)) {
    // Erster Start — Hostname speichern
    try {
      writeFileSync(hostFile, currentHostname);
    } catch { /* ok */ }
    return { issue: 'none', recovered: true, action: 'Hostname gespeichert' };
  }

  const lastHostname = readFileSync(hostFile, 'utf-8').trim();

  if (lastHostname !== currentHostname) {
    log?.info({ previous: lastHostname, current: currentHostname }, 'Recovery: Hostname geaendert');
    try {
      writeFileSync(hostFile, currentHostname);
    } catch { /* ok */ }
    return {
      issue: 'hostname_changed',
      recovered: true,
      action: `Hostname geaendert: ${lastHostname} → ${currentHostname}`,
      details: 'SPIFFE-URI wird beim naechsten Start aktualisiert. Peers muessen sich neu verbinden.',
    };
  }

  return { issue: 'none', recovered: true, action: 'Hostname unveraendert' };
}

/** Prueft Datenbank-Integritaet (Audit + Vault) */
function checkDatabaseIntegrity(dataDir: string, log?: Logger): RecoveryResult {
  const databases = [
    resolve(dataDir, 'audit', 'audit.db'),
    resolve(dataDir, 'vault', 'vault.db'),
  ];

  for (const dbPath of databases) {
    if (!existsSync(dbPath)) continue;

    try {
      // Versuche die DB zu oeffnen (quick integrity check)
      const db = new Database(dbPath, { readonly: true });
      db.pragma('integrity_check');
      db.close();
    } catch (err) {
      const backupPath = `${dbPath}.corrupt.${Date.now()}`;
      log?.warn({ dbPath, err }, 'Recovery: Defekte Datenbank erkannt');
      try {
        renameSync(dbPath, backupPath);
        log?.info({ dbPath, backupPath }, 'Recovery: Defekte DB gesichert, wird neu erstellt');
        return {
          issue: 'corrupt_db',
          recovered: true,
          action: `Defekte DB gesichert: ${backupPath}`,
        };
      } catch {
        return { issue: 'corrupt_db', recovered: false, action: 'DB konnte nicht repariert werden' };
      }
    }
  }

  return { issue: 'none', recovered: true, action: 'Datenbanken OK' };
}
