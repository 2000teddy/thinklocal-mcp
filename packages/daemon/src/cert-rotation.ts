/**
 * cert-rotation.ts — Zertifikat-Rotation und Security-Lifecycle
 *
 * Automatische Erneuerung von Zertifikaten bevor sie ablaufen.
 * Kann als periodischer Check im Daemon-Lifecycle laufen.
 *
 * Features:
 * - Automatische Rotation bei < X Tagen Restlaufzeit
 * - Trust-Reset: Alle Pairing-Daten und Zertifikate zuruecksetzen
 * - Cert-Audit: Prueft alle lokalen Zertifikate auf Gueltigkeit
 */

import { existsSync, unlinkSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCertDaysLeft } from './tls.js';
import type { Logger } from 'pino';

export interface CertAuditResult {
  /** Gesamtanzahl der Zertifikate */
  total: number;
  /** Gueltige Zertifikate */
  valid: number;
  /** Bald ablaufende Zertifikate (< 30 Tage) */
  expiringSoon: number;
  /** Abgelaufene Zertifikate */
  expired: number;
  /** Details pro Zertifikat */
  details: Array<{
    file: string;
    daysLeft: number | null;
    status: 'valid' | 'expiring' | 'expired' | 'error';
  }>;
}

function isTokenOnboardedTls(dataDir: string): boolean {
  const caCertPath = resolve(dataDir, 'tls', 'ca.crt.pem');
  const caKeyPath = resolve(dataDir, 'tls', 'ca.key.pem');
  return existsSync(caCertPath) && !existsSync(caKeyPath);
}

/**
 * Prueft ob eine Zertifikat-Rotation noetig ist.
 * Gibt true zurueck wenn das Zertifikat erneuert werden sollte.
 */
export function needsRotation(dataDir: string, minDays = 7): boolean {
  const daysLeft = getCertDaysLeft(dataDir);
  if (daysLeft === null) return false; // Kein Cert vorhanden
  return daysLeft <= minDays;
}

/**
 * Rotiert das Node-Zertifikat (loescht das alte, wird beim naechsten TLS-Init neu erstellt).
 */
export function rotateCert(dataDir: string, log?: Logger): boolean {
  const certPath = resolve(dataDir, 'tls', 'node.crt.pem');
  const keyPath = resolve(dataDir, 'tls', 'node.key.pem');

  if (isTokenOnboardedTls(dataDir)) {
    log?.warn(
      'Zertifikat-Rotation abgebrochen: Token-onboarded Node hat keinen lokalen CA-Key; Re-Enroll erforderlich',
    );
    return false;
  }

  try {
    if (existsSync(certPath)) unlinkSync(certPath);
    if (existsSync(keyPath)) unlinkSync(keyPath);
    log?.info('Zertifikat rotiert (wird beim naechsten Start neu erstellt)');
    return true;
  } catch (err) {
    log?.warn({ err }, 'Zertifikat-Rotation fehlgeschlagen');
    return false;
  }
}

/**
 * Trust-Reset: Setzt alle Pairing-Daten und Peer-Trust zurueck.
 * ACHTUNG: Alle Peers muessen danach neu gepairt werden!
 */
export function trustReset(
  dataDir: string,
  log?: Logger,
): {
  certsRemoved: number;
  pairingReset: boolean;
} {
  if (isTokenOnboardedTls(dataDir)) {
    log?.warn(
      'Trust-Reset abgebrochen: Token-onboarded Node hat keinen lokalen CA-Key; Re-Enroll erforderlich',
    );
    return { certsRemoved: 0, pairingReset: false };
  }

  let certsRemoved = 0;

  // Node-Cert loeschen
  const certPath = resolve(dataDir, 'tls', 'node.crt.pem');
  const keyPath = resolve(dataDir, 'tls', 'node.key.pem');
  if (existsSync(certPath)) {
    unlinkSync(certPath);
    certsRemoved++;
  }
  if (existsSync(keyPath)) {
    unlinkSync(keyPath);
    certsRemoved++;
  }

  // Pairing-Store loeschen
  const pairingPath = resolve(dataDir, 'pairing', 'paired-peers.json');
  let pairingReset = false;
  if (existsSync(pairingPath)) {
    unlinkSync(pairingPath);
    pairingReset = true;
  }

  // CRL loeschen
  const crlPath = resolve(dataDir, 'certs', 'crl.json');
  if (existsSync(crlPath)) {
    unlinkSync(crlPath);
    certsRemoved++;
  }

  log?.warn(
    { certsRemoved, pairingReset },
    'Trust-Reset durchgefuehrt — alle Peers muessen neu gepairt werden',
  );

  return { certsRemoved, pairingReset };
}

/**
 * Prueft alle Zertifikate im tls/-Verzeichnis.
 */
export function auditCerts(dataDir: string, _log?: Logger): CertAuditResult {
  const certsDir = resolve(dataDir, 'tls');
  const result: CertAuditResult = {
    total: 0,
    valid: 0,
    expiringSoon: 0,
    expired: 0,
    details: [],
  };

  if (!existsSync(certsDir)) return result;

  try {
    const files = readdirSync(certsDir).filter((f) => f.endsWith('.crt.pem'));
    result.total = files.length;

    for (const file of files) {
      try {
        const forge = require('node-forge');
        const certPem = readFileSync(resolve(certsDir, file), 'utf-8');
        const cert = forge.pki.certificateFromPem(certPem);
        const now = new Date();
        const daysLeft = Math.floor(
          (cert.validity.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        let status: 'valid' | 'expiring' | 'expired' | 'error';
        if (daysLeft <= 0) {
          status = 'expired';
          result.expired++;
        } else if (daysLeft <= 30) {
          status = 'expiring';
          result.expiringSoon++;
        } else {
          status = 'valid';
          result.valid++;
        }

        result.details.push({ file, daysLeft, status });
      } catch {
        result.details.push({ file, daysLeft: null, status: 'error' });
      }
    }
  } catch {
    /* certsDir nicht lesbar */
  }

  return result;
}
