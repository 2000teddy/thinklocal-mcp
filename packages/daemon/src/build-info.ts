/**
 * build-info.ts — Build-/Versions-Stempel, der im Mesh sichtbar gemacht wird (TODO 2026-05-19).
 *
 * Motiv: Beim 5-Node-Rollout war nicht erkennbar, welcher Node welchen Build fährt —
 * Inkompatibilitäten zeigten sich nur als verwirrende Fehler. Jeder Daemon liest beim
 * Start einen Build-Stempel und meldet ihn in agent_card + /api/status (→ MCP-Tools
 * `mesh_status`/`discover_peers` dumpen das automatisch).
 *
 * Quellen (mit Fallback, damit es ohne Git / ohne Extra-Dateien funktioniert):
 *  - build_version: Datei `VERSION` (Repo-Root) → sonst `package.json` `version` → 'unknown'
 *  - build_number:  Datei `BUILD` (Repo-Root, z.B. CI-Stempel) → sonst `git rev-parse --short HEAD` → 'unknown'
 *  - build_date:    `git log -1 --format=%cI` (Commit-Datum HEAD) → sonst null
 *  - build_node:    os.hostname()
 *
 * Reine Funktion mit injizierbaren Quellen (readFile/runGit/hostnameFn) → unit-testbar
 * ohne echtes Git/FS.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

export interface BuildInfo {
  build_version: string;
  build_number: string;
  build_node: string;
  build_date: string | null;
}

export interface BuildInfoDeps {
  /** Liest eine Datei (wirft, wenn nicht vorhanden). */
  readFile?: (path: string) => string;
  /** Führt ein git-Subkommando im Repo aus (wirft bei Fehler). */
  runGit?: (args: string) => string;
  hostnameFn?: () => string;
}

/** Repo-Root relativ zu diesem Modul (packages/daemon/src/ → 4 Ebenen hoch). */
export function defaultRepoRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../../..');
}

export function loadBuildInfo(repoRoot: string = defaultRepoRoot(), deps: BuildInfoDeps = {}): BuildInfo {
  const readFile = deps.readFile ?? ((p: string): string => readFileSync(p, 'utf-8'));
  const runGit =
    deps.runGit ??
    ((args: string): string => execSync(`git -C "${repoRoot}" ${args} 2>/dev/null`, { encoding: 'utf-8' }));
  const host = (deps.hostnameFn ?? hostname)();

  // build_version
  let version = 'unknown';
  try {
    const v = readFile(resolve(repoRoot, 'VERSION')).trim();
    if (v) version = v;
  } catch {
    try {
      const pkg = JSON.parse(readFile(resolve(repoRoot, 'package.json'))) as { version?: string };
      if (pkg.version) version = pkg.version;
    } catch {
      /* unknown */
    }
  }

  // build_number
  let number = 'unknown';
  try {
    const b = readFile(resolve(repoRoot, 'BUILD')).trim();
    if (b) number = b;
  } catch {
    try {
      const sha = runGit('rev-parse --short HEAD').trim();
      if (sha) number = sha;
    } catch {
      /* unknown */
    }
  }

  // build_date (Commit-Datum HEAD)
  let date: string | null = null;
  try {
    const d = runGit('log -1 --format=%cI').trim();
    if (d) date = d;
  } catch {
    /* null */
  }

  return { build_version: version, build_number: number, build_node: host, build_date: date };
}
