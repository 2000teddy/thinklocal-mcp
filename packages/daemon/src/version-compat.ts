/**
 * version-compat.ts — Versioning und Kompatibilitaetsmatrix
 *
 * Stellt sicher dass Nodes mit verschiedenen Versionen im Mesh koexistieren.
 * Graceful Degradation bei inkompatiblen Protokoll-Versionen.
 */

import { parseSemVer, compareSemVer, isCompatible } from './semver.js';
import type { Logger } from 'pino';

/** Aktuelle Protokoll-Version des Daemon */
export const PROTOCOL_VERSION = '1.0.0';

/** Minimale kompatible Version */
export const MIN_COMPATIBLE_VERSION = '0.20.0';

export interface VersionInfo {
  /** Daemon-Version (aus package.json) */
  daemonVersion: string;
  /** Protokoll-Version (Wire Protocol) */
  protocolVersion: string;
  /** Node.js-Version */
  nodeVersion: string;
}

export interface CompatibilityResult {
  /** Sind die Versionen kompatibel? */
  compatible: boolean;
  /** Warnung (bei Versionsunterschied aber noch kompatibel) */
  warning?: string;
  /** Fehler (bei Inkompatibilitaet) */
  error?: string;
  /** Empfohlene Aktion */
  action?: string;
}

/**
 * Prueft ob ein Remote-Peer kompatibel mit diesem Node ist.
 */
export function checkCompatibility(
  localVersion: string,
  remoteVersion: string,
  log?: Logger,
): CompatibilityResult {
  const local = parseSemVer(localVersion);
  const remote = parseSemVer(remoteVersion);

  if (!local || !remote) {
    return {
      compatible: false,
      error: `Ungueltige Version: local=${localVersion}, remote=${remoteVersion}`,
    };
  }

  // Gleiche Version = voll kompatibel
  if (compareSemVer(localVersion, remoteVersion) === 0) {
    return { compatible: true };
  }

  // Gleiche Major = kompatibel mit Warnung
  if (isCompatible(localVersion, remoteVersion)) {
    const newer = compareSemVer(localVersion, remoteVersion) > 0 ? 'local' : 'remote';
    log?.info(
      { local: localVersion, remote: remoteVersion },
      'Version-Unterschied (kompatibel)',
    );
    return {
      compatible: true,
      warning: `Version-Unterschied: ${localVersion} vs ${remoteVersion} (${newer} ist neuer)`,
      action: newer === 'remote' ? 'Update empfohlen: thinklocal deploy' : undefined,
    };
  }

  // Verschiedene Major = inkompatibel
  log?.warn(
    { local: localVersion, remote: remoteVersion },
    'Inkompatible Protokoll-Version',
  );
  return {
    compatible: false,
    error: `Inkompatible Major-Version: ${localVersion} vs ${remoteVersion}`,
    action: 'Beide Nodes auf die gleiche Major-Version aktualisieren',
  };
}

/**
 * Prueft Mindestversion.
 */
export function meetsMinVersion(version: string): boolean {
  return compareSemVer(version, MIN_COMPATIBLE_VERSION) >= 0;
}

/**
 * Gibt die aktuelle Version-Info zurueck.
 */
export function getVersionInfo(): VersionInfo {
  return {
    daemonVersion: '0.28.0',
    protocolVersion: PROTOCOL_VERSION,
    nodeVersion: process.version,
  };
}

/**
 * Kompatibilitaetsmatrix: Welche Features in welcher Version verfuegbar sind.
 */
export const FEATURE_MATRIX: Record<string, string> = {
  'gossip-sync': '0.1.0',
  'cbor-messages': '0.1.0',
  'mTLS': '0.1.0',
  'telegram-gateway': '0.20.0',
  'static-peers': '0.22.0',
  'graphql-api': '0.25.0',
  'jwt-auth': '0.25.0',
  'policy-engine': '0.25.0',
  'skill-sandbox': '0.27.0',
  'recovery-flows': '0.28.0',
  'shamir-sharing': '0.27.0',
  'task-queue': '0.28.0',
  'approval-gates': '0.28.0',
};

/**
 * Prueft ob ein Feature in einer bestimmten Version verfuegbar ist.
 */
export function isFeatureAvailable(feature: string, version: string): boolean {
  const minVersion = FEATURE_MATRIX[feature];
  if (!minVersion) return false;
  return compareSemVer(version, minVersion) >= 0;
}
