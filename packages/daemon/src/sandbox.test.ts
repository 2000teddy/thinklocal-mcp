import { describe, it, expect } from 'vitest';
import { buildWasmtimeArgs, isPathAllowed, parseSandboxStdout } from './sandbox.js';

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
});
