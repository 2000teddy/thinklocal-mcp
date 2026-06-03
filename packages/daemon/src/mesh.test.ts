import { describe, it, expect } from 'vitest';
import { MeshManager } from './mesh.js';
import type { DiscoveredPeer } from './discovery.js';
import type { AgentCard } from './agent-card.js';
import { peerIdToSpiffeUri } from './peer-identity.js';

const noopEvents = { onPeerOnline: () => {}, onPeerOffline: () => {} };
const mkMesh = () => new MeshManager(10_000, 3, noopEvents);

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

  it('resolves a canonical node/<PeerID> sender via libp2p.peerId even when the card URI drifts (Root-Cause a fix)', () => {
    const mesh = mkMesh();
    // Peer discovered under a legacy/hostname URI but carries the libp2p PeerID.
    mesh.addPeer(disc({ agentId: LEGACY, p2pPeerId: PID }));
    mesh.updateAgentCard(LEGACY, card('PUBKEY-B', LEGACY));
    // Sender signs with the canonical PeerID URI — must still resolve.
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBe('PUBKEY-B');
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

  it('fail-closed: ambiguous PeerID match (two peers claim same mDNS peerId) resolves to undefined (CR HIGH)', () => {
    const mesh = mkMesh();
    // Two distinct discovery keys both advertising the SAME libp2p peerId (mDNS is
    // unauthenticated → an attacker could spoof a victim's PeerID). Must NOT trust either.
    mesh.addPeer(disc({ agentId: 'spiffe://thinklocal/host/aaa/agent/claude-code', p2pPeerId: PID }));
    mesh.addPeer(disc({ agentId: 'spiffe://thinklocal/host/bbb/agent/claude-code', p2pPeerId: PID, host: '10.10.10.10' }));
    mesh.updateAgentCard('spiffe://thinklocal/host/aaa/agent/claude-code', card('KEY-AAA', 'spiffe://thinklocal/host/aaa/agent/claude-code'));
    mesh.updateAgentCard('spiffe://thinklocal/host/bbb/agent/claude-code', card('KEY-BBB', 'spiffe://thinklocal/host/bbb/agent/claude-code'));
    // PeerID fallback is ambiguous (2 matches) → fail-closed.
    expect(mesh.resolvePeerPublicKey(peerIdToSpiffeUri(PID))).toBeUndefined();
    // But exact-spiffeUri resolution for each is still unambiguous and works.
    expect(mesh.resolvePeerPublicKey('spiffe://thinklocal/host/aaa/agent/claude-code')).toBe('KEY-AAA');
  });
});
