# .55 Canonical Re-Enroll Runbook (run WITH Christian, in einem Rutsch)

**Ziel:** `.55` von Legacy `host/813bdd161fea12ab` auf Canonical `node/12D3KooWJSgLjTm8H6cnUKCmASHQmPT5ZvTCFcyXJ3H3VqYa3sfr` bringen, sodass es fleet-weit canonical in `discover_peers` erscheint.

**Warum nötig:** `.55` läuft aktuell mit einem **self-signed** Cert ohne `node/<PeerID>`-URI-SAN (Card meldet `trust_level: mtls-self-signed`) UND `emit_canonical_sender=false`. Beides ging bei einem Restart/Deploy verloren. Der emit-canonical-Fail-safe braucht ein Cert mit der `node/`-SAN → daher **erst Cert re-enrollen, dann emit=true**.

**Voraussetzungen:** `.94` (CA) erreichbar + läuft; auf `.55` ist das Repo unter `/Users/chris/Entwicklung_local/thinklocal-mcp`.

---

## Schritt 1 — auf `.55`: Cert re-enrollen (node/<PeerID> von .94)

```bash
cd /Users/chris/Entwicklung_local/thinklocal-mcp/packages/daemon
# (a) dist bauen — ws3-rejoin.mjs importiert ./dist/*
npm run build            # bzw. npx tsc -p tsconfig.json

# (b) Rejoin-Skript braucht den KORREKTEN Hostname als CN (ws3-rejoin.mjs hat 'ThinkHub' hartkodiert!).
#     -> entweder ws3-rejoin.mjs auf .55 kopieren und hostname:'ThinkHub' -> '<.55-hostname>' ändern,
#        ODER inline (empfohlen):
ADMIN_URL=https://10.10.10.94:9440 node --input-type=module -e '
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fetch, Agent } from "undici";
import { loadOrCreateLibp2pPrivateKey } from "./dist/libp2p-identity.js";
import { requestNodeCert } from "./dist/cert-request.js";
import os from "node:os";
const DATA = process.env.HOME + "/.thinklocal", TLS = DATA + "/tls";
const { privateKey, peerId } = await loadOrCreateLibp2pPrivateKey(DATA);
console.log("[rejoin] PeerID =", peerId);   // MUSS 12D3KooWJSgLjTm8H6cnUKCmASHQmPT5ZvTCFcyXJ3H3VqYa3sfr sein
const dispatcher = new Agent({ connect: {
  ca: readFileSync(TLS+"/ca.crt.pem","utf8"), cert: readFileSync(TLS+"/node.crt.pem","utf8"),
  key: readFileSync(TLS+"/node.key.pem","utf8"), rejectUnauthorized: true } });
const r = await requestNodeCert({ adminUrl: process.env.ADMIN_URL, privateKey, peerId,
  hostname: os.hostname(), fetchImpl: fetch, dispatcher, timeoutMs: 15000 });
console.log("[rejoin] spiffe =", r.spiffeUri);   // MUSS node/12D3KooWJSg... sein
if (!existsSync(TLS+"/node.crt.canonical-backup.pem")) {
  copyFileSync(TLS+"/node.crt.pem", TLS+"/node.crt.prev-"+Date.now()+".pem"); }
writeFileSync(TLS+"/node.crt.pem", r.certPem, { mode: 0o644 });
writeFileSync(TLS+"/node.key.pem", r.keyPem, { mode: 0o600 });
console.log("[rejoin] node.crt.pem/key geschrieben.");
'
```
**HINWEIS:** `.55` ist dual-homed (en0/WiFi 10.10.25.90 + en10 10.10.10.55). Das ausgestellte Cert enthält die eigene validierte IP — sicherstellen, dass `.55` als 10.10.10.55 enrollt (en10). Falls `requestNodeCert` die WiFi-IP nimmt, vorher WiFi (en0) deaktivieren ODER `preferred_interfaces=["en10"]` setzen.

## Schritt 2 — auf `.55`: Cert verifizieren (node/-SAN vorhanden?)

```bash
openssl x509 -in ~/.thinklocal/tls/node.crt.pem -noout -ext subjectAltName
# ERWARTET: URI:spiffe://thinklocal/node/12D3KooWJSgLjTm8H6cnUKCmASHQmPT5ZvTCFcyXJ3H3VqYa3sfr , ..., IP:10.10.10.55
# Wenn KEINE node/-URI -> NICHT weitermachen (Re-Enroll fehlgeschlagen, .94/CA prüfen).
```

## Schritt 3 — auf `.55`: canonical-emit aktivieren (durable via plist-Env, überlebt git pull)

```bash
# Durable (überlebt Deploys, anders als die config.toml-Edit die zurückgesetzt wird):
PL=~/Library/LaunchAgents/com.thinklocal.daemon.plist
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:TLMCP_EMIT_CANONICAL_SENDER string 1" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:TLMCP_EMIT_CANONICAL_SENDER 1" "$PL"
# plist-Env greift NUR nach bootout+bootstrap (kickstart -k reicht NICHT):
launchctl bootout gui/$(id -u)/com.thinklocal.daemon 2>/dev/null
launchctl bootstrap gui/$(id -u) "$PL"
sleep 14
```

## Schritt 4 — auf `.55`: verifizieren

```bash
T=~/.thinklocal/tls
curl -sk --cert $T/node.crt.pem --key $T/node.key.pem https://127.0.0.1:9440/api/status \
  | grep -oE '"agent_id":"[^"]*"|"peers_online":[0-9]+'
# ERWARTET: agent_id = ...node/12D3KooWJSgLjTm8H6cnUKCmASHQmPT5ZvTCFcyXJ3H3VqYa3sfr , peers_online=6
```

## Schritt 5 — `.94` re-learn (macOS, Christian): Daemon neu starten, damit es .55s neue canonical Card holt

```bash
launchctl kickstart -k gui/$(id -u)/com.thinklocal.daemon
```

## Schritt 6 — Linux-Seite (MEIN Teil, nach „55 canonical"):
Sobald `.55` canonical meldet: ich restarte die 5 Linux-Nodes, damit sie die **stale Legacy-`host/813bdd16`-Einträge** droppen und `.55` als canonical `node/12D3KooWJSg` neu entdecken (static_peer 10.10.10.55 → fetch canonical Card → markPeerIdVerified → approved). Dann **canonical count=6 fleet-weit**.

---

## Offene Linux-Residual (heute Nacht NICHT gefixt, da .55-Re-Enroll es ersetzt):
`.52/.56/.222` halten den **Legacy-**`.55` aktuell nicht stabil (count=5, .55 absent), obwohl static_peer-Env gesetzt + .55 erreichbar (Card+/health 200). TH01/TH02 halten ihn (count=6). Ursache nicht final gepinnt (Reconciler-Boot-Log nicht auffindbar; 5-min-Startup-Window-Lücke in #169 ist ein Verdacht). **Wird mit dem canonical-Cutover (Schritt 6: Fleet-Restart nach .55-canonical) ohnehin frisch neu etabliert** — daher bewusst nicht nachts gechased (Thrashing-Lehre).
