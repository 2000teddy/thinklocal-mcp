# RUNBOOK — .52 (iobroker) Re-Pair auf kanonische Identität (TL-00, KW28 Di→Mi-Fenster)

> **Zweck:** Den TH01↔.52-Zwei-Rechner-Beweis (TL-07) freimachen. **.52 ist bereits kanonisch
> re-enrolled** — der einzige Gap ist ein **stale Legacy-Pairing-Eintrag auf TH01**. Dieses Runbook
> schließt ihn ohne SPAKE2-PIN-Zeremonie und ohne .52-Neuausstellung, per **CA-verankertem Re-Key**.
> **Regeln:** bleibt auf `spiffe://thinklocal/…` (kein Trust-Domain-Flip, Entscheidung 7 → KW30).
> Ausführung nur im **Di→Mi-Fenster**; kein Tag-Live-Schritt an .52.

## 0. Warum es klemmt (verifizierter Befund)

- `.52` läuft live auf kanonischer Identität `spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d`
  (node.crt SAN + Subject), Cert signiert von `thinklocal Mesh CA 69bc0bc908229c9f`, gültig bis Sep 7 2026.
  `.52` ist **token-onboarded** (`ca.key.pem` fehlt) → die ADR-034-Selbstmigration (#245) greift für .52
  **nicht** und ist **nicht nötig** (schon kanonisch).
- **TH01** `~/.thinklocal/pairing/paired-peers.json` führt .52 aber noch als **Legacy**
  `spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code` (`publicKeyPem`/`fingerprint` leer,
  `caCertPem` gesetzt).
- Der Outbound-AGENT_MESSAGE-ACL (`inbox-api.ts`) prüft `isPaired(<node/…>)` — URI-gekeyt →
  der Legacy-`host/`-Eintrag matcht nicht → **403 „peer not paired"**.
- **Beweis des Trust-Ankers:** `.52`s live node-Cert verifiziert `OK` unter TH01s **gespeichertem**
  `caCertPem` (gleiche Mesh-CA 69bc…). ⇒ CA-verankerter Re-Key ist sicher (kein neuer Trust nötig).

## 1. Das Werkzeug (dieser PR)

`packages/daemon/src/pairing-canonicalize.ts` (rein, unit-getestet) + Runner
`scripts/canonicalize-pairings.ts`. Re-keyt **genau einen** Legacy-`host/`-Eintrag (`--peer`) auf **genau
eine** asserted `node/<PeerID>`-Identität (`--expect-uri`, aus `discover_peers`) **nur**, wenn (a) das
präsentierte Leaf-Cert unter dem **gespeicherten** `caCertPem` verifiziert (CA-Anker), (b) das Cert die
gewählte `--address` als IP/DNS-SAN trägt (Adress-Bindung) und (c) die node/-SAN **exakt** `--expect-uri`
ist (Anti-Substitution — nötig, weil die Mesh eine **geteilte** CA nutzt). Behält `caCertPem`/`hostname`/
`pairedAt`/`publicKeyPem`/`fingerprint`. Fail-closed: jeder Zweifel → Legacy-Eintrag bleibt.

## 2. Preflight (read-only, im Fenster VOR dem Apply)

```bash
# a) 403 reproduzieren (TH01, MCP oder REST): send_message_to_peer an .52s node/-URI → erwartet 403.
# b) Trust-Anker bestätigen (TH01):
#    .52 node-cert holen (mesh) und gegen den gespeicherten CA verifizieren:
#    openssl verify -CAfile <stored-52-ca.pem> <52-node.crt.pem>  → "OK"
# c) Backup-Anker: aktuellen Stand sichern
cp ~/.thinklocal/pairing/paired-peers.json ~/.thinklocal/pairing/paired-peers.json.pre-tl00
```

## 3. Apply (im Fenster) — TH01-Seite

```bash
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon
EXPECT=spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d  # aus discover_peers
# 1) DRY-RUN (keine Mutation): zeigt den geplanten Re-Key .52
npm run canonicalize-pairings -- --dry-run --peer iobroker --address 10.10.10.52 --expect-uri "$EXPECT"
# Erwartet: "Re-Key: …/host/b4768… → …/node/12D3KooWFgnD…"

# 2) Apply (schreibt atomar + .bak)
npm run canonicalize-pairings -- --peer iobroker --address 10.10.10.52 --expect-uri "$EXPECT"

# 3) Trust-Reload wirksam machen: Daemon-RESTART (KEIN Reboot)
systemctl --user restart thinklocal-daemon.service   # TH01 (Linux)
```

## 4. Apply — .52-Seite (nur falls .52 TH01 noch als Legacy führt; im Fenster prüfen)

Für den **beidseitigen** Beweis muss auch `.52`s `paired-peers.json` TH01 kanonisch führen
(`spiffe://thinklocal/node/12D3KooWKZ4…`). Im Fenster auf .52 prüfen; falls legacy:

```bash
# Auf .52 (im Fenster; nutzt dasselbe Werkzeug gegen TH01 .80):
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon
TH01=spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb  # aus discover_peers
npm run canonicalize-pairings -- --dry-run --peer <th01-hostname> --address 10.10.10.80 --expect-uri "$TH01"
npm run canonicalize-pairings -- --peer <th01-hostname> --address 10.10.10.80 --expect-uri "$TH01"
launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon   # falls Linux: systemctl --user restart
```

## 5. Verifikation (TL-07 Zwei-Rechner-Beweis)

```bash
# TH01 → .52 (jetzt 200 statt 403):
#   send_message_to_peer to=spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d
# Auf .52: read_inbox → Nachricht sichtbar mit read_at; AGENT_MESSAGE im Audit.
# .52 → TH01 (Gegenrichtung) ebenso.
# DoD (Christians 2-Peers-Regel): je eine gelesene Nachricht in BEIDE Richtungen + Audit beidseitig.
```

## 6. Rollback (reversibel, kein Reboot)

```bash
cp ~/.thinklocal/pairing/paired-peers.json.pre-tl00 ~/.thinklocal/pairing/paired-peers.json
# (oder das vom Runner erzeugte .bak-<ts>)
systemctl --user restart thinklocal-daemon.service
```
Additiv/risikoarm: der Re-Key ändert nur den `.52`-Eintrag; alle anderen Peers unberührt.

## 7. Grenzen / Gates

- Kein SPAKE2-PIN nötig (CA-verankert, keine Zeremonie). Kein Device-Login jenseits des Tool-Laufs.
- Keine Trust-Domain-Änderung (`axxsys-software.de` erst KW30/TL-14, Entscheidung 7).
- **Kein neues Christian-Gate** erforderlich: Gate 2 deckt den agent-getriebenen Re-Pair-Schritt;
  hier sogar ohne PIN-Zeremonie. Sollte `.52`s live-Cert wider Erwarten NICHT unter dem gespeicherten
  CA verifizieren (Runner meldet `cert-not-under-stored-ca`), dann ist der Trust-Anker gewechselt →
  DANN echtes Re-Onboarding/Re-Pair nötig (eskalieren) — nur in diesem Fall ein neues Gate.
