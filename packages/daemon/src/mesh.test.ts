// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { MeshManager } from './mesh.js';
import type { DiscoveredPeer } from './discovery.js';
import type { AgentCard } from './agent-card.js';
import { peerIdToSpiffeUri } from './peer-identity.js';

const noopEvents = { onPeerOnline: () => {}, onPeerOffline: () => {} };
const mkMesh = () => new MeshManager(10_000, 3, noopEvents);

// Simuliert den KÜNFTIGEN Krypto-Pfad (mTLS cert-SAN=node/<PeerID> oder libp2p-Noise),
// der peerIdVerified setzen wird. In Produktion gibt es diesen Pfad noch nicht → der
// PeerID-Fallback ist faktisch aus (HIGH 1).
function markPeerIdVerified(mesh: MeshManager, agentId: string): void {
  const p = mesh.getPeer(agentId);
  if (p) p.libp2p.peerIdVerified = true;
}

function disc(p: Partial<DiscoveredPeer> & { agentId: string }): DiscoveredPeer {
  return {
    name: p.name ?? 'peer',
    host: p.host ?? '10.10.10.9',
    port: p.port ?? 9440,
    agentId: p.agentId,
    p2pPeerId: p.p2pPeerId,
    capabilityHash: p.capabilityHash ?? '',
    certFingerprint: p.certFingerprint ?? '',
    endpoint: p.endpoint ?? 'https://10.10.10.9:9440',
  };
}

// AgentCard hat viele Pflichtfelder; für den Resolver zählen nur publicKey + spiffeUri.
// `mesh.libp2p` muss existieren, weil updateAgentCard daraus peer.libp2p.* fortschreibt
// (peer_id: null → behält die bei addPeer gesetzte PeerID via `?? peer.libp2p.peerId`).
const card = (publicKey: string, spiffeUri: string): AgentCard =>
  ({
    publicKey,
    spiffeUri,
    mesh: { libp2p: { peer_id: null, listen_multiaddrs: [], connected_peers: 0 } },
  } as unknown as AgentCard);

const PID = '12D3KooWCn86Frs2pqSkffVaoFsuHA7fByGZ7rULVqGcesk2RrJF';
const LEGACY = 'spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code';

describe('MeshManager.resolvePeerPublicKey — ADR-022 tolerant resolution', () => {
  it('resolves by exact agentId (legacy/identical URI path)', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY }));
    mesh.updateAgentCard(LEGACY, card('PUBKEY-A', LEGACY));
    expect(mesh.resolvePeerPublicKey(LEGACY)).toBe('PUBKEY-A');
  });

  it('canonical node/<PeerID> resolves ONLY when the PeerID is crypto-verified (HIGH 1 gate)', () => {
    const mesh = mkMesh();
    // Peer discovered under a legacy/hostname URI, carrying a libp2p PeerID FROM mDNS.
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('PUBKEY-B', LEGACY));
    // Unverified (mDNS-sourced) PeerID → fallback OFF → does NOT resolve.
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
    // Once a real crypto path verifies the PeerID binding → resolves.
    markPeerIdVerified(mesh, LEGACY);
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBe('PUBKEY-B');
  });

  it('SECURITY HIGH 1: attacker card (own key) advertising a VICTIM PeerID does NOT resolve — spoofing blocked', () => {
    const mesh = mkMesh();
    const VICTIM_PID = PID;
    // Attacker owns a verified-looking agent-card (ATTACKER-KEY) but advertises the
    // victim's PeerID via UNAUTHENTICATED mDNS → peerIdVerified stays false.
    const attacker = 'spiffe://thinklocal/host/attacker/agent/claude-code';
    mesh.addPeer(disc({ agentId: attacker, p2pPeerId: VICTIM_PID, host: '10.10.10.66' }));
    mesh.updateAgentCard(attacker, card('ATTACKER-KEY', attacker));
    // Sending as the victim's canonical node/<PeerID> URI must NOT return ATTACKER-KEY.
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(VICTIM_PID))).toBeUndefined();
  });

  it('resolves by card.spiffeUri when it differs from the discovery map key', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: 'discovery-key-xyz' }));
    mesh.updateAgentCard('discovery-key-xyz', card('PUBKEY-C', LEGACY));
    expect(mesh.resolvePeerPublicKey(LEGACY)).toBe('PUBKEY-C');
  });

  it('returns undefined when the peer is known but the card is not yet fetched (timing → 403 → retry)', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    // no updateAgentCard yet
    expect(mesh.resolvePeerPublicKey(LEGACY)).toBeUndefined();
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
  });

  it('returns undefined for a wholly unknown sender', () => {
    const mesh = mkMesh();
    expect(mesh.resolvePeerPublicKey('spiffe://thinklocal/node/UNKNOWN')).toBeUndefined();
  });

  it('fail-closed: even with crypto-verified PeerIDs, an AMBIGUOUS match (two peers, same PeerID) → undefined', () => {
    const mesh = mkMesh();
    const aaa = 'spiffe://thinklocal/host/aaa/agent/claude-code';
    const bbb = 'spiffe://thinklocal/host/bbb/agent/claude-code';
    mesh.addPeer(disc({ agentId: aaa, p2pPeerId: PID }));
    mesh.addPeer(disc({ agentId: bbb, p2pPeerId: PID, host: '10.10.10.10' }));
    mesh.updateAgentCard(aaa, card('KEY-AAA', aaa));
    mesh.updateAgentCard(bbb, card('KEY-BBB', bbb));
    // Even if BOTH were crypto-verified, two peers sharing one PeerID is ambiguous → fail-closed.
    markPeerIdVerified(mesh, aaa);
    markPeerIdVerified(mesh, bbb);
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
    // Exact-agentId resolution stays unambiguous and works.
    expect(mesh.resolvePeerPublicKey(aaa)).toBe('KEY-AAA');
  });

  it('SECURITY HIGH 1 (complete): node/<PeerID> as agentId OR card.spiffeUri does NOT resolve via exact match', () => {
    const mesh = mkMesh();
    const victimUri = peerIdToSpiffeUri(PID); // spiffe://thinklocal/node/<PID>
    // Attacker publishes the victim's CANONICAL URI as its mDNS agent-id AND its card
    // spiffeUri, with its OWN key. peerIdVerified stays false (mDNS/card not crypto-verified).
    mesh.addPeer(disc({ agentId: victimUri, p2pPeerId: PID, host: '10.10.10.66' }));
    mesh.updateAgentCard(victimUri, card('ATTACKER-KEY', victimUri));
    // Canonical node/<PeerID> URIs MUST bypass the exact agentId/card branches entirely →
    // only a crypto-verified PeerID binding may resolve them. Here: not verified → undefined.
    expect(mesh.resolvePeerPublicKey(victimUri)).toBeUndefined();
  });

  it('MEDIUM: a PeerID change via updateAgentCard resets peerIdVerified to false (no stale verification)', () => {
    const mesh = mkMesh();
    const uri = 'spiffe://thinklocal/host/x/agent/claude-code';
    mesh.addPeer(disc({ agentId: uri, p2pPeerId: PID }));
    mesh.updateAgentCard(uri, card('K', uri));
    markPeerIdVerified(mesh, uri);
    expect(mesh.getPeer(uri)!.libp2p.peerIdVerified).toBe(true);
    // Card now reports a DIFFERENT peerId → prior verification must be invalidated.
    const card2 = card('K', uri) as unknown as { mesh: { libp2p: { peer_id: string } } };
    card2.mesh.libp2p.peer_id = 'k51qzi5differentpeerid999';
    mesh.updateAgentCard(uri, card2 as unknown as AgentCard);
    expect(mesh.getPeer(uri)!.libp2p.peerId).toBe('k51qzi5differentpeerid999');
    expect(mesh.getPeer(uri)!.libp2p.peerIdVerified).toBe(false);
  });

  it('markPeerIdVerified(peerId) sets the crypto-verified flag and unlocks canonical resolution', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('PUBKEY-V', LEGACY));
    // Before: unverified → canonical resolution off.
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
    // The crypto path (CA-validated cert SAN / Noise) marks it.
    expect(mesh.markPeerIdVerified(PID).ok).toBe(true);
    expect(mesh.getPeer(LEGACY)!.libp2p.peerIdVerified).toBe(true);
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBe('PUBKEY-V');
    // Unknown PeerID → no-op.
    expect(mesh.markPeerIdVerified('12D3KooWNoSuchPeer').ok).toBe(false);
  });
});

describe('MeshManager — ADR-022 Phase-3 Identity-Supersession (CR gpt-5.5 HIGH: nur nach Cert-Attestierung)', () => {
  const canonical = peerIdToSpiffeUri(PID);
  const mkOffline = () => {
    const offline: string[] = [];
    const mesh = new MeshManager(10_000, 3, { onPeerOnline: () => {}, onPeerOffline: (p) => offline.push(p.agentId) });
    return { mesh, offline };
  };

  it('addPeer evictet NICHT bei rohem mDNS (auch selbstkonsistente node/<PeerID>-Ankündigung) — DoS-sicher', () => {
    const { mesh, offline } = mkOffline();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    // Selbstkonsistente kanonische Ankündigung (eingebettete PeerID == TXT p2pPeerId) — aber NUR mDNS.
    mesh.addPeer(disc({ agentId: canonical, p2pPeerId: PID, host: '10.10.10.9' }));
    // KEIN destruktives Evict im mDNS-Pfad → der Legacy-Peer bleibt (nur Warn-Log).
    expect(offline).not.toContain(LEGACY);
    expect(mesh.getPeer(LEGACY)).toBeDefined();
  });

  it('markPeerIdVerified(peerId, canonicalSender) supersedet alte Duplikate NACH Cert-Attestierung', () => {
    const { mesh, offline } = mkOffline();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('OLD', LEGACY));
    mesh.addPeer(disc({ agentId: canonical, p2pPeerId: PID, host: '10.10.10.9' }));
    mesh.updateAgentCard(canonical, card('NEW', canonical));
    // Cert-attestierter Flip: senderUri = kanonisch → markiert kanonischen Eintrag + supersedet Legacy.
    expect(mesh.markPeerIdVerified(PID, canonical).ok).toBe(true);
    expect(offline).toContain(LEGACY);
    expect(mesh.getPeer(LEGACY)).toBeUndefined();
    expect(mesh.getPeer(canonical)!.libp2p.peerIdVerified).toBe(true);
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('NEW');
  });

  it('Discovery-Lag-Fallback: kanonischer Eintrag fehlt → der EINDEUTIGE Legacy-Eintrag mit der PeerID wird attestiert (bricht 403-Deadlock)', () => {
    const mesh = mkMesh();
    // Nur der Legacy-Eintrag existiert (kanonische mDNS-Ankündigung noch nicht eingetroffen).
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('KEY-V', LEGACY));
    // Cert attestiert die kanonische Sender-URI; kein Eintrag darunter → Fallback auf eindeutige PeerID.
    expect(mesh.markPeerIdVerified(PID, canonical).ok).toBe(true);
    // Kanonische Auflösung klappt jetzt (Resolver matcht über peerId + verified, Card-Key bleibt gleich).
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('KEY-V');
  });

  it('127a: krypto-attestierter Flip schlüsselt den Legacy-Eintrag auf die kanonische agentId um (kosmetisch)', () => {
    const { mesh, offline } = mkOffline();
    // Nur der Legacy-Eintrag existiert (Discovery-Lag: kanonische mDNS-Ankündigung noch nicht da).
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('KEY-V', LEGACY));
    const res = mesh.markPeerIdVerified(PID, canonical);
    expect(res.ok).toBe(true);
    // Umgeschlüsselt: unter kanonischer agentId auffindbar (Key UND Feld), Legacy-Key weg …
    const peer = mesh.getPeer(canonical);
    expect(peer).toBeDefined();
    expect(peer!.agentId).toBe(canonical);
    expect(mesh.getPeer(LEGACY)).toBeUndefined();
    // … aber NICHT offline gesetzt (Re-Key ist kein removePeer) …
    expect(offline).not.toContain(LEGACY);
    // … und funktional unverändert: die Auflösung klappt weiter (peerId + verified).
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('KEY-V');
  });

  it('127a: rollback() dreht das Re-Key zurück (Legacy-Key + agentId zurück, Sig-Fehler-Pfad)', () => {
    const { mesh } = mkOffline();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('KEY-V', LEGACY));
    const res = mesh.markPeerIdVerified(PID, canonical);
    expect(res.ok).toBe(true);
    expect(mesh.getPeer(canonical)).toBeDefined();
    // agent-card.ts ruft rollback() bei fehlgeschlagener Envelope-Signatur → alles zurück.
    res.rollback();
    const peer = mesh.getPeer(LEGACY);
    expect(peer).toBeDefined();
    expect(peer!.agentId).toBe(LEGACY);
    expect(mesh.getPeer(canonical)).toBeUndefined();
    expect(peer!.libp2p.peerIdVerified).toBe(false); // auch die tentative Bindung zurückgedreht
  });

  it('127a: Re-Key korrumpiert keine fremden Einträge und erzeugt keinen Duplicate-/Orphan-Key', () => {
    const { mesh } = mkOffline();
    const OTHER_PID = '12D3KooWOtherPeerAbc123def456ghi789jkl012mno345pqr';
    const OTHER_LEGACY = 'spiffe://thinklocal/host/otherhost/agent/claude-code';
    // Ziel-Peer (Legacy, PID) + ein FREMDER Peer (andere PeerID, anderer Key/Host).
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('KEY-V', LEGACY));
    mesh.addPeer(disc({ agentId: OTHER_LEGACY, p2pPeerId: OTHER_PID, host: '10.10.10.20' }));
    mesh.updateAgentCard(OTHER_LEGACY, card('OTHER-KEY', OTHER_LEGACY));
    // Nur den Ziel-Peer flippen.
    expect(mesh.markPeerIdVerified(PID, canonical).ok).toBe(true);
    // Ziel umgeschlüsselt …
    expect(mesh.getPeer(canonical)!.agentId).toBe(canonical);
    expect(mesh.getPeer(LEGACY)).toBeUndefined();
    // … der FREMDE Peer bleibt vollständig unberührt (Key + agentId) …
    const other = mesh.getPeer(OTHER_LEGACY);
    expect(other).toBeDefined();
    expect(other!.agentId).toBe(OTHER_LEGACY);
    // … und es bleiben GENAU zwei Einträge (keine Verwaisung, keine Dopplung).
    expect(mesh.getOnlinePeers().length).toBe(2);
  });

  it('Fallback ohne senderUri bleibt fail-closed bei Ambiguität (Rückwärtskompatibilität)', () => {
    const mesh = mkMesh();
    const aaa = 'spiffe://thinklocal/host/aaa/agent/claude-code';
    const bbb = 'spiffe://thinklocal/host/bbb/agent/claude-code';
    mesh.addPeer(disc({ agentId: aaa, p2pPeerId: PID }));
    mesh.addPeer(disc({ agentId: bbb, p2pPeerId: PID, host: '10.10.10.10' }));
    expect(mesh.markPeerIdVerified(PID).ok).toBe(false); // zwei Treffer → nicht markiert
  });
});

describe('MeshManager.markPeerIdVerified — Bug #2: Host-Bind der attestierten PeerID (.56/.222)', () => {
  const canonical = peerIdToSpiffeUri(PID);

  it('Legacy-Eintrag OHNE gelernte PeerID wird über remoteHost gebunden → kanonisch auflösbar', () => {
    const mesh = mkMesh();
    // Empfänger-Zustand wie .56/.222: Legacy-Eintrag mit Card+Key, aber libp2p.peerId NIE gelernt.
    mesh.addPeer(disc({ agentId: LEGACY, host: '10.10.10.80' })); // KEIN p2pPeerId
    mesh.updateAgentCard(LEGACY, card('TH01-KEY', LEGACY));
    expect(mesh.getPeer(LEGACY)!.libp2p.peerId).toBeNull();
    // Ohne remoteHost: weder senderUri- noch peerId-Lookup greift → fail-closed.
    expect(mesh.markPeerIdVerified(PID, canonical).ok).toBe(false);
    // MIT remoteHost (TLS-Source des attestierten Connects) → Bind an den Host-Eintrag.
    expect(mesh.markPeerIdVerified(PID, canonical, '10.10.10.80').ok).toBe(true);
    expect(mesh.getPeer(LEGACY)!.libp2p.peerId).toBe(PID);
    expect(mesh.getPeer(LEGACY)!.libp2p.peerIdVerified).toBe(true);
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('TH01-KEY'); // Announce jetzt akzeptiert
  });

  it('IPv6-mapped remoteHost (::ffff:10.10.10.80) matcht den IPv4-Host-Eintrag', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY, host: '10.10.10.80' }));
    mesh.updateAgentCard(LEGACY, card('K', LEGACY));
    expect(mesh.markPeerIdVerified(PID, canonical, '::ffff:10.10.10.80').ok).toBe(true);
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('K');
  });

  it('spoof-sicher: remoteHost matcht KEINEN Eintrag → kein Bind (fail-closed)', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY, host: '10.10.10.80' }));
    mesh.updateAgentCard(LEGACY, card('K', LEGACY));
    expect(mesh.markPeerIdVerified(PID, canonical, '10.10.10.99').ok).toBe(false);
    expect(mesh.getPeer(LEGACY)!.libp2p.peerId).toBeNull();
  });

  it('spoof-sicher: bereits mit ANDERER PeerID verifizierter Host-Eintrag wird NICHT umgebunden', () => {
    const mesh = mkMesh();
    const OTHER = '12D3KooWOtherPeerIdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    mesh.addPeer(disc({ agentId: LEGACY, host: '10.10.10.80', p2pPeerId: OTHER }));
    mesh.updateAgentCard(LEGACY, card('K', LEGACY));
    mesh.markPeerIdVerified(OTHER, peerIdToSpiffeUri(OTHER), '10.10.10.80'); // erst auf OTHER verifiziert
    // 127a: Der OTHER-Flip läuft über den eindeutigen PeerID-Pfad → der Eintrag wird auf die
    // kanonische node/OTHER-agentId umgeschlüsselt (Legacy-Key weg). Die Security-Semantik ändert
    // sich NICHT — der folgende Spoof-Versuch bleibt abgelehnt.
    const otherCanon = peerIdToSpiffeUri(OTHER);
    // Versuch, denselben Host-Eintrag auf eine FREMDE PeerID umzubinden → abgelehnt.
    expect(mesh.markPeerIdVerified(PID, canonical, '10.10.10.80').ok).toBe(false);
    expect(mesh.getPeer(otherCanon)!.libp2p.peerId).toBe(OTHER);
  });

  it('CR-HIGH transaktional: rollback() macht Host-Bind + Supersession rückgängig (Sig-Fehler-Pfad)', () => {
    const offline: string[] = [];
    const mesh = new MeshManager(10_000, 3, { onPeerOnline: () => {}, onPeerOffline: (p) => offline.push(p.agentId) });
    // Host-Eintrag ohne gelernte PeerID + ein altes Duplikat unter kanonischer ID (würde superseded).
    mesh.addPeer(disc({ agentId: LEGACY, host: '10.10.10.80' }));
    mesh.updateAgentCard(LEGACY, card('K', LEGACY));
    mesh.addPeer(disc({ agentId: canonical, host: '10.10.10.81', p2pPeerId: PID }));
    mesh.updateAgentCard(canonical, card('K2', canonical));
    const res = mesh.markPeerIdVerified(PID, canonical, '10.10.10.80');
    expect(res.ok).toBe(true);
    // ... bei fehlgeschlagener Signatur ruft agent-card.ts rollback():
    res.rollback();
    expect(mesh.getPeer(LEGACY)!.libp2p.peerId).toBeNull(); // Bindung zurückgenommen
    expect(mesh.getPeer(LEGACY)!.libp2p.peerIdVerified).toBe(false);
    expect(mesh.getPeer(canonical)).toBeDefined(); // supersedeter Eintrag wiederhergestellt
    expect(mesh.resolvePeerPublicKey(canonical)).toBeUndefined(); // keine persistente Fehlbindung
  });

  it('CR-HIGH: exakter senderUri-Eintrag mit peerId=null wird nach Attestierung gebunden', () => {
    const mesh = mkMesh();
    // Empfänger hat bereits einen Eintrag UNTER der kanonischen URI, aber ohne gelernte PeerID.
    mesh.addPeer(disc({ agentId: canonical, host: '10.10.10.80' })); // kein p2pPeerId → peerId=null
    mesh.updateAgentCard(canonical, card('K', canonical));
    expect(mesh.getPeer(canonical)!.libp2p.peerId).toBeNull();
    expect(mesh.markPeerIdVerified(PID, canonical).ok).toBe(true); // ohne remoteHost, exakter Treffer
    expect(mesh.getPeer(canonical)!.libp2p.peerId).toBe(PID);
    expect(mesh.resolvePeerPublicKey(canonical)).toBe('K');
  });
});

// ADR-026/025 Online-Self-Healing (CR gpt-5.5 MEDIUM): addPeer auf einen OFFLINE Peer
// (Steady-Reconciler-Reconnect) muss den Offline→Online-Übergang via onPeerOnline feuern.
describe('MeshManager.addPeer — Offline→Online Re-Connect feuert onPeerOnline', () => {
  it('re-connect eines offline-markierten Peers triggert onPeerOnline (Recovery)', () => {
    let online = 0;
    let offline = 0;
    const events = { onPeerOnline: () => { online++; }, onPeerOffline: () => { offline++; } };
    const mesh = new MeshManager(10_000, 3, events);
    mesh.addPeer(disc({ agentId: LEGACY }));        // initial → online (online=1)
    expect(online).toBe(1);
    mesh.getPeer(LEGACY)!.status = 'offline';        // simuliert missed-beats offline
    mesh.addPeer(disc({ agentId: LEGACY }));          // Steady-Reconnect → Recovery
    expect(online).toBe(2);                            // onPeerOnline erneut gefeuert
    expect(mesh.getPeer(LEGACY)!.status).toBe('online');
  });

  it('re-connect eines bereits ONLINE Peers feuert onPeerOnline NICHT erneut (kein Spam)', () => {
    let online = 0;
    const events = { onPeerOnline: () => { online++; }, onPeerOffline: () => {} };
    const mesh = new MeshManager(10_000, 3, events);
    mesh.addPeer(disc({ agentId: LEGACY }));  // online=1
    mesh.addPeer(disc({ agentId: LEGACY }));  // bereits online → kein erneutes Event
    expect(online).toBe(1);
  });
});

// ADR-026: symmetrische Auth-Peer-Registrierung (authenticated-seen-Map, AUTHN-only).
describe('ADR-026 authenticated-seen (AUTHN-only)', () => {
  const A = '12D3KooWAuthSeenPeerAAAA';
  const B = '12D3KooWAuthSeenPeerBBBB';

  it('recordAuthenticatedSeen → resolvePeerPublicKey löst kanonischen Sender auf', () => {
    const mesh = mkMesh();
    const uri = peerIdToSpiffeUri(A);
    expect(mesh.resolvePeerPublicKey(uri)).toBeUndefined(); // vorher nicht auflösbar
    mesh.recordAuthenticatedSeen({ peerId: A, publicKey: 'PK-A', spiffeUri: uri, certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    expect(mesh.resolvePeerPublicKey(uri)).toBe('PK-A');
  });

  it('löst NUR den exakten PeerID-Sender auf (kein Cross-Match)', () => {
    const mesh = mkMesh();
    mesh.recordAuthenticatedSeen({ peerId: A, publicKey: 'PK-A', spiffeUri: peerIdToSpiffeUri(A), certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(B))).toBeUndefined();
  });

  it('INVARIANTE: seen-Eintrag leakt NICHT in this.peers (AUTHN ≠ AUTHZ)', () => {
    const mesh = mkMesh();
    const uri = peerIdToSpiffeUri(A);
    mesh.recordAuthenticatedSeen({ peerId: A, publicKey: 'PK-A', spiffeUri: uri, certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    // AUTHN: Key auflösbar …
    expect(mesh.resolvePeerPublicKey(uri)).toBe('PK-A');
    // … aber AUTHZ-Pfade lesen this.peers — der Peer ist dort NICHT (kein getPeer-Treffer,
    // kein markPeerIdVerified-Bind, zählt nicht als approved/online).
    expect(mesh.getPeer(uri)).toBeUndefined();
    expect(mesh.getPeer(A)).toBeUndefined();
    expect(mesh.markPeerIdVerified(A).ok).toBe(false); // kein this.peers-Eintrag zum Binden
  });

  it('LRU-Cap: bei Überschreitung wird der älteste Eintrag verworfen', () => {
    const mesh = mkMesh();
    // 257 Einträge (> AUTH_SEEN_MAX=256) → erster (ältester) fällt raus.
    for (let i = 0; i < 257; i++) {
      const pid = `12D3KooWcap${i.toString().padStart(4, '0')}`;
      mesh.recordAuthenticatedSeen({ peerId: pid, publicKey: `PK-${i}`, spiffeUri: peerIdToSpiffeUri(pid), certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    }
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri('12D3KooWcap0000'))).toBeUndefined(); // ältester evicted
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri('12D3KooWcap0256'))).toBe('PK-256');   // neuester da
  });
});

describe('ADR-035 A1 — Peer-Cache Export/Boot-Ziele (Locator-only)', () => {
  const A = '12D3KooWAuthSeenPeerAAAA';

  it('exportSeenLocators: Locator ohne publicKey, kanonische Felder', () => {
    const mesh = mkMesh();
    const uri = peerIdToSpiffeUri(A);
    mesh.recordAuthenticatedSeen({ peerId: A, publicKey: 'PK-SECRET', spiffeUri: uri, certFingerprint: 'fp-a', endpoint: 'https://10.10.10.55:9440' });
    const locs = mesh.exportSeenLocators();
    expect(locs).toHaveLength(1);
    expect(locs[0]).toMatchObject({ peerId: A, spiffeUri: uri, endpoint: 'https://10.10.10.55:9440', certFingerprint: 'fp-a' });
    // SECURITY: kein publicKey im exportierten Locator.
    expect(JSON.stringify(locs)).not.toContain('PK-SECRET');
    expect(Object.keys(locs[0]!)).not.toContain('publicKey');
  });

  it('exportSeenLocators: leere Map → []', () => {
    expect(mkMesh().exportSeenLocators()).toEqual([]);
  });

  it('setBootReLearnTargets/getBootReLearnTargets: Ziele hinterlegt, aber KEIN Auflösungspfad (inert)', () => {
    const mesh = mkMesh();
    const uri = peerIdToSpiffeUri(A);
    mesh.setBootReLearnTargets([{ peerId: A, spiffeUri: uri, endpoint: 'https://10.10.10.55:9440', certFingerprint: 'fp', lastSeen: 1 }]);
    expect(mesh.getBootReLearnTargets()).toHaveLength(1);
    // INERT: geladene Ziele lösen NICHT auf (A1 ändert keinen Auflösungspfad; das ist A2).
    expect(mesh.resolvePeerPublicKey(uri)).toBeUndefined();
    expect(mesh.getPeer(uri)).toBeUndefined();
  });
});

// ADR-026 / CR gpt-5.5 HIGH 1: AUTHZ-Prädikat isApprovedPeerSender — ein AUTHN-only gelernter
// Peer ist NIE approved (gatet REGISTRY_SYNC / SKILL_ANNOUNCE in index.ts).
describe('ADR-026 isApprovedPeerSender (AUTHZ ≠ AUTHN)', () => {
  const A = '12D3KooWAuthSeenPeerAAAA';

  it('HIGH 1: ein authenticated_unapproved (seen-only) Sender ist AUTHN-auflösbar, aber NICHT approved', () => {
    const mesh = mkMesh();
    const uri = peerIdToSpiffeUri(A);
    mesh.recordAuthenticatedSeen({ peerId: A, publicKey: 'PK-A', spiffeUri: uri, certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    // AUTHN: Signatur-Key auflösbar …
    expect(mesh.resolvePeerPublicKey(uri)).toBe('PK-A');
    // … AUTHZ: aber NICHT approved → REGISTRY_SYNC/SKILL_ANNOUNCE würden abgelehnt.
    expect(mesh.isApprovedPeerSender(uri)).toBe(false);
  });

  it('ein verifizierter discovered Peer (this.peers) IST approved (canonical + legacy)', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('KEY-L', LEGACY));
    markPeerIdVerified(mesh, LEGACY);
    expect(mesh.isApprovedPeerSender(peerIdToSpiffeUri(PID))).toBe(true); // canonical via verified PeerID
    expect(mesh.isApprovedPeerSender(LEGACY)).toBe(true);                  // legacy exact match
  });

  it('ein nicht-verifizierter (roh-mDNS) Peer ist NICHT approved', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: peerIdToSpiffeUri(PID), p2pPeerId: PID, host: '10.10.10.66' }));
    mesh.updateAgentCard(peerIdToSpiffeUri(PID), card('ATTACKER-KEY', peerIdToSpiffeUri(PID)));
    // peerIdVerified bleibt false → kein approved-Treffer auf der kanonischen URI.
    expect(mesh.isApprovedPeerSender(peerIdToSpiffeUri(PID))).toBe(false);
  });

  it('HIGH 2: bei mehrdeutigen verifizierten PeerID-Treffern überstimmt authenticatedSeen NICHT → undefined', () => {
    const mesh = mkMesh();
    const aaa = 'spiffe://thinklocal/host/aaa/agent/claude-code';
    const bbb = 'spiffe://thinklocal/host/bbb/agent/claude-code';
    mesh.addPeer(disc({ agentId: aaa, p2pPeerId: PID }));
    mesh.addPeer(disc({ agentId: bbb, p2pPeerId: PID, host: '10.10.10.10' }));
    mesh.updateAgentCard(aaa, card('KEY-AAA', aaa));
    mesh.updateAgentCard(bbb, card('KEY-BBB', bbb));
    markPeerIdVerified(mesh, aaa);
    markPeerIdVerified(mesh, bbb);
    // Zusätzlich ein seen-Eintrag für DIESELBE PeerID — darf den fail-closed-Zustand NICHT überstimmen.
    mesh.recordAuthenticatedSeen({ peerId: PID, publicKey: 'PK-SEEN', spiffeUri: peerIdToSpiffeUri(PID), certFingerprint: 'fp', endpoint: 'https://10.0.0.1:9440' });
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
  });
});

// ADR-026 INVARIANTE (Architektur-Test): authenticatedSeen wird AUSSCHLIESSLICH von
// recordAuthenticatedSeen + resolvePeerPublicKey referenziert — NIE von Autorisierungspfaden.
describe('ADR-026 authenticatedSeen-Isolation (Architektur)', () => {
  it('this.authenticatedSeen nur in record/resolve referenziert', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(require('node:path').join(__dirname, 'mesh.ts'), 'utf-8');
    // Zeilen mit this.authenticatedSeen sammeln + die umgebende Methode prüfen.
    const lines = src.split('\n');
    const refLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes('this.authenticatedSeen'));
    expect(refLines.length).toBeGreaterThan(0);
    // Erlaubte Methoden: recordAuthenticatedSeen, resolvePeerPublicKey, (Feld-Deklaration) und
    // ADR-035 A1 exportSeenLocators — LEGITIMER Reader: exportiert NUR Locator OHNE publicKey für
    // die Persistenz (kein Autorisierungspfad, kein Key-Leak; strukturell durch Locator-Schema).
    for (const { i } of refLines) {
      // rückwärts die nächste Methoden-Signatur suchen
      let method = '';
      for (let j = i; j >= 0; j--) {
        const m = lines[j].match(/^\s{2}(\w+)\s*[(<]/);
        if (m) { method = m[1]; break; }
        if (/^\s*private authenticatedSeen/.test(lines[j])) { method = '<field-decl>'; break; }
      }
      expect(['recordAuthenticatedSeen', 'resolvePeerPublicKey', 'exportSeenLocators', '<field-decl>']).toContain(method);
    }
  });
});

describe('MeshManager.getPeerCounts — Phantom-ROT-Observability (Bug-Pfad 1, §9)', () => {
  const A = 'spiffe://thinklocal/host/aaa/agent/claude-code';
  const B = 'spiffe://thinklocal/host/bbb/agent/claude-code';
  const C = 'spiffe://thinklocal/host/ccc/agent/claude-code';

  it('leeres Mesh → alle Zähler 0', () => {
    expect(mkMesh().getPeerCounts()).toEqual({ known: 0, online: 0, offline: 0 });
  });

  it('frisch hinzugefügte Peers sind online; known === online', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: A }));
    mesh.addPeer(disc({ agentId: B, host: '10.10.10.10' }));
    expect(mesh.getPeerCounts()).toEqual({ known: 2, online: 2, offline: 0 });
  });

  it('bekannte-aber-offline Peers bleiben in known, fallen aus online (die Kern-Invariante)', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: A }));
    mesh.addPeer(disc({ agentId: B, host: '10.10.10.10' }));
    mesh.addPeer(disc({ agentId: C, host: '10.10.10.11' }));
    // Heartbeat-Fehlschlag simulieren: Peer bleibt im Map, nur status='offline'
    // (genau wie handleMissedBeat nach missedBeatsThreshold; Peer wird NICHT gelöscht).
    mesh.getPeer(B)!.status = 'offline';
    expect(mesh.getPeerCounts()).toEqual({ known: 3, online: 2, offline: 1 });
    // getOnlinePeers und getPeerCounts.online müssen konsistent sein
    expect(mesh.getOnlinePeers().length).toBe(mesh.getPeerCounts().online);
  });

  it('worst case „Phantom-ROT von unten": alle bekannt, keiner online', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: A }));
    mesh.addPeer(disc({ agentId: B, host: '10.10.10.10' }));
    mesh.getPeer(A)!.status = 'offline';
    mesh.getPeer(B)!.status = 'unknown'; // 'unknown' zählt ebenfalls als nicht-online
    const c = mesh.getPeerCounts();
    expect(c).toEqual({ known: 2, online: 0, offline: 2 });
    // Der diagnostische Diskriminator: known>0 && online==0 ⇒ Heartbeat/Cert, kein „down"
    expect(c.known > 0 && c.online === 0).toBe(true);
  });

  it('Invariante known === online + offline für jede Zusammensetzung', () => {
    const mesh = mkMesh();
    mesh.addPeer(disc({ agentId: A }));
    mesh.addPeer(disc({ agentId: B, host: '10.10.10.10' }));
    mesh.addPeer(disc({ agentId: C, host: '10.10.10.11' }));
    mesh.getPeer(C)!.status = 'offline';
    const c = mesh.getPeerCounts();
    expect(c.online + c.offline).toBe(c.known);
  });
});
