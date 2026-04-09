/**
 * ADR-004 Phase 2 — Agent Registry
 *
 * In-memory tracking of locally active agent instances (Claude Code,
 * Codex, Gemini CLI, …) that have registered themselves against this
 * daemon via `POST /api/agent/register`. Each instance sends periodic
 * heartbeats (`POST /api/agent/heartbeat`) to keep its entry alive;
 * after `3 × heartbeatIntervalMs` without a heartbeat the entry is
 * evicted as stale.
 *
 * Scope for this phase:
 *   - Register / heartbeat / unregister
 *   - Stale eviction loop
 *   - Read-only listing helpers for the REST layer
 *
 * Out of scope (handled by ADR-005):
 *   - Per-agent inbox filtering (`to_agent_instance`)
 *   - Collision rejection on registration (the REST layer does this)
 *
 * The module is deliberately persistence-free: a daemon restart wipes
 * all entries, and every agent re-registers on its next heartbeat
 * attempt. This matches ADR-004's "Cron is per-session" non-goal.
 *
 * See: docs/architecture/ADR-004-cron-heartbeat.md §"Phase 2"
 */
import type { Logger } from 'pino';

export interface AgentRegistryEntry {
  /** Client-generated UUIDv4 that identifies this CLI invocation. */
  readonly instanceId: string;
  /** Agent family: `claude-code`, `codex`, `gemini-cli`, … */
  readonly agentType: string;
  /** 4-component SPIFFE URI (forward-compat with ADR-005). */
  readonly spiffeUri: string;
  /** Optional process id the agent reports, purely for debugging. */
  readonly pid?: number;
  /** Optional CLI version string, purely for debugging. */
  readonly cliVersion?: string;
  /** Epoch ms of the initial registration. */
  readonly registeredAt: number;
  /** Epoch ms of the most recent heartbeat (initially = registeredAt). */
  lastHeartbeatAt: number;
}

export interface AgentRegistryOptions {
  /** Nominal heartbeat interval the registry promises to each agent. */
  heartbeatIntervalMs: number;
  /** Multiplier applied to heartbeatIntervalMs to decide staleness. */
  staleFactor?: number;
  /**
   * Hard upper bound on concurrently-tracked agent instances. Prevents
   * a misbehaving or malicious local client from flooding the in-memory
   * Map with fresh registrations and OOM-ing the daemon. Default: 1000.
   * (Gemini-Pro CR finding 2026-04-09, MEDIUM)
   */
  maxEntries?: number;
  /** Optional logger; if omitted the registry runs silently. */
  log?: Logger;
  /** Monotonic clock; overridable for tests. */
  now?: () => number;
  /** setInterval shim; overridable for tests. */
  setIntervalFn?: typeof setInterval;
  /** clearInterval shim; overridable for tests. */
  clearIntervalFn?: typeof clearInterval;
}

/** Thrown by `register()` when `maxEntries` is reached. */
export class AgentRegistryFullError extends Error {
  readonly maxEntries: number;
  constructor(maxEntries: number) {
    super(`agent registry is full (max ${maxEntries} entries)`);
    this.name = 'AgentRegistryFullError';
    this.maxEntries = maxEntries;
  }
}

export interface RegisterInput {
  instanceId: string;
  agentType: string;
  spiffeUri: string;
  pid?: number;
  cliVersion?: string;
}

export class AgentRegistry {
  private readonly entries = new Map<string, AgentRegistryEntry>();
  private readonly heartbeatIntervalMs: number;
  private readonly staleFactor: number;
  private readonly maxEntries: number;
  private readonly log?: Logger;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(reason: 'register' | 'unregister' | 'stale', entry: AgentRegistryEntry) => void> = [];

  constructor(opts: AgentRegistryOptions) {
    if (!Number.isFinite(opts.heartbeatIntervalMs) || opts.heartbeatIntervalMs <= 0) {
      throw new RangeError(`AgentRegistry: heartbeatIntervalMs must be > 0, got ${opts.heartbeatIntervalMs}`);
    }
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs;
    this.staleFactor = opts.staleFactor ?? 3;
    if (this.staleFactor < 1) {
      throw new RangeError(`AgentRegistry: staleFactor must be >= 1, got ${this.staleFactor}`);
    }
    this.maxEntries = opts.maxEntries ?? 1000;
    if (!Number.isFinite(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError(`AgentRegistry: maxEntries must be >= 1, got ${this.maxEntries}`);
    }
    this.log = opts.log;
    this.now = opts.now ?? (() => Date.now());
    this.setIntervalFn = opts.setIntervalFn ?? setInterval;
    this.clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  }

  /** Start the background stale-eviction loop. Idempotent. */
  start(): void {
    if (this.staleTimer) return;
    // Run the sweep once per heartbeat interval so we notice a dead
    // instance within ~1 interval of the 3-miss threshold. The timer
    // is unref'd so it never keeps the event loop alive on its own.
    const timer = this.setIntervalFn(() => this.sweep(), this.heartbeatIntervalMs);
    if (typeof (timer as { unref?: () => unknown }).unref === 'function') {
      (timer as { unref: () => unknown }).unref();
    }
    this.staleTimer = timer;
  }

  /** Stop the background loop. Idempotent. */
  stop(): void {
    if (this.staleTimer) {
      this.clearIntervalFn(this.staleTimer);
      this.staleTimer = null;
    }
  }

  /**
   * Register or re-register an agent instance. Returns the canonical entry.
   * Throws `AgentRegistryFullError` when the hard cap `maxEntries` is hit
   * (the REST layer turns this into HTTP 503).
   */
  register(input: RegisterInput): AgentRegistryEntry {
    const now = this.now();
    const existing = this.entries.get(input.instanceId);
    if (existing) {
      // Re-registration: refresh heartbeat timestamp, leave everything else.
      existing.lastHeartbeatAt = now;
      return existing;
    }
    if (this.entries.size >= this.maxEntries) {
      this.log?.warn(
        { maxEntries: this.maxEntries, attempted: input.instanceId },
        '[agent-registry] full, rejecting new registration',
      );
      throw new AgentRegistryFullError(this.maxEntries);
    }
    const entry: AgentRegistryEntry = {
      instanceId: input.instanceId,
      agentType: input.agentType,
      spiffeUri: input.spiffeUri,
      pid: input.pid,
      cliVersion: input.cliVersion,
      registeredAt: now,
      lastHeartbeatAt: now,
    };
    this.entries.set(input.instanceId, entry);
    this.log?.info(
      { instanceId: entry.instanceId, agentType: entry.agentType, pid: entry.pid },
      '[agent-registry] registered',
    );
    this.emit('register', entry);
    return entry;
  }

  /**
   * Refresh an entry's heartbeat timestamp. Returns the updated entry
   * on success and `undefined` if the instance is unknown — the REST
   * layer should respond with 404 in that case so the client
   * re-registers.
   *
   * Returning the entry object (rather than a boolean) lets the API
   * handler write the audit event atomically in the same tick, which
   * closes a small window where a sweep between `heartbeat()` and a
   * follow-up `get()` could drop the audit record. (Gemini-Pro CR
   * finding 2026-04-09, LOW)
   */
  heartbeat(instanceId: string): AgentRegistryEntry | undefined {
    const entry = this.entries.get(instanceId);
    if (!entry) return undefined;
    entry.lastHeartbeatAt = this.now();
    return entry;
  }

  /**
   * Unregister an instance. Returns the removed entry on success and
   * `undefined` if the instance was already gone. The REST layer
   * responds with 200 either way (idempotent semantics).
   *
   * Returning the entry lets the handler write the AGENT_UNREGISTER
   * audit event atomically in the same tick — mirrors the `heartbeat`
   * fix from the Gemini-Pro CR. (Gemini-Pro PC finding 2026-04-09, MEDIUM)
   */
  unregister(instanceId: string): AgentRegistryEntry | undefined {
    const entry = this.entries.get(instanceId);
    if (!entry) return undefined;
    this.entries.delete(instanceId);
    this.log?.info(
      { instanceId: entry.instanceId, agentType: entry.agentType },
      '[agent-registry] unregistered',
    );
    this.emit('unregister', entry);
    return entry;
  }

  /** Look up a single entry. */
  get(instanceId: string): AgentRegistryEntry | undefined {
    return this.entries.get(instanceId);
  }

  /** Snapshot of all currently-live entries. */
  list(): AgentRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Current live count. */
  size(): number {
    return this.entries.size;
  }

  /** Registered heartbeat interval (echoed to clients in register response). */
  getHeartbeatIntervalMs(): number {
    return this.heartbeatIntervalMs;
  }

  /**
   * Subscribe to registry events. Returns an unsubscribe function.
   * Listeners run synchronously and should not throw.
   */
  on(
    listener: (reason: 'register' | 'unregister' | 'stale', entry: AgentRegistryEntry) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Trigger a stale sweep immediately. Exposed for tests and for the
   * REST layer's health endpoint. Production code should rely on the
   * background timer installed by `start()`.
   */
  sweep(): AgentRegistryEntry[] {
    const threshold = this.heartbeatIntervalMs * this.staleFactor;
    const now = this.now();
    const evicted: AgentRegistryEntry[] = [];
    for (const [id, entry] of this.entries) {
      if (now - entry.lastHeartbeatAt > threshold) {
        this.entries.delete(id);
        evicted.push(entry);
        this.log?.info(
          { instanceId: id, agentType: entry.agentType, ageMs: now - entry.lastHeartbeatAt },
          '[agent-registry] evicted stale entry',
        );
        this.emit('stale', entry);
      }
    }
    return evicted;
  }

  private emit(
    reason: 'register' | 'unregister' | 'stale',
    entry: AgentRegistryEntry,
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(reason, entry);
      } catch (err) {
        this.log?.warn({ err }, '[agent-registry] listener threw');
      }
    }
  }
}
