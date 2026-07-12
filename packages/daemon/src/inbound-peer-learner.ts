// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * inbound-peer-learner.ts — ADR-026 symmetrische Discovery.
 *
 * Wird ausgelöst, wenn ein SKILL_ANNOUNCE über eine AUTHENTIFIZIERTE, issuer-gepinnte
 * mTLS-Inbound-Verbindung kommt (attestierte PeerID), der Sender aber NICHT auflösbar ist
 * (kein eigener Discovery-Eintrag — mobil / NAT / Cross-Subnet / mdns_enabled=false).
 * Holt die Agent-Card des Senders von der TLS-Source-IP, validiert sie gegen die attestierte
 * PeerID und legt einen AUTHN-only-Eintrag in die authenticated-seen-Map (mesh.recordAuthenticatedSeen).
 *
 * STRIKT AUTHN: das Ergebnis wird NUR von resolvePeerPublicKey zur Signaturprüfung genutzt — der
 * Peer ist `authenticated_unapproved` und fließt NIE in Autorisierung (ADR-001-Gates bleiben).
 *
 * Reine Orchestrierung — fetchCard/record/rateLimitOk/isAlreadyResolvable injiziert → ohne
 * Netzwerk/Timer unit-testbar.
 */
import type { Logger } from 'pino';

export type LearnResult = 'recorded' | 'skipped-resolvable' | 'rejected-identity' | 'rate-limited' | 'fetch-failed';

export interface LearnInboundPeerDeps {
  /** Attestierte PeerID (aus dem issuer-gepinnten Client-Cert-SAN). */
  peerId: string;
  /** payload-sender (rawEnvelope.sender) — MUSS == expectedSpiffeUri sein. */
  senderUri: string;
  /** TLS-Source-IP der Verbindung. */
  remoteAddress: string;
  port: number;
  /** sha256 des präsentierten Client-Leaf-Certs (Verbindungsbindung, Audit). */
  certFingerprint: string;
  /** Erwartete kanonische URI = peerIdToSpiffeUri(peerId). */
  expectedSpiffeUri: string;
  /** Dedup: true wenn der Sender bereits auflösbar ist (dann nichts tun). */
  isAlreadyResolvable: () => boolean;
  /** Rate-Limit-Gate pro attestierter PeerID (konservativste Achse). true = erlaubt. */
  rateLimitOk: () => boolean;
  /** ADR-035 A4: liefert eine bekannte Adresse (mDNS-/Cache-bekannt) für diesen Peer, falls die
   *  TLS-`remoteAddress` leer ist (bestimmte Cross-Subnet/NAT-Verbindungen liefern keine Source-IP).
   *  NUR Endpoint-Substitut — die Identität wird weiterhin strikt gegen die attestierte PeerID
   *  validiert (Card-SAN == expectedSpiffeUri), also KEIN Trust-Change: eine falsche Fallback-
   *  Adresse führt schlimmstenfalls zu einem Card-Reject, nie zu Auflösung auf fremde Identität.
   *  Ohne Treffer (undefined) bleibt es fail-closed. */
  resolveFallbackAddress?: () => string | undefined;
  /** Holt + validiert die Agent-Card via mTLS von endpoint. */
  fetchCard: (endpoint: string) => Promise<{ spiffeUri?: string; publicKey?: string } | null>;
  /** ADR-035 A3: max. Card-Fetch-Versuche bei TRANSIENTEM Fehler (Default 3). Ein Peer, dessen
   *  HTTP-Server während einer Neustart-Welle noch nicht oben ist, wirft (ECONNREFUSED) — Retry
   *  statt sofortigem Aufgeben. Ein erfolgreicher Fetch mit ungültiger Card wird NICHT wiederholt. */
  maxFetchAttempts?: number;
  /** Backoff-Delays (ms) zwischen den Versuchen; Default [500, 1500, 4000]. Letzter Wert wird für
   *  weitere Versuche wiederverwendet. Injizierbar für deterministische Tests. */
  fetchBackoffMs?: readonly number[];
  /** Injizierbarer Delay (Test-Hook); Default `setTimeout`-Promise. */
  delay?: (ms: number) => Promise<void>;
  /** Schreibt den AUTHN-only-Eintrag (mesh.recordAuthenticatedSeen). */
  record: (e: { peerId: string; publicKey: string; spiffeUri: string; certFingerprint: string; endpoint: string }) => void;
  /** Audit-Hook (PEER_OBSERVED). */
  audit?: (info: { peerId: string; endpoint: string; certFingerprint: string }) => void;
  log?: Logger;
}

/** URL-sichere Host-Darstellung: IPv4-mapped entmappen, echtes IPv6 bracketen. */
function hostForUrl(host: string): string {
  const h = host.replace(/^::ffff:/i, '');
  return h.includes(':') ? `[${h}]` : h;
}

export async function learnInboundPeer(d: LearnInboundPeerDeps): Promise<LearnResult> {
  // (1) Sender-Bindung: payload-sender MUSS der attestierten Transport-Identität entsprechen.
  if (d.senderUri !== d.expectedSpiffeUri) {
    d.log?.warn({ peerId: d.peerId, sender: d.senderUri }, '[discovery] ADR-026: sender != attestierte Transport-Identität — kein Learn');
    return 'rejected-identity';
  }
  // (2) Dedup.
  if (d.isAlreadyResolvable()) return 'skipped-resolvable';
  // (3) Rate-Limit (DoS).
  if (!d.rateLimitOk()) {
    d.log?.warn({ peerId: d.peerId, remoteAddress: d.remoteAddress }, '[discovery] ADR-026: Learn rate-limited');
    return 'rate-limited';
  }
  // CR gpt-5.5 MEDIUM: leere remoteAddress → kein valider Endpoint; IPv6 / IPv4-mapped
  // (`::ffff:10.10.10.80`) müssen für die URL entmappt/gebracketet werden, sonst ist die URL
  // ungültig und das Learning schlägt für solche Verbindungen unnötig fehl.
  // ADR-035 A4: leere remoteAddress → nicht sofort fail-closed, sondern eine bekannte (mDNS-/Cache-)
  // Adresse substituieren. Die Identitätsprüfung unten (Card-SAN == attestierte PeerID) bleibt
  // scharf, daher ist die Substitution AUTHN-neutral.
  let effectiveAddress = d.remoteAddress;
  if (!effectiveAddress) {
    const fallback = d.resolveFallbackAddress?.();
    if (!fallback) {
      d.log?.warn({ peerId: d.peerId }, '[discovery] ADR-026/035: leere remoteAddress, keine bekannte Adresse — kein Card-Fetch');
      return 'fetch-failed';
    }
    d.log?.debug({ peerId: d.peerId, fallback }, '[discovery] ADR-035 A4: leere remoteAddress → bekannte Adresse substituiert');
    effectiveAddress = fallback;
  }
  const endpoint = `https://${hostForUrl(effectiveAddress)}:${d.port}`;
  // ADR-035 A3: Retry mit Backoff NUR bei transientem Fetch-Throw (Wellen-Recovery). Ein
  // erfolgreicher Fetch (auch mit null/ungültiger Card) beendet die Schleife — eine ungültige
  // Card ist ein permanenter Reject unten, kein transienter Fehler (kein Loop).
  const maxAttempts = Math.max(1, d.maxFetchAttempts ?? 3);
  const backoff = d.fetchBackoffMs ?? [500, 1500, 4000];
  // Default-Delay: Timer ge-unref't → ein Learn, das bei SIGTERM/SIGINT mitten im Backoff
  // hängt, hält den Event-Loop nicht offen (fire-and-forget; kein Shutdown-Stau).
  const delay =
    d.delay ??
    ((ms: number): Promise<void> =>
      new Promise((r) => {
        const t = setTimeout(r, ms);
        (t as { unref?: () => void }).unref?.();
      }));
  let card: { spiffeUri?: string; publicKey?: string } | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      card = await d.fetchCard(endpoint);
      break;
    } catch (err) {
      if (attempt >= maxAttempts) {
        d.log?.debug(
          { peerId: d.peerId, endpoint, attempt, err: (err as Error)?.message },
          '[discovery] ADR-026/035: Card-Fetch endgültig fehlgeschlagen (Retries erschöpft)',
        );
        return 'fetch-failed';
      }
      await delay(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
  }
  // (4) Card-Validierung: PublicKey vorhanden UND Card-SAN == attestierte PeerID.
  if (!card?.publicKey || card.spiffeUri !== d.expectedSpiffeUri) {
    d.log?.warn(
      { peerId: d.peerId, cardSpiffe: card?.spiffeUri, expected: d.expectedSpiffeUri },
      '[discovery] ADR-026: Card-SAN != attestierte PeerID oder kein PublicKey — verworfen',
    );
    return 'rejected-identity';
  }
  d.record({ peerId: d.peerId, publicKey: card.publicKey, spiffeUri: d.expectedSpiffeUri, certFingerprint: d.certFingerprint, endpoint });
  d.audit?.({ peerId: d.peerId, endpoint, certFingerprint: d.certFingerprint });
  return 'recorded';
}
