/**
 * ADR-006 Phase 1 — Session Watcher (poll-based ingest)
 *
 * Tails native session files, parses new bytes via an adapter,
 * appends the resulting events to the `SessionEventsStore`, and
 * triggers a HISTORY.md regeneration via the `RecoveryGenerator`
 * sink. Returns the number of new events ingested so callers can
 * decide whether to rewrite derived views.
 *
 * Phase 1 uses **polling** (a timer or manual `tick()`), not
 * `fs.watch`. Rationale:
 *
 *   - Polling is trivially testable and deterministic.
 *   - `fs.watch` semantics diverge wildly across macOS, Linux and
 *     remote filesystems; introducing that complexity in Phase 1
 *     would slow us down.
 *   - A jsonl file that grows by a few hundred bytes per turn is
 *     cheap to stat, even at 1 Hz.
 *
 * Phase 1.1 can bolt `chokidar` on top for lower latency without
 * changing the public surface — the `tick()` function stays the
 * same entry point.
 *
 * See: docs/architecture/ADR-006-session-persistence.md §Architektur/1
 */
import { stat, open } from 'node:fs/promises';
import type { SessionEventInput } from './session-events.js';
import { SessionEventsStore } from './session-events.js';
import type { SessionState } from './session-state.js';
import { writeSessionState, readSessionState } from './session-state.js';

export interface SessionWatcherOptions {
  store: SessionEventsStore;
  /**
   * Parser for a raw buffer slice. Given a string and a starting
   * sequence number, returns the events that should be appended.
   * Pure function; no state carried between calls.
   */
  parseBuffer: (buffer: string, baseSeq: number) => SessionEventInput[];
  /**
   * Called with the full list of current events for an instance
   * whenever new events were ingested, so the caller can rewrite
   * HISTORY.md / START-PROMPT.md. May be async.
   */
  onEventsIngested?: (state: SessionState) => void | Promise<void>;
  /** Data dir root (for `writeSessionState`). */
  dataDir?: string;
}

export interface IngestResult {
  /** Number of events actually written to the store. */
  newEvents: number;
  /** New tail offset after this tick. */
  tailOffset: number;
  /** Canonical new state after this tick (preferred over mutating the input). */
  newState: SessionState;
}

export class SessionWatcher {
  private readonly store: SessionEventsStore;
  private readonly parseBuffer: SessionWatcherOptions['parseBuffer'];
  private readonly onEventsIngested?: SessionWatcherOptions['onEventsIngested'];
  private readonly dataDir?: string;
  /**
   * Per-instance lock against concurrent `tick()` calls. Without
   * this, two overlapping ticks for the same instance can both
   * read `state.json` with the same `tailOffset`, each advance it
   * independently, and the second atomic write wipes the first
   * — classic read-modify-write race leading to silent event
   * loss. (Gemini-Pro CR finding 2026-04-09, HIGH)
   *
   * We use a `Promise`-valued Map: a new tick awaits the current
   * one (which may still be mid-fsync) and then runs. Callers
   * don't need to hold an external lock.
   */
  private readonly inflight = new Map<string, Promise<IngestResult>>();

  constructor(opts: SessionWatcherOptions) {
    this.store = opts.store;
    this.parseBuffer = opts.parseBuffer;
    this.onEventsIngested = opts.onEventsIngested;
    this.dataDir = opts.dataDir;
  }

  /**
   * Read everything that has been appended to `sessionFilePath`
   * since `state.tailOffset`, parse it, append to the event
   * store, and persist the updated tail offset + heartbeat back
   * to `state.json`.
   *
   * Returns the number of events actually ingested and the next
   * canonical `SessionState`. Concurrent calls for the same
   * `instanceUuid` are serialised — the second caller awaits the
   * first and picks up on the freshly-persisted offset.
   *
   * **Immutable contract:** the input `state` object is NEVER
   * mutated. Callers must use `result.newState` to advance their
   * local reference.
   */
  async tick(sessionFilePath: string, state: SessionState): Promise<IngestResult> {
    const key = state.instanceUuid;
    const prior = this.inflight.get(key);
    if (prior) {
      // Chain onto the existing in-flight tick, then run ours.
      // `prior` may update the caller's `state` object directly,
      // so when we finally run we see the up-to-date offset.
      await prior.catch(() => undefined);
    }
    const run = this.tickInternal(sessionFilePath, state);
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      // Only clear the slot if it still points at our run —
      // another caller may already have chained on.
      if (this.inflight.get(key) === run) {
        this.inflight.delete(key);
      }
    }
  }

  private async tickInternal(
    sessionFilePath: string,
    inputState: SessionState,
  ): Promise<IngestResult> {
    // Under the lock, authoritative state = what's on disk. A
    // previous tick may have advanced the tailOffset while the
    // caller was still holding a stale in-memory copy; re-reading
    // here keeps us idempotent across concurrent callers that
    // share the same instance but not the same reference.
    const persisted = await readSessionState(this.dataDir, inputState.instanceUuid).catch(
      () => null,
    );
    const state = persisted ?? inputState;
    let size: number;
    try {
      const st = await stat(sessionFilePath);
      size = st.size;
    } catch {
      // File gone or unreadable — nothing to ingest this tick.
      return { newEvents: 0, tailOffset: state.tailOffset, newState: state };
    }

    if (size <= state.tailOffset) {
      return { newEvents: 0, tailOffset: state.tailOffset, newState: state };
    }

    const fh = await open(sessionFilePath, 'r');
    let buffer: string;
    try {
      const length = size - state.tailOffset;
      const bytes = Buffer.alloc(length);
      await fh.read(bytes, 0, length, state.tailOffset);
      buffer = bytes.toString('utf8');
    } finally {
      await fh.close();
    }

    // Only advance the offset up to the last complete line, so a
    // half-written JSON record at the tip gets re-read on the next
    // tick. Native CLIs write line-at-a-time but OS scheduling can
    // still expose a partial line.
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline < 0) {
      // No complete line yet — wait for more bytes.
      return { newEvents: 0, tailOffset: state.tailOffset, newState: state };
    }
    const complete = buffer.slice(0, lastNewline + 1);
    const consumed = Buffer.byteLength(complete, 'utf8');

    const baseSeq = this.store.latestSeq(state.instanceUuid) + 1;
    const parsed = this.parseBuffer(complete, baseSeq);
    let ingested = 0;
    for (const ev of parsed) {
      if (this.store.append({ ...ev, instanceUuid: state.instanceUuid })) {
        ingested += 1;
      }
    }

    const nextState: SessionState = {
      ...state,
      tailOffset: state.tailOffset + consumed,
      lastHeartbeat: new Date().toISOString(),
      historyVersion: ingested > 0 ? state.historyVersion + 1 : state.historyVersion,
    };
    await writeSessionState(this.dataDir, nextState);

    if (ingested > 0 && this.onEventsIngested) {
      await this.onEventsIngested(nextState);
    }

    // Immutable flow: we return `newState` and never mutate the
    // caller's object. The old mutation path was removed as an
    // anti-pattern per Gemini-Pro PC finding 2026-04-09 (MEDIUM).
    // Callers MUST use `result.newState` to advance their local
    // copy, e.g.:
    //     let state = initial;
    //     const result = await watcher.tick(path, state);
    //     state = result.newState;
    return {
      newEvents: ingested,
      tailOffset: nextState.tailOffset,
      newState: nextState,
    };
  }
}
