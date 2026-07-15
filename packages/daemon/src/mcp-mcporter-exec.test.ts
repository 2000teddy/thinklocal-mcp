// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Unit-Tests für TL07 mcp-mcporter-exec.ts — die reale Owner-seitige local-exec-Primitive.
 * Die Prozess-Primitive (`run`) wird gefaked → KEIN echter mcporter-`spawn`. Deckt:
 *  - Argv-Bau (tools/list, tools/call mit --args/--output/--timeout), Validierung, unsupported.
 *  - Ergebnis-Mapping: Exit0→200(JSON-RPC-Result), Timeout→504, Exit!=0→502, non-JSON→502.
 *  - Sicherheit: bösartiger Tool-Name wird abgelehnt (kein Flag-/Selector-Bruch).
 */
import { describe, it, expect } from 'vitest';
import { execPath } from 'node:process';
import {
  buildMcporterArgv,
  createMcporterLocalExec,
  execFileRunner,
  PROC_TIMEOUT_GRACE_MS,
  type ProcRunner,
  type ProcRunResult,
} from './mcp-mcporter-exec.js';
import type { McpLocalExecRequest } from './mcp-forward-executor.js';

const req = (payload: unknown, over: Partial<McpLocalExecRequest> = {}): McpLocalExecRequest => ({
  server: 'unifi',
  argv: ['mcporter', 'run', 'unifi'],
  payload,
  timeoutMs: 5000,
  execution_tier: 'self',
  ...over,
});
const listPayload = { jsonrpc: '2.0', id: 7, method: 'tools/list' };
const callPayload = (name: string, args?: unknown): unknown => ({
  jsonrpc: '2.0',
  id: 9,
  method: 'tools/call',
  params: { name, arguments: args },
});

function fakeRun(result: Partial<ProcRunResult>): {
  calls: Array<{ bin: string; argv: string[]; timeoutMs: number }>;
  run: ProcRunner;
} {
  const calls: Array<{ bin: string; argv: string[]; timeoutMs: number }> = [];
  const run: ProcRunner = async (bin, argv, opts) => {
    calls.push({ bin, argv: [...argv], timeoutMs: opts.timeoutMs });
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result };
  };
  return { calls, run };
}

describe('buildMcporterArgv', () => {
  it('tools/list → list <server> --json', () => {
    expect(buildMcporterArgv('unifi', listPayload, 5000)).toEqual({ argv: ['list', 'unifi', '--json'] });
  });

  it('tools/call → call <server>.<tool> --args <json> --output json --timeout', () => {
    const out = buildMcporterArgv('unifi', callPayload('list_clients', { site: 'default' }), 8000);
    expect(out).toEqual({
      argv: ['call', 'unifi.list_clients', '--args', '{"site":"default"}', '--output', 'json', '--timeout', '8000'],
    });
  });

  it('tools/call ohne arguments → --args {}', () => {
    const out = buildMcporterArgv('unifi', callPayload('list_clients'), 5000);
    expect('argv' in out && out.argv).toContain('{}');
  });

  it('tools/call mit ungültigem Tool-Namen (Flag-Injection) → error, KEIN argv', () => {
    const out = buildMcporterArgv('unifi', callPayload('--version'), 5000);
    expect('error' in out).toBe(true);
  });

  it('nicht unterstützte Methode → error', () => {
    expect('error' in buildMcporterArgv('unifi', { method: 'resources/read' }, 5000)).toBe(true);
  });
});

describe('createMcporterLocalExec', () => {
  it('Exit0 + JSON-stdout → 200 mit {jsonrpc,id,result}', async () => {
    const { calls, run } = fakeRun({ code: 0, stdout: '{"clients":["a","b"]}' });
    const exec = createMcporterLocalExec({ run, mcporterBin: 'mcporter' });
    const res = await exec(req(callPayload('list_clients')));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 9, result: { clients: ['a', 'b'] } });
    expect(calls[0]?.argv).toEqual(['call', 'unifi.list_clients', '--args', '{}', '--output', 'json', '--timeout', '5000']);
  });

  // ADR-041 (TL-08 Slice 2b): owner-seitige Redaction am Exec-Seam.
  it('SECURITY: sensitives Tool (get_wlan) → Ergebnis owner-seitig redigiert, kein Secret im Body', async () => {
    const { run } = fakeRun({ code: 0, stdout: '{"ssid":"home","x_passphrase":"TOPSECRET"}' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('get_wlan')));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('TOPSECRET');
    expect((res.body as { result?: unknown }).result).toEqual({ ssid: '[REDACTED]', x_passphrase: '[REDACTED]' });
  });

  it('nicht-sensitives Tool (list_clients) → passthrough (unverändert)', async () => {
    const { run } = fakeRun({ code: 0, stdout: '{"clients":["a","b"]}' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('list_clients')));
    expect((res.body as { result?: unknown }).result).toEqual({ clients: ['a', 'b'] });
  });

  it('SECURITY CR-MEDIUM: sensitives Tool, Exit != 0 → detail redigiert (kein rohes stderr/stdout-Leak)', async () => {
    const { run } = fakeRun({ code: 1, stdout: 'TOPSECRET in output', stderr: 'x_passphrase=TOPSECRET' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('get_wlan')));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('TOPSECRET');
    expect((res.body as { detail?: unknown }).detail).toBe('[REDACTED]');
  });

  it('CR-MEDIUM: sensitives Tool, non-JSON stdout → detail redigiert', async () => {
    const { run } = fakeRun({ code: 0, stdout: 'raw secret voucher ABCD-1234 not json' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('list_vouchers')));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('ABCD-1234');
  });

  it('tools/list → 200, result = geparste Liste', async () => {
    const { calls, run } = fakeRun({ code: 0, stdout: '{"tools":[{"name":"list_clients"}]}' });
    const exec = createMcporterLocalExec({ run });
    const res = await exec(req(listPayload));
    expect(res.status).toBe(200);
    expect((res.body as { id?: unknown }).id).toBe(7);
    expect(calls[0]?.argv).toEqual(['list', 'unifi', '--json']);
  });

  it('leeres stdout → result {} (Exit0)', async () => {
    const { run } = fakeRun({ code: 0, stdout: '' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('noop')));
    expect(res.status).toBe(200);
    expect((res.body as { result?: unknown }).result).toEqual({});
  });

  it('Timeout → 504', async () => {
    const { run } = fakeRun({ code: null, timedOut: true });
    const res = await createMcporterLocalExec({ run })(req(callPayload('list_clients')));
    expect(res.status).toBe(504);
  });

  it('Exit != 0 → 502 mit gekürztem detail aus stderr', async () => {
    const { run } = fakeRun({ code: 3, stderr: 'unifi auth failed' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('list_clients')));
    expect(res.status).toBe(502);
    expect((res.body as { detail?: string }).detail).toContain('unifi auth failed');
  });

  it('Exit0 aber non-JSON-stdout → 502', async () => {
    const { run } = fakeRun({ code: 0, stdout: 'not json at all' });
    const res = await createMcporterLocalExec({ run })(req(callPayload('list_clients')));
    expect(res.status).toBe(502);
    expect((res.body as { error?: string }).error).toMatch(/kein JSON/);
  });

  it('unsupported Methode → 400, run NICHT aufgerufen', async () => {
    const { calls, run } = fakeRun({ code: 0, stdout: '{}' });
    const res = await createMcporterLocalExec({ run })(req({ method: 'ping' }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('Prozess-Timeout = mcporter-Timeout + Grace (CR-LOW Timeout-Race)', async () => {
    const { calls, run } = fakeRun({ code: 0, stdout: '{}' });
    await createMcporterLocalExec({ run })(req(callPayload('list_clients'), { timeoutMs: 5000 }));
    expect(calls[0]?.timeoutMs).toBe(5000 + PROC_TIMEOUT_GRACE_MS);
  });

  it('kanonisiert den Servernamen (Unifi → unifi) im argv + id:0 wird echot', async () => {
    const { calls, run } = fakeRun({ code: 0, stdout: '{}' });
    const payload = { jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'list_clients' } };
    const res = await createMcporterLocalExec({ run })(req(payload, { server: 'Unifi' }));
    expect(calls[0]?.argv[1]).toBe('unifi.list_clients');
    expect((res.body as { id?: unknown }).id).toBe(0);
  });
});

// Der REALE execFileRunner (sicherheitskritische no-shell-Primitive) gegen echte
// kurzlebige node-Kindprozesse — KEIN mcporter noetig.
describe('execFileRunner (echter Prozess)', () => {
  it('Exit 0 → stdout durchgereicht, code 0, kein Timeout', async () => {
    const r = await execFileRunner(execPath, ['-e', "process.stdout.write('hello-json')"], { timeoutMs: 10000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('hello-json');
    expect(r.timedOut).toBe(false);
  });

  it('Exit != 0 → code durchgereicht', async () => {
    const r = await execFileRunner(execPath, ['-e', 'process.exit(3)'], { timeoutMs: 10000 });
    expect(r.code).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('Spawn-Fehler (ENOENT) → code 1, kein Timeout, kein Throw', async () => {
    const r = await execFileRunner('/nonexistent/definitely-not-a-binary-xyz', ['x'], { timeoutMs: 5000 });
    expect(r.code).toBe(1);
    expect(r.timedOut).toBe(false);
  });

  it('haengender Prozess → timedOut=true, code=null (Kill)', async () => {
    const r = await execFileRunner(execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.code).toBeNull();
  });
});
