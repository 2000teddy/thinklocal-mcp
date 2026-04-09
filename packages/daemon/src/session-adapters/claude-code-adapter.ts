/**
 * ADR-006 Phase 1 — Claude Code Session Adapter
 *
 * Parses `~/.claude/projects/<slug>/<session-uuid>.jsonl` line by
 * line and turns each JSON record into a canonical `SessionEvent`
 * that the session-events store can swallow.
 *
 * The Claude Code jsonl format is not formally documented, so this
 * adapter is defensive:
 *
 *   - Unknown top-level `type` values are **skipped**, not errors.
 *   - Parse failures on an individual line are **skipped** with a
 *     warning (the watcher swallows the warning). A corrupt line
 *     must not crash the daemon.
 *   - Empty lines are skipped silently.
 *
 * Supported record shapes (based on v2.1.x inspection, 2026-04-09):
 *
 *   { type: 'user',    message: {...}, timestamp, sessionId, cwd, gitBranch, ... }
 *   { type: 'message', message: { role: 'assistant'|..., content: [...] }, ... }
 *   { type: 'system',  ... }
 *   { type: 'queue-operation', operation: 'enqueue'|'dequeue', ... }
 *   { type: 'last-prompt' | 'pr-link' | 'deferred_tools_delta' | 'mcp_instructions_delta', ... }
 *
 * We keep only user/assistant/system/tool events; everything else
 * is recorded as nothing happened. The raw payload is preserved
 * verbatim so a later adapter version can re-derive new event
 * kinds without re-parsing native files.
 *
 * See: docs/architecture/ADR-006-session-persistence.md §Architektur/2
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SessionEventInput, SessionEventType } from '../session-events.js';

export const CLAUDE_CODE_ADAPTER_VERSION = 'claude-code/1.0';

export interface ClaudeCodeSessionMetadata {
  /** Session id (jsonl filename stem). */
  sessionId: string;
  /** First-seen working directory. */
  cwd: string;
  /** First-seen git branch. */
  gitBranch: string;
  /** First-seen CLI version. */
  version: string;
  /** ISO timestamp of the first record in the file. */
  startedAt: string | null;
}

/** Root directory where Claude Code stores its session jsonl files. */
export function defaultClaudeCodeSessionsRoot(home: string = homedir()): string {
  return resolve(home, '.claude', 'projects');
}

interface RawRecord {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  uuid?: string;
  message?: unknown;
  operation?: string;
  [k: string]: unknown;
}

/**
 * Parse a single jsonl line. Returns `null` when the line should be
 * ignored (empty line, unsupported `type`, malformed JSON). `seq`
 * is assigned by the caller — the adapter does not track state.
 */
export function parseClaudeCodeLine(
  line: string,
  seq: number,
): SessionEventInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let record: RawRecord;
  try {
    record = JSON.parse(trimmed) as RawRecord;
  } catch {
    return null;
  }

  if (!record || typeof record !== 'object') return null;
  const rawType = record.type;
  if (typeof rawType !== 'string') return null;

  const eventType = mapEventType(rawType, record);
  if (!eventType) return null;

  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString();
  const instanceUuid = typeof record.sessionId === 'string' ? record.sessionId : 'unknown';

  return {
    instanceUuid,
    seq,
    timestamp,
    eventType,
    payload: record,
    adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
  };
}

function mapEventType(type: string, record: RawRecord): SessionEventType | null {
  switch (type) {
    case 'user':
      return 'user_message';
    case 'message': {
      // `message` wraps both assistant and tool payloads. The role
      // lives one level deeper.
      const inner = record.message;
      if (inner && typeof inner === 'object' && 'role' in (inner as object)) {
        const role = (inner as { role?: unknown }).role;
        if (role === 'assistant') return 'assistant_message';
        if (role === 'user') return 'user_message';
        if (role === 'tool') return 'tool_result';
      }
      // Fallback: treat untagged `message` as an assistant event
      // so we don't lose context in recovery.
      return 'assistant_message';
    }
    case 'system':
      return 'system';
    case 'tool_use':
    case 'tool_call':
      return 'tool_call';
    case 'tool_result':
      return 'tool_result';
    // Pure metadata/housekeeping records — skip.
    case 'queue-operation':
    case 'last-prompt':
    case 'pr-link':
    case 'deferred_tools_delta':
    case 'mcp_instructions_delta':
      return null;
    default:
      return null;
  }
}

/**
 * Extract session metadata from an arbitrarily-ordered slice of
 * raw lines (typically the first 20). Returns `null` when no
 * usable record was found.
 */
export function extractClaudeCodeMetadata(
  lines: readonly string[],
  fallbackSessionId: string,
): ClaudeCodeSessionMetadata | null {
  let cwd = '';
  let gitBranch = '';
  let version = '';
  let sessionId = fallbackSessionId;
  let startedAt: string | null = null;
  let found = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: RawRecord;
    try {
      record = JSON.parse(trimmed) as RawRecord;
    } catch {
      continue;
    }
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (!gitBranch && typeof record.gitBranch === 'string') gitBranch = record.gitBranch;
    if (!version && typeof record.version === 'string') version = record.version;
    if (!startedAt && typeof record.timestamp === 'string') startedAt = record.timestamp;
    if (typeof record.sessionId === 'string') sessionId = record.sessionId;
    if (cwd || gitBranch || version) found = true;
  }

  if (!found && !startedAt) return null;
  return { sessionId, cwd, gitBranch, version, startedAt };
}

/**
 * Parse an entire jsonl buffer into a list of events. The `baseSeq`
 * parameter lets the caller continue numbering after a prior batch
 * (useful for tail-mode reads where the store already has earlier
 * events for this instance).
 */
export function parseClaudeCodeBuffer(
  buffer: string,
  baseSeq: number,
): SessionEventInput[] {
  const out: SessionEventInput[] = [];
  // Strip an optional UTF-8 BOM (U+FEFF). Some editors/tools
  // prepend one; without this strip the first JSON line would
  // fail to parse and be silently dropped, causing unbemerkt
  // event loss. (Gemini-Pro CR finding 2026-04-09, MEDIUM)
  const normalised = buffer.charCodeAt(0) === 0xfeff ? buffer.slice(1) : buffer;
  const lines = normalised.split('\n');
  let seq = baseSeq;
  for (const line of lines) {
    const event = parseClaudeCodeLine(line, seq);
    if (event) {
      out.push(event);
      seq += 1;
    }
  }
  return out;
}
