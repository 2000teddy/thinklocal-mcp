// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * boot-relearn.ts — ADR-035 A2 / TL-27: proaktives Boot-Re-Learn aus dem Peer-Cache (A1).
 *
 * ZWECK: Nach einem Restart die AUTHN-Auflösung selbst wiederherstellen, statt auf einen Inbound
 * zu warten — behebt „Unknown sender" nach Neustart-Wellen OHNE static_peers/mDNS-Glück. Für jedes
 * beim Boot geladene Cache-Ziel (A1, `mesh.getBootReLearnTargets()`) wird proaktiv die Agent-Card
 * geholt und — nach kryptografischer Attestierung — in die AUTHN-only-seen-Map geschrieben.
 *
 * CO-BINDENDE INVARIANTEN (aus dem A1-CO, s. ADR-035-A1-peer-cache-CO-brief §6):
 *  - **INV-A2-1 (Attestierung):** Der Card-Fetch MUSS server-identity-**gepinnt** auf die erwartete
 *    kanonische PeerID (`expectedSpiffeUri`) laufen — die volle Issuer-Chain (`rejectUnauthorized`)
 *    PLUS ein SPIFFE-SAN-Match auf `expectedSpiffeUri`. NIEMALS ein Shortcut über den gecachten
 *    `certFingerprint` (der ist nur ein HINT; eine CA-Reissue-Rotation würde sonst fail-closed einen
 *    Selbst-Outage erzeugen — genau die A4b-Fehlerklasse, nur von der Platte). Diese Naht erzwingt
 *    das Pinning über die Dep `fetchCardPinned(endpoint, expectedSpiffeUri)`: der I/O-Adapter (index.ts)
 *    baut einen dedizierten mTLS-Dial mit `makeMeshCheckServerIdentity` und **hartem** expected-id —
 *    unabhängig vom global-default-AUS D2b-Flag. Ein Fetch, der nicht auf `expectedSpiffeUri` pinnt,
 *    verletzt den Vertrag dieses Moduls.
 *  - **INV-A2-2 (Endpoint-Restriktion):** Es wird NUR gegen erlaubte Discovery-Subnetz-Adressen
 *    gedialt (`isEndpointAllowed`) + Timeout + Rate-Limit — SSRF-nah, sonst könnte ein vergifteter
 *    Platten-Endpoint einen Boot-Probe auf Loopback/beliebige Adresse auslösen.
 *
 * Reine Orchestrierung — fetchCardPinned/record/rateLimitOk/isEndpointAllowed injiziert → ohne
 * Netzwerk/Timer unit-testbar. Modelliert nach `inbound-peer-learner.ts` (ADR-026), aber OUTBOUND.
 */
import type { Logger } from 'pino';
import { ipInCidr } from './discovery-policy.js';

export type ReLearnResult =
  | 'recorded'
  | 'skipped-resolvable'
  | 'rejected-identity'
  | 'rate-limited'
  | 'endpoint-blocked'
  | 'fetch-failed';

export interface ReLearnPeerDeps {
  /** Kanonische PeerID des Ziels (aus dem A1-Locator). */
  peerId: string;
  /** Erwartete kanonische node/<PeerID>-URI (== Locator.spiffeUri). Attestierungs-Anker. */
  expectedSpiffeUri: string;
  /** Zuletzt bekannter Endpoint (https://host:port) aus dem Cache — nur ein Kandidat (HINT). */
  endpoint: string;
  /** Host-Teil des Endpoints (für den Subnetz-Gate; vom Aufrufer extrahiert). */
  host: string;
  /** Dedup: true wenn der Peer bereits auflösbar ist → nichts tun. */
  isAlreadyResolvable: () => boolean;
  /** INV-A2-2: true nur wenn `host` eine erlaubte Discovery-Subnetz-Adresse ist. */
  isEndpointAllowed: (host: string) => boolean;
  /** Rate-Limit-Gate pro PeerID (DoS/Probe-Begrenzung). true = erlaubt. */
  rateLimitOk: () => boolean;
  /**
   * INV-A2-1: holt die Agent-Card über einen mTLS-Dial, der die Server-Identität HART auf
   * `expectedSpiffeUri` pinnt (SPIFFE-SAN-Match + volle Chain). Wirft bei transientem Fehler
   * (ECONNREFUSED/Timeout/Pin-Mismatch-Handshake-Abbruch) — der Retry unten fängt das ab.
   */
  fetchCardPinned: (endpoint: string, expectedSpiffeUri: string) => Promise<{ spiffeUri?: string; publicKey?: string } | null>;
  /** sha256 des im Dial präsentierten Server-Leaf-Certs (Audit/Verbindungsbindung), falls verfügbar. */
  certFingerprint?: string;
  /** max. Fetch-Versuche bei TRANSIENTEM Fehler (Default 3). Wellen-Recovery. */
  maxFetchAttempts?: number;
  /** Backoff-Delays (ms); Default [500, 1500, 4000]. Letzter Wert wird wiederverwendet. */
  fetchBackoffMs?: readonly number[];
  /** Injizierbarer Delay (Test-Hook); Default unref'd setTimeout-Promise. */
  delay?: (ms: number) => Promise<void>;
  /** Schreibt den AUTHN-only-Eintrag (mesh.recordAuthenticatedSeen). */
  record: (e: { peerId: string; publicKey: string; spiffeUri: string; certFingerprint: string; endpoint: string }) => void;
  /** Audit-Hook (PEER_OBSERVED). */
  audit?: (info: { peerId: string; endpoint: string }) => void;
  log?: Logger;
}

/**
 * INV-A2-2 (rein, testbar): darf gegen `host` (eine IP) für das Boot-Re-Learn gedialt werden?
 * Fail-closed: nur IPv4/IPv6-Literale; Loopback/Link-local/unspezifiziert verworfen; bei gesetzten
 * `allowedCidrs` MUSS die IP drin liegen; ohne Policy (leer) nur RFC1918/ULA-Private-Ranges (kein
 * öffentliches Ziel, kein SSRF auf beliebige Adressen). Hostnamen (kein IP-Literal) → false.
 */
export function isReLearnHostAllowed(host: string, allowedCidrs: readonly string[] = []): boolean {
  const h = host.replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '');
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  const isIpv6 = h.includes(':');
  if (!isIpv4 && !isIpv6) return false; // nur IP-Literale (kein DNS-Rebinding-Vektor)
  // Loopback / link-local / unspezifiziert → immer verboten (SSRF auf lokale Dienste).
  if (/^127\./.test(h) || h === '::1' || /^169\.254\./.test(h) || /^fe80:/i.test(h) || h === '0.0.0.0' || h === '::') {
    return false;
  }
  if (allowedCidrs.length > 0) {
    return allowedCidrs.some((cidr) => ipInCidr(h, cidr));
  }
  // Ohne explizite Policy: nur private Ranges (RFC1918 / ULA fc00::/7).
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/i.test(h)
  );
}

/** Obergrenze für den Agent-Card-Body beim Re-Learn (CR MED: `res.json()` sonst unbounded). */
export const MAX_CARD_BODY_BYTES = 256 * 1024;

/** Minimaler ReadableStream-Reader-Vertrag (undici/WHATWG) — injizierbar für Tests. */
interface ByteStream {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
}

/**
 * CR MED: liest einen Body-Stream **byte-begrenzt** und dekodiert zu Text; > `maxBytes` → `null`
 * (Stream abgebrochen). `AbortSignal.timeout` begrenzt nur die ZEIT, nicht die Bytes — ein Peer, der
 * den Pin passiert, könnte sonst innerhalb des Timeouts einen großen Body streamen (Memory-Spike).
 * Rein bis auf den injizierten Stream → unit-testbar.
 */
export async function readCappedText(body: ByteStream, maxBytes: number): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

/** Default-Delay: ge-unref'ter Timer → hält den Event-Loop bei SIGTERM/SIGINT nicht offen. */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

/**
 * Ein Cache-Ziel proaktiv re-learnen. Reihenfolge: Dedup → Endpoint-Gate (INV-A2-2) → Rate-Limit →
 * gepinnter Fetch mit Retry (INV-A2-1) → Card-Validierung → record. Jeder Fehlerpfad ist fail-closed.
 */
export async function relearnPeer(d: ReLearnPeerDeps): Promise<ReLearnResult> {
  if (d.isAlreadyResolvable()) return 'skipped-resolvable';
  // INV-A2-2: Endpoint-Restriktion VOR jedem Netzwerk-Kontakt (SSRF-Gate).
  if (!d.isEndpointAllowed(d.host)) {
    d.log?.warn({ peerId: d.peerId, host: d.host }, '[discovery] ADR-035 A2: Endpoint außerhalb erlaubtem Discovery-Subnetz — kein Re-Learn (INV-A2-2)');
    return 'endpoint-blocked';
  }
  if (!d.rateLimitOk()) {
    d.log?.warn({ peerId: d.peerId, host: d.host }, '[discovery] ADR-035 A2: Re-Learn rate-limited');
    return 'rate-limited';
  }
  const maxAttempts = Math.max(1, d.maxFetchAttempts ?? 3);
  const backoff = d.fetchBackoffMs ?? [500, 1500, 4000];
  const delay = d.delay ?? defaultDelay;
  let card: { spiffeUri?: string; publicKey?: string } | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      // INV-A2-1: der Fetch pinnt hart auf expectedSpiffeUri (Vertrag der Dep).
      card = await d.fetchCardPinned(d.endpoint, d.expectedSpiffeUri);
      break;
    } catch (err) {
      if (attempt >= maxAttempts) {
        d.log?.debug({ peerId: d.peerId, endpoint: d.endpoint, attempt, err: (err as Error)?.message }, '[discovery] ADR-035 A2: Re-Learn-Fetch endgültig fehlgeschlagen');
        return 'fetch-failed';
      }
      await delay(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
  }
  // Card-Validierung: PublicKey vorhanden UND Card-SAN == erwartete PeerID. (Der Transport ist
  // bereits auf expectedSpiffeUri gepinnt — diese Prüfung ist die zweite, applikative Achse.)
  if (!card?.publicKey || card.spiffeUri !== d.expectedSpiffeUri) {
    d.log?.warn({ peerId: d.peerId, cardSpiffe: card?.spiffeUri, expected: d.expectedSpiffeUri }, '[discovery] ADR-035 A2: Card-SAN != erwartete PeerID oder kein PublicKey — verworfen');
    return 'rejected-identity';
  }
  d.record({ peerId: d.peerId, publicKey: card.publicKey, spiffeUri: d.expectedSpiffeUri, certFingerprint: d.certFingerprint ?? '', endpoint: d.endpoint });
  d.audit?.({ peerId: d.peerId, endpoint: d.endpoint });
  return 'recorded';
}
