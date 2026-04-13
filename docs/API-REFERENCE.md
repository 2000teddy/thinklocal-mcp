# API Reference — thinklocal-mcp Daemon

**Stand:** 2026-04-13
**Base-URL:** `http://localhost:9440` (local mode) oder `https://localhost:9440` (LAN mode mit mTLS)
**Port:** konfigurierbar via `TLMCP_PORT` oder `config/daemon.toml`

---

## Inbox API (loopback-only)

Agent-to-Agent Messaging. Alle Endpoints erfordern `requireLocal()` — Zugriff nur von localhost.

| Method | Path | Beschreibung |
|---|---|---|
| POST | `/api/inbox/send` | Sendet eine Nachricht an einen Mesh-Peer (lokal signiert). Loopback-Pfad bei gleichem Daemon. |
| GET | `/api/inbox` | Listet eingehende Nachrichten. Filter: `unread=true`, `from=<spiffe>`, `limit=N`, `for_instance=<id>`, `include_legacy=true` |
| POST | `/api/inbox/mark-read` | Markiert eine Nachricht als gelesen. Body: `{ message_id }` |
| POST | `/api/inbox/archive` | Soft-Delete. Body: `{ message_id }` |
| GET | `/api/inbox/unread` | Zaehlt ungelesene. Filter: `from=<spiffe>`, `for_instance=<id>`, `include_legacy=true` |

### POST /api/inbox/send

```json
// Request
{ "to": "spiffe://thinklocal/host/<id>/agent/<type>[/instance/<id>]",
  "body": "string oder JSON-Objekt",
  "subject": "optional, max 200 Zeichen",
  "in_reply_to": "optional, message_id" }

// Response
{ "status": "sent", "delivery": "loopback|remote",
  "message_id": "uuid", "sent_at": "ISO8601" }
```

### GET /api/inbox (ADR-005 erweitert)

Query-Parameter `for_instance` filtert auf Nachrichten fuer eine bestimmte Agent-Instance.
`include_legacy=true` zeigt auch pre-Migration-Nachrichten (NULL `to_agent_instance`).

---

## Agent Registry API (loopback-only, ADR-004 Phase 2)

Agent-Instance Lifecycle. Alle Endpoints erfordern `requireLocal()`.

| Method | Path | Beschreibung |
|---|---|---|
| POST | `/api/agent/register` | Registriert eine Agent-Instanz. Gibt 4-Komponenten-SPIFFE-URI zurueck. |
| POST | `/api/agent/heartbeat` | Refresht den Heartbeat. 404 wenn unbekannt → Client muss re-registrieren. |
| POST | `/api/agent/unregister` | Deregistriert. Idempotent (200 auch wenn schon weg). |
| GET | `/api/agent/instances` | Listet alle aktuell registrierten Instanzen. |

### POST /api/agent/register

```json
// Request
{ "agent_type": "claude-code",      // [A-Za-z0-9._-]+
  "instance_id": "uuid-oder-custom", // [A-Za-z0-9._-]+
  "pid": 12345,                      // optional
  "cli_version": "2.1.92" }          // optional

// Response
{ "instance_spiffe_uri": "spiffe://thinklocal/host/<node>/agent/<type>/instance/<id>",
  "heartbeat_interval_ms": 5000,
  "inbox_schema_version": 1 }
```

**Error-Codes:** 400 (invalid body/regex), 403 (non-loopback), 409 (instance_id mit anderem agent_type), 500 (daemon URI malformed), 503 (registry full, max 1000).

---

## Token-Management API (loopback-only, ADR-016)

Token-basiertes Onboarding als Alternative zur SPAKE2-PIN-Zeremonie. Alle Token-Management-Endpoints erfordern `requireLocal()` — Zugriff nur von localhost (Port 9440).

| Method | Path | Beschreibung |
|---|---|---|
| POST | `/api/token/create` | Erstellt ein Single-Use Onboarding-Token |
| GET | `/api/token/list` | Listet alle Tokens mit Status |
| POST | `/api/token/revoke` | Widerruft ein Token |

### POST /api/token/create

Erstellt ein neues Bearer-Token fuer Node-Onboarding. Token sind Single-Use und zeitlich begrenzt.

```json
// Request
{ "name": "influxdb-server",
  "ttl_hours": 24 }

// Response
{ "token": "tlmcp_AbCdEf...",
  "id": "uuid",
  "name": "influxdb-server",
  "expires_at": "ISO8601",
  "created_at": "ISO8601" }
```

**Validierung:** `name` ist Pflicht (max 64 Zeichen, `[A-Za-z0-9._-]+`). `ttl_hours` optional (Default: 24, Min: 0.083 = 5min, Max: 168 = 7 Tage).

**Error-Codes:** 400 (invalid name/ttl), 403 (non-loopback), 500 (store error).

### GET /api/token/list

Listet alle Tokens mit Status (pending, used, revoked, expired). Token-Werte werden NICHT zurueckgegeben — nur ID, Name, Status und Zeitstempel.

```json
// Response
{ "tokens": [
    { "id": "uuid", "name": "influxdb-server", "status": "pending",
      "created_at": "ISO8601", "expires_at": "ISO8601", "used_at": null }
  ] }
```

### POST /api/token/revoke

Widerruft ein Token. Bereits verwendete oder abgelaufene Tokens koennen ebenfalls widerrufen werden.

```json
// Request
{ "id": "uuid" }

// Response
{ "status": "revoked", "id": "uuid" }
```

**Error-Codes:** 400 (missing id), 403 (non-loopback), 404 (unknown token).

---

## Onboarding API (remote, Port 9441, ADR-016)

Der Join-Endpoint ist auf dem oeffentlichen HTTPS-Port (9441) erreichbar und erfordert kein mTLS — stattdessen wird Bearer-Token-Authentifizierung verwendet.

| Method | Path | Beschreibung |
|---|---|---|
| POST | `/onboarding/join` | Node tritt dem Mesh bei (Bearer Token) |

### POST /onboarding/join

Der neue Node sendet sein CSR (Certificate Signing Request) zusammen mit dem Bearer-Token. Der Admin-Node validiert den Token, signiert das Zertifikat mit der Mesh-CA und gibt die Zertifikate zurueck.

```
Authorization: Bearer tlmcp_AbCdEf...
```

```json
// Request
{ "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...",
  "node_id": "stable-node-id",
  "agent_type": "influxdb" }

// Response
{ "cert": "-----BEGIN CERTIFICATE-----\n...",
  "ca": "-----BEGIN CERTIFICATE-----\n...",
  "peer_id": "spiffe://thinklocal/host/<node>/agent/<type>",
  "mesh_peers": [
    { "host": "10.10.10.55", "port": 9441, "node_id": "minimac-2" }
  ] }
```

**Sicherheit:**
- Token ist Single-Use (SHA-256 Hash im Store, Klartext wird nie gespeichert)
- Token hat TTL (5min bis 7 Tage)
- Rate-Limiting: 5 Fehlversuche pro IP → 15min Sperre
- Audit-Events: TOKEN_JOIN_SUCCESS / TOKEN_JOIN_REJECTED

**Error-Codes:** 400 (missing fields), 401 (invalid/expired/used token), 403 (rate-limited), 500 (CA signing error).

---

## Agent Card + Mesh (oeffentlich)

| Method | Path | Beschreibung |
|---|---|---|
| GET | `/.well-known/agent-card.json` | Daemon-Metadaten (SPIFFE-URI, Health, Capabilities) |
| GET | `/health` | Einfacher Health-Check |
| POST | `/message` | Empfaengt CBOR-kodierte SignedMessages vom Mesh |

---

## Dashboard API (oeffentlich, rate-limited)

| Method | Path | Beschreibung |
|---|---|---|
| GET | `/api/status` | Daemon-Status (Agent-ID, Peers, Capabilities, Uptime) |
| GET | `/api/peers` | Online-Peers mit Name, Host, Status, Last-Seen |
| GET | `/api/capabilities` | Registrierte Capabilities (filterbar) |
| GET | `/api/tasks` | Tasks mit Status |
| GET | `/api/audit?limit=N` | Audit-Log (paginiert, newest-first). Neu: `entity_type` + `entity_id` Felder (ADR-007). |
| POST | `/api/tasks/execute` | Fuehrt einen lokalen Skill synchron aus |
| GET | `/api/vault/credentials` | Listet Credentials (ohne Werte) |
| POST | `/api/vault/credentials` | Speichert neues Credential. Body: `{ name, value, category? }` |
| DELETE | `/api/vault/credentials/:name` | Entfernt ein Credential |

---

## Pairing API (oeffentlich, rate-limited + IP-Lockout)

| Method | Path | Beschreibung |
|---|---|---|
| POST | `/pairing/start` | Generiert 6-stellige PIN, startet Session (5 Min TTL) |
| POST | `/pairing/init` | Initiator startet SPAKE2-Handshake |
| POST | `/pairing/confirm` | Austausch der verschluesselten CA/Key-Daten |
| GET | `/pairing/status` | Aktueller Session-Status + gepaarte Peers |

**Sicherheit:** 10 Fehlversuche pro IP → 15 Min Sperre. Session-Timeout 5 Minuten.

---

## WebSocket

| Path | Beschreibung |
|---|---|
| `/ws` | Echtzeit-Events (peer:join/leave, task:*, capability:*, inbox:new, approval:*, config:changed) |

---

## Sicherheit

- **Inbox + Agent Registry + Token-Management:** Loopback-only (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) auf Port 9440
- **Onboarding Join:** Bearer-Token auf Port 9441 (kein mTLS erforderlich, Rate-Limited)
- **Dashboard + Pairing:** Rate-Limiting pro IP
- **Alle POST-Endpoints:** Max 64 KB Body
- **Query-Parameter:** `for_instance` und `limit` werden regex-validiert
- **mTLS:** Im LAN-Modus werden alle Verbindungen via gegenseitige Zertifikatspruefung gesichert
- **Token-Speicherung:** Nur SHA-256 Hashes im Store, Klartext-Token wird nur einmal bei Erstellung angezeigt
