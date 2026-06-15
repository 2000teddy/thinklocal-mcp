# PROMPT — TH02 ThinkLocal-MCP-Node auf neuesten Stand bringen

> **Zweck:** Diese Datei ist der Eingangs-Prompt für den Claude-Agenten auf **TH02**.
> Sie bringt TH02 als zweiten `thinklocal-mcp`-Mesh-Node auf den aktuellen Stand und
> macht ihn bereit für einen TH01↔TH02-Sync-Test (ThinkHub / ThinkLocal-MCP).
> Erstellt auf TH01 (ThinkHub, 10.10.10.80) am 2026-06-04 nach der TH01-Inbetriebnahme.
>
> **NICHT blind ausführen.** Erst lesen, Ist-Stand prüfen, geplante Befehle ZEIGEN, dann
> auf Christians OK ausführen. Reihenfolge unten einhalten. Wo etwas fehlt (Token, IPs):
> beim Operator anfragen, nicht raten.

---

## 0. Wer bist du / wo bist du (zuerst klären)

- Du bist der **ThinkLocal-MCP-Agent auf TH02** — NICHT der Administrator, NICHT ThinkHub-Core/Extensions.
- **Dein Home = dein eigenes Repo-Verzeichnis** (`pwd` ausführen; auf TH01 war es `/opt/thinklocal-mcp`).
  **Doku-Regel (wichtig, hat auf TH01 Verwirrung gekostet):**
  - Entwicklungs-/Projekt-/Design-Arbeit (ADR, Code, CHANGES, TODO) → **dein Repo-Home**.
  - Nur genuin **admin-/maschinen-Ebene** (Node läuft als Service o.ä.) → kurz ins Verzeichnis des
    **Administrator-Agenten** (`~/thinkhub-administrator/` im Home des Admin-Users), damit der Bescheid weiß.
  - **Schreib NICHT** Projekt-Detail in fremde Agent-Homes. Jeder Agent pflegt sein eigenes Home.
- Auf TH01 gibt es ~4 tmux-Agenten (Administrator @ `/home/<user>`, ThinkHub-Core @ `/opt/thinkhub/core`,
  ThinkHub-Extension @ `/opt/thinkhub/extensions`, ThinkLocal-MCP @ `/opt/thinklocal-mcp`). TH02 ist
  analog dein eigener Node.

---

## 1. Laufzeit-Umgebung (HARTE Voraussetzung)

- **Node MUSS v22.x sein** (`.nvmrc` pinnt `22.22.3`). Grund: `better-sqlite3` ist gegen
  **NODE_MODULE_VERSION 127 (Node 22)** vorgebaut. System-Node 20 (ABI 115) oder 26 (ABI 137) →
  `ERR_DLOPEN_FAILED`-Crash beim Daemon-/Test-Start.
  - Verifizieren: `node -v` == `v22.22.3` **und** `node -e "console.log(process.versions.modules)"` == `127`.
  - Wenn der Default-Shell-Node abweicht: `PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"` voranstellen
    (oder via nvm). **Alle** daemon/test/npm-Aufrufe unter Node 22.
- `npm install` (oder `npm ci`) **unter Node 22** ausführen, sonst rebuildet es better-sqlite3 falsch.

---

## 2. Repo holen / aktualisieren

- Repo: `2000teddy/thinklocal-mcp` (privat). Remote via SSH-Alias (auf TH01: `git@github.com-thinklocal:...`).
- **`git fetch && git checkout main && git pull`** → **main ist der maßgebliche Stand.**
- ⚠️ **ADR-022 (PeerID-gewurzelte Identität) ist NOCH NICHT in main** — liegt auf dem unmergten Branch
  `agent/claude-code/adr022-peerid-identity` und ist **nicht mergebar** (2 offene HIGH, s. §7).
  TH02 also auf **main** betreiben, nicht auf dem ADR-022-Branch (außer der Test verlangt es explizit).

---

## 3. Tooling (nach Bedarf)

- **gh (GitHub CLI)** nur falls TH02 PRs/CI braucht: Ubuntu → offizielle apt-Quelle (`cli.github.com`),
  braucht sudo (auf TH01 war sudo non-interaktiv da). `gh auth login` ist **interaktiv** (Device-Code) —
  in non-interaktiver Umgebung den Operator machen lassen. Konto: `2000teddy` (Owner) oder passender
  Collaborator. Für reines Node-Betreiben ist gh NICHT nötig.
- **pal/clink** (Multi-Modell-Review/Konsens) nur falls TH02 selbst entwickelt — fürs reine Joinen nicht nötig.

---

## 4. Mesh-Join (Token-Onboarding) — ⚠️ PORT 9441, nicht 9440

> **Bug, der auf TH01 den ersten Join gekostet hat:** `cmdJoin` hängt `/onboarding/join` direkt an die
> `--admin-url` an, aber der **certlose Onboarding-Server lauscht auf `admin-port + 1` = 9441**
> (der Haupt-Daemon auf 9440 verlangt mTLS und weist einen frischen Node ab → „fetch failed").
> Der Admin druckt die Join-Anleitung fälschlich mit `:9440`. **Immer gegen `:9441` joinen.**

1. **Frischen Single-Use-Token vom Admin (.94) anfordern** (Operator/Christian). Token ist einmalig + zeitlich begrenzt.
2. Join (unter Node 22, im Repo-Verzeichnis):
   ```
   npm run thinklocal -- join --token <TOKEN> --admin-url https://10.10.10.94:9441
   ```
3. Erwartetes Ergebnis: Node-Cert (`CN=<hostname>`, Issuer `thinklocal Mesh CA 69bc0bc908229c9f`, 90 T),
   Key + CA + Trust-Bundle nach `~/.thinklocal/tls/`, „N Peer(s) importiert".
4. Falls „fetch failed": prüfen ob du versehentlich gegen 9440 gejoint hast; Netz zu .94 prüfen
   (`ping 10.10.10.94`, TCP 9441 offen). Token schon verbraucht? → neuen anfordern.

---

## 5. LAN-Daemon persistent als systemd `--user`-Service (Weg „B2")

> **NICHT `thinklocal restart`/`start` für LAN benutzen.** Zwei CLI-Bugs + Nebenwirkungen:
> - `restart` **verwirft Flags** und startet **sogar bei `--help`** einen Daemon; fällt hart auf
>   `local` (127.0.0.1) zurück → `restart --lan` bindet trotzdem localhost.
> - `start`/`restart` schreiben zusätzlich `~/.mcp.json` + Claude-Desktop-Config um und importieren `.env`.
> Deshalb LAN zuverlässig **nur** über `TLMCP_RUNTIME_MODE=lan` (Env/Unit), nicht über CLI-Flags.

1. **Vorab-Smoke-Test im Vordergrund** (Port frei? LAN+mTLS+Peers?):
   ```
   PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" \
   TLMCP_CONFIG=<repo>/config/daemon.toml \
   TLMCP_DATA_DIR="$HOME/.thinklocal" \
   TLMCP_RUNTIME_MODE=lan \
   npx tsx packages/daemon/src/index.ts
   ```
   Log prüfen: `runtimeMode:"lan"`, `bindHost:"0.0.0.0"`, `tlsEnabled:true`, „mTLS aktiviert",
   `meshIp` = TH02s 10.10.10.x, Peers entdeckt + Agent-Cards verifiziert. Dann `Ctrl+C`.
2. **`config/daemon.toml`** (host-spezifisch, NICHT in main committen): `runtime_mode = "lan"`,
   `allowed_mesh_cidrs = ["10.10.0.0/16"]` (deckt alle 10.10.x), `exclude_interface_patterns`
   = `["docker*","tailscale*","utun*","veth*","br-*","tun*","tap*","lo*"]` (Docker 172.x / Tailscale 100.x raus).
3. **Log-Verzeichnis vorher anlegen** (sonst systemd-Fehler `209/STDOUT`): `mkdir -p ~/.thinklocal/logs`.
4. **Unit `~/.config/systemd/user/thinklocal-daemon.service`** (node-22 HART in ExecStart **und** PATH,
   `TLMCP_RUNTIME_MODE=lan` hart, `BIND_HOST=0.0.0.0`, Repo-Config, `Restart=on-failure`; **kein** `User=`,
   `WantedBy=default.target`). Vorlage analog TH01:
   ```ini
   [Unit]
   Description=thinklocal-mcp Mesh Daemon (TH02)
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   ExecStart=/home/<user>/.nvm/versions/node/v22.22.3/bin/node <repo>/packages/daemon/node_modules/.bin/tsx <repo>/packages/daemon/src/index.ts
   Environment=TLMCP_CONFIG=<repo>/config/daemon.toml
   Environment=TLMCP_DATA_DIR=/home/<user>/.thinklocal
   Environment=TLMCP_RUNTIME_MODE=lan
   Environment=TLMCP_BIND_HOST=0.0.0.0
   Environment=PATH=/home/<user>/.nvm/versions/node/v22.22.3/bin:/usr/local/bin:/usr/bin:/bin
   Environment=NODE_ENV=production
   WorkingDirectory=<repo>
   Restart=on-failure
   RestartSec=10
   StandardOutput=append:/home/<user>/.thinklocal/logs/daemon.log
   StandardError=append:/home/<user>/.thinklocal/logs/daemon.error.log

   [Install]
   WantedBy=default.target
   ```
   (`<user>`/`<repo>` ersetzen; `node-22-Pfad` per `ls ~/.nvm/versions/node/` verifizieren.)
5. `systemctl --user daemon-reload && systemctl --user enable --now thinklocal-daemon`;
   `loginctl enable-linger $USER` (damit es ohne Login läuft).

---

## 6. Verifikation (end-to-end)

- `systemctl --user is-active/is-enabled thinklocal-daemon` = active / enabled; `loginctl … Linger=yes`.
- `ss -tlnp`: `0.0.0.0:9440` (HTTPS mTLS), `0.0.0.0:9540` (libp2p), **`127.0.0.1:8003` (pal, loopback-only — NICHT öffnen)**.
- Log: `runtimeMode:"lan"`, „mTLS aktiviert", Peers entdeckt + „Agent Card verifiziert und akzeptiert".
- **Gegenprobe vom Admin (.94)**: erscheint TH02 in `discover_peers`/`mesh_status`? Ist TH02s CA im Trust-Bundle?
- **Bekanntes Symptom (noch nicht gefixt):** ausgehender `SKILL_ANNOUNCE` kann **HTTP 403 „Unknown sender"**
  bekommen (`agent-card.ts:210-212`: Peer kann den Signatur-Public-Key des Absenders nicht auflösen —
  App-Layer, NICHT CA-Trust; mTLS-Handshake war ja erfolgreich). Ursachen: Identitäts-Drift + Announce-Timing.
  **Das fixt ADR-022** (noch nicht in main). Bis dahin: Node ist als Peer sichtbar, aber Skill-Announce
  kann 403en — für einen Discovery/Heartbeat-Sync-Test ok, für Skill-Austausch erst nach ADR-022-Merge.

---

## 7. Projekt-/Branch-Stand (Stand 2026-06-04, damit TH02 nicht überrascht ist)

- **main ist sauber.** PR **#142** (Signing-Regel-Entfernung) ist gemergt.
- **CLAUDE.md UNVERHANDELBARE REIHENFOLGE** gilt: CO → CG → Design-Doku(ADR) → Code → TS → CR → PC →
  commit → DO → PR → Merge → Peer-Deploy+Live-Test. **Signierte Commits sind NICHT mehr Pflicht**
  (Regel entfernt, Solo-Betrieb — unsignierte Commits regelkonform).
- **GitHub-Schutz auf main (Phase-2-Bot-Approve scharf):** Branch Protection aktiv — required check `CI`
  (strict) + 1 Approving Review. Bot `peppiseppiullmann-ci` (Write-Collaborator) approved via
  `scripts/bot-approve.sh <pr#>` nach grünem CI (braucht `GITHUB_BOT_TOKEN` in `.env`). **Achtung:**
  PR-Author kann eigene PR nicht approven → Review muss vom Bot (oder anderem Collaborator) kommen.
  Lücken: `enforce_admins=false` (Admin-Bypass möglich), `require_code_owner_reviews=false`
  (CODEOWNERS existiert, ist aber NICHT erzwungen).
- **ADR-022 (PeerID-gewurzelte Identität)** — Branch `agent/claude-code/adr022-peerid-identity`,
  **NICHT mergebar**, 2 offene HIGH (2. Review gpt-5.5):
  1. `mesh.ts resolvePeerPublicKey` PeerID-Fallback **spoofbar** (libp2p.peerId aus unauth. mDNS) →
     Fallback raus, bis krypto-verifizierte PeerID-Bindung (cert-SAN=`node/<PeerID>`/Noise) existiert.
  2. `libp2p-identity.ts` check-then-create **Race** → exklusiver Lock.
  Plus MEDIUMs (keys/-Dir-Rechte, Dir-fsync-Swallow, SPIFFE-Parser strikt). Fixes je mit Regressionstest
  + Review = kommende Session. **Voraussetzung #0 (libp2p-Key-Persistenz) ist auf dem Branch fertig**
  (Ed25519-Key persistiert → stabile PeerID), aber eben noch nicht in main.

---

## 8. Was der Operator (Christian) bereitstellen muss

- [ ] **Frischer Single-Use-Join-Token** von .94 (zum Join-Zeitpunkt, da zeitlich begrenzt).
- [ ] Bestätigung **Mesh-CIDR** (Default-Annahme: `10.10.0.0/16`) und TH02s tatsächliche Mesh-IP/Interface.
- [ ] SSH-Zugang/Deploy-Key für das private Repo auf TH02 (falls noch nicht eingerichtet).
- [ ] `.env` mit `GITHUB_BOT_TOKEN` **nur** falls TH02 selbst Bot-Approve fahren soll (sonst nicht nötig).
- [ ] Entscheidung: TH02 nur **Discovery/Heartbeat-Sync-Test** (main reicht) oder **Skill-Austausch**
      (braucht ADR-022-Merge zuerst).

---

## 9. Definition „auf neuestem Stand" für den TH02-Test

TH02 ist test-bereit, wenn: Node 22 ✓, main gepullt ✓, gejoint (Cert von Mesh-CA) ✓, LAN-Daemon als
`systemd --user`-Service live (9440 mTLS + 9540 libp2p, pal loopback) ✓, von .94 als Peer sichtbar ✓.
Für einen **Skill-/A2A-Austausch-Test** zusätzlich: ADR-022 in main gemergt (behebt den 403).

---

*Quelle der Lehren: TH01-Inbetriebnahme + 2 Code-Reviews (gpt-5.3-codex, gpt-5.5), 2026-06-03/04.
Bei Abweichungen zwischen dieser Datei und dem realen Repo gilt das Repo — diese Datei kann veralten;
Stand-Datum oben beachten.*
