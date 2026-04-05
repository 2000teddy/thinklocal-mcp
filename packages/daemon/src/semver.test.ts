import { describe, it, expect } from 'vitest';
import { parseSemVer, compareSemVer, satisfiesMinVersion, isCompatible, latestVersion, satisfiesRange } from './semver.js';

describe('SemVer', () => {
  describe('parseSemVer', () => {
    it('parst standard SemVer', () => {
      expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
    });
    it('parst mit Prerelease', () => {
      expect(parseSemVer('1.0.0-beta.1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'beta.1' });
    });
    it('gibt null bei ungueltigem Format', () => {
      expect(parseSemVer('abc')).toBeNull();
      expect(parseSemVer('1.2')).toBeNull();
    });
  });

  describe('compareSemVer', () => {
    it('gleiche Versionen', () => expect(compareSemVer('1.2.3', '1.2.3')).toBe(0));
    it('Major groesser', () => expect(compareSemVer('2.0.0', '1.9.9')).toBe(1));
    it('Minor kleiner', () => expect(compareSemVer('1.0.0', '1.1.0')).toBe(-1));
    it('Patch groesser', () => expect(compareSemVer('1.0.2', '1.0.1')).toBe(1));
    it('Prerelease < Release', () => expect(compareSemVer('1.0.0-alpha', '1.0.0')).toBe(-1));
  });

  describe('satisfiesMinVersion', () => {
    it('gleiche Version erfuellt', () => expect(satisfiesMinVersion('1.0.0', '1.0.0')).toBe(true));
    it('hoehere Version erfuellt', () => expect(satisfiesMinVersion('1.2.3', '1.0.0')).toBe(true));
    it('niedrigere Version erfuellt nicht', () => expect(satisfiesMinVersion('0.9.0', '1.0.0')).toBe(false));
  });

  describe('isCompatible', () => {
    it('gleiche Major = kompatibel', () => expect(isCompatible('1.2.3', '1.5.0')).toBe(true));
    it('verschiedene Major = inkompatibel', () => expect(isCompatible('1.2.3', '2.0.0')).toBe(false));
    it('Major 0: gleiche Minor = kompatibel', () => expect(isCompatible('0.2.3', '0.2.0')).toBe(true));
    it('Major 0: verschiedene Minor = inkompatibel', () => expect(isCompatible('0.2.3', '0.3.0')).toBe(false));
  });

  describe('latestVersion', () => {
    it('findet die neueste', () => expect(latestVersion(['1.0.0', '2.1.0', '1.5.0'])).toBe('2.1.0'));
    it('leere Liste = null', () => expect(latestVersion([])).toBeNull());
  });

  describe('satisfiesRange', () => {
    it('>= Range', () => {
      expect(satisfiesRange('1.5.0', '>=1.0.0')).toBe(true);
      expect(satisfiesRange('0.5.0', '>=1.0.0')).toBe(false);
    });
    it('^ Range (caret)', () => {
      expect(satisfiesRange('1.5.0', '^1.2.0')).toBe(true);
      expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false);
      expect(satisfiesRange('1.1.0', '^1.2.0')).toBe(false);
    });
    it('~ Range (tilde)', () => {
      expect(satisfiesRange('1.2.5', '~1.2.0')).toBe(true);
      expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
    });
    it('exakter Match', () => {
      expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
      expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
    });
  });
});
