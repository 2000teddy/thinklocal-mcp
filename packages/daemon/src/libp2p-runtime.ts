import type { Logger } from 'pino';
import type { RuntimeMode } from './runtime-mode.js';

export interface Libp2pRuntimeConfig {
  enabled: boolean;
  bindHost: string;
  listenPort: number;
  mdnsServiceTag: string;
}

export type Libp2pRuntimeStatus = 'disabled' | 'ready' | 'degraded';

export interface Libp2pMultiplexerState {
  enabled: boolean;
  name: string | null;
  protocols: string[];
  openStreams: number;
  streamsByProtocol: Record<string, number>;
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
  reason: string | null;
}

export interface Libp2pRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Libp2pRuntimeState;
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
    return { ...this.state, listenMultiaddrs: [...this.state.listenMultiaddrs] };
  }
}

class ActiveLibp2pRuntime implements Libp2pRuntime {
  private node: any;
  private state: Libp2pRuntimeState;

  constructor(
    initialState: Libp2pRuntimeState,
    private readonly config: Libp2pRuntimeConfig,
    private readonly deps: {
      createLibp2p: (options: Record<string, unknown>) => Promise<any>;
      identify: () => unknown;
      mdns: (options: Record<string, unknown>) => unknown;
      noise: () => unknown;
      ping: () => unknown;
      tcp: () => unknown;
      yamux: () => unknown;
    },
    private readonly log?: Logger,
  ) {
    this.state = initialState;
  }

  async start(): Promise<void> {
    this.node = await this.deps.createLibp2p({
      addresses: { listen: getLibp2pListenMultiaddrs(this.config.bindHost, this.config.listenPort) },
      transports: [this.deps.tcp()],
      connectionEncryption: [this.deps.noise()],
      streamMuxers: [this.deps.yamux()],
      services: {
        identify: this.deps.identify(),
        ping: this.deps.ping(),
        mdns: this.deps.mdns({ interval: 20_000, serviceTag: this.config.mdnsServiceTag }),
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

    this.registerProtocolHandlers();
    this.attachEventListeners();
    this.log?.info(
      {
        peerId: this.state.peerId,
        listenMultiaddrs: this.state.listenMultiaddrs,
        noise: true,
        multiplexer: this.state.multiplexer.name,
        protocols: this.state.multiplexer.protocols,
      },
      'libp2p Runtime mit Noise und Multiplexing gestartet',
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
    };
  }

  private registerProtocolHandlers(): void {
    for (const protocol of this.state.multiplexer.protocols) {
      const handler = async (evt: any) => {
        this.onStreamOpened(protocol);
        try {
          const stream = evt?.stream ?? evt;
          if (typeof stream?.close === 'function') {
            await stream.close();
          } else if (typeof stream?.abort === 'function') {
            stream.abort(new Error('thinklocal placeholder protocol handler'));
          }
        } finally {
          this.onStreamClosed(protocol);
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
    const handler = () => {
      this.state.connectedPeers = this.readConnectedPeers();
    };

    if (typeof this.node?.addEventListener === 'function') {
      this.node.addEventListener('peer:connect', handler);
      this.node.addEventListener('peer:disconnect', handler);
      return;
    }

    if (typeof this.node?.on === 'function') {
      this.node.on('peer:connect', handler);
      this.node.on('peer:disconnect', handler);
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
}

export async function createLibp2pRuntime(
  config: Libp2pRuntimeConfig,
  log?: Logger,
): Promise<Libp2pRuntime> {
  const initialState = createInitialLibp2pState(config);
  if (!config.enabled) {
    return new NoopLibp2pRuntime(initialState, log);
  }

  const dynamicImport = createDynamicImport();

  try {
    const [{ createLibp2p }, { tcp }, { noise }, { yamux }, { mdns }, { identify }, { ping }] = await Promise.all([
      dynamicImport('libp2p') as Promise<{ createLibp2p: (options: Record<string, unknown>) => Promise<any> }>,
      dynamicImport('@libp2p/tcp') as Promise<{ tcp: () => unknown }>,
      dynamicImport('@chainsafe/libp2p-noise') as Promise<{ noise: () => unknown }>,
      dynamicImport('@chainsafe/libp2p-yamux') as Promise<{ yamux: () => unknown }>,
      dynamicImport('@libp2p/mdns') as Promise<{ mdns: (options: Record<string, unknown>) => unknown }>,
      dynamicImport('@libp2p/identify') as Promise<{ identify: () => unknown }>,
      dynamicImport('@libp2p/ping') as Promise<{ ping: () => unknown }>,
    ]);

    return new ActiveLibp2pRuntime(initialState, config, {
      createLibp2p,
      identify,
      mdns,
      noise,
      ping,
      tcp,
      yamux,
    }, log);
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
