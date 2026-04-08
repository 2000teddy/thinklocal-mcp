/**
 * trust-store.ts — Aggregierter mTLS Trust Store
 *
 * Verwaltet die Liste aller CA-Zertifikate, denen dieser Node vertraut:
 *
 *   1. Die eigene Mesh-CA (aus tls.ts loadOrCreateTlsBundle)
 *   2. Die CA-Zertifikate aller via SPAKE2-Pairing verbundenen Peers
 *      (aus pairing.ts PairingStore.getAllPeers())
 *
 * Diese Aggregation ist der fehlende Glue-Code zwischen der bereits
 * implementierten SPAKE2 PIN-Zeremonie und dem Fastify/undici mTLS-Layer:
 * Vor diesem Modul wurde das Pairing zwar gespeichert, aber das Ergebnis
 * (PairedPeer.caCertPem) wurde nie in den aktiven Trust-Store geladen —
 * sodass der mTLS-Handshake zwischen gepairten Nodes immer mit
 * "certificate signature failure" scheiterte.
 *
 * Node.js' tls-Modul akzeptiert fuer `ca` entweder einen PEM-String oder
 * ein Array davon. Wir nutzen das Array, damit pro Peer eine eigene CA
 * haengen kann. Zusaetzliche Entfernung/Addition zur Laufzeit erfolgt via
 * rebuild() — aufrufbar nach einem erfolgreichen Pairing.
 */

import { createHash, X509Certificate } from 'node:crypto';
import type { PairingStore } from './pairing.js';
import type { Logger } from 'pino';

/**
 * Baut das aggregierte CA-Bundle fuer mTLS auf.
 *
 * @param ownCaCertPem  Eigene Mesh-CA (Pflicht — ohne kein mTLS).
 * @param pairingStore  Optionaler PairingStore. Wenn vorhanden, werden die
 *                      caCertPem aller gepairten Peers angehaengt.
 * @returns             Array von PEM-Strings, direkt verwendbar als `ca: [...]`
 *                      in Fastify-HTTPS-Options und undici `Agent.connect.ca`.
 */
export function buildTrustedCaBundle(
  ownCaCertPem: string,
  pairingStore?: PairingStore,
  log?: Logger,
): string[] {
  const bundle: string[] = [];
  const fingerprints = new Set<string>();

  // Helper: validate PEM als X.509, return fingerprint or null.
  const fingerprint = (pem: string, label: string): string | null => {
    try {
      new X509Certificate(pem);
      return createHash('sha256').update(pem).digest('hex');
    } catch (err) {
      log?.warn(
        { label, err: err instanceof Error ? err.message : String(err) },
        'Trust-Store: ignoriere ungueltiges CA-PEM',
      );
      return null;
    }
  };

  // Own CA zuerst
  const ownFp = fingerprint(ownCaCertPem, 'own-ca');
  if (ownFp) {
    bundle.push(ownCaCertPem);
    fingerprints.add(ownFp);
  }

  // SECURITY (PR #75 GPT-5.4 retro MEDIUM): parse + validate + dedupe peer CAs.
  // Sortiert nach agentId fuer deterministische Reihenfolge (hilft beim Debuggen),
  // SHA-256-dedup auf die PEM-Bytes verhindert dass dieselbe CA zweimal im Bundle
  // steht (z.B. wenn zwei Peers zufaellig die gleiche CA publizieren — kaputte
  // Config, aber wir sollten nicht darueber stolpern).
  if (pairingStore) {
    const sortedPeers = pairingStore
      .getAllPeers()
      .slice()
      .sort((a, b) => a.agentId.localeCompare(b.agentId));

    for (const peer of sortedPeers) {
      if (!peer.caCertPem) continue;
      const fp = fingerprint(peer.caCertPem, peer.agentId);
      if (fp && !fingerprints.has(fp)) {
        bundle.push(peer.caCertPem);
        fingerprints.add(fp);
      }
    }
  }

  return bundle;
}

/**
 * Observer-Pattern fuer Trust-Store-Changes.
 *
 * Komponenten (agent-card.ts, undici dispatcher, ...) die ein aggregiertes
 * CA-Bundle halten, koennen sich hier registrieren, um bei einem neuen
 * Pairing nicht den ganzen Daemon neu starten zu muessen.
 *
 * Die tatsaechliche Hot-Reload-Integration ist bewusst NICHT in diesem
 * Commit — sie waere invasiv (Fastify braucht `server.initialConfig` oder
 * einen expliziten TLS-Context-Swap). Phase 1 pragmatisch: Pairing persistiert,
 * Daemon-Restart ist noetig damit die neue CA wirksam wird. Phase 2:
 * Hot-Reload via tls.createSecureContext().setSecureContext() o.ae.
 */
export class TrustStoreNotifier {
  private listeners: Array<(bundle: string[]) => void> = [];

  constructor(
    private ownCaCertPem: string,
    private pairingStore: PairingStore,
    private log?: Logger,
  ) {}

  /** Registriert einen Listener. Aufrufen bei rebuild(). */
  onChange(listener: (bundle: string[]) => void): void {
    this.listeners.push(listener);
  }

  /** Berechnet das Bundle neu und benachrichtigt alle Listener. */
  rebuild(): string[] {
    const bundle = buildTrustedCaBundle(this.ownCaCertPem, this.pairingStore, this.log);
    this.log?.info(
      { count: bundle.length, pairedPeers: this.pairingStore.getAllPeers().length },
      'Trust-Store rebuild',
    );
    for (const listener of this.listeners) {
      try {
        listener(bundle);
      } catch (err) {
        this.log?.warn({ err }, 'Trust-Store Listener fehlgeschlagen');
      }
    }
    return bundle;
  }

  /** Liefert das aktuelle Bundle ohne Listener zu triggern. */
  current(): string[] {
    return buildTrustedCaBundle(this.ownCaCertPem, this.pairingStore, this.log);
  }
}
