import type { Logger } from 'pino';
import type { RuntimeMode } from './runtime-mode.js';

export interface Libp2pRuntimeConfig {
  enabled: boolean;
  bindHost: string;
  listenPort: number;
  mdnsServiceTag: string;
  natTraversalEnabled: boolean;
  relayTransportEnabled: boolean;
  relayServiceEnabled: boolean;
  announceMultiaddrs: string[];
}

export type Libp2pRuntimeStatus = 'disabled' | 'ready' | 'degraded';

export interface Libp2pMultiplexerState {
  enabled: boolean;
  name: string | null;
  protocols: string[];
  openStreams: number;
  streamsByProtocol: Record<string, number>;
}

export interface NatTraversalState {
  enabled: boolean;
  reachability: 'unknown' | 'private' | 'public' | 'relay';
  strategy: 'disabled' | 'direct' | 'relay' | 'hybrid';
  autoNAT: boolean;
  relayTransport: boolean;
  relayService: boolean;
  holePunching: boolean;
  observedMultiaddrs: string[];
  announceMultiaddrs: string[];
  relayReservations: number;
  reason: string | null;
}

export interface Libp2pRuntimeState {
  enabled: boolean;
  available: boolean;
  status: Libp2pRuntimeStatus;
  peerId: string | null;
  listenMultiaddrs: string[];
  connectedPeers: number;
  noise: boolean;
  mdns: boolean;
  multiplexer: Libp2pMultiplexerState;
  nat: NatTraversalState;
  reason: string | null;
}

/**
 * Stream-Handler fuer eingehende libp2p-Streams. Erhalten den rohen Stream
 * sowie die Remote-Peer-ID. Implementierungen sind verantwortlich fuer das
 * Lesen aus stream.source, Schreiben in stream.sink und das saubere
 * Schliessen (z.B. via stream.close()). Nicht resolvende Promises blockieren
 * den Stream — Timeout/Abort liegt beim Handler.
 */
export type Libp2pProtocolHandler = (
  stream: Libp2pStreamLike,
  peerId: string,
) => Promise<void>;

/**
 * Minimaler libp2p-Stream-Contract. Vermeidet harte Typabhaengigkeit auf
 * @libp2p/interface, was Tests vereinfacht und Versionsupgrades entkoppelt.
 */
export interface Libp2pStreamLike {
  source: AsyncIterable<Uint8Array>;
  sink: (source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) => Promise<void>;
  close?: () => Promise<void> | void;
  abort?: (err: Error) => void;
}

export interface Libp2pPeerEvents {
  onPeerConnect?: (peerId: string) => void;
  onPeerDisconnect?: (peerId: string) => void;
}

export interface Libp2pRuntimeHooks {
  /** Map: protocol-id → Handler. Wenn ein Protokoll nicht gemapt ist, gilt der Placeholder-Default. */
  protocolHandlers?: Record<string, Libp2pProtocolHandler>;
  peerEvents?: Libp2pPeerEvents;
}

export interface Libp2pRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Libp2pRuntimeState;
  /**
   * Oeffnet einen neuen Stream zu peerId mit dem angegebenen Protokoll.
   * Wird vom RegistrySyncCoordinator als Transport genutzt. Wirft, wenn
   * peer nicht erreichbar oder Protokoll nicht unterstuetzt.
   */
  dialProtocol?(peerId: string, protocol: string): Promise<Libp2pStreamLike>;
  /** Trennt die libp2p-Connection zu peerId. */
  hangUpPeer?(peerId: string): Promise<void>;
  /** Liste der aktuell verbundenen Peer-IDs (als string). */
  getConnectedPeerIds?(): string[];
}

type DynamicImport = (specifier: string) => Promise<unknown>;

function createDynamicImport(): DynamicImport {
  const fn = new Function('specifier', 'return import(specifier);');
  return fn as DynamicImport;
}

export function getLibp2pListenMultiaddrs(bindHost: string, listenPort: number): string[] {
  const host = bindHost.trim();
  if (host === '::' || host === '::0' || host === '::1') {
    return [`/ip6/${host}/tcp/${listenPort}`];
  }
  return [`/ip4/${host || '0.0.0.0'}/tcp/${listenPort}`];
}

export const LIBP2P_PROTOCOLS = {
  HEARTBEAT: '/thinklocal/mesh/heartbeat/1.0.0',
  REGISTRY: '/thinklocal/mesh/registry/1.0.0',
  TASKS: '/thinklocal/mesh/tasks/1.0.0',
  AUDIT: '/thinklocal/mesh/audit/1.0.0',
} as const;

export function getLibp2pProtocolList(): string[] {
  return Object.values(LIBP2P_PROTOCOLS);
}

function defaultNatState(config: Libp2pRuntimeConfig): NatTraversalState {
  return {
    enabled: config.enabled && config.natTraversalEnabled,
    reachability: 'unknown',
    strategy: !config.enabled || !config.natTraversalEnabled
      ? 'disabled'
      : config.relayTransportEnabled
        ? 'hybrid'
        : 'direct',
    autoNAT: config.enabled && config.natTraversalEnabled,
    relayTransport: config.enabled && config.relayTransportEnabled,
    relayService: config.enabled && config.relayServiceEnabled,
    holePunching: false,
    observedMultiaddrs: [],
    announceMultiaddrs: [...config.announceMultiaddrs],
    relayReservations: 0,
    reason: config.enabled && config.natTraversalEnabled
      ? 'AutoNAT and relay-assisted traversal pending runtime startup'
      : 'NAT traversal disabled by configuration',
  };
}

function hasPublicIPv4(input: string): boolean {
  const match = input.match(/\/ip4\/(\d+\.\d+\.\d+\.\d+)/);
  if (!match) return false;
  const ip = match[1];
  if (ip.startsWith('10.')) return false;
  if (ip.startsWith('127.')) return false;
  if (ip.startsWith('192.168.')) return false;
  if (ip.startsWith('169.254.')) return false;
  const secondOctet = Number(ip.split('.')[1] ?? '0');
  if (ip.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return false;
  return true;
}

export function resolveNatReachability(args: {
  enabled: boolean;
  announceMultiaddrs: string[];
  observedMultiaddrs: string[];
  relayTransport: boolean;
}): NatTraversalState['reachability'] {
  if (!args.enabled) return 'unknown';
  if ([...args.announceMultiaddrs, ...args.observedMultiaddrs].some((addr) => addr.includes('/p2p-circuit'))) {
    return 'relay';
  }
  if ([...args.announceMultiaddrs, ...args.observedMultiaddrs].some(hasPublicIPv4)) {
    return 'public';
  }
  if (args.observedMultiaddrs.length > 0 || args.announceMultiaddrs.length > 0 || args.relayTransport) {
    return 'private';
  }
  return 'unknown';
}

export function createInitialLibp2pState(config: Libp2pRuntimeConfig): Libp2pRuntimeState {
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      status: 'disabled',
      peerId: null,
      listenMultiaddrs: [],
      connectedPeers: 0,
      noise: false,
      mdns: false,
      multiplexer: {
        enabled: false,
        name: null,
        protocols: [],
        openStreams: 0,
        streamsByProtocol: {},
      },
      nat: defaultNatState(config),
      reason: 'libp2p disabled by configuration',
    };
  }

  return {
    enabled: true,
    available: false,
    status: 'degraded',
    peerId: null,
    listenMultiaddrs: getLibp2pListenMultiaddrs(config.bindHost, config.listenPort),
    connectedPeers: 0,
    noise: true,
    mdns: true,
    multiplexer: {
      enabled: true,
      name: 'yamux',
      protocols: getLibp2pProtocolList(),
      openStreams: 0,
      streamsByProtocol: Object.fromEntries(getLibp2pProtocolList().map((protocol) => [protocol, 0])),
    },
    nat: defaultNatState(config),
    reason: 'libp2p not started yet',
  };
}

export function resolveLibp2pEnabled(args: {
  runtimeMode: RuntimeMode;
  explicitEnvOverride?: string | null;
}): boolean {
  if (args.explicitEnvOverride != null) {
    return args.explicitEnvOverride === '1';
  }
  return args.runtimeMode === 'lan';
}

export function resolveLibp2pListenPort(args: {
  daemonPort: number;
  configuredPort: number;
  explicitPortConfigured: boolean;
}): number {
  if (args.explicitPortConfigured) return args.configuredPort;
  return args.daemonPort + 100;
}

class NoopLibp2pRuntime implements Libp2pRuntime {
  constructor(
    private readonly state: Libp2pRuntimeState,
    private readonly log?: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.state.status === 'degraded' && this.state.reason) {
      this.log?.warn({ reason: this.state.reason }, 'libp2p Runtime nicht verfuegbar');
    }
  }

  async stop(): Promise<void> {}

  getState(): Libp2pRuntimeState {
    return {
      ...this.state,
      listenMultiaddrs: [...this.state.listenMultiaddrs],
      multiplexer: {
        ...this.state.multiplexer,
        protocols: [...this.state.multiplexer.protocols],
        streamsByProtocol: { ...this.state.multiplexer.streamsByProtocol },
      },
      nat: {
        ...this.state.nat,
        observedMultiaddrs: [...this.state.nat.observedMultiaddrs],
        announceMultiaddrs: [...this.state.nat.announceMultiaddrs],
      },
    };
  }
}

class ActiveLibp2pRuntime implements Libp2pRuntime {
  private node: any;
  private state: Libp2pRuntimeState;
  private readonly hooks: Libp2pRuntimeHooks;

  constructor(
    initialState: Libp2pRuntimeState,
    private readonly config: Libp2pRuntimeConfig,
    private readonly deps: {
      createLibp2p: (options: Record<string, unknown>) => Promise<any>;
      identify: () => unknown;
      mdns: (options: Record<string, unknown>) => unknown;
      noise: () => unknown;
      ping: () => unknown;
      autoNAT?: () => unknown;
      circuitRelayTransport?: () => unknown;
      circuitRelayServer?: () => unknown;
      tcp: () => unknown;
      yamux: () => unknown;
    },
    private readonly log?: Logger,
    hooks?: Libp2pRuntimeHooks,
  ) {
    this.state = initialState;
    this.hooks = hooks ?? {};
  }

  async start(): Promise<void> {
    this.node = await this.deps.createLibp2p({
      addresses: {
        listen: getLibp2pListenMultiaddrs(this.config.bindHost, this.config.listenPort),
        ...(this.config.announceMultiaddrs.length > 0 ? { announce: this.config.announceMultiaddrs } : {}),
      },
      transports: [
        this.deps.tcp(),
        ...(this.config.relayTransportEnabled && this.deps.circuitRelayTransport ? [this.deps.circuitRelayTransport()] : []),
      ],
      connectionEncryption: [this.deps.noise()],
      streamMuxers: [this.deps.yamux()],
      services: {
        identify: this.deps.identify(),
        ping: this.deps.ping(),
        mdns: this.deps.mdns({ interval: 20_000, serviceTag: this.config.mdnsServiceTag }),
        ...(this.config.natTraversalEnabled && this.deps.autoNAT ? { autoNAT: this.deps.autoNAT() } : {}),
        ...(this.config.relayServiceEnabled && this.deps.circuitRelayServer ? { circuitRelay: this.deps.circuitRelayServer() } : {}),
      },
    });

    if (typeof this.node.start === 'function') {
      await this.node.start();
    }

    this.state.peerId = String(this.node.peerId?.toString?.() ?? '');
    this.state.listenMultiaddrs = Array.isArray(this.node.getMultiaddrs?.())
      ? this.node.getMultiaddrs().map((addr: { toString(): string }) => addr.toString())
      : this.state.listenMultiaddrs;
    this.state.connectedPeers = this.readConnectedPeers();
    this.state.available = true;
    this.state.status = 'ready';
    this.state.reason = null;
    this.refreshNatState();

    this.registerProtocolHandlers();
    this.attachEventListeners();
    this.log?.info(
      {
        peerId: this.state.peerId,
        listenMultiaddrs: this.state.listenMultiaddrs,
        noise: true,
        multiplexer: this.state.multiplexer.name,
        protocols: this.state.multiplexer.protocols,
        nat: this.state.nat.reachability,
        announceMultiaddrs: this.state.nat.announceMultiaddrs,
      },
      'libp2p Runtime mit Noise, Multiplexing und NAT-Traversal-Status gestartet',
    );
  }

  async stop(): Promise<void> {
    if (this.node && typeof this.node.stop === 'function') {
      await this.node.stop();
      this.log?.info('libp2p Runtime gestoppt');
    }
  }

  getState(): Libp2pRuntimeState {
    const connectedPeers = this.readConnectedPeers();
    return {
      ...this.state,
      connectedPeers,
      listenMultiaddrs: [...this.state.listenMultiaddrs],
      multiplexer: {
        ...this.state.multiplexer,
        protocols: [...this.state.multiplexer.protocols],
        streamsByProtocol: { ...this.state.multiplexer.streamsByProtocol },
      },
      nat: {
        ...this.state.nat,
        observedMultiaddrs: [...this.state.nat.observedMultiaddrs],
        announceMultiaddrs: [...this.state.nat.announceMultiaddrs],
      },
    };
  }

  async dialProtocol(peerId: string, protocol: string): Promise<Libp2pStreamLike> {
    if (!this.node) throw new Error('libp2p node not started');
    if (typeof this.node.dialProtocol !== 'function') {
      throw new Error('libp2p node does not support dialProtocol');
    }
    const stream = await this.node.dialProtocol(peerId, protocol);
    this.onStreamOpened(protocol);
    return this.wrapStream(stream, protocol);
  }

  async hangUpPeer(peerId: string): Promise<void> {
    if (!this.node) return;
    if (typeof this.node.hangUp === 'function') {
      await this.node.hangUp(peerId);
    }
  }

  getConnectedPeerIds(): string[] {
    const connections = this.node?.getConnections?.();
    if (!Array.isArray(connections)) return [];
    const ids = new Set<string>();
    for (const conn of connections) {
      const id = conn?.remotePeer?.toString?.();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }

  /**
   * Wickelt einen libp2p-Stream in den minimalen Libp2pStreamLike-Contract
   * + Stream-Counter-Cleanup. Idempotent: close()/abort() decrementen den
   * Counter genau einmal.
   */
  private wrapStream(stream: any, protocol: string): Libp2pStreamLike {
    let closed = false;
    const decrement = () => {
      if (!closed) {
        closed = true;
        this.onStreamClosed(protocol);
      }
    };
    return {
      source: stream.source ?? stream,
      sink: async (source) => {
        await stream.sink(source);
      },
      close: async () => {
        try {
          await stream.close?.();
        } finally {
          decrement();
        }
      },
      abort: (err: Error) => {
        try {
          stream.abort?.(err);
        } finally {
          decrement();
        }
      },
    };
  }

  private registerProtocolHandlers(): void {
    for (const protocol of this.state.multiplexer.protocols) {
      const injected = this.hooks.protocolHandlers?.[protocol];

      const handler = async (evt: any) => {
        this.onStreamOpened(protocol);
        let streamClosed = false;
        const stream = evt?.stream ?? evt;
        const remotePeer =
          evt?.connection?.remotePeer?.toString?.() ??
          stream?.connection?.remotePeer?.toString?.() ??
          'unknown';

        const ensureClosed = async () => {
          if (streamClosed) return;
          streamClosed = true;
          try {
            if (typeof stream?.close === 'function') {
              await stream.close();
            } else if (typeof stream?.abort === 'function') {
              stream.abort(new Error('handler finished'));
            }
          } catch {
            // ignore — best-effort
          }
          this.onStreamClosed(protocol);
        };

        try {
          if (injected) {
            const wrapped: Libp2pStreamLike = {
              source: stream?.source ?? stream,
              sink: async (source) => {
                await stream.sink(source);
              },
              close: async () => {
                if (typeof stream?.close === 'function') await stream.close();
              },
              abort: (err: Error) => {
                if (typeof stream?.abort === 'function') stream.abort(err);
              },
            };
            await injected(wrapped, remotePeer);
          } else {
            // Placeholder-Verhalten fuer Protokolle ohne Handler:
            // Stream sofort schliessen.
            if (typeof stream?.close === 'function') {
              await stream.close();
            } else if (typeof stream?.abort === 'function') {
              stream.abort(new Error('thinklocal placeholder protocol handler'));
            }
          }
        } catch (err) {
          this.log?.warn(
            { protocol, peer: remotePeer, err: (err as Error)?.message },
            'libp2p protocol handler threw',
          );
          if (typeof stream?.abort === 'function') {
            try {
              stream.abort(err as Error);
            } catch {
              // ignore
            }
          }
        } finally {
          await ensureClosed();
        }
      };

      if (typeof this.node?.handle === 'function') {
        this.node.handle(protocol, handler);
      } else if (this.node?.services?.registrar && typeof this.node.services.registrar.handle === 'function') {
        this.node.services.registrar.handle(protocol, handler);
      }
    }
  }

  private attachEventListeners(): void {
    const stateRefresh = () => {
      this.state.connectedPeers = this.readConnectedPeers();
      this.refreshNatState();
    };
    const onConnect = (evt: any) => {
      stateRefresh();
      const peerId =
        evt?.detail?.toString?.() ??
        evt?.detail?.remotePeer?.toString?.() ??
        null;
      if (peerId && this.hooks.peerEvents?.onPeerConnect) {
        try {
          this.hooks.peerEvents.onPeerConnect(peerId);
        } catch (err) {
          this.log?.warn({ err: (err as Error)?.message }, 'peer:connect hook threw');
        }
      }
    };
    const onDisconnect = (evt: any) => {
      stateRefresh();
      const peerId =
        evt?.detail?.toString?.() ??
        evt?.detail?.remotePeer?.toString?.() ??
        null;
      if (peerId && this.hooks.peerEvents?.onPeerDisconnect) {
        try {
          this.hooks.peerEvents.onPeerDisconnect(peerId);
        } catch (err) {
          this.log?.warn({ err: (err as Error)?.message }, 'peer:disconnect hook threw');
        }
      }
    };

    if (typeof this.node?.addEventListener === 'function') {
      this.node.addEventListener('peer:connect', onConnect);
      this.node.addEventListener('peer:disconnect', onDisconnect);
      return;
    }

    if (typeof this.node?.on === 'function') {
      this.node.on('peer:connect', onConnect);
      this.node.on('peer:disconnect', onDisconnect);
    }
  }

  private onStreamOpened(protocol: string): void {
    this.state.multiplexer.openStreams += 1;
    this.state.multiplexer.streamsByProtocol[protocol] = (this.state.multiplexer.streamsByProtocol[protocol] ?? 0) + 1;
  }

  private onStreamClosed(protocol: string): void {
    this.state.multiplexer.openStreams = Math.max(0, this.state.multiplexer.openStreams - 1);
    this.state.multiplexer.streamsByProtocol[protocol] = Math.max(
      0,
      (this.state.multiplexer.streamsByProtocol[protocol] ?? 1) - 1,
    );
  }

  private readConnectedPeers(): number {
    const connections = this.node?.getConnections?.();
    return Array.isArray(connections) ? connections.length : 0;
  }

  private refreshNatState(): void {
    const observedMultiaddrs = this.readObservedMultiaddrs();
    const announceMultiaddrs = this.readAnnounceMultiaddrs();
    const relayReservations = announceMultiaddrs.filter((addr) => addr.includes('/p2p-circuit')).length;

    this.state.nat.observedMultiaddrs = observedMultiaddrs;
    this.state.nat.announceMultiaddrs = announceMultiaddrs;
    this.state.nat.relayReservations = relayReservations;
    this.state.nat.reachability = resolveNatReachability({
      enabled: this.state.nat.enabled,
      announceMultiaddrs,
      observedMultiaddrs,
      relayTransport: this.state.nat.relayTransport,
    });
    this.state.nat.reason = this.state.nat.enabled
      ? (
          this.state.nat.reachability === 'relay'
            ? 'Relay-assisted reachability detected'
            : this.state.nat.reachability === 'public'
              ? 'Publicly dialable addresses observed'
              : this.state.nat.reachability === 'private'
                ? 'Private or VPN-only reachability; relay transport may be required'
                : 'AutoNAT has not confirmed public reachability yet'
        )
      : 'NAT traversal disabled by configuration';
  }

  private readObservedMultiaddrs(): string[] {
    const addrs = this.node?.services?.autoNAT?.components?.addressManager?.getObservedAddrs?.()
      ?? this.node?.addressManager?.getObservedAddrs?.()
      ?? [];
    return Array.isArray(addrs) ? addrs.map((addr: { toString(): string }) => addr.toString()) : [];
  }

  private readAnnounceMultiaddrs(): string[] {
    const addrs = this.node?.getMultiaddrs?.() ?? [];
    return Array.isArray(addrs) ? addrs.map((addr: { toString(): string }) => addr.toString()) : [];
  }
}

export async function createLibp2pRuntime(
  config: Libp2pRuntimeConfig,
  log?: Logger,
  hooks?: Libp2pRuntimeHooks,
): Promise<Libp2pRuntime> {
  const initialState = createInitialLibp2pState(config);
  if (!config.enabled) {
    return new NoopLibp2pRuntime(initialState, log);
  }

  const dynamicImport = createDynamicImport();

  try {
    const [
      { createLibp2p },
      { tcp },
      { noise },
      { yamux },
      { mdns },
      { identify },
      { ping },
      autoNatModule,
      relayModule,
    ] = await Promise.all([
      dynamicImport('libp2p') as Promise<{ createLibp2p: (options: Record<string, unknown>) => Promise<any> }>,
      dynamicImport('@libp2p/tcp') as Promise<{ tcp: () => unknown }>,
      dynamicImport('@chainsafe/libp2p-noise') as Promise<{ noise: () => unknown }>,
      dynamicImport('@chainsafe/libp2p-yamux') as Promise<{ yamux: () => unknown }>,
      dynamicImport('@libp2p/mdns') as Promise<{ mdns: (options: Record<string, unknown>) => unknown }>,
      dynamicImport('@libp2p/identify') as Promise<{ identify: () => unknown }>,
      dynamicImport('@libp2p/ping') as Promise<{ ping: () => unknown }>,
      dynamicImport('@libp2p/autonat').catch(() => ({})) as Promise<{ autoNAT?: () => unknown }>,
      dynamicImport('@libp2p/circuit-relay-v2').catch(() => ({})) as Promise<{
        circuitRelayServer?: () => unknown;
        circuitRelayTransport?: () => unknown;
      }>,
    ]);

    return new ActiveLibp2pRuntime(initialState, config, {
      autoNAT: autoNatModule.autoNAT,
      circuitRelayServer: relayModule.circuitRelayServer,
      circuitRelayTransport: relayModule.circuitRelayTransport,
      createLibp2p,
      identify,
      mdns,
      noise,
      ping,
      tcp,
      yamux,
    }, log, hooks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const degradedState: Libp2pRuntimeState = {
      ...initialState,
      status: 'degraded',
      reason: `libp2p dependencies unavailable: ${message}`,
    };
    log?.warn({ err }, 'libp2p konnte nicht geladen werden');
    return new NoopLibp2pRuntime(degradedState, log);
  }
}
