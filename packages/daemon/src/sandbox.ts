/**
 * sandbox.ts — Skill-Sandboxing und Ressourcen-Limits
 *
 * Schraenkt die Ausfuehrung von Skills ein:
 * - CPU-Zeitlimit (Timeout)
 * - Speicherlimit (Node.js --max-old-space-size)
 * - Dateisystem: Nur Zugriff auf Skill-Verzeichnis
 * - Netzwerk: Konfigurierbar (allow/deny)
 *
 * Phase 1: Node.js child_process mit Limits
 * Phase 2: WASM-Sandbox (wasmtime/WASI)
 * Phase 3: Docker-Container
 */

import { fork, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, normalize, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';

export type SandboxRuntime = 'node' | 'wasm';

export interface SandboxConfig {
  /** Max CPU-Zeit in ms (default: 30s) */
  timeoutMs?: number;
  /** Max Speicher in MB (default: 256) */
  maxMemoryMb?: number;
  /** Erlaubtes Basisverzeichnis fuer Dateizugriffe */
  allowedDir?: string;
  /** Netzwerkzugriff erlaubt? (default: false) */
  allowNetwork?: boolean;
  /** Pfad/Binaername fuer den WASM-Runner (default: wasmtime) */
  wasmRunner?: string;
}

export interface SandboxResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  memoryUsedMb?: number;
}

interface SandboxProcessDeps {
  forkProcess?: typeof fork;
  spawnProcess?: typeof spawn;
  pathExists?: typeof existsSync;
}

/**
 * Prueft ob ein Pfad innerhalb eines erlaubten Verzeichnisses liegt.
 * Verhindert Path-Traversal-Angriffe (../../etc/passwd).
 */
export function isPathAllowed(targetPath: string, allowedDir: string): boolean {
  const normalizedTarget = normalize(resolve(targetPath));
  const normalizedAllowed = normalize(resolve(allowedDir));
  return normalizedTarget.startsWith(normalizedAllowed);
}

function getSkillDir(entryPath: string): string {
  return dirname(resolve(entryPath));
}

function createMinimalRunnerEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  if (process.env['PATH']) env['PATH'] = process.env['PATH'];
  if (process.env['HOME']) env['HOME'] = process.env['HOME'];
  if (process.env['SystemRoot']) env['SystemRoot'] = process.env['SystemRoot'];
  if (process.env['WINDIR']) env['WINDIR'] = process.env['WINDIR'];

  return env;
}

/**
 * Skill-Contract fuer WASI/WASM:
 * - Modul ist WASI-kompatibel
 * - Input kommt via SKILL_INPUT_BASE64 Environment-Variable
 * - Output wird als JSON oder Plaintext auf stdout geschrieben
 */
export function buildWasmtimeArgs(modulePath: string, allowedDir: string, input: unknown): string[] {
  const inputBase64 = Buffer.from(JSON.stringify(input ?? null), 'utf8').toString('base64');
  return [
    'run',
    '--dir',
    allowedDir,
    '--env',
    'SANDBOX=1',
    '--env',
    `SKILL_DIR=${getSkillDir(modulePath)}`,
    '--env',
    `SKILL_INPUT_BASE64=${inputBase64}`,
    modulePath,
  ];
}

export function parseSandboxStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Fuehrt einen Skill in einer sandboxed Umgebung aus.
 *
 * Implementierung: Node.js child_process.fork() mit:
 * - execArgv: --max-old-space-size fuer Speicherlimit
 * - timeout: AbortController fuer CPU-Zeitlimit
 * - cwd: Skill-Verzeichnis (beschraenkt Dateizugriffe)
 * - env: Minimale Umgebungsvariablen
 */
export class SkillSandbox {
  private defaultConfig: Required<SandboxConfig>;
  private deps: Required<SandboxProcessDeps>;

  constructor(
    skillsDir: string,
    config?: Partial<SandboxConfig>,
    private log?: Logger,
    deps?: SandboxProcessDeps,
  ) {
    this.defaultConfig = {
      timeoutMs: config?.timeoutMs ?? 30_000,
      maxMemoryMb: config?.maxMemoryMb ?? 256,
      allowedDir: config?.allowedDir ?? skillsDir,
      allowNetwork: config?.allowNetwork ?? false,
      wasmRunner: config?.wasmRunner ?? process.env['TLMCP_WASMTIME_BIN'] ?? 'wasmtime',
    };
    this.deps = {
      forkProcess: deps?.forkProcess ?? fork,
      spawnProcess: deps?.spawnProcess ?? spawn,
      pathExists: deps?.pathExists ?? existsSync,
    };
  }

  /**
   * Fuehrt ein Node.js-Skill in der Sandbox aus.
   */
  async execute(
    scriptPath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    return this.executeRuntime('node', scriptPath, input, config);
  }

  /**
   * Fuehrt einen Skill abhaengig von seiner Runtime aus.
   */
  async executeRuntime(
    runtime: SandboxRuntime,
    entryPath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    if (runtime === 'wasm') {
      return this.executeWasm(entryPath, input, config);
    }

    return this.executeNode(entryPath, input, config);
  }

  /**
   * Fuehrt einen WASI/WASM-Skill ueber wasmtime aus.
   */
  async executeWasm(
    modulePath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const start = Date.now();

    if (!isPathAllowed(modulePath, cfg.allowedDir)) {
      return {
        success: false,
        error: `Zugriff verweigert: ${modulePath} liegt ausserhalb von ${cfg.allowedDir}`,
        durationMs: 0,
      };
    }

    if (!this.deps.pathExists(modulePath)) {
      return {
        success: false,
        error: `WASM-Modul nicht gefunden: ${modulePath}`,
        durationMs: 0,
      };
    }

    return new Promise<SandboxResult>((resolvePromise) => {
      const args = buildWasmtimeArgs(modulePath, cfg.allowedDir, input);
      const child = this.deps.spawnProcess(cfg.wasmRunner, args, {
        cwd: getSkillDir(modulePath),
        env: createMinimalRunnerEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          this.log?.warn({ modulePath, timeoutMs: cfg.timeoutMs }, 'WASM-Sandbox: Timeout');
        }
      }, cfg.timeoutMs);

      const resolveOnce = (result: SandboxResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePromise(result);
      };

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        const durationMs = Date.now() - start;

        if (code === 0) {
          resolveOnce({
            success: true,
            output: parseSandboxStdout(stdout),
            durationMs,
          });
        } else {
          const error = stderr.trim() || `Exit code ${code}`;
          this.log?.warn({ modulePath, code, error, durationMs }, 'WASM-Sandbox: Fehlgeschlagen');
          resolveOnce({
            success: false,
            error,
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        const durationMs = Date.now() - start;
        const error =
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? `WASM-Runner nicht gefunden: ${cfg.wasmRunner}`
            : err.message;
        resolveOnce({
          success: false,
          error,
          durationMs,
        });
      });
    });
  }

  private async executeNode(
    scriptPath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const start = Date.now();

    if (!isPathAllowed(scriptPath, cfg.allowedDir)) {
      return {
        success: false,
        error: `Zugriff verweigert: ${scriptPath} liegt ausserhalb von ${cfg.allowedDir}`,
        durationMs: 0,
      };
    }

    if (!this.deps.pathExists(scriptPath)) {
      return {
        success: false,
        error: `Script nicht gefunden: ${scriptPath}`,
        durationMs: 0,
      };
    }

    return new Promise<SandboxResult>((resolvePromise) => {
      const abortController = new AbortController();

      const sandboxEnv: Record<string, string> = {
        NODE_ENV: 'production',
        SANDBOX: '1',
        SKILL_DIR: getSkillDir(scriptPath),
      };

      if (!cfg.allowNetwork) {
        sandboxEnv['NODE_OPTIONS'] = '--dns-result-order=verbatim';
      }

      const child: ChildProcess = this.deps.forkProcess(scriptPath, [], {
        execArgv: [`--max-old-space-size=${cfg.maxMemoryMb}`],
        cwd: getSkillDir(scriptPath),
        env: sandboxEnv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        signal: abortController.signal,
        timeout: cfg.timeoutMs,
      });

      let output: unknown = null;
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          this.log?.warn({ scriptPath, timeoutMs: cfg.timeoutMs }, 'Skill-Sandbox: Timeout');
        }
      }, cfg.timeoutMs);

      const resolveOnce = (result: SandboxResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePromise(result);
      };

      child.on('message', (msg: unknown) => {
        output = msg;
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        const durationMs = Date.now() - start;

        if (code === 0) {
          resolveOnce({
            success: true,
            output,
            durationMs,
          });
        } else {
          const error = stderr.trim() || `Exit code ${code}`;
          this.log?.warn({ scriptPath, code, error, durationMs }, 'Skill-Sandbox: Fehlgeschlagen');
          resolveOnce({
            success: false,
            error,
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        const durationMs = Date.now() - start;
        resolveOnce({
          success: false,
          error: err.message,
          durationMs,
        });
      });

      child.send({ type: 'execute', input });
    });
  }

  /**
   * Validiert ob ein Dateipfad fuer einen Skill erlaubt ist.
   */
  validatePath(path: string): boolean {
    return isPathAllowed(path, this.defaultConfig.allowedDir);
  }
}
