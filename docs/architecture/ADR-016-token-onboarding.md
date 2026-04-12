# ADR-016: Token-basiertes Onboarding

**Status:** Akzeptiert
**Datum:** 2026-04-12
**Entscheider:** Claude Code (Implementierung), Multi-Modell-Konsensus (Architektur, GPT-5.4 + Gemini Pro, beide 9/10 — Konsensus vom 2026-04-07)

## Kontext

Das aktuelle Pairing basiert auf einer SPAKE2-PIN-Zeremonie (ADR-001, `pairing.ts` / `pairing-handler.ts`):

1. Node A generiert eine 6-stellige PIN via `POST /pairing/start`
2. Die PIN wird dem Benutzer des anderen Nodes **physisch** mitgeteilt
3. Node B sendet die PIN + SPAKE2-Message an `POST /pairing/init`
4. Bei korrekter PIN tauschen beide Nodes verschluesselt CA-Zertifikate aus
5. Der neue Peer wird in `PairingStore` gespeichert, TLS hot-reloaded

Dieses Verfahren bietet starke Sicherheit gegen Remote-Angreifer:
- SPAKE2 schuetzt gegen Offline-Dictionary-Attacks
- Rate-Limiting (3 Versuche/Session, 10 Versuche/IP mit 15min Lockout)
- PIN wird nie geloggt

**Problem:** Fuer Single-Owner-Meshes (ein Admin, mehrere Nodes) ist die PIN-Zeremonie umstaendlich. Wenn Christian auf 4 Nodes im Heimnetz (minimac-2, influxdb-node, Linux-Gateway, Raspberry Pi) den Daemon installiert, muss er 3x eine PIN-Zeremonie durchfuehren — jedes Mal mit physischem Terminal-Zugang auf beiden Nodes gleichzeitig. Bei headless Nodes (kein Monitor) wird das zum SSH-Jonglierakt.

**Konsensus vom 2026-04-07:** GPT-5.4 und Gemini Pro waren sich einig (beide 9/10), dass ein Token-basiertes Onboarding als **Ergaenzung** (nicht Ersatz) zur PIN-Zeremonie sinnvoll ist. Die CA-Key bleibt ausschliesslich auf dem Admin-Node.

## Entscheidung

Bearer-Token-basiertes Onboarding als Alternative zum SPAKE2-PIN-Pairing, analog zum `claude code /login` Flow.

### Flow

```
┌──────────────────┐                         ┌──────────────────┐
│   Admin-Node     │                         │   Neuer Node     │
│  (CA-Key-Owner)  │                         │  (will joinen)   │
└────────┬─────────┘                         └────────┬─────────┘
         │                                            │
         │  1. thinklocal token create                │
         │     --name "influxdb-node"                 │
         │     --ttl 24h                              │
         │  → Token: tlmcp_abc123...xyz               │
         │                                            │
         │                                            │  2. thinklocal join
         │                                            │     --token tlmcp_abc123...xyz
         │                                            │     --admin-url https://10.10.10.94:9440
         │                                            │
         │  ◄──── POST /onboarding/join ──────────────│
         │        Authorization: Bearer tlmcp_abc...  │
         │        Body: { csr, agent_id, hostname }   │
         │                                            │
         │  3. Token validieren:                      │
         │     - Existiert? Single-Use? TTL ok?       │
         │     - Token als "used" markieren           │
         │                                            │
         │  4. CSR signieren mit CA-Key               │
         │     → Node-Cert ausstellen                 │
         │                                            │
         │  ────── 200 OK ────────────────────────►   │
         │  Body: { signed_cert, ca_cert,             │  5. CA-Cert + Node-Cert speichern
         │          mesh_name, admin_agent_id }       │     → Ist jetzt im Mesh
         │                                            │
         └────────────────────────────────────────────┘
```

### CLI-Interface

```bash
# Auf dem Admin-Node:
thinklocal token create --name "influxdb-node" --ttl 24h
# Output: Token: tlmcp_JHd8kL2m9pQrStUvWxYz0123456789ABCDEF
#         Gueltig bis: 2026-04-13T00:07:00Z
#         Einmal verwendbar.

thinklocal token list
# Output:
# NAME             CREATED              EXPIRES              STATUS
# influxdb-node    2026-04-12 00:07     2026-04-13 00:07     active
# rpi-gateway      2026-04-11 14:30     2026-04-12 14:30     used

thinklocal token revoke influxdb-node
# Output: Token "influxdb-node" widerrufen.

# Auf dem neuen Node:
thinklocal join --token tlmcp_JHd8kL2m9pQrStUvWxYz0123456789ABCDEF \
                --admin-url https://10.10.10.94:9440
# Output: Verbunden mit Mesh "thinklocal" via Admin minimac-2.
#         CA-Zertifikat gespeichert.
#         Node-Zertifikat ausgestellt (gueltig 90 Tage).
```

### Token-Format

```
tlmcp_<32 Bytes base64url>
```

- Prefix `tlmcp_` zur Erkennung in Logs/Configs (analog `ghp_`, `sk-`)
- 32 Bytes Entropie (256 Bit) via `crypto.randomBytes(32)`
- Base64url-Encoding (kein Padding)

### Sicherheitsmodell

| Eigenschaft | Wert | Begruendung |
|---|---|---|
| Entropie | 256 Bit | Brute-Force unmoeglich (2^256 Moeglichkeiten) |
| Single-Use | Ja | Token wird nach erstem `join` als "used" markiert |
| TTL | Konfigurierbar (Default: 24h, Max: 7d) | Begrenzt Zeitfenster bei Kompromittierung |
| Revokation | Ja, explizit via `token revoke` | Admin kann Token vor Ablauf ungueltig machen |
| Speicherung | SHA-256 Hash in SQLite | Klartext wird nur bei Erstellung angezeigt |
| Transport | HTTPS (mTLS nicht moeglich, da neuer Node noch kein Cert hat) | TLS-Verschluesselung, aber kein Client-Cert |
| CA-Key | Bleibt auf Admin-Node | Neuer Node erhaelt nur ein signiertes Cert, nie den CA-Key |
| Audit | Jede Token-Operation wird geloggt | TOKEN_CREATE, TOKEN_VALIDATE, TOKEN_REVOKE Events |

### Trust-Level-Vergleich

| Methode | Trust-Level | Anwendungsfall |
|---|---|---|
| SPAKE2 PIN | Hoch (physischer Zugang beider Nodes) | Erste Verbindung, Multi-Owner-Meshes |
| Bearer Token | Mittel (Admin-Kontrolle, Single-Use) | Single-Owner-Mesh, headless Nodes |
| SSH Bootstrap | Niedrig (existiert als Skript) | Legacy, wird deprecated |

## Alternativen

### 1. PIN-Zeremonie bleibt als Fallback
Die bestehende SPAKE2-PIN-Zeremonie (`pairing-handler.ts`) bleibt unveraendert als primaere Pairing-Methode erhalten. Token-Onboarding ist eine Ergaenzung, kein Ersatz.

### 2. QR-Code-basiertes Pairing
Verworfen: Erfordert Kamera/Display auf beiden Nodes — headless-inkompatibel.

### 3. mDNS-Auto-Trust
Verworfen: Unsicher — jeder im LAN koennte einen Daemon starten und wuerde automatisch vertraut.

### 4. OAuth2 Device Authorization Grant
Verworfen: Zu komplex fuer ein lokales Mesh, erfordert externen Auth-Server.

## Implementation

### Phase 1 (dieser PR): Token-Store

Drei neue Module:

#### `token-store.ts` — SQLite-backed Token-Verwaltung

```typescript
interface OnboardingToken {
  id: string;           // UUID v4
  name: string;         // Human-readable Name ("influxdb-node")
  tokenHash: string;    // SHA-256 Hash des Tokens
  createdAt: string;    // ISO 8601
  expiresAt: string;    // ISO 8601
  usedAt: string | null;
  usedBy: string | null; // SPIFFE-URI des joinenden Nodes
  revokedAt: string | null;
  createdBy: string;    // SPIFFE-URI des Admin-Nodes
}
```

Operationen:
- `createToken(name, ttlMs, createdBy)` → `{ token, id, expiresAt }`
- `validateToken(rawToken)` → `{ valid: true, tokenId, name }` oder `{ valid: false, reason }`
- `markUsed(tokenId, usedBy)` — nach erfolgreichem Join
- `revokeToken(tokenId)` — explizite Revokation
- `listTokens()` — alle Tokens (ohne Klartext)
- `pruneExpired()` — abgelaufene Tokens bereinigen

### Phase 2 (Folge-PR): Token-API + CSR-Signing

- `POST /onboarding/join` Endpoint
- CSR-Erstellung auf dem neuen Node
- CSR-Signierung auf dem Admin-Node
- Cert-Delivery + Trust-Store-Integration

### Phase 3 (Folge-PR): CLI-Integration

- `thinklocal token create/list/revoke` Kommandos
- `thinklocal join --token --admin-url` Kommando
- Integration mit MCP-Proxy fuer `thinklocal_token_create` Tool

## Konsequenzen

**Positiv:**
- Headless Nodes koennen ohne physischen Zugang gepaart werden
- Admin behaelt volle Kontrolle (Token-Erstellung, Revokation, TTL)
- CA-Key verlaesst nie den Admin-Node
- Abwaertskompatibel — PIN-Zeremonie bleibt bestehen
- Audit-Trail fuer alle Token-Operationen

**Negativ:**
- Token muss sicher uebertragen werden (z.B. via SSH, nicht im Klartext per E-Mail)
- Neuer Node vertraut dem Admin-Node beim Join ohne vorherige Verifikation (TOFU)
- Zusaetzliche Angriffsflaeche: Ein gestohlener Token erlaubt einmaligen Mesh-Beitritt innerhalb des TTL-Fensters

**Mitigationen:**
- Single-Use + kurze TTL (Default 24h) begrenzen das Risiko
- Token-Hash statt Klartext in der DB
- Revokation vor Ablauf moeglich
- Audit-Log dokumentiert jeden Token-Lifecycle-Schritt
