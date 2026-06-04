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
    expect(mesh.markPeerIdVerified(PID)).toBe(true);
    expect(mesh.getPeer(LEGACY)!.libp2p.peerIdVerified).toBe(true);
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBe('PUBKEY-V');
    // Unknown PeerID → no-op.
    expect(mesh.markPeerIdVerified('12D3KooWNoSuchPeer')).toBe(false);
  });
});
