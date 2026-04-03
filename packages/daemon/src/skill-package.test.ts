import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import {
  createSkillPackage,
  saveSkillPackage,
  loadSkillPackage,
  verifySkillPackage,
  installSkillPackage,
  type SkillPackage,
} from './skill-package.js';
import type { SkillManifest } from './skills.js';

function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

const manifest: SkillManifest = {
  id: 'test-skill',
  version: '1.0.0',
  description: 'Ein Test-Skill',
  author: 'spiffe://thinklocal/host/test/agent/claude-code',
  integrity: '',
  runtime: 'node',
  entrypoint: 'index.js',
  dependencies: [],
  tools: ['test.execute'],
  resources: [],
  category: 'test',
  permissions: ['network.local'],
  requirements: {},
  createdAt: new Date().toISOString(),
};

describe('SkillPackage — Signierte Skill-Pakete', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-skillpkg-'));
  const keys = generateKeys();

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('erstellt ein signiertes Paket aus Manifest + Code', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'module.exports = { execute: () => "hello" };');

    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    expect(pkg.format).toBe('tlskill-v1');
    expect(pkg.manifest.id).toBe('test-skill');
    expect(pkg.code).toBeTruthy();
    expect(pkg.integrity).toMatch(/^sha256:/);
    expect(pkg.signature).toBeTruthy();
    expect(pkg.authorPublicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('verifiziert ein gueltiges Paket', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'export default "test";');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    const result = verifySkillPackage(pkg);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('erkennt manipulierten Code', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'original code');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    // Code manipulieren
    pkg.code = Buffer.from('malicious code').toString('base64');

    const result = verifySkillPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Integrity'))).toBe(true);
  });

  it('erkennt falsche Signatur', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'signed code');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    // Signatur mit anderem Key
    const otherKeys = generateKeys();
    const fakePkg: SkillPackage = { ...pkg, authorPublicKey: otherKeys.publicKeyPem };

    const result = verifySkillPackage(fakePkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Signatur'))).toBe(true);
  });

  it('speichert und laedt .tlskill-Dateien', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'skill code');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    const filePath = saveSkillPackage(pkg, resolve(tmpDir, 'packages'));
    expect(filePath).toContain('test-skill-1.0.0.tlskill');

    const loaded = loadSkillPackage(filePath);
    expect(loaded.manifest.id).toBe('test-skill');
    expect(verifySkillPackage(loaded).valid).toBe(true);
  });

  it('installiert ein verifiziertes Paket', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'console.log("installed");');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);

    const installDir = resolve(tmpDir, 'installed-skills');
    const entrypoint = installSkillPackage(pkg, installDir);
    expect(entrypoint).toContain('index.js');
  });

  it('lehnt Installation eines manipulierten Pakets ab', () => {
    const codePath = resolve(tmpDir, 'index.js');
    writeFileSync(codePath, 'safe code');
    const pkg = createSkillPackage(manifest, codePath, keys.privateKeyPem, keys.publicKeyPem);
    pkg.code = Buffer.from('evil').toString('base64');

    const installDir = resolve(tmpDir, 'should-not-install');
    expect(() => installSkillPackage(pkg, installDir)).toThrow('ungueltig');
  });
});
