/**
 * Unit tests for the `thinklocal heartbeat` subcommand.
 *
 * Verifies that the show/status/help dispatch returns the correct exit
 * codes and that `show` reads the on-disk prompt files from
 * `docs/agents/`. See ADR-004 Phase 1.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHeartbeatCommand, __test__ } from './thinklocal-heartbeat.js';

function captureStdout() {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as never);
  return { writes, restore: () => spy.mockRestore() };
}

function captureStderr() {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as never);
  return { writes, restore: () => spy.mockRestore() };
}

describe('thinklocal heartbeat CLI', () => {
  it('exposes the cron expressions from ADR-004', () => {
    expect(__test__.INBOX_CRON).toBe('*/5 * * * * *');
    expect(__test__.COMPLIANCE_CRON).toBe('0 */5 * * * *');
  });

  it('returns 0 for help', async () => {
    const out = captureStdout();
    const code = await runHeartbeatCommand(['help']);
    out.restore();
    expect(code).toBe(0);
    expect(out.writes.join('')).toContain('Usage: thinklocal heartbeat');
  });

  it('returns 0 for empty args (defaults to help)', async () => {
    const out = captureStdout();
    const code = await runHeartbeatCommand([]);
    out.restore();
    expect(code).toBe(0);
  });

  it('returns 2 for unknown subcommand', async () => {
    const err = captureStderr();
    const code = await runHeartbeatCommand(['nope']);
    err.restore();
    expect(code).toBe(2);
    expect(err.writes.join('')).toContain("unknown subcommand 'nope'");
  });

  it('show prints both cron sections from the on-disk prompt files', async () => {
    const out = captureStdout();
    const code = await runHeartbeatCommand(['show']);
    out.restore();
    expect(code).toBe(0);
    const text = out.writes.join('');
    expect(text).toContain('=== Inbox Heartbeat (CronCreate) ===');
    expect(text).toContain('=== Compliance Heartbeat (CronCreate) ===');
    expect(text).toContain('*/5 * * * * *');
    expect(text).toContain('0 */5 * * * *');
    expect(text).toContain('Inbox Heartbeat Instruction');
    expect(text).toContain('Compliance Heartbeat Instruction');
  });

  it('status prints fallback hint when no heartbeat config exists', async () => {
    // Skip if the developer happens to have a real config locally —
    // we never write to the real file in tests.
    if (existsSync(__test__.HEARTBEAT_CONFIG)) return;
    const out = captureStdout();
    const code = await runHeartbeatCommand(['status']);
    out.restore();
    expect(code).toBe(0);
    expect(out.writes.join('')).toContain('No heartbeat configuration found');
  });

  // Regression tests for the Gemini-Pro CR finding (2026-04-09): cmdStatus
  // must validate JSON and pretty-print.
  describe('cmdStatus JSON handling (regression for CR finding)', () => {
    let tmp: string;

    afterEach(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    it('pretty-prints valid JSON config and returns 0', () => {
      tmp = mkdtempSync(join(tmpdir(), 'thinklocal-heartbeat-'));
      const configPath = join(tmp, 'heartbeat.json');
      writeFileSync(configPath, '{"foo":1,"bar":[2,3]}');
      const out = captureStdout();
      const code = __test__.cmdStatus(configPath);
      out.restore();
      expect(code).toBe(0);
      const text = out.writes.join('');
      expect(text).toContain('"foo": 1');
      expect(text).toContain('"bar"');
      expect(text).toContain('OK');
    });

    it('returns 1 and warns on invalid JSON', () => {
      tmp = mkdtempSync(join(tmpdir(), 'thinklocal-heartbeat-'));
      const configPath = join(tmp, 'heartbeat.json');
      writeFileSync(configPath, '{not valid json');
      const out = captureStdout();
      const err = captureStderr();
      const code = __test__.cmdStatus(configPath);
      out.restore();
      err.restore();
      expect(code).toBe(1);
      expect(err.writes.join('')).toContain('not valid JSON');
    });
  });
});
