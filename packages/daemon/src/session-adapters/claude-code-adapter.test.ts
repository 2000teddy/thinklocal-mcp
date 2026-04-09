/**
 * Unit tests for the Claude Code session adapter (ADR-006 Phase 1).
 * Uses synthetic jsonl lines modelled after the real v2.1.x format.
 */
import { describe, it, expect } from 'vitest';
import {
  parseClaudeCodeLine,
  parseClaudeCodeBuffer,
  extractClaudeCodeMetadata,
  CLAUDE_CODE_ADAPTER_VERSION,
} from './claude-code-adapter.js';

const USER_LINE = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
  uuid: 'u1',
  timestamp: '2026-04-09T18:00:00.000Z',
  sessionId: 'sess-alpha',
  cwd: '/tmp/project',
  gitBranch: 'main',
  version: '2.1.92',
});

const ASSISTANT_LINE = JSON.stringify({
  type: 'message',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
  },
  uuid: 'a1',
  timestamp: '2026-04-09T18:00:01.000Z',
  sessionId: 'sess-alpha',
});

const SYSTEM_LINE = JSON.stringify({
  type: 'system',
  timestamp: '2026-04-09T18:00:02.000Z',
  sessionId: 'sess-alpha',
});

const QUEUE_LINE = JSON.stringify({
  type: 'queue-operation',
  operation: 'enqueue',
  timestamp: '2026-04-09T18:00:00.000Z',
  sessionId: 'sess-alpha',
});

describe('parseClaudeCodeLine', () => {
  it('recognizes a user event', () => {
    const e = parseClaudeCodeLine(USER_LINE, 0);
    expect(e).not.toBeNull();
    expect(e!.eventType).toBe('user_message');
    expect(e!.instanceUuid).toBe('sess-alpha');
    expect(e!.seq).toBe(0);
    expect(e!.adapterVersion).toBe(CLAUDE_CODE_ADAPTER_VERSION);
  });

  it('recognizes an assistant event wrapped in a message record', () => {
    const e = parseClaudeCodeLine(ASSISTANT_LINE, 1);
    expect(e!.eventType).toBe('assistant_message');
  });

  it('recognizes a system event', () => {
    const e = parseClaudeCodeLine(SYSTEM_LINE, 2);
    expect(e!.eventType).toBe('system');
  });

  it('skips queue-operation and other housekeeping records', () => {
    expect(parseClaudeCodeLine(QUEUE_LINE, 0)).toBeNull();
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'last-prompt' }), 0)).toBeNull();
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'pr-link' }), 0)).toBeNull();
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'deferred_tools_delta' }), 0)).toBeNull();
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'mcp_instructions_delta' }), 0)).toBeNull();
  });

  it('skips unknown record types', () => {
    expect(parseClaudeCodeLine(JSON.stringify({ type: 'mystery' }), 0)).toBeNull();
  });

  it('skips empty lines and malformed JSON without throwing', () => {
    expect(parseClaudeCodeLine('', 0)).toBeNull();
    expect(parseClaudeCodeLine('   ', 0)).toBeNull();
    expect(parseClaudeCodeLine('{not json', 0)).toBeNull();
    expect(parseClaudeCodeLine('"just a string"', 0)).toBeNull();
  });

  it('treats message with role=tool as tool_result', () => {
    const toolLine = JSON.stringify({
      type: 'message',
      message: { role: 'tool', content: 'ok' },
      sessionId: 'sess-alpha',
      timestamp: '2026-04-09T18:00:03.000Z',
    });
    expect(parseClaudeCodeLine(toolLine, 0)!.eventType).toBe('tool_result');
  });
});

describe('parseClaudeCodeBuffer', () => {
  it('parses a multi-line buffer and assigns sequential seqs', () => {
    const buf = [USER_LINE, ASSISTANT_LINE, QUEUE_LINE, SYSTEM_LINE].join('\n');
    const events = parseClaudeCodeBuffer(buf, 10);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.seq)).toEqual([10, 11, 12]);
    expect(events.map((e) => e.eventType)).toEqual([
      'user_message',
      'assistant_message',
      'system',
    ]);
  });

  it('returns [] on an empty buffer', () => {
    expect(parseClaudeCodeBuffer('', 0)).toEqual([]);
    expect(parseClaudeCodeBuffer('\n\n\n', 0)).toEqual([]);
  });

  // Regression for Gemini-Pro CR MEDIUM #3: a UTF-8 BOM on the
  // first byte used to poison the first line's JSON parser and
  // the event was silently dropped.
  it('strips a UTF-8 BOM before parsing (CR MEDIUM #3 regression)', () => {
    const withBom = `\uFEFF${USER_LINE}\n${ASSISTANT_LINE}`;
    const events = parseClaudeCodeBuffer(withBom, 0);
    expect(events.map((e) => e.eventType)).toEqual([
      'user_message',
      'assistant_message',
    ]);
  });

  // Regression for Live-Test 2026-04-09: Claude Code v2.1.92 emits
  // assistant turns with `type: "assistant"` directly, not wrapped
  // in a `type: "message"` envelope. The adapter's fixtures used
  // the envelope shape so this gap was invisible until running
  // against real data on MacMini + ai-n8n + MacBook Pro.
  it('recognises `type: "assistant"` records from real Claude Code v2.1.92 sessions', () => {
    const realAssistant = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will build the module.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/x.ts' } },
        ],
      },
      uuid: 'asst-1',
      timestamp: '2026-04-09T19:00:00.000Z',
      sessionId: 'sess-alpha',
      cwd: '/tmp',
      gitBranch: 'main',
      version: '2.1.92',
    });
    const e = parseClaudeCodeLine(realAssistant, 0);
    expect(e).not.toBeNull();
    expect(e!.eventType).toBe('assistant_message');
  });

  it('skips `type: "attachment"` records silently', () => {
    const attachLine = JSON.stringify({
      type: 'attachment',
      attachment: { kind: 'image' },
      sessionId: 'sess-alpha',
      timestamp: '2026-04-09T19:00:01.000Z',
    });
    expect(parseClaudeCodeLine(attachLine, 0)).toBeNull();
  });
});

describe('extractClaudeCodeMetadata', () => {
  it('pulls cwd / gitBranch / version from the first records that have them', () => {
    const meta = extractClaudeCodeMetadata([USER_LINE, ASSISTANT_LINE], 'fallback');
    expect(meta).not.toBeNull();
    expect(meta!.cwd).toBe('/tmp/project');
    expect(meta!.gitBranch).toBe('main');
    expect(meta!.version).toBe('2.1.92');
    expect(meta!.sessionId).toBe('sess-alpha');
    expect(meta!.startedAt).toBe('2026-04-09T18:00:00.000Z');
  });

  it('returns null when no usable record is present', () => {
    expect(extractClaudeCodeMetadata(['', 'garbage'], 'fallback')).toBeNull();
  });

  it('uses the fallback session id when none is found in lines', () => {
    const meta = extractClaudeCodeMetadata([JSON.stringify({ type: 'system', timestamp: 't' })], 'fallback-id');
    expect(meta!.sessionId).toBe('fallback-id');
  });
});
