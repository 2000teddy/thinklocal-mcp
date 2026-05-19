# Handover Mac Mini — Post-Merge Aufgaben fuer ADR-020 v1+v2

**Status MacBook 2026-05-19**: PR #134 ist offen. CI laeuft nach
CHANGES.md-Fix erneut. SeppiPeppi-Review wird automatisch ausgeloest sobald
CI gruen ist.

Dieser Plan beschreibt die naechsten Schritte ab Merge von PR #134.

## Reihenfolge

| # | Aufgabe | Wer | Wann |
|---|---------|-----|------|
| 0 | Genesis-Blob produzieren | Mac Mini Claude | **JETZT (vor Merge moeglich)** — siehe separater Prompt `PROMPT-MINIMAC-GENESIS.md` |
| 1 | SeppiPeppi-Review abwarten | automatisch | nach Push |
| 2 | Eventuelle Bot-Findings fixen | Wer free ist | nach Review |
| 3 | Merge PR #134 → main | nach gruener CI + Approval | |
| 4 | Verteilung auf alle 5 Mesh-Nodes | manuell | nach Merge |
| 5 | Live-Verifikation 5-Node-Mesh | MacBook (Daemon-Tests) | nach Verteilung |
| 6 | 24h-Beobachtung | MacBook | direkt nach Live-Test |
| 7 | ADR-022 Owner-wins schreiben + implementieren | beliebig | Folge-Sprint |
| 8 | ADR-023 Backpressure/Chunking (deferred) | beliebig | wenn realer Bedarf |
| 9 | ADR-021 Skill-Health implementieren | nach ADR-022 | Folge-Sprint |
| 10 | better-sqlite3 ABI-Mismatch fixen | beliebig | dringend, blockt npm test |

## Detail-Beschreibung

### 4. Verteilung auf alle 5 Mesh-Nodes

Repo per `git pull` auf jedem Host aktualisieren, dann Daemon neu starten:

```bash
# Auf jeder der 5 Nodes
cd ~/Entwicklung_local/thinklocal-mcp
git pull
cd packages/daemon
npm install   # falls package-lock-Aenderungen
npm run build
```

Daemon-Restart je nach Host:
- **macOS LaunchDaemon** (MacBook, ggf. Mac Mini):
  `sudo launchctl kickstart -k system/com.thinklocal.daemon`
- **systemd-user** (iobroker, influxdb, ai-n8n-local):
  `systemctl --user restart thinklocal-daemon`

Audit-Log auf jedem Host beobachten:
- `tail -f ~/.thinklocal/logs/daemon.log` — auf
  "RegistrySyncCoordinator gestartet (ADR-020 v1)"

### 5. Live-Verifikation 5-Node-Mesh

**Pre-Checks** (manuell, von einer beliebigen Node aus):

```bash
# Heartbeat-Sicht aller Peers
curl -sk https://10.10.10.55:9440/api/status | jq '.peers_online'
curl -sk https://10.10.10.94:9440/api/status | jq '.peers_online'
# erwartet: 4 auf jedem Host

# Capabilities-Hash auf allen 5 Hosts
for ip in 10.10.10.55 10.10.10.94 10.10.10.52 10.10.10.56 10.10.10.222; do
  echo -n "$ip: "
  curl -sk https://$ip:9440/api/capabilities | jq -r '.hash // .capabilities_hash'
done
# erwartet: IDENTISCHER Hash auf allen 5 Hosts (vorher: 5 verschiedene)
```

**Coordinator-Status** auf jedem Host:

```bash
curl -sk https://<ip>:9440/api/status | jq '.libp2p.registry_sync'
# erwartet pro peer:
#   { rounds: > 0, converged: true, last_round_at: <recent>,
#     consecutive_timeouts: 0, last_error: null, in_flight: false }
```

**SLO-Test** (verletzte Konvergenz-Garantie? Endpoint folgt mit ADR-022,
hier zu Fuss):

```bash
# Auf MacBook (Daemon-Devel-Host)
node -e "
  const status = await fetch('https://localhost:9440/api/status', { ... });
  const j = await status.json();
  const sync = j.libp2p.registry_sync;
  const violations = Object.entries(sync).filter(([_, s]) => !s.converged && s.last_round_at);
  console.log('Violations:', violations);
"
# erwartet: leeres Array nach 60s Mesh-Uptime
```

**Reconnect-Test**:

1. Auf einer Node Daemon stoppen.
2. Auf anderen Nodes nach ~30s `peer:disconnect` im Audit-Log sehen.
3. Daemon wieder starten.
4. `peer:connect` und neuer Sync-Round innerhalb 60s erwartet.

**Safety-Valve-Test**:

```bash
# mit Admin-Token (siehe TOKEN_STORE)
curl -sk -X POST -H "Authorization: Bearer <admin-token>" \
  https://localhost:9440/api/registry/republish
# erwartet: { status: 'ok', message: 'Registry republish triggered' }
# Audit-Log zeigt REGISTRY_REPUBLISH Event
```

### 6. 24h-Beobachtung

Was tracken (auf MacBook in einem File `docs/live-test-2026-05-x.md`):

- Per-Stunde Mesh-Hash-Snapshot
- Memory-Verbrauch pro Daemon (`ps aux | grep thinklocal`)
- Anzahl Sync-Rounds pro Peer-Paar (aus `/api/status.libp2p.registry_sync`)
- Audit-Log-Volumen (`audit_events`-Counter)
- Auffaelligkeiten: hangups, buffer-overflows, divergence > 60s

Bei Auffaelligkeiten direkt einen Folge-PR aufmachen, nicht draufpatchen.

### 7. ADR-022 Owner-wins-Semantik (Folge-PR)

**Problem** (gefunden im CR durch gpt-5.5):

`markAgentOffline()` und `removePeerCapabilities()` in `registry.ts`
schreiben in fremde Agent-Namespaces im CRDT. Das verletzt die
"Owner-wins"-Garantie: Konkurrente Sync-Runden koennen tote Caps wieder
auferstehen lassen oder falsche Deletions verursachen.

**Loesung-Skizze** (CO mit 2-3 Modellen vorher!):

- Owner-wins enforcen: Code mutiert NUR Caps mit `cap.agent_id === self.agent_id`.
- Peer-Fremdstatus (z.B. "Peer offline") kommt in eine **separate** observation
  map, NICHT ins Automerge-Doc.
- Migration: bestehende falsch-attributierte Caps (aus alten Daemon-Runs)
  bleiben erstmal liegen oder werden per Heuristik geprunt.
- Routing-Filter erweitert: `caps.filter(c => self.agent_id === c.agent_id ||
  peer.id === c.agent_id)`.

**Setzt voraus**: PR #134 gemerged + 24h stabil.

### 8. ADR-023 Backpressure/Chunking (deferred)

Erst aufmachen wenn:
- Capability-Anzahl pro Mesh > 100, ODER
- Mesh-Groesse > 10 Nodes, ODER
- Erste real beobachtete Yamux-Stream-Abbrueche bei initialem Sync

Bis dahin schuetzen 8 MiB Frame-Limit + 16-Message-Buffer-Cap.

### 9. ADR-021 Skill Health & Lifecycle implementieren

**Status**: ADR ist `Proposed`, Konsens komplett, Streitpunkte entschieden
(siehe `docs/architecture/ADR-021-skill-health-lifecycle.md`).

**Voraussetzung**: ADR-022 Owner-wins muss durch sein — sonst kann ein Peer
mein eigenes `availability`-Feld ueberschreiben.

**Erste Implementierungs-Tranchen** (jede ein eigener PR):

- 9.1: `SkillHealthMonitor` + Manifest-Erweiterung (`healthcheck`)
- 9.2: Migration aller `builtin-skills/*.ts` auf neuen `healthcheck.fn()`
- 9.3: `/api/status` erweitern um Skill-Health-Block
- 9.4: Audit-Event-Typ `SKILL_HEALTH_TRANSITION`
- 9.5: Dashboard-Visualisierung (gelb fuer `consecutive_failures > 0`)

### 10. better-sqlite3 ABI-Mismatch fixen

```bash
cd packages/daemon
npm rebuild better-sqlite3
npm test
# 227 falsche Failures sollten weg sein
```

Pro Host wo das beisst:
- MacBook (Node 26 vs Modul-Build 127)
- Wahrscheinlich andere Nodes nach Node-Upgrade ebenfalls

**Folgekosten ignorieren** funktioniert nicht: ohne diese Failures kann CI
nicht „grueun werden ohne Ausnahmen", und alle nachfolgenden PRs muessen sich
durch dasselbe Rauschen kaempfen.

## Was NICHT zu tun ist

- **Den Genesis-Blob auf einem Host produzieren und manuell auf andere kopieren.**
  Er **muss** im Code stehen. Anderer Weg verstoesst gegen die Code-as-Truth-
  Annahme.
- **Den Production-Guard ausschalten via TLMCP_ALLOW_BOOTSTRAP_GENESIS=1
  als Workaround.** Das Env-Flag ist nur fuer Edge-Cases (z.B. erster Daemon
  im Mesh-Bootstrap-Szenario), nicht fuer Production-Rollout.
- **v1 ohne Genesis-Blob mergen.** Macht ein Live-Deploy garantiert kaputt.

## Komm-Punkte zum MacBook

Wenn du (Mac Mini Claude) etwas brauchst:

- **Code-Reviews / Konsens**: PAL ist auf jedem Host installiert, du kannst
  selbst `pal:codereview` / `pal:consensus` aufrufen.
- **Mesh-Status anschauen**: jeder Daemon hat ein lokales `/api/status`.
- **Den MacBook-User fragen**: wenn etwas unklar bleibt — der weiss den
  Plan und kann zwischen den Sessions vermitteln.
