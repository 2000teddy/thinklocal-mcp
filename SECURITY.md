# SECURITY.md — thinklocal-mcp

## Sicherheitsrichtlinie

### Unterstützte Versionen

| Version | Unterstützt |
|---------|------------|
| > 0.1.0 | ✅ Aktiv |
| < 0.1.0 | ❌ Pre-Release, nicht produktionsreif |

### Schwachstellen melden

Sicherheitslücken bitte **NICHT** als öffentliche Issues melden.

Stattdessen: per verschlüsselter E-Mail an den Projektinhaber.
Details werden nach Behebung in den CHANGES.md veröffentlicht.

## Bedrohungsmodell

### Was wir schützen
1. **Agent-zu-Agent-Kommunikation** — Abhörsicher, manipulationssicher
2. **Credentials** — Verschlüsselt at-rest und in-transit, nie im Klartext
3. **Skill-Integrität** — Nur signierte, verifizierte Skills werden ausgeführt
4. **Audit-Trail** — Unveränderlich, signiert, Merkle-Tree-geschützt

### Sicherheitsgrenzen (explizit)

| Schutz | Status |
|--------|--------|
| Netzwerk-Observer (Sniffing) | ✅ Geschützt (mTLS + Noise) |
| Unautorisierte Peers | ✅ Geschützt (Zertifikate + PIN-Bootstrap) |
| Manipulierte Nachrichten | ✅ Geschützt (ed25519 Signaturen) |
| Veraltete/gefälschte Skills | ✅ Geschützt (signierte Pakete + WASM-Sandbox) |
| Root-Kompromittierung eines Endpoints | ❌ **NICHT geschützt** |
| Side-Channel-Angriffe (Timing etc.) | ❌ Nicht im Scope |
| Physischer Zugriff auf Gerät | ❌ Nicht im Scope |

### Aktueller Runtime-Default

Der Standard-Installer und `thinklocal bootstrap` richten derzeit absichtlich einen lokalen Betriebsmodus ein:

- Runtime-Modus: `local`
- Bind-Adresse: `127.0.0.1`
- Transport: HTTP ohne TLS
- Ziel: lokale Nutzung durch Dashboard, CLI und MCP-Bridge ohne Netzfreigabe

Das ist kein Widerspruch zur langfristigen Zero-Trust-Architektur, aber eine wichtige Betriebsrealitaet:

- **lokaler Default**: `local`, localhost-only, einfacher, nicht fuer LAN-Exposure gedacht
- **netzwerkexponierter Betrieb**: `lan`, nur mit TLS/mTLS und passender Vertrauensverteilung

### Bekannte Risiken

1. **Prompt Injection Cascades** — Kompromittierter Agent koennte boesartige Prompts ueber Task-Delegation verbreiten. Mitigation: Human Approval Gates, Task-Content-Validierung, Sandboxing.

2. **Credential Exfiltration bei Root-Zugriff** — Wenn ein Angreifer Root auf einem Host erlangt, kann er Secrets aus dem Vault extrahieren. Dies ist eine explizite Sicherheitsgrenze.

3. **Skill Sprawl** — Unkontrollierte Skill-Verbreitung koennte die Angriffsflaeche vergroessern. Mitigation: Signaturpflicht, Policy Engine, Lifecycle Management.

### Detaillierte Bedrohungsanalyse

#### 1. Root-Compromise-Limitation (NICHT im Scope)

Das Mesh schuetzt gegen Netzwerk-Observer und unautorisierte Peers, aber
**NICHT** gegen Root-Kompromittierung eines Endpoints. Bei Root-Zugriff kann ein
Angreifer:

- Private Keys aus `~/.thinklocal/keys/` extrahieren
- Vault-Master-Key aus dem Prozess-Speicher lesen
- Agent-Identitaet uebernehmen (SPIFFE-URI faelschen)
- Audit-Log lokal manipulieren (trotz Hash-Chain — kein Remote-Witness)

**Warum kein Schutz?** Hardware-Enclaves (SGX/Secure Enclave) waeren noetig,
erhoeht die Komplexitaet erheblich und ist fuer das LAN-Szenario
unverhältnismäßig. Stattdessen: Hosts absichern (Firewall, Updates, Monitoring).

**Empfehlung:** Kritische Credentials in separatem Hardware-Security-Module (HSM)
oder Vault-Dienst speichern, nicht nur im lokalen thinklocal-Vault.

#### 2. Bootstrap-Trust-Problem

Das gesamte Sicherheitsmodell basiert auf korrekter initialer Peer-Authentifizierung.
Schwachpunkte:

- **SPAKE2 PIN ist 6 Ziffern** — 1M Kombinationen, aber Rate-Limited (3 Versuche/Session)
- **Erster Kontakt ueber mDNS** — mDNS ist nicht authentifiziert, ein Angreifer im LAN
  koennte einen falschen Service ankuendigen
- **Ohne Pairing**: Daemon akzeptiert alle Peers die eine gueltige Agent Card haben

**Mitigationen (implementiert):**
- SPAKE2 mit 3-Versuch-Lockout pro Session
- PIN wird nie im Netzwerk uebertragen (nur SPAKE2 Messages)
- Agent Card Fingerprint wird gegen Pairing-Store geprueft
- Pairing-Daten persistent und einmalig (kein Re-Pairing noetig)

**Mitigationen (geplant):**
- Certificate Pinning nach erstem Kontakt (TOFU)
- Manuelle Fingerprint-Verifikation (`thinklocal verify <peer>`)
- QR-Code als PIN-Alternative (groesserer Schluesselraum)

#### 3. Prompt Injection Cascades

Wenn ein Agent kompromittiert wird, koennte er ueber Task-Delegation boesartige
Prompts an andere Agents weiterleiten. Szenarien:

- **Agent A sendet TASK_REQUEST** mit manipuliertem Payload an Agent B
- **Agent B fuehrt den Task aus** und der Prompt enthaelt Anweisungen die
  Agent B dazu bringen, Credentials preiszugeben oder weitere Tasks zu senden
- **Kettenreaktion**: A → B → C → D, jeder Agent fuehrt manipulierte Tasks aus

**Mitigationen (implementiert):**
- Human Approval Gates fuer Credential-Zugriff
- Signierte Nachrichten (Absender nachweisbar)
- Audit-Log zeichnet alle Task-Requests auf

**Mitigationen (geplant):**
- Task-Content-Validierung (Schema + Laengenbegrenzung)
- WASM/Docker Sandbox fuer Skill-Ausfuehrung
- Policy Engine (OPA/Rego) fuer Task-Autorisierung
- Capability-basierte Zugriffskontrolle (Agent darf nur Skills nutzen die er hat)
- Rate-Limiting pro Agent fuer Task-Delegation

### Identitaet, Trust-Store und CA-Subject (v0.31)

#### Stable Node Identity (PR #74)

ThinkLocal-Nodes hatten urspruenglich eine SPIFFE-URI im Format
`spiffe://thinklocal/host/<hostname>/agent/<type>` — direkt aus `os.hostname()`
abgeleitet. Auf macOS aendert Bonjour den Hostname dynamisch wenn es zu
Kollisionen kommt (`minimac-200` → `-795` → `-1014` → ...). Das machte die
SPIFFE-URI **instabil**: jeder Reboot konnte zu einer neuen Identitaet fuehren,
mTLS-Certs wurden mit veraltetem SAN ausgestellt, und Peers behandelten
denselben Node bei jedem Sichten als neuen Fremden.

**Fix:** `loadOrCreateStableNodeId()` berechnet eine 16-hex Identitaet aus
sortierten MAC-Adressen + CPU-Modell + Plattform/Architektur (bewusst OHNE
Hostname). Persistiert in `~/.thinklocal/keys/node-id.txt`. Datei darf vom
Operator manuell ueberschrieben werden, bei Hardware-Wechsel mit gleicher
logischer Identitaet. Die SPIFFE-URI ist jetzt `host/<stableNodeId>/agent/<type>`.

#### CA Subject DN Collision (PR #77, security-critical)

**Bug:** Jede Node generierte ihre Mesh-CA mit dem **identischen** Subject DN
`CN=thinklocal Mesh CA, O=thinklocal-mcp`. Das ist ein klassischer
internal-PKI-Footgun. Wenn der Trust-Store mehrere CAs mit gleichem Subject
enthielt (eigene CA + gepairte Peer-CAs aus dem TrustStore von PR #75),
machte OpenSSL/Node.js bei der Cert-Verifikation einen Issuer-Name-Lookup
und nahm die **erste** matching CA — nicht die mit dem richtigen Public-Key.
Mit kollidierenden Subjects ist das effektiv zufaellig und scheitert
fast immer mit `certificate signature failure`.

PR #75 (TrustStore-Aggregation) war damit zwar **strukturell korrekt** aber
funktional **wirkungslos**, bis dieser Fix kam. Live-Beobachtung im 4-Node-Mesh:
`certificate signature failure` zwischen allen Peers — bis die unique-CN
ausgerollt war.

**Fix:**
1. `createMeshCA(meshName, nodeId)` baut die nodeId in den CN ein:
   `CN=thinklocal Mesh CA <nodeId>`. Ohne nodeId: 16-hex Random-Suffix.
2. `loadOrCreateTlsBundle()` detektiert Legacy-CAs (`CN === "thinklocal Mesh CA"`),
   sichert sie als `*.legacy.pem`, reissued CA + Node-Cert (Node-Cert MUSS neu,
   weil die alte Signatur nicht mehr zur neuen CA passt).
3. `index.ts` reicht `identity.stableNodeId` durch.

**Folge-Findings (GPT-5.4 retroaktiv 2026-04-08, alle in PR #103 adressiert):**
- HIGH: Reuse-Pfad ohne Signatur-Verifikation gegen aktuelle CA → ein
  partial-migration-crash konnte ein Cert hinterlassen das nicht mehr von der
  aktuellen CA signiert war aber zufaellig die SPIFFE-URI matchte. Jetzt:
  try/catch + `caCert.verify(cert)` Check.
- MEDIUM: Keine CA-Validity-Window-Pruefung beim Laden. Jetzt: `notBefore <=
  now <= notAfter` Check, sonst reissue.
- LOW: `getCertDaysLeft()` Pfad-Bug (`certs/node.crt` statt `tls/node.crt.pem`),
  Startup-Warnings fuer ablaufende Certs feuerten nie.

**Verbleibende Limitierungen (Folge-PR):**
- File-writes der CA-Migration sind nicht atomar (kein temp+rename, kein lock).
  Risiko bei Daemon-Crash mid-migration: Partial-State auf Disk. Praktisch
  unwahrscheinlich, aber Defense-in-Depth-Issue.
- Trust-Store collision detection: Wenn ein Node mehrere not-yet-migrated
  Peer-CAs im Bundle haelt (mixed-version Rollout), kann das urspruengliche
  Issuer-Lookup-Problem reappearen. Loud warning + Fail-on-collision empfohlen.
- Legacy-Detektion catched nur exact `CN === "thinklocal Mesh CA"` — custom
  meshNames slip through.

#### SSH-Bootstrap-Trust (PR #78)

Alternative zur manuellen SPAKE2 PIN-Zeremonie fuer den Single-Operator-Fall:
Wenn der Operator bereits SSH-Zugriff zwischen seinen eigenen Nodes hat,
nutzt das Script den existierenden SSH-Trust-Anchor um CAs gegenseitig in
die `paired-peers.json` zu schreiben. Erweitert das Trust-Modell um "wer
SSH-Root auf allen Nodes hat, darf Mesh-Trust setzen" — bewusste
Vereinfachung fuer Single-Operator. **Ersetzt nicht SPAKE2** — fremde Nodes
muessen weiterhin die PIN-Zeremonie durchlaufen.

#### Agent-to-Agent Messaging Inbox (PR #79/80)

Persistente Inbox pro Daemon (`~/.thinklocal/inbox/inbox.db`, SQLite WAL),
64 KB Body-Limit, Dedupe via UUID. Eingehende `AGENT_MESSAGE` werden vom
existierenden agent-card.ts Signaturpfad verifiziert (Sender hat valides
Cert von einer der vertrauten CAs) und dann gestored. Sender-Authorization
ist aktuell "any paired peer can send" — per-Peer ACL ist Phase 2.

**Loopback** (PR #80): Wenn `to === ownAgentId`, wird die Nachricht direkt
im lokalen Inbox abgelegt statt ueber Netzwerk geroutet. Erlaubt mehreren
Agenten (Claude Code, Codex) sich denselben Daemon zu teilen.

### SPIFFE-URI 4-Komponenten-Form ist Application-Layer-Routing (ADR-005, 2026-04-09)

ADR-005 (Per-Agent-Inbox) fuehrt eine erweiterte SPIFFE-URI-Shape ein:

```
spiffe://thinklocal/host/<stableNodeId>/agent/<agentType>/instance/<instanceId>
                                                         ^^^^^^^^^^^^^^^^^^^^^^
                                                         application-layer routing
                                                         NICHT cert-attested
```

**Sicherheits-Eigenschaften:**

- **Nur die 3-Komponenten-Form ist im TLS-Cert-SAN enthalten.** Der `/instance/<id>`-Teil wird **nicht** cryptographisch verifiziert — er ist ein logischer Routing-Key fuer die Per-Agent-Inbox und den Cron-Heartbeat.
- **Cert-Validation, Peer-Lookup und Gossip** vergleichen Identitaeten ausschliesslich auf der 3-Komponenten-Form. Code, der diese Trust-Entscheidungen faellt, **MUSS** `normalizeAgentId(uri)` aus `packages/daemon/src/spiffe-uri.ts` benutzen, um den Instance-Tail vor dem Vergleich zu strippen.
- **Ein feindlicher lokaler Agent** mit Zugriff auf den Daemon-Loopback-Port koennte eine Instance-ID faelschen und Nachrichten fuer eine andere Instance abrufen. Die `requireLocal()`-Gate (PR #83) verhindert Remote-Angriffe; eine kompromittierte lokale CLI bleibt aber vertrauenswuerdig per Definition. Wer das LAN-Zugriff hat, muss das `agent-api` `/api/agent/*` ebenfalls nur ueber die gleiche Loopback-Gate zugaenglich halten.
- **`for_instance` Query-Parameter** werden gegen ein striktes Regex (`[A-Za-z0-9._-]+`) validiert, bevor sie den Prepared-Statement-Placeholder in SQLite erreichen. Das schuetzt gegen SQL-Injection-Versuche ueber den REST-Pfad.
- **Legacy-Rows** (pre-Migration oder 3-Komponenten-Ziel) sind per Default unsichtbar, wenn ein `for_instance` gesetzt ist. Ein Aufrufer muss `include_legacy=true` explizit setzen, um sie zu sehen. Nach 30 Tagen werden sie per Retention-Job archiviert (offener Follow-up).

**Konsensus-Grundlage:** GPT-5.4 und Gemini 2.5 Pro am 2026-04-08 21:30 — "pragmatische Aufloesung": SPIFFE-URI-Extension fuer logisches Routing, 3-Komponenten-Form bleibt cryptographisch attestiert.

### Bekannte Limitierungen (Stand v0.24)

> Diese Items sind dokumentiert und werden in zukuenftigen Releases adressiert.

| Limitierung | Risiko | Geplante Mitigation |
|------------|--------|---------------------|
| REST-API + WebSocket ohne Authentifizierung | Jeder im LAN kann Mesh-Status lesen | JWT/Session-Auth aus Pairing-Zeremonie |
| Dashboard Vault-CRUD ohne Autorisierung | Jeder kann Credentials speichern/loeschen | Role-based Access Control |
| MCP-Tools ohne Auth | stdio-Zugriff = voller Mesh-Zugriff | Nur lokaler Prozess, kein Netzwerk-Exposure |
| Task-Delegation ohne Autorisierung | Jeder kann Tasks erstellen | Task-Policy + Capability-Matching |
| SPAKE2 Key-Derivation mit SHA-256 statt HKDF | Schwaecher als RFC 5869 | HKDF-SHA256 mit Salt |
| Tasks nur in-memory | Gehen bei Daemon-Restart verloren | SQLite-Persistenz |
| Keine Skill-Sandbox | Code laeuft im Daemon-Prozess | WASM/Docker Sandbox |

Hinweis zum ersten Punkt: Im Standard-Installationspfad reduziert `127.0.0.1` die Angriffsoberflaeche erheblich. Das Risiko gilt weiterhin fuer bewusst netzwerkexponierte Daemon-Instanzen.

### Durchgefuehrte Security-Reviews

| Datum | Reviewer | Fokus | Findings | Status |
|-------|----------|-------|----------|--------|
| 2026-04-03 | GPT-5.4 | Daemon-Grundgeruest | 3 HIGH, 3 MEDIUM | Alle gefixt |
| 2026-04-03 | Gemini 2.5 Pro | mTLS | 1 CRITICAL, 3 MEDIUM | Alle gefixt |
| 2026-04-03 | GPT-5.1 | Security Gesamt (Phase 1) | 1 HIGH, 2 MEDIUM | Alle gefixt |
| 2026-04-03 | GPT-5.4 | Vault, SPAKE2, Skills, MCP, WS | 2 CRITICAL, 4 HIGH, 6 MEDIUM | Kritische gefixt |
| 2026-04-05 | GPT-5.1 | Telegram Gateway Hardening | 4 MEDIUM, 5 LOW | Alle gefixt |
| 2026-04-05 | Gemini 2.5 Pro | Static Peers, chatId, Gossip | 1 MEDIUM, 2 LOW | Alle gefixt |
| 2026-04-05 | Gemini 2.5 Pro | Deploy Command | 0 HIGH, 2 LOW | Alle gefixt |
| 2026-04-06 | GPT-5.4 | **Batch-Review v0.30.0 (41 Dateien)** | **18 HIGH, 27 MEDIUM, 13 LOW (58 total)** | **13 HIGH gefixt #94, alle MEDIUM/LOW dokumentiert** |
| 2026-04-08 | GPT-5.4 | **PR #77 retroaktiv: CA Subject DN Collision Fix** | **1 HIGH, 3 MEDIUM, 2 LOW** | **HIGH + 2 MEDIUM gefixt #103, Rest dokumentiert** |

### Kryptografische Primitiven

| Zweck | Algorithmus | Bibliothek |
|-------|-----------|------------|
| Agent-Identität | ECDSA (secp256k1 / P-256) | Node.js crypto / libsodium |
| Nachrichten-Signatur | Ed25519 | libsodium |
| Transport-Verschlüsselung | Noise Protocol / TLS 1.3 | libp2p |
| Credential-Verschlüsselung | X25519 + XSalsa20-Poly1305 (Sealed Boxes) | libsodium |
| Secret Sharing | Shamir's Secret Sharing | shamir npm/pypi |
| Trust Bootstrap | SPAKE2 | spake2 npm/pypi |
| Audit-Integrität | SHA-256 Merkle Tree | custom |
| Lokale Datenbank | AES-256-CBC (SQLCipher) | better-sqlite3 + sqlcipher |
