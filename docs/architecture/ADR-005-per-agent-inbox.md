# ADR-005: Per-Agent-Inbox (statt Per-Daemon)

**Status:** Accepted, Phase 1 Implemented (2026-04-09)
**Datum:** 2026-04-08
**Autor:** Claude Code (basierend auf Christians Peer-vs-Agent-Klarstellung)
**Verwandt:** ADR-004 (Cron-Heartbeat), PR #79 (Messaging), PR #80 (Loopback), PR #83 (Loopback-Spoofing-Finding)

## Kontext

PR #79 hat eine Inbox pro Daemon eingefuehrt. PR #80 den Loopback-Pfad. PR #83 hat das Loopback-Spoofing-Finding durch requireLocal() mitigated. Aber eine strukturelle Annahme ist falsch:

**Aktuell:** Ein Daemon hat **eine** Inbox. Alle Agenten die denselben Daemon teilen (z.B. Claude Code + Codex auf dem MacMini) sehen **dieselben** Nachrichten.

**Korrekt waere:** Ein Daemon hostet mehrere Agent-Instances. Jede hat ihre eigene logische Inbox. Nachrichten werden nach `to_agent_instance` zugestellt.

### Christians Peer-vs-Agent-Klarstellung (verbatim)

> "nicht Peer (weil es für jeden Peer = IPv4 oder irgendwann auch IPv6 , soweit ich das verstanden habe auch mehrere aktive Agenten geben kann). Peer ist nur das Zuhause eines Agenten und das ThinkLocal die Stadt / Dorf / Gemeinde. Und ThinkWide und ThinkBig in Verbindung mit ThinkHub sind der Kosmos."

Die Mental-Hierarchie ist damit:

```
Kosmos:     ThinkBig
  ↓         (ThinkLocal + ThinkWide + ThinkHub kombiniert)
Stadt:      ThinkLocal (ein LAN)
  ↓         ("Dorf" von Peers die sich kennen)
Haus:       Peer (ein Host, IP-adressiert, ein Daemon)
  ↓         (kann mehrere Bewohner haben)
Bewohner:   Agent-Instance (Claude, Codex, Gemini, ein laufender CLI-Prozess)
```

Die aktuelle SPIFFE-URI Struktur:
```
spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>
```

Fehlt die **Instance** Komponente. Zwei Claude-Code-Fenster auf demselben Host haben dieselbe SPIFFE-URI.

## Entscheidung

**Wir erweitern die SPIFFE-URI um eine Instance-Komponente und die Inbox um einen `to_agent_instance` Filter:**

### Neue SPIFFE-URI Struktur

```
spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>/instance/<instanceId>
```

**Beispiele:**
- `spiffe://thinklocal/host/69bc0bc908229c9f/agent/claude-code/instance/a1b2c3`
- `spiffe://thinklocal/host/69bc0bc908229c9f/agent/codex/instance/f7e8d9`
- `spiffe://thinklocal/host/68f7cd8e330acfe3/agent/claude-code/instance/` (Daemon-Inbox, keine Instance — Catch-all fuer non-agent Nachrichten)

**Rueckwaerts-Kompatibel:**
Alte 3-Komponenten-URIs (ohne Instance) bleiben gueltig und landen im "Daemon-Catch-All-Inbox". Fuer den Uebergang ist das ausreichend.

### Neue Inbox-Spalte

```sql
ALTER TABLE messages ADD COLUMN to_agent_instance TEXT;
-- NULL bedeutet "an irgendeinen Agent auf dem Daemon" (legacy)
-- Nicht-NULL bedeutet "nur an diese Instance"

CREATE INDEX idx_messages_instance ON messages (to_agent_instance);
```

### InstanceId Generierung

Jeder CLI-Start generiert eine eigene `instanceId`:
- **Persistent ueber Turns einer Session**, aber **neu bei jedem CLI-Restart**
- Format: 6-Hex-Char Random (kurz genug fuer manuelle Referenz, lang genug fuer Collision-Avoidance im kleinen Rahmen)
- Wird bei `POST /api/agent/register` (siehe ADR-004 Phase 2) dem Daemon mitgeteilt
- Wird im `read_inbox` Filter automatisch gesetzt

### Registrierungs-Endpoint (aus ADR-004)

```
POST /api/agent/register
Body: {
  agent_type: "claude-code",
  instance_id: "a1b2c3",   // client-generated
  pid: 12345,              // optional, fuer debugging
  cli_version: "0.x.y"     // optional
}
Response: {
  instance_spiffe_uri: "spiffe://thinklocal/host/<stable>/agent/claude-code/instance/a1b2c3",
  heartbeat_interval_ms: 5000,
  inbox_schema_version: 2
}
```

**Beim CLI-Shutdown:** Agent ruft `POST /api/agent/unregister` oder der Daemon markiert die Instance nach `3 * heartbeat_interval_ms` ohne Heartbeat als offline.

### MCP-Tool-Anpassungen

- `read_inbox` filtert **automatisch** nach registrierter Instance, ausser `include_all_instances: true` explizit gesetzt
- `send_message_to_peer` kann `to` als 3- oder 4-Komponenten-SPIFFE akzeptieren
- `unread_messages_count` zeigt nur Nachrichten fuer die eigene Instance

### Broadcast-Messages (Phase 2)

Ein Agent kann gezielt an "alle Instances auf einem bestimmten Host" schicken:
```
to: "spiffe://thinklocal/host/<stableId>/agent/*/instance/*"
```

Der Daemon fanout't die Nachricht auf alle aktiven Instances. Nuetzlich fuer:
- System-Announcements ("neuer Skill deployed, bitte aktualisieren")
- Compliance-Reminders ("COMPLIANCE-TABLE.md hat 2 offene Eintraege")
- Notfall-Broadcasts

## Alternativen die verworfen wurden

### A) Per-Daemon-Inbox behalten, Agenten filtern client-side
Funktioniert nicht — Codex koennte Claudes Nachrichten lesen (Privacy), und der Daemon wuesste nicht welche Instance welche Nachricht verarbeitet hat (Accounting).

### B) InstanceId als separates Feld im Protokoll (nicht in SPIFFE-URI)
Inkonsistent — SPIFFE ist sonst die einzige Identitaet. Verworfen.

### C) Per-Process-Daemon (jeder Agent bekommt seinen eigenen Daemon)
Zu teuer — Ports, Certs, Keypairs, Trust-Store pro Prozess. Nicht skalierbar. Verworfen.

### D) Instance-ID als Teil der Cert-SAN statt SPIFFE-URI
Ueberschneidet sich mit dem Zweck der SPIFFE-URI. Verworfen.

## Migration

### Schema-Migration via user_version (siehe PR #83 Folge-Task Schema-Migration)

```
v1 → v2: ALTER TABLE messages ADD COLUMN to_agent_instance TEXT
         CREATE INDEX idx_messages_instance
         Existing rows: to_agent_instance = NULL (legacy)
```

### Runtime-Migration

Bestehende Nachrichten mit `to_agent_instance IS NULL` werden als "an den Daemon" interpretiert und landen in **allen** Instance-Inboxes. Das ist bewusst permissive fuer den Uebergang. Nach 30 Tagen (oder per Config) wird der NULL-Fallback deaktiviert und solche Nachrichten werden rejectet.

### SPIFFE-URI Migration

Alte 3-Komponenten-URIs werden vom Daemon akzeptiert und mit einer Dummy-Instance-ID `legacy` zugeordnet. Der Daemon loggt eine Warnung. Nach einem Release-Cycle koennte das deprecated werden.

## Konsequenzen

### Positiv
- **Echte Privacy zwischen Agenten** auf demselben Daemon
- **Accountability:** Nachrichten haben einen eindeutigen Empfaenger
- **Broadcast-Pattern** moeglich (Phase 2)
- **Saubere Mental-Model** entspricht Christians Hierarchie (Peer ≠ Agent)

### Negativ
- **Breaking Change fuer SPIFFE-URIs** — Mitigation: Rueckwaerts-kompatibel waehrend Migration-Phase
- **Zusaetzliche Komplexitaet** im mcp-stdio.ts (Registrierung, Heartbeat, Filter)
- **InstanceId-Collision** bei sehr vielen Agents pro Host — Mitigation: bei Collision neu wuerfeln
- **Existing Nachrichten** werden via NULL-Fallback allen sichtbar waehrend Migration

## Referenzen

- **Christians Peer-vs-Agent-Klarstellung (2026-04-08 20:57)**
- **ADR-004:** Cron-Heartbeat
- **PR #79, #80, #83:** Messaging + Loopback + Security-Fixes
- **SPIFFE-Spec:** [spiffe.io](https://spiffe.io/) — die SPIFFE-URI ist flexibel genug fuer beliebig tiefe Pfade

## Status

**Accepted (mit wichtigen Anpassungen aus Konsensus 2026-04-08)**

### Konsensus-Ergebnis (pal:consensus am 2026-04-08 21:30)

**GPT-5.4 (8/10)** und **Gemini Pro (9/10)** endorsen das Grundkonzept, sind sich aber **in einem wichtigen Punkt uneinig**: Soll der Instance-Teil in die SPIFFE-URI oder in ein separates logisches Routing-Feld?

- **GPT-5.4:** Separieren! SPIFFE bleibt daemon-scoped. Instance ist ein eigenes logisches Adressierungsfeld, damit Cert-Attestation nicht mit Routing-Semantik vermischt wird.
- **Gemini Pro:** SPIFFE extendieren ist der sauberste Weg, SPIFFE ist genau dafuer designed, halt es konsolidiert.

### Aufloesung des Konflikts

**Beide haben recht in ihrer Domaene.** GPT-5.4 sorgt sich um **cryptographische Semantik** (das Cert attestiert nur Daemon-Identitaet, Instance ist nicht vom Cert abgedeckt). Gemini sorgt sich um **architektonische Sauberkeit** (nicht zwei Identity-Systeme nebeneinander).

**Pragmatische Loesung:** Wir behalten die SPIFFE-URI-Extension wie vorgeschlagen, **dokumentieren aber explizit** dass der Instance-Teil **logisches Routing** ist, nicht vom Cert attestiert:

```
spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>/instance/<instanceId>
                                                         ^^^^^^^^^^^^^^^^^^^^^^
                                                         Dieser Teil ist NICHT
                                                         im Cert-SAN und wird
                                                         NICHT cryptographisch
                                                         verifiziert. Er ist
                                                         reines Application-
                                                         Layer-Routing.
```

**Konsequenzen fuer Cert-Validation und TrustStore:**
- `extractSpiffeUri(cert)` liefert weiterhin nur die 3-Komponenten-URI aus dem Cert-SAN
- `buildTrustedCaBundle` arbeitet weiterhin auf Daemon-Ebene (Peer-CAs)
- Neu: `normalizeAgentId(uri)` strippt optionalen Instance-Teil fuer Cert-/Trust-Checks
- Neu: `getAgentInstance(uri)` extrahiert den Instance-Teil fuer Routing

### Weitere angenommene Anpassungen

1. **Transport-Normalisierung VOR Loopback/mesh.getPeer() Check** — GPT-5.4 Gotcha: aktuelle Checks sind exact-string, 4-Komponenten-URIs wuerden brechen. Fix: `normalizeAgentId(body.to)` bevor der Check laeuft.

2. **NULL-Fallback strikter** — beide Reviewer warnen davor, legacy messages "an alle Instances sichtbar" zu machen. **Entscheidung:**
   - Neue Nachrichten MUESSEN nach Schema-Upgrade eine `to_agent_instance` haben (NOT NULL Constraint fuer v2)
   - Legacy-Rows (NULL) sind **nur** ueber einen expliziten `include_legacy: true` Parameter im `read_inbox` Call sichtbar
   - Default: legacy rows werden **gefiltert** aus normalen read_inbox responses
   - Nach 30 Tagen: legacy rows werden archiviert (archived=1)

3. **InstanceId auf UUIDv4 geaendert** — Gemini's Vorschlag, GPT-5.4 einig. Geaendert von 6-hex-char auf UUIDv4 (`randomUUID()` aus node:crypto). Kein Collision-Risiko mehr, minimaler Readability-Verlust in Logs (kann mit `.slice(0, 8)` im Display abgekuerzt werden).

4. **Daemon rejectet Collisions** — selbst mit UUIDv4 als Belt-and-Suspenders: `POST /api/agent/register` prueft ob die instanceId schon aktiv ist und forciert Re-Roll wenn ja.

### Phase 1 Implementation (2026-04-09, PR #91)

- ✅ `packages/daemon/src/spiffe-uri.ts` — `parseSpiffeUri`, `normalizeAgentId`, `getAgentInstance`, `buildInstanceUri`, `hasInstance` helpers. Strikte Validation, akzeptiert 3- und 4-Komponenten-URIs. 18 Unit-Tests.
- ✅ `packages/daemon/src/agent-inbox.ts` — **Schema-Migration v1 → v2** via `PRAGMA user_version`. Neue Spalte `to_agent_instance TEXT NULL` + `idx_messages_instance`. Idempotent (Fresh-DB und Re-Open laufen beide sauber). Legacy-Rows (NULL) bleiben erhalten. `store()` normalisiert `to` automatisch, extrahiert die Instance-ID, persistiert beides. `list()` und `unreadCount()` akzeptieren `forInstance` + `includeLegacy` Parameter. `unreadCount()` ist backwards-kompatibel (String-Argument wird als `fromAgent` interpretiert). 12 neue ADR-005-Tests (insgesamt 26 Inbox-Tests).
- ✅ `packages/daemon/src/inbox-api.ts` — **Loopback-Fix:** Vergleich jetzt mit `normalizeAgentId(body.to) === ownAgentId` (GPT-5.4 Gotcha aus Konsensus 2026-04-08). **Peer-Lookup** nutzt ebenfalls die normalisierte 3-Komponenten-URI. **Store-Pfad:** `to_agent_instance` wird aus dem 4-Komponenten-Target extrahiert und mit der Nachricht persistiert. **Neue Query-Parameter:** `for_instance` + `include_legacy` in `GET /api/inbox` und `GET /api/inbox/unread`. Strict Regex-Validation `[A-Za-z0-9._-]+` fuer `for_instance` (SQL-Injection-Defense). Response enthaelt neuen `to_instance` Key pro Nachricht. 8 neue Fastify-Inject-Tests.
- ✅ ADR-005 Status: `Proposed → Accepted, Phase 1 Implemented`.

### Noch offen fuer Phase 2

- **Auto-Filter bei registrierten Agents:** wenn ein Agent via ADR-004 `POST /api/agent/register` registriert ist, soll `read_inbox` ohne explizites `for_instance` automatisch auf seine Instance filtern (aktuell muss der Client den Parameter selbst setzen). Dafuer braucht es Identifikation des Callers ueber ein registriertes Session-Token oder caller-bound Header.
- **Broadcast-Pattern** (`/instance/*`) fuer Systemnachrichten an alle Instances auf einem Host.
- **NULL-Fallback-Deprecation nach 30 Tagen** via Retention-Job (aktuell ueber `includeLegacy` opt-in).
- **SECURITY.md Update** — ist in dieser PR enthalten (Instance-Teil = Application-Layer-Routing, nicht cryptographisch attestiert).
