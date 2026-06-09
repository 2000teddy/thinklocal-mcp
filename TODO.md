# TODO.md — thinklocal-mcp

Vollständiger Entwicklungsfahrplan, Aufgabenstruktur und Zukunftsideen.
Priorität: 🔴 Kritisch | 🟠 Hoch | 🟡 Mittel | 🟢 Niedrig | 💡 Idee/Zukunft

---

## Follow-ups aus Code-Reviews :

- [ ] 🟠 **ADR-024 Canonical-Cert-Retention (DRAFT-PR, wartet auf Review)** — schließt den ADR-022-Sender-Flip für CA-owner (`.94`) + own-CA (`.56`/`.222`): `loadOrCreateTlsBundle` behält jetzt ein re-enrolltes kanonisches Cert, das die eigene PeerID trägt UND unter einer gepinnten Attesting-CA verifiziert (statt es zu Legacy zu regenerieren). Branch `agent/claude-code/canonical-cert-retention`. CO/CR(gpt-5.5)/PC grün, 0 CRITICAL/HIGH, 941+6 Tests. **MERGE-/DEPLOY-BLOCKING vor Rollout (CR/PC-MEDIUM):** (a) CA-Gültigkeit (`notBefore/notAfter`) im Retention-Verify fail-closed prüfen + Test; (b) Trust-Distribution-Lifecycle bei retained fremd-Certs (Pairing/Refresh/Rotation) absichern + Test. **KEIN Deploy/Re-Enroll/Merge ohne Christians Wort.** Danach: Re-Enroll `.56`/`.222`/`.94` → 100% canonical-emit. (`.52`/TH01/TH02 bereits canonical-emit; `.56`/`.222`/`.94` aktuell legacy-emit-aber-accept-both.)
- [x] 🟠 **Owner-wins-Flanke (ADR-020 v2.2)** — **ENTSCHIEDEN + UMGESETZT 2026-06-05 (v0.33.0)**: `pal:consensus` (3 Modelle, einstimmig) → HYBRID. `availability` ist jetzt **direct-only** (owner-gegatete Side-Map, raus aus dem Automerge-CRDT; `importPeerCapabilities(caps, writer)` HARD-rejected fremde Owner + Metrik `rejected_foreign_availability_write`; Guardrail-Test beweist Relay-Verwerfung). Topologie geklärt: dense Heim-LAN → direct-only gültig. Siehe ADR-020 v2.2.
- [ ] 🟡 **Owner-wins Phase-2: signierte Per-Key-Origin-Provenance** (ADR-020 v2.2 Phase-2) — additiv: Origin signiert `{agent_id, skill_id, availability, counter}`, Merge verifiziert, Relays reichen unverändert durch (echtes owner-wins auch über Relays). Schema-Feld `provenance` im RegistrySync-Payload bereits reserviert (`messages.ts`) — kein Retrofit. Krypto + ggf. eigener Konsens. Nötig v.a. falls Mesh sparse/partitioniert wird. **Verworfen:** Relay-Ingress-Attestation („relay-witness-wins").
- [x] 🟠 **JWT-on-mTLS-Flanke (Architektur-Entscheid)** — **ENTSCHIEDEN + UMGESETZT 2026-06-05 (v0.32.1)**: `pal:consensus` (3 Modelle, einstimmig) → **Option A „mTLS-only"**. Der tote, nie verdrahtete JWT-Hook (`api-auth.ts`/`registerApiAuth`) wurde entfernt; SECURITY.md + THREAT-MODEL.md auf das gelebte mTLS-only-Modell korrigiert (Doku≠Realität war die Schuld). Roadmap-Notiz: bei Internet-Exposure JWT VORHER aktivieren (`@fastify/jwt` bleibt als Dep verfügbar).
- [x] 🔴 **.55 EHOSTUNREACH — mDNS-Interface-Pin vergiftet macOS connectx-scoped-routing** (Befund + Fix 2026-06-08, **v0.34.5**) — Auf dem dual-homed macOS-Node .55 (en10 = Mesh + zweite Default-Route-NIC) brach die **blosse Anwesenheit** des Daemons das connectx-scoped-routing **prozessweit** (10.10.10/24 → REJECT, EHOSTUNREACH für ALLE Connects, auch plain `node`). Root-Cause: der Daemon ruft kein `route`/`IP_BOUND_IF` — die **einzige** Interface-Scoping-Op ist der mDNS-Pin `bonjour-service {interface: meshIp}` → `setMulticastInterface`. (#162-Escape-Hatch half NICHT, sitzt im Outbound-Connect statt im mDNS-Socket.) **Fix (v0.34.5, PR #164) — ZWEI Quellen, ein Flag `disable_mdns_interface_pin`:** (1) **Bonjour-Pin** (Startup) → Bonjour ohne `interface` (nur `bind:0.0.0.0`); (2) **`@libp2p/mdns`** (zweite multicast-dns-Instanz, 20s, re-vergiftet ~27s nach Start — Live-Befund Operator) → Service unter demselben Flag weggelassen (`resolveLibp2pMdnsEnabled`). A-Record-Hygiene + Fail-Closed bleiben aktiv; libp2p startet weiter (nur mDNS-Discovery aus), Mesh via `static_peer`/HTTPS. Siehe ADR-019 „.55 connectx-Vergiftung" + Nachtrag. **Live-Re-Test (beide mDNS aus, commit 0aa72bc): RE-VERGIFTUNG BLEIBT → dritte, HOST-SEITIGE Quelle bestätigt** — der laufende Daemon macht ausgehende `connectx`-Dials auf einem Host mit ZWEI Default-Routes (en10+en0)+IFSCOPE; ein fehlschlagender gescopter Dial lässt macOS einen REJECT-Eintrag auf `10.10.10/24` installieren (Host-Routing-Fehlkonfig, kein Code). #164 **lindert** (mDNS-Quellen weg), ist aber **kein voller Fix**. **DURABLE Fix = host-seitig (Christian): en10 als einzige/primäre Default-Route bzw. persistenter Route-Heal auf .55.** Empfehlung beim Flag-Einsatz: IMMER mit `allowed_mesh_cidrs` + `static_peers`.
- [ ] 🔴 **.55 host-seitiger Dual-Default-Route-Fix (Christian, sudo)** — Durable Lösung für die .55-Re-Vergiftung (siehe Eintrag oben). Der laufende Daemon triggert via fehlschlagender `connectx`-Dials einen REJECT-Eintrag auf `10.10.10/24`, weil .55 ZWEI Default-Routes hat (en10→10.10.10.1 + en0→10.10.25.1) + IFSCOPE. Optionen: (a) Network-Service-Order so dass en10 primär ist; (b) `en0`-Default entfernen/depriorisieren; (c) persistente korrekte Route für `10.10.10/24` ohne REJECT (LaunchDaemon/`route -nv add`). KEIN Daemon-Code adressiert das — #164 lindert nur. Entscheidung + Umsetzung: Christian. .55 ist aktuell stabil geparkt (Daemon gestoppt, Route geheilt).
- [ ] 🟡 **CLI-Join: request-lokale TLS-Skip statt prozessweit** (CR gpt-5.5, Fix v0.30.1) — `cmdJoin` setzt für den certlosen `/onboarding/join` aktuell prozessweit `NODE_TLS_REJECT_UNAUTHORIZED=0` (im `finally` restauriert, kurzlebige CLI). Sauberer: request-lokaler undici-`Agent({connect:{rejectUnauthorized:false}})` + `dispatcher`. Erfordert `undici` als CLI-Dependency (aktuell nur in `packages/daemon`); bewusst zurückgestellt, da der Fix abhängigkeitsfrei sein sollte.

## Code-Review beim dokumentieren entdeckt :

- [x] 🔴 **Unsicherer Vault-Default** — behoben: statt bekanntem Default wird die Vault-Passphrase jetzt aus `TLMCP_VAULT_PASSPHRASE`, OS-Keychain oder einem zufaellig generierten persistenten Wert geladen.
- [x] 🔴 **Service-Setup deaktiviert TLS standardmaessig** — geklaert und kodifiziert: lokaler Default ist jetzt explizit `localhost-only` via `runtime_mode=local`; Bind-Adresse, TLS-Verhalten und lokale Client-URL werden daraus konsistent abgeleitet. README, INSTALL und SECURITY wurden auf dieses Betriebsmodell ausgerichtet.
- [x] 🟠 **GitHub-Credentials werden im Klartext persistiert** — behoben: `GITHUB_TOKEN` wird nicht mehr automatisch in `~/.git-credentials` geschrieben; Klartextpersistenz ist jetzt nur noch ueber `TLMCP_ALLOW_PLAINTEXT_GIT_CREDENTIALS=1` moeglich.
- [x] 🟠 **Linux-Claude-Desktop-Pfad inkonsistent** — behoben: Linux nutzt jetzt konsistent `~/.config/Claude/claude_desktop_config.json`.
- [x] 🟡 **Dokumentiertes Sicherheitsniveau und Runtime-Verhalten driften auseinander** — fuer den lokalen Default behoben: Runtime, Installer und Doku beschreiben jetzt ein einheitliches localhost-only Modell. Offen bleibt die spaetere saubere mTLS-Standardisierung fuer echten Mesh-Betrieb.

## Skill Health & Lifecycle (entdeckt 2026-05-17)

- [x] 🔴 **CRDT-Registry repliziert nicht — eingefrorene Inkonsistenz im Mesh** (entdeckt 2026-05-17, **BEHOBEN/verifiziert 2026-06-04**)
  **Aufloesung (Verify-First 2026-06-04):** NICHT mehr reproduzierbar — behoben durch **ADR-020 v1 (PR #139, 2026-05-18)**, einen Tag nach dem Befund. Root-Cause (Placeholder-Stream-Handler in `libp2p-runtime.ts` schlossen `/thinklocal/mesh/registry/1.0.0`-Streams sofort) war exakt der ADR-020-„Smoking-Gun"-Fix. **Live-Belege (heutiges Mesh):** (a) TH01s `/api/capabilities` zeigt **16 Caps aus 6 distinkten Nodes** gemerged (kein Single-View); (b) TH01 + .94 melden konsistent (2 Passes) `registry_sync conv=5/5` — Automerge `generateSyncMessage===null` = kein Diff = in Sync; (c) je 8 libp2p-Verbindungen; (d) der vom TODO geforderte **periodische idempotente Resync existiert** (`RegistrySyncCoordinator`, 45s-Tick + `republish()`). ~~Offen-optional: expliziter HTTP-`/api/registry/republish`-Endpoint~~ → **erledigt/verifiziert 2026-06-04**: Endpoint existiert (`dashboard-api.ts`, mTLS-gated, Audit `REGISTRY_REPUBLISH`), live getestet (auth → `{status:ok}` + Audit-Delta) und jetzt mit Regressionstest abgedeckt (`dashboard-api.test.ts`: ok/503/500/429). Hinweis: .56/.222 antworten TH01 mit `SELF_SIGNED_CERT_IN_CHAIN` (eigene CA, separates Trust-Bundle-Thema — NICHT Registry-Replikation; ihre Caps replizieren via libp2p trotzdem).

  ---
  _Original-Befund (2026-05-17, historisch):_ Mesh mit 5 Nodes: `MacBook-Pro` (10.10.10.55), `ai-n8n-local` (.222), `iobroker` (.52), `influxdb` (.56), `minimac-60` (.94). Heartbeats liefen sauber, aber `/api/capabilities` lieferte auf jedem Peer eine **andere** Sicht mit **anderem Hash**:
  - ai-n8n-local: 7 caps, hash `cdc348dec...`
  - iobroker: 9 caps, hash `dea131900...`
  - influxdb: 10 caps, hash `2eb192295...`
  - minimac-60: 8 caps, hash `de784c02a...`
  - MacBook (lokal, frisch nach Reboot): 1 cap (nur self), hash `f4431d978...`

  **Symptome:**
  - Mein MacBook-Daemon `pushed` seine eigene Capability **nicht** ins Mesh — kein Peer sieht ihn unter Host-ID `813bdd161fea12ab`, obwohl er sie alle als Peer sieht und `peers_online = 4` meldet.
  - Inkonsistenz auch zwischen Peers untereinander: ai-n8n-local sieht **sich selbst** nur mit `system-monitor`, andere Peers sehen ai-n8n-local zusaetzlich mit `thinklocal-ollama-agents` → eigene Self-Sicht weicht von Mesh-Sicht ueber sich ab.
  - Zustand persistiert ueber Minuten (kein Konvergenz-Fortschritt nach 6 min Daemon-Uptime). Das ist nicht „Sync braucht Zeit", das ist tot.

  **Heisse Verdachts-Punkte:**
  - libp2p-Stream `/thinklocal/mesh/registry/1.0.0` ist offenbar in mindestens eine Richtung kaputt — pro Peer-Paar unterschiedlich
  - Heartbeat-Stream (`/thinklocal/mesh/heartbeat/1.0.0`) laeuft → libp2p-Multiplexing per se geht
  - Registry-Push triggert nur bei lokalem Capability-Change, nicht periodisch? → Bei kurzer Daemon-Uptime kein Push und keiner fragt aktiv ab
  - Reverse-Connectivity-Check fehlt: Peer sieht mich, aber kann er mich auch erreichen?

  **Naechste Schritte:**
  - `audit_events`-Delta pro Daemon pruefen: laufen REGISTRY_PUSH/REGISTRY_PULL events?
  - libp2p `/api/status` connected_peers anschauen (vorhin bei influxdb war das 0 trotz peers_online=3)
  - Periodischen Registry-Resync einbauen (z.B. alle 60 s, idempotent)
  - Force-Push-Endpoint `/api/registry/republish` zum manuellen Anstoss
  - ADR-NNN-registry-replication-recovery.md

  **Beleg:** Section dieses TODO-Eintrags + Audit-Events des heutigen 21:35-Reboot-Tests. Nicht reproduzierbar bevor 2026-05-17 — Hypothese: getriggert durch die Crash-Loops im Daemon-Start vor dem Reboot, die libp2p-Streams zwischen Peers in einen schraegen Half-Open-Zustand gebracht haben.

  **Update 2026-05-18 — Root Cause gefunden + 4-Modell-Konsens:** `pal:consensus` mit `gpt-5.2` (9/10), `gemini-3-pro-preview` (9/10), `gpt-5.5` (8/10), `MiniMax-M2.7` (7/10) plus direkte Code-Verifikation:
  - **Smoking Gun:** `packages/daemon/src/libp2p-runtime.ts:335-356` registriert fuer **alle** Mesh-Protokolle (heartbeat, registry, tasks, audit) Placeholder-Handler, die eingehende Streams sofort `close()`/`abort()`. Sync ueber libp2p hat nie funktioniert — Heartbeats laufen nur deshalb, weil sie HTTPS-basiert in `mesh.ts` implementiert sind, nicht libp2p.
  - **Zweite Schicht:** Kein periodischer Anti-Entropy-Timer, kein `Automerge.initSyncState()` auf `peer:connect`. Selbst nach Handler-Fix wuerde Konvergenz nicht garantiert.
  - **Erweiterte Findings (gpt-5.5 + MiniMax-M2.7):** Message-Framing fehlt, Per-Peer-Singleflight fehlt, Bidirektionaler Sync fehlt, Half-open Connections leakt SyncState, `last_sync` im CRDT-Doc verhindert Konvergenz mathematisch, Owner-wins wird durch `markAgentOffline`/`removePeerCapabilities` verletzt. Automerge-Sync ist strikt bilateral — transitive Konvergenz erst ueber mehrere Rounds.
  - **Hypothese „Crash-Loop-Folge" ist falsch** — der Bug war von Anfang an im Code, fiel nur jetzt durch den 5-Node-Test auf.
  - **Fix:** siehe `docs/architecture/ADR-020-registry-replication-recovery.md` — aufgeteilt in **v1** (5 Blocker: echte Handler, Framing, Coordinator + Singleflight, bidirektionaler Sync, Timeout-Cleanup) und **v2** (5 Robustheits-Punkte: `last_sync` raus, Owner-wins, libp2p-connected-SLO, Heads-Hash, Backpressure). v1-Konvergenz-Garantie: 120 s; v2: 60 s.

- [x] 🔴 **Boot-Race InfluxDB-Skill (Symptom-Fix)** — Lokal auf `influxdb`-Host: `~/.config/systemd/user/thinklocal-daemon.service` ergaenzt um `After=influxdb.service` + `Wants=influxdb.service`. Daemon startet jetzt erst nach InfluxDB, der einmalige HealthCheck beim Boot trifft auf einen ready Service. (2026-05-17) **Im Repo gespiegelt 2026-06-04 (v0.31.1):** `service-dependencies.ts` (generisch aus `requirements.services` der Skill-Manifests) erzeugt `After=/Wants=`-Zeilen NUR fuer Services, deren systemd-Unit auf dem Host existiert; verdrahtet in der CLI-Bootstrap (`thinklocal.ts`) UND `install.sh`. Frischer Install = gleicher Boot-Race-Schutz wie der manuell gepatchte .56-Host, ohne influxdb-Hartkodierung. (`build-deb.sh` ausgenommen — Build-Zeit, Host-Check waere falsch.)

- [x] 🔴 **Generisches Skill-Health-Monitoring** — **IMPLEMENTIERT 2026-06-04 (v0.31.0)**: `SkillHealthMonitor` (skill-health-monitor.ts) — periodische idempotente Health-Checks (Hysterese 2-up/3-down, linear 30s/60s, Jitter ±20%, Single-Flight, AbortController-Timeout, graceful stop). State-Flip → `registry.setAvailability` (Owner-only, `availability`-Attribut statt Remove, ADR-021 §4) + Audit `SKILL_HEALTH_TRANSITION` + Registry-Republish. Routing-Lookups (`findBySkill`/`findByCategory`) filtern unhealthy. InfluxDB-Skill wird jetzt IMMER registriert (Boot-Race von 2026-05-17 geheilt). `/api/status.skills` exponiert den State. CR gpt-5.5: 1 HIGH (Routing-Filter) + 2 MEDIUM + 2 LOW gefixt. Generisch erweiterbar (Ollama/Telegram).  _Original-Befund:_ **Konsens 2026-05-18 abgeschlossen** (`gpt-5.2` + `gemini-3-pro-preview`), ADR siehe `docs/architecture/ADR-021-skill-health-lifecycle.md`. Aktuell prueft `index.ts` Skill-Requirements (z.B. `services: ["influxdb"]`) genau einmal beim Daemon-Start (siehe `influxdbHealthCheck()` in `builtin-skills/influxdb.ts`). Faellt der Service spaeter aus oder kommt er erst nach dem Daemon hoch, wird der Skill nie de- oder re-registriert. Das ist ein generelles Pattern-Problem fuer ALLE Skills auf ALLEN Daemons mit externer Abhaengigkeit (InfluxDB, Telegram, Ollama, kuenftige). Diskussionspunkte fuer den Konsens:
  - **Wo:** Skill-Manifest mit standardisiertem `healthcheck`-Feld (URL/Command/Funktion) vs. Skill-Adapter mit Plugin-Interface?
  - **Wie oft:** Festes Intervall, exponentielles Backoff bei Down, oder Event-getrieben (z.B. systemd-Notify)?
  - **State-Machine:** wie unterscheiden wir "transient unhealthy" (Flap, ignorieren) von "really gone" (de-register)? Schwellwert? Hysterese?
  - **Gossip-Impact:** Capability-Hash aendert sich bei jedem Flap → Sync-Sturm im Mesh. Damping noetig?
  - **Re-Registration:** Hot-Reload des Skills im laufenden Daemon, oder erfordert es einen Subprocess-Restart?
  - **Audit:** Jeder Health-Flip als Event ins SQLite-Log? (Volumen vs. Forensik-Wert)
  - **Dashboard:** Wie visualisieren wir "degraded" Skills — eigene Farbe, separate Spalte, Health-History?
  - **Tests:** Wie testen wir intermittent service availability ohne Flaky-Tests? (Mock-Server mit kontrollierten Ausfaellen?)
  - **Beziehung zu ADR-004 Heartbeat:** Bauen wir auf dem bestehenden Cron-Heartbeat-System auf oder eigenes Subsystem?
  - **Mesh-Sicht:** Was passiert wenn Peer X den Skill als healthy meldet, ich aber als degraded? Wer gewinnt?

  **Triggered by:** InfluxDB Boot-Race 2026-05-17 (Daemon startete 15:55:36, HealthCheck 15:55:37, InfluxDB ready erst 15:56:12 — Skill war 70 Minuten lang fuer das Mesh unsichtbar bis manueller Daemon-Restart). systemd-Fix loest das lokale Symptom, nicht das Pattern.

  **Konsens-Entscheidungen (siehe ADR-021):**
  - Zentraler `SkillHealthMonitor` (kein Plugin-Pattern in Skills)
  - State-Machine binaer (HEALTHY/UNHEALTHY), DEGRADED nur UI-derived
  - Hysterese 2-up / 3-down, Flap-Damping im Monitor, nicht im CRDT
  - Backoff linear: 30 s healthy / 60 s unhealthy (NICHT exponentiell)
  - Registry: `availability`-Attribut, NICHT entfernen (Industrie-Standard, weniger CRDT-Churn, Debug-Sicht bleibt)
  - Owner-wins erzwingen (Voraussetzung: ADR-020 v2.2)
  - Skill bleibt geladen, nur Routing toggelt — kein Hot-Reload

## Knoten-Identität — PeerID-gewurzelt (ADR-022, entschieden 2026-06-03)

> **Branch `agent/claude-code/adr022-peerid-identity` = MERGEBAR (2026-06-04).** Schritt 1 + Voraussetzung #0 + die 2 HIGH / 3 MEDIUM / LOW Security-Fixes sind drin, **2× von gpt-5.5 reviewt** (beide HIGH bestätigt geschlossen, keine neuen HIGH+), 784 Tests grün, tsc clean. Push/PR/Merge macht der Operator. **Folge-Schritt (NICHT in diesem Branch):** Cert-SAN-Cutover auf `node/<PeerID>` (admin-seitiges CSR-Signing auf .94) — erst DER setzt `peerIdVerified` über den mTLS-/Noise-Pfad und aktiviert die kanonische PeerID-Auflösung; bis dahin bleibt sie fail-closed inert.

- [ ] 🔴 **Identität auf libp2p-PeerID umstellen** — Konsens (2 pal:consensus-Läufe, einstimmig Option 1),
  `docs/architecture/ADR-022-peerid-rooted-identity.md` (Accepted). Heute drei parallele Identifier
  (hostname-SAN, hashed-hardware stable-node-id, libp2p-PeerID) → Drift → SKILL_ANNOUNCE-403.
  **403-Root-Cause am Code belegt:** `'Unknown sender'` (`agent-card.ts:210-212`), App-Layer (HTTP-403,
  kein TLS-Fehler → CA-Trust ist NICHT der Blocker; die frühere Trust-Bundle-Hypothese ist damit erledigt).
  **Umsetzung (Schritt 1 erledigt — Commit `1683396`, s. CHANGES 2026-06-03):**
  - [x] 🔴 **VORAUSSETZUNG: libp2p-Ed25519-Key PERSISTIEREN** — ✅ ERLEDIGT (Commit `8718f0b`, `libp2p-identity.ts`): PeerID stabil über Neustarts, Akzeptanztest grün, crash-durable+0600. `@libp2p/crypto`+`@libp2p/peer-id` (v5, gepinnt).
  - [ ] Ed25519-Key → CSR mit SAN `spiffe://thinklocal/node/<PeerID>` → Mesh-CA signiert → Cert ersetzen. (BLOCKER: admin-seitiges CSR-Signing auf .94, cross-node.)
  - [~] Startup-Assertion (Divergenz PeerID/SAN/authz, laut; strict via `TLMCP_STRICT_IDENTITY`) — ✅ ERLEDIGT.
  - [x] **Phase-3-Sender-Flip (envelope.sender → `node/<PeerID>`) code-seitig** — ✅ ERLEDIGT (v0.34.0, flag `daemon.emit_canonical_sender`, default OFF, Interlock „Cert-SAN VOR Sender-URI", `resolveSelfIdentity()`). CR gpt-5.5: 3 HIGH + 2 MEDIUM gefixt.
  - [x] **Phase-3-Härtung (TH02-Live-Flip-Befunde)** — ✅ ERLEDIGT (v0.34.1): Card-Re-Fetch/Identity-Supersession nach Cert-Attestierung (`markPeerIdVerified(peerId, senderUri)`, behebt 403-Deadlock + mDNS-Eviction-DoS-HIGH), Issuer-Pin-Symmetrie im Flip-Gate (#159-HIGH), Guard-Reihenfolge (#159-MEDIUM), `confirmPeerDiscovery` (sticky-endpoint-MEDIUM), Pairing pubkey-basiert (CR-MEDIUM-2). CR gpt-5.5: HIGH+MEDIUM+LOW gefixt, 0 Residual.
  - [x] **TH02-Live-Re-Verifikation (v0.34.1)** — ✅ ERLEDIGT (2026-06-06): TH01-Hub + TH02 auf v0.34.1; TH02-Flip gegen v0.34.1-Nachbar TH01 grün (Announces 200, TH02 kanonisch, Card-Re-Fetch greift).
  - [x] **Attesting-CA-Pin Auto-Derive (Fleet-Voraussetzung 1)** — ✅ ERLEDIGT (v0.34.2, pal:consensus): aus eigener `ca.crt.pem` abgeleitet (env-override + `none`-Escape + Single-Cert-Guard), supersediert das manuelle Env-Verdrahten. Jeder v0.34.2-Node bekommt den Pin automatisch.
  - [x] **Bug #2: Canonical-Sender-Akzeptanz auf ALLEN v0.34.2-Nachbarn** — ✅ ERLEDIGT (v0.34.4): manche Empfänger (.56/.222) lernten den `node/<PeerID>`-Sender-Key nicht (Legacy-Eintrag ohne gelernte PeerID). Fix: attestierte PeerID via TLS-Source-IP an den Host-Eintrag binden (`markPeerIdVerified(peerId, senderUri, remoteHost)`, transaktional). CR gpt-5.5: 2 HIGH + MEDIUM + LOW gefixt.
  - [ ] **OFFEN (Ops, GATE):** Produktiv-Flotten-Flip (.56/.52/.222) — NUR auf Christians ausdrückliches Wort. Reihenfolge: erst ALLE Nachbarn auf **v0.34.4** (Bug-#2-Fix empfangsseitig), DANN per-Node-Flip + Noise-Re-Handshake + Gegenprobe (SKILL_ANNOUNCE 5/5); danach `TLMCP_STRICT_IDENTITY=1` + Legacy-Pfad entfernen.
  - [ ] **Follow-up (nicht-blockierend):** (a) Mesh-Peer-Eintrag bei Card-Re-Fetch auf die kanonische agentId umschlüsseln (heute funktional via PeerID-Auflösung gelöst, nur kosmetisch); (b) token-onboarded TLS-Bundle beim Laden gegen `ca.crt.pem` validieren (tls.ts, CR-MEDIUM, pre-existing); (c) dedizierter mTLS-Integrationstest `issuerCertificate.fingerprint256 === certFingerprint(ca.crt.pem)` (live bereits bewiesen).
  - [~] **Outbound-Connect-Bug .55 (dual-homed macOS, EHOSTUNREACH)** — Diagnose+Escape-Hatch ✅ ERLEDIGT (v0.34.3, `mesh-connect.ts`: `TLMCP_DEBUG_CONNECT=1` + `TLMCP_DISABLE_OUTBOUND_PINNING=1`). **OFFEN:** Live-Loop mit .94 — Debug-Logs von .55 auswerten, bestätigen ob `autoSelectFamily=false`/Default-Source der Fix ist; ggf. macOS-Interface-Scope-Root-Cause nachziehen.
  - [x] `getPeerPublicKey` aus verifizierten Agent-Cards **auf die kanonische PeerID keyen** (fail-closed) + `SKILL_ANNOUNCE`-Retry bei „Unknown sender" (Timing-Baustelle b) — ✅ ERLEDIGT (`mesh.resolvePeerPublicKey` + `index.ts`).
  - [ ] Clone-Detection (VM/Pi-Golden-Image dupliziert Key) als Launch-Blocker.
  - [x] Dual-Accept-Fenster beim Cutover (alt `host/…` + neu `node/<PeerID>`) — ✅ ERLEDIGT (WS-1/2/3, Empfangsseite akzeptiert beide Formen).
  - Gehört zu PR #74/#139 (Legacy-Hostname-URI-Migration).

## Phase 1 — Fundament: Identität, Verschlüsselung, Discovery (Wochen 1-3)

### 1.1 Agent-Identität & Kryptografie
- [x] 🔴 ECDSA Keypair-Generierung pro Agent (P-256) — `identity.ts` (2026-04-03)
- [x] 🔴 SPIFFE-URI-Schema implementieren: ursprünglich `spiffe://thinklocal/host/<hostname>/agent/<type>` — `identity.ts` (2026-04-03), umgestellt auf `host/<stableNodeId>/agent/...` in PR #74 (2026-04-07)
- [x] 🔴 Device-Fingerprinting für eindeutige Agent-Identifikation — `identity.ts` computeDeviceFingerprint() (2026-04-03)
- [x] 🔴 **Stable Node-ID** — 16-hex aus sortierten MAC-Adressen + CPU + Plattform, persistiert in `keys/node-id.txt`. Loest "Hostname-Drift" auf macOS, wo Bonjour bei Kollisionen den Namen aendert (`minimac-200` -> `-1014` -> ...) (PR #74, 2026-04-07)
- [x] 🔴 Lokale CA (Certificate Authority) — `tls.ts`, Self-Signed RSA-2048 CA (2026-04-03)
- [x] 🔴 Kurzlebige X.509-Zertifikate (90d TTL) mit Auto-Renewal bei <7 Tagen — `tls.ts` (2026-04-03)
- [x] 🟠 Zertifikat-Widerrufsliste (CRL) — `crl.ts` CertificateRevocationList (2026-04-05)

### 1.2 Trust Bootstrap
- [x] 🔴 SPAKE2 PIN-Zeremonie für Erstverbindung zweier Agents — `pairing.ts` + `pairing-handler.ts` (2026-04-03)
- [x] 🔴 PIN-Anzeige im Terminal (CLI) — POST /pairing/start generiert 6-stellige PIN (2026-04-03)
- [x] 🟠 QR-Code-Alternative für mobile/Desktop-Geräte — `qr-pairing.ts` + qrcode-terminal (2026-04-05)
- [x] 🟠 Fallback: Statische Peer-Liste in Konfigurationsdatei — `config.ts` static\_peers + TLMCP\_STATIC\_PEERS env (2026-04-05)
- [x] 🟡 Device-Pairing-Persistenz (einmal gepairt → automatisch vertraut) — `PairingStore` in JSON-Datei (2026-04-03)
- [x] 🔴 **TrustStore-Aggregation** — `trust-store.ts` baut aggregiertes CA-Bundle aus eigener CA + allen gepairten Peer-CAs, fuettert Fastify-mTLS und undici-Dispatcher (PR #75, 2026-04-07)
- [x] 🔴 **Stabile Node-Identitaet** — `loadOrCreateStableNodeId()` aus Hardware-Fingerprint statt OS-Hostname, persistiert in `~/.thinklocal/keys/node-id.txt` (PR #74, 2026-04-07)
- [x] 🔴 **CA-Subject-Disambiguation** — `createMeshCA(meshName, nodeId)` baut nodeId in CN ein, sonst koennen Peer-CAs mit gleichem Subject einander beim mTLS-Handshake ueberschreiben (PR #77, 2026-04-07)
- [x] 🟠 **SSH-Bootstrap-Trust** — `scripts/ssh-bootstrap-trust.sh` nutzt bestehenden SSH-Trust-Anchor zwischen Operator-eigenen Nodes statt PIN-Zeremonie. ssh-Reachability + base64-encoded JSON via stdin, idempotent. Fuer Single-Operator-Mesh praktischer als manuelle PINs. (PR #78, 2026-04-07)
- [x] 🟠 **Hot-Reload TrustStore** — IMPLEMENTIERT 2026-04-12 (PR #117). agent-card.ts reloadTlsContext() + pairing-handler trustStoreNotifier.rebuild()
- [x] 🟡 **Token-basiertes Onboarding (`tlmcp init` / `tlmcp join`)** — IMPLEMENTIERT 2026-04-13 (PRs #124-#126). token-store.ts + token-api.ts + CLI + Trust-Bundle-Propagation. 5-Node Mesh mit ioBroker per Token gejoined.
- [x] 🟠 **Trust-Bundle-Propagation** — IMPLEMENTIERT 2026-04-13. Admin uebergibt beim Token-Join alle Peer-CAs. Neuer Node kann sofort mit dem gesamten Mesh kommunizieren.

### 1.3 Mesh-Networking
- [x] 🔴 libp2p Node.js/TypeScript Integration — `libp2p-runtime.ts` + Config/Agent-Card/Discovery-Integration, dual-stack neben HTTP(S) (2026-04-05)
- [x] 🔴 Noise Protocol für verschlüsselte Kanäle — libp2p Runtime nutzt `@chainsafe/libp2p-noise` fuer Peer-Sessions (2026-04-05)
- [x] 🔴 mTLS über alle Verbindungen — Fastify HTTPS + undici Dispatcher mit CA (2026-04-03)
- [x] 🔴 mDNS Service Discovery (`_thinklocal._tcp.local`) — `discovery.ts` (2026-04-03)
- [x] 🔴 TXT-Records: Agent-ID, Capability-Hash, Control-Endpoint, Cert-Fingerprint — `discovery.ts` (2026-04-03)
- [x] 🟠 Klarer Betriebsmodus für lokales `localhost-only` vs. echtes LAN-Mesh mit TLS/mTLS, CA-Trust-Bootstrap und dokumentiertem Umschaltpfad — `runtime_mode` (`local|lan`) in Config, CLI, Installer und lokalen Clients (2026-04-05)
- [x] 🟠 Connection Multiplexing über libp2p — Yamux-Multiplexer plus logische Stream-Protokolle und Stream-Statistiken in Runtime/Agent-Card (2026-04-06)
- [x] 🟠 Unix-Socket-Optimierung für Same-Host-Agents — `unix-socket.ts` Server+Client, Framed Protocol, FrameBuffer (2026-04-05)
- [x] 🟡 NAT Traversal (für VPN/Tailscale-übergreifende Mesh-Erweiterung) — AutoNAT-/Circuit-Relay-Konfiguration, Reachability-Metadaten und Relay-Assist-Status in Runtime/Agent-Card (2026-04-06)

### 1.4 Capability Registry
- [x] 🔴 CRDT-basierte verteilte Registry (Automerge) — `registry.ts` (2026-04-03)
- [x] 🔴 Capability-Dokument-Schema — `registry.ts` Capability-Interface (2026-04-03)
- [x] 🔴 Gossip-Synchronisation (Serf-Pattern) — `gossip.ts` Pull-Push mit Fanout (2026-04-03)
- [x] 🟠 Vector Clocks für Konfliktauflösung — Automerge CRDT handhabt das intern (by design)
- [x] 🟠 Capability-Hashing für kompakte Announcements — `getCapabilityHash()` (2026-04-03)

### 1.5 Audit-Log (Phase 1!)
- [x] 🔴 Append-Only SQLite WAL-Log pro Agent — `audit.ts` (2026-04-03)
- [x] 🔴 Merkle-Tree-Integrität über Log-Einträge — Hash-Chain mit `entry_hash` (2026-04-03)
- [x] 🔴 Signierte Audit-Events (ed25519) — ECDSA-Signatur pro Event (2026-04-03)
- [x] 🟠 Log-Typen: PEER_JOIN, PEER_LEAVE, CAPABILITY_QUERY, TASK_DELEGATE, CREDENTIAL_ACCESS — 6 Typen implementiert (2026-04-03)
- [x] 🟠 Log-Export (JSON/CSV) für externe Analyse — `audit.ts` exportJson()/exportCsv() (2026-04-03)

### 1.6 Nachrichtenprotokoll (Basis)
- [x] 🔴 CBOR Encoding/Decoding Library — `cbor-x` via `messages.ts` (2026-04-03)
- [x] 🔴 Message-Envelope: Correlation-ID, Deadline/TTL, Idempotency-Key, ECDSA-Signatur — `messages.ts` (2026-04-03)
- [x] 🔴 Basis-Nachrichten: HEARTBEAT, DISCOVER_QUERY, CAPABILITY_QUERY — `messages.ts` (2026-04-03)
- [x] 🟠 Rate-Limiting (Token Bucket pro Peer) — `ratelimit.ts` (2026-04-03)
- [x] 🟠 Scoped Multicast (nach Capability/Topic, kein Blind Flood) — `scoped-multicast.ts` (2026-04-05)

---

## Phase 2 — Kommunikation & Dashboard (Wochen 4-5)

### 2.1 Vollständiges Nachrichtenprotokoll
- [x] 🔴 TASK_REQUEST / TASK_ACCEPT / TASK_REJECT / TASK_RESULT — `tasks.ts` + `messages.ts` (2026-04-03)
- [x] 🔴 SKILL_ANNOUNCE / SKILL_TRANSFER — `skills.ts` + Message-Handler (2026-04-03)
- [x] 🔴 SECRET_REQUEST (mit Human-Gate-Flag) — `index.ts` + `vault.ts` + Dashboard-Vault-View (2026-04-03)
- [x] 🔴 AUDIT_EVENT (Mesh-weite Synchronisation) — `peer_audit_events` Tabelle, importPeerEvent(), getRecentForSync() (2026-04-05)
- [x] 🟠 Korrelierte Request/Response-Verfolgung — `tasks.ts` correlationIndex (2026-04-03)
- [x] 🟠 Deadline-Propagation und Timeout-Handling — `tasks.ts` checkTimeouts() (2026-04-03)
- [x] 🟡 Streaming-Responses für langdauernde Tasks — GraphQL Subscriptions decken diesen Use-Case ab (2026-04-05)

### 2.2 Health Monitoring
- [x] 🔴 Heartbeat alle 10-30 Sekunden mit exponentieller Backoff — `mesh.ts` 10s Heartbeat (2026-04-03)
- [x] 🔴 Peer als offline markieren nach 3 verpassten Heartbeats — `mesh.ts` 3 missed → offline (2026-04-03)
- [x] 🔴 Gossip-Propagation von Agent-Down-Events — EventBus `peer:leave` (2026-04-03)
- [x] 🟠 Systemmetriken sammeln (CPU, RAM, Disk, Netzwerk) — `systeminformation` in Agent Card (2026-04-03)
- [x] 🟠 Worker-Auslastung tracken — Agent Card `worker` Sektion + setWorkerStats() (2026-04-05)
- [x] 🟡 Zertifikat-Ablauf-Warnung — `getCertDaysLeft()` + Daemon-Startup-Log + EventBus (2026-04-05)
- [x] 🟡 Capability-Freshness-Tracking — `markStaleCapabilities()` + `getStaleCapabilities()` in registry.ts (2026-04-05)

### 2.3 Dashboard API
- [x] 🔴 Fastify HTTP-Server mit GraphQL — Mercurius Plugin `/graphql` + `/graphiql` (2026-04-05)
- [x] 🔴 GraphQL Subscriptions für Echtzeit-Updates — EventBus-basierter Async Generator (2026-04-05)
- [x] 🔴 REST-Endpunkte für einfache Abfragen — `dashboard-api.ts` /api/status, peers, capabilities, tasks, audit (2026-04-03)
- [x] 🟠 Coordinator-Node-Wahl (First-Node-Simple) — `coordinator.ts` aeltester Node wird Coordinator (2026-04-05)
- [x] 🟠 API-Authentifizierung (JWT) — `api-auth.ts` @fastify/jwt, localhost bypass, /api/auth/token (2026-04-05)
- [x] 🟡 OpenAPI/Swagger-Dokumentation — `docs/openapi.yaml` (2026-04-05)

### 2.4 Dashboard UI (MVP)
- [x] 🔴 React + Vite Projekt-Setup — `packages/dashboard-ui/` mit Tailwind (2026-04-03)
- [x] 🔴 **Topologie-Ansicht** — React Flow Netzwerkgraph mit animierten Kanten (2026-04-03)
- [x] 🔴 **Skill-Matrix** — Tabelle: Agent x Capability mit Status-Badges (2026-04-03)
- [x] 🔴 **Health-Gauges** — CPU/RAM/Disk mit Farbbalken + Uptime/Peers/Tasks (2026-04-03)
- [x] 🟠 **Agent-Detail-Ansicht** — Skills, Health-Gauges, Audit-Events pro Agent + klickbare Topologie-Nodes (2026-04-03)
- [x] 🟠 Dunkler/Heller Modus — CSS-Variablen Dark/Light + Toggle in Sidebar (2026-04-05)
- [x] 🟡 Responsive Design (Mobile/Tablet) — Hamburger-Menu, klappbare Sidebar, Touch-freundlich (2026-04-05)
- [x] 🟡 Notifications (Agent-Down, Skill-Transfer-Anfrage, etc.) — Toast-Notifications mit Auto-Dismiss (2026-04-05)

---

## Phase 3 — Vault & Skill-Transfer (Wochen 6-10)

### 3.1 Credential Vault
- [x] 🔴 NaCl Sealed Boxes fuer Verschluesselung — `vault.ts` sealForPeer/unsealFromPeer (2026-04-03)
- [x] 🔴 Lokaler Vault-Speicher (AES-256-GCM + PBKDF2) — `vault.ts` (2026-04-03)
- [x] 🔴 OS-Keychain-Integration (macOS Keychain, GNOME Keyring) — `keychain.ts` shell-out Wrapper, kein native Build (2026-04-05)
- [x] 🔴 **Human Approval Gate** — `vault.ts` ApprovalRequest System (2026-04-03)
- [x] 🟠 Shamir's Secret Sharing fuer hochwertige Credentials — `shamir.ts` split/combine (2026-04-05)
- [x] 🟠 Credential-TTL und Auto-Expiry — `vault.ts` ttlHours + cleanExpired() (2026-04-03)
- [x] 🟠 Brokered Access — `vault.ts` executeBrokered() proxied ohne Secret-Exposure (2026-04-05)
- [x] 🟡 Credential-Scope (Tags/Kategorien) — `vault.ts` tags + category Filter (2026-04-03)
- [x] 🟡 Revocation-Mechanismus — `vault.ts` revoke/isRevoked/listRevoked + revoked_credentials Tabelle (2026-04-05)

### 3.2 Skill-Paket-Format
- [x] 🔴 Manifest-Schema (JSON) — `skill-manifest.ts` mit JSON Schema, Validierung, Permissions-System (2026-04-05)
- [x] 🔴 Signierte Skill-Pakete (.tlskill) — `skill-package.ts` (2026-04-03)
- [x] 🔴 Signatur-Verifizierung (ECDSA) vor Installation — `verifySkillPackage()` (2026-04-03)
- [x] 🟠 SemVer-Versionierung mit Kompatibilitätsprüfung — `semver.ts` parse/compare/range/compatible (2026-04-05)
- [x] 🟠 Rollback-Mechanismus bei fehlgeschlagener Installation — `skill-rollback.ts` backup/restore (2026-04-05)

### 3.3 Skill-Sandboxing
- [x] 🔴 WASM-Sandbox (Wazero oder wasmtime) — `sandbox.ts` fuehrt `runtime=wasm` ueber `wasmtime`/WASI mit isoliertem `--dir`, Timeout und `SKILL_INPUT_BASE64`-Contract aus (2026-04-06)
- [x] 🔴 Docker-Container-Fallback für komplexe Skills — `sandbox.ts` fuehrt `runtime=docker` read-only mit `docker run`, Memory-/PID-Limits, optional gesperrtem Netzwerk und `SKILL_INPUT_BASE64` aus (2026-04-06)
- [x] 🔴 I/O-Schema-Validierung (JSON Schema) vor Ausführung — `schema-validator.ts` + @cfworker/json-schema (2026-04-05)
- [x] 🟠 Ressourcen-Limits (CPU-Zeit, Speicher, Netzwerk) — `sandbox.ts` SkillSandbox mit Timeout, Memory-Limit, Netzwerk-Flag (2026-04-05)
- [x] 🟠 Kein Dateisystem-Zugriff außerhalb des Skill-Verzeichnisses — `isPathAllowed()` mit Path-Traversal-Schutz (2026-04-05)
- [x] 🟡 Deno-Isolate als dritte Sandbox-Option — `sandbox.ts` fuehrt `runtime=deno` mit `deno run --no-prompt`, expliziten `--allow-*`-Flags und lokalem `DENO_DIR` im Skill-Verzeichnis aus (2026-04-07)

### 3.4 Policy Engine
- [x] 🔴 Policy Engine (leichtgewichtig statt OPA/Rego) — `policy.ts` mit JSON-Policies, deny-by-default (2026-04-05)
- [x] 🔴 Standard-Policies: skill.execute (allow), credential.share (approval), skill.install (approval) (2026-04-05)
- [x] 🟠 Policy-Verteilung über Mesh — exportForSync/importFromPeer in policy.ts (2026-04-05)
- [x] 🟠 Policy-Versionierung — getVersion() SHA-256 Hash + save() (2026-04-05)
- [ ] 🟡 Cedar als Alternative evaluieren

---

## Phase 4 — Agent-Adapter & Wachstum (Wochen 11+)

### 4.1 Agent-Adapter
- [x] 🔴 **Adapter-Abstraktionsschicht** — `mesh-client.ts` + `mesh-adapter.ts` BaseHttpMeshAdapter (2026-04-05)
- [x] 🔴 Claude Code Adapter (stdio MCP Proxy) — `mcp-stdio.ts` mit 13+ Tools (2026-04-04)
- [x] 🟠 Codex CLI Adapter — `cli-adapters.ts` setupCodexCli() + `thinklocal setup codex` (2026-04-05)
- [x] 🟠 Gemini CLI Adapter — `cli-adapters.ts` setupGeminiCli() + `thinklocal setup gemini` (2026-04-05)
- [x] 🟠 Claude Desktop Adapter (MCP Server Registration) — `cli-adapters.ts` setupClaudeDesktop() (2026-04-05)
- [ ] 🟡 PAL MCP Adapter
- [ ] 🟡 LangChain/LangGraph Integration
- [ ] 💡 Ollama/lokale LLM-Adapter
- [ ] 💡 VS Code Extension als Agent

### 4.2 Autonome Delegation
- [x] 🟠 Task-Routing basierend auf Capability-Matching — `task-router.ts` mit Score-System (2026-04-05)
- [x] 🟠 Approval-Gate-Konfiguration (pro Task-Typ) — `approval-gates.ts` auto/approve/deny per Skill-Pattern (2026-04-05)
- [x] 🟡 Multi-Step-Task-Chains (Agent A → Agent B → Agent C) — `task-chain.ts` executeChain() (2026-04-05)
- [x] 🟡 Task-Priorisierung und Queue-Management — `task-queue.ts` priorisierte Queue mit max Parallelitaet (2026-04-05)
- [ ] 💡 Lernende Delegation (basierend auf Erfolgshistorie)

### 4.4.1 Cron-Heartbeat + Per-Agent-Inbox (Proposed, siehe ADR-004, ADR-005)

- [x] 🔴 **ADR-004 Cron-Heartbeat Phase 1** — IMPLEMENTIERT 2026-04-09. `packages/daemon/src/heartbeat/interval.ts` (adaptive Backoff + ±20 % Jitter, pure functions), `packages/cli/src/thinklocal-heartbeat.ts` (`thinklocal heartbeat show|status|help`), `docs/agents/{inbox,compliance}-heartbeat.md`, 20 Tests. Phase 2: Daemon Register/Heartbeat-Endpoints. Phase 3: WebSocket-Push. Phase 4: Compliance-Cron als separater Job (5 min, fix).
- [x] 🔴 **ADR-005 Per-Agent-Inbox** — IMPLEMENTIERT 2026-04-09 (PR #91). `to_agent_instance` Spalte + Schema-Migration v1→v2 + `spiffe-uri.ts` Helpers + `for_instance` Query-Parameter in Inbox-API + Loopback-Fix (normalizeAgentId). 61 Tests.
- [x] 🟠 **Adaptive Cron-Intervall** — IMPLEMENTIERT 2026-04-09 in `packages/daemon/src/heartbeat/interval.ts`. Exponential backoff bei leerer Inbox, ±20 % Jitter, alle 4 Mesh-Modi (local/lan/federated/adhoc).
- [x] 🟠 **Compliance-Regel-Check** — IMPLEMENTIERT 2026-04-11 als GitHub Actions Compliance Gate (PR #105) + Pre-Commit Hook (PR #108). Nicht als Heartbeat-Cron, sondern als CI-Status-Check und lokaler Git-Hook — technisch robuster weil nicht umgehbar.
- [x] 🟡 **Broadcast-Pattern** — IMPLEMENTIERT 2026-04-12 (direct push). inbox-api.ts instance/* fanout an alle aktiven Instances auf einem Host.
- [x] 🟡 **WebSocket-Push als Komplement** — IMPLEMENTIERT 2026-04-11 (PR #114). websocket.ts Subscription-Filter + inbox:new Event.
- [x] 🟡 **`unregister` on graceful shutdown** — IMPLEMENTIERT 2026-04-12 (PR #117). mcp-stdio.ts register/unregister beim Daemon.

### 4.4 Agent-zu-Agent Messaging (Inbox)
- [x] 🔴 **Persistente Inbox pro Daemon** — `agent-inbox.ts` SQLite WAL, 64KB Body-Limit, Dedupe via UUID, soft read/archive (PR #79, 2026-04-08)
- [x] 🔴 **AGENT_MESSAGE Wire-Type** — `messages.ts` AgentMessagePayload + AgentMessageAckPayload, signiert via Mesh-Envelope (PR #79, 2026-04-08)
- [x] 🔴 **Inbox-API REST-Endpoints** — `inbox-api.ts` POST /api/inbox/send, GET /api/inbox, mark-read, archive, unread (PR #79, 2026-04-08)
- [x] 🔴 **MCP-Tools** — send_message_to_peer, read_inbox, mark_message_read, archive_message, unread_messages_count in `mcp-stdio.ts` (PR #79, 2026-04-08)
- [x] 🟠 **Loopback fuer Sibling-Agents** — Wenn `to === ownAgentId` (mehrere Agenten teilen einen Daemon), wird die Nachricht direkt im lokalen Inbox abgelegt statt ueber Netzwerk geroutet (PR #80, 2026-04-08)
- [x] 🟠 **ACK-Signaturpruefung beim Sender** — IMPLEMENTIERT 2026-04-12 (direct push). inbox-api.ts CBOR decode + Peer-PublicKey verify.
- [x] 🟠 **WebSocket-Push** fuer Inbox-Events — IMPLEMENTIERT 2026-04-11 (PR #114). websocket.ts Subscription-Filter + inbox:new Event.
- [x] 🟡 **Per-Peer ACL** beim Senden — IMPLEMENTIERT 2026-04-13 (PR #122). inbox-api.ts pairingStore.isPaired() gate.
- [x] 🟡 **Rate-Limiting** auf `/api/inbox/send` — IMPLEMENTIERT (bereits vorhanden seit PR #105). checkRate in send handler.
- [ ] 💡 **Threading** ueber `in_reply_to` hinaus — Conversation-View, mehrere Teilnehmer

### 4.3 Fortgeschrittene Features
- [ ] 🟡 QUIC-Transport-Upgrade
- [ ] 🟡 Multi-Subnet-Unterstützung
- [ ] 🟡 Supernode-Architektur für >100 Agents
- [x] 🟡 Skill-Dependency-Resolution (wie npm/pip) — `skill-deps.ts` checkDependencies + topologische Sortierung (2026-04-05)
- [ ] 💡 Skill-Marketplace (lokales Registry mit Bewertungen)
- [ ] 💡 Agent-Reputation-System
- [ ] 💡 Föderierte Meshes (mehrere LANs verbinden via WireGuard/Tailscale)

---

## Phase 5 — Produktisierung: "Install once, it just works" (Konsensus: GPT-5.4 + Gemini 2.5 Pro + GPT-5.1)

> Ergebnis des Multi-Modell-Konsensus vom 2026-04-04. Alle 3 Modelle einig: CLI + Daemon-Management ZUERST, dann Claude-Integration, SSH-Deploy auf v2.

### 5.1 `thinklocal` CLI + Daemon-Management
- [x] 🔴 Globale CLI: `thinklocal start`, `stop`, `status`, `restart`, `logs`, `doctor` — `thinklocal.ts` 12+ Befehle (2026-04-04)
- [x] 🔴 `thinklocal bootstrap` — Ersteinrichtung: Keys, Config, Service, MCP, Credentials (2026-04-04)
- [x] 🔴 `thinklocal doctor` — Diagnostik: Daemon, Keys, Certs, Peers, MCP, Ports (2026-04-04)
- [x] 🟠 `thinklocal peers` — Verbundene Peers anzeigen (2026-04-04)
- [x] 🟠 `thinklocal config show/edit/validate` — `config show` implementiert (2026-04-04)
- [x] 🟠 Saubere, menschenlesbare Ausgabe (kein JSON-Log-Spam im Terminal) — Farbige CLI-Ausgabe (2026-04-04)

### 5.2 One-Command Install + System-Service
- [x] 🔴 macOS: `curl ... | bash` — installiert Daemon + CLI + launchd Service (2026-04-04)
- [x] 🔴 Linux: Install-Script mit systemd User-Service + avahi-daemon (2026-04-04)
- [x] 🔴 Installer registriert launchd/systemd Service automatisch (2026-04-04)
- [x] 🟠 Uninstaller: `thinklocal uninstall` — Service entfernen, Config behalten (2026-04-04)
- [x] 🟠 Sensible Defaults: mDNS auto-discovery, Keys auto-generieren, MCP auto-konfigurieren (2026-04-04)
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)
- [ ] 🔴 **Intelligente Netzwerk-Interface-Auswahl fuer mDNS-Discovery** — Daemon muss auf Multi-Homed-Hosts (Mac mit WLAN + LAN + USB-Ethernet gleichzeitig) selbst entscheiden, ueber welches Interface er Bonjour-Browse und -Publish macht. Aktuell: `discovery.ts:29` ruft `new Bonjour()` ohne Interface-Param → Lib raet, faellt im worst case auf WLAN, sieht 0 Peers im Wired-Subnetz. Beobachtet 2026-05-17 auf MacBook mit en0/en8/en10. Anforderungen:
  - [ ] ADR-019 schreiben: Auswahllogik dokumentieren (wired > wireless, link-up, „Mesh-Subnetz"-Erkennung 10.10.X.0/24, multi-interface vs single-binding).
  - [ ] Neue Config-Section `[discovery]` in `daemon.toml` mit Keys `interface = "auto" | "<name>" | "<ip>"`, `prefer_wired = true`, `subnet_hint = "10.10.0.0/16"` (optional, fuer Heim-LAN-Erkennung).
  - [ ] Env-Override `TLMCP_BIND_INTERFACE`.
  - [ ] `new Bonjour({ interface: selectedIp, multicast: true })` mit der gewaehlten IP.
  - [ ] Stretch: Multi-Interface-Modus — eine Bonjour-Instanz pro relevantem Interface; vereinigte Peer-Liste in `MeshManager`.
  - [ ] Tests: Auswahllogik mit gefakten `os.networkInterfaces()`-Outputs (3-Interface-Mac, Pi mit einem Interface, Linux-Server mit Tailscale + eth0).
  - [ ] Regression: nach Sleep/Wake auf macOS muessen die Sockets neu gebunden werden (`pmset`-Sleep-Wakeup-Hook oder periodischer Health-Check der Browse-Antworten).
- [ ] 🟠 **macOS-Installer auf LaunchDaemon umstellen** (statt LaunchAgent) — fuer headless/SSH-only/FileVault-Setups noetig. Details: `docs/MACOS-DEPLOYMENT.md` (Stand 2026-05-16). Konkret abzuarbeiten:
  - [ ] `scripts/service/com.thinklocal.daemon.plist` zur Template-Datei (`*.plist.template`) machen mit Platzhaltern `{{USER}}`, `{{GROUP}}`, `{{HOME}}`, `{{NODE_BIN}}`, `{{REPO}}`. **Keine** hartkodierten `chris`/`staff`/`/Users/chris`-Pfade.
  - [ ] `scripts/install.sh` (macOS-Zweig, aktuell ab Zeile ~280): Template per `sed` mit `$SUDO_USER`/`id -gn`/`eval echo ~$USER`/`which node`-Werten befuellen, Output nach `/Library/LaunchDaemons/`. Dateirechte: `chown root:wheel`, `chmod 644`.
  - [ ] Installer-Sub-Task: Wrapper-Skript `~/<user>/.thinklocal/bin/daemon-launchagent.sh` aus Template generieren (analog), `chmod +x`. Wrapper enthaelt Netzwartungs-Loop gegen `EHOSTUNREACH 224.0.0.251:5353`-Race.
  - [ ] Installer prueft: User existiert, `$SUDO_USER` ist gesetzt (sonst Abbruch mit klarer Fehlermeldung), Node 22+ verfuegbar, kein bestehender LaunchAgent unter selbem Label (vorher `bootout` + `mv` zu `.disabled.<datum>`).
  - [ ] `bootstrap`-Schritt: `sudo launchctl bootstrap system /Library/LaunchDaemons/com.thinklocal.daemon.plist`.
  - [ ] Uninstaller-Pendant in `install.sh --uninstall`: `bootout system`, plist + Wrapper loeschen.
  - [ ] Homebrew-Formel (`Formula/thinklocal.rb`) konsistent anpassen — derzeit installiert sie ebenfalls einen LaunchAgent.
  - [ ] README/INSTALL.md / USER-GUIDE: macOS-Abschnitt auf LaunchDaemon umstellen, Wrapper-Sinn kurz erklaeren, FileVault-Hinweis aufnehmen.

### 5.3 Claude Desktop MCP Integration
- [x] 🔴 `thinklocal mcp config --claude-desktop` — generiert JSON-Block (2026-04-04)
- [x] 🔴 `thinklocal mcp config --claude-code` — generiert ~/.mcp.json (2026-04-04)
- [x] 🔴 Lokale MCP Bridge: `mcp-stdio.ts` mit 13+ Tools (2026-04-04)
- [x] 🟠 Auto-Detection: Installer findet Claude Config und fuegt thinklocal hinzu (2026-04-04)
- [ ] 🟡 Dokumentation: Schritt-fuer-Schritt mit Screenshots

### 5.4 Claude Code Terminal Integration
- [x] 🔴 `thinklocal init` — schreibt .mcp.json ins aktuelle Projekt (2026-04-04)
- [x] 🟠 Globale ~/.mcp.json wird automatisch bei `thinklocal bootstrap` erstellt (2026-04-04)
- [x] 🟡 Verifizierung: Claude Code nutzt Mesh-Tools direkt (getestet 2026-04-04)

### 5.5 Linux Support (Ubuntu/Debian)
- [x] 🔴 Install-Script mit Plattform-Erkennung (macOS/Linux) — `scripts/install.sh` (2026-04-04)
- [x] 🔴 systemd User-Service mit gleicher UX wie macOS — inkl. enable-linger (2026-04-04)
- [x] 🟠 `.deb`-Paket fuer apt-Installation — `scripts/build-deb.sh` + systemd-Service + Sicherheits-Haertung (2026-04-05)
- [x] 🟡 Docker-Image als Alternative — `docker-compose.yml` 3-Node-Setup mit Static-Peers + eigenem Netzwerk (2026-04-05)

### 5.6 Distribution + Auto-Update
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)
- [ ] 🟠 Auto-Update-Mechanismus (Sparkle fuer App, npm fuer CLI)
- [x] 🟡 Signierte Releases (checksums, GPG) — SHA256SUMS.txt + Release-Archive + .deb in GitHub Release (2026-04-05)

---

## Phase 6 — Native Experience + Remote-Deployment

### 6.1 Swift MenuBar App (macOS)
- [ ] 🟠 SwiftUI MenuBarExtra als duenne Shell ueber Daemon-API
- [ ] 🟠 Status-Icon: gruen (Mesh aktiv), gelb (keine Peers), rot (Daemon offline)
- [ ] 🟠 Quick-Actions: Start/Stop, Peers anzeigen, Dashboard oeffnen, Logs anzeigen
- [x] 🟡 Pairing per Klick (PIN anzeigen/eingeben) — PairingView.tsx: 6-stellige PIN-Eingabe mit Auto-Focus, Auto-Submit, Fehler-Feedback (2026-04-05)
- [ ] 🟡 Sparkle Auto-Update + notarisiertes .dmg
- [ ] 💡 Architektur wie OpenClaw: Swift App startet/steuert Node.js Daemon als Subprocess

### 6.2 SSH-basiertes Remote-Deployment (v2, opt-in)
- [x] 🟠 `thinklocal deploy user@host` — SSH-Deploy mit Dry-Run, .env-Transfer, Mesh-Join-Check (2026-04-05)
- [x] 🟠 SSH-Key-Austausch: SSH-basierter Deploy nutzt key-based auth (BatchMode) (2026-04-05)
- [x] 🟠 Lokale CA signiert Mesh-Zertifikate fuer Remote-Nodes — `--with-ca` Flag im Deploy (2026-04-05)
- [x] 🟡 Dry-Run-Modus: `thinklocal deploy --dry-run` zeigt alle Schritte — bereits in cmdDeploy implementiert (2026-04-05)
- [x] 🟡 `thinklocal remove user@host` — Remote-Deinstallation mit --purge Option (2026-04-05)
- [ ] 💡 Netzwerk-Scanner schlaegt Deployment-Ziele vor

### 6.3 Fehlende Infrastruktur (Konsensus-Findings)
- [x] 🔴 Diagnostik: `thinklocal doctor` (Daemon, Keys, Peers, MCP, Certs, Ports) (2026-04-04)
- [x] 🟠 Recovery-Flows: abgelaufene Certs, Port-Konflikte, umbenannte Hosts — `recovery.ts` runRecoveryChecks() (2026-04-05)
- [x] 🟠 Versioning: Kompatibilitaetsmatrix, graceful Degradation — `version-compat.ts` + FEATURE_MATRIX (2026-04-05)
- [x] 🟡 Security-Lifecycle: Cert-Rotation, Revocation, Trust-Reset — `cert-rotation.ts` + `crl.ts` (2026-04-05)
- [x] 🟡 Benutzerfreundliche Fehlermeldungen statt Stack-Traces — Farbige CLI-Ausgabe (2026-04-04)

---

## Uebergreifende Aufgaben (alle Phasen)

### Dokumentation
- [x] 🔴 ADR-Template erstellen und ersten ADR schreiben — `docs/architecture/ADR-001-daemon-architecture.md` (2026-04-03)
- [x] 🔴 Wire-Protokoll-Spezifikation (vollständig) — `docs/WIRE-PROTOCOL.md` (2026-04-05)
- [x] 🟠 Threat Model & Sicherheitsdesign-Dokument — `docs/THREAT-MODEL.md` (2026-04-05)
- [x] 🟠 API-Dokumentation (OpenAPI + GraphQL Schema) — `docs/openapi.yaml` + `docs/GRAPHQL-SCHEMA.md` (2026-04-05)
- [x] 🟡 Benutzerhandbuch (Installation, Konfiguration, Troubleshooting) — `docs/USER-GUIDE.md` 10 Sektionen (2026-04-05)
- [x] 🟡 Entwicklerhandbuch (eigene Adapter/Skills schreiben) — `docs/DEVELOPER-GUIDE.md` (2026-04-05)

### Testing
- [x] 🔴 Unit-Test-Framework (Vitest für TS) — konfiguriert in `packages/daemon/` und Root (2026-04-03)
- [x] 🔴 Protokoll-Contract-Tests (müssen vor Merge bestehen) — 15 Tests in `protocol-contract.test.ts` (2026-04-05)
- [x] 🟠 Integration-Tests (Multi-Node im Docker Compose) — `tests/integration/two-nodes.test.ts` (2026-04-03)
- [x] 🟠 Security-Tests (Fuzzing, Penetration-Szenarien) — 20 Tests: Replay, TTL, ECDSA, Path-Traversal, Rate-Limit, QR-Token, Input-Sanitisierung (2026-04-05)
- [x] 🟡 Performance-Tests (Latenz, Durchsatz, Skalierung) — 9 Benchmarks: ECDSA 15k/s, SHA256 992k/s, PatternMatch 4.3M/s, MapLookup 99M/s (2026-04-05)
- [x] 🟡 Chaos-Tests (Network Partition, Node-Ausfall) — 12 Tests: Split-Brain, Rapid Rejoin, Gossip-Storm, Heartbeat-Verlust, Multi-Ausfall (2026-04-05)

### CI/CD & Build
- [x] 🔴 GitHub Actions Pipeline — `.github/workflows/ci.yml` (2026-04-03)
- [x] 🔴 Linting (ESLint + Prettier) — eslint.config.js + .prettierrc + npm run lint/format (2026-04-05)
- [x] 🟠 Docker-Image-Build und -Push — Dockerfile Multi-Stage + .dockerignore (2026-04-05)
- [x] 🟠 Automatische Release-Erstellung — `.github/workflows/release.yml` bei Tags (2026-04-05)
- [ ] 🟡 Cross-Plattform-Tests (macOS, Linux, Windows via WSL)

### Konfiguration & Deployment
- [x] 🔴 Konfigurationsdatei-Format (TOML) — `config/daemon.toml` + `config.ts` (2026-04-03)
- [x] 🔴 Umgebungsvariablen-Unterstützung — `TLMCP_*`-Prefix mit Validierung (2026-04-03)
- [x] 🟠 Homebrew-Formel (macOS) — `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (2026-04-05)
- [x] 🟠 Systemd-Service-Dateien (Linux) — `scripts/service/thinklocal-daemon.service` (2026-04-03)
- [x] 🟡 launchd-Plist (macOS) — `scripts/service/com.thinklocal.daemon.plist` (2026-04-03)
- [x] 🟡 Windows-Service — `scripts/service/thinklocal-daemon.ps1` Scheduled Task (2026-04-03)
- [ ] 💡 Nix-Flake fuer reproduzierbare Builds

---

## Identifizierte Lücken & Risiken

### Von allen Modellen identifiziert (höchste Priorität)
- [x] 🔴 **Prompt Injection Cascades** — Detaillierte Bedrohungsanalyse + Mitigationen in SECURITY.md (2026-04-05)
- [x] 🔴 **Bootstrap-Trust-Problem** — Dokumentiert inkl. implementierte + geplante Mitigationen (2026-04-05)
- [x] 🔴 **Root-Compromise-Limitation** — Explizit dokumentiert als Out-of-Scope mit Begruendung (2026-04-05)

### Von mehreren Modellen identifiziert
- [x] 🟠 **Skill Lifecycle Management** — `skill-lifecycle.ts` Expiry, Usage-Tracking, Deprecation, GC (2026-04-05)
- [x] 🟠 **Network Partition (Split-Brain)** — `partition-detector.ts` Erkennung + graceful Reconnection (2026-04-05)
- [x] 🟠 **O(n²) Registry-Wachstum** — Mitigiert durch: Gossip nur eigene Caps senden, Hash-Vergleich vor Sync, Stale-Cleanup, Scoped Multicast (2026-04-05)
- [x] 🟠 **Agent-Adapter-Fragilität** — Geloest durch BaseHttpMeshAdapter + MeshDaemonClient Abstraktionsschicht (2026-04-05)

### Von einzelnen Modellen identifiziert
- [ ] 🟡 **Skill Sprawl** — Unkontrollierte Skill-Verbreitung wie WormGPT-Exploits vermeiden
- [ ] 🟡 **Skill-Versioning als komplexestes Subsystem** — GLM warnt, dass dies zum schwierigsten Teil werden könnte
- [ ] 🟡 **Rust für sicherheitskritische Komponenten** — DeepSeek empfiehlt Rust für Sandboxing und Vault
- [ ] 🟡 **Hardware-backed Enclaves** — Intel SGX / Apple Secure Enclave für Credential-Speicher evaluieren
- [ ] 💡 **Signal Double-Ratchet** für Key-Rotation — Kimi K2 Vorschlag
- [ ] 💡 **Protobuf statt JSON** für Capability-Schema — Kimi K2 Vorschlag (effizienter, aber weniger flexibel)

### Erkenntnisse aus Nachholreviews (2026-04-05)
- [x] 🟠 **GraphQL Resolver Error-Handling** — throw Error() statt leere Arrays (2026-04-05)
- [x] 🟠 **JWT Token-Refresh** — /api/auth/refresh Endpoint (2026-04-05)
- [x] 🟠 **SemVer Prerelease-Vergleich** — Spec-konformer Vergleich (numerisch + lexikographisch) (2026-04-05)
- [x] 🟡 **Task-Router Tie-Breaking** — Zufalls-Tiebreaker bei gleichem Score (2026-04-05)
- [x] 🟡 **GraphQL Subscription Cleanup** — Queue-Limit (100), Idle-Timeout (5min), alive-Flag gegen Handler-Leak (2026-04-05)
- [x] 🟡 **mesh-client.ts Retry-Logik** — Exponential Backoff mit Jitter, transiente Fehler (5xx, 429, Netzwerk), max 3 Retries (2026-04-05)
- [x] 🟡 **Policy-Pattern Dokumentation** — matchesPattern JSDoc mit Beispielen und expliziter "NICHT unterstuetzt"-Sektion (2026-04-05)

---

## Operative Verbesserungen (User-Wunsch 2026-05-19)

- [x] 🟠 **Build-Versionsnummer + Build-Nummer im Mesh sichtbar** — **IMPLEMENTIERT 2026-06-05 (v0.32.0)**: `build-info.ts` (`loadBuildInfo`) liest beim Start `build_version` (VERSION-Datei → package.json), `build_number` (BUILD-Datei → `git rev-parse --short HEAD`), `build_date` (`git log -1 --format=%cI`), `build_node` (hostname) — mit Fallbacks (unknown/null), nie crashend. Sichtbar in `agent_card.build`, `/api/status` (build_version/number/node/date) und damit automatisch in den MCP-Tools `mesh_status` + `discover_peers` (die /api/status bzw. /api/peers dumpen). Ersetzt das hartkodierte `version:'0.2.0'`. CR gpt-5.5: 0 Findings. _(Voraussetzung fuer Auto-Update — der Build-Stempel ist jetzt da.)_
  - **Why:** Beim 5-Node-Rollout heute (ADR-019 P1.1, ADR-020 P1.1) war nicht erkennbar, welche Nodes schon den neuen Build laufen. Inkompatibilitaeten zeigen sich nur durch verwirrende Fehler (siehe ADR-020-Phase-1.1-bug-report Bug #2/#3/#4).
  - **Voraussetzung fuer:** Auto-Update (siehe unten) — ohne Build-Stempel kann der Update-Mechanismus nicht entscheiden, ob ein Update noetig ist.
  - **Vorgehen:** ADR schreiben, CO + CG, dann packages/daemon/src/build-info.ts mit Tests. Kleine, isolierte Aenderung — guter Kandidat fuer einen unabhaengigen PR neben den Mesh-Bugfixes.

- [ ] 🟠 **Auto-Update Sparkle-Style — Phase 1.5 von ADR-017** — ADR-017 existiert bereits als Proposed (`docs/architecture/ADR-017-auto-update.md`) mit Phase 1 (CLI-Befehl) + Phase 2 (Mesh-Update via OTS). User-Wunsch 2026-05-19: **Phase 1.5** als Background-Polling-Loop im Daemon:
  - Daemon polled GitHub Releases (oder Update-Manifest) in konfigurierbaren Intervallen ("einmal am Tag", "jede Stunde", "manuell")
  - Bei verfuegbarem neueren Build: download + SHA256-Verifikation + selbst neu installieren
  - Konfigurierbar via `config/daemon.toml` oder Env-Vars: Polling-Frequenz, Stable/Beta-Kanal, Auto-Install vs. Admin-Approval, Skip-this-Version
  - Vorbild: Sparkle.app fuer macOS (https://sparkle-project.org/)
  - **Phase 2 (Mesh-propagierte Updates) bleibt aufgeschoben** — solange Mesh-Sync nicht stabil ist (siehe ADR-020 Bug-Report), waere ein mesh-basiertes Update kontraproduktiv: ein kaputtes Mesh kann nicht zuverlaessig sein eigenes Update verteilen.

- [x] 🟢 **Pairing-URI-Migrationsskript** — `packages/daemon/scripts/migrate-pairings.mjs` als Folge aus dem ADR-005-Migrationsbug (siehe `docs/architecture/ADR-020-Phase-1.1-bug-report.md` Bug #4). Detektiert hostname-basierte SPIFFE-URIs in `paired-peers.json`, holt die korrekten Host-ID-URIs via `/.well-known/agent-card.json` des Peers, schreibt atomar zurueck. Plus Daemon-Startup-Warning bei erkannten Legacy-Eintraegen. **GELOEST 2026-05-19, PR #139.**

## ADR-020 Phase 1.1 Bug-Report — Abarbeitung 2026-05-19/20

Alle 4 Bugs aus `docs/architecture/ADR-020-Phase-1.1-bug-report.md` adressiert. 5 PRs gemerged in einer Session, alle 5 Mesh-Nodes deployed, libp2p-CRDT-Coordinator-Sync funktional auf allen 5 Nodes (`coord_peers=4`, `all_converged=true`).

- [x] 🔴 **Bug #1: RegistrySyncCoordinator faehrt keine Sync-Rounds** — Root Cause: libp2p v3 dialt nach `peer:discovery` NICHT automatisch (`#onDiscoveryPeer` macht nur `peerStore.merge`). Fix: expliziter `peer:discovery`-Listener mit Self-Filter, Already-Connected-Filter, In-Flight-Dedup, Stop-Guard + defensiver PeerStore-Scan nach Start. Bonus aus CR: peer:connect-Event-Parser Bug (`detail.toString()` lieferte `"[object Object]"`) + Inflight-Race im Coordinator (converged-Pfad blockierte Peer permanent). **PR #135.**
- [x] 🔴 **Bug #2: execute_remote_skill Port-Mix** — Root Cause: `peerProto` an lokales `RUNTIME_MODE` gekoppelt; mcp-stdio-Subprocess hatte kein `TLMCP_RUNTIME_MODE` → Default `'local'` → HTTP an HTTPS-only Port. Fix: `buildRemotePeerUrl(host, port)` liefert immer `https://`. **PR #137.**
- [x] 🔴 **Bug #3 (kritisch): libp2p `connectionEncryption` → `connectionEncrypters` Config-Key** — Root Cause: libp2p v2+ benutzt `connectionEncrypters` (Plural mit -ers); der alte Key wurde silent ignoriert → Noise nie konfiguriert → jeder Dial scheiterte mit `EncryptionFailedError`. Das erklaerte warum PR #135 Auto-Dial korrekt fired aber 0 Connections lieferte. Fix: one-line rename. **PR #140.**
- [x] 🟠 **Bug #4: Pairing-URI-Migration** — siehe oben, **PR #139**.

**Live-Endstand 2026-05-20 00:25:** Alle 5 Nodes (MacBook, minimac, iobroker, ai-n8n-local, influxdb) haben `coord_peers=4`, `peers_online=4`. CRDT-Sync laeuft, Coordinator-Rounds melden `converged: true`. Stale `npm run daemon`-Prozess auf ai-n8n-local (2h19m) blockte Port 9540 → gekillt.

## Phase 1.2 — Folge aus Phase 1.1 Bug-Report (offen)

- [ ] 🟠 **Capability-Counts variieren trotz CRDT-converged** — Endstand-Beobachtung: alle 5 Nodes melden `all_converged=true` im libp2p-CRDT-Coordinator, aber `/api/capabilities` zeigt unterschiedliche Counts (8-13) und Hashes. Vermutung: GossipSync (HTTPS-Pull) importiert Capabilities lokal in `registry.ts`, pusht sie aber nicht ins Automerge-CRDT. Konsequenz: jede Node hat eine eigene "lokale Sicht" plus die geteilte CRDT-Sicht (die kleiner ist). Kein Konvergenz-Blocker auf libp2p-Ebene, aber funktional ein Sync-Hole. Diagnose: `GossipSync.importCapabilities()` und `CapabilityRegistry.register()` Pfad pruefen — wird `registry.register()` aufgerufen, das ins Automerge-Doc schreibt, oder nur eine in-memory Map gepflegt?

- [ ] 🟡 **better-sqlite3 ABI-Mismatch auf Node v26** — 227 Test-Failures `NODE_MODULE_VERSION 127 ... requires 147` wenn `npx vitest` mit Homebrew node v26 statt nvm-node v22 laeuft. Lokale Workarounds: `npm rebuild better-sqlite3` mit dem richtigen node, oder PATH-Pinning. Sauber: `engines.node` in `package.json` strikter + Test-Runner-Wrapper der die Node-Version checkt + ggf. eine `vitest.config.ts`-`pool` Option die nicht die System-Node-ABI ausnutzt.

## Zukunftsideen (Post-MVP)

- [ ] 💡 **Natürliche-Sprache-Queries** — "Hat jemand im Netzwerk eine Datenbank?" statt strukturierter Capability-Abfragen
- [ ] 💡 **Automatische Skill-Erstellung** — Agent erkennt Bedarf und erstellt neuen Skill on-the-fly
- [ ] 💡 **Cross-Mesh-Kommunikation** — Mehrere LANs über sichere Tunnel (WireGuard/Tailscale) verbinden
- [ ] 💡 **Skill-Bewertungssystem** — Agents bewerten Skill-Qualität nach Nutzung
- [ ] 💡 **Ressourcen-Scheduling** — GPU-Tasks automatisch an GPU-Hosts delegieren
- [ ] 💡 **Conversation History Sharing** — Kontexttransfer zwischen Agents für nahtlose Übergabe
- [ ] 💡 **Webhooks / Event-Subscriptions** — Externe Systeme bei Mesh-Events benachrichtigen
- [ ] 💡 **InfluxDB/Prometheus-Integration** — Mesh-Metriken in bestehende Monitoring-Stacks exportieren
- [ ] 💡 **Mobile App** — Mesh-Dashboard und Approval-Gates auf dem Smartphone
- [ ] 💡 **Voice-Aktivierung** — Mesh-Befehle per Sprache ("Hey Mesh, wer hat InfluxDB?")
- [ ] 💡 **A/B-Testing für Skills** — Verschiedene Skill-Versionen parallel testen
- [ ] 💡 **Mesh-Backup/Restore** — CA-Material, Registry-Snapshots, Policy-Bundles sichern
- [ ] 💡 **Compliance-Modus** — Regulatorische Anforderungen (DSGVO, HIPAA) über Policy-Engine abbilden
- [ ] 💡 **Eingebettete AI-Modelle** — Kleine lokale Modelle (Ollama/MiniMax/GLM) fuer:
  - Intelligente Fehler-Diagnose (`thinklocal doctor --ai`)
  - Natuerliche-Sprache-Queries ("Hat jemand eine Datenbank?")
  - Automatische Skill-Erstellung on-the-fly
  - Kontext-Transfer-Zusammenfassung zwischen Agents
- [x] 🔴 **Credential-Management** — .env Import + Git Auto-Config + Vault-Speicherung (2026-04-04)
- [x] 🔴 **Telegram Gateway** — Bot-Monitoring mit 6 Befehlen + Event-Bridge, Chat-ID Allowlist (2026-04-05)
- [ ] 💡 **ThinkHub** — Skill-Marketplace/Registry (wie ClawHub) statt Skills im Repo
- [ ] 💡 **ThinkWide** — Mehrere LANs verbinden (WireGuard/Tailscale)
- [ ] 💡 **ThinkBig** — ThinkLocal + ThinkWide + ThinkHub zusammengefuehrt
