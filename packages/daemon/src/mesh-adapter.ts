/**
 * mesh-adapter.ts — Adapter-Abstraktionsschicht fuer AI-CLI-Tools
 *
 * Definiert das Interface und die Basis-Klasse fuer alle Mesh-Adapter.
 * Adapter uebersetzen zwischen dem externen Protokoll (MCP stdio, REST, gRPC)
 * und dem internen Daemon-HTTP-API.
 *
 * Architektur:
 *   AI-CLI-Tool ← [Adapter-Protokoll] → Adapter ← [HTTP] → Daemon
 *
 * Implementierte Adapter:
 * - McpStdioAdapter (mcp-stdio.ts) — Claude Code / Claude Desktop
 *
 * Geplante Adapter:
 * - CodexCliAdapter — OpenAI Codex CLI
 * - GeminiCliAdapter — Google Gemini CLI
 * - RestApiAdapter — Generischer REST-Zugang fuer andere Tools
 */

import {
  MeshDaemonClient,
  type MeshClientConfig,
  type PeerInfo,
  type SkillExecutionResult,
  type CapabilityInfo,
  type CredentialInfo,
  type MeshStatus,
} from './mesh-client.js';

/**
 * Interface das jeder Mesh-Adapter implementieren muss.
 */
export interface MeshAdapter {
  /** Adapter-Name (z.B. "mcp-stdio", "rest-api") */
  readonly name: string;

  /** Mesh-Status abfragen */
  getStatus(): Promise<MeshStatus>;

  /** Peers auflisten */
  listPeers(): Promise<PeerInfo[]>;

  /** Skill ausfuehren (lokal oder remote) */
  executeSkill(skillId: string, input?: Record<string, unknown>): Promise<SkillExecutionResult>;

  /** Capabilities abfragen */
  listCapabilities(): Promise<CapabilityInfo[]>;

  /** Credentials auflisten */
  listCredentials(): Promise<CredentialInfo[]>;

  /** Adapter starten (Protokoll-spezifisch) */
  start(): Promise<void>;

  /** Adapter stoppen */
  stop(): void;
}

/**
 * Basis-Klasse: Gemeinsame HTTP-zu-Daemon-Logik.
 * Konkrete Adapter ueberschreiben nur start() und stop()
 * fuer ihren protokoll-spezifischen Server.
 */
export abstract class BaseHttpMeshAdapter implements MeshAdapter {
  abstract readonly name: string;
  protected readonly client: MeshDaemonClient;

  constructor(config?: MeshClientConfig) {
    this.client = new MeshDaemonClient(config ?? {
      baseUrl: `http://localhost:${process.env['TLMCP_PORT'] ?? '9440'}`,
    });
  }

  async getStatus(): Promise<MeshStatus> {
    return this.client.getStatus();
  }

  async listPeers(): Promise<PeerInfo[]> {
    return this.client.listPeers();
  }

  async executeSkill(skillId: string, input?: Record<string, unknown>): Promise<SkillExecutionResult> {
    return this.client.executeSkill(skillId, input);
  }

  async listCapabilities(): Promise<CapabilityInfo[]> {
    return this.client.listCapabilities();
  }

  async listCredentials(): Promise<CredentialInfo[]> {
    return this.client.listCredentials();
  }

  abstract start(): Promise<void>;
  abstract stop(): void;
}
