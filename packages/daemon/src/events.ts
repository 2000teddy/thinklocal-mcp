/**
 * events.ts — Zentraler Event-Bus fuer Echtzeit-Events im Mesh
 *
 * Alle Module emittieren Events ueber den Bus. Der WebSocket-Server
 * leitet sie an verbundene Dashboard-Clients weiter.
 *
 * Event-Kategorien:
 * - peer:*       — Peer-Statusaenderungen (join, leave, heartbeat)
 * - task:*       — Task-Lifecycle (created, accepted, completed, failed)
 * - capability:* — Capability-Aenderungen (registered, removed, synced)
 * - skill:*      — Skill-Events (announced, requested, installed)
 * - audit:*      — Audit-Events (new entry)
 * - system:*     — System-Events (startup, shutdown)
 */

import { EventEmitter } from 'node:events';

export type MeshEventType =
  | 'peer:join'
  | 'peer:leave'
  | 'peer:heartbeat'
  | 'task:created'
  | 'task:accepted'
  | 'task:completed'
  | 'task:failed'
  | 'task:timeout'
  | 'capability:registered'
  | 'capability:removed'
  | 'capability:synced'
  | 'skill:announced'
  | 'skill:requested'
  | 'skill:installed'
  | 'audit:new'
  | 'system:startup'
  | 'system:shutdown';

export interface MeshEvent {
  type: MeshEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Typisierter Event-Bus fuer das Mesh.
 * Leitet Events an alle registrierten Listener weiter.
 */
export class MeshEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Hoehere Listener-Limit fuer viele WebSocket-Clients
    this.emitter.setMaxListeners(100);
  }

  /** Emittiert ein Event an alle Listener */
  emit(type: MeshEventType, data: Record<string, unknown> = {}): void {
    const event: MeshEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emitter.emit('mesh-event', event);
    this.emitter.emit(type, event);
  }

  /** Registriert einen Listener fuer ALLE Mesh-Events */
  onAny(handler: (event: MeshEvent) => void): void {
    this.emitter.on('mesh-event', handler);
  }

  /** Entfernt einen Listener */
  offAny(handler: (event: MeshEvent) => void): void {
    this.emitter.off('mesh-event', handler);
  }

  /** Registriert einen Listener fuer einen bestimmten Event-Typ */
  on(type: MeshEventType, handler: (event: MeshEvent) => void): void {
    this.emitter.on(type, handler);
  }

  /** Entfernt einen spezifischen Listener */
  off(type: MeshEventType, handler: (event: MeshEvent) => void): void {
    this.emitter.off(type, handler);
  }
}
