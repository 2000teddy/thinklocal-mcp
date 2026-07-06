// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * registry-sync-libp2p-adapter.ts — Bindeglied zwischen
 * RegistrySyncCoordinator (transport-agnostisch) und libp2p-Runtime
 * (ActiveLibp2pRuntime).
 *
 * Liefert:
 * - SyncTransport-Implementierung, die libp2p dialProtocol/hangUp nutzt
 * - Protocol-Handler fuer `/thinklocal/mesh/registry/1.0.0`, der eingehende
 *   Frames an coordinator.onMessageFromPeer weiterreicht
 * - Peer-Events-Hooks (peer:connect/disconnect) auf den Coordinator
 *
 * Wiring im Daemon (index.ts):
 * ```
 * const sync = wireRegistrySync({ registry, log });
 * const runtime = await createLibp2pRuntime(config, log, {
 *   protocolHandlers: sync.protocolHandlers,
 *   peerEvents: sync.peerEvents,
 * });
 * sync.setRuntime(runtime);
 * await runtime.start();
 * sync.coordinator.start();
 * ```
 *
 * Referenz: ADR-020 v1.1 + v1.3.
 */

import type { Logger } from 'pino';
import type { CapabilityRegistry } from './registry.js';
import {
  RegistrySyncCoordinator,
  type SyncTransport,
} from './registry-sync-coordinator.js';
import {
  encodeFrame,
  readFrame,
  REGISTRY_SYNC_MAX_FRAME_BYTES,
} from './registry-sync-protocol.js';
import type {
  Libp2pRuntime,
  Libp2pProtocolHandler,
  Libp2pPeerEvents,
} from './libp2p-runtime.js';
import { LIBP2P_PROTOCOLS } from './libp2p-runtime.js';

export interface WireRegistrySyncOptions {
  registry: CapabilityRegistry;
  log?: Logger;
  /** Wird an den Coordinator weitergereicht. */
  intervalMs?: number;
  jitterPercent?: number;
  roundTimeoutMs?: number;
}

export interface WireRegistrySyncResult {
  coordinator: RegistrySyncCoordinator;
  protocolHandlers: Record<string, Libp2pProtocolHandler>;
  peerEvents: Libp2pPeerEvents;
  /** Wird nach createLibp2pRuntime aufgerufen, sobald die Runtime steht. */
  setRuntime(runtime: Libp2pRuntime): void;
}

export function wireRegistrySync(opts: WireRegistrySyncOptions): WireRegistrySyncResult {
  let runtimeRef: Libp2pRuntime | null = null;
  const log = opts.log;

  const transport: SyncTransport = {
    async send(peerId: string, message: Uint8Array, signal: AbortSignal): Promise<void> {
      const rt = runtimeRef;
      if (!rt || !rt.dialProtocol) {
        throw new Error('libp2p runtime not ready');
      }
      const stream = await rt.dialProtocol(peerId, LIBP2P_PROTOCOLS.REGISTRY);
      const onAbort = () => {
        try {
          stream.abort?.(new Error('aborted'));
        } catch {
          // ignore
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        if (signal.aborted) throw new Error('aborted');
        // 1-frame-per-stream: encode + sink + close
        const frame = encodeFrame(message);
        await stream.sink(
          (async function* () {
            yield frame;
          })(),
        );
        // Server-Antwort wird nicht im selben Stream erwartet — die
        // Gegenseite oeffnet bei Bedarf einen neuen Stream und sendet
        // ueber den eigenen send-Pfad. Stream zumachen.
        await stream.close?.();
      } catch (err) {
        try {
          stream.abort?.(err as Error);
        } catch {
          // ignore
        }
        throw err;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },

    async hangUp(peerId: string): Promise<void> {
      const rt = runtimeRef;
      if (!rt?.hangUpPeer) return;
      try {
        await rt.hangUpPeer(peerId);
      } catch (err) {
        log?.debug({ peerId, err: (err as Error)?.message }, 'hangUpPeer failed');
      }
    },
  };

  const coordinator = new RegistrySyncCoordinator({
    registry: opts.registry,
    transport,
    intervalMs: opts.intervalMs,
    jitterPercent: opts.jitterPercent,
    roundTimeoutMs: opts.roundTimeoutMs,
    log,
  });

  const registryHandler: Libp2pProtocolHandler = async (stream, peerId) => {
    // Read genau ein Frame (1-Frame-per-Stream-Konvention)
    const ac = new AbortController();
    const readTimer = setTimeout(() => ac.abort(new Error('read timeout')), 10_000);
    try {
      const frame = await readFrame(stream.source, ac.signal);
      if (!frame) return;
      if (frame.byteLength > REGISTRY_SYNC_MAX_FRAME_BYTES) {
        log?.warn({ peerId, size: frame.byteLength }, 'oversized registry frame, dropping');
        return;
      }
      await coordinator.onMessageFromPeer(peerId, frame);
    } catch (err) {
      log?.debug({ peerId, err: (err as Error)?.message }, 'registry inbound stream failed');
    } finally {
      clearTimeout(readTimer);
    }
  };

  const protocolHandlers: Record<string, Libp2pProtocolHandler> = {
    [LIBP2P_PROTOCOLS.REGISTRY]: registryHandler,
  };

  const peerEvents: Libp2pPeerEvents = {
    onPeerConnect: (peerId) => coordinator.onPeerConnect(peerId),
    onPeerDisconnect: (peerId) => coordinator.onPeerDisconnect(peerId),
  };

  return {
    coordinator,
    protocolHandlers,
    peerEvents,
    setRuntime: (rt: Libp2pRuntime) => {
      runtimeRef = rt;
    },
  };
}
