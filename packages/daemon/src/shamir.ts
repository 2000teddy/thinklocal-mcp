/**
 * shamir.ts — Shamir's Secret Sharing fuer hochwertige Credentials
 *
 * Teilt ein Secret in N Shares auf, von denen K zum Rekonstruieren noetig sind.
 * Use-Cases:
 * - Master-Key auf mehrere Nodes verteilen (kein Single Point of Failure)
 * - Hochwertige Credentials (Root-CA-Key) schuetzen
 * - Recovery: K von N Admins muessen zustimmen um Secret wiederherzustellen
 */

// @ts-expect-error — shamir has no type declarations
import shamir from 'shamir';
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';

export interface ShamirShare {
  /** Share-Index (1-basiert) */
  index: number;
  /** Share-Daten (Base64) */
  data: string;
}

export interface ShamirConfig {
  /** Anzahl der Shares (N) */
  totalShares: number;
  /** Benoetigte Shares zum Rekonstruieren (K) */
  threshold: number;
}

/**
 * Teilt ein Secret in N Shares auf.
 * Mindestens `threshold` Shares werden zum Rekonstruieren benoetigt.
 */
export function splitSecret(
  secret: string,
  config: ShamirConfig,
  log?: Logger,
): ShamirShare[] {
  if (config.threshold < 2) throw new Error('Threshold muss mindestens 2 sein');
  if (config.totalShares < config.threshold) throw new Error('totalShares muss >= threshold sein');
  if (config.totalShares > 255) throw new Error('Maximal 255 Shares');

  const secretBytes = Buffer.from(secret, 'utf-8');
  const shares = shamir.split(randomBytes, config.totalShares, config.threshold, secretBytes);

  log?.info(
    { totalShares: config.totalShares, threshold: config.threshold },
    'Secret in Shares aufgeteilt',
  );

  return Object.entries(shares).map(([idx, data]) => ({
    index: Number(idx),
    data: Buffer.from(data as Uint8Array).toString('base64'),
  }));
}

/**
 * Rekonstruiert ein Secret aus mindestens K Shares.
 */
export function combineShares(
  shares: ShamirShare[],
  log?: Logger,
): string {
  if (shares.length < 2) throw new Error('Mindestens 2 Shares zum Rekonstruieren benoetigt');

  const shareMap: Record<number, Uint8Array> = {};
  for (const share of shares) {
    shareMap[share.index] = Buffer.from(share.data, 'base64');
  }

  const recovered = shamir.join(shareMap);
  log?.info({ sharesUsed: shares.length }, 'Secret aus Shares rekonstruiert');
  return Buffer.from(recovered).toString('utf-8');
}
