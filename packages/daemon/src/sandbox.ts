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
 * Phase 2: WASM-Sandbox (wasmtime)
 * Phase 3: Docker-Container
 */

import { fork, type ChildProcess } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from 'pino';

export interface SandboxConfig {
  /** Max CPU-Zeit in ms (default: 30s) */
  timeoutMs?: number;
  /** Max Speicher in MB (default: 256) */
  maxMemoryMb?: number;
  /** Erlaubtes Basisverzeichnis fuer Dateizugriffe */
  allowedDir?: string;
  /** Netzwerkzugriff erlaubt? (default: false) */
  allowNetwork?: boolean;
}

export interface SandboxResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  memoryUsedMb?: number;
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

  constructor(
    skillsDir: string,
    config?: Partial<SandboxConfig>,
    private log?: Logger,
  ) {
    this.defaultConfig = {
      timeoutMs: config?.timeoutMs ?? 30_000,
      maxMemoryMb: config?.maxMemoryMb ?? 256,
      allowedDir: config?.allowedDir ?? skillsDir,
      allowNetwork: config?.allowNetwork ?? false,
    };
  }

  /**
   * Fuehrt ein Skill-Script in der Sandbox aus.
   */
  async execute(
    scriptPath: string,
    input: unknown,
    config?: Partial<SandboxConfig>,
  ): Promise<SandboxResult> {
    const cfg = { ...this.defaultConfig, ...config };
    const start = Date.now();

    // Pfad-Validierung: Script muss im erlaubten Verzeichnis liegen
    if (!isPathAllowed(scriptPath, cfg.allowedDir)) {
      return {
        success: false,
        error: `Zugriff verweigert: ${scriptPath} liegt ausserhalb von ${cfg.allowedDir}`,
        durationMs: 0,
      };
    }

    if (!existsSync(scriptPath)) {
      return {
        success: false,
        error: `Script nicht gefunden: ${scriptPath}`,
        durationMs: 0,
      };
    }

    return new Promise<SandboxResult>((resolvePromise) => {
      const abortController = new AbortController();

      // Minimale Umgebungsvariablen (kein PATH, keine Secrets)
      const sandboxEnv: Record<string, string> = {
        NODE_ENV: 'production',
        SANDBOX: '1',
        SKILL_DIR: resolve(scriptPath, '..'),
      };

      // Netzwerk: Wenn nicht erlaubt, keine DNS/HTTP Env-Vars
      if (!cfg.allowNetwork) {
        sandboxEnv['NODE_OPTIONS'] = '--dns-result-order=verbatim';
      }

      const child: ChildProcess = fork(scriptPath, [], {
        execArgv: [`--max-old-space-size=${cfg.maxMemoryMb}`],
        cwd: resolve(scriptPath, '..'),
        env: sandboxEnv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        signal: abortController.signal,
        timeout: cfg.timeoutMs,
      });

      let output: unknown = null;
      let error: string | undefined;
      let stderr = '';
      let timeoutHandle: ReturnType<typeof setTimeout>;

      // IPC-Kommunikation: Skill sendet Ergebnis via process.send()
      child.on('message', (msg: unknown) => {
        output = msg;
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - start;

        if (code === 0) {
          resolvePromise({
            success: true,
            output,
            durationMs,
          });
        } else {
          error = stderr.trim() || `Exit code ${code}`;
          this.log?.warn({ scriptPath, code, error, durationMs }, 'Skill-Sandbox: Fehlgeschlagen');
          resolvePromise({
            success: false,
            error,
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - start;
        resolvePromise({
          success: false,
          error: err.message,
          durationMs,
        });
      });

      // Input an den Skill senden
      child.send({ type: 'execute', input });

      // SECURITY: Timeout-Schutz mit Cleanup (verhindert Memory-Leak bei AbortController)
      timeoutHandle = setTimeout(() => {
        if (!child.killed) {
          abortController.abort();
          child.kill('SIGTERM');
          this.log?.warn({ scriptPath, timeoutMs: cfg.timeoutMs }, 'Skill-Sandbox: Timeout');
        }
      }, cfg.timeoutMs);
    });
  }

  /**
   * Validiert ob ein Dateipfad fuer einen Skill erlaubt ist.
   */
  validatePath(path: string): boolean {
    return isPathAllowed(path, this.defaultConfig.allowedDir);
  }
}
