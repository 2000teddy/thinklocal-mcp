# thinklocal-mcp Wire Protocol Specification v1.0

Dieses Dokument beschreibt das Netzwerkprotokoll fuer die Kommunikation
zwischen thinklocal-mcp Mesh-Nodes.

---

## 1. Transport

| Parameter | Wert |
|-----------|------|
| Transport | HTTP/1.1 oder HTTPS (mTLS optional) |
| Default-Port | 9440 (konfigurierbar) |
| Encoding | CBOR-X (RFC 8949) |
| Max Body | 256 KB |
| Auth | ECDSA-Signatur pro Nachricht |

### Endpoints

| Pfad | Methode | Zweck |
|------|---------|-------|
| `/.well-known/agent-card.json` | GET | Agent-Identitaet und Capabilities |
| `/health` | GET | Liveness-Check |
| `/message` | POST | Core-Protokoll (CBOR) |
| `/pairing/start` | POST | Pairing-Session starten |
| `/pairing/init` | POST | SPAKE2 Handshake |
| `/pairing/confirm` | POST | Pairing bestaetigen |
| `/pairing/status` | GET | Pairing-Status abfragen |

---

## 2. Message Envelope

Alle Nachrichten verwenden ein einheitliches Envelope-Format, CBOR-kodiert und signiert.

```
MessageEnvelope {
  id:              string    // UUIDv4
  type:            string    // Nachrichtentyp (siehe Tabelle)
  sender:          string    // SPIFFE-URI des Senders
  correlation_id:  string    // Request/Response-Korrelation
  timestamp:       string    // ISO 8601
  ttl_ms:          number    // Time-to-Live in ms (0 = kein Expiry)
  idempotency_key: string    // Deduplizierungs-Key (= id)
  payload:         object    // Typ-spezifische Daten
}
```

### Signierte Nachricht

```
SignedMessage {
  envelope:  Uint8Array    // CBOR-kodiertes Envelope
  signature: Uint8Array    // ECDSA-Signatur ueber Envelope-Bytes
}
```

### Verifikation

1. SignedMessage deserialisieren (CBOR)
2. Signatur mit Public-Key des Senders pruefen
3. Envelope dekodieren
4. TTL pruefen: `now - timestamp > ttl_ms` → ablehnen
5. Replay-Guard: Doppelte `idempotency_key` → ablehnen

---

## 3. Nachrichtentypen

| Typ | Richtung | TTL | Beschreibung |
|-----|----------|-----|--------------|
| HEARTBEAT | Unicast | 15s | Liveness-Signal |
| DISCOVER_QUERY | Broadcast | 30s | Peer-Suche |
| DISCOVER_RESPONSE | Response | 30s | Peer-Liste |
| CAPABILITY_QUERY | Unicast | 30s | Skill-Abfrage |
| CAPABILITY_RESPONSE | Response | 30s | Skill-Liste |
| REGISTRY_SYNC | Unicast | 60s | Gossip-Synchronisation |
| REGISTRY_SYNC_RESPONSE | Response | 60s | Gossip-Antwort |
| TASK_REQUEST | Unicast | 30s | Skill ausfuehren |
| TASK_ACCEPT | Response | 30s | Task angenommen |
| TASK_REJECT | Response | 30s | Task abgelehnt |
| TASK_RESULT | Response | 30s | Task-Ergebnis |
| SKILL_ANNOUNCE | Broadcast | 30s | Neuen Skill ankuendigen |
| SECRET_REQUEST | Unicast | 30s | Credential anfragen |
| SECRET_RESPONSE | Response | 30s | Verschluesseltes Credential |

---

## 4. Gossip-Protokoll

Anti-Entropy-basierte Registry-Synchronisation.

### Parameter

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| Intervall | 30s | Sync-Zyklus |
| Fanout | 3 | Peers pro Runde (zufaellig) |
| Hash | SHA-256 (16 Hex) | Ueber eigene Capabilities |

### Ablauf

```
Sender                              Empfaenger
  │                                     │
  │  POST /message                      │
  │  REGISTRY_SYNC                      │
  │  { hash, capabilities[] }           │
  ├────────────────────────────────────►│
  │                                     │ Hash vergleichen
  │                                     │ Capabilities importieren
  │  REGISTRY_SYNC_RESPONSE             │   (nur sender == agent_id)
  │  { hash, imported, capabilities[] } │
  │◄────────────────────────────────────┤
  │                                     │
  │ Capabilities importieren            │
  │   (nur sender == agent_id)          │
```

### Sicherheitsregeln

- **Kein Relay**: Nur eigene Capabilities senden (agent_id == sender)
- **Anti-Forgery**: Empfaenger lehnt Capabilities ab deren agent_id nicht zum Sender passt
- **Cleanup**: Offline-Peers werden aus Registry entfernt

---

## 5. Heartbeat-Protokoll

### Liveness-Erkennung

```
Manager              Peer
  │  GET /health      │
  ├──────────────────►│
  │  200 OK           │
  │◄──────────────────┤
```

### Peer-Status

| Status | Bedingung |
|--------|-----------|
| online | Heartbeat erfolgreich, missedBeats = 0 |
| offline | missedBeats >= Schwellwert (default: 3) |

Bei Offline: `PEER_LEAVE` Audit-Event, Capabilities entfernen.

---

## 6. Agent Card

Jeder Node exponiert seine Identitaet unter `/.well-known/agent-card.json`:

```json
{
  "name": "hostname-agent_type",
  "version": "0.23.0",
  "hostname": "influxdb",
  "endpoint": "http://10.10.10.56:9440",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "spiffeUri": "spiffe://thinklocal/host/influxdb/agent/claude-code",
  "capabilities": {
    "skills": ["system-monitor", "influxdb"],
    "agents": ["claude-code"]
  },
  "health": {
    "cpu_percent": 12.5,
    "memory_percent": 61.0,
    "disk_percent": 62.6,
    "uptime_seconds": 3600
  },
  "mesh": {
    "joined_at": "2026-04-05T10:00:00Z",
    "trust_level": "mtls-self-signed",
    "peers_connected": 3
  }
}
```

---

## 7. Pairing-Protokoll (SPAKE2)

PIN-basierte Trust-Etablierung zwischen zwei Nodes.

### Parameter

| Parameter | Wert |
|-----------|------|
| Algorithmus | SPAKE2 + Ed25519 + SHA-256 + HKDF-HMAC |
| PIN | 6 Ziffern, zufaellig |
| Session-Timeout | 5 Minuten |
| Max Fehlversuche | 3 |
| Verschluesselung | AES-256-GCM |

### Ablauf

```
Responder (hat PIN)                 Initiator
  │                                     │
  │  POST /pairing/start                │
  │  → PIN: "123456" generiert          │
  │                                     │
  │  POST /pairing/init                 │
  │  { pin, agent_id, spake_message }   │
  │◄────────────────────────────────────┤
  │                                     │
  │  PIN pruefen (max 3 Versuche)       │
  │  SPAKE2 Shared-Secret ableiten      │
  │  Eigene Daten verschluesseln        │
  │                                     │
  │  { spake_message, encrypted_payload }│
  ├────────────────────────────────────►│
  │                                     │
  │                                     │ Shared-Secret ableiten
  │                                     │ Payload entschluesseln
  │                                     │ Fingerprint pruefen
  │  POST /pairing/confirm              │
  │  { encrypted_payload }              │
  │◄────────────────────────────────────┤
  │                                     │
  │  Entschluesseln + Fingerprint       │
  │  Peer speichern                     │
  │  { status: "paired" }               │
  ├────────────────────────────────────►│
  │                                     │ Peer speichern
  │  ✓ Beide Seiten vertrauen sich      │
```

### Verschluesselte Payload

```json
{
  "agentId": "spiffe://...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----...",
  "caCertPem": "-----BEGIN CERTIFICATE-----...",
  "hostname": "influxdb",
  "fingerprint": "sha256:abc123..."
}
```

---

## 8. Replay-Schutz

| Mechanismus | Beschreibung |
|-------------|--------------|
| Idempotency-Key | Jede Nachricht hat eindeutigen Key (= id) |
| TTL | Nachrichten verfallen nach ttl_ms |
| Replay-Guard | (sender, idempotency_key) Tupel gespeichert |
| Duplikat-Antwort | HTTP 409 Conflict |

---

## 9. Rate-Limiting

Token-Bucket pro Peer:

| Parameter | Wert |
|-----------|------|
| Algorithmus | Token Bucket |
| Scope | Pro Peer (SPIFFE-URI) |
| HTTP-Antwort | 429 Too Many Requests |

---

## 10. Discovery

### mDNS (primaer)

| Parameter | Wert |
|-----------|------|
| Service-Typ | `_thinklocal._tcp` |
| TXT-Records | agent-id, capability-hash, cert-fingerprint, proto |
| IP-Aufloesung | IPv4 aus addresses[] bevorzugt |

### Statische Peers (Fallback)

Konfigurierbar in `daemon.toml` oder via `TLMCP_STATIC_PEERS` Env-Variable.
Verbindung erfolgt parallel beim Daemon-Start.
