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
): string[] {
  const bundle: string[] = [ownCaCertPem];

  if (pairingStore) {
    for (const peer of pairingStore.getAllPeers()) {
      if (peer.caCertPem && peer.caCertPem.includes('BEGIN CERTIFICATE')) {
        bundle.push(peer.caCertPem);
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
    const bundle = buildTrustedCaBundle(this.ownCaCertPem, this.pairingStore);
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
    return buildTrustedCaBundle(this.ownCaCertPem, this.pairingStore);
  }
}
