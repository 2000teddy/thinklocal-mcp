/**
 * compliance-check.test.ts — Tests fuer ADR-004 Phase 4
 *
 * Testet den Compliance-Check gegen das echte Repo.
 */

import { describe, it, expect } from 'vitest';
import { checkCompliance, type ComplianceReport } from './compliance-check.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Find repo root (walk up from this file)
function findRepoRoot(): string {
  let dir = import.meta.dirname ?? __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'package.json'))) {
      if (existsSync(join(dir, '.git'))) return dir;
    }
    dir = join(dir, '..');
  }
  throw new Error('Could not find repo root');
}

describe('checkCompliance', () => {
  const repoRoot = findRepoRoot();

  it('returns a valid ComplianceReport', async () => {
    const report = await checkCompliance(repoRoot);
    expect(report.timestamp).toBeTruthy();
    expect(report.repoRoot).toBe(repoRoot);
    expect(report.branch).toBeTruthy();
    expect(Array.isArray(report.issues)).toBe(true);
    expect(typeof report.summary).toBe('string');
    expect(typeof report.compliant).toBe('boolean');
  });

  it('branch is a non-empty string', async () => {
    const report = await checkCompliance(repoRoot);
    expect(report.branch.length).toBeGreaterThan(0);
    expect(report.branch).not.toBe('unknown');
  });

  it('issues have correct shape', async () => {
    const report = await checkCompliance(repoRoot);
    for (const issue of report.issues) {
      expect(issue.check).toBeTruthy();
      expect(['info', 'warning', 'error']).toContain(issue.severity);
      expect(issue.message).toBeTruthy();
    }
  });

  it('compliant is false only when there are error-level issues', async () => {
    const report = await checkCompliance(repoRoot);
    const hasErrors = report.issues.some(i => i.severity === 'error');
    expect(report.compliant).toBe(!hasErrors);
  });

  it('summary starts with emoji indicator', async () => {
    const report = await checkCompliance(repoRoot);
    expect(report.summary).toMatch(/^[✅⚠️❌]/);
  });

  it('detects CHANGES.md presence', async () => {
    const report = await checkCompliance(repoRoot);
    const changesMissing = report.issues.find(
      i => i.check === 'changes-md' && i.severity === 'error',
    );
    expect(changesMissing).toBeUndefined();
  });

  it('handles non-existent repo root gracefully', async () => {
    const report = await checkCompliance('/tmp/nonexistent-repo-' + Date.now());
    expect(report.branch).toBe('unknown');
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('detects uncommitted changes when present', async () => {
    const report = await checkCompliance(repoRoot);
    const workingTree = report.issues.find(i => i.check === 'working-tree');
    if (workingTree) {
      expect(workingTree.severity).toBe('warning');
      expect(workingTree.message).toContain('uncommitted');
    }
  });
});
