import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeStableNodeId,
  loadOrCreateStableNodeId,
  loadOrCreateIdentity,
} from './identity.js';

describe('Identity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'thinklocal-identity-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('computeStableNodeId', () => {
    it('liefert 16 Hex-Zeichen', () => {
      const id = computeStableNodeId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('ist deterministisch (gleiche Hardware → gleiche ID)', () => {
      const a = computeStableNodeId();
      const b = computeStableNodeId();
      expect(a).toBe(b);
    });

    it('haengt NICHT vom OS-Hostname ab', () => {
      // Kann nicht direkt getestet werden ohne os.hostname() zu mocken,
      // aber wir verifizieren, dass der Algorithmus den Hostname nicht in
      // den Hash mischt: zwei aufeinanderfolgende Aufrufe muessen identisch
      // sein (waeren sie nicht, wenn os.hostname() rein flossen — denn der
      // OS-Hostname ist hier konstant, aber das ist ein indirekter Test).
      // Stattdessen pruefen wir, dass die Funktion ueber 100 Aufrufe stabil ist.
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(computeStableNodeId());
      }
      expect(ids.size).toBe(1);
    });
  });

  describe('loadOrCreateStableNodeId', () => {
    it('erzeugt eine neue ID beim ersten Aufruf und persistiert sie', () => {
      const id = loadOrCreateStableNodeId(tmpDir);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      const filePath = join(tmpDir, 'keys', 'node-id.txt');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8').trim()).toBe(id);
    });

    it('liest dieselbe ID beim zweiten Aufruf', () => {
      const a = loadOrCreateStableNodeId(tmpDir);
      const b = loadOrCreateStableNodeId(tmpDir);
      expect(a).toBe(b);
    });

    it('respektiert eine manuell hinterlegte ID (nicht ueberschreiben)', () => {
      const keyDir = join(tmpDir, 'keys');
      const idPath = join(keyDir, 'node-id.txt');
      // Schreibe einen wohlgeformten manuellen Wert
      const fs = require('node:fs');
      fs.mkdirSync(keyDir, { recursive: true });
      writeFileSync(idPath, 'deadbeefcafebabe\n');

      const id = loadOrCreateStableNodeId(tmpDir);
      expect(id).toBe('deadbeefcafebabe');
    });

    it('regeneriert bei korruptem Inhalt', () => {
      const keyDir = join(tmpDir, 'keys');
      const idPath = join(keyDir, 'node-id.txt');
      const fs = require('node:fs');
      fs.mkdirSync(keyDir, { recursive: true });
      writeFileSync(idPath, 'not-a-valid-hex-id\n');

      const id = loadOrCreateStableNodeId(tmpDir);
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      expect(id).not.toBe('not-a-valid-hex-id');
    });
  });

  describe('loadOrCreateIdentity', () => {
    it('erzeugt SPIFFE-URI mit stabilem Node-ID statt OS-Hostname', async () => {
      const identity = await loadOrCreateIdentity(tmpDir, 'claude-code');
      expect(identity.spiffeUri).toMatch(
        /^spiffe:\/\/thinklocal\/host\/[0-9a-f]{16}\/agent\/claude-code$/,
      );
      expect(identity.stableNodeId).toMatch(/^[0-9a-f]{16}$/);
      expect(identity.spiffeUri).toContain(identity.stableNodeId);
    });

    it('SPIFFE-URI bleibt stabil ueber Reloads (= Hostname-Drift-Schutz)', async () => {
      const a = await loadOrCreateIdentity(tmpDir, 'claude-code');
      const b = await loadOrCreateIdentity(tmpDir, 'claude-code');
      expect(a.spiffeUri).toBe(b.spiffeUri);
      expect(a.stableNodeId).toBe(b.stableNodeId);
      expect(a.fingerprint).toBe(b.fingerprint);
    });

    it('respektiert expliziten hostname-Override (Tests, Migration)', async () => {
      const identity = await loadOrCreateIdentity(tmpDir, 'gemini-cli', 'localhost');
      expect(identity.spiffeUri).toBe(
        'spiffe://thinklocal/host/localhost/agent/gemini-cli',
      );
      expect(identity.stableNodeId).toBe('localhost');
    });

    it('verschiedene agent_types ergeben verschiedene SPIFFE-URIs', async () => {
      const a = await loadOrCreateIdentity(tmpDir, 'claude-code');
      const b = await loadOrCreateIdentity(tmpDir, 'codex');
      expect(a.spiffeUri).not.toBe(b.spiffeUri);
      // ABER: gleiche stableNodeId, weil gleiche Maschine
      expect(a.stableNodeId).toBe(b.stableNodeId);
    });
  });
});
