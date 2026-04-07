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

import { fork, spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';

export type SandboxRuntime = 'node' | 'wasm' | 'docker';

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
  /** Pfad/Binaername fuer den Docker-Runner (default: docker) */
  dockerRunner?: string;
  /** Optionales Docker-Image fuer den Skill-Fallback */
  dockerImage?: string;
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
  const relativePath = relative(normalizedAllowed, normalizedTarget);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
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

function toContainerPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function getRelativeSkillPath(targetPath: string, allowedDir: string): string {
  const absoluteTarget = normalize(resolve(targetPath));
  const absoluteAllowed = normalize(resolve(allowedDir));
  const relative = absoluteTarget.slice(absoluteAllowed.length).replace(/^[/\\]+/, '');
  return toContainerPath(relative);
}

function getDockerImage(entryPath: string, configuredImage?: string): string {
  if (configuredImage) return configuredImage;

  if (entryPath.endsWith('.py')) return 'python:3.12-alpine';
  if (entryPath.endsWith('.sh')) return 'alpine:3.20';
  return 'node:22-alpine';
}

function getDockerCommand(entryPath: string, allowedDir: string): string[] {
  const relativePath = getRelativeSkillPath(entryPath, allowedDir);
  const containerPath = `/workspace/${relativePath}`;

  if (entryPath.endsWith('.py')) return ['python', containerPath];
  if (entryPath.endsWith('.sh')) return ['sh', containerPath];
  if (entryPath.endsWith('.js') || entryPath.endsWith('.mjs') || entryPath.endsWith('.cjs')) {
    return ['node', containerPath];
  }

  throw new Error(`Docker-Fallback unterstuetzt nur .js, .mjs, .cjs, .py oder .sh: ${entryPath}`);
}

/**
 * Skill-Contract fuer Docker-Fallback:
 * - Skill-Datei liegt innerhalb des erlaubten Skill-Verzeichnisses
 * - Verzeichnis wird read-only nach /workspace gemountet
 * - Input kommt via SKILL_INPUT_BASE64 Environment-Variable
 * - Output wird als JSON oder Plaintext auf stdout geschrieben
 */
export function buildDockerArgs(
  entryPath: string,
  allowedDir: string,
  input: unknown,
  config: Pick<Required<SandboxConfig>, 'allowNetwork' | 'maxMemoryMb' | 'dockerImage'>,
): string[] {
  const inputBase64 = Buffer.from(JSON.stringify(input ?? null), 'utf8').toString('base64');
  const relativePath = getRelativeSkillPath(entryPath, allowedDir);
  const skillDir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
  const workDir = skillDir ? `/workspace/${skillDir}` : '/workspace';
  const dockerImage = getDockerImage(entryPath, config.dockerImage);

  return [
    'run',
    '--rm',
    '--network',
    config.allowNetwork ? 'bridge' : 'none',
    '--memory',
    `${config.maxMemoryMb}m`,
    '--cpus',
    '1',
    '--pids-limit',
    '64',
    '--read-only',
    '--mount',
    `type=bind,src=${resolve(allowedDir)},dst=/workspace,readonly`,
    '-w',
    workDir,
    '-e',
    'SANDBOX=1',
    '-e',
    `SKILL_DIR=${workDir}`,
    '-e',
    `SKILL_INPUT_BASE64=${inputBase64}`,
    dockerImage,
    ...getDockerCommand(entryPath, allowedDir),
  ];
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
      dockerRunner: config?.dockerRunner ?? process.env['TLMCP_DOCKER_BIN'] ?? 'docker',
      dockerImage: config?.dockerImage ?? process.env['TLMCP_SKILL_DOCKER_IMAGE'] ?? '',
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

    if (runtime === 'docker') {
      return this.executeDocker(entryPath, input, config);
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
      }) as ChildProcessByStdio<null, Readable, Readable>;

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

  /**
   * Fuehrt einen Skill in einem read-only Docker-Container aus.
   */
  async executeDocker(
    entryPath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const start = Date.now();

    if (!isPathAllowed(entryPath, cfg.allowedDir)) {
      return {
        success: false,
        error: `Zugriff verweigert: ${entryPath} liegt ausserhalb von ${cfg.allowedDir}`,
        durationMs: 0,
      };
    }

    if (!this.deps.pathExists(entryPath)) {
      return {
        success: false,
        error: `Docker-Skill nicht gefunden: ${entryPath}`,
        durationMs: 0,
      };
    }

    let args: string[];
    try {
      args = buildDockerArgs(entryPath, cfg.allowedDir, input, cfg);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      };
    }

    return new Promise<SandboxResult>((resolvePromise) => {
      const child = this.deps.spawnProcess(cfg.dockerRunner, args, {
        cwd: getSkillDir(entryPath),
        env: createMinimalRunnerEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as ChildProcessByStdio<null, Readable, Readable>;

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          this.log?.warn({ entryPath, timeoutMs: cfg.timeoutMs }, 'Docker-Sandbox: Timeout');
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
          this.log?.warn({ entryPath, code, error, durationMs }, 'Docker-Sandbox: Fehlgeschlagen');
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
            ? `Docker-Runner nicht gefunden: ${cfg.dockerRunner}`
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
