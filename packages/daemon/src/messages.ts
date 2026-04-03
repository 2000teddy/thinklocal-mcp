/**
 * messages.ts — CBOR-basiertes Nachrichtenprotokoll für das thinklocal-mcp Mesh
 *
 * Jede Nachricht wird als signierter CBOR-Envelope transportiert.
 * Der Envelope enthält Metadaten (Correlation-ID, TTL, Timestamp)
 * und eine typisierte Payload.
 *
 * Nachrichtentypen (Phase 1):
 * - HEARTBEAT: Lebenszeichen eines Peers
 * - DISCOVER_QUERY / DISCOVER_RESPONSE: Peer-Suche
 * - CAPABILITY_QUERY / CAPABILITY_RESPONSE: Fähigkeiten abfragen
 *
 * Phase 2+: TASK_REQUEST, TASK_RESULT, SKILL_TRANSFER, SECRET_REQUEST
 */

import { Encoder, Decoder } from 'cbor-x';
import { randomUUID } from 'node:crypto';
import { signData, verifySignature } from './identity.js';

// --- Nachrichtentypen ---

export const MessageType = {
  HEARTBEAT: 'HEARTBEAT',
  DISCOVER_QUERY: 'DISCOVER_QUERY',
  DISCOVER_RESPONSE: 'DISCOVER_RESPONSE',
  CAPABILITY_QUERY: 'CAPABILITY_QUERY',
  CAPABILITY_RESPONSE: 'CAPABILITY_RESPONSE',
  REGISTRY_SYNC: 'REGISTRY_SYNC',
  REGISTRY_SYNC_RESPONSE: 'REGISTRY_SYNC_RESPONSE',
  TASK_REQUEST: 'TASK_REQUEST',
  TASK_ACCEPT: 'TASK_ACCEPT',
  TASK_REJECT: 'TASK_REJECT',
  TASK_RESULT: 'TASK_RESULT',
  SKILL_ANNOUNCE: 'SKILL_ANNOUNCE',
  SKILL_REQUEST: 'SKILL_REQUEST',
  SKILL_TRANSFER: 'SKILL_TRANSFER',
  SECRET_REQUEST: 'SECRET_REQUEST',
  SECRET_RESPONSE: 'SECRET_RESPONSE',
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

// --- Payload-Typen ---

export interface HeartbeatPayload {
  uptime_seconds: number;
  peer_count: number;
  cpu_percent: number;
}

export interface DiscoverQueryPayload {
  /** Optionaler Filter: nur Peers mit bestimmtem Agent-Typ */
  agent_type?: string;
}

export interface DiscoverResponsePayload {
  agents: Array<{
    agent_id: string;
    agent_type: string;
    endpoint: string;
    capabilities_hash: string;
  }>;
}

export interface CapabilityQueryPayload {
  /** Gesuchte Fähigkeit (z.B. "influxdb.read") */
  skill_id?: string;
  /** Oder: alle Fähigkeiten eines bestimmten Typs */
  category?: string;
}

export interface CapabilityResponsePayload {
  capabilities: Array<{
    agent_id: string;
    skill_id: string;
    version: string;
    health: 'healthy' | 'degraded' | 'offline';
  }>;
}

export interface RegistrySyncPayload {
  /** Hash der lokalen Registry — Empfänger prüft ob Sync nötig */
  capability_hash: string;
  /** Alle lokalen Capabilities (für Import beim Empfänger) */
  capabilities: Array<{
    skill_id: string;
    version: string;
    description: string;
    agent_id: string;
    health: string;
    trust_level: number;
    updated_at: string;
    category: string;
    permissions: string[];
  }>;
}

export interface RegistrySyncResponsePayload {
  /** Hash der Registry nach Import */
  capability_hash: string;
  /** Anzahl importierter Capabilities */
  imported: number;
  /** Capabilities des Empfängers (für Rück-Sync) */
  capabilities: RegistrySyncPayload['capabilities'];
}

export interface TaskRequestPayload {
  task_id: string;
  skill_id: string;
  input: Record<string, unknown>;
  deadline: string | null;
}

export interface TaskAcceptPayload {
  task_id: string;
}

export interface TaskRejectPayload {
  task_id: string;
  reason: string;
}

export interface TaskResultPayload {
  task_id: string;
  state: 'completed' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface SecretRequestPayload {
  /** Name des angeforderten Credentials */
  credential_name: string;
  /** Begruendung fuer den Zugriff */
  reason: string;
  /** NaCl Public Key des Anforderers (Base64) fuer verschluesselten Ruecktransport */
  requester_public_key: string;
}

export interface SecretResponsePayload {
  /** Name des Credentials */
  credential_name: string;
  /** Status: approved (mit Wert), denied, pending */
  status: 'approved' | 'denied' | 'pending';
  /** NaCl-verschluesselter Credential-Wert (nur bei approved) */
  sealed_value: string | null;
  /** Ablehnungsgrund (bei denied) */
  reason: string | null;
}

export type MessagePayload =
  | HeartbeatPayload
  | DiscoverQueryPayload
  | DiscoverResponsePayload
  | CapabilityQueryPayload
  | CapabilityResponsePayload
  | RegistrySyncPayload
  | RegistrySyncResponsePayload
  | TaskRequestPayload
  | TaskAcceptPayload
  | TaskRejectPayload
  | TaskResultPayload
  | SecretRequestPayload
  | SecretResponsePayload;

// --- Envelope ---

export interface MessageEnvelope {
  /** Eindeutige Nachrichten-ID (UUIDv4) */
  id: string;
  /** Nachrichtentyp */
  type: MessageTypeName;
  /** SPIFFE-URI des Absenders */
  sender: string;
  /** Correlation-ID für Request/Response-Paare */
  correlation_id: string;
  /** Erstellungszeitpunkt (ISO 8601) */
  timestamp: string;
  /** Time-to-Live in Millisekunden (0 = kein Ablauf) */
  ttl_ms: number;
  /** Idempotency-Key zur Deduplizierung */
  idempotency_key: string;
  /** Typisierte Payload */
  payload: MessagePayload;
}

export interface SignedMessage {
  /** CBOR-kodierter Envelope */
  envelope: Uint8Array;
  /** Ed25519/ECDSA-Signatur über den Envelope */
  signature: Uint8Array;
}

// --- Encoder/Decoder ---

const encoder = new Encoder({ structuredClone: true });
const decoder = new Decoder({ structuredClone: true });

/**
 * Erstellt einen neuen Message Envelope.
 */
export function createEnvelope(
  type: MessageTypeName,
  sender: string,
  payload: MessagePayload,
  options?: {
    correlation_id?: string;
    ttl_ms?: number;
  },
): MessageEnvelope {
  const id = randomUUID();
  return {
    id,
    type,
    sender,
    correlation_id: options?.correlation_id ?? id,
    timestamp: new Date().toISOString(),
    ttl_ms: options?.ttl_ms ?? 30_000, // Default: 30 Sekunden
    idempotency_key: id,
    payload,
  };
}

/**
 * Kodiert und signiert einen Envelope als SignedMessage.
 */
export function encodeAndSign(
  envelope: MessageEnvelope,
  privateKeyPem: string,
): SignedMessage {
  const envelopeBytes = encoder.encode(envelope);
  const signature = signData(privateKeyPem, Buffer.from(envelopeBytes));
  return {
    envelope: envelopeBytes,
    signature: new Uint8Array(signature),
  };
}

/**
 * Dekodiert und verifiziert eine SignedMessage.
 * Gibt null zurück wenn die Signatur ungültig ist oder die Nachricht abgelaufen.
 */
export function decodeAndVerify(
  signed: SignedMessage,
  publicKeyPem: string,
): MessageEnvelope | null {
  // 1. Signatur prüfen
  const valid = verifySignature(
    publicKeyPem,
    Buffer.from(signed.envelope),
    Buffer.from(signed.signature),
  );
  if (!valid) return null;

  // 2. Envelope dekodieren
  const envelope = decoder.decode(Buffer.from(signed.envelope)) as MessageEnvelope;

  // 3. TTL prüfen
  if (envelope.ttl_ms > 0) {
    const created = new Date(envelope.timestamp).getTime();
    const now = Date.now();
    if (now - created > envelope.ttl_ms) {
      return null; // Nachricht abgelaufen
    }
  }

  return envelope;
}

/**
 * Serialisiert eine SignedMessage für den Transport (z.B. als HTTP Body).
 */
export function serializeSignedMessage(signed: SignedMessage): Uint8Array {
  return encoder.encode({
    envelope: signed.envelope,
    signature: signed.signature,
  });
}

/**
 * Deserialisiert eine SignedMessage aus einem CBOR-kodierten Buffer.
 */
export function deserializeSignedMessage(data: Uint8Array): SignedMessage {
  const decoded = decoder.decode(Buffer.from(data)) as {
    envelope: Uint8Array;
    signature: Uint8Array;
  };
  return {
    envelope: new Uint8Array(decoded.envelope),
    signature: new Uint8Array(decoded.signature),
  };
}

// --- Hilfsfunktionen für häufige Nachrichten ---

/**
 * Erstellt eine HEARTBEAT-Nachricht.
 */
export function createHeartbeat(
  sender: string,
  payload: HeartbeatPayload,
): MessageEnvelope {
  return createEnvelope(MessageType.HEARTBEAT, sender, payload, { ttl_ms: 15_000 });
}

/**
 * Erstellt eine CAPABILITY_QUERY-Nachricht.
 */
export function createCapabilityQuery(
  sender: string,
  query: CapabilityQueryPayload,
  correlationId?: string,
): MessageEnvelope {
  return createEnvelope(MessageType.CAPABILITY_QUERY, sender, query, {
    correlation_id: correlationId,
  });
}

/**
 * Erstellt eine DISCOVER_QUERY-Nachricht.
 */
export function createDiscoverQuery(
  sender: string,
  filter?: DiscoverQueryPayload,
): MessageEnvelope {
  return createEnvelope(MessageType.DISCOVER_QUERY, sender, filter ?? {});
}
