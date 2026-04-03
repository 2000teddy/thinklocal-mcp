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

### Bekannte Risiken

1. **Prompt Injection Cascades** — Kompromittierter Agent koennte boesartige Prompts ueber Task-Delegation verbreiten. Mitigation: Human Approval Gates, Task-Content-Validierung, Sandboxing.

2. **Credential Exfiltration bei Root-Zugriff** — Wenn ein Angreifer Root auf einem Host erlangt, kann er Secrets aus dem Vault extrahieren. Dies ist eine explizite Sicherheitsgrenze.

3. **Skill Sprawl** — Unkontrollierte Skill-Verbreitung koennte die Angriffsflaeche vergroessern. Mitigation: Signaturpflicht, Policy Engine, Lifecycle Management.

### Bekannte Limitierungen (Stand v0.19)

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

### Durchgefuehrte Security-Reviews

| Datum | Reviewer | Fokus | Findings | Status |
|-------|----------|-------|----------|--------|
| 2026-04-03 | GPT-5.4 | Daemon-Grundgeruest | 3 HIGH, 3 MEDIUM | Alle gefixt |
| 2026-04-03 | Gemini 2.5 Pro | mTLS | 1 CRITICAL, 3 MEDIUM | Alle gefixt |
| 2026-04-03 | GPT-5.1 | Security Gesamt (Phase 1) | 1 HIGH, 2 MEDIUM | Alle gefixt |
| 2026-04-03 | GPT-5.4 | Vault, SPAKE2, Skills, MCP, WS | 2 CRITICAL, 4 HIGH, 6 MEDIUM | Kritische gefixt |

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
