// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * onboarding-port.ts — Single Source of Truth für die Port-Beziehung zwischen dem
 * Haupt-mTLS-Daemon (z.B. 9440) und dem CERTLOSEN Onboarding-Server (Haupt-Port + 1).
 *
 * Hintergrund: Ein neu joinender Node hat noch KEIN Mesh-Cert. Der Haupt-Server läuft
 * mit `requestCert + rejectUnauthorized` (mTLS) → ein certloser `/onboarding/join`
 * scheitert dort am TLS-Handshake. Deshalb lauscht der Onboarding-Server (Bearer-Token
 * statt Client-Cert) auf Haupt-Port + 1. Diese Beziehung darf NUR hier definiert sein,
 * damit Daemon (index.ts) und CLI (thinklocal.ts join) garantiert übereinstimmen.
 */

/** Der certlose Onboarding-Server lauscht auf Daemon-Haupt-Port + diesem Offset. */
export const ONBOARDING_PORT_OFFSET = 1;

/** Onboarding-(Join-)Port aus dem Haupt-Daemon-Port. */
export function onboardingPort(mainPort: number): number {
  return mainPort + ONBOARDING_PORT_OFFSET;
}

/**
 * Leitet die certlose Onboarding-Origin (`protocol//host:port+1`) aus einer Admin-
 * HAUPT-URL ab. Liefert nur die Origin (ohne Pfad/Trailing-Slash) — der Aufrufer hängt
 * z.B. `/onboarding/join` an. Wirft bei ungültiger URL.
 */
export function onboardingUrlFromAdminUrl(adminUrl: string): string {
  const u = new URL(adminUrl);
  // CR gpt-5.5 LOW: nur http/https; robuste Serialisierung via URL.origin (IPv6-sicher);
  // Userinfo/Pfad/Query/Hash strippen; Portbereich prüfen.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Nicht unterstuetztes admin-url-Protokoll: ${u.protocol}`);
  }
  const mainPort = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  const port = onboardingPort(mainPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Ungueltiger Onboarding-Port aus admin-url abgeleitet: ${port}`);
  }
  u.username = '';
  u.password = '';
  u.port = String(port);
  u.pathname = '';
  u.search = '';
  u.hash = '';
  return u.origin;
}
