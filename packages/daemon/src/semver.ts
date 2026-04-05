/**
 * semver.ts — SemVer-Versionierung und Kompatibilitaetspruefung
 *
 * Leichtgewichtige SemVer-Implementierung ohne npm-Dependency.
 * Wird fuer Skill-Versionsvergleich und Kompatibilitaetspruefung genutzt.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Parst einen SemVer-String (z.B. "1.2.3" oder "1.2.3-beta.1").
 * Gibt null zurueck bei ungueltigem Format.
 */
export function parseSemVer(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/**
 * Vergleicht zwei SemVer-Versionen.
 * Gibt -1 (a < b), 0 (a == b), 1 (a > b) zurueck.
 */
export function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;

  // Prerelease: keine < hat (1.0.0-alpha < 1.0.0)
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;

  // Prerelease-Vergleich (SemVer Spec-konform)
  if (va.prerelease && vb.prerelease) {
    const pa = va.prerelease.split('.');
    const pb = vb.prerelease.split('.');
    const len = Math.min(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
      const na = Number(pa[i]);
      const nb = Number(pb[i]);

      if (!isNaN(na) && !isNaN(nb)) {
        // Beide numerisch: numerisch vergleichen
        if (na !== nb) return na > nb ? 1 : -1;
      } else if (!isNaN(na)) {
        // Numerisch < String (SemVer Spec)
        return -1;
      } else if (!isNaN(nb)) {
        return 1;
      } else {
        // Beide Strings: lexikographisch
        if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
      }
    }

    // Laengerer Prerelease hat hohere Prioritaet
    if (pa.length !== pb.length) return pa.length > pb.length ? 1 : -1;
  }

  return 0;
}

/**
 * Prueft ob Version `v` die Mindestversion `min` erfuellt.
 * satisfies("1.2.3", "1.0.0") → true
 * satisfies("0.9.0", "1.0.0") → false
 */
export function satisfiesMinVersion(version: string, minVersion: string): boolean {
  return compareSemVer(version, minVersion) >= 0;
}

/**
 * Prueft ob zwei Versionen kompatibel sind (gleiche Major-Version).
 * SemVer-Konvention: Major-Aenderungen sind breaking.
 * compatible("1.2.3", "1.5.0") → true  (gleiche Major)
 * compatible("1.2.3", "2.0.0") → false (unterschiedliche Major)
 * compatible("0.x.y", "0.x.y") → minor muss gleich sein (0.x ist instabil)
 */
export function isCompatible(versionA: string, versionB: string): boolean {
  const a = parseSemVer(versionA);
  const b = parseSemVer(versionB);
  if (!a || !b) return false;

  // Major 0 = instabil, Minor-Aenderungen koennen breaking sein
  if (a.major === 0 && b.major === 0) {
    return a.minor === b.minor;
  }

  return a.major === b.major;
}

/**
 * Gibt die neueste Version aus einer Liste zurueck.
 */
export function latestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions.reduce((latest, v) => compareSemVer(v, latest) > 0 ? v : latest);
}

/**
 * Prueft ob ein SemVer-Range-String erfuellt wird.
 * Unterstuetzte Formate:
 * - ">=1.0.0" — Mindestversion
 * - "^1.2.0" — Kompatibel (gleiche Major)
 * - "~1.2.0" — Patch-kompatibel (gleiche Major + Minor)
 * - "1.2.3"  — Exakter Match
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;

  // >=x.y.z
  if (range.startsWith('>=')) {
    return satisfiesMinVersion(version, range.slice(2));
  }

  // ^x.y.z (caret: kompatibel, gleiche Major)
  if (range.startsWith('^')) {
    const r = parseSemVer(range.slice(1));
    if (!r) return false;
    return isCompatible(version, range.slice(1)) && compareSemVer(version, range.slice(1)) >= 0;
  }

  // ~x.y.z (tilde: gleiche Major + Minor)
  if (range.startsWith('~')) {
    const r = parseSemVer(range.slice(1));
    if (!r) return false;
    return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
  }

  // Exakter Match
  return compareSemVer(version, range) === 0;
}
