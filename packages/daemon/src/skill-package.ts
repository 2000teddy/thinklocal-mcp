/**
 * skill-package.ts — Signierte Skill-Pakete (.tlskill) erstellen und verifizieren
 *
 * Ein .tlskill-Paket ist ein JSON-Container mit:
 * - manifest: Skill-Metadaten (ID, Version, Tools, Permissions)
 * - code: Base64-kodierter Skill-Code (Entrypoint + Dependencies)
 * - signature: Ed25519-Signatur ueber manifest + code
 * - author_cert: Public Key des Autors (PEM)
 *
 * Sicherheitsmodell:
 * - Signatur muss gueltig sein bevor Code installiert wird
 * - Integrity-Hash (SHA-256) wird beim Erstellen berechnet und beim Installieren geprueft
 * - Code wird in Phase 3 in einer Sandbox ausgefuehrt (WASM/Docker)
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { signData, verifySignature } from './identity.js';
import type { SkillManifest } from './skills.js';
import type { Logger } from 'pino';

// --- Paket-Format ---

export interface SkillPackage {
  /** Format-Version */
  format: 'tlskill-v1';
  /** Skill-Manifest */
  manifest: SkillManifest;
  /** Base64-kodierter Code (Entrypoint-Datei) */
  code: string;
  /** SHA-256 Hash ueber code (Integritaetspruefung) */
  integrity: string;
  /** ECDSA-Signatur ueber JSON.stringify(manifest) + code (Base64) */
  signature: string;
  /** Public Key des Autors (PEM) */
  authorPublicKey: string;
}

// --- Paket erstellen ---

/**
 * Erstellt ein signiertes Skill-Paket aus einem Manifest und Code-Datei.
 */
export function createSkillPackage(
  manifest: SkillManifest,
  codePath: string,
  privateKeyPem: string,
  publicKeyPem: string,
  log?: Logger,
): SkillPackage {
  const codeContent = readFileSync(codePath, 'utf-8');
  const codeBase64 = Buffer.from(codeContent).toString('base64');

  // Integrity-Hash berechnen
  const integrity = createHash('sha256').update(codeBase64).digest('hex');

  // Manifest mit Integrity-Hash aktualisieren VOR der Signierung
  const signedManifest: SkillManifest = { ...manifest, integrity: `sha256:${integrity}` };

  // Signatur ueber manifest + code
  const signPayload = Buffer.from(JSON.stringify(signedManifest) + codeBase64);
  const signature = signData(privateKeyPem, signPayload).toString('base64');

  const pkg: SkillPackage = {
    format: 'tlskill-v1',
    manifest: signedManifest,
    code: codeBase64,
    integrity: `sha256:${integrity}`,
    signature,
    authorPublicKey: publicKeyPem,
  };

  log?.info({ skillId: manifest.id, integrity }, 'Skill-Paket erstellt');
  return pkg;
}

/**
 * Speichert ein Skill-Paket als .tlskill-Datei.
 */
export function saveSkillPackage(pkg: SkillPackage, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const filename = `${pkg.manifest.id}-${pkg.manifest.version}.tlskill`;
  const filePath = resolve(outputDir, filename);
  writeFileSync(filePath, JSON.stringify(pkg, null, 2), { mode: 0o644 });
  return filePath;
}

/**
 * Laedt ein Skill-Paket aus einer .tlskill-Datei.
 */
export function loadSkillPackage(filePath: string): SkillPackage {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as SkillPackage;
}

// --- Paket verifizieren ---

export interface VerificationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Verifiziert ein Skill-Paket:
 * 1. Format-Check
 * 2. Integrity-Hash pruefen
 * 3. Signatur verifizieren
 * 4. Manifest-Validierung
 */
export function verifySkillPackage(pkg: SkillPackage): VerificationResult {
  const errors: string[] = [];

  // 1. Format
  if (pkg.format !== 'tlskill-v1') {
    errors.push(`Unbekanntes Format: ${pkg.format}`);
  }

  // 2. Integrity
  const computedHash = createHash('sha256').update(pkg.code).digest('hex');
  const expectedHash = pkg.integrity.replace('sha256:', '');
  if (computedHash !== expectedHash) {
    errors.push(`Integrity-Mismatch: erwartet ${expectedHash}, berechnet ${computedHash}`);
  }

  // 3. Signatur
  try {
    const signPayload = Buffer.from(JSON.stringify(pkg.manifest) + pkg.code);
    const sigBuffer = Buffer.from(pkg.signature, 'base64');
    const valid = verifySignature(pkg.authorPublicKey, signPayload, sigBuffer);
    if (!valid) {
      errors.push('Signatur ungueltig');
    }
  } catch (err) {
    errors.push(`Signatur-Pruefung fehlgeschlagen: ${err}`);
  }

  // 4. Manifest
  if (!pkg.manifest.id) errors.push('Manifest: id fehlt');
  if (!pkg.manifest.version) errors.push('Manifest: version fehlt');
  if (!pkg.manifest.entrypoint) errors.push('Manifest: entrypoint fehlt');

  // 5. SECURITY: Skill-ID Path-Traversal-Schutz
  if (pkg.manifest.id && !/^[a-z0-9][a-z0-9._-]*$/.test(pkg.manifest.id)) {
    errors.push(`Manifest: Ungueltige Skill-ID "${pkg.manifest.id}" (nur a-z, 0-9, ., _, - erlaubt)`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verifiziert ein Skill-Paket gegen eine Liste bekannter/vertrauenswuerdiger Signer.
 * Sicherer als verifySkillPackage() allein, weil der Public Key nicht
 * nur aus dem Paket selbst vertraut wird.
 */
export function verifySkillPackageWithTrust(
  pkg: SkillPackage,
  trustedSignerKeys: Set<string>,
): VerificationResult {
  const result = verifySkillPackage(pkg);

  // Zusaetzlich: Signer muss in der Trusted-Liste sein
  if (!trustedSignerKeys.has(pkg.authorPublicKey)) {
    result.errors.push('Signer nicht in Trusted-Signers-Liste');
    result.valid = false;
  }

  return result;
}

/**
 * Installiert ein verifiziertes Skill-Paket in das Skills-Verzeichnis.
 * Gibt den Pfad zum extrahierten Entrypoint zurueck.
 */
export function installSkillPackage(
  pkg: SkillPackage,
  skillsDir: string,
  log?: Logger,
): string {
  // Erst verifizieren
  const result = verifySkillPackage(pkg);
  if (!result.valid) {
    throw new Error(`Skill-Paket ungueltig: ${result.errors.join(', ')}`);
  }

  // Skill-Verzeichnis erstellen
  const skillDir = resolve(skillsDir, pkg.manifest.id);
  mkdirSync(skillDir, { recursive: true });

  // Code extrahieren
  const codeContent = Buffer.from(pkg.code, 'base64').toString('utf-8');
  const entrypointPath = resolve(skillDir, basename(pkg.manifest.entrypoint));
  writeFileSync(entrypointPath, codeContent, { mode: 0o644 });

  // Manifest speichern
  writeFileSync(resolve(skillDir, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2));

  log?.info({ skillId: pkg.manifest.id, path: skillDir }, 'Skill-Paket installiert');
  return entrypointPath;
}
