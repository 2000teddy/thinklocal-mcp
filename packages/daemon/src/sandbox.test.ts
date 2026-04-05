import { describe, it, expect } from 'vitest';
import { isPathAllowed } from './sandbox.js';

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
});
