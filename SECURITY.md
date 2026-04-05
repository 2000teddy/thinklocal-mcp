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
