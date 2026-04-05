/**
 * unix-socket.ts — Unix-Socket-Optimierung fuer Same-Host-Agents
 *
 * Wenn mehrere Agents auf demselben Host laufen, ist ein Unix-Socket
 * schneller und sicherer als TCP:
 * - Kein TCP-Overhead (Handshake, Nagle, etc.)
 * - Kein Netzwerk-Stack noetig
 * - Dateisystem-Berechtigungen als Zugangskontrolle
 * - ~30% weniger Latenz fuer lokale Kommunikation
 *
 * Socket-Pfad: <data_dir>/sockets/<agent-id>.sock
 * Erkennung: Peer auf localhost/127.0.0.1 → Unix-Socket bevorzugen
 */

import { createServer, connect, type Server, type Socket } from 'node:net';
import { existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Logger } from 'pino';

export interface UnixSocketConfig {
  /** Verzeichnis fuer Socket-Dateien */
  socketDir: string;
  /** Agent-ID (fuer Socket-Dateiname) */
  agentId: string;
  /** Maximale Nachrichtengroesse in Bytes (default: 1MB) */
  maxMessageSize?: number;
}

export interface UnixSocketMessage {
  /** Nachrichtentyp */
  type: 'heartbeat' | 'request' | 'response' | 'capability-sync' | 'gossip';
  /** Absender Agent-ID */
  from: string;
  /** Optionale Korrelations-ID */
  correlationId?: string;
  /** Payload als JSON */
  payload: unknown;
  /** Zeitstempel */
  timestamp: number;
}

/**
 * Framed Protocol: Jede Nachricht wird als [4-Byte Length][JSON-Payload] gesendet.
 * Length ist Big-Endian uint32, Payload ist UTF-8 JSON.
 */
const HEADER_SIZE = 4;
const DEFAULT_MAX_MESSAGE_SIZE = 1_048_576; // 1 MB

/**
 * Unix-Socket-Server fuer lokale Agent-Kommunikation.
 */
export class UnixSocketServer {
  private server: Server | null = null;
  private socketPath: string;
  private clients = new Set<Socket>();
  private maxMessageSize: number;

  constructor(
    private config: UnixSocketConfig,
    private onMessage: (msg: UnixSocketMessage, respond: (response: UnixSocketMessage) => void) => void,
    private log?: Logger,
  ) {
    this.socketPath = getSocketPath(config.socketDir, config.agentId);
    this.maxMessageSize = config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
  }

  /** Startet den Unix-Socket-Server */
  start(): Promise<void> {
    return new Promise((resolveP, reject) => {
      // Socket-Verzeichnis anlegen
      mkdirSync(dirname(this.socketPath), { recursive: true });

      // Alte Socket-Datei aufraeumen (falls Daemon vorher abgestuerzt)
      cleanupStaleSocket(this.socketPath);

      this.server = createServer((socket) => {
        this.clients.add(socket);
        this.log?.debug({ remote: 'unix-socket' }, 'Lokaler Client verbunden');

        const buffer = new FrameBuffer(this.maxMessageSize);

        socket.on('data', (chunk) => {
          buffer.push(chunk);

          let frame: Buffer | null;
          while ((frame = buffer.read()) !== null) {
            try {
              const msg = JSON.parse(frame.toString('utf-8')) as UnixSocketMessage;
              this.onMessage(msg, (response) => {
                if (!socket.destroyed) {
                  writeFrame(socket, response);
                }
              });
            } catch (err) {
              this.log?.warn({ err }, 'Ungueltige Unix-Socket-Nachricht');
            }
          }
        });

        socket.on('close', () => {
          this.clients.delete(socket);
        });

        socket.on('error', (err) => {
          this.log?.debug({ err }, 'Unix-Socket Client-Fehler');
          this.clients.delete(socket);
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.socketPath, () => {
        this.log?.info({ socketPath: this.socketPath }, 'Unix-Socket-Server gestartet');
        resolveP();
      });
    });
  }

  /** Stoppt den Server und raeumt die Socket-Datei auf */
  stop(): Promise<void> {
    return new Promise((resolveP) => {
      // Alle Clients trennen
      for (const client of this.clients) {
        client.destroy();
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          cleanupStaleSocket(this.socketPath);
          this.log?.info('Unix-Socket-Server gestoppt');
          resolveP();
        });
      } else {
        resolveP();
      }
    });
  }

  /** Gibt den Socket-Pfad zurueck */
  getSocketPath(): string {
    return this.socketPath;
  }
}

/**
 * Unix-Socket-Client fuer Verbindung zu einem lokalen Peer.
 */
export class UnixSocketClient {
  private socket: Socket | null = null;
  private buffer: FrameBuffer;
  private pendingRequests = new Map<string, {
    resolve: (msg: UnixSocketMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private socketPath: string,
    private log?: Logger,
    maxMessageSize?: number,
  ) {
    this.buffer = new FrameBuffer(maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE);
  }

  /** Verbindet zum Unix-Socket eines anderen Agents */
  connect(): Promise<void> {
    return new Promise((resolveP, reject) => {
      this.socket = connect(this.socketPath, () => {
        this.log?.debug({ socketPath: this.socketPath }, 'Unix-Socket verbunden');
        resolveP();
      });

      this.socket.on('data', (chunk) => {
        this.buffer.push(chunk);

        let frame: Buffer | null;
        while ((frame = this.buffer.read()) !== null) {
          try {
            const msg = JSON.parse(frame.toString('utf-8')) as UnixSocketMessage;
            if (msg.correlationId) {
              const pending = this.pendingRequests.get(msg.correlationId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.correlationId);
                pending.resolve(msg);
              }
            }
          } catch (err) {
            this.log?.warn({ err }, 'Ungueltige Unix-Socket-Antwort');
          }
        }
      });

      this.socket.on('error', (err) => {
        reject(err);
        // Alle pending Requests ablehnen
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(err);
          this.pendingRequests.delete(id);
        }
      });

      this.socket.on('close', () => {
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Socket closed'));
          this.pendingRequests.delete(id);
        }
      });
    });
  }

  /** Sendet eine Nachricht ohne auf Antwort zu warten */
  send(msg: UnixSocketMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Unix-Socket nicht verbunden');
    }
    writeFrame(this.socket, msg);
  }

  /** Sendet eine Request-Nachricht und wartet auf Antwort */
  request(msg: UnixSocketMessage, timeoutMs = 5000): Promise<UnixSocketMessage> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('Unix-Socket nicht verbunden'));
    }

    const correlationId = msg.correlationId ?? generateCorrelationId();
    msg.correlationId = correlationId;

    return new Promise((resolveP, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Unix-Socket Request Timeout nach ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve: resolveP, reject, timer });
      writeFrame(this.socket!, msg);
    });
  }

  /** Trennt die Verbindung */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
      this.pendingRequests.delete(id);
    }
  }

  /** Prueft ob verbunden */
  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}

/**
 * Prueft ob ein Peer lokal ist und einen Unix-Socket hat.
 */
export function canUseUnixSocket(peerHost: string, socketDir: string, peerId: string): boolean {
  if (!isLocalhost(peerHost)) return false;
  const socketPath = getSocketPath(socketDir, peerId);
  return existsSync(socketPath);
}

/**
 * Prueft ob eine IP-Adresse localhost ist.
 */
export function isLocalhost(host: string): boolean {
  return (
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1' ||
    host === 'localhost' ||
    host.startsWith('127.')
  );
}

/**
 * Gibt den Socket-Pfad fuer eine Agent-ID zurueck.
 */
export function getSocketPath(socketDir: string, agentId: string): string {
  // Agent-ID bereinigen (nur alphanumerisch + Bindestrich)
  const safe = agentId.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return resolve(socketDir, `${safe}.sock`);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────

/**
 * Frame-Buffer fuer laengen-prefixed Nachrichten.
 * Protocol: [4 Byte uint32 BE length][JSON payload]
 */
class FrameBuffer {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  constructor(private maxSize: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  read(): Buffer | null {
    if (this.totalLength < HEADER_SIZE) return null;

    const combined = this.totalLength === this.chunks[0]?.length
      ? this.chunks[0]
      : Buffer.concat(this.chunks);

    const msgLength = combined.readUInt32BE(0);

    if (msgLength > this.maxSize) {
      // Nachricht zu gross — Buffer leeren und null zurueckgeben (silent drop)
      this.chunks = [];
      this.totalLength = 0;
      return null;
    }

    if (combined.length < HEADER_SIZE + msgLength) return null;

    const frame = combined.subarray(HEADER_SIZE, HEADER_SIZE + msgLength);
    const rest = combined.subarray(HEADER_SIZE + msgLength);

    this.chunks = rest.length > 0 ? [rest] : [];
    this.totalLength = rest.length;

    return frame;
  }
}

function writeFrame(socket: Socket, msg: UnixSocketMessage): void {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  socket.write(Buffer.concat([header, payload]));
}

function cleanupStaleSocket(socketPath: string): void {
  if (existsSync(socketPath)) {
    try {
      // Pruefen ob es wirklich ein Socket ist
      const stat = statSync(socketPath);
      if (stat.isSocket()) {
        unlinkSync(socketPath);
      }
    } catch {
      // Datei nicht vorhanden oder kein Zugriff — ignorieren
    }
  }
}

let correlationCounter = 0;
function generateCorrelationId(): string {
  return `unix-${Date.now()}-${++correlationCounter}`;
}
