// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { buildPeerSkeleton, buildPeerOverview } from './peer-skeleton.js';
import type { MeshPeer, PeerStatus } from './mesh.js';
import type { AgentCard } from './agent-card.js';

/** Minimal-Agent-Card mit nur den vom Skelett gelesenen Feldern; Rest via Cast (Test-Fixture). */
function card(
  p: {
    version?: string;
    skills?: string[];
    load_percent?: number;
  } = {},
): AgentCard {
  return {
    name: 'card-name',
    version: p.version ?? '1.0.0',
    capabilities: { agents: [], skills: p.skills ?? [], services: [], connectors: [] },
    worker: {
      active_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      load_percent: p.load_percent ?? 0,
    },
  } as unknown as AgentCard;
}

function peer(p: Partial<MeshPeer> & { agentId: string }): MeshPeer {
  return {
    name: p.name ?? p.agentId,
    host: '10.10.10.1',
    port: 9440,
    endpoint: 'https://10.10.10.1:9440',
    status: 'online' as PeerStatus,
    lastSeen: 0,
    missedBeats: 0,
    agentCard: null,
    libp2p: {
      peerId: null,
      peerIdVerified: false,
      listenMultiaddrs: [],
      connected: false,
      status: 'unavailable',
    },
    ...p,
  } as MeshPeer;
}

describe('buildPeerSkeleton', () => {
  it('projiziert einen Peer mit Card auf die kompakten Felder', () => {
    const out = buildPeerSkeleton([
      peer({
        agentId: 'a',
        name: 'Alpha',
        status: 'online',
        agentCard: card({ version: '2.1.0', skills: ['s1', 's2'], load_percent: 42 }),
      }),
    ]);
    expect(out).toEqual([
      {
        agent_id: 'a',
        name: 'Alpha',
        status: 'online',
        version: '2.1.0',
        skills: 2,
        load_percent: 42,
      },
    ]);
  });

  it('Peer ohne Card → version/load_percent null, skills 0', () => {
    const out = buildPeerSkeleton([
      peer({ agentId: 'b', name: 'Beta', status: 'offline', agentCard: null }),
    ]);
    expect(out).toEqual([
      {
        agent_id: 'b',
        name: 'Beta',
        status: 'offline',
        version: null,
        skills: 0,
        load_percent: null,
      },
    ]);
  });

  it('sortiert deterministisch nach agent_id (locale-unabhängig)', () => {
    const out = buildPeerSkeleton([
      peer({ agentId: 'charlie' }),
      peer({ agentId: 'alpha' }),
      peer({ agentId: 'bravo' }),
    ]);
    expect(out.map((e) => e.agent_id)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('ein Eintrag pro Peer (keine Deduplizierung — Peers sind bereits distinkt)', () => {
    const out = buildPeerSkeleton([peer({ agentId: 'a' }), peer({ agentId: 'b' })]);
    expect(out).toHaveLength(2);
  });
});

describe('buildPeerSkeleton — total gegen malformed Daten (kein 500er)', () => {
  it('unbekannter/geschmiedeter status fällt auf unknown zurück', () => {
    const out = buildPeerSkeleton([
      peer({ agentId: 'a', status: 'PWNED' as unknown as PeerStatus }),
    ]);
    expect(out[0].status).toBe('unknown');
  });

  it('non-string agentId/name werden auf leeren String normalisiert (kein Sort-Crash)', () => {
    const out = buildPeerSkeleton([
      peer({ agentId: 123 as unknown as string, name: { evil: true } as unknown as string }),
    ]);
    expect(out[0].agent_id).toBe('');
    expect(out[0].name).toBe('');
  });

  it('skills non-array (geforgt) → 0 statt throw', () => {
    const bad = peer({
      agentId: 'a',
      agentCard: { capabilities: { skills: 'not-an-array' } } as unknown as AgentCard,
    });
    expect(buildPeerSkeleton([bad])[0].skills).toBe(0);
  });

  it('load_percent NaN/Infinity/non-number → null (kein Overclaim)', () => {
    const nan = peer({
      agentId: 'a',
      agentCard: { worker: { load_percent: NaN } } as unknown as AgentCard,
    });
    const inf = peer({
      agentId: 'b',
      agentCard: { worker: { load_percent: Infinity } } as unknown as AgentCard,
    });
    const str = peer({
      agentId: 'c',
      agentCard: { worker: { load_percent: '80' } } as unknown as AgentCard,
    });
    expect(buildPeerSkeleton([nan])[0].load_percent).toBeNull();
    expect(buildPeerSkeleton([inf])[0].load_percent).toBeNull();
    expect(buildPeerSkeleton([str])[0].load_percent).toBeNull();
  });

  it('non-string version → null (kein geforgter Wert durchgereicht)', () => {
    const bad = peer({ agentId: 'a', agentCard: { version: 42 } as unknown as AgentCard });
    expect(buildPeerSkeleton([bad])[0].version).toBeNull();
  });

  it('leere Eingabe → leeres Ergebnis', () => {
    expect(buildPeerSkeleton([])).toEqual([]);
  });
});

describe('buildPeerOverview', () => {
  it('Envelope { peers, count } mit count === peers.length', () => {
    const out = buildPeerOverview([peer({ agentId: 'a' }), peer({ agentId: 'b' })]);
    expect(out.count).toBe(2);
    expect(out.peers).toHaveLength(2);
    expect(out.count).toBe(out.peers.length);
  });

  it('leere Eingabe → { peers: [], count: 0 }', () => {
    expect(buildPeerOverview([])).toEqual({ peers: [], count: 0 });
  });
});
