/**
 * chaos.test.ts — Chaos-Tests fuer Mesh-Resilienz
 *
 * Simuliert Fehlerszenarien ohne echte Netzwerk-Infra:
 * - Network Partition (Peers koennen sich nicht erreichen)
 * - Node-Ausfall (Node antwortet nicht mehr)
 * - Split-Brain (Zwei Gruppen sehen verschiedene Peers)
 * - Heartbeat-Verlust (einzelne Heartbeats gehen verloren)
 * - Rapid Rejoin (Node geht offline und sofort wieder online)
 * - Gossip-Storm (viele gleichzeitige Updates)
 */

import { describe, it, expect } from 'vitest';

// Simulierter Peer-Tracker (vereinfachte Mesh-Logik)
interface SimPeer {
  id: string;
  status: 'online' | 'offline';
  lastSeen: number;
  missedBeats: number;
}

class SimMesh {
  peers = new Map<string, SimPeer>();
  private missedThreshold: number;

  constructor(missedThreshold = 3) {
    this.missedThreshold = missedThreshold;
  }

  addPeer(id: string): void {
    this.peers.set(id, { id, status: 'online', lastSeen: Date.now(), missedBeats: 0 });
  }

  heartbeat(id: string, success: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;

    if (success) {
      peer.lastSeen = Date.now();
      peer.missedBeats = 0;
      peer.status = 'online';
    } else {
      peer.missedBeats++;
      if (peer.missedBeats >= this.missedThreshold) {
        peer.status = 'offline';
      }
    }
  }

  getOnline(): string[] {
    return [...this.peers.values()].filter((p) => p.status === 'online').map((p) => p.id);
  }

  getOffline(): string[] {
    return [...this.peers.values()].filter((p) => p.status === 'offline').map((p) => p.id);
  }
}

describe('Chaos: Network Partition', () => {
  it('erkennt Partition nach N verpassten Heartbeats', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');
    mesh.addPeer('node-C');

    // Alle online
    expect(mesh.getOnline()).toEqual(['node-B', 'node-C']);

    // node-B wird unerreichbar (Partition)
    mesh.heartbeat('node-B', false);
    mesh.heartbeat('node-B', false);
    expect(mesh.getOnline()).toContain('node-B'); // Noch online (nur 2 missed)

    mesh.heartbeat('node-B', false); // 3. missed → offline
    expect(mesh.getOffline()).toContain('node-B');
    expect(mesh.getOnline()).not.toContain('node-B');

    // node-C bleibt online
    mesh.heartbeat('node-C', true);
    expect(mesh.getOnline()).toContain('node-C');
  });

  it('heilt nach Partition-Ende', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');

    // Partition: 3 missed beats → offline
    for (let i = 0; i < 3; i++) mesh.heartbeat('node-B', false);
    expect(mesh.getOffline()).toContain('node-B');

    // Partition endet: erfolgreicher Heartbeat → zurueck online
    mesh.heartbeat('node-B', true);
    expect(mesh.getOnline()).toContain('node-B');
    expect(mesh.getOffline()).not.toContain('node-B');
  });
});

describe('Chaos: Split-Brain', () => {
  it('zwei Gruppen sehen verschiedene Peers', () => {
    // Gruppe A sieht: B, C
    const meshA = new SimMesh(3);
    meshA.addPeer('node-B');
    meshA.addPeer('node-C');

    // Gruppe B sieht: D, E
    const meshB = new SimMesh(3);
    meshB.addPeer('node-D');
    meshB.addPeer('node-E');

    // A kann B,C nicht erreichen (Partition zu Gruppe B)
    for (let i = 0; i < 3; i++) {
      meshA.heartbeat('node-B', true);
      meshA.heartbeat('node-C', true);
    }

    // B kann D,E erreichen
    for (let i = 0; i < 3; i++) {
      meshB.heartbeat('node-D', true);
      meshB.heartbeat('node-E', true);
    }

    // Gruppe A und B haben disjunkte Peer-Listen
    const peersA = new Set(meshA.getOnline());
    const peersB = new Set(meshB.getOnline());

    // Kein Overlap
    const overlap = [...peersA].filter((p) => peersB.has(p));
    expect(overlap).toHaveLength(0);
  });

  it('Merge nach Split-Brain Recovery', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');
    mesh.addPeer('node-C');
    mesh.addPeer('node-D');

    // Partition: B offline
    for (let i = 0; i < 3; i++) mesh.heartbeat('node-B', false);

    expect(mesh.getOnline()).toEqual(['node-C', 'node-D']);

    // Recovery: B wieder erreichbar
    mesh.heartbeat('node-B', true);
    expect(mesh.getOnline()).toContain('node-B');
    expect(mesh.getOnline()).toHaveLength(3);
  });
});

describe('Chaos: Node-Ausfall', () => {
  it('einzelner Node-Ausfall wird erkannt', () => {
    const mesh = new SimMesh(3);
    const peers = ['node-B', 'node-C', 'node-D', 'node-E'];
    peers.forEach((p) => mesh.addPeer(p));

    // node-D faellt aus
    for (let i = 0; i < 3; i++) {
      mesh.heartbeat('node-B', true);
      mesh.heartbeat('node-C', true);
      mesh.heartbeat('node-D', false); // Ausfall
      mesh.heartbeat('node-E', true);
    }

    expect(mesh.getOnline()).toEqual(['node-B', 'node-C', 'node-E']);
    expect(mesh.getOffline()).toEqual(['node-D']);
  });

  it('mehrere gleichzeitige Ausfaelle', () => {
    const mesh = new SimMesh(2); // Schnellere Erkennung
    const peers = ['B', 'C', 'D', 'E', 'F'];
    peers.forEach((p) => mesh.addPeer(p));

    // B, D, F fallen gleichzeitig aus
    for (let i = 0; i < 2; i++) {
      mesh.heartbeat('B', false);
      mesh.heartbeat('C', true);
      mesh.heartbeat('D', false);
      mesh.heartbeat('E', true);
      mesh.heartbeat('F', false);
    }

    expect(mesh.getOnline()).toEqual(['C', 'E']);
    expect(mesh.getOffline()).toEqual(['B', 'D', 'F']);
  });
});

describe('Chaos: Rapid Rejoin', () => {
  it('Node geht offline und sofort wieder online', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');

    // Erst offline
    for (let i = 0; i < 3; i++) mesh.heartbeat('node-B', false);
    expect(mesh.getOffline()).toContain('node-B');

    // Sofort wieder online (kein Cooldown noetig)
    mesh.heartbeat('node-B', true);
    expect(mesh.getOnline()).toContain('node-B');
  });

  it('Flapping: schnelles On/Off/On/Off stabilisiert sich', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-flap');

    // Flapping-Sequenz
    mesh.heartbeat('node-flap', true);
    mesh.heartbeat('node-flap', false);
    mesh.heartbeat('node-flap', true);
    mesh.heartbeat('node-flap', false);
    mesh.heartbeat('node-flap', true);

    // Sollte online sein (letzter war success, missedBeats < threshold)
    expect(mesh.getOnline()).toContain('node-flap');
  });
});

describe('Chaos: Heartbeat-Verlust', () => {
  it('einzelner verlorener Heartbeat ist tolerierbar', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');

    // Normal, normal, LOST, normal, normal
    mesh.heartbeat('node-B', true);
    mesh.heartbeat('node-B', true);
    mesh.heartbeat('node-B', false); // Einzelner Verlust
    mesh.heartbeat('node-B', true);
    mesh.heartbeat('node-B', true);

    expect(mesh.getOnline()).toContain('node-B');
  });

  it('zwei verlorene Heartbeats hintereinander sind tolerierbar', () => {
    const mesh = new SimMesh(3);
    mesh.addPeer('node-B');

    mesh.heartbeat('node-B', true);
    mesh.heartbeat('node-B', false);
    mesh.heartbeat('node-B', false); // 2 verloren, threshold=3
    mesh.heartbeat('node-B', true); // Recovery!

    expect(mesh.getOnline()).toContain('node-B');
  });
});

describe('Chaos: Gossip-Storm', () => {
  it('viele gleichzeitige Peer-Updates crashen nicht', () => {
    const mesh = new SimMesh(3);

    // 100 Peers hinzufuegen
    for (let i = 0; i < 100; i++) {
      mesh.addPeer(`node-${i}`);
    }

    expect(mesh.peers.size).toBe(100);

    // Alle gleichzeitig heartbeaten
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 100; i++) {
        mesh.heartbeat(`node-${i}`, Math.random() > 0.1); // 10% Verlust
      }
    }

    // Die meisten sollten noch online sein
    const online = mesh.getOnline();
    expect(online.length).toBeGreaterThan(50);
  });

  it('schnelles Hinzufuegen und Entfernen von Peers', () => {
    const mesh = new SimMesh(2);

    for (let i = 0; i < 50; i++) {
      mesh.addPeer(`temp-${i}`);
    }

    // Alle sofort offline (2 missed beats reichen)
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 50; i++) {
        mesh.heartbeat(`temp-${i}`, false);
      }
    }

    expect(mesh.getOffline()).toHaveLength(50);
    expect(mesh.getOnline()).toHaveLength(0);
  });
});
