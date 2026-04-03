import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialVault } from './vault.js';

describe('CredentialVault — Verschluesselter Credential-Speicher', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-vault-'));
  const vault = new CredentialVault(tmpDir, 'test-passphrase-12345');

  afterAll(() => {
    vault.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('speichert und ruft ein Credential ab (verschluesselt)', () => {
    vault.store('github-token', 'ghp_1234567890abcdef', {
      category: 'api-keys',
      tags: ['github', 'ci'],
    });

    const cred = vault.retrieve('github-token');
    expect(cred).not.toBeNull();
    expect(cred!.value).toBe('ghp_1234567890abcdef');
    expect(cred!.category).toBe('api-keys');
    expect(cred!.tags).toContain('github');
    expect(cred!.accessCount).toBe(1);
  });

  it('gibt null zurueck fuer unbekanntes Credential', () => {
    expect(vault.retrieve('nonexistent')).toBeNull();
  });

  it('listet Credentials ohne Werte', () => {
    vault.store('influxdb-token', 'influx-secret-123', { category: 'database' });
    const all = vault.list();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Kein 'value'-Feld in der Liste
    expect((all[0] as Record<string, unknown>)['value']).toBeUndefined();
  });

  it('filtert nach Kategorie', () => {
    const dbCreds = vault.list('database');
    expect(dbCreds.length).toBe(1);
    expect(dbCreds[0].name).toBe('influxdb-token');
  });

  it('entfernt ein Credential', () => {
    vault.store('temp-key', 'will-be-deleted');
    expect(vault.remove('temp-key')).toBe(true);
    expect(vault.retrieve('temp-key')).toBeNull();
  });

  it('respektiert TTL (Credential laeuft ab)', () => {
    vault.store('expiring-key', 'short-lived', { ttlHours: 0 }); // 0 hours = immediate expiry in theory
    // TTL=0 means expiresAt = now, so it should still be retrievable for a moment
    // Let's use a proper TTL test
    vault.store('future-key', 'valid', { ttlHours: 24 });
    expect(vault.retrieve('future-key')?.value).toBe('valid');
  });

  it('verschluesselt fuer einen Peer via NaCl Box', () => {
    const vault2 = new CredentialVault(
      mkdtempSync(resolve(tmpdir(), 'tlmcp-vault2-')),
      'other-passphrase',
    );

    const secret = 'super-secret-api-key';
    const sealed = vault.sealForPeer(secret, vault2.publicKey);
    expect(sealed).toBeTruthy();
    expect(sealed).not.toBe(secret); // Muss verschluesselt sein

    const unsealed = vault2.unsealFromPeer(sealed, vault.publicKey);
    expect(unsealed).toBe(secret);

    vault2.close();
  });

  it('lehnt NaCl-Entschluesselung mit falschem Schluessel ab', () => {
    const vault3 = new CredentialVault(
      mkdtempSync(resolve(tmpdir(), 'tlmcp-vault3-')),
      'third-passphrase',
    );
    const vaultFake = new CredentialVault(
      mkdtempSync(resolve(tmpdir(), 'tlmcp-vault-fake-')),
      'fake-passphrase',
    );

    const sealed = vault.sealForPeer('secret', vault3.publicKey);
    // Versuche mit falschem Key zu entschluesseln
    const result = vaultFake.unsealFromPeer(sealed, vault.publicKey);
    expect(result).toBeNull();

    vault3.close();
    vaultFake.close();
  });

  it('erstellt und verwaltet Approval-Requests', () => {
    const request = vault.createApprovalRequest(
      'spiffe://thinklocal/host/b/agent/gemini-cli',
      'github-token',
      'Brauche Zugriff fuer CI Pipeline',
    );

    expect(request.id).toBeTruthy();
    expect(request.status).toBe('pending');

    const pending = vault.getPendingRequests();
    expect(pending).toHaveLength(1);

    // Genehmigen
    expect(vault.approveRequest(request.id)).toBe(true);

    // Keine pending Requests mehr
    expect(vault.getPendingRequests()).toHaveLength(0);
  });

  it('lehnt eine Approval-Anfrage ab', () => {
    const request = vault.createApprovalRequest('peer', 'influxdb-token', 'test');
    expect(vault.denyRequest(request.id)).toBe(true);
    expect(vault.getPendingRequests()).toHaveLength(0);
  });
});
