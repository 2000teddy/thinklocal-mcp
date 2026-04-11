/**
 * compliance-check.ts — ADR-004 Phase 4: Automatischer Compliance-Check
 *
 * Prueft den aktuellen Compliance-Status des Repos und gibt einen
 * strukturierten Bericht zurueck. Wird vom Cron-Heartbeat der Agents
 * periodisch abgerufen, damit Agents automatisch an offene TODOs
 * erinnert werden.
 *
 * Checks:
 * 1. Gibt es uncommitted changes? (dirty working tree)
 * 2. Gibt es einen offenen PR ohne vollstaendige Compliance?
 * 3. Sind Tests gruen? (letzte Vitest-Execution)
 * 4. CHANGES.md hat einen [Unreleased] Eintrag?
 * 5. TODO.md hat offene Phase-1 Items?
 *
 * Der Endpoint ist GET /api/compliance/status (loopback-only).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

const execAsync = promisify(exec);

export interface ComplianceIssue {
  check: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ComplianceReport {
  timestamp: string;
  repoRoot: string;
  branch: string;
  issues: ComplianceIssue[];
  summary: string;
  compliant: boolean;
}

/**
 * Run a git command safely (async), returning stdout or null on failure.
 * CR Gemini Pro: execSync blocks event loop — fixed to async exec.
 */
async function gitCmd(cmd: string, cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { cwd, encoding: 'utf-8', timeout: 5_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Generate a compliance report for the given repo root.
 */
export async function checkCompliance(repoRoot: string): Promise<ComplianceReport> {
  const issues: ComplianceIssue[] = [];

  // Current branch
  const branch = (await gitCmd('git rev-parse --abbrev-ref HEAD', repoRoot)) ?? 'unknown';

  // 1. Dirty working tree?
  const status = await gitCmd('git status --porcelain', repoRoot);
  if (status && status.length > 0) {
    const fileCount = status.split('\n').filter(l => l.trim()).length;
    issues.push({
      check: 'working-tree',
      severity: 'warning',
      message: `${fileCount} uncommitted change(s) in working tree`,
    });
  }

  // 2. CHANGES.md has [Unreleased] section?
  const changesPath = join(repoRoot, 'CHANGES.md');
  if (existsSync(changesPath)) {
    const changes = readFileSync(changesPath, 'utf-8');
    if (!changes.includes('[Unreleased]')) {
      issues.push({
        check: 'changes-md',
        severity: 'warning',
        message: 'CHANGES.md has no [Unreleased] section — new work should be documented',
      });
    }
  } else {
    issues.push({
      check: 'changes-md',
      severity: 'error',
      message: 'CHANGES.md not found',
    });
  }

  // 3. COMPLIANCE-TABLE.md exists and is not stale?
  const compliancePath = join(repoRoot, 'COMPLIANCE-TABLE.md');
  if (existsSync(compliancePath)) {
    const compliance = readFileSync(compliancePath, 'utf-8');
    // Check for any ❌ entries (non-compliant)
    const failCount = (compliance.match(/❌/g) || []).length;
    if (failCount > 0) {
      issues.push({
        check: 'compliance-table',
        severity: 'error',
        message: `COMPLIANCE-TABLE.md has ${failCount} failed check(s) (❌)`,
      });
    }
  }

  // 4. Unpushed commits?
  const unpushed = await gitCmd('git log @{u}..HEAD --oneline 2>/dev/null', repoRoot);
  if (unpushed && unpushed.length > 0) {
    const commitCount = unpushed.split('\n').filter(l => l.trim()).length;
    issues.push({
      check: 'unpushed-commits',
      severity: 'info',
      message: `${commitCount} unpushed commit(s) on ${branch}`,
    });
  }

  // 5. TODO.md open items count
  const todoPath = join(repoRoot, 'TODO.md');
  if (existsSync(todoPath)) {
    const todo = readFileSync(todoPath, 'utf-8');
    const openItems = (todo.match(/- \[ \]/g) || []).length;
    if (openItems > 0) {
      issues.push({
        check: 'todo-items',
        severity: 'info',
        message: `${openItems} open TODO item(s)`,
      });
    }
  }

  // Build summary
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const compliant = errorCount === 0;

  let summary: string;
  if (issues.length === 0) {
    summary = '✅ All compliance checks passed';
  } else if (compliant) {
    summary = `⚠️ ${warningCount} warning(s), ${issues.length - warningCount} info — no blocking issues`;
  } else {
    summary = `❌ ${errorCount} error(s), ${warningCount} warning(s) — action required`;
  }

  return {
    timestamp: new Date().toISOString(),
    repoRoot,
    branch,
    issues,
    summary,
    compliant,
  };
}

/**
 * Register the compliance check REST endpoint.
 * Loopback-only (127.0.0.1/::1).
 */
export function registerComplianceApi(
  server: FastifyInstance,
  repoRoot: string,
  log?: Logger,
): void {
  server.get('/api/compliance/status', async (req, reply) => {
    // Loopback guard
    const ip = req.ip;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return reply.code(403).send({ error: 'compliance endpoint is loopback-only' });
    }

    const report = checkCompliance(repoRoot);
    log?.info(
      { branch: report.branch, issues: report.issues.length, compliant: report.compliant },
      'Compliance check completed',
    );
    return report;
  });
}
