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
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon

# TH01: Ist-Zustand nur lesen. Erwartet: ein iobroker-Eintrag mit Legacy-host/-URI und caCertPem.
node -e 'const p=require("fs").readFileSync(process.env.HOME+"/.thinklocal/pairing/paired-peers.json","utf8"); for (const e of JSON.parse(p).filter(e=>e.hostname==="iobroker")) console.log(JSON.stringify({hostname:e.hostname,agentId:e.agentId,hasCaCertPem:!!e.caCertPem,hasPublicKeyPem:!!e.publicKeyPem,hasFingerprint:!!e.fingerprint},null,2))'

# TH01: 403 reproduzieren (MCP oder REST): send_message_to_peer an .52s node/-URI.
# Erwartet: 403 "peer not paired" fuer:
EXPECT=spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d
echo "$EXPECT"

# TH01: .52 Leaf-Cert read-only holen und gegen den gespeicherten Trust-Anker pruefen.
node - <<'NODE'
const fs = require('fs');
const tls = require('tls');
const forge = require('node-forge');
const peers = JSON.parse(fs.readFileSync(`${process.env.HOME}/.thinklocal/pairing/paired-peers.json`, 'utf8'));
const peer = peers.find((p) => p.hostname === 'iobroker');
if (!peer?.caCertPem) throw new Error('iobroker caCertPem fehlt');
fs.writeFileSync('/tmp/tl52-stored-ca.pem', peer.caCertPem, { mode: 0o600 });
const cert = fs.readFileSync(`${process.env.HOME}/.thinklocal/tls/node.crt.pem`, 'utf8');
const key = fs.readFileSync(`${process.env.HOME}/.thinklocal/tls/node.key.pem`, 'utf8');
const s = tls.connect({ host: '10.10.10.52', port: 9440, rejectUnauthorized: false, cert, key, servername: '10.10.10.52' }, () => {
  const raw = s.getPeerCertificate(false).raw;
  const c = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary'))));
  fs.writeFileSync('/tmp/tl52-node.crt.pem', forge.pki.certificateToPem(c), { mode: 0o600 });
  s.end();
});
s.on('error', (e) => { throw e; });
NODE
openssl verify -CAfile /tmp/tl52-stored-ca.pem /tmp/tl52-node.crt.pem
# Erwartet: /tmp/tl52-node.crt.pem: OK
```

## 3. Backup-Anker (vor dem Apply, daemon-inert)

```bash
# TH01: manuellen Rollback-Anker vor Mutation anlegen. Nicht unter dem Live-Dateinamen, daher daemon-inert.
cp ~/.thinklocal/pairing/paired-peers.json ~/.thinklocal/pairing/paired-peers.json.pre-tl00
```

Erwartete daemon-inerte Backup-Dateien nach erfolgreichem Apply:

- `~/.thinklocal/pairing/paired-peers.json.pre-tl00` — manueller Rollback-Anker, wird vom Daemon nie gelesen.
- `~/.thinklocal/pairing/paired-peers.json.bak-<ISO-Zeit>` — Runner-Backup direkt vor dem atomaren Write, wird vom Daemon nie gelesen.

Nicht fuer dieses `.52`-Runbook erwarten: `~/.thinklocal/tls/node.crt.legacy-premigrate.pem`. `.52` ist
bereits token-onboarded kanonisch und wird hier nicht per ADR-034 selbstmigriert.

## 4. Apply (im Fenster) — TH01-Seite

```bash
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon
EXPECT=spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d  # aus discover_peers
# 1) DRY-RUN (keine Mutation): zeigt den geplanten Re-Key .52
npm run canonicalize-pairings -- --dry-run --peer iobroker --address 10.10.10.52 --expect-uri "$EXPECT"
# Erwartet: "Re-Key: …/host/b4768… → …/node/12D3KooWFgnD…"

# 2) Apply (schreibt atomar + .bak)
npm run canonicalize-pairings -- --peer iobroker --address 10.10.10.52 --expect-uri "$EXPECT"
# Erwartet: "Geschrieben: ...paired-peers.json  (Backup: ...paired-peers.json.bak-...)"

# 3) Trust-Reload wirksam machen: Daemon-RESTART (KEIN Reboot)
systemctl --user restart thinklocal-daemon.service   # TH01 (Linux)
```

## 5. Apply — .52-Seite (nur falls .52 TH01 noch als Legacy führt; im Fenster prüfen)

Für den **beidseitigen** Beweis muss auch `.52`s `paired-peers.json` TH01 kanonisch führen
(`spiffe://thinklocal/node/12D3KooWKZ4…`). Im Fenster auf .52 prüfen; falls legacy:

```bash
# Auf .52 (im Fenster; nutzt dasselbe Werkzeug gegen TH01 .80):
cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon
TH01=spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb  # aus discover_peers
node -e 'const p=require("fs").readFileSync(process.env.HOME+"/.thinklocal/pairing/paired-peers.json","utf8"); for (const e of JSON.parse(p).filter(e=>e.agentId.includes("/host/")||e.hostname.includes("TH01")||e.hostname.includes("th01"))) console.log(JSON.stringify({hostname:e.hostname,agentId:e.agentId,hasCaCertPem:!!e.caCertPem},null,2))'
cp ~/.thinklocal/pairing/paired-peers.json ~/.thinklocal/pairing/paired-peers.json.pre-tl00-th01
npm run canonicalize-pairings -- --dry-run --peer <th01-hostname> --address 10.10.10.80 --expect-uri "$TH01"
npm run canonicalize-pairings -- --peer <th01-hostname> --address 10.10.10.80 --expect-uri "$TH01"
launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon   # falls Linux: systemctl --user restart
```

## 6. Verifikation (TL-07 Zwei-Rechner-Beweis)

```bash
# TH01 → .52 (jetzt 200 statt 403):
#   send_message_to_peer to=spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d
# .52 → TH01 (Gegenrichtung) ebenso.

# Evidence TH01:
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  https://127.0.0.1:9440/api/audit?limit=50 | grep -E 'AGENT_MESSAGE|MESSAGE'

# Evidence .52:
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  https://127.0.0.1:9440/api/inbox | grep -E 'read_at|AGENT_MESSAGE|message'
curl -sk --cert ~/.thinklocal/tls/node.crt.pem --key ~/.thinklocal/tls/node.key.pem \
  https://127.0.0.1:9440/api/audit?limit=50 | grep -E 'AGENT_MESSAGE|MESSAGE'
```

DoD (Christians 2-Peers-Regel): je eine gelesene Nachricht in BEIDE Richtungen, `read_at` auf der
Empfaengerseite und Audit-Evidence auf TH01 und `.52`.

## 7. Rollback (reversibel, kein Reboot)

```bash
cp ~/.thinklocal/pairing/paired-peers.json.pre-tl00 ~/.thinklocal/pairing/paired-peers.json
# (oder das vom Runner erzeugte .bak-<ts>)
systemctl --user restart thinklocal-daemon.service

# Falls .52-seitig angewendet wurde:
cp ~/.thinklocal/pairing/paired-peers.json.pre-tl00-th01 ~/.thinklocal/pairing/paired-peers.json
launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon   # falls Linux: systemctl --user restart
```

Additiv/risikoarm: der Re-Key ändert nur den `.52`-Eintrag; alle anderen Peers unberührt.

## 8. Grenzen / Gates

- Kein SPAKE2-PIN nötig (CA-verankert, keine Zeremonie). Kein Device-Login jenseits des Tool-Laufs.
- Keine Trust-Domain-Änderung (`axxsys-software.de` erst KW30/TL-14, Entscheidung 7).
- **Kein neues Christian-Gate** erforderlich: Gate 2 deckt den agent-getriebenen Re-Pair-Schritt;
  hier sogar ohne PIN-Zeremonie. Sollte `.52`s live-Cert wider Erwarten NICHT unter dem gespeicherten
  CA verifizieren (Runner meldet `cert-not-under-stored-ca`), dann ist der Trust-Anker gewechselt →
  DANN echtes Re-Onboarding/Re-Pair nötig (eskalieren) — nur in diesem Fall ein neues Gate.
