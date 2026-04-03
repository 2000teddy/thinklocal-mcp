import { describe, it, expect, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { DaemonConfig } from '../../packages/daemon/src/config.js';
import { loadOrCreateIdentity } from '../../packages/daemon/src/identity.js';
import { AuditLog } from '../../packages/daemon/src/audit.js';
import { AgentCardServer } from '../../packages/daemon/src/agent-card.js';
import { MeshManager, type MeshPeer } from '../../packages/daemon/src/mesh.js';
import type { AgentCard } from '../../packages/daemon/src/agent-card.js';
import type { DiscoveredPeer } from '../../packages/daemon/src/discovery.js';

function makeConfig(port: number, agentType: string, dataDir: string): DaemonConfig {
  return {
    daemon: {
      port,
      hostname: 'localhost',
      agent_type: agentType,
      data_dir: dataDir,
    },
    mesh: {
      heartbeat_interval_ms: 2_000,
      heartbeat_timeout_missed: 3,
    },
    discovery: {
      mdns_service_type: '_thinklocal._tcp',
    },
    logging: {
      level: 'warn',
    },
  };
}

describe('Two-Node Integration Test', () => {
  const tmpDirA = mkdtempSync(resolve(tmpdir(), 'tlmcp-test-a-'));
  const tmpDirB = mkdtempSync(resolve(tmpdir(), 'tlmcp-test-b-'));

  const configA = makeConfig(19440, 'claude-code', tmpDirA);
  const configB = makeConfig(19441, 'gemini-cli', tmpDirB);

  let identityA: Awaited<ReturnType<typeof loadOrCreateIdentity>>;
  let identityB: Awaited<ReturnType<typeof loadOrCreateIdentity>>;
  let auditA: AuditLog;
  let auditB: AuditLog;
  let cardServerA: AgentCardServer;
  let cardServerB: AgentCardServer;
  let meshA: MeshManager;
  let meshB: MeshManager;

  afterAll(async () => {
    meshA?.stopHeartbeatLoop();
    meshB?.stopHeartbeatLoop();
    await cardServerA?.stop();
    await cardServerB?.stop();
    auditA?.close();
    auditB?.close();
    rmSync(tmpDirA, { recursive: true, force: true });
    rmSync(tmpDirB, { recursive: true, force: true });
  });

  it('generates unique identities with SPIFFE URIs', async () => {
    identityA = await loadOrCreateIdentity(tmpDirA, 'claude-code', 'localhost');
    identityB = await loadOrCreateIdentity(tmpDirB, 'gemini-cli', 'localhost');

    expect(identityA.spiffeUri).toBe('spiffe://thinklocal/host/localhost/agent/claude-code');
    expect(identityB.spiffeUri).toBe('spiffe://thinklocal/host/localhost/agent/gemini-cli');
    expect(identityA.fingerprint).not.toBe(identityB.fingerprint);
    expect(identityA.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('serves agent cards on /.well-known/agent-card.json', async () => {
    cardServerA = new AgentCardServer(identityA, configA);
    cardServerB = new AgentCardServer(identityB, configB);
    await cardServerA.start();
    await cardServerB.start();

    const resA = await fetch('http://localhost:19440/.well-known/agent-card.json');
    expect(resA.ok).toBe(true);
    const cardA = (await resA.json()) as AgentCard;
    expect(cardA.capabilities.agents).toContain('claude-code');
    expect(cardA.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(cardA.spiffeUri).toContain('claude-code');

    const resB = await fetch('http://localhost:19441/.well-known/agent-card.json');
    expect(resB.ok).toBe(true);
    const cardB = (await resB.json()) as AgentCard;
    expect(cardB.capabilities.agents).toContain('gemini-cli');
  });

  it('nodes discover each other, exchange cards, and log audit events', async () => {
    auditA = new AuditLog(tmpDirA, identityA.privateKeyPem, identityA.spiffeUri);
    auditB = new AuditLog(tmpDirB, identityB.privateKeyPem, identityB.spiffeUri);

    const peerJoinEventsA: string[] = [];
    const peerJoinEventsB: string[] = [];

    meshA = new MeshManager(2_000, 3, {
      onPeerOnline: (peer: MeshPeer) => {
        peerJoinEventsA.push(peer.agentId);
        auditA.append('PEER_JOIN', peer.agentId, `${peer.host}:${peer.port}`);
      },
      onPeerOffline: (peer: MeshPeer) => {
        auditA.append('PEER_LEAVE', peer.agentId);
      },
    });

    meshB = new MeshManager(2_000, 3, {
      onPeerOnline: (peer: MeshPeer) => {
        peerJoinEventsB.push(peer.agentId);
        auditB.append('PEER_JOIN', peer.agentId, `${peer.host}:${peer.port}`);
      },
      onPeerOffline: (peer: MeshPeer) => {
        auditB.append('PEER_LEAVE', peer.agentId);
      },
    });

    // Simuliere Peer-Discovery (wie mDNS es tun würde)
    const discoveredB: DiscoveredPeer = {
      name: 'localhost-gemini-cli',
      host: 'localhost',
      port: 19441,
      agentId: identityB.spiffeUri,
      capabilityHash: '',
      certFingerprint: identityB.fingerprint,
      endpoint: 'http://localhost:19441',
    };

    const discoveredA: DiscoveredPeer = {
      name: 'localhost-claude-code',
      host: 'localhost',
      port: 19440,
      agentId: identityA.spiffeUri,
      capabilityHash: '',
      certFingerprint: identityA.fingerprint,
      endpoint: 'http://localhost:19440',
    };

    // Node A entdeckt Node B
    meshA.addPeer(discoveredB);
    // Node B entdeckt Node A
    meshB.addPeer(discoveredA);

    expect(peerJoinEventsA).toContain(identityB.spiffeUri);
    expect(peerJoinEventsB).toContain(identityA.spiffeUri);

    // Agent Cards austauschen
    const resCardB = await fetch('http://localhost:19441/.well-known/agent-card.json');
    const cardB = (await resCardB.json()) as AgentCard;
    meshA.updateAgentCard(identityB.spiffeUri, cardB);

    const resCardA = await fetch('http://localhost:19440/.well-known/agent-card.json');
    const cardA = (await resCardA.json()) as AgentCard;
    meshB.updateAgentCard(identityA.spiffeUri, cardA);

    const peerInA = meshA.getPeer(identityB.spiffeUri);
    expect(peerInA?.agentCard?.capabilities.agents).toContain('gemini-cli');

    const peerInB = meshB.getPeer(identityA.spiffeUri);
    expect(peerInB?.agentCard?.capabilities.agents).toContain('claude-code');

    // Audit-Log prüfen
    const eventsA = auditA.getEvents();
    expect(eventsA.some((e) => e.event_type === 'PEER_JOIN')).toBe(true);
    expect(eventsA[0].signature).toBeTruthy();

    const eventsB = auditB.getEvents();
    expect(eventsB.some((e) => e.event_type === 'PEER_JOIN')).toBe(true);
  });

  it('heartbeat detects peer health', async () => {
    // Health-Endpunkte müssen erreichbar sein
    const healthA = await fetch('http://localhost:19440/health');
    expect(healthA.ok).toBe(true);
    const healthDataA = (await healthA.json()) as { status: string };
    expect(healthDataA.status).toBe('ok');

    const healthB = await fetch('http://localhost:19441/health');
    expect(healthB.ok).toBe(true);

    // Heartbeat-Prüfung: Mesh Manager sollte Peers als online sehen
    const onlinePeersA = meshA.getOnlinePeers();
    expect(onlinePeersA.length).toBe(1);
    expect(onlinePeersA[0].agentId).toBe(identityB.spiffeUri);
  });
});
