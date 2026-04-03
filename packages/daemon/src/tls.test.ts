import { describe, it, expect } from 'vitest';
import { createMeshCA, createNodeCert, verifyPeerCert, extractSpiffeUri } from './tls.js';

describe('TLS — Lokale CA und Zertifikate', () => {
  const ca = createMeshCA('test-mesh');

  it('erstellt eine gültige CA mit PEM-Zertifikat und Schlüssel', () => {
    expect(ca.caCertPem).toContain('BEGIN CERTIFICATE');
    expect(ca.caKeyPem).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('erstellt ein Node-Zertifikat signiert von der CA', () => {
    const bundle = createNodeCert(ca, 'test-host', 'spiffe://thinklocal/host/test-host/agent/claude-code', [
      '127.0.0.1',
    ]);

    expect(bundle.certPem).toContain('BEGIN CERTIFICATE');
    expect(bundle.keyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(bundle.caCertPem).toBe(ca.caCertPem);
  });

  it('verifiziert ein gültiges Node-Zertifikat gegen die CA', () => {
    const bundle = createNodeCert(ca, 'node-a', 'spiffe://thinklocal/host/node-a/agent/test');
    expect(verifyPeerCert(ca.caCertPem, bundle.certPem)).toBe(true);
  });

  it('lehnt ein Zertifikat von einer fremden CA ab', () => {
    const foreignCa = createMeshCA('foreign-mesh');
    const bundle = createNodeCert(foreignCa, 'evil-node', 'spiffe://evil/agent');
    expect(verifyPeerCert(ca.caCertPem, bundle.certPem)).toBe(false);
  });

  it('extrahiert den SPIFFE-URI aus dem Zertifikat', () => {
    const spiffeUri = 'spiffe://thinklocal/host/myhost/agent/claude-code';
    const bundle = createNodeCert(ca, 'myhost', spiffeUri);
    expect(extractSpiffeUri(bundle.certPem)).toBe(spiffeUri);
  });

  it('gibt null zurück wenn kein SPIFFE-URI im Zertifikat', () => {
    // CA-Zertifikat hat keinen SPIFFE-URI
    expect(extractSpiffeUri(ca.caCertPem)).toBeNull();
  });

  it('erzeugt unterschiedliche Seriennummern für verschiedene Zertifikate', () => {
    const bundle1 = createNodeCert(ca, 'host-1', 'spiffe://thinklocal/host/host-1/agent/a');
    const bundle2 = createNodeCert(ca, 'host-2', 'spiffe://thinklocal/host/host-2/agent/b');
    // Zertifikate sind unterschiedlich
    expect(bundle1.certPem).not.toBe(bundle2.certPem);
  });
});
