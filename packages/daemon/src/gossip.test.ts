import { describe, it, expect } from 'vitest';
import { CapabilityRegistry, type Capability } from './registry.js';
import { GossipSync } from './gossip.js';
import { MeshManager, type MeshPeer } from './mesh.js';
import { MessageType, type MessageEnvelope, type RegistrySyncPayload } from './messages.js';

function makeCap(agentId: string, skillId: string): Capability {
  return {
    skill_id: skillId,
    version: '1.0.0',
    description: `Test ${skillId}`,
    agent_id: agentId,
    health: 'healthy',
    trust_level: 3,
    updated_at: new Date().toISOString(),
    category: 'test',
    permissions: [],
  };
}

describe('GossipSync — Registry-Synchronisation', () => {
  const agentA = 'spiffe://thinklocal/host/a/agent/claude-code';
  const agentB = 'spiffe://thinklocal/host/b/agent/gemini-cli';

  it('handleSyncMessage importiert Peer-Capabilities', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'local-skill'));

    const mesh = new MeshManager(10_000, 3, {
      onPeerOnline: () => {},
      onPeerOffline: () => {},
    });

    const gossip = new GossipSync(
      registry,
      mesh,
      agentA,
      'dummy-key', // Wird für handleSyncMessage nicht benötigt
    );

    // Simuliere eingehende Sync-Nachricht von Peer B
    const syncPayload: RegistrySyncPayload = {
      capability_hash: 'different-hash',
      capabilities: [
        {
          skill_id: 'remote-skill',
          version: '2.0.0',
          description: 'From peer B',
          agent_id: agentB,
          health: 'healthy',
          trust_level: 3,
          updated_at: new Date().toISOString(),
          category: 'test',
          permissions: [],
        },
      ],
    };

    const envelope: MessageEnvelope = {
      id: 'test-msg-1',
      type: MessageType.REGISTRY_SYNC,
      sender: agentB,
      correlation_id: 'test-msg-1',
      timestamp: new Date().toISOString(),
      ttl_ms: 60_000,
      idempotency_key: 'test-msg-1',
      payload: syncPayload,
    };

    const response = gossip.handleSyncMessage(envelope);

    // Prüfe dass die Capability importiert wurde
    expect(response.imported).toBe(1);
    expect(registry.findBySkill('remote-skill')).toHaveLength(1);
    expect(registry.findBySkill('local-skill')).toHaveLength(1);

    // Antwort enthält eigene Capabilities
    expect(response.capabilities.length).toBeGreaterThanOrEqual(1);
    expect(response.capability_hash).toBeTruthy();
  });

  it('handleSyncMessage importiert nichts bei gleichem Hash', () => {
    const registry = new CapabilityRegistry();
    registry.register(makeCap(agentA, 'skill-1'));
    const hash = registry.getCapabilityHash();

    const mesh = new MeshManager(10_000, 3, {
      onPeerOnline: () => {},
      onPeerOffline: () => {},
    });

    const gossip = new GossipSync(registry, mesh, agentA, 'dummy');

    const envelope: MessageEnvelope = {
      id: 'test-2',
      type: MessageType.REGISTRY_SYNC,
      sender: agentB,
      correlation_id: 'test-2',
      timestamp: new Date().toISOString(),
      ttl_ms: 60_000,
      idempotency_key: 'test-2',
      payload: {
        capability_hash: hash, // Gleicher Hash!
        capabilities: [],
      } as RegistrySyncPayload,
    };

    const response = gossip.handleSyncMessage(envelope);
    expect(response.imported).toBe(0);
    expect(response.capabilities).toHaveLength(0);
  });
});
