# thinklocal-mcp Threat Model

Sicherheitsdesign-Dokument fuer das Mesh-Netzwerk.

---

## 1. Assets (Was schuetzen wir?)

| Asset | Kritikalitaet | Beschreibung |
|-------|--------------|-------------|
| Agent Private Keys | KRITISCH | Identitaet eines Nodes |
| Vault Master Key | KRITISCH | Entschluesselt alle Credentials |
| Credentials (Tokens, Passwords) | HOCH | GitHub, Telegram, InfluxDB etc. |
| Audit-Log | HOCH | Integritaetsnachweis |
| Task-Payloads | MITTEL | Koennen sensitive Daten enthalten |
| Agent Cards | NIEDRIG | Oeffentliche Metadaten |
| Health-Metriken | NIEDRIG | CPU/RAM/Disk |

---

## 2. Angreifer-Profile

### A1: Passiver Netzwerk-Observer
- **Faehigkeit**: Kann Traffic mitlesen (z.B. ARP-Spoofing, WLAN-Sniffing)
- **Mitigation**: mTLS verschluesselt allen Traffic
- **Status**: ✅ Geschuetzt

### A2: Aktiver LAN-Angreifer
- **Faehigkeit**: Kann Pakete injizieren, mDNS spoofing
- **Mitigation**: ECDSA-Signaturen, SPAKE2 Pairing, Replay-Guard
- **Status**: ✅ Geschuetzt (nach Pairing)

### A3: Kompromittierter Agent
- **Faehigkeit**: Kontrolliert einen Node im Mesh
- **Mitigation**: Policy Engine, Approval Gates, signierte Nachrichten, Audit
- **Status**: ⚠️ Teilweise geschuetzt (Prompt Injection Risiko)

### A4: Root-Zugriff auf Host
- **Faehigkeit**: Voller Zugriff auf Dateisystem und Speicher
- **Mitigation**: KEINE — explizit Out-of-Scope
- **Status**: ❌ Nicht geschuetzt

---

## 3. Angriffsvektoren und Mitigationen

### 3.1 Netzwerk

| Vektor | Angriff | Mitigation | Status |
|--------|---------|-----------|--------|
| Sniffing | Traffic mitlesen | mTLS (TLS 1.3) | ✅ |
| MITM | Nachrichten manipulieren | ECDSA-Signaturen + Cert-Pinning | ✅ |
| Replay | Alte Nachrichten wiederholen | TTL + Idempotency-Key + Replay-Guard | ✅ |
| Flooding | DoS durch Massennachrichten | Token-Bucket Rate-Limiting pro Peer | ✅ |
| mDNS Spoofing | Falschen Service ankuendigen | Agent Card Fingerprint-Verifikation | ⚠️ |

### 3.2 Authentifizierung

| Vektor | Angriff | Mitigation | Status |
|--------|---------|-----------|--------|
| PIN Brute-Force | SPAKE2 PIN erraten | 3-Versuch-Lockout pro Session | ✅ |
| Token-Theft | JWT stehlen | Localhost-only Generation, 24h TTL, Keychain | ✅ |
| Cert-Forgery | Falsches Zertifikat | CA-Signatur-Pruefung | ✅ |

### 3.3 Daten

| Vektor | Angriff | Mitigation | Status |
|--------|---------|-----------|--------|
| Vault-Theft | Verschluesselte DB stehlen | AES-256-GCM + PBKDF2 (100k Iter) | ✅ |
| Credential-Leak | Secret via Task-Response | Brokered Access (Proxy statt Share) | ✅ |
| Audit-Tamper | Log manipulieren | Hash-Chain + ECDSA-Signaturen | ✅ |

### 3.4 Skills

| Vektor | Angriff | Mitigation | Status |
|--------|---------|-----------|--------|
| Malicious Skill | Boesartiger Code | Signaturpflicht + Sandbox (Timeout, Memory, Path) | ⚠️ |
| Path Traversal | Dateien ausserhalb lesen | isPathAllowed() + chroot-aehnlich | ✅ |
| Skill Sprawl | Unkontrollierte Verbreitung | Policy Engine + Approval Gates | ✅ |

### 3.5 Prompt Injection

| Vektor | Angriff | Mitigation | Status |
|--------|---------|-----------|--------|
| Task Injection | Manipulierter Task-Payload | Schema-Validierung + Human Approval | ⚠️ |
| Cascade | Agent A → B → C ueber Tasks | Policy Engine + Audit-Trail | ⚠️ |

---

## 4. Trust-Grenzen

```
+---------------------------------------------+
|  Internet (NICHT vertraut)                   |
+---------------------------------------------+
        |  Firewall (Port 9440 nur LAN)
+---------------------------------------------+
|  LAN (teilweise vertraut)                    |
|  +--------+  +--------+  +--------+         |
|  | Node A |  | Node B |  | Node C |         |
|  | (mTLS) |  | (mTLS) |  | (mTLS) |         |
|  +--------+  +--------+  +--------+         |
|       |           |           |              |
|  [SPAKE2 Pairing = Trust-Etablierung]        |
+---------------------------------------------+
        |  localhost (vertraut)
+---------------------------------------------+
|  Lokaler Prozess (CLI, MCP, Dashboard)       |
|  → Kein JWT noetig von localhost             |
+---------------------------------------------+
```

---

## 5. Offene Risiken

| Risiko | Schwere | Geplante Mitigation | Timeline |
|--------|---------|-------------------|----------|
| Prompt Injection Cascades | HOCH | WASM Sandbox + Task-Content-Validierung | Phase 3+ |
| mDNS Spoofing vor Pairing | MITTEL | Certificate Pinning nach TOFU | Phase 2+ |
| Stale Capabilities | NIEDRIG | Freshness-Tracking (implementiert) | ✅ |
| Mixed-Version Nodes | NIEDRIG | SemVer-Kompatibilitaetspruefung | ✅ |
