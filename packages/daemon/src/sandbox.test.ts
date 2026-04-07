import { describe, it, expect } from 'vitest';
import { buildDenoArgs, buildDockerArgs, buildWasmtimeArgs, isPathAllowed, parseSandboxStdout } from './sandbox.js';

describe('Sandbox', () => {
  describe('isPathAllowed', () => {
    it('erlaubt Pfad innerhalb des Verzeichnisses', () => {
      expect(isPathAllowed('/home/user/skills/test/index.ts', '/home/user/skills')).toBe(true);
    });

    it('erlaubt das Verzeichnis selbst', () => {
      expect(isPathAllowed('/home/user/skills', '/home/user/skills')).toBe(true);
    });

    it('blockiert Path-Traversal nach oben', () => {
      expect(isPathAllowed('/home/user/skills/../../../etc/passwd', '/home/user/skills')).toBe(false);
    });

    it('blockiert absoluten Pfad ausserhalb', () => {
      expect(isPathAllowed('/etc/shadow', '/home/user/skills')).toBe(false);
    });

    it('blockiert Verzeichnisse mit gleichem Prefix ausserhalb', () => {
      expect(isPathAllowed('/home/user/skills-evil/index.js', '/home/user/skills')).toBe(false);
    });

    it('blockiert Pfad mit .. in der Mitte', () => {
      expect(isPathAllowed('/home/user/skills/sub/../../other/file', '/home/user/skills')).toBe(false);
    });

    it('erlaubt tief verschachtelten Pfad', () => {
      expect(isPathAllowed('/home/user/skills/a/b/c/d/e.ts', '/home/user/skills')).toBe(true);
    });
  });

  describe('buildWasmtimeArgs', () => {
    it('baut einen eingeschraenkten wasmtime-Aufruf fuer WASI-Module', () => {
      const args = buildWasmtimeArgs(
        '/home/user/skills/wasm/skill.wasm',
        '/home/user/skills',
        { action: 'ping', count: 2 },
      );

      expect(args).toEqual([
        'run',
        '--dir',
        '/home/user/skills',
        '--env',
        'SANDBOX=1',
        '--env',
        'SKILL_DIR=/home/user/skills/wasm',
        '--env',
        expect.stringMatching(/^SKILL_INPUT_BASE64=/),
        '/home/user/skills/wasm/skill.wasm',
      ]);

      const encoded = args[8]?.replace('SKILL_INPUT_BASE64=', '');
      expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe('{"action":"ping","count":2}');
    });
  });

  describe('parseSandboxStdout', () => {
    it('parst JSON-stdout', () => {
      expect(parseSandboxStdout('{"ok":true,"count":2}\n')).toEqual({ ok: true, count: 2 });
    });

    it('faellt bei Plaintext auf String zurueck', () => {
      expect(parseSandboxStdout('hello wasm\n')).toBe('hello wasm');
    });

    it('liefert undefined bei leerem stdout', () => {
      expect(parseSandboxStdout('   \n')).toBeUndefined();
    });
  });

  describe('buildDockerArgs', () => {
    it('baut einen read-only Docker-Fallback fuer JavaScript-Skills', () => {
      const args = buildDockerArgs('/home/user/skills/docker/index.js', '/home/user/skills', { hello: 'world' }, {
        allowNetwork: false,
        maxMemoryMb: 256,
        dockerImage: '',
      });

      expect(args).toEqual([
        'run',
        '--rm',
        '--network',
        'none',
        '--memory',
        '256m',
        '--cpus',
        '1',
        '--pids-limit',
        '64',
        '--read-only',
        '--mount',
        'type=bind,src=/home/user/skills,dst=/workspace,readonly',
        '-w',
        '/workspace/docker',
        '-e',
        'SANDBOX=1',
        '-e',
        'SKILL_DIR=/workspace/docker',
        '-e',
        expect.stringMatching(/^SKILL_INPUT_BASE64=/),
        'node:22-alpine',
        'node',
        '/workspace/docker/index.js',
      ]);
    });

    it('waehlt fuer Python-Skills das passende Basisimage', () => {
      const args = buildDockerArgs('/home/user/skills/python/tool.py', '/home/user/skills', { ping: true }, {
        allowNetwork: true,
        maxMemoryMb: 512,
        dockerImage: '',
      });

      expect(args).toContain('bridge');
      expect(args).toContain('python:3.12-alpine');
      expect(args.slice(-2)).toEqual(['python', '/workspace/python/tool.py']);
    });
  });

  describe('buildDenoArgs', () => {
    it('baut einen eingeschraenkten deno-run Aufruf ohne Netzwerk', () => {
      const args = buildDenoArgs('/home/user/skills/deno/main.ts', '/home/user/skills', {
        allowNetwork: false,
      });

      expect(args).toEqual([
        'run',
        '--quiet',
        '--no-prompt',
        '--allow-read=/home/user/skills',
        '--allow-env=SANDBOX,SKILL_DIR,SKILL_INPUT_BASE64,DENO_DIR',
        '/home/user/skills/deno/main.ts',
      ]);
    });

    it('erlaubt optional Netzwerk fuer deno-skills', () => {
      const args = buildDenoArgs('/home/user/skills/deno/main.ts', '/home/user/skills', {
        allowNetwork: true,
      });

      expect(args).toContain('--allow-net');
    });
  });
});
