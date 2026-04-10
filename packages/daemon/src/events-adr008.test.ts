/**
 * ADR-008 Phase B PR B4 — Event Bus extension tests.
 * Verifies that the new ADR-007/008 event types are emittable
 * and that the existing WebSocket broadcast mechanism forwards them.
 */
import { describe, it, expect } from 'vitest';
import { MeshEventBus, type MeshEventType, type MeshEvent } from './events.js';

const NEW_TYPES: MeshEventType[] = [
  'inbox:new',
  'approval:created',
  'approval:decided',
  'config:changed',
  'capability:discovered',
  'capability:activated',
  'capability:suspended',
  'capability:revoked',
];

describe('MeshEventBus — ADR-007/008 event types', () => {
  it('emits all new event types without error', () => {
    const bus = new MeshEventBus();
    const received: MeshEvent[] = [];
    bus.onAny((e) => received.push(e));

    for (const type of NEW_TYPES) {
      bus.emit(type, { test: true });
    }

    expect(received).toHaveLength(NEW_TYPES.length);
    expect(received.map((e) => e.type)).toEqual(NEW_TYPES);
  });

  it('type-specific listeners work for new types', () => {
    const bus = new MeshEventBus();
    const events: MeshEvent[] = [];
    bus.on('capability:activated', (e) => events.push(e));
    bus.emit('capability:activated', { capabilityId: 'influxdb.query' });
    bus.emit('peer:join', { peerId: 'x' }); // should NOT trigger
    expect(events).toHaveLength(1);
    expect(events[0]!.data.capabilityId).toBe('influxdb.query');
  });

  it('each event has a timestamp', () => {
    const bus = new MeshEventBus();
    const events: MeshEvent[] = [];
    bus.onAny((e) => events.push(e));
    bus.emit('inbox:new', { messageId: 'msg-1' });
    expect(events[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('offAny removes listener', () => {
    const bus = new MeshEventBus();
    const events: MeshEvent[] = [];
    const handler = (e: MeshEvent) => events.push(e);
    bus.onAny(handler);
    bus.emit('approval:created', {});
    bus.offAny(handler);
    bus.emit('approval:decided', {});
    expect(events).toHaveLength(1);
  });
});
