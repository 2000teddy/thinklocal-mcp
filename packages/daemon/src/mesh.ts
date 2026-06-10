import { fetch, type Dispatcher } from 'undici';
import type { Logger } from 'pino';
import type { DiscoveredPeer } from './discovery.js';
import type { AgentCard } from './agent-card.js';
import { spiffeUriToPeerId } from './peer-identity.js';

export type PeerStatus = 'online' | 'offline' | 'unknown';

export interface MeshPeer {
  name: string;
  host: string;
  port: number;
  agentId: string;
  endpoint: string;
  status: PeerStatus;
  lastSeen: number;
  missedBeats: number;
  agentCard: AgentCard | null;
  libp2p: {
    peerId: string | null;
    /**
     * SECURITY (ADR-022, CR gpt-5.5 HIGH 1): true NUR wenn `peerId` über einen
     * KRYPTOGRAFISCHEN Pfad bestätigt wurde (mTLS cert-SAN=node/<PeerID> oder
     * libp2p-Noise-RemotePeer) — NIE aus mDNS-TXT oder einem Agent-Card-Feld.
     * Nur dann darf `peerId` in resolvePeerPublicKey als Identitätsschlüssel zählen.
     * Gesetzt via markPeerIdVerified aus dem issuer-gepinnten mTLS-cert-SAN-Pfad
     * (agent-card.ts onPeerCertVerified) — NIE aus mDNS-TXT / Agent-Card-Feld.
     */
    peerIdVerified: boolean;
    listenMultiaddrs: string[];
    connected: boolean;
    status: 'unavailable' | 'discovered' | 'connected';
  };
}

export interface MeshEvents {
  onPeerOnline: (peer: MeshPeer) => void;
  onPeerOffline: (peer: MeshPeer) => void;
}

/**
 * Normalisiert eine Host/IP für Vergleiche: strippt das IPv6-mapped-IPv4-Präfix (`::ffff:`)
 * und eine IPv6-Zone-ID (`%en10`). Für den Host-Bind-Fallback in markPeerIdVerified.
 */
function normHost(h: string | null | undefined): string {
  return (h ?? '').replace(/^::ffff:/i, '').replace(/%.*$/, '');
}

/**
 * Ergebnis von `markPeerIdVerified` (CR gpt-5.5 HIGH, Bug #2): TRANSAKTIONAL. `ok` zeigt,
 * ob eine Bindung/Verifikation erfolgte; `rollback()` macht die Mutation (PeerID-Bindung,
 * verified-Flag, supersedete Duplikate) rückgängig. Der Aufrufer (agent-card.ts) committet
 * implizit durch Nicht-Rollback NUR, wenn die nachfolgende Envelope-Signaturprüfung gelingt —
 * sonst Rollback, damit eine fehlgeschlagene Nachricht keine persistente Fehlbindung hinterlässt.
 */
export interface PeerIdVerifyResult {
  ok: boolean;
  rollback: () => void;
}

/**
 * ADR-026: ephemerer AUTHN-only-Eintrag eines via authentifizierter, issuer-gepinnter
 * mTLS-Inbound-Verbindung gelernten Peers (symmetrische Discovery). Wird AUSSCHLIESSLICH
 * von `resolvePeerPublicKey` zur SIGNATURPRÜFUNG konsultiert — NIEMALS für Autorisierung
 * (state ist konstant `authenticated_unapproved`; AUTHZ prüft weiter `this.peers`/Pairing).
 */
export interface AuthenticatedSeenEntry {
  peerId: string;
  /** ECDSA-Signing-Key (PEM) aus der validierten Agent-Card des Peers. */
  publicKey: string;
  /** Kanonische node/<PeerID>-URI (== peerIdToSpiffeUri(peerId), beim Lernen geprüft). */
  spiffeUri: string;
  /** sha256 des präsentierten Client-Leaf-Certs (Verbindungsbindung). */
  certFingerprint: string;
  endpoint: string;
  lastSeen: number;
  readonly state: 'authenticated_unapproved';
}

/** ADR-026 Guardrails: TTL + Cap für die ephemere authenticated-seen-Map. */
const AUTH_SEEN_TTL_MS = 15 * 60_000;
const AUTH_SEEN_MAX = 256;

export class MeshManager {
  private peers = new Map<string, MeshPeer>();
  // ADR-026: AUTHN-only. Getrennt von `this.peers` (approved/discovered) — wird NIE von
  // Autorisierungspfaden (registry-sync-Akzeptanz, heartbeat, capability-merge, skill-exec)
  // gelesen, AUSSCHLIESSLICH von resolvePeerPublicKey.
  private authenticatedSeen = new Map<string, AuthenticatedSeenEntry>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private heartbeatIntervalMs: number,
    private missedBeatsThreshold: number,
    private events: MeshEvents,
    private log?: Logger,
    private dispatcher?: Dispatcher,
  ) {}

  addPeer(discovered: DiscoveredPeer): MeshPeer {
    const existing = this.peers.get(discovered.agentId);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.missedBeats = 0;
      existing.status = 'online';
      return existing;
    }

    // ADR-022 Phase-3 (Card-Re-Fetch/Identity-Supersession): Derselbe Node (stabile
    // libp2p-PeerID) kündigt sich unter einer NEUEN, KANONISCHEN agentId an — der
    // Sender-Flip `host/<id>` → `node/<PeerID>`. CR gpt-5.5 HIGH: HIER wird NICHT
    // destruktiv entfernt — `discovered.*` stammt aus UNAUTHENTIFIZIERTEM mDNS, ein
    // LAN-Angreifer könnte sonst mit einer selbstkonsistenten `node/<victimPeerId>`-
    // Ankündigung einen legitimen Peer evicten (Availability-DoS). Wir loggen nur; die
    // tatsächliche Supersession passiert erst nach issuer-gepinnter Cert-Attestierung
    // in `markPeerIdVerified(peerId, senderUri)`.
    const incomingPeerId = spiffeUriToPeerId(discovered.agentId);
    if (incomingPeerId && incomingPeerId === discovered.p2pPeerId) {
      const duplicates = [...this.peers.values()].filter(
        (p) => p.agentId !== discovered.agentId && p.libp2p.peerId === incomingPeerId,
      );
      if (duplicates.length > 0) {
        this.log?.warn(
          { newAgentId: discovered.agentId, peerId: incomingPeerId, duplicates: duplicates.map((p) => p.agentId) },
          'Kanonische PeerID-Duplikate gesehen (mDNS) — Supersession wird bis zur Krypto-Attestierung verzögert',
        );
      }
    }

    const peer: MeshPeer = {
      name: discovered.name,
      host: discovered.host,
      port: discovered.port,
      agentId: discovered.agentId,
      endpoint: discovered.endpoint,
      status: 'online',
      lastSeen: Date.now(),
      missedBeats: 0,
      agentCard: null,
      libp2p: {
        peerId: discovered.p2pPeerId ?? null,
        peerIdVerified: false, // mDNS-Quelle ist NICHT kryptografisch bestätigt (HIGH 1)
        listenMultiaddrs: [],
        connected: false,
        status: discovered.p2pPeerId ? 'discovered' : 'unavailable',
      },
    };

    this.peers.set(discovered.agentId, peer);
    this.log?.info({ agentId: peer.agentId, host: peer.host }, 'Peer hinzugefügt');
    this.events.onPeerOnline(peer);
    return peer;
  }

  removePeer(agentId: string): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.status = 'offline';
      this.events.onPeerOffline(peer);
      this.peers.delete(agentId);
      this.log?.info({ agentId }, 'Peer entfernt');
    }
  }

  recordHeartbeat(agentId: string): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.lastSeen = Date.now();
      peer.missedBeats = 0;
      if (peer.status !== 'online') {
        peer.status = 'online';
        this.events.onPeerOnline(peer);
      }
    }
  }

  updateAgentCard(agentId: string, card: AgentCard): void {
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.agentCard = card;
      const newPeerId = card.mesh.libp2p?.peer_id ?? peer.libp2p.peerId;
      if (newPeerId !== peer.libp2p.peerId) {
        // SECURITY (CR gpt-5.5 MEDIUM): Ein PeerID-Wechsel aus (unauthentifizierten)
        // Card-Daten invalidiert eine evtl. frühere Krypto-Verifikation — sonst bliebe
        // peerIdVerified stale und gälte für einen anderen PeerID-Wert.
        peer.libp2p.peerIdVerified = false;
      }
      peer.libp2p.peerId = newPeerId;
      peer.libp2p.listenMultiaddrs = [...(card.mesh.libp2p?.listen_multiaddrs ?? peer.libp2p.listenMultiaddrs)];
      peer.libp2p.connected = card.mesh.libp2p?.connected_peers ? card.mesh.libp2p.connected_peers > 0 : peer.libp2p.connected;
      peer.libp2p.status = card.mesh.libp2p?.status === 'ready'
        ? (
            peer.libp2p.connected
            || (card.mesh.libp2p.multiplexer?.open_streams ?? 0) > 0
              ? 'connected'
              : 'discovered'
          )
        : peer.libp2p.status;
    }
  }

  private heartbeatInFlight = false;

  startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatInFlight) return;
      this.heartbeatInFlight = true;
      void this.checkPeers()
        .catch((err) => this.log?.error({ err }, 'Heartbeat-Check fehlgeschlagen'))
        .finally(() => { this.heartbeatInFlight = false; });
    }, this.heartbeatIntervalMs);
    this.log?.info({ intervalMs: this.heartbeatIntervalMs }, 'Heartbeat-Loop gestartet');
  }

  stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.log?.info('Heartbeat-Loop gestoppt');
    }
  }

  getOnlinePeers(): MeshPeer[] {
    return [...this.peers.values()].filter((p) => p.status === 'online');
  }

  getPeer(agentId: string): MeshPeer | undefined {
    return this.peers.get(agentId);
  }

  /**
   * ADR-022: Auflösung des Signatur-Public-Keys eines Absenders, mit harter
   * Trennung zwischen kanonischen und Legacy-Identitäten (CR gpt-5.5 HIGH 1).
   *
   * Reihenfolge (PeerID ZUERST — die Trennung ist sicherheitskritisch):
   *   1. Kanonische `spiffe://thinklocal/node/<PeerID>`-URI → NUR über eine
   *      KRYPTOGRAFISCH VERIFIZIERTE PeerID-Bindung (`peer.libp2p.peerIdVerified`
   *      === true UND eindeutiger `peerId`-Match). NIEMALS über die exakten Treffer.
   *   2./3. Nur für NICHT-kanonische (Legacy `host/<id>`) URIs: exakter Discovery-
   *      `agentId`-Treffer, dann exakter Card-`spiffeUri`-Treffer.
   *
   * Speist sich ausschließlich aus VERIFIZIERTEN Agent-Cards (publicKey gesetzt),
   * nie aus OS-/Hostname-Quellen. Die Signaturprüfung des Envelopes erfolgt zudem
   * downstream gegen den zurückgegebenen Key.
   *
   * WARUM PeerID-first + verified-only: `libp2p.peerId` stammt aus unauthentifiziertem
   * mDNS-TXT / Card-Feld. Ließe man kanonische node/<PeerID>-URIs über die exakten
   * Treffer (1/2) zu, könnte ein Angreifer via mDNS `agent-id = node/<victimPeerId>`
   * (+ eigene verifizierte Card/Key) eine fremde Identität bedienen. `peerIdVerified`
   * wird nur aus einem echten Krypto-Pfad gesetzt (mTLS cert-SAN=node/<PeerID> /
   * Noise-RemotePeer) — der existiert vor dem Cert-Cutover noch nicht, daher löst aktuell
   * KEINE kanonische node/<PeerID>-URI auf (forward-compatible, fail-closed).
   */
  /**
   * ADR-026: speichert einen AUTHN-only-Eintrag aus einer authentifizierten Inbound-Verbindung
   * (symmetrische Discovery). Der Caller (agent-card.ts → inbound-peer-learner) MUSS vorher
   * kryptografisch geprüft haben: (a) issuer-gepinnte Cert-Attestierung der PeerID, (b)
   * `card.spiffeUri === peerIdToSpiffeUri(peerId)`. TTL-Prune + LRU-Cap als DoS-Schutz.
   * State ist konstant `authenticated_unapproved` — NIE für Autorisierung verwenden.
   */
  recordAuthenticatedSeen(entry: {
    peerId: string;
    publicKey: string;
    spiffeUri: string;
    certFingerprint: string;
    endpoint: string;
  }): void {
    const now = Date.now();
    for (const [k, v] of this.authenticatedSeen) {
      if (now - v.lastSeen > AUTH_SEEN_TTL_MS) this.authenticatedSeen.delete(k);
    }
    this.authenticatedSeen.set(entry.peerId, { ...entry, lastSeen: now, state: 'authenticated_unapproved' });
    if (this.authenticatedSeen.size > AUTH_SEEN_MAX) {
      let oldestK: string | undefined;
      let oldestT = Infinity;
      for (const [k, v] of this.authenticatedSeen) {
        if (v.lastSeen < oldestT) { oldestT = v.lastSeen; oldestK = k; }
      }
      if (oldestK) this.authenticatedSeen.delete(oldestK);
    }
    this.log?.info(
      { peerId: entry.peerId, endpoint: entry.endpoint },
      '[discovery] ADR-026: authentifizierter Peer gelernt (AUTHN-only, authenticated_unapproved)',
    );
  }

  resolvePeerPublicKey(senderUri: string): string | undefined {
    // SECURITY (CR gpt-5.5 HIGH 1, vollständig): Kanonische node/<PeerID>-Sender-URIs
    // dürfen AUSSCHLIESSLICH über eine KRYPTOGRAFISCH VERIFIZIERTE PeerID-Bindung
    // auflösen — NIEMALS über die exakten Treffer (agentId / card.spiffeUri). Deren Werte
    // stammen aus unauthentifiziertem mDNS-TXT / Card-Feld: ein Angreifer könnte via mDNS
    // `agent-id = node/<victimPeerId>` (+ eigene verifizierte Card/Key) eine fremde
    // Identität bedienen (Signaturprüfung bestätigt nur SEINEN Key). `peerIdVerified` wird
    // nur aus einem echten Krypto-Pfad (mTLS cert-SAN=node/<PeerID> / Noise-RemotePeer)
    // gesetzt — solange der nicht existiert (vor dem Cert-Cutover) ist dieser Pfad AUS.
    const wantPeerId = spiffeUriToPeerId(senderUri);
    if (wantPeerId) {
      const matches: string[] = [];
      for (const peer of this.peers.values()) {
        if (
          peer.agentCard?.publicKey &&
          peer.libp2p.peerIdVerified &&
          peer.libp2p.peerId === wantPeerId
        ) {
          matches.push(peer.agentCard.publicKey);
        }
      }
      if (matches.length === 1) return matches[0];
      // SECURITY (CR gpt-5.5 HIGH 2): mehrdeutige verifizierte PeerID-Treffer sind ein
      // sicherheitsrelevanter Identitäts-Konflikt → strikt fail-closed. KEIN authenticatedSeen-
      // Fallback, sonst überstimmt ein AUTHN-only-Eintrag einen Zustand, der undefined sein muss.
      if (matches.length > 1) {
        this.log?.warn(
          { senderUri, peerId: wantPeerId, matches: matches.length },
          '[mesh] PeerID-Auflösung mehrdeutig — fail-closed, kein authenticatedSeen-Fallback',
        );
        return undefined;
      }
      // ADR-026: AUTHN-only Fallback (nur bei matches.length === 0) — via authentifizierter,
      // issuer-gepinnter mTLS-Inbound gelernter Peer (symmetrische Discovery; resolvePeerPublicKey
      // ist der EINZIGE Leser dieser Map). Strikt: PeerID == wantPeerId, kanonische URI exakt,
      // nicht abgelaufen. Nur zur Signaturprüfung (AUTHN) — Autorisierung bleibt an this.peers/Pairing.
      const seen = this.authenticatedSeen.get(wantPeerId);
      if (seen && seen.spiffeUri === senderUri && Date.now() - seen.lastSeen <= AUTH_SEEN_TTL_MS) {
        return seen.publicKey;
      }
      return undefined;
    }

    // Nicht-kanonische (Legacy host/<id>) Sender-URIs: card-backed exakte Treffer.
    // 1. exakter Discovery-Key (agentId).
    const direct = this.peers.get(senderUri);
    if (direct?.agentCard?.publicKey) return direct.agentCard.publicKey;
    // 2. exakter Card-spiffeUri-Treffer (falls Discovery-Key ≠ Card-URI).
    for (const peer of this.peers.values()) {
      if (peer.agentCard?.publicKey && peer.agentCard.spiffeUri === senderUri) {
        return peer.agentCard.publicKey;
      }
    }
    return undefined;
  }

  /**
   * ADR-026 AUTHZ-Prädikat (CR gpt-5.5 HIGH 1): true NUR für einen APPROVED/DISCOVERED Peer
   * (`this.peers` — verifizierte PeerID bzw. card-backed Legacy-Treffer). Spiegelt
   * `resolvePeerPublicKey` OHNE den `authenticatedSeen`-Fallback: ein bloß AUTHN-gelernter
   * `authenticated_unapproved` Peer ist hier IMMER false. State-mutierende Message-Typen
   * (REGISTRY_SYNC, SKILL_ANNOUNCE) MÜSSEN hierauf (oder Pairing) gaten — niemals allein auf
   * „Signatur war mit einem auflösbaren Key gültig" (das schlösse authenticatedSeen mit ein).
   */
  isApprovedPeerSender(senderUri: string): boolean {
    const wantPeerId = spiffeUriToPeerId(senderUri);
    if (wantPeerId) {
      let count = 0;
      for (const peer of this.peers.values()) {
        if (peer.agentCard?.publicKey && peer.libp2p.peerIdVerified && peer.libp2p.peerId === wantPeerId) {
          count++;
        }
      }
      return count === 1;
    }
    if (this.peers.get(senderUri)?.agentCard?.publicKey) return true;
    for (const peer of this.peers.values()) {
      if (peer.agentCard?.publicKey && peer.agentCard.spiffeUri === senderUri) return true;
    }
    return false;
  }

  /**
   * ADR-022 Schritt 3 (channel-bound): markiert die PeerID als kryptografisch
   * VERIFIZIERT — NUR aus einem echten Krypto-Pfad aufrufen (CA-validierter, issuer-
   * gepinnter mTLS-Cert-SAN `node/<PeerID>` oder libp2p-Noise-RemotePeer), NIE aus mDNS/Card.
   * Schaltet damit die kanonische PeerID-Auflösung für diesen Peer frei.
   *
   * `remoteHost` (Bug #2): die TLS-authentifizierte Source-IP der attestierten Verbindung.
   * Bindet die attestierte PeerID an den eindeutigen card-gestützten Host-Eintrag, falls die
   * beiden URI/PeerID-Lookups leer bleiben (Empfänger ohne vorab-gelernte PeerID, z.B. .56/.222).
   *
   * `senderUri` (CR gpt-5.5 HIGH): die TLS-/Envelope-attestierte Sender-URI. Wenn gesetzt,
   * wird (a) der exakt darunter gekeyte Eintrag eindeutig markiert (löst die mDNS-Duplikat-
   * Ambiguität) und (b) — NUR wenn `senderUri` selbst kanonisch ist (Identity-Flip) —
   * werden ALTE Duplikate mit derselben PeerID superseded. Diese destruktive Supersession
   * ist damit an die issuer-gepinnte Cert-Attestierung gebunden, NICHT an rohes mDNS.
   * Liefert ein {ok, rollback} — TRANSAKTIONAL: der Aufrufer committet implizit durch
   * Nicht-Rollback nur nach erfolgreicher Envelope-Signaturprüfung (CR gpt-5.5 HIGH).
   */
  markPeerIdVerified(peerId: string, senderUri?: string, remoteHost?: string): PeerIdVerifyResult {
    const NOOP: PeerIdVerifyResult = { ok: false, rollback: () => {} };
    if (senderUri) {
      // (1) Exakter Sender-Eintrag (kanonische mDNS-Entdeckung). (2) sonst Discovery-Lag-Fallback:
      // genau EIN Peer trägt diese PeerID (Legacy-Eintrag mit gleicher Card/Key).
      let target = this.peers.get(senderUri) ?? null;
      if (!target) {
        const byPeerId = [...this.peers.values()].filter((p) => p.libp2p.peerId === peerId);
        if (byPeerId.length === 1) target = byPeerId[0] ?? null;
      }
      // (3) Bug #2 (.56/.222): Empfänger ohne gelernte PeerID (kein mDNS-TXT/static_peer, stale
      // Card) → (1)/(2) greifen nicht. Die Cert-Attestierung BEWEIST die PeerID kryptografisch;
      // `remoteHost` ist die TLS-authentifizierte Source-IP DIESER Verbindung. Binde an den
      // EINDEUTIGEN card-gestützten Eintrag mit genau diesem Host (gleicher Signing-Key über
      // den Flip — Option B). Spoof-sicher: nur EIN Kandidat, Host == attestierte Verbindung,
      // kein bereits anders verifizierter Eintrag; falscher Key ⇒ Signaturprüfung fail-closed.
      if (!target && remoteHost) {
        const rh = normHost(remoteHost);
        if (rh) {
          const cands = [...this.peers.values()].filter(
            (p) =>
              !!p.agentCard?.publicKey &&
              normHost(p.host) === rh &&
              (p.libp2p.peerId === null || p.libp2p.peerId === peerId) &&
              !(p.libp2p.peerIdVerified && p.libp2p.peerId !== peerId),
          );
          if (cands.length === 1) target = cands[0] ?? null;
        }
      }
      if (!target) return NOOP;
      // Niemals einen bereits an eine ANDERE PeerID gebundenen Eintrag kapern (Spoof-Schutz).
      if (target.libp2p.peerId !== null && target.libp2p.peerId !== peerId) return NOOP;

      // CR gpt-5.5 HIGH (transaktional): Vorzustand sichern, Bindung tentativ setzen — der
      // Aufrufer committet durch Nicht-Rollback NUR nach erfolgreicher Envelope-Signaturprüfung.
      const t = target;
      const prior = { peerId: t.libp2p.peerId, verified: t.libp2p.peerIdVerified };
      if (t.libp2p.peerId !== peerId) {
        this.log?.info(
          { agentId: t.agentId, host: t.host, peerId },
          'ADR-022 Flip: attestierte PeerID an Eintrag gebunden (tentativ, Bug-#2-Fix)',
        );
        t.libp2p.peerId = peerId;
      }
      t.libp2p.peerIdVerified = true;

      // Krypto-attestierte Supersession (nur bei kanonischem Sender = echter Flip): alte
      // Duplikate derselben PeerID entfernen. Entfernte Einträge werden für Rollback gesichert.
      const removed: Array<[string, MeshPeer]> = [];
      if (spiffeUriToPeerId(senderUri) === peerId) {
        for (const [id, p] of [...this.peers.entries()]) {
          if (p !== t && p.libp2p.peerId === peerId) {
            this.log?.info({ superseded: id, by: senderUri, peerId }, 'ADR-022 Flip: altes PeerID-Duplikat superseded');
            removed.push([id, p]);
            this.removePeer(id);
          }
        }
      }
      return {
        ok: true,
        rollback: () => {
          t.libp2p.peerId = prior.peerId;
          t.libp2p.peerIdVerified = prior.verified;
          for (const [id, p] of removed) if (!this.peers.has(id)) this.peers.set(id, p);
        },
      };
    }

    // Fallback (kein senderUri): nur bei EINDEUTIGEM Treffer markieren. Mehrere Peers mit
    // derselben PeerID (z.B. via mDNS-Spoofing) sind ambig → nicht markieren, warnen.
    const matches = [...this.peers.values()].filter((p) => p.libp2p.peerId === peerId);
    if (matches.length !== 1) {
      if (matches.length > 1) {
        this.log?.warn(
          { peerId, matches: matches.map((p) => ({ agentId: p.agentId, host: p.host, endpoint: p.endpoint })) },
          'PeerID-Verifikation nicht eindeutig (mDNS-Duplikat?) — nicht markiert',
        );
      }
      return NOOP;
    }
    const m = matches[0]!;
    const priorVerified = m.libp2p.peerIdVerified;
    m.libp2p.peerIdVerified = true;
    return { ok: true, rollback: () => { m.libp2p.peerIdVerified = priorVerified; } };
  }

  /**
   * MEDIUM (CR gpt-5.5): aktualisiert Endpoint/Host/Port eines bekannten Peers — NUR nach
   * erfolgreicher Card-/TLS-Validierung im Discovery-Handler aufrufen (nicht im rohen
   * mDNS-`addPeer`-Pfad), sonst bliebe ein zuerst angekündigter (evtl. gefälschter) Endpoint
   * sticky. Verhindert Endpoint-Hijacking durch mDNS-Preemption.
   */
  confirmPeerDiscovery(agentId: string, discovered: DiscoveredPeer): void {
    const peer = this.peers.get(agentId);
    if (!peer) return;
    peer.name = discovered.name;
    peer.host = discovered.host;
    peer.port = discovered.port;
    peer.endpoint = discovered.endpoint;
    peer.lastSeen = Date.now();
    peer.missedBeats = 0;
    peer.status = 'online';
  }

  get peerCount(): number {
    return this.peers.size;
  }

  private async checkPeers(): Promise<void> {
    const activePeers = [...this.peers.entries()].filter(([, p]) => p.status !== 'offline');
    await Promise.allSettled(
      activePeers.map(async ([agentId, peer]) => {
        try {
          const response = await fetch(`${peer.endpoint}/health`, {
            signal: AbortSignal.timeout(5_000),
            dispatcher: this.dispatcher,
          });

          if (response.ok) {
            this.recordHeartbeat(agentId);
          } else {
            this.handleMissedBeat(agentId, peer);
          }
        } catch {
          this.handleMissedBeat(agentId, peer);
        }
      }),
    );
  }

  private handleMissedBeat(agentId: string, peer: MeshPeer): void {
    peer.missedBeats++;
    this.log?.debug({ agentId, missedBeats: peer.missedBeats }, 'Heartbeat verpasst');

    if (peer.missedBeats >= this.missedBeatsThreshold) {
      this.log?.warn({ agentId }, 'Peer als offline markiert');
      peer.status = 'offline';
      this.events.onPeerOffline(peer);
    }
  }
}
