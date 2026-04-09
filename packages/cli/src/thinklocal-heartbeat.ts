/**
 * ADR-004 Phase 1 — `thinklocal heartbeat` subcommand
 *
 * Provides a CLI helper that prints the cron-heartbeat prompts so the
 * user can paste them into their agent harness (e.g. Claude Code's
 * `CronCreate` tool) and a small status command that inspects the
 * optional `~/.thinklocal/heartbeat.json` configuration file.
 *
 * This command does NOT modify the daemon and does NOT install any
 * scheduler — Phase 1 is intentionally an external-cron design.
 *
 * See: docs/architecture/ADR-004-cron-heartbeat.md
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Walk upwards from `startDir` until a directory containing a `.git`
 * marker is found. Resilient against future file moves.
 * (Gemini-Pro precommit finding 2026-04-09, MEDIUM)
 */
function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 32; i++) {
    if (existsSync(resolve(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume the historic three-level layout. Useful inside
  // published tarballs that don't ship a `.git` directory.
  return resolve(startDir, '..', '..', '..');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(HERE);
const AGENTS_DOCS_DIR = resolve(REPO_ROOT, 'docs', 'agents');

const INBOX_PROMPT = 'inbox-heartbeat.md';
const COMPLIANCE_PROMPT = 'compliance-heartbeat.md';
// NOTE: 6-field cron format (with seconds). Compatible with JavaScript
// schedulers (CronCreate, node-cron) — NOT with standard 5-field system cron.
// (Gemini-Pro precommit finding 2026-04-09, LOW)
const INBOX_CRON = '*/5 * * * * *';
const COMPLIANCE_CRON = '0 */5 * * * *';

const HEARTBEAT_CONFIG = resolve(homedir(), '.thinklocal', 'heartbeat.json');

const USAGE = `Usage: thinklocal heartbeat <command>

Commands:
  show       Print the cron prompts for inbox-heartbeat and compliance-heartbeat
             (paste these into your agent harness, e.g. Claude Code CronCreate)
  status     Show the current heartbeat configuration (~/.thinklocal/heartbeat.json)
  help       Show this help

ADR-004 Phase 1 — see docs/architecture/ADR-004-cron-heartbeat.md`;

function printPromptFile(label: string, cron: string, file: string): boolean {
  const path = resolve(AGENTS_DOCS_DIR, file);
  if (!existsSync(path)) {
    process.stderr.write(`thinklocal heartbeat: missing prompt file ${path}\n`);
    return false;
  }
  const body = readFileSync(path, 'utf8');
  process.stdout.write(`=== ${label} (CronCreate) ===\n`);
  process.stdout.write(`Cron: ${cron}\n`);
  process.stdout.write(`Source: docs/agents/${file}\n`);
  process.stdout.write('Prompt:\n');
  process.stdout.write(body);
  if (!body.endsWith('\n')) process.stdout.write('\n');
  process.stdout.write('\n');
  return true;
}

function cmdShow(): number {
  const okInbox = printPromptFile('Inbox Heartbeat', INBOX_CRON, INBOX_PROMPT);
  const okCompliance = printPromptFile(
    'Compliance Heartbeat',
    COMPLIANCE_CRON,
    COMPLIANCE_PROMPT,
  );
  return okInbox && okCompliance ? 0 : 1;
}

function cmdStatus(configPath: string = HEARTBEAT_CONFIG): number {
  if (!existsSync(configPath)) {
    process.stdout.write(
      'No heartbeat configuration found at ~/.thinklocal/heartbeat.json.\n' +
        'Run `thinklocal heartbeat show` to get the prompts and register them in your agent harness.\n',
    );
    return 0;
  }
  const raw = readFileSync(configPath, 'utf8');
  process.stdout.write(`Heartbeat config (${configPath}):\n`);
  // Pretty-print if valid JSON, fall back to raw output otherwise.
  // (Gemini-Pro CR finding 2026-04-09, MEDIUM)
  try {
    const parsed = JSON.parse(raw);
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    process.stdout.write('OK\n');
    return 0;
  } catch {
    process.stderr.write(`Warning: ${configPath} is not valid JSON\n`);
    process.stdout.write(raw);
    if (!raw.endsWith('\n')) process.stdout.write('\n');
    return 1;
  }
}

/**
 * Entry point invoked by the main `thinklocal` dispatcher.
 *
 * Kept `async` deliberately: Phase 2 (ADR-004) will add async I/O against
 * the daemon `/api/agent/register` endpoint, and the dispatcher already
 * `await`s this call. Switching to sync now would just be churn.
 *
 * @param args  argv slice without the `heartbeat` token (e.g. ['show'])
 * @returns process exit code
 */
export async function runHeartbeatCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'help';
  switch (sub) {
    case 'show':
      return cmdShow();
    case 'status':
      return cmdStatus();
    case 'help':
    case '-h':
    case '--help':
      process.stdout.write(`${USAGE}\n`);
      return 0;
    default:
      process.stderr.write(`thinklocal heartbeat: unknown subcommand '${sub}'\n${USAGE}\n`);
      return 2;
  }
}

/** Test-only constants and helpers. Not part of the public CLI surface. */
export const __test__ = {
  HEARTBEAT_CONFIG,
  AGENTS_DOCS_DIR,
  INBOX_CRON,
  COMPLIANCE_CRON,
  cmdStatus,
};
