/**
 * qr-pairing.ts — QR-Code-Alternative fuer Pairing
 *
 * Statt einer 6-stelligen PIN wird ein QR-Code im Terminal angezeigt.
 * Der QR-Code enthaelt eine URL mit einem einmaligen Pairing-Token.
 * Vorteile:
 * - Groesserer Schluesselraum (32 Byte Token statt 6 Ziffern)
 * - Schnelleres Pairing (scannen statt tippen)
 * - Funktioniert mit Mobile-Apps (Zukunft)
 */

import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';

// qrcode-terminal hat keine Types — dynamischer Import
let qrcodeTerminal: { generate: (text: string, opts: { small: boolean }, cb: (code: string) => void) => void } | null = null;

async function loadQrModule(): Promise<typeof qrcodeTerminal> {
  if (!qrcodeTerminal) {
    try {
      // @ts-expect-error — qrcode-terminal has no type declarations
      const mod = await import('qrcode-terminal');
      qrcodeTerminal = mod.default ?? mod;
    } catch {
      return null;
    }
  }
  return qrcodeTerminal;
}

export interface QrPairingData {
  /** Einmaliger Pairing-Token (32 Byte, hex) */
  token: string;
  /** Pairing-URL */
  url: string;
  /** QR-Code als ASCII-Art (fuer Terminal) */
  qrCode: string;
  /** Ablaufzeit (ISO 8601) */
  expiresAt: string;
}

/**
 * Generiert QR-Code Pairing-Daten.
 * Der QR-Code enthaelt eine URL die vom anderen Node gescannt wird.
 */
export async function generateQrPairing(
  daemonHost: string,
  daemonPort: number,
  log?: Logger,
): Promise<QrPairingData> {
  const token = randomBytes(32).toString('hex');
  const url = `http://${daemonHost}:${daemonPort}/pairing/qr?token=${token}`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 Minuten

  let qrCode = `[QR-Code nicht verfuegbar — Token: ${token.slice(0, 16)}...]`;

  const qr = await loadQrModule();
  if (qr) {
    qrCode = await new Promise<string>((resolve) => {
      qr.generate(url, { small: true }, (code) => {
        resolve(code);
      });
    });
  }

  log?.info({ token: token.slice(0, 8) + '...', expiresAt }, 'QR-Pairing generiert');

  return { token, url, qrCode, expiresAt };
}

/**
 * Validiert einen QR-Pairing-Token.
 * Gibt true zurueck wenn der Token gueltig und nicht abgelaufen ist.
 */
export function validateQrToken(
  token: string,
  validTokens: Map<string, string>, // token → expiresAt
): boolean {
  const expiresAt = validTokens.get(token);
  if (!expiresAt) return false;
  if (new Date(expiresAt) < new Date()) {
    validTokens.delete(token);
    return false;
  }
  // Einmalverwendung — Token nach Validierung loeschen
  validTokens.delete(token);
  return true;
}
