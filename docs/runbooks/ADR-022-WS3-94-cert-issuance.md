# ADR-022 WS-3 — Cross-Node PoP Cert-Issuance: Anweisung für .94 (Admin-CA, Mac mini)

Dieses Runbook beschreibt **exakt**, was der Admin-Node `.94` (10.10.10.94, Mac mini)
tun muss, damit ein joinender Node (z.B. TH01) ein Cert mit SAN
`spiffe://thinklocal/node/<PeerID>` erhält — der scharfe Schalter für ADR-022 Schritt 3.

Der **Code beider Seiten ist bereits gebaut** (PR „ADR-022 §3 WS-3"). `.94` muss nur die
neue Daemon-Version ausrollen und (optional) den Empfänger-Pin verteilen. Es gibt
**keinen manuellen Krypto-Schritt** — die Endpoints laufen automatisch, sobald `.94` als
Admin-Node (CA-Key vorhanden) startet.

---

## 1. Was auf .94 automatisch aktiv wird

Beim Daemon-Start prüft `index.ts`, ob `<data_dir>/tls/ca.key.pem` existiert (= Admin-Node).
Wenn ja, werden **auf dem Haupt-mTLS-Server (Port 9440)** zwei Endpoints registriert:

| Endpoint | Methode | Auth | Zweck |
|----------|---------|------|-------|
| `/api/cert/nonce` | POST | mTLS (Mesh-Cert) | liefert `{ nonce, caFingerprint }` |
| `/api/cert/sign`  | POST | mTLS (Mesh-Cert) + PoP | verifiziert PoP, liefert `{ certPem }` |

Im Log erscheint: `ADR-022 WS-3: PoP-Cert-Ausstellung aktiv (Admin-Node)` mit dem
`caFingerprint`. **Diesen Fingerprint notieren** — er ist der Pin für Schritt 4.

> **AuthZ-Modell:** Beide Endpoints liegen hinter `requestCert + rejectUnauthorized`.
> Nur ein Node mit gültigem CA-signierten Mesh-Cert (Legacy `host/` ODER `node/`)
> erreicht den Handler. Die kryptografische Identität liefert der PoP selbst.

---

## 2. Was .94 bei `/api/cert/sign` verifiziert (automatisch, zur Info)

Der Request-Body (JSON):
```json
{
  "peerId": "<base58btc PeerID>",
  "ed25519PublicKeyB64": "<raw 32-byte Ed25519 pubkey, base64>",
  "spiffeUri": "spiffe://thinklocal/node/<peerId>",
  "nonce": "<von /api/cert/nonce>",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST----- …",
  "popSignatureB64": "<Ed25519-Signatur über den PoP-Scope, base64>"
}
```

`.94` prüft **fail-closed** in dieser Reihenfolge:
1. **Nonce** ist bekannt, nicht abgelaufen, nicht verbraucht → wird konsumiert (single-use).
2. **CSR** ist selbst-signiert gültig (`csr.verify()`); der CSR-Public-Key-Hash wird
   **von .94 selbst** aus dem eingereichten CSR berechnet (kein client-gelieferter Hash).
3. **PoP-Scope** (Domain-Separator `thinklocal-mcp.cert-pop.v1` ‖ CA-Fingerprint ‖ Nonce ‖
   PeerID ‖ SPIFFE-URI ‖ CSR-Public-Key-Hash), length-prefixed:
   - PeerID **leitet sich aus** `ed25519PublicKeyB64` ab (keine Fremd-PeerID),
   - SPIFFE-URI ist exakt `spiffe://thinklocal/node/<peerId>`,
   - der CA-Fingerprint im Scope == `.94`s eigener CA-Fingerprint,
   - die Ed25519-Signatur ist über genau diesen Scope gültig.
4. **Signing:** `.94` signiert den CSR-Public-Key mit dem CA-Key. Das ausgestellte Cert
   trägt SAN = **nur** die kanonische URI + den **eigenen** Hostnamen des Antragstellers
   (CSR-CN, RFC-1123-validiert) + dessen **eigene** IP (aus `req.ip`). **Niemals** den
   .94-Hostnamen oder `localhost`. CSR-`extensionRequest` wird ignoriert.

Der private TLS-Key verlässt den joinenden Node **nie** — nur der CSR (Public-Key) geht an `.94`.

---

## 3. Deploy auf .94 (die einzigen manuellen Schritte)

```bash
# auf .94, als der Daemon-User (node 22!)
cd /pfad/zu/thinklocal-mcp
git fetch && git checkout main && git pull        # enthält WS-3 nach Merge
cd packages/daemon && npm ci && npm run build      # ABI: better-sqlite3 unter node 22
# Daemon neustarten (systemd --user o.ä.)
systemctl --user restart thinklocal-daemon
journalctl --user -u thinklocal-daemon -n 30 | grep "WS-3"
#   → "ADR-022 WS-3: PoP-Cert-Ausstellung aktiv (Admin-Node)" + caFingerprint
```

`.94` ist damit als ausstellende CA bereit. **CA-Fingerprint aus dem Log kopieren.**

---

## 4. (Phase 2) Empfänger-Pin verteilen — schaltet Accept-both scharf

Damit ein neu ausgestelltes `node/<PeerID>`-Cert mesh-weit als PeerID-Beweis **akzeptiert**
wird (WS-2-Attestierung), muss **jeder Node** `.94`s CA-Fingerprint als attestierende CA
pinnen — sonst bleibt die kanonische Attestierung inert (sicherer Default):

```bash
# auf JEDEM Node (inkl. .94 selbst), in der Daemon-Umgebung:
export TLMCP_PEERID_ATTESTING_CA_FP="<caFingerprint aus .94s Log>"
# (mehrere CAs: kommagetrennt). Dann Daemon neustarten.
```

Ohne diesen Pin: WS-3 stellt Certs aus, aber niemand verwertet die kanonische Identität
(reines „inert"). Mit Pin: ein `node/<PeerID>`-Cert von `.94` schaltet die kanonische
PeerID-Auflösung für den Peer frei (channel-bound, `agent-card.ts /message`).

---

## 5. TH01-Rejoin live testen

Der Client-Flow ist als Library-Funktion `requestNodeCert()` (`cert-request.ts`) gebaut.
Ablauf auf TH01 (sobald als CLI/Join-Hook verdrahtet, oder via kurzem Skript):
1. TH01 ruft `POST https://10.10.10.94:9440/api/cert/nonce` (mit seinem Legacy-mTLS-Cert
   im Dispatcher) → `{ nonce, caFingerprint }`.
2. TH01 erzeugt RSA-Keypair + CSR (CN = `th01`).
3. TH01 baut den PoP mit seinem **persistierten** libp2p-Ed25519-Key (ADR-022 #0) und
   ruft `POST /api/cert/sign` → `{ certPem }`.
4. TH01 schreibt `certPem` + den lokalen Key als neues Node-Cert, startet neu.
5. **Verifikation:** im Mesh sollte TH01s SKILL_ANNOUNCE nun unter
   `spiffe://thinklocal/node/<PeerID>` ankommen statt 403 — sobald der Sender-URI-Flip
   (Phase 3) folgt. Mit nur Schritt 1-4 (Cert da, Sender noch Legacy) erkennt der
   Empfänger die PeerID bereits via `peerIdFromCertSan`/`attestedPeerIdFromCert`.

Frei iterieren: Certs/Keys sind in der Alpha wegwerfbar — bei Bedarf `node.crt.pem` /
`node.key.pem` löschen und neu anfordern.

---

## 6. Sicherheits-Eckpfeiler (warum das so gebaut ist)

- **CSR-Public-Key-Hash im PoP-Scope** verhindert Cert-Substitution (fremder PoP + eigener TLS-Key).
- **CA-Fingerprint im Scope + Issuer-Pin** verhindert, dass eine andere transport-vertraute
  CA (gepairte Peer-CA) `node/<victimPeerId>` attestiert (WS-2 HIGH).
- **PeerID aus dem Ed25519-Pubkey abgeleitet + Signatur damit geprüft** → keine Fremd-PeerID.
- **Single-use-Nonce + TTL** → kein Replay.
- **SAN nur Antragsteller-eigen** → keine Admin/localhost-Impersonation (WS-3 HIGH).
