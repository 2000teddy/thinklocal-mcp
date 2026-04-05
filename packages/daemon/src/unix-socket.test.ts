/**
 * unix-socket.test.ts — Tests fuer Unix-Socket-Optimierung
 */

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  UnixSocketServer,
  UnixSocketClient,
  isLocalhost,
  getSocketPath,
  canUseUnixSocket,
  type UnixSocketMessage,
} from './unix-socket.js';

describe('Unix-Socket', () => {
  const servers: UnixSocketServer[] = [];
  const clients: UnixSocketClient[] = [];

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    for (const s of servers) await s.stop();
    servers.length = 0;
  });

  describe('isLocalhost', () => {
    it('erkennt IPv4 localhost', () => {
      expect(isLocalhost('127.0.0.1')).toBe(true);
      expect(isLocalhost('127.0.0.2')).toBe(true);
    });

    it('erkennt IPv6 localhost', () => {
      expect(isLocalhost('::1')).toBe(true);
      expect(isLocalhost('::ffff:127.0.0.1')).toBe(true);
    });

    it('erkennt "localhost" string', () => {
      expect(isLocalhost('localhost')).toBe(true);
    });

    it('erkennt Remote-Hosts als nicht-lokal', () => {
      expect(isLocalhost('10.10.10.55')).toBe(false);
      expect(isLocalhost('192.168.1.1')).toBe(false);
      expect(isLocalhost('example.com')).toBe(false);
    });
  });

  describe('getSocketPath', () => {
    it('generiert sicheren Pfad', () => {
      const path = getSocketPath('/tmp/sockets', 'agent-123');
      expect(path).toBe('/tmp/sockets/agent-123.sock');
    });

    it('bereinigt unsichere Zeichen', () => {
      const path = getSocketPath('/tmp/sockets', '../etc/passwd');
      expect(path).toContain('___etc_passwd.sock');
      expect(path).not.toContain('..');
    });

    it('bereinigt Sonderzeichen', () => {
      const path = getSocketPath('/tmp/sockets', 'agent;rm -rf /');
      expect(path).not.toContain(';');
      expect(path).not.toContain(' ');
    });
  });

  describe('canUseUnixSocket', () => {
    it('gibt false fuer Remote-Hosts zurueck', () => {
      expect(canUseUnixSocket('10.10.10.55', '/tmp', 'agent-1')).toBe(false);
    });

    it('gibt false wenn kein Socket existiert', () => {
      expect(canUseUnixSocket('127.0.0.1', '/tmp/nonexistent-dir-xyz', 'agent-1')).toBe(false);
    });
  });

  describe('Server + Client Integration', () => {
    it('sendet und empfaengt Nachrichten', async () => {
      const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-sock-'));
      const received: UnixSocketMessage[] = [];

      const server = new UnixSocketServer(
        { socketDir: tmpDir, agentId: 'test-server' },
        (msg, respond) => {
          received.push(msg);
          respond({
            type: 'response',
            from: 'test-server',
            correlationId: msg.correlationId,
            payload: { echo: msg.payload },
            timestamp: Date.now(),
          });
        },
      );
      servers.push(server);
      await server.start();

      const client = new UnixSocketClient(server.getSocketPath());
      clients.push(client);
      await client.connect();

      const response = await client.request({
        type: 'request',
        from: 'test-client',
        payload: { hello: 'world' },
        timestamp: Date.now(),
      });

      expect(response.type).toBe('response');
      expect(response.from).toBe('test-server');
      expect((response.payload as { echo: unknown }).echo).toEqual({ hello: 'world' });
      expect(received).toHaveLength(1);
    });

    it('heartbeat fire-and-forget', async () => {
      const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-sock-'));
      const received: UnixSocketMessage[] = [];

      const server = new UnixSocketServer(
        { socketDir: tmpDir, agentId: 'hb-server' },
        (msg) => { received.push(msg); },
      );
      servers.push(server);
      await server.start();

      const client = new UnixSocketClient(server.getSocketPath());
      clients.push(client);
      await client.connect();

      client.send({
        type: 'heartbeat',
        from: 'hb-client',
        payload: { cpu: 42 },
        timestamp: Date.now(),
      });

      // Kurz warten bis Nachricht ankommt
      await new Promise((r) => setTimeout(r, 50));

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('heartbeat');
    });

    it('request timeout bei fehlender Antwort', async () => {
      const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-sock-'));

      // Server der nicht antwortet
      const server = new UnixSocketServer(
        { socketDir: tmpDir, agentId: 'silent-server' },
        () => { /* absichtlich keine Antwort */ },
      );
      servers.push(server);
      await server.start();

      const client = new UnixSocketClient(server.getSocketPath());
      clients.push(client);
      await client.connect();

      await expect(
        client.request(
          { type: 'request', from: 'client', payload: {}, timestamp: Date.now() },
          200, // 200ms timeout
        ),
      ).rejects.toThrow('Timeout');
    });

    it('schliesst Verbindung bei zu grossen Nachrichten (Protocol Error)', async () => {
      const tmpDir = mkdtempSync(resolve(tmpdir(), 'tlmcp-sock-'));

      const server = new UnixSocketServer(
        { socketDir: tmpDir, agentId: 'size-server', maxMessageSize: 100 },
        () => {},
      );
      servers.push(server);
      await server.start();

      const client = new UnixSocketClient(server.getSocketPath(), undefined, 100);
      clients.push(client);
      await client.connect();

      // Client-seitig: writeFrame prueft jetzt Groesse
      expect(() => {
        client.send({
          type: 'request',
          from: 'big-client',
          payload: { data: 'x'.repeat(200) },
          timestamp: Date.now(),
        });
      }).toThrow('zu gross');
    });
  });
});
