# ADR-001: Node Daemon Architektur

**Status:** Akzeptiert
**Datum:** 2026-04-03
**Entscheider:** Claude Code (Implementierung), Multi-Modell-Konsensus (Architektur)

## Kontext

Das thinklocal-mcp Mesh benötigt einen Daemon-Prozess pro Node, der folgende Aufgaben übernimmt:
- Agent-Identität verwalten (Keypair, SPIFFE-URI)
- Peers im LAN finden (mDNS)
- Verschlüsselt kommunizieren (mTLS)
- Fähigkeiten registrieren und synchronisieren (CRDT)
- Signierte Nachrichten austauschen (CBOR)
- Zugriff begrenzen (Rate-Limiting, Replay-Schutz)
- Audit-Trail führen (signierte Hash-Chain)

## Entscheidung

### Modularer Aufbau

Der Daemon ist in 13 unabhängige Module aufgeteilt:

```
config.ts       → Konfiguration (TOML + Env)
identity.ts     → ECDSA P-256 Keypair, SPIFFE-URI, Device-Fingerprint
tls.ts          → Lokale CA, Node-Zertifikate, mTLS
audit.ts        → SQLite WAL-Log mit signierter Hash-Chain
discovery.ts    → mDNS Discovery (bonjour-service)
agent-card.ts   → Fastify HTTP/HTTPS Server
mesh.ts         → Peer-Tracking, paralleler Heartbeat
messages.ts     → CBOR Message Envelope mit Signatur + TTL
registry.ts     → Automerge CRDT Capability Registry
gossip.ts       → Gossip-basierte Registry-Synchronisation
ratelimit.ts    → Token Bucket pro Peer
replay.ts       → Idempotency-basierter Replay-Schutz
logger.ts       → Pino strukturiertes Logging
```

### Technologie-Entscheidungen

| Entscheidung | Gewählt | Alternativen | Begründung |
|---|---|---|---|
| Sprache | TypeScript (strict) | Rust, Go | MCP SDK, async I/O, npm-Ökosystem |
| Runtime | Node.js 20+ | Bun, Deno | Stabilität, npm-Kompatibilität |
| HTTP Server | Fastify | Express, Koa | Performance, Plugin-System, native HTTPS |
| mDNS | bonjour-service | mdns, avahi | Aktiv gewartet, cross-platform |
| TLS Certs | node-forge | openssl CLI, step-ca | Kein externer Prozess nötig |
| Serialisierung | CBOR (cbor-x) | JSON, Protobuf, MessagePack | Kompakt, Schema-frei, binärsicher |
| CRDT | Automerge | Y.js, CRDT-Kit | Reif, gute TS-Unterstützung |
| Audit DB | better-sqlite3 (WAL) | LevelDB, LMDB | Synchron, schnell, SQL-Abfragen |
| Logging | Pino | Winston, Bunyan | Schnell, JSON-nativ |
| Tests | Vitest | Jest, Mocha | ESM-nativ, schnell |

### Sicherheitsarchitektur

1. **Transport**: mTLS mit lokaler Self-Signed CA (RSA-2048, 90-Tage-Certs)
2. **Identität**: ECDSA P-256 Keypairs + SPIFFE-URIs
3. **Nachrichten**: CBOR-Envelopes mit ECDSA-Signatur, TTL, Idempotency-Key
4. **Zugriffskontrolle**: Token Bucket Rate-Limiting (pro Peer + pro IP)
5. **Replay-Schutz**: In-Memory Idempotency-Cache mit TTL
6. **Audit**: Append-only SQLite mit signierter Hash-Chain
7. **Gossip**: agent_id-Validierung (nur eigene Capabilities dürfen publiziert werden)

### Bekannte Limitierungen (Phase 1)

- Kein SPAKE2 Trust-Bootstrap (kommt in Phase 1.2)
- Self-Signed CA statt step-ca (kommt in Phase 2)
- Kein libp2p/Noise Protocol (kann später ergänzt werden)
- CA-Key unverschlüsselt im Dateisystem
- Kein OCSP/CRL für Zertifikat-Widerruf

## Konsequenzen

**Positiv:**
- Klare Modulschnitte ermöglichen unabhängige Evolution
- mTLS + signierte Nachrichten bieten Defense-in-Depth
- Automerge CRDT eliminiert zentrale Registry-Abhängigkeit
- 41 Tests sichern die Korrektheit der Kernfunktionen

**Negativ:**
- RSA-2048 für TLS-Certs statt ECDSA (Inkonsistenz mit identity.ts)
- Ohne SPAKE2 ist der Trust-Bootstrap noch schwach
- Gossip-Sync sendet vollständige Capability-Listen (nicht inkrementell)

## Code Reviews

| Review | Modell | Fokus | Kritische Findings |
|--------|--------|-------|-------------------|
| #1 | GPT-5.4 | Grundgerüst | Agent Card ohne Identity-Check, Audit Hash-Chain unvollständig |
| #2 | Gemini 2.5 Pro | mTLS | Native fetch ohne custom CA, rejectUnauthorized: false |
| #3 | GPT-5.1 | Security Gesamt | Gossip agent_id Fälschung, fehlender Replay-Schutz |

Alle Findings wurden gefixt.
