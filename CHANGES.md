# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.
Mit Versionnummer, Datum und Uhrzeit - sowie einer kurzen Beschreibung / Erläuterung
Format: [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [Unreleased] — 2026-06-26 09:05

### v0.34.63 (Evidence/Messung, KEIN Deploy) — docs(ops): T1.1 RSS/CPU-Live-Messung tsx→node dist (DoD-Abschluss)

Schließt den offenen DoD-Teil von T1.1 („RSS/CPU vorher/nachher **gemessen**", von v0.34.62 als
Folge-Schritt offengelassen) mit realen, reproduzierbaren Zahlen. Doku-only, kein Code-Change.

- **Live-Lauf (TH01):** isolierte Mess-Instanz (`TLMCP_RUNTIME_MODE=local`, libp2p/mDNS aus, Port 9460,
  temp data dir) — stört Produktiv-Daemon (9440) und LAN-Mesh nicht. Je **n=60** Samples @1s, 20s Warmup,
  Prozessbaum-Sampling via `measure-daemon-rss-cpu.mjs`.
- **Ergebnis:** RSS mean **215.8 → 129.1 MiB (-40.2%)**, CPU mean **4.82 → 2.63% (-45.5%)**. `node dist/`
  spart ~40% RSS (≈87 MiB) + ~46% CPU-Grundlast vs. `tsx` — kein esbuild-Transform/In-Memory-Source zur Laufzeit.
  Runbook-Erwartung empirisch bestätigt.
- **Caveat:** Absolutwerte einer isolierten Instanz < Produktions-Daemon; das Δ (identische Konfig beider
  Läufe) ist das belastbare DoD-Signal. **Kein Zahlen-Erfinden** — Roh-JSONs eingebettet.
- **DO:** `docs/operations/T1.1-rss-cpu-measurement.md` (Ergebnis-Sektion), `changes/2026-07-02_t11-rss-cpu-live-measurement.md` (Roh-JSONs + Reproduktion), CHANGES, COMPLIANCE. **Kein Deploy.**

### v0.34.62 (Tooling/Perf-Nachweis, KEIN Deploy) — perf(daemon): T1.1 RSS/CPU-Mess-Slice (tsx→node dist Vorher/Nachher)

Die T1.1-Startumstellung `tsx`→`node dist/` ist bereits gemergt (PR #217). Dieser Slice liefert den
offenen DoD-Teil „RSS/CPU vorher/nachher **gemessen**" als reproduzierbare, deploy-agnostische Primitive.

- **`rss-cpu-stats.ts` (neu, rein):** `percentile`/`computeStats`/`summarizeSamples`/`parsePsSample`
  (`ps -o rss=,%cpu=`, KiB→Bytes)/`formatComparison` (Vorher/Nachher-Markdown, RSS MiB, Δ%) +
  `assertFiniteSummary` (kein `NaN` in der Tabelle = keine erfundenen Zahlen).
- **Prozessbaum-Messung (#235-Review-Blocker):** `parsePidPpid`/`collectProcessTree` (root+Nachfahren,
  zyklen-sicher) + `aggregateTreeSample` (Σ RSS/CPU) — fair für tsx (node+esbuild-Kind) vs. node dist
  (Einzelprozess); Single-PID hätte den Vergleich verzerrt.
- **`scripts/measure-daemon-rss-cpu.mjs` (neu):** Prozessbaum-Sampler (`--pid/--samples/--interval-ms`,
  `ps` mit `LC_ALL=C`) + `--compare`; positive-Int-Arg-Validierung.
- **`docs/operations/T1.1-rss-cpu-measurement.md` (neu):** Runbook (before=`start:tsx`, after=`daemon:start`,
  root-PID via `pgrep`, Prozessbaum-Messung, Warmup, n≥60, **kein Zahlen-Erfinden**).
- **TS:** `rss-cpu-stats.test.ts` (19). Suite **1356 grün**, tsc 0, authored-eslint 0, build 0. Live-Smoke bestätigt.
- **CR:** unabhängiger **Claude**-Subagent APPROVE-WITH-NITS, 0× HIGH/CRITICAL; CR-M1 (NaN-Leck → Finite-Guard)
  + CR-L2/L3/L4/L5 umgesetzt; **Review-Blocker Prozessbaum (Single-PID → Baum-Summe) gefixt**. **DO:** CHANGES (v0.34.62), COMPLIANCE, `changes/2026-07-02_t11-rss-cpu-measurement.md`.
- **Folge:** Live-Erhebung der realen Zahlen = Deploy-Schritt (nicht in diesem PR). **Kein Deploy.**

### v0.34.60 (Bug-Fix, KEIN Deploy) — fix(agent): Registrierung node/-fähig (buildInstanceSpiffe) + präzise Register-Diagnose (Mesh-Messaging A1)

Mesh-Messaging-Auftrag Slice A1. Behebt zwei live verifizierte Blocker:

- **`POST /api/agent/register` 500 → gefixt:** `buildInstanceSpiffe()` (agent-api.ts) parste nur die
  Legacy-`host/`-Grammatik → mit kanonischer `node/<PeerID>`-Daemon-Identität (ADR-022-Flip) null → 500,
  fleet-weit keine Agent-Registrierung, inbox.db leer. Fix via `parseSpiffeUri`+`buildInstanceUri`
  (beide Grammatiken). **Instanz-URI-Schema (ADR-005/ADR-028-konsistent):** Instanzen leben in der
  host-Grammatik → node-Daemon ergibt `host/<PeerID>/agent/<type>/instance/<id>` (PeerID im Node-Slot,
  parsebar, kollisionsfrei zur node-Identität).
- **Präzise Register-Diagnose:** `registerWithDaemon`/`unregisterFromDaemon` (mcp-stdio.ts) verschluckten
  jeden Fehler als „daemon unreachable" (auch 500). Jetzt Low-Level `requestDaemon` + reines
  `agent-register-format.ts`: ok / http-non-2xx (Status+Body) / transport-error sauber getrennt; dataDir
  korrekt durchgereicht.
- **TS:** `agent-api.test.ts` (node-Daemon register→200-Regression, register→heartbeat→unregister-Round-Trip,
  buildInstanceSpiffe-Unit inkl. Zwei-Grammatik-Split), `agent-register-format.test.ts` (neu, 7). Suite
  **1320 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke bestätigt.
- **CR:** unabhängiger **Claude**-Subagent APPROVE-WITH-NITS, 0× HIGH/CRITICAL; CR-M1 (Ende-zu-Ende
  send-to-instance = A2/A3-Scope) via Split+Round-Trip-Test festgezurrt; CR-L1 (Doc `stableNodeId`) +
  CR-L2 (PeerID-Fixture) umgesetzt. **DO:** CHANGES (v0.34.60), COMPLIANCE, `changes/2026-07-02_a1-agent-register-node-spiffe.md`.
- **Folge:** A2 Rollout (Deploy-Gate) → A3 Empfangs-Loop → A4 Runbook + DoD-Probelauf. **Kein Deploy.**

### v0.34.61 (Feature, KEIN Deploy) — feat(mesh): ADR-004 Inbox-Empfangs-Loop-Primitive (Mesh-Messaging A3)

Code-only Slice A3: wiederverwendbare, deploy-agnostische Empfangs-Loop-Primitive `inbox-poller.ts`
(`unread → deliver → mark-read`). Session-Zustellung (Hook/agent-send) bleibt bewusst Agent-Home.

- **`pollInboxOnce`** at-least-once (mark-read erst nach erfolgreichem deliver → kein Message-Loss;
  Redelivery + Dedupe per message_id), pro-Nachricht fehler-isoliert.
- **`createInboxPoller`** Interval-Runner: nicht-überlappend (inFlight-Guard), fehler-gekapselt,
  unref, start/stop idempotent (Timer injizierbar).
- **`buildDaemonInboxDeps`/`createDaemonInboxPoller`** gegen `requestDaemon`
  (`GET /api/inbox?unread=true[&for_instance]`, `POST /api/inbox/mark-read`); `for_instance` = A1-Instanz-URI.
- **TS:** `inbox-poller.test.ts` (13: pollInboxOnce inkl. markFailed-Split, Interval-Runner-Nichtüberlappung,
  Daemon-I/O via vi.mock). Suite **1319 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke bestätigt.
- **CR:** unabhängiger **Claude**-Subagent APPROVE-WITH-NITS, 0× HIGH/CRITICAL; CR-M1 (Counter-Split
  `markFailed`) + CR-M2 (klarer JSON-Fehler + buildDaemonInboxDeps-Coverage) + CR-L1/L2 (Doc) umgesetzt.
  **DO:** CHANGES (v0.34.61), COMPLIANCE, `changes/2026-07-02_a3-inbox-poller.md`.
- **Folge:** A2 Rollout (Deploy) → A4 Runbook; Deploy-Zeit: Poller in Agent-Supervisor einhängen.
  **Kein Deploy.**

### v0.34.59 (Hardening, KEIN Deploy) — fix(mcp): Phantom-Announce-Guard für geteilte MCP-Server (serve_shared, ADR-032)

Hardening zu ADR-028 D4-a / MEDIUM aus dem #229-Review: das fleet-weite Config-Template deklariert
Shared-MCPs default-open, und `registerSharedMcps` announced sie **ohne Provider-Prüfung** → jeder
Spoke würde `mcp:pal`/`mcp:unifi` als **Phantom-Provider** ins CRDT gossippen.

- Neues `[mcp] serve_shared` (bool, Default **false**) + Env `TLMCP_MCP_SERVE_SHARED`. Nur ein
  designierter Provider (Hub, `serve_shared=true`) announced seine deklarierten Shared-MCPs.
- Reine `guardSharedMcpAnnounce(serveShared, result)` (`mcp-registration.ts`) filtert vor der
  Registrierung (false → 0 Capabilities, deklarierte → `skipped` mit Grund, laut geloggt); gegatet in
  `index.ts`. `config/daemon.toml` um `[mcp] serve_shared = false` + Kommentar ergänzt.
- Orthogonal zu „Discovery default-open" (entscheidet nur **ob** Provider, nicht **wer** auflösen darf).
  Keine Reachability-Probe (local-exec/Q1 deferred → kein Serve-Prozess zu proben); Liveness-Probe
  supersediert später.
- **TS:** `mcp-registration.test.ts` (+5, guard passthrough/suppress/skip-Erhalt/E2E), `config-mcp-share.test.ts`
  (+3, Default/TOML/Env). Suite **1304 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: off unterdrückt, on reicht durch.
- **CR:** unabhängiger **Claude**-Subagent. **DO:** ADR-032 (neu), CHANGES, COMPLIANCE, `changes/2026-07-02_mcp-phantom-announce-guard.md`.
- **Bezug:** eigenständig gegen `main`, mergebar **vor** T3.3 (#230). **Kein Deploy.**

### v0.34.56 (remote-forward-only, KEIN Net-Egress, KEIN Deploy) — feat(mcp): Modell-B MCP-Proxy — Share pal+unifi (T3.1) + Live-Ingress-Route /api/mcp/:server (T3.2)

V5 Spur 3 (Modell B, kritischer Pfad), freigeschaltet durch **Christian-Gate Q1 = JA** (remote-forward-only;
Hub serviert `pal`+`unifi`; local-exec später; `e3dc`/`idm` = knotengebundene Hardware, NICHT im Beta-Forward).

- **T3.1:** `config/daemon.toml` deklariert `pal` + `unifi` als geteilte MCPs (`[[mcp.share]]`, default-open) →
  Registrierung als `mcp:pal`/`mcp:unifi` (category=`mcp`) über den bereits verdrahteten Start-Pfad → fleet-weit
  auflösbar. Read-only-Beta → Stufe `self`; schreibende Tools später → `gate` (`deriveExecutionTier`).
- **T3.2:** `mcp-ingress-api.ts` (`registerMcpIngressApi`) hängt `POST /api/mcp/:server` in den mTLS-`cardServer`.
  **D3-Sender-Auth** aus dem mTLS-Client-Cert (`extractCanonicalSender`, strikt `isCanonicalNodeUri`): kein/
  ungültiger/nur-Legacy/malformter Cert → **403** (fail-closed, canonical-only). Danach reiner
  `handleMcpIngress`-Ablauf (400/503). **Executor bewusst deferred → T3.3:** routbarer Dispatch → **501**
  (KEIN Net-Egress); `local` → 501 „local-exec deferred (Q1)".
- **TS:** `mcp-ingress-api.test.ts` (neu, 13), `mcp-share-beta.test.ts` (neu, 3, lädt echte config/daemon.toml),
  Live-`inject()`-Route-Smoke (403 ohne Cert). Volle Suite **107 Files / 1312 grün**, tsc 0, eslint-authored 0, build 0.
- **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env), 0× HIGH/CRITICAL;
  **CR-M1** (loser SAN-Prefix-Match) → strikte `isCanonicalNodeUri`-Validierung + Regressionstests; **CR-L2**
  (Self-Forward-1-Hop) als T3.3-Guard-Hinweis vermerkt. **DO:** ADR-028-D4 (T3.1/T3.2-Sektion), COMPLIANCE,
  `changes/2026-07-01_t31-t32-modell-b-mcp-ingress.md`.
- **Folge:** T3.3 Live-undici-mTLS-Executor (1-Hop-Guard, D2-Pin, beidseitiges Audit) → T3.4 → T3.5 Zwei-Peer-DoD.
  **Kein Deploy.**

### v0.34.55 (Doc-only, KEIN Deploy, keine Entscheidung präjudiziert) — docs(adr): ADR-031 Tailscale-Transport-Policy — T2.5-Entscheidungsvorlage (Q4/Q5)

V5 T2.5: die zwei vorhandenen Admin-Decision-Prep-Drafts (`hermes/reports/2026-06-30-…` +
`…2026-07-01_…`) read-first zu **einem** Repo-ADR konsolidiert:
`docs/architecture/ADR-031-tailscale-transport-policy.md`.

- **Charakter:** reine **Optionsvorlage** (Status `Proposed/DRAFT`) — präjudiziert **keine** Live-
  Entscheidung, ändert keine Config, stellt keinen Peer um, kein Deploy. Q4/Q5 bleiben ausdrücklich
  Christians Entscheid.
- **Empfehlungslinie (nicht bindend):** A2 (pro-peer Failover) + B2 (Tailscale-only DERP, kein
  Beta-`relay_service` auf TH01); mTLS/SPIFFE bleibt über allen Transporten die AuthN/AuthZ-Schicht.
- Enthält Live-Belege (TH01 2026-07-01: TS wählt auf dem LAN den Direktpfad ~2–4 ms, `fra`-DERP nur
  Roaming-Fallback), das Policy-Schema (`preferred`/`fallback`/`identity`/`relay`) + Beta-Defaults und
  die offenen Christian-Entscheide (Q4/Q5, Tailnet-ACL, HTTPS-Fallback).
- Die zwei Quell-Drafts sind materiell konsistent (kein Konflikt). CR: Claude-Faithfulness-Review —
  quellentreu, konfliktfrei, bleibt Optionsvorlage; 1× LOW (Querverweis) präzisiert.

### v0.34.54 (Kosmetisch/Bookkeeping, KEIN Deploy, keine Autorisierungs-Semantik) — fix(mesh): Peer-Eintrag bei krypto-attestiertem Flip auf kanonische agentId umschlüsseln (127a)

TODO #127(a): Nach einem **krypto-attestierten** Identity-Flip (`markPeerIdVerified`, `senderUri`
kanonisch = `node/<PeerID>`) blieb der Ziel-Eintrag in `MeshManager.peers` unter seiner **Legacy**-
agentId (`host/<id>`) gekeyed; Bookkeeping/Logs/`mesh_status` zeigten die veraltete Identität. Die
Auflösung (`resolvePeerPublicKey`) lief schon immer über `peer.libp2p.peerId + peerIdVerified` —
**key-unabhängig** (daher „funktional gelöst").

- **Fix:** Im bereits krypto-attestierten kanonischen-Flip-Block (nach der Duplikat-Supersession) wird
  der Eintrag auf die kanonische agentId (`= senderUri`) umgeschlüsselt (Map-Key + `peer.agentId`).
  Reine Key-/Darstellungs-Konsistenz, **keine** Änderung an Auflösung/Autorisierung/PeerID-Bindung.
- **Eng gehalten:** Re-Key NUR im eindeutigen PeerID-Pfad (exakter `senderUri`- oder `byPeerId`-Match),
  **nicht** im schwächeren `remoteHost`-Host-Bind-Fallback (fragile `.56/.222`-Flip-Nodes) —
  `targetViaRemoteHost`-Flag; deren Verhalten bleibt unverändert. Defensiver `occupant`-Guard gegen
  Fremd-/Duplicate-Key-Überschreibung. **Transaktional:** `rollback()` (bei fehlgeschlagener Envelope-
  Signatur) dreht das Re-Key vollständig zurück (vor dem Restore superseder Duplikate).
- **Tests:** 3 neue (`mesh.test.ts`): Re-Key, Rollback, keine Fremd-/Duplicate-Key-Korruption; ein
  bestehender Spoof-Safe-Test auf den kanonischen Key nachgezogen (reine Bookkeeping-Anpassung,
  Security-Assertion unverändert). `mesh.test.ts` **34/34**, volle Suite **104 Files / 1290 grün**,
  `tsc` 0, build grün. CR: Claude-Subagent — solide, kein HIGH/CRITICAL/MEDIUM.

### v0.34.53 (Pure-Test, KEIN Deploy, keine Runtime-Änderung) — test(mtls): dedizierter Issuer-Fingerprint-Integrationstest (127c)

TODO #127(c): die bisher nur **live bewiesene** mTLS-Invariante `issuerCertificate.fingerprint256 ===
certFingerprint(ca.crt.pem)` mit einem echten Handshake automatisiert festnageln.

- **Warum:** Die ADR-022-PeerID-Attestierung (`agent-card.ts` → `attestedPeerIdFromCert`) verlässt sich
  darauf, dass der aus der eigenen Mesh-CA **abgeleitete** Pin (`resolveAttestingCaFingerprints` →
  `certFingerprint`) == dem im mTLS-Handshake **beobachteten** `issuerCertificate.fingerprint256` ist.
  Node liefert Uppercase-Colon-Hex, `certFingerprint` lowercase-no-colon; `normalizeFingerprint`
  rekonziliert. Bräche das, schlüge die Attestierung **still** fehl. Bestehende Unit-Tests nutzten nur
  **synthetische** Fingerprints.
- **Neu:** `packages/daemon/src/mtls-issuer-fingerprint.test.ts` — echter `node:tls`-mTLS-Handshake
  (Server `requestCert+rejectUnauthorized`, Client-Cert; Chain scharf), beide Seiten lesen
  `getPeerCertificate(true)` (wie `agent-card.ts` in Produktion). Assertions exerzieren den
  **Produktionspfad** (`resolveAttestingCaFingerprints → isAttestingIssuer → attestedPeerIdFromCert`):
  beide `authorized`, Wire-Issuer normalisiert == derived-Pin, E2E-PeerID-Attestierung, plus
  Negativkontrolle (fremde CA attestiert NICHT) und explizite Format-Divergenz-Assertion.
- **Ort:** in `packages/daemon/src/` (nicht `tests/integration/`), da der CI-Daemon-Job nur
  `packages/daemon` testet → nur so gatet der Test.
- **Beleg:** 6/6 grün, volle Suite **105 Files / 1293 grün**, `tsc` 0, `eslint` (neue Datei) 0, build grün.
  Keine Runtime-Datei berührt. CR: Claude-Test-Review — solide, kein HIGH/CRITICAL; 1 LOW (Format-
  Divergenz selbst-dokumentieren) übernommen.

### v0.34.52 (Security-Hardening, KEIN Deploy) — fix(tls): token-onboarded Bundle fail-closed gegen `ca.crt.pem` validieren (127b)

Pre-existing CR-MEDIUM (TODO #127b): Der **token-onboarded Zweig** in `tls.ts loadOrCreateTlsBundle`
(Node besitzt `ca.crt.pem` + `node.crt.pem`/`node.key.pem` vom Admin, aber **keinen** `ca.key.pem`)
reichte das gelieferte Bundle bisher **ungeprüft** durch — im Gegensatz zum Frisch-Gen-/Reuse-Pfad,
der Signatur, Zeitfenster und Cert↔Key-Match validiert. Ein beschädigtes/abgelaufenes/fremd-signiertes
Bundle wurde als gültig serviert → Peers lehnen es in der mTLS-Handshake ab → **stiller Mesh-Ausfall**.
Ohne CA-Key kann der Node nicht selbst neu ausstellen.

- **Fix:** Die gelieferte `ca.crt.pem` **ist** der Trust-Anchor. Analog zum Frisch-Gen-Primärpfad
  fail-closed validieren: `certKeyMatches && verifyPeerCert(caCertPem, certPem)` (Signatur + Leaf- +
  CA-Gültigkeit, ADR-024 MEDIUM-1) → sonst **`throw`** mit Operator-Meldung. Der zurückgegebene Anchor
  verifiziert das Cert damit **immer** (`index.ts` kann den Issuer auflösen und kanonisch flippen).
- **Kanonische Nodes (ADR-024):** korrekt onboarded, indem der Admin die Attesting-CA (z. B. `.94`) als
  `ca.crt.pem` mitliefert → greift. Der own-CA-Fall hat per Definition einen `ca.key` und erreicht diesen
  Zweig nie. **Keine Verhaltensänderung für gültige Bundles**; nur inkonsistente/ungültige werden abgewiesen.
- **Tests:** neuer `describe`-Block „127b" (Zweig war **ungetestet**) — 6 Regressionstests
  (gültig-durchgereicht +Anchor-verifiziert, kanonisches Onboard, sowie fail-closed für nicht-signiert /
  Cert-Key-Mismatch / abgelaufene-CA / inkonsistenter-Anchor). `tls.test.ts` **38/38**, volle Suite
  **104 Files / 1287 grün**, `tsc` **0**, `npm run build` grün.
- **CR:** Claude-Security-Subagent — 1× MEDIUM (falscher `caCertPem`-Anchor auf einem `retainableCanonical`-
  Fallback) → **Fallback entfernt** (widersprüchlicher Zustand ohne realen Onboarding-Weg); Re-Review APPROVE,
  0× HIGH/MEDIUM offen. (`agy`-Backend im Env nicht verfügbar → Claude-Subagent statt `pal:codereview`.)

### v0.34.51 (Cleanup Hard-Remove, KEIN Deploy, kein Laufzeit-Change) — chore(cleanup): tote Legacy-Module `cert-rotation.ts` + `policy.ts` entfernen

Abschluss der Deprecations #221/#222: beide Module (0 Produktions-Importeure, read-first auf
`main @ 91a3b8b` erneut verifiziert) hart entfernt.

- **Entfernt:** `cert-rotation.ts` + `cert-rotation.test.ts`, `policy.ts` + `policy.test.ts`.
- **`cert-rotation-recheck.test.ts`**: RE-CHECK A (kanonischer Reissue-Pfad via `tls.ts`) **bleibt**; RE-CHECK B von „totes Modul/@deprecated-Guard" zu **Removal-Guard** (Datei weg + kein Importeur) umgeschrieben.
- **NICHT angetastet:** `tls.ts loadOrCreateTlsBundle`, `cert-expiry-monitor.ts`, `crl.ts`, mTLS/Trust, `isApprovedPeerSender`, Vault-Approval-Flow, `discovery-policy.ts` (anderes lebendes Modul). `TODO.md` nachgezogen.
- **Beleg:** tsc **0** (keine verwaisten Importe); volle Suite **106 Files / 1281 grün** (−18 = genau die gelöschten Tests); Removal-Guard empirisch bewiesen (Stub anlegen ⇒ rot).

### v0.34.50 (Lint-Cleanup, KEIN Deploy, keine Verhaltensänderung) — chore(lint): `require()` → ESM-`import` in Legacy-Modulen

Drei `@typescript-eslint/no-require-imports`-Baseline-Errors (seit 2026-04-05) in den
deprecateten Modulen beseitigt; das Paket ist `"type": "module"`.

- **`cert-rotation.ts`**: `import forge from 'node-forge'` (wie `tls.ts`/`cert-issuer.ts`), inline-`require` raus.
- **`policy.ts`**: `import { createHash } from 'node:crypto'` + `writeFileSync` zum `node:fs`-Import; beide inline-`require` raus.
- **Verhaltens-identisch** (reine Import-Mechanik); node-forge ist harte Dependency → eager Import sicher.
- **Beleg:** eslint auf beiden Dateien **3 Errors → 0**; tsc 0; volle Suite **106 Files / 1299 grün**.
- **Tests**: `policy.test.ts` (+2: `getVersion`/`save` decken die konvertierten `createHash`/`writeFileSync`-Pfade). CR: Claude-Subagent APPROVE, 0× HIGH/CRITICAL; CR-NIT (getVersion/save untested) adressiert.

### v0.34.49 (Cleanup, KEIN Deploy, keine Verhaltensänderung) — chore(policy): `policy.ts`/`PolicyEngine` als @deprecated/Legacy markieren

Totes Modul `policy.ts` (`PolicyEngine`, 0 Produktions-Importeure — nur `policy.test.ts`) trug
einen irreführenden Header („zur Laufzeit evaluiert") — nie an den Request-Pfad angeschlossen.
Jetzt klar als Legacy markiert (gleiches Muster wie `cert-rotation.ts`/#221).

- **`policy.ts`**: Header → prominenter `@deprecated`-Block + Klassen-Tag, die den **real verdrahteten** AUTHZ-Pfad benennen (mTLS/Trust + `isApprovedPeerSender` ADR-026 + Vault-Approval-Flow; place-or-refuse = Kapazität). CR-HIGH-Korrektur: `approval-gates.ts` ist ebenfalls unverdrahtet → nicht als kanonisch zitiert. **Keine Logik-Änderung** (nur Kommentare, git-diff-belegt).
- **Markieren statt löschen:** PolicyEngine bleibt testbarer Entwurf (signierte Policy-Verteilung „Phase 2"); Anschließen via ADR oder Entfernen = Folge-Slice.
- **`policy.test.ts`** (+2 Guards): 0 Produktions-Importeure (schließt lebendes `discovery-policy.ts` aus) + Modul bleibt @deprecated-markiert. `TODO.md` §3.4 nachgezogen.
- Volle Suite **106 Files / 1297 grün**, tsc 0. Guard-bewiesen (Marker entfernt ⇒ Test rot). (`require()`-eslint-Errors in policy.ts = Baseline seit 2026-04-05, nicht im Slice.)

### v0.34.48 (Cleanup, KEIN Deploy, keine Verhaltensänderung) — chore(cert): `cert-rotation.ts` als @deprecated/Legacy markieren

Totes Modul `cert-rotation.ts` (0 Produktions-Importeure, RE-CHECK B) trug einen irreführenden
Header („kann als periodischer Check laufen") — nie verdrahtet. Jetzt klar als Legacy markiert.

- **`cert-rotation.ts`**: Header → prominenter `@deprecated`-Block + per-Export-Tags, die den kanonischen Pfad benennen (Erneuerung = `loadOrCreateTlsBundle`/Reissue beim Start; Live-Alert = `cert-expiry-monitor.ts` T2.1; Pairing = `pairing.ts`). **Keine Logik-Änderung** (nur Kommentare).
- **Markieren statt löschen:** `trustReset`/`auditCerts` bleiben als unverdrahtete, getestete Manuell-Utilities (Guardrail „nicht neu verdrahten ohne ADR"); Entfernen = optionaler Folge-Slice.
- **`cert-rotation-recheck.test.ts`** (+1): Guard, dass das tote Modul markiert bleibt + auf die kanonischen Pfade zeigt. `cert-rotation.test.ts`: Header-Notiz. `TODO.md` Z407 nachgezogen.
- Volle Suite **106 Files / 1295 grün**, tsc 0. Guard-bewiesen (Marker entfernt ⇒ Test rot). CR: Claude-Subagent APPROVE, 0× HIGH/CRITICAL.

### v0.34.47 (T2.4-Folge / V5 Spur 2 — Routing/Lastverteilung, KEIN Deploy) — feat(routing): Self-Last in der least-loaded-Auswahl

#219 wählte den least-loaded **Remote**-Peer, der **lokale** Knoten (nicht in `/api/peers`)
konkurrierte aber nicht → lokal ausführbare Skills konnten unnötig remote geroutet werden.
Jetzt konkurriert der lokale Knoten fair mit.

- **`dashboard-api.ts`**: `/api/status` liefert `resources` = `getNodeResources(ownAgentId)` (Self-Side-Map; `ownAgentId == selfIdentityUri` = Key von `setNodeResources` **und** Self-Kandidat in `/api/capabilities`).
- **`peer-selection.ts`**: neue reine `chooseTargetAgent(candidates, peers, self, explicit?)` kapselt die gesamte Auswahl (explizit / least-loaded inkl. Self-Eintrag via `buildLoadMap`).
- **`mcp-stdio.ts`** `execute_remote_skill`: holt `/api/status`, ergänzt Self als synthetischen Eintrag, delegiert an `chooseTargetAgent` → wählt lokal, wenn lokal am wenigsten ausgelastet (spart den Hop). Fail-open mehrstufig (try/catch + finite-Validierung + candidates[0]).
- **Tests**: `peer-selection.test.ts` (+6: `chooseTargetAgent`), `dashboard-api.test.ts` (+2). Volle Suite **106 Files / 1294 grün**, tsc 0. Guard-bewiesen (Self-Merge entfernt ⇒ Test rot). CR: Claude-Subagent merge-fähig, CR-MEDIUM (untestbare Wiring-Entscheidung) via `chooseTargetAgent`-Extraktion gefixt.

### v0.34.46 (T2.4-Folge / V5 Spur 2 — Routing/Lastverteilung, KEIN Deploy) — feat(routing): Peer-Resource-basierte least-loaded-Auswahl

Bei mehreren fähigen Peers wählt der Anfrager (`execute_remote_skill`) jetzt den **am
wenigsten ausgelasteten** Knoten anhand der seit #218 exponierten Resource-Attribute.
**Fail-open:** ohne Resource-Daten unverändert (erster Kandidat).

- **`peer-selection.ts`** (neu, rein/testbar): `compareLoad` (lexikografisch RAM→CPU→agent_count), `pickLeastLoaded` (Min-Last, Gleichstand→früher, fail-open), `buildLoadMap` (defensiv: nur finite Zahlen — Zero-Trust gegen NaN/null aus Peer-Cards).
- **`dashboard-api.ts`**: `/api/peers` liefert `agent_card.resources` (null ohne Snapshot).
- **`mcp-stdio.ts`** `execute_remote_skill`: wählt via `pickLeastLoaded`(`buildLoadMap(/api/peers)`) statt `candidates[0]`; expliziter `target_agent` + Lokal-Fallback unverändert.
- **Tests**: `peer-selection.test.ts` (neu, 13), `dashboard-api.test.ts` (+2). Volle Suite **106 Files / 1285 grün**, tsc 0. Guard-bewiesen (Auswahl invertiert ⇒ 3 Tests rot). CR: Claude-Subagent APPROVE, CR-MEDIUM (NaN-Defense via `buildLoadMap`) gefixt+getestet.
- Scope: Self-Last (lokale Card) + Live-Zwei-Peer-Beweis (deploy-gegated) = Folge.

### v0.34.45 (T2.4-Folge / V5 Spur 2 — Kapazitäts-Schutz + Observability, KEIN Deploy) — feat(placement): CPU/agent_count-Heuristik + Mesh-Exposition der Resource-Attribute

Das place-or-refuse-Gate gatet jetzt zusätzlich über **CPU-Last** und **agent_count**
(Basis-T2.4 nur RAM), und die Resource-Attribute werden über die Agent-Card im Mesh exponiert.

- **`resource-metrics.ts`**: `evaluatePlacementMetrics(metrics, limits)` — Priorität RAM→CPU→agent_count, strikt `>`, `reason:'capacity'` + `limit`-Diskriminator; pro Dimension fail-open (null/NaN-skip) und 0=deaktiviert. Alte `evaluatePlacement` bleibt Back-Compat-Wrapper.
- **`task-executor.ts`**: RAM frisch/await (fail-open), CPU aus 15s-Side-Map, agent_count instant; CPU/agent-Reader via `safeReadDimension` crash-sicher. `reason:'capacity'` → 503-Mapping bleibt.
- **`config.ts`**: `refuse_cpu_percent` (0..100, Default 0=aus), `refuse_agent_count` (>=0, Default 0=aus) + Env + Range-Checks. **Opt-in** — RAM-Verhalten unverändert.
- **`agent-card.ts`**: optionaler `resources`-Block in `/.well-known/agent-card.json` (cache-bewusst, Quelle = Self-Side-Map) → Peers sehen dieselbe Kapazität, nach der abgelehnt wird.
- **Tests**: `place-or-refuse.test.ts` (+11), `agent-card.test.ts` (neu, 3). Volle Suite **105 Files / 1270 grün**, tsc 0. Guard-bewiesen (`>`→`>=` ⇒ 3 Grenz-Tests rot). CR: Claude-Subagent APPROVE, CR-MEDIUM (fail-open-Garantie) gefixt+getestet.

### v0.34.44 (T1.1 / V5 Spur 1 — Runtime-Umstellung, KEIN Deploy) — perf(daemon): Start von tsx auf kompiliertes `node dist/` (Launch-Configs)

Der langlaufende Daemon startet jetzt überall aus kompiliertem `dist/index.js` statt via
`tsx` (Laufzeit-Transpilation). **Belegt:** RSS ~265 MB → ~166 MB (**−~100 MB / −37 %**),
2 Prozesse → 1 (kein esbuild-Loader), Boot ~1.1 s → ~0.7 s (**−35 %**). Zudem behebt es
einen echten Fehler: `tsx` ist devDependency → `npm install --omit=dev` würde einen
tsx-Start brechen.

- **`install.sh`**: `npx tsc`-Build + `dist/index.js`-Guard in `install_deps` (vor Service-Install); generierter systemd-ExecStart → `node dist/index.js` (TSX_PATH entfernt).
- **Statische Templates**: `thinklocal-daemon.service`, `com.thinklocal.daemon.plist(.template)` → `dist/index.js`.
- **`service.sh`** (macOS Legacy, CR-HIGH): `ensure_daemon_built`-Guard vor `bootstrap`. **`thinklocal-daemon.ps1`** (Windows, CR-MEDIUM) → `dist\index.js`. **`ssh-bootstrap-trust.sh`**: pkill-Hinweis → `daemon/dist/index.js`.
- Bewusst auf tsx belassen (out of scope): CLI `thinklocal.ts` + `mcp-stdio.ts`-Bridge (on-demand).
- **Tests**: `start-path.test.ts` +6 (install.sh/.service/Plist/service.sh-Guard/ssh-bootstrap/.ps1), `launchd-plist.test.ts` +1. Volle Suite **104 Files / 1256 grün**, tsc 0, eslint 0.

### v0.34.43 (T2.2-Follow-up / V5 Spur 2 — Observability-Lücke, KEIN Deploy) — fix(telegram): Alert-Events in den Daemon-Telegram-Sink verdrahten

Die in T2.1 (#213) und T2.2 (#214) emittierten Alert-Events `system:cert_expiry` und
`system:skill_health` erreichten **keinen Operator**: der `TelegramGateway`-Forwarding-Switch
kannte sie nicht, sie fielen durch. Dieser Fix stellt sie über den bereits vorhandenen
Daemon-Telegram-Sink zu.

- **`telegram-gateway.ts`**: Switch-Logik in reine, testbare Funktion `formatMeshEventForTelegram(event, ts)` extrahiert (Konstruktor startet echtes Bot-Polling → reine Funktion ohne Bot testbar). Sechs bestehende Cases byte-identisch übernommen.
- **Zwei neue Cases**: `system:cert_expiry` (🟠 warn / 🔴 critical + Neustart-Hinweis, `daysLeft`); `system:skill_health` (⚠️ ungesund / ✅ wieder gesund, `from→to`, `consecutiveFailures`, optional `lastError`).
- Flap-Dämpfung bleibt upstream (Hysterese / Schwellwert-Check) — hier keine nötig.
- **`telegram-gateway.test.ts`** (neu, 11 Tests, erste Testdatei des Moduls): beide Alert-Cases inkl. Tier-Verzweigung, Recovery, Regression der sechs alten Cases, `null`-Spam-Unterdrückung.
- Volle Suite **104 Files / 1249 grün**, tsc 0, eslint 0. Scope-Grenze: breiteres Hermes-Operator-Routing bleibt Admin/Hermes-Seite.

### v0.34.42 (T2.4 / V5 Spur 2 — Kapazitäts-Schutz + Observability, KEIN Deploy) — feat(placement): Resource-Attribute in Registry + place-or-refuse (>90 % RAM)

Knoten kennen jetzt ihre eigene Auslastung routing-wirksam und lehnen neue
Task-Platzierung bei **RAM > 90 %** ab.

- **Resource-Attribute** (`free_ram`, `cpu_load`, `agent_count`) pro Knoten in einer **non-replizierten** Registry-Side-Map (`NodeResourceRecord`) — wie `availability` bewusst NICHT im Automerge-CRDT. Periodischer Updater in `index.ts` (Default 15 s, `unref`/Shutdown-clear).
- **place-or-refuse-Gate** in `TaskExecutor.handleTaskRequest` (der reale Chokepoint): RAM > Schwelle → Ablehnung mit `reason:'capacity'` → **HTTP 503** (statt 404). **Cache-bewusst** (`(total−available)/total`, sonst zählt Linux-Cache als belegt). **Fail-open** bei Mess-Fehler.
- **`config.ts`** `[placement]` (`refuse_ram_percent`=90, `resource_refresh_interval_ms`=15000) + Env + Range-Check; **`events.ts`** `task:refused`.
- Tests: `place-or-refuse.test.ts` (neu, 14) + dashboard-api 503/404 (+2). Volle Suite **103 Files / 1238 grün**, tsc 0, eslint 0. Empirisch guard-bewiesen. CR: Claude-Subagent **APPROVE-WITH-NITS** (Gate+Side-Map CORRECT; CR-MEDIUM fail-open gefixt). Beleg: `changes/2026-06-30_t24-resource-attrs-place-or-refuse.md`.

### v0.34.41 (T2.2 / V5 Spur 2 — Bugfix + Observability, KEIN Deploy) — fix(influx): Health-Probe `/health`→`/ping`-Fallback + Skill-Health-Alert-Event

Behebt die InfluxDB-Health-Probe, die **22.786 Fehlversuche bei gesundem Dienst**
meldete. Root-Cause: `/health` existiert erst ab InfluxDB **1.8** → auf älteren 1.x
**404** → gesunder Dienst dauerhaft als unhealthy. Fix: Fallback auf den universellen,
auth-freien **`/ping`** (204) über alle 1.x/2.x. Zusätzlich emittiert `onTransition`
jetzt ein flap-gedämpftes `system:skill_health`-Event für den Alert-Sink.

- **`builtin-skills/influxdb.ts`**: `/health` zuerst, bei nicht-ok/Fehler `/ping`-Fallback; geteiltes AbortSignal, gibt immer Boolean zurück. `/ping` = Liveness (dokumentiert).
- **`events.ts`** `system:skill_health`; **`index.ts`** `onTransition` emittiert es (nur bei debouncten Flips; listener-isoliert via try/catch). Flap-Dämpfung kommt aus der bestehenden `SkillHealthMonitor`-Hysterese.
- **Scope-Grenze:** Push-Zustellung an Hermes/Telegram = Admin/Hermes-Seite; Event liegt bereit.
- Tests: `influxdb.test.ts` (neu, 6); volle Suite **102 Files / 1222 grün**, tsc 0, eslint 0. Empirisch guard-bewiesen (/ping-Fallback entfernt ⇒ 3 rot). CR: Claude-Subagent **APPROVE-WITH-NITS** (Probe-Fix CORRECT; beide Nits adressiert). Beleg: `changes/2026-06-29_t22-influx-probe-alert-sink.md`.

### v0.34.40 (T2.1 / V5 Spur 2 — Observability, KEINE Cert-Rotation, KEIN Deploy) — feat(cert): Live-Cert-Ablauf-Monitor + <30d-Alert

Schließt die im RE-CHECK (v0.34.39) belegte Lücke: der TLS-Node-Cert-Ablauf wurde
**nur beim Start** geprüft → ein langlebiger Daemon bekam keinen Alarm. T2.1 fügt
einen **periodischen** Monitor hinzu, der bei `< 30 d` (warn) / `≤ 7 d` (critical)
alarmiert — via **signiertem Audit-Event** `CERT_EXPIRY_WARNING` + EventBus
`system:cert_expiry` + Log. **Rotiert nicht:** Reissue passiert weiterhin erst beim
(Neu-)Start (`loadOrCreateTlsBundle`, `daysLeft > 7`); der Alert sagt das explizit.

- **`cert-expiry-monitor.ts`** (neu): `classifyCertExpiry` (rein), `runCertExpiryCheck` (Alarm nur bei warn/critical), `startCertExpiryMonitor` (sofort + `setInterval`, `unref`, try/catch).
- **`index.ts`**: einmaliger Startup-Check → periodischer Monitor; `clearInterval` im Shutdown.
- **`audit.ts`** `CERT_EXPIRY_WARNING`; **`events.ts`** `system:cert_expiry`.
- **`config.ts`**: `[cert]`-Sektion (warn=30, critical=7, interval=12 h) + Env; Fail-fast bei `warn <= critical`.
- **Sink-Scope ehrlich:** durabler Sink (Audit+EventBus) jetzt; Human-Push (Telegram/Toast) = **T2.2/T2.3**.
- Tests: `cert-expiry-monitor.test.ts` (neu, 17); volle Suite **101 Files / 1216 grün**, tsc 0, eslint 0. Empirisch guard-bewiesen (critical-Grenze mutiert ⇒ rot). CR: Claude-Subagent **APPROVE-WITH-NITS** (CR-LOW gefixt, CR-MEDIUM als Scope-Grenze). Beleg: `changes/2026-06-29_t21-cert-expiry-monitor.md`.

### v0.34.39 (KW27 RE-CHECK — Evidence/Test-only, KEINE Produktionscode-Änderung, KEIN Deploy) — test(cert): Rotation-Pfad-Verdikt festgenagelt

RE-CHECK Cert/Rotation (WOCHENPLAN Z62-66). **Verdikt:** (1) Die Dispatch-Prämisse
`cert-rotation.ts → pairing-store.json` ist seit PR #209 veraltet (kanonische Pfade).
(2) `cert-rotation.ts` ist **totes Modul** — kein Produktionscode importiert es.
(3) Die reale Cert-Erneuerung ist `loadOrCreateTlsBundle()` (tls.ts) **beim Start**:
Node-Cert wird bei `daysLeft > 7` behalten, sonst reissued. (4) **Keine Auto-Rotation
auf einem laufenden Daemon** — kein Timer; Erneuerung nur beim (Neu-)Start.

→ Der Cert-Ablauf (2026-09-02) ist ein reales Risiko für durchlaufende Daemons →
**T2.1 gerechtfertigt** (laufender Check + Alert + Reissue/Hot-Reload).

- **`cert-rotation-recheck.test.ts`** (neu, 4 Tests): 30-Tage→behalten, 3-Tage→Reissue-beim-Load (empirisch guard-bewiesen: Gate `>7`→`>0` ⇒ rot), Reissue-nur-auf-Load, `cert-rotation.ts`-Importeure=0.
- Volle Suite **100 Files / 1199 grün**; tsc 0. CR: Claude-Subagent. Verdikt-Doku: `changes/2026-06-29_cert-rotation-recheck-verdict.md`.

### v0.34.38 (T1.3 / V5 Spur 1 — Operational-Hygiene, KEIN Protokoll-Change, KEIN Deploy) — feat(storage): SQLite WAL-Checkpoint + Retention (ADR-030)

Alle SQLite-DBs liefen im WAL-Modus, ohne je zu checkpointen → `-wal`-Dateien
wuchsen unbegrenzt. T1.3 führt periodischen `wal_checkpoint(TRUNCATE)` für
`audit.db` + `capabilities/activation.db` ein (Maintenance-Task in `index.ts`,
`unref()`/`clearInterval`, 1× beim Start; plus in jedem `close()`), sowie
Retention **nur auf sicher löschbaren Daten**:
- `peer_audit_events` nach Alter (Default 90 d) — re-syncbar, keine Hash-Chain.
- `capability_activations` mit `state='revoked'` nach Alter (Default 90 d) — GC toter Zeilen.

Die **lokale signierte `audit_events`-Chain bleibt append-only** (Phase-1-Konsensus;
Rationale in ADR-030 §3). Maintenance ist try/catch-gekapselt (kein Daemon-Crash);
`busy`-Checkpoints werden auf `debug` sichtbar gemacht.

- **`config.ts`**: neue `[retention]`-Sektion (`checkpoint_interval_ms`, `peer_audit_max_age_days`, `revoked_capability_max_age_days`) + Env-Overrides; `0` beim Alter = deaktiviert.
- **`audit.ts` / `capability-activation.ts`**: `checkpoint()` + `prune*OlderThan()` + Checkpoint-on-close.
- **`index.ts`**: periodischer `runStorageMaintenance`-Task + Shutdown-Cleanup.
- **`retention.test.ts`** (neu, 10 Tests); empirisch guard-bewiesen (Cutoff invertiert ⇒ 1 rot, restauriert ⇒ 10 grün).
- Tests: volle Daemon-Suite **99 Files / 1195 grün**; tsc 0. CR: Claude-Subagent **APPROVE-WITH-NITS** (kein Bug; beide Low-Nits adressiert). Belege: `docs/architecture/ADR-030-*.md`, `changes/2026-06-29_t13-sqlite-wal-checkpoint-retention.md`.

### v0.34.37 (T1.1 / V5 Spur 1 — Perf/Packaging, KEIN Verhaltens-/Protokoll-Change, KEIN Deploy) — perf(daemon): Startpfad `tsx` → `node dist/`

Der scharfe Daemon startet jetzt vorkompiliert über `node packages/daemon/dist/index.js`
statt via `tsx` (Runtime-Transpile, eine **devDependency**). Gemessen (Median aus 3
Läufen, identische Env, Single-Process im systemd-Stil, Node v22.22.3):
**RSS 201 → 132 MiB (−34 %)**, **Start-CPU 2.08 → 1.19 s (−43 %)**. Behebt nebenbei
die latente Inkonsistenz, dass der Deb-Postinst `npm install --omit=dev` läuft (tsx
also nie installiert), die Unit aber `--import tsx` startete.

- **`package.json`** (root): `start` + `daemon:start` → `npm run daemon:build && node packages/daemon/dist/index.js`; `start:tsx` als Dev-Fallback ergänzt.
- **`scripts/build-deb.sh`**: tsc-Build + `dist/index.js`-Guard **vor** dem Packen; systemd `ExecStart` und `tlmcp-daemon`-Wrapper → `node …/dist/index.js` (kein `--import tsx` mehr).
- **`packages/daemon/src/start-path.test.ts`** (neu): Regressionstest (loader-form-agnostisch), empirisch guard-bewiesen (ExecStart→tsx ⇒ 1 rot, restauriert ⇒ 4 grün).
- **Bewusst out-of-scope:** CLI-/`tlmcp-mcp`-Wrapper bleiben auf `tsx` (vorbestehend, nicht verschlechtert) → Follow-up. **Live-Cutover auf TH01 (build vor Restart) ist ein gateter Deploy-Schritt, nicht Teil dieses PRs.**
- Tests: volle Daemon-Suite grün (96 Files / 1178 Tests). CR: Claude-Subagent **APPROVE-WITH-NITS** (alle Findings low/info). Beleg: `changes/2026-06-29_t11-tsx-to-node-dist.md`.

### v0.34.36 (KW27 Follow-up — Runtime-/Operator-Fix; KEIN Deploy) — fix(cert): Recovery-/Rotation-Helper auf kanonische TLS- und Pairing-Pfade migriert

Schliesst den in v0.34.35 belegten Legacy-Pfad-Mismatch: `cert-rotation.ts` und `recovery.ts` loeschen/pruefen jetzt die aktuellen Runtime-Dateien `tls/node.crt.pem`, `tls/node.key.pem` und `pairing/paired-peers.json` statt der alten `certs/node.*`-/`pairing-store.json`-Pfade. `auditCerts()` betrachtet `tls/*.crt.pem`. Fokus-Regressionstests decken `rotateCert()`, `trustReset()`, `auditCerts()` und `runRecoveryChecks()` ab.

**Checks:** `cd packages/daemon && npx vitest run src/cert-rotation.test.ts src/recovery.test.ts` gruen; `npm run daemon:build` gruen. **CR:** codex review — keine actionable correctness issues.

### v0.34.35 (Evidence-only — KW27 Re-Check; AMBER; KEIN Code/Deploy) — docs(cert): Cert-Rotation-Pfad empirisch eingeordnet

Re-Check des Cert-Rotation-Pfads mit reproduzierbarem Dry-Run. Ergebnis:
`cert-rotation.ts`/`recovery.ts` sind **nicht** im Daemon-Startup verdrahtet und
zeigen noch auf Legacy-Pfade (`certs/node.crt`, `certs/node.key`,
`pairing-store.json`). Die aktuelle Runtime nutzt `tls/node.crt.pem`,
`tls/node.key.pem` und `pairing/paired-peers.json`. Der echte Renewal-Pfad ist
der Startup-Load via `loadOrCreateTlsBundle()`: ein 3-Tage-Testcert wurde beim
erneuten Bundle-Load regeneriert (`DAYS_LEFT_AFTER_STARTUP_LOAD 89`).

**Checks:** `rg`-Import-/Pfadprüfung, reproduzierbarer `npx tsx --eval`-Dry-Run
unter `/tmp`, gezielte Build-/Test-Verifikation. **Nächster Slice:** alte
Rotation-/Recovery-Pfade entweder auf aktuelle Dateien migrieren und testen
oder als irreführenden Legacy-Code deprecaten/entfernen.

### v0.34.34 (Christian-autorisiert; reine Auswahl-Logik, default-neutral; KEIN Deploy/Cert/Flag) — feat(discovery): ADR-028 NIC-Auswahl — allowed_mesh_cidrs überstimmt tailscale*/utun*-Exclude

`selectMeshInterfaces` (`discovery-policy.ts`) schloss virtuelle Interfaces (`tailscale*`/`utun*`/…) **vor** dem `allowed_mesh_cidrs`-Check aus → ein Tailscale-Interface (`utun4`/`100.x`) wurde verworfen, bevor seine IP gegen die erlaubten Mesh-CIDRs geprüft wurde → `.55` konnte sich nicht über Tailscale self-advertisen (ADR-027/Pfad A). **Reine Auswahl-Logik — kein Cert/Flag/Deploy.**

- **`discovery-policy.ts`** `selectMeshInterfaces`: eine IP in einem **explizit** konfigurierten `allowed_mesh_cidrs` **überstimmt** jetzt den Exclude (Override vor dem Pattern-Check). **Default-neutral:** bei leerer `allowed_mesh_cidrs`-Liste greift der Override nie → Linux/Standard-Nodes unverändert. Override gilt nur für IPs im erlaubten CIDR (docker0/172.x außerhalb bleibt aus).
- **`discovery-policy.test.ts`** (+5): Override (utun4/100.x bei `100.64.0.0/10` DABEI), LAN+Tailscale-Koexistenz (`.55`-Fall en10+utun4), Override nur für erlaubte CIDR, docker0 außerhalb bleibt aus, default-neutral ohne CIDR.
- **`docs/architecture/ADR-028-…md`** + `TODO:30`: Design-Note + Status (Live-Aktivierung auf `.55` = Deploy-Gate).

**Checks:** tsc 0, daemon-unit-Suite **1174 grün** (+5). Empirischer Guard-Beleg: Override-Block entfernen → die ADR-028-Override-Tests werden ROT; re-applied → grün. **CR:** clink **claude**. **PC:** `pal:precommit` internal.

### v0.34.33 (Test-only — Christian-autorisiert; KEIN Prod-Code/Deploy) — test(tls): Regressionstest für eigene-CA-Gültigkeit beim Reuse (PR #77, fail-closed)

Schließt einen empirisch belegten **Coverage-Gap**: `loadOrCreateTlsBundle` reissuet die eigene Mesh-CA, wenn die vorhandene `ca.crt.pem` abgelaufen / noch nicht gültig ist (PR #77, security-relevant: eine abgelaufene CA darf NICHT still wiederverwendet werden). Dieser `caValid`-Pfad war **ungetestet** — den Check zu brechen ließ 30/30 tls-Tests grün. **Test-only, keine Produktiv-Code-Änderung.**

- **`tls.test.ts`** (+2, im `loadOrCreateTlsBundle`-Block): (1) eigene CA **abgelaufen** → CA-Reissue; (2) eigene CA **noch nicht gültig** (notBefore in der Zukunft) → CA-Reissue. Assert: zurückgegebene `caCertPem` ≠ Eingabe (reissued) **und** `verifyPeerCert(bundle.caCertPem, bundle.certPem)===true` (frisches Node-Cert unter frischer, gültiger CA).
- **Empirischer Guard-Beleg:** den `caValid`-Check in `tls.ts:218` brechen → genau diese 2 neuen Tests werden **ROT**; restaurieren → **32/32 grün**.

**Checks:** tsc 0, daemon-unit-Suite **1169 grün** (+2). **CR:** clink **claude** codereviewer — **GREEN** (Assertions ziel-spezifisch auf den `!caValid`-Reissue-Pfad, `verifyPeerCert`-Proxy sound, kein Flake); 1 LOW (`DAY`-Shadowing) gefixt. **PC:** `pal:precommit` internal — 0 Issues.
### v0.34.32 (Status-Hygiene — Christian-autorisiert; REIN docs/TODO; KEIN Code/Deploy) — docs(todo): B7 getPeerId — Regression-Proof #204 im Status nachgezogen

Reconcile `TODO.md` gegen main: die B7-Zeile nannte nur den Code-Fix (#175), nicht den empirisch bewachten Repro/Regressionstest (#204, v0.34.31). Ergänzt; offen bleibt ausdrücklich nur der **Live-`converged:false`-Deploy-Gate** (laufende Daemons pre-#175, Diagnose #194 — Christian). Reine TODO-Korrektur, keine Code-/Verhaltens-Änderung.

### v0.34.31 (Test-only — Christian-autorisiert; KEIN Prod-Code/Deploy) — test(libp2p): B7 getPeerId-Repro + Regressionstest (nagelt den Original-Fehlermodus fest)

Der B7-getPeerId-**Code-Fix** ist seit **#175 (`4b55f69`) auf main** (`toPeerId`/`peerIdFromString` in `dialProtocol`+`hangUpPeer`). Bisher fehlte aber ein **expliziter Repro**, der den Original-Fehler `multiaddrs[0].getPeerId is not a function` (Capability-Count-Drift / `converged:false`) an die reale Fehlersignatur bindet. Dieser Slice schließt das **test-only** — keine Produktiv-Code-Änderung.

- **`libp2p-runtime.test.ts`** (+3): neuer Block „B7-Repro: getPeerId-TypeError-Failure-Mode". Ein **libp2p-v2-ähnlicher Mock-Node** bildet das echte Verhalten nach (nackter String → als Multiaddr behandelt → `multiaddrs[0].getPeerId()` → exakt jener TypeError; echtes PeerId-Objekt → Stream-Stub).
  - **REPRO:** ein String löst exakt `/getPeerId is not a function/` aus (Original-Bug, festgenagelt).
  - **FIX (dial/hangUp):** `rt.dialProtocol`/`rt.hangUpPeer` speisen den Mock dank `toPeerId` mit einem PeerId-Objekt → der getPeerId-Pfad wird nie betreten.
- **Empirischer Beleg, dass der Test den Fix wirklich bewacht:** Fix temporär revertiert (`toPeerId`→roher String) → die `FIX:`-Tests + 3 bestehende getPeerId-Tests werden **ROT** (5 failed); Fix restauriert → **alle grün**.

**Checks:** tsc 0, daemon-unit-Suite **1167 grün** (+3). **CR:** clink **claude** codereviewer — **GREEN** (faithful repro, korrekter PeerId-Diskriminant, kein false-negative). **PC:** `pal:precommit` internal — 0 Issues. **Hinweis:** das **Live**-`converged:false`-Symptom bleibt deploy-abhängig (laufende Daemons pre-#175, Diagnose #194) = Christian-Deploy-Gate, kein Repo-Code.

### v0.34.30 (Prep — Christian-autorisiert; Skript-Edit, NICHT ausgeführt; KEIN Deploy/Install) — feat(macos): ADR-029 — Installer-Legacy-Migration reversibel (`.disabled.<datum>` statt `rm`)

Schließt den letzten repo-internen ADR-029-Installer-Sub-Punkt (TODO:354): die LaunchAgent→LaunchDaemon-Migration **löschte** den alten LaunchAgent (`rm -f`) — jetzt wird er **reversibel gesichert** (`mv` → `~/Library/LaunchAgents/com.thinklocal.daemon.plist.disabled.<YYYYMMDD-HHMMSS>`), Rollback möglich. **Reines Skript-Edit — `install.sh` wird NICHT ausgeführt; Live-Install = Christians Deploy-Gate.**

- **`scripts/install.sh`** `install_macos_service`: `launchctl unload` + (bei vorhandener Datei) `mv … .disabled.<ts>` mit `info`-Log; Fallback `rm` nur falls `mv` scheitert. Verhindert Doppelstart, behält die Alt-Plist aber wiederherstellbar.
- **`cleanup_existing` (CR-MEDIUM-Fix, Review zu #203):** löscht den Legacy-LaunchAgent **nicht mehr** per `rm -f` (entlädt ihn nur) → der reversible Backup-Block greift jetzt auch auf dem **`--reinstall`/`--update`-Pfad** (vorher dort weiterhin irreversibel, da die Datei schon weg war). System-Domain-Plist-Entfernung bleibt; `cleanup_existing` läuft nur bei reinstall/update und ist immer von `install_macos_service` gefolgt.
- **`detect_platform`-Mismatch (CR-AMBER, codex-Review zu #203):** `cleanup_existing` verglich `$PLATFORM = "darwin"`, aber `detect_platform` setzt `"macos"` → der gesamte macOS-Cleanup-Block (bootout/unload/Plist-Entfernung) war auf macOS **toter Code**. Beide Vergleiche auf `"macos"` korrigiert (konsistent mit `detect_platform` + `main()`-`case`).
- **`set -e`-Abbruch (CR-Re-Review zu #203):** die ungeschützte `launchctl unload "$HOME/.../com.thinklocal.daemon.plist"` in `cleanup_existing` konnte unter `set -euo pipefail` non-zero liefern und `--reinstall/--update` abbrechen (jetzt, da der macOS-Block wieder live ist). `|| true` ergänzt (wie die Nachbarzeilen). `bootstrap system` bleibt bewusst ungeschützt (Install soll bei Bootstrap-Fehler scheitern).
- **`TODO.md`**: Installer-Pre-Flight-Sub-Item (TODO:354) als erledigt markiert (`$SUDO_USER`/non-root + Node-22-Checks bereits via #196; reversible Legacy-Sicherung jetzt ergänzt).

**Checks:** `bash -n scripts/install.sh` clean; Backup-Logik smoke-getestet (tmp: `legacy.plist` → `legacy.plist.disabled.<ts>`). Kein TS geändert → daemon-unit-Suite unverändert grün. **CR:** clink **claude**. **PC:** `pal:precommit` internal. **Durable-Behavior (KeepAlive{SuccessfulExit:false}/RunAtLoad/FileVault-aware/kein mystery-relauncher) war bereits vollständig auf main** (#192-Template, #196-Installer, #201-Formel) — dieser Slice ist die letzte Migrations-Safety-Ergänzung.

### v0.34.29 (Status-Hygiene — Christian-autorisiert; REIN docs/TODO; KEIN Code/Deploy) — docs(todo): ADR-024/ADR-029-Status gegen main abgeglichen

Reconcile der Planungs-Quelle `TODO.md` gegen den echten main-Stand — mehrere bereits gemergte Items standen noch als „offen" und verfälschten den Plan. **Reine TODO-Korrektur, keine Code-/Verhaltens-Änderung.**

- **ADR-024-Rollout-Gate:** die 2 CR/PC-MEDIUMs sind code-seitig geschlossen (v0.34.20) **und #191 ist gemergt (2026-06-23, auf main)** — TODO sagte noch „Offen: PR-Merge". Korrigiert: offen ist **nur noch Re-Enroll = Christian-Deploy-Gate**. Auch #165-Zeile („⚠️ Rest-MEDIUMs offen") angeglichen.
- **ADR-029-Installer:** Installer-Umbau (`install.sh`→System-Domain + bootstrap + Uninstall, **#196**), Operator-Runbook (#200) und Homebrew/USER-GUIDE (**#201**) sind repo-intern erledigt — die Sub-Items standen noch auf `[ ]`. Abgehakt; offen nur noch **Live-Install/`bootstrap`-Ausführen + Service-User = Christian-Deploy-Gate**.

**Checks:** docs-only (kein TS, kein `.ts`) → keine neuen Tests; Status-Aussagen gegen gh/git verifiziert (#191/#196/#201 gemergt). **CR:** clink **claude**. **PC:** `pal:precommit` internal.

### v0.34.28 (Prep — Christian-autorisiert; Formel-/Doku-Konsistenz; KEIN Deploy/Install/brew-Run) — feat(macos): ADR-029 — Homebrew-Formel + USER-GUIDE auf System-Domain-Semantik angeglichen

Schließt den verbleibenden repo-internen ADR-029-Konsistenz-Rest nach #196/#200: die Homebrew-`service`-Definition + eine USER-GUIDE-Altreferenz spiegelten noch das alte LaunchAgent-/„immer-neustarten"-Modell. **Reines Formel-/Doku-Edit — `brew`/`install.sh` werden NICHT ausgeführt; Live-Install = Christians Deploy-Gate.**

- **`Formula/thinklocal.rb`** `service do`: `keep_alive true` → **`keep_alive successful_exit: false`** (= launchd `KeepAlive{SuccessfulExit:false}`, **kein mystery-relauncher**; hängt am SIGTERM→`exit(0)`-Handler `index.ts:1304`, verifiziert) + explizit **`run_type :immediate`** (RunAtLoad). **Caveat** ergänzt: `brew services` installiert einen **per-User-LaunchAgent** (GUI-Login nötig) → headless/SSH/FileVault via `sudo bash #{libexec}/scripts/install.sh` (System-Domain-LaunchDaemon, ADR-029).
- **`docs/USER-GUIDE.md`**: macOS-`TLMCP_NO_TLS`-Entfernen auf den System-Domain-Pfad `/Library/LaunchDaemons/…` + `sudo launchctl kickstart -k system/com.thinklocal.daemon` umgestellt (Legacy-LaunchAgent-Variante als Klammer erhalten).

**Checks:** **CR clink claude** — DSL bestätigt korrekt; 2 MEDIUM (Caveat-`scripts/install.sh` relativ → absoluter `#{libexec}`-Pfad; SIGTERM-Exit-0-Abhängigkeit verifiziert+dokumentiert) **gefixt**. `ruby`/`brew` auf dem Linux-Build-Host **n/a** → Formel per Inspektion gegen die Homebrew-`service`-DSL geprüft (keine Auto-Lint). tsc 0, daemon-unit-Suite 1164 grün (kein TS geändert → keine Regression). **CO/CG:** n/a (Konsistenz-Slice). **PC:** `pal:precommit` internal.

### v0.34.27 (Prep — Christian-autorisiert; REINE Dokumentation; KEIN Code/Deploy/Install) — docs(operations): ADR-029 Operator-Runbook für Vor-Ort-Termin

Schließt die nach #196 (Installer-Operationalisierung) offene Doku-Lücke: ein **dediziertes Operator-Runbook** für Christians macOS-Vor-Ort-Termin. **Rein dokumentarisch** — keine Code-Änderung, keine Install-Ausführung, kein Live-Wiring.

- **`docs/operations/RUNBOOK-ADR-029-launchdaemon-operator.md`** (neu, 13.7 KB):
  - **§0 Voraussetzungen** — macOS-Version, Node 22+, Repo-Checkout, letzter Installer-PR gemergt, `sudo` (nicht root).
  - **§1 Pre-Flight** — FileVault-Status (`fdesetup status`), Service-Benutzer-/Gruppen-Existenz (`dscl . -list`), Port 9440 frei (`lsof`), alter LaunchAgent-Run-Check, Repo-Sauberkeit + `bash -n` Trockenprüfung.
  - **§2 Operator-Sequenz** — Install / Steuern (`launchctl kickstart/bootout/bootstrap`) / Uninstall (idempotent).
  - **§3 Smoke-Tests** — Prozess, Port, `/health`, `/api/status`, `tlmcp status`, Error-Log-Grep, MCP-Verfügbarkeit in Claude Code.
  - **§4 Reboot-Test** — FileVault-Tauglichkeit inkl. Recovery-Key-Hinweis.
  - **§5 Rollback** — drei Stufen (alter LaunchAgent → Repo-Stand vor #196 → Vault/Audit-Reset mit Sicherungs-Pflicht).
  - **§6 Remote-Verifikation** — was Hermes via Tailscale-IP von TH01 aus prüfen kann, ohne sich am Mac einzuloggen.
  - **§7 Limitierungen** — Service-User-Anlage, sudo-Passwordless, Linux-Äquivalent (KW26-Folge).
  - **Anhang A** — `dscl`-Skript zum Anlegen des dedizierten Service-Benutzers.
  - **Anhang B** — Referenzen (ADR-029, INSTALL.md, PR #196, Schwester-Runbooks).
- **Bewusst NICHT enthalten (Christian-Deploy-Gate):** tatsächliches Ausführen von `install.sh`, Service-User-Anlage, `bootstrap system`, Reboot.
- **Bezug:** [ADR-029](../architecture/ADR-029-macos-launchdaemon.md) + [INSTALL.md](../../INSTALL.md) (macOS-Abschnitt, unverändert — Runbook ergänzt nur, ändert nichts am Endnutzer-Text).

**Compliance:** **CO/CG** n/a (reine Doku, kein Architektur-Thema). **TS** n/a (kein Code). **CR** n/a (Doku-Slice). **PC** n/a. **DO** ✅ — CHANGES, ADR-029-Verweis, TODO.md-Folge-Eintrag.

## [Unreleased] — 2026-06-24 07:32

### v0.34.26 (Prep — Christian-autorisiert; reine Exec-Spec/Skelett; KEIN Net-Egress/mcporter-Call/Wiring/Deploy) — feat(discovery): ADR-028 D4-b — D2-Forward Exec-Schicht (mcporter-Exec-Bridge, Skelett)

Fünfter D4-b-Slice: übersetzt einen `McpForwardDispatch` (#195) in eine ausführungs-freie **Exec-Spezifikation**. **Kein echter Net-Egress, kein mcporter-/child_process-Call, kein Live-Wiring, kein Deploy.**

- **`mcp-forward-exec.ts`** (neu, rein): `buildMcpExecSpec(dispatch, opts?)` → `mcporter-local` (lokaler Serve-**Stub**) | `mtls-forward` (Forward-Deskriptor) | `reject` (403/503/500).
- **`mcporter-local` ist ein SKELETT:** im Repo existiert **kein stabiler mcporter-CLI-Vertrag** (ADR-028 D4 nennt mcporter als lokalen Serve-Pfad; ADR-023 will mcporter+stunnel ersetzen) → `argv` = provisorischer Platzhalter `MCPORTER_ARGV_STUB` (`<server>` eingesetzt), Regressionstest sichert den Platzhalter. Keine erfundene finale CLI.
- **Fail-closed:** `authorized=false` → 403 (Defense-in-depth zum D3-Ingress-Gate); `none` → 503; **Pin-Violation** (aktiver Verifier ⊻ vorhandene, nicht-leere `expectedSpiffeId`) → 500 (kein ungepinnter Forward). Re-prüft die #195-D2-Invariante.
- **CR-Fixes (clink claude, 0 CRITICAL/HIGH, 2 MEDIUM):** Exhaustiveness-`never`-Guard vor dem Remote-Pfad; leerer `expectedSpiffeId` zählt NICHT als gesetzt (XOR-Härtung).

**Tests (`mcp-forward-exec.test.ts`, 12):** Happy-Path local (argv-Stub) + remote (Pin/TOFU), **Plan-Mismatch** (none→503), **Pin-Violation** (beide Richtungen + leerer String), **Timeout-Stub** (Default+Override), **Auth-Reject** (403), configPath-Durchreichung, Stub-Konstanten-Regression, **500-fail-fast** bei unbekanntem kind. 1152 daemon unit grün, tsc 0. **Live read-only `/healthz` (mTLS):** Daemon erreichbar — `/healthz`=404 (Route nicht registriert; Daemon nutzt `/health`=200, ~3.8 ms). **CO/CG:** n/a (Folge-Slice ADR-028 D4). **CR:** clink **claude** codereviewer — 2 MEDIUM gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES, COMPLIANCE, ADR-028-D4-Notiz.

### v0.34.25 (Prep — Christian-autorisiert; reine Handler-Logik; KEIN Net-Egress/Live-Wiring/Deploy) — feat(discovery): ADR-028 D4-b — `/api/mcp`-Ingress-Handler-Logik (Re-PR von #197 gegen main)

Vierter D4-b-Slice, **gestackt auf #195** (Dispatch-Builder): die Kern-Logik des Daemon-MCP-Proxy-Ingress `/api/mcp/<server>`. **Framework-agnostisch + rein** (bis auf injizierten Executor); **kein echter Net-Egress, kein Fastify-Wiring in den Live-Server, kein mcporter-Exec, kein Deploy.**

- **`mcp-ingress.ts`** (neu): `handleMcpIngress(input, deps)` → `{ status, body }`. Ablauf fail-closed: **(1) D3-Auth-Gate** (fehlender/abgelehnter Sender → 403, KEIN Dispatch) → (2) leerer Server → 400 → (3) `resolveMcp` → `planMcpRoute` → `buildMcpForwardSpec` (#193) → `buildMcpForwardDispatch` (#195) → (4) `none` → 503 → (5) local/remote → an injizierten `execute` weiterreichen.
- **D3:** der eingehende `senderUri` (mTLS-Principal) dient NUR dem Auth-Gate; der **Forward**-Sender ist die EIGENE `selfAgentId` (kein Confused-Deputy). **D2:** Pin-Konsistenz zu #195 (bei `requireServerIdentity` trägt der Dispatch `expectedSpiffeId`=Owner).
- **CR-Fixes (clink claude, 0 CRITICAL/HIGH, 2 MEDIUM):** `execute` auf `Exclude<McpForwardDispatch,{kind:'none'}>` verengt (Invariante maschinell); `try/catch` um die Pipeline → **500** statt rejected Promise (hält den `{status,body}`-Vertrag).

**Tests (`mcp-ingress.test.ts`, 12):** Auth-Gate (null/unauth), Happy-Path local+remote, Invalid-Plan/offline/kein-Endpoint → 503, **Reject-on-Mismatch**, 400 missing-server, **mTLS-Pin-Konsistenz** + TOFU, **500-Throw-Abfang**. Daemon-unit-Suite grün, tsc 0. **CO/CG:** n/a (Folge-Slice ADR-028 D4). **CR:** clink **claude** codereviewer — 2 MEDIUM gefixt + Regressionstest. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES, COMPLIANCE, ADR-028-D4-Notiz. **Re-PR-Hinweis:** Original-#197 wurde in den bereits-gemergten #195-Branch gemergt → Code kam nie auf main; dieser Re-PR cherry-pickt `374d6f7` sauber auf einen frischen Branch gegen `origin/main`.

### v0.34.24 (Prep — Christian-autorisiert; Skript-Edit, NICHT ausgeführt; KEIN Deploy/Install) — feat(macos): ADR-029 — Installer auf System-Domain-LaunchDaemon operationalisiert

Zieht ADR-029 (#192 = Template + Render-Kern) deploy-frei nach: der macOS-Installer nutzt jetzt den System-Domain-LaunchDaemon statt LaunchAgent. **Reines Skript-/Code-Edit — `install.sh` wird NICHT ausgeführt; Live-Install/`bootstrap`/Service-User = Christians Gate.**

- **`launchd-plist.ts`**: `buildLaunchDaemonInstallPlan({userHome})` (neu, rein) + `LAUNCHD_SERVICE_LABEL`/`LAUNCHD_SYSTEM_PLIST_PATH` — Pfad (`/Library/LaunchDaemons/…`), `root:wheel`/`644`, `bootstrap`/`bootout system/<label>`, Legacy-Migration als EINE getestete Quelle (fail-closed bei leerem/relativem `userHome`).
- **`scripts/install.sh`** `install_macos_service` + `cleanup_existing` (macOS): rendert `.plist.template` (sed, Werte escaped), **fail-closed**-Guard gegen verbliebene Platzhalter (spiegelt `assertRenderedPlistClean`), schreibt System-Domain mit `root:wheel`/`644`, `bootstrap system`; **Legacy-LaunchAgent**-Migration (unload+rm im Home des Lauf-Nutzers). Läuft als `${SUDO_USER}` (NICHT root).
- **CR-Fixes (clink claude, 3 MEDIUM + 2 LOW alle gefixt):** Username gegen `[A-Za-z0-9._-]` validiert + Home via `dscl` **vor** `eval` (Injection-Schutz); `bootout` in **Label-Form** (kein Drift zum getesteten Plan); `cleanup_existing` nutzt das Home des **Lauf-Nutzers** (nicht `$HOME`=/root unter sudo); sed-Werte `&`/`\`/`/`-escaped; leere `NODE_BIN` → fail-closed.

**Tests (`launchd-plist.test.ts`, +4 → 23):** `buildLaunchDaemonInstallPlan` (System-Domain-Pfad/root:wheel/644/bootstrap+bootout, Legacy-Pfad aus userHome, fail-closed userHome, kein LaunchAgents-Ziel). **`bash -n` clean**, 1130 daemon unit grün, tsc 0. **CO/CG:** n/a (Operationalisierung beschlossenes B6). **CR:** clink **claude** codereviewer — 3 MEDIUM + 2 LOW gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES, COMPLIANCE, ADR-029.

### v0.34.22 (Prep — Christian-autorisiert; reine Spec, KEIN Ingress/Forward/mcporter/Deploy) — feat(discovery): ADR-028 D4-b — MCP-Forward-Spec-Builder (mTLS-Forward + local-exec, deploy-frei)

Zweiter D4-b-Slice nach dem Routing-Planner (v0.34.19/#190): übersetzt einen `McpRoutePlan` in eine **ausführungs-freie** Forward-Spezifikation. **Kein `/api/mcp`-Endpoint, kein echter mTLS-Forward, kein mcporter-Exec, kein Deploy** (Folge-Slices, Christians Gate).

- **`mcp-forward.ts`** (neu, rein): `buildMcpForwardSpec({plan, selfSenderUri, resolvePeer, requireServerIdentity?})` → `local-exec` (eigener Node serviert) | `remote-forward` (Forward an Owner-Peer) | `unavailable` (fail-closed).
- **`remote-forward`** trägt `url = ${peerOrigin}/api/mcp/<server>`, `senderUri` (eigene SPIFFE-Identität für **D3**), `expectedServerSpiffeId = Owner-agent_id` (für **D2**-`checkServerIdentity`-Pin) und `requireServerIdentity` (Spiegel von `TLMCP_SPIFFE_SERVER_IDENTITY`).
- **Fail-closed:** kein Provider, kein/leerer Endpoint, **nicht-HTTPS**-Endpoint (kein Plaintext-Forward), ungültige URL, oder fehlende eigene Sender-Identität → `unavailable` mit Grund. URL aus `URL.origin` (verwirft Path/Query/Userinfo am Endpoint, CR-MEDIUM), Servername `encodeURIComponent`.
- **Rein:** kein Netz/mTLS, kein `child_process`/mcporter, kein I/O — `resolvePeer` (im Daemon `MeshManager.getPeer`→`endpoint`) injiziert.

**Tests (`mcp-forward.test.ts`, 14):** none/local/remote, URL/Sender/Tier/Pin, requireServerIdentity-Flag, trailing-slash, Servername-Encoding, **CR-Regression** (origin verwirft Path/Query + Userinfo), fail-closed (kein/leerer/nicht-HTTPS/ungültiger Endpoint, leerer Sender), local-exec ohne Sender. 1107 daemon unit grün, tsc 0. **CO/CG:** n/a (Folge-Slice eines akzeptierten ADR). **CR:** clink **claude** codereviewer — 0 CRITICAL/HIGH, 1 MEDIUM (URL-origin) gefixt + 2 Regressionstests. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES, COMPLIANCE, ADR-028-D4-Notiz.

### v0.34.21 (Prep — Christian-autorisiert; KEIN Installer-Umbau/Deploy/Install) — feat(macos): ADR-029 LaunchDaemon — Template + getesteter Render-Kern

Bereitet den TODO-Umstieg „macOS-Installer auf LaunchDaemon statt LaunchAgent" (5-Tage-Plan B6) deploy-frei vor: System-Domain-Plist als **Template** + reiner, fail-closed **Renderer/Validator** mit Tests. **Kein Installer-Umbau, kein `launchctl`/`bootstrap`, kein Deploy/Install** — das bleibt Christians Gate.

- **`scripts/service/com.thinklocal.daemon.plist.template`** (neu): System-Domain-LaunchDaemon mit `UserName`/`GroupName` (läuft NICHT als root), `RunAtLoad`, `KeepAlive={SuccessfulExit:false}` (kein mystery-relauncher). Platzhalter `{{NODE_BIN}}/{{REPO}}/{{DATA_DIR}}/{{CONFIG}}/{{RUN_USER}}/{{RUN_GROUP}}` — keine hartkodierten `chris`/`staff`/`/Users/chris`-Literale.
- **`launchd-plist.ts`** (neu, rein): `renderLaunchDaemonPlist`/`validateLaunchDaemonContext`/`assertRenderedPlistClean`/`escapeXml`. Fail-closed: erzwingt absolute Pfade + nicht-leere User/Gruppe, **XML-escaped jeden Wert** (gegen ungültiges Plist + Element-Injection, CR-HIGH), und lehnt jeden im Output verbliebenen `{{…}}`/`__…__`-Platzhalter ab (auch non-uppercase, CR-MEDIUM). `assertRenderedPlistClean` separat exportiert, damit der spätere Installer sein `sed`-Ergebnis gegen denselben Vertrag prüfen kann.
- **`docs/architecture/ADR-029-macos-launchdaemon.md`** (neu): Design + ehrliche Abgrenzung, was bewusst NICHT enthalten ist (Installer-`bootstrap system`, Service-User-Anlage, README-Umstellung, Live-Install/Reboot = Christian/FileVault).

**Tests (`launchd-plist.test.ts`, 19):** Validierung (absolut/leer/whitespace), Render (Platzhalter ersetzt, UserName/GroupName, CONFIG-Default/-Override, Log-Pfade), Fail-closed (ungültiger Kontext, unbekannter Platzhalter), **CR-Regression** (XML-Escaping von `&`, Element-Injection-Abwehr, `{{lowercase}}`-Clean-Check), Template-Regression (keine hartkodierten Literale). 1112 daemon unit grün, tsc 0. **CO/CG:** n/a (beschlossenes Backlog-Item, kein Architektur-Konflikt). **CR:** clink **claude** codereviewer — 1 HIGH (XML-Escaping) + 1 MEDIUM (Platzhalter-Bypass) **gefixt + Regressionstests**. **PC:** `pal:precommit` internal — 0 Issues.
### v0.34.20 (Bug-Fix — Christian-autorisiert; KEIN Deploy/Flag-Flip/Re-Enroll) — fix(tls): ADR-024 Rollout-Gate — die 2 MERGE-blockierenden MEDIUMs (#165) geschlossen

Schließt die beiden vor Re-Enroll zwingend zu klärenden ADR-024-MEDIUMs (CR/PC gpt-5.x aus #165). **Reiner Korrektheits-/Härtungs-Fix, kein neues Verhalten im Normalfall; kein Deploy/Re-Enroll/Flag.**

- **MEDIUM-1 — CA-Gültigkeit fail-closed (`tls.ts` `verifyPeerCert`):** prüft jetzt zusätzlich zum Leaf-Fenster auch das Gültigkeitsfenster der **ausstellenden CA** (`notBefore/notAfter`). `caCert.verify` validiert nur die Signatur, nicht ob die CA selbst (noch) gültig ist → eine abgelaufene/noch-nicht-gültige Issuer-CA wird nun weder im Retention- noch im Flip-/Trust-Distribution-Pfad als Anker akzeptiert. Wirkt downstream durch `isRetainableCanonicalCert` (abgelaufene Attesting-CA → kein Retain → Legacy statt stillem canonical-Verlust auf eine tote CA).
- **MEDIUM-2 — Trust-Distribution-Lifecycle fail-closed (`tls.ts` `selectTrustDistributionCa` neu, rein + `index.ts`-Verdrahtung):** die an gepairte Peers verteilte CA MUSS unser eigenes Serving-Cert verifizieren (CR-HIGH-2). Helper wählt die erste Kandidaten-CA (`[Issuer-CA, eigene CA]`), die das Serving-Cert kryptografisch bestätigt; verifiziert keine → `null`. Im Boot wird die Pairing-Distribution dann **fail-closed NICHT registriert** (statt vorher `caCertPem ?? ''` = leerer Anker) + `log.error`. TLS-deaktiviert-Pfad (Loopback) unverändert.

**Tests (`tls.test.ts`, +9 → 30):** MEDIUM-1 (CA gültig→true; abgelaufene CA→false trotz gültigem Leaf+Signatur; noch-nicht-gültige CA→false); MEDIUM-2 `selectTrustDistributionCa` (Issuer-CA bei behaltenem fremd-Cert; eigene CA im Default; falsche-erst-Kandidat-Skip; **abgelaufene-erst-Kandidat-Skip**; fail-closed bei keiner/fehlendem Serving-Cert/leeren Kandidaten); **Retention-Regression** (abgelaufene Attesting-CA → regeneriert Legacy). 1093 daemon unit grün, 6 integration grün, tsc 0. **CO/CG:** n/a (Bug-Fix). **CR:** clink **claude** (codereviewer) — 0 CRITICAL/HIGH; 1 MEDIUM (Test-Coverage-Lücke der downstream `caValid`-Pfade) → mit 2 Tests geschlossen. **PC:** `pal:precommit` internal — 0 Issues. **getPeerId-Teil von B7** war bereits via #175 (4b55f69) auf main (Tests grün) → kein Code nötig.

### v0.34.19 (DRAFT — Christian-autorisiert; reine Entscheidung, KEIN Endpoint/Forward/mcporter) — feat(discovery): ADR-028 D4-b (Start) — MCP-Routing-Entscheidung (self/remote/none)

Beginnt ADR-028 **D4-b** (MCP-Proxy-Routing) mit dem **reinen Entscheidungskern**, ohne Live-Endpoint/Forward/mcporter-Exec (die folgen als eigene Slices).

- **`mcp-routing.ts`** (neu, rein): `planMcpRoute(server, resolutions, selfAgentId)` → `{ mode: 'local' | 'remote' | 'none' }`. **self bevorzugt** (eigener nicht-offline Provider → lokal); sonst bester Remote-Provider (`healthy` vor `degraded`, deterministischer Tie-Break); kein nutzbarer Provider → `none` (kein Throw).
- **Fail-closed (CR-MEDIUM):** filtert defensiv nur Resolutions mit `skill_id === mcp:<server>` (kanonisiert) → eine fehlverdrahtete Aufrufer-Liste routet NICHT versehentlich auf einen falschen MCP.
- **Trifft nur die Entscheidung, führt NICHTS aus** — der spätere `/api/mcp/<server>`-Ingress ruft `resolveMcp` → `planMcpRoute` → exekutiert (lokaler mcporter ODER mTLS-Forward mit D2-Server-Identity + D3-Sender-Binding).

**Tests:** `mcp-routing.test.ts` (11): local/remote/none, self-Präferenz (auch wenn Peers serven), healthy-vor-degraded, Tie-Break, offline-Skip, **fail-closed bei falschem server** (mis-wired), Case-Insensitivity, Purity (frozen input). 1082 daemon unit grün, tsc 0. **CO:** ADR-028 + D4-Patch (#184). **CR:** `pal:codereview` gpt-5.3-codex — MEDIUM (skill_id-fail-closed) + 2 LOW (Tie-Break-/Purity-Test) gefixt. **PC:** s.u.

### v0.34.18 (DRAFT — Christian-autorisiert; Boot-Verdrahtung, kein Routing/Endpoint/Flag/Deploy) — feat(discovery): ADR-028 D4-a — geteilte MCPs beim Start registrieren (`mcp.share`)

Verdrahtet die Registrierungs-Komposition (v0.34.17) in den Daemon-Start: deklarierte geteilte MCPs werden beim Boot als mesh-Capabilities `mcp:<server>` registriert und sind fleet-weit auflösbar (Discovery default-open). **Kein Routing/Endpoint/Cert/Flag, kein Deploy** (das ist D4-b).

- **`config.ts`**: neue Sektion `mcp.share` (`DaemonConfig` + DEFAULTS `[]`); Typ bewusst `unknown[]` (Validierung in `parseSharedMcpConfig`). **Härtung (CR-MEDIUM):** `deepMerge` schließt jetzt auch Array-**Targets** vom rekursiven Merge aus — ein falsches TOML-Shape (`[mcp.share]` statt `[[mcp.share]]`) wird sauber als Nicht-Array durchgereicht statt still hineingemerged.
- **`index.ts`**: `registerSharedMcps(registry, buildSharedMcpCapabilities(config.mcp.share, selfIdentityUri, now), log)` nach Registry+Builtin-Skills (owner-gegated mit eigener SPIFFE-Identität). **In try/catch:** ein struktureller Config-Fehler loggt + überspringt (Daemon bootet ohne geteilte MCPs) — Shared-MCPs sind optional, kein Grund den Core-Daemon zu stoppen.
- **`config/daemon.toml`**: kommentierte `[[mcp.share]]`-Doku (default-open, `share=false`=opt-out).

**Tests:** `config-mcp-share.test.ts` (3): Default `[]`, `[[mcp.share]]`-Parse, mis-shaped `[mcp.share]`→Nicht-Array (deepMerge-Härtung). 1071 daemon unit grün, tsc 0. **CO:** ADR-028 + D4-Patch (#184). **CR:** `pal:codereview` gpt-5.3-codex — MEDIUM (deepMerge Array-Target) + 2 LOW (Error-Objekt loggen, Negativ-Shape-Test) gefixt. **PC:** s.u.

### v0.34.17 (DRAFT — Christian-autorisiert; Komposition + Registrar, KEINE Boot-Verdrahtung) — feat(discovery): ADR-028 D4-a — Shared-MCP-Registrierungs-Komposition

Komponiert die gemergten D4-a-Bausteine (v0.34.15 Capability-Modell #185 + v0.34.16 Config-Vertrag #186) zu registrierbaren CRDT-`Capability`s + dünnem Registrar. **Kein Routing/Endpoint/Cert/Flag, kein Deploy.** Die Boot-Verdrahtung (Config-Pfad `mcp.share` lesen + Aufruf beim Start) ist der unmittelbare Folge-Slice.

- **`mcp-registration.ts`** (neu): `buildSharedMcpCapabilities(rawShareConfig, agentId, nowIso)` → `{ capabilities, skipped }`; `registerSharedMcps(registry, result, log)` schreibt sie owner-gegated in die Registry (injizierbar).
- **CRDT-Leak verhindert:** `execution_tier` wird vor `register` explizit gestrippt (`registry.register`/`stripNonCrdtFields` ist eine **Blacklist** → würde es sonst ins Automerge-Doc tragen). Test sichert `'execution_tier' in cap === false`.
- **Owner-gegated:** ausschließlich die eigene `agent_id` wird gesetzt; ein in der Raw-Config eingeschleustes `agent_id` wird ignoriert (Regressionstest).
- **Zwei-Stufen-Fehler:** strukturell falsche Config → **fail-fast** (`parseSharedMcpConfig` wirft); einzelner Eintrag mit ungültigem Servernamen → **fail-soft** (skip + log, kein Boot-Abbruch).

**Tests:** `mcp-registration.test.ts` (9): Komposition, default-open opt-out, execution_tier-Strip, fail-fast/fail-soft, Owner-Gating-Override-Ignoranz, Registrar mit Mock-Registry. 1068 daemon unit grün, tsc 0. **CO:** ADR-028 + D4-Patch (#184). **CR:** `pal:codereview` gpt-5.3-codex — 0 funktionale Blocker; MEDIUM (Owner-Gating-Regressionstest) ergänzt. **PC:** s.u.

### v0.34.16 (DRAFT — Christian-autorisiert; reines Modul, kein Wiring/Deploy) — feat(discovery): ADR-028 D4-a Teil 2 — Shared-MCP-Config-Vertrag (default-open)

Zweiter, **unblocked** Code-Slice von ADR-028 D4-a (Teil 1 = v0.34.15/#185 — dieser Slice hängt NICHT davon ab). Reiner Config-Parser, **kein Live-Wiring, kein Endpoint, kein Deploy, kein Flag-Flip**.

- **`mcp-share-config.ts`** (neu, rein): `parseSharedMcpConfig(raw)` → validierte `SharedMcpDeclaration[]`; `enabledSharedMcps(decls)` → die tatsächlich zu announcenden MCPs.
- **Arbeitslinie (ADR-028-D4, auf main via #184):** **Discovery default-open** — fehlendes `share` → `share=true`; **nur explizites `share=false`** opted out (kein Falsy-Coercion); aussagekräftige `description` ist Pflicht; **keine Allowlist/deny-by-default**. Server-Namen-Kanonisierung + Stufen-Ableitung bleiben der Registrierung überlassen (kein Import aus #185).
- **Fail-fast-Validierung** (Boot-Fehler bei Fehlkonfiguration): non-array, non-table, fehlender server/description, `trust_level` außerhalb 0–5, falsche Feldtypen.

**Tests:** `mcp-share-config.test.ts` (13): default-open, opt-out nur via `false`, kein Falsy-Coercion (`share:0/null`→throw), Defaults, alle Fehlformen, `enabledSharedMcps`-Filter. 1042 daemon unit grün, tsc 0. **CO:** ADR-028 + D4-Patch (#184). **CR:** `pal:codereview` gpt-5.3-codex — **0 Findings**; 1 optionaler Härtungstest ergänzt. **PC:** s.u.

### v0.34.15 (DRAFT — Christian-autorisiert; reines Modell, kein Wiring/Deploy) — feat(discovery): ADR-028 D4-a — MCP-Service-Capability-Modell + Auflösung (default-open)

Erster Code-Slice von ADR-028 D4 (zentrale MCP-Service-Registry), **rein + getestet, ohne Live-Wiring/Routing/Endpoints** (D4-a-Teil-2/D4-b folgen).

- **`mcp-service-registry.ts`** (neu, rein): `buildMcpCapability(...)` → CRDT-`Capability` mit `skill_id="mcp:<server>"`, `category="mcp"` (Tools in die `description` gefaltet, da die `Capability` noch kein Tools-Feld hat); `deriveExecutionTier(permissions, trust_level)` → `self|gate|consensus`; `resolveMcp(server, capabilities[])` → Multi-Provider-Auflösung.
- **Arbeitslinie (ADR-028-D4-Patch):** **Discovery default-open** — kein Allowlist-Filter, keine deny-by-default-per-Agent-Logik; Risiko über die **Ausführungsstufe**. Stufen-Ableitung fail-closed (unbekannte Permission → mind. `gate`; destruktiv → `consensus`; niedriges Trust hebt `self→gate`).
- **Designloch geschlossen:** `Capability` braucht `agent_id`+`updated_at` (in der Skizze fehlend) → als Eingaben übergeben (reines Modul, keine Uhr/Identität erfunden); `health` default `healthy` (echte Liveness = ADR-021-Side-Map).
- **Kein Deploy, kein Flag-Flip, kein Routing/Proxy-Wiring.**

**Tests:** `mcp-service-registry.test.ts` (17): Capability-Bau, Tier-Ableitung inkl. fail-closed (unknown→gate, NaN-Trust→gate), Multi-Provider-Auflösung, Offline-Skip, Case-Insensitivity (kein Split-Brain), kein Allowlist-Filter. 1046 daemon unit grün, tsc 0. **CO:** ADR-028-Konsens + D4-Arbeitslinien-Patch (#184). **CR:** `pal:codereview` gpt-5.3-codex — 0 HIGH/CRITICAL; 2 MEDIUM (NaN-Trust fail-open, Servername-Kanonisierung) + LOW gefixt. **PC:** s.u.

### v0.34.14 (DRAFT — Christian-autorisiert; Flag Default-OFF, Produktiv-Aktivierung = Christians Gate) — feat(transport): ADR-028 D2b-pin — per-Host-TOFU-Pin für SPIFFE-Server-Identity

Schließt die in v0.34.13/ADR-028-D2 dokumentierte **nackte-TOFU-Restlücke**: statt bei aktivem Flag jede gültige thinklocal-SPIFFE-SAN zu akzeptieren, wird die beim ersten validierten Kontakt gesehene kanonische Identität **pro Dial-Host gepinnt und danach erzwungen** → spätere Intra-Mesh-Impersonation wird abgelehnt.

- **`server-identity-pin.ts`** (neu): `ServerIdentityPinStore` (Dial-host-gekeyt — korrekt für den Overlay-Fall, wo `MeshPeer.host`=LAN-IP nicht zum 100.x-Dial passt), `singleNormalizedIdFromCert` (kein Auto-Pin bei mehrdeutiger SAN), `makePinningMeshCheckServerIdentity` (First-Contact TOFU+Pin, danach erzwungen; Konflikt re-pinnt NIE auf eine fremde Identität).
- **`mesh-connect.ts`**: `checkServerIdentity` wird injiziert; bei aktivem Flag ohne injizierten Checker → **fail-fast** (kein stiller TOFU-Fallback, CR-MEDIUM). **`index.ts`**: Pin-Store + pinnender Checker werden verdrahtet (nur bei Flag-on).
- **Scope:** schließt D2b's TOFU-Lücke. Flag bleibt **Default OFF**; Produktiv-/Fleet-Aktivierung = Christians Gate. Bewusst deferiert (CR-LOW): Pin-Persistenz über Neustart (in-memory → einmaliges Re-TOFU pro Host nach Restart, CA-Chain bleibt scharf).

**Tests:** `server-identity-pin.test.ts` (pin/match/conflict, per-Host, mehrdeutig→kein-Pin, no-SAN→kein-Pin, **Impersonation-nach-Pin abgelehnt**) + `mesh-connect.test.ts` (Injektion durchgereicht, **fehlender Checker→throws**). 1029 daemon unit grün, tsc 0. **CR:** `pal:codereview` gpt-5.3-codex (security) — 0 HIGH/CRITICAL, MEDIUM (Downgrade-Schutz) gefixt, LOW (Persistenz) deferiert. **PC:** s.u.

### v0.34.13 (DRAFT — Christian-autorisiert; Flag Default-OFF, Produktiv-Aktivierung = Christians Gate) — feat(transport): ADR-028 D2b — SPIFFE-URI-Server-Identity-Verifikation (Overlay-Dial ohne IP-altname)

Adressiert **ADR-028 §L2 / RUNBOOK-55-A Fall C**: Node-Certs SANen ihre SPIFFE-URI + LAN-IP, aber nicht die Tailscale-100.x → Node-Default-TLS scheitert beim Overlay-Dial mit `ERR_TLS_CERT_ALTNAME_INVALID`, obwohl die Identität korrekt CA-signiert ist.

- **`mesh-server-identity.ts`** (neu, rein): `verifyMeshServerIdentity` ersetzt den IP-altname-Check durch SPIFFE-URI-SAN-Validierung (wiederverwendet `spiffeUrisFromSubjectAltName` + `normalizeAgentId`/D1). **Fail-closed**: `rejectUnauthorized:true` bleibt (Chain nie geschwächt — läuft erst danach), exakte Trust-Domain, ALLE SANs geprüft, optionaler per-Host-`expectedSpiffeId`-Pin (aus Registry, NICHT aus dem Cert) muss matchen.
- **`mesh-connect.ts`**: Flag `TLMCP_SPIFFE_SERVER_IDENTITY=1` (Default **OFF** → bisheriges Verhalten) setzt `checkServerIdentity`. `index.ts`: Startup-`warn` bei aktivem Flag im TOFU-Modus (CR-MEDIUM-Guard).
- **Scope:** macht den Overlay-Dial identitäts-validiert möglich. Per-Host-Pin-Resolver = unmittelbarer Folgeschritt **D2b-pin**; bis dahin Flag OFF (TOFU dokumentiert).

**Tests:** `mesh-server-identity.test.ts` (alle Bypass-Modi fail-closed: no-SAN, fremde/lookalike Trust-Domain, malformed, expected-match/mismatch, alle-SANs, ungültige-expected, Resolver-Throw→fail-closed, per-Host-Pin) + `mesh-connect.test.ts` (Flag-Wiring, rejectUnauthorized bleibt true). 1017 daemon unit grün, tsc 0. **CO:** ADR-028-Konsens. **CR:** `pal:codereview` gpt-5.3-codex (security) — 0 HIGH/CRITICAL, kein Auth-Bypass; MEDIUM (TOFU-Guard) + LOW (Resolver-try/catch) gefixt. **PC:** `pal:precommit` — s.u.

### v0.34.12 (DRAFT — Christian-autorisiert, Merge/Deploy = Christians Gate) — feat(identity): ADR-028 D1 — kanonische `node/<PeerID>`-SPIFFE-URI adressierbar

Behebt den in **ADR-028 §L1 / RUNBOOK-55-A Fall B** belegten Root-Blocker: `parseSpiffeUri`/`normalizeAgentId` (`spiffe-uri.ts`) akzeptierten nur die Legacy-Grammatik `host/<id>/agent/<type>` und lehnten die kanonische `node/<PeerID>`-Form (ADR-022 Phase 3) mit „must have 3 or 4 components" ab → **kanonisch-only Nodes (z.B. Orchestrator .94) waren nicht adressierbar** (Inbox-`send`/`execute_remote_skill` brachen).

- **`spiffe-uri.ts`:** neuer `node/<PeerID>`-Parser-Arm (strikt: exakt 2 Pfad-Tokens, `PEERID_REGEX` base58btc `{32,128}`); `ParsedSpiffeUri` ist jetzt eine **diskriminierte Union** `{kind:'node'|'host'}` (kein Identity-Collapse — PeerID landet nie im `agentType`-Slot, CO-Härtung gpt-5.3-codex). `normalizeAgentId` gibt die kanonische Form unverändert zurück; `getAgentInstance`/`hasInstance` narrowen auf `kind`.
- **Legacy-Pfad byte-identisch** (nur `kind:'host'` ergänzt) → kein Verhalten für bestehende Nodes geändert. Additive, fail-closed.
- **Scope-Grenze:** D1 macht die Grammatik *adressierbar*. Die Bindung der kanonischen Identität an den mTLS-Cert-Principal (Anti-Spoofing) ist **D2b/D3** (eigene PRs), nicht D1.

**Tests:** +Coverage in `spiffe-uri.test.ts` (kanonisch parse/normalize/instance/hasInstance, Reject: Extra-Tokens/`node/x/agent/y`, Nicht-base58, Längenband-Boundaries 31/32/128/129), 34 spiffe + 1002 daemon unit grün, tsc 0, eslint 0. **CO:** ADR-028 `pal:consensus` (gpt-5.5 for 9/10 + gpt-5.3-codex against 8/10). **CR:** `pal:codereview` gpt-5.3-codex (security) — 0 HIGH/CRITICAL, optionale Boundary-Tests ergänzt. **PC:** `pal:precommit` gpt-5.3-codex — 0 Blocker.

### v0.34.11 (DRAFT — Christian-autorisiert, Orchestrator --admin-Merge nach Review) — fix: registry-sync dialProtocol PeerId (Capability-Count-Drift)

Behebt den in `docs/DIAGNOSE-capability-count-drift-registry-getPeerId.md` (PR #174) diagnostizierten Bug: die Capability-Registry konvergierte fleet-weit NICHT (Counts 5/18/19/24/24/26 statt identisch).

- **Root-Cause:** `LibP2pRuntime.dialProtocol(peerId: string)` / `hangUpPeer(peerId: string)` übergaben einen **String** an `node.dialProtocol`/`node.hangUp`; libp2p v2 erwartet ein **PeerId-Objekt** → libp2p-intern `multiaddrs[0].getPeerId is not a function` → der Automerge-Registry-Sync-Dial (`/thinklocal/mesh/registry/1.0.0`) scheiterte → CRDT synct nur über bereits bestehende Verbindungen → Count-Drift.
- **Fix:** `peerIdFromString` (aus `@libp2p/peer-id`) via neuen Helper `toPeerId(peerId)` (mit kontextueller Fehlermeldung statt kryptischem TypeError) an beiden String→libp2p-Call-Sites. `autoDialDiscoveredPeer` (nutzt bereits das PeerId-Objekt) unverändert.
- **Reine Korrektheit, kein Feature-Scope.** Kein .55-/Produktiv-Eingriff.

**Tests:** +3 (`libp2p-runtime.test.ts`: dialProtocol/hangUpPeer übergeben ein PeerId-Objekt mit toString-Round-Trip + PeerId-Shape `toCID`; ungültige PeerID → kontextueller Throw). 996 unit + 6 integration grün, tsc clean. **CR:** gpt-5.5 (quick) — 0 HIGH/CRITICAL/MEDIUM, 2 LOW gefixt. **PC:** gpt-5.3-codex (intern) — 0 Blocker.

### v0.34.10 (DRAFT — Christian-autorisiert, --admin-Merge) — emit_canonical_sender Default true (ADR-022 Durable-Fix)

Behebt die **wiederkehrende Legacy-Regression**: der committed-Default `emit_canonical_sender = false` (config.ts DEFAULTS + config/daemon.toml) ließ jeden canonical-Node beim `git pull` auf die **Legacy-Identität `host/<id>`** zurückfallen (TH01 + .55 mehrfach betroffen — das `=true` war nur lokale, nicht-committete Op-Mod).

- **`config.ts`** DEFAULTS + **`config/daemon.toml`** committed: `emit_canonical_sender = true`.
- **SICHER** durch den Fail-safe in `resolveSelfIdentity` (`peer-identity.ts`): kanonisch wird NUR emittiert, wenn `flag && certSanIsCanonical && certIssuerIsAttesting` — ein Node ohne `node/<PeerID>`-Attesting-Cert emittiert **automatisch weiterhin Legacy** (kein Mesh-Bruch, kein 403). Receiver-seitig bindet `authorizeHttpsSender` weiterhin `sender == cert-SAN`.
- **`index.ts`**: Fail-safe-Log WARN→INFO (Legacy-Fallback ist mit Default-true erwartbar, kein Fehlerzustand).
- Opt-out unverändert: `TLMCP_EMIT_CANONICAL_SENDER=0`.

**Tests:** +4 (loadConfig Default true, Env 0/1, **committed-toml-Regression-Guard** dass `config/daemon.toml` selbst `true` trägt). 993 unit + 6 integration grün, tsc clean. **CR:** gpt-5.5 — 0 HIGH/CRITICAL; 1 MEDIUM (committed-toml-Guard) + 3 LOW (Kommentare/Log-Wording) gefixt. **PC:** gpt-5.3-codex (intern).

### v0.34.9 (DRAFT — Orchestrator merged mit `gh --admin` sobald Gates grün) — Static-Peer Online-Self-Healing (ADR-026/025-Follow-up)

Behebt, dass ein **static_peer der transient offline flappt** (dual-homed macOS `.55`) **dauerhaft offline** hängen blieb: der Reconciler war im mDNS-an-Modus **one-shot** (`steadyIntervalMs` nur bei `mdns_enabled=false`), und `MeshManager.checkPeers` schließt offline-Peers vom `/health`-Re-Poll aus → kein Recovery-Pfad, obwohl der Peer wieder erreichbar ist.

- **`static-peer-reconciler.ts`** — neuer reiner Helper `resolveStaticReconcileSteadyMs(count, steadyMs=60_000)`: Steady-Reconcile **IMMER** aktiv sobald static_peers existieren. **Bewusst KEIN `mdns_enabled`-Parameter** → der one-shot-Bug kann nicht erneut an mDNS gekoppelt werden (Regression-Guard).
- **`index.ts`** — Verdrahtung nutzt den Helper statt `mdns_enabled === false ? 60_000 : undefined`. Ein geflappter static_peer wird alle 60 s re-connectet (`connectOnce → addPeer` re-onlined ihn), unabhängig vom Host-Routing.
- **`mesh.ts`** — `addPeer` feuert beim **Offline→Online**-Re-Connect jetzt `onPeerOnline` (CR gpt-5.5 MEDIUM): sonst verpassten Listener (Audit `PEER_JOIN`, Skill/Cap-Re-Eval) das Recovery.

**Wirkung:** `.55` (und jeder static_peer) self-healt nach transienten Blips — stabiles `discover_peers count=6`, **unabhängig** vom (separaten) `.55`-Host-Routing-Fix.
**Tests:** +6 (Reconciler Self-Heal-Flap, Helper mdns-Unabhängigkeit/zero/konfigurierbar, mesh Offline→Online-Event). 989 unit + 6 integration grün, tsc clean. **CR:** gpt-5.5 — 0 HIGH, 1 MEDIUM + 2 LOW gefixt + Regressionstests. **PC:** gpt-5.3-codex (intern).

### v0.34.8 (DRAFT, wartet auf Merge — Orchestrator merged mit `gh --admin` sobald Gates grün) — ADR-026 Symmetrische Auth-Peer-Discovery (403 „Unknown sender"-Fix)

Behebt die **Discovery-Asymmetrie**: `resolvePeerPublicKey` löste den Sender-Signing-Key NUR über
`this.peers` (eigene mDNS/static-Discovery) auf → ein authentifizierter, aber **nicht selbst
entdeckter** Peer (mobil / Cross-Subnet / NAT / `mdns_enabled=false`) bekam **403 „Unknown sender"**
auf `SKILL_ANNOUNCE` und re-tryte endlos. Lean-Fix (Option A, ADR-026): die authentifizierte
mTLS-Inbound-Verbindung **lernt** den Peer.

- **`mesh.ts`** — ephemere, AUTHN-only `authenticatedSeen`-Map (`recordAuthenticatedSeen`): TTL 15 min,
  LRU-Cap 256, `state` konstant `authenticated_unapproved`. `resolvePeerPublicKey` konsultiert sie als
  Fallback **vor** 403 — aber strikt: nur exakte `wantPeerId`, kanonische URI, nicht abgelaufen; bei
  mehrdeutigen verifizierten Treffern (`matches.length > 1`) **fail-closed** (kein seen-Override).
- **`inbound-peer-learner.ts`** (neu, pure/injiziert) — Card-Fetch von der TLS-Source-IP + **Doppel-
  Bindung** `payload-sender == card-SAN == issuer-attestierte PeerID`; IPv6/IPv4-mapped-URL-sicher.
- **`agent-card.ts`** — `onAuthenticatedInbound`-Hook feuert non-blocking auf dem 403-Pfad (nur bei
  issuer-gepinnt attestierter PeerID); der Sender-Retry löst dann auf.
- **AUTHN/AUTHZ-INVARIANTE (CR gpt-5.5 HIGH 1):** `authenticated_unapproved` leakt **NIRGENDS** in
  Autorisierung. Neues Prädikat `mesh.isApprovedPeerSender` (this.peers-only, KEIN seen-Fallback);
  `index.ts` gatet `REGISTRY_SYNC` + `SKILL_ANNOUNCE` auf `senderIsPaired || isApprovedPeerSender` →
  ein nur-gelernter Peer wird AUTHN-aufgelöst, aber **vor jeder CRDT-/Capability-Mutation verworfen**.
  Verhaltensneutral für die bestehende Fleet (== Vor-ADR-026-Akzeptanzmenge).
- **`config.ts`** — `discovery.auto_register_authenticated_peers` (Default `true`,
  `TLMCP_AUTO_REGISTER_AUTH_PEERS=0` → aus). **`audit.ts`** — Event `PEER_OBSERVED`.
- **#164/#166 (Route-Poison-Schutz .55) bleiben unangetastet.** Mit ADR-026 hängt Discoverability
  nicht mehr an mDNS → `mdns_enabled=false` wird first-class.

**Tests:** +24 (mesh authenticatedSeen/isApprovedPeerSender/fail-closed/Isolation, learner-Outcomes
inkl. IPv6/empty-addr, config-Flag). 983 unit + 6 integration grün, tsc clean.
**CR:** gpt-5.5 security — 2 HIGH + 1 MEDIUM + 2 LOW, alle gefixt + Regressionstests. **PC:** gpt-5.3-codex.

### LIVE-DEPLOY 2026-06-10 — Linux-Fleet auf 92e6058 (ADR-024 + ADR-025), canonical-emit fleet-weit

Christian-autorisierter Produktiv-Deploy (Orchestrator .94). #165 (ADR-024) + #166 (ADR-025) sind in
main (HEAD **92e6058**) gemerged. Linux-Fleet per-VM gepullt+gebaut+restartet, own-CA-Nodes re-enrollt:

| Node | Identität | build | Ergebnis |
|------|-----------|-------|----------|
| TH01 (.80) | `node/12D3KooWKZ4z…` | 92e6058 | emitCanonical ✅, 5/5, 0×403 |
| TH02 (.82) | `node/12D3KooWMu7…` | 92e6058 | emitCanonical ✅, 5/5, 0×403 |
| .52 iobroker | `node/12D3KooWFgnD…` | 92e6058 | emitCanonical ✅, 5/5, 0×403 |
| .56 influxdb | `node/12D3KooWFTT1…` | 92e6058 | RE-ENROLL ✅ (ADR-024 hält Cert), emitCanonical ✅, 5/5, 0×403 (InfluxDB unberührt) |
| .222 ai-n8n | `node/12D3KooWJjAmkk…` | 92e6058 | RE-ENROLL ✅, emitCanonical ✅, 5/5, 0×403 |

**.94 (CA-Owner) + .55 (dual-homed macOS)** macht der Orchestrator selbst (macOS, separate Kopierkästen).
Daemon-only-Scope strikt (InfluxDB/ioBroker/n8n unberührt). Re-Enroll-Backups je Node in
`~/.thinklocal/tls/reenroll-backup/`. Hinweis: `build_version`-String steht noch auf 0.34.4
(package.json nicht gebumpt) — `build_number=92e6058` ist der maßgebliche Deploy-Marker.

### v0.34.7 (#166 gemerged 2026-06-10, deployed Linux-Fleet) — ADR-025 Static-Peer-Join + abschaltbares mDNS + Interface-Präferenz (.55)

Macht den Mesh-Join eines dual-homed macOS-Nodes (`.55`, en10-Dock + en0-WiFi) robust. Diagnose:
der Daemon-Start vergiftet macOS-`connectx`-Routing **transient** (~Sekunden); der frühere
**einmalige** static_peer-Connect-Burst (~100ms nach libp2p-Start, kein Retry) traf genau dieses
Fenster → alle Connects `EHOSTUNREACH` → 0 Peers. Drei additive, config-gegatete Fixes (Default unverändert):

- **`discovery.mdns_enabled`** (Default true): bei `false` wird **kein** Bonjour erzeugt
  (`MdnsDiscovery`-Ctor early-return vor `getMeshIp`/Fail-closed; publish/browse/stop no-op) UND
  der zweite mDNS-Stack (`@libp2p/mdns`) abgeschaltet (`resolveLibp2pMdnsEnabled` gated jetzt auf
  `disableMdnsInterfacePin` ODER `mdnsEnabled`) → echtes static-only ohne Poison-Quelle. Env `TLMCP_MDNS_ENABLED=0`.
- **Static-Peer-Reconciler** (`static-peer-reconciler.ts`): ersetzt den Einmal-Burst — versucht
  nicht-verbundene Peers sofort, dann alle 15s für 5min; bei static-only danach langsam weiter (60s,
  re-prüft ALLE Peers → Re-Discovery). Non-blocking, idempotent (`mesh.addPeer` dedupt), stopbar im
  Shutdown. Robust für ALLE Nodes (übersteht transientes Start-Poison + später startende Peers).
- **`discovery.preferred_interfaces`** (geordnete Liste): `orderMeshInterfaces` bevorzugt gelistete
  Interface-Namen (z.B. `["en10","en0"]` → wired vor WiFi) bei mehreren CIDR-Treffern → erlaubt `/16`
  ohne en0-Fehlwahl. Keine Wired/WiFi-Heuristik (deterministisch). Env `TLMCP_PREFERRED_INTERFACES`.
- **CO** `pal:analyze` gpt-5.5 (alle 3 endorsed). **CR** gpt-5.5 (2 Runden): 1 HIGH (libp2p-mDNS-Gating)
  + 3 MEDIUM + 1 LOW gefixt → 0 CRITICAL/HIGH (1 Rest-MEDIUM = harmloser Shutdown-Race, dokumentiert).
  **PC** gpt-5.3-codex: 0 Blocker. **TS:** +20 Tests, 962 unit + 6 integration grün, tsc clean.
- **Rollout NICHT Teil dieses Drafts.** `.55`-Empfehlung: `mdns_enabled=false` + static_peers. Test auf `.55` durch Orchestrator.

### v0.34.6 (#165 gemerged 2026-06-10, deployed .56/.222 + Linux-Fleet) — ADR-024 Canonical-Cert-Retention

Schließt die letzte Lücke des ADR-022-Sender-Flips für **CA-owner** (`.94`) und **own-CA**
Nodes (`.56`/`.222`): `loadOrCreateTlsBundle` verwarf deren frisch re-enrolltes kanonisches
`node/<PeerID>`-Cert beim Boot und regenerierte ein Legacy-Cert → kein Flip. Ursache: der
CA-owner-Zweig reissued bei `certSpiffeUri !== spiffeUri` (Legacy zur Bundle-Zeit), der
own-CA-Pfad verlangt `signedByCurrentCa` gegen die eigene (nicht die .94-)CA.

- **`isRetainableCanonicalCert`** (rein, `tls.ts`): behält ein Cert nur, wenn (a) eine SAN exakt
  die eigene kanonische `node/<PeerID>`-URI ist, (b) KEINE fremde `node/`-SAN vorhanden ist, und
  (c) das Leaf KRYPTOGRAFISCH unter einer gepinnten Attesting-CA-PEM verifiziert (`verifyPeerCert`,
  KEINE Issuer-DN-Ableitung — Confused-Deputy-Schutz, CO gpt-5.5). Zusätzlich `certKeyMatches` +
  Gültigkeit. Additiv; ohne Retention-Opts unverändert.
- **`index.ts`**: libp2pKey + pairingStore vor dem Bundle; **preliminärer** Pin (Disk-CA) nur für
  die Retention, **autoritativer** Pin (post-bundle aus `tlsBundle.caCertPem`) für Flip-Gate +
  Inbound-Authz + Trust-Distribution (kein stale Pin bei First-Boot/CA-Reissue). Flip-Gate prüft
  jetzt „Serving-Cert verifiziert unter gepinnter Attesting-CA" (statt eigenem CA-Fingerprint).
  Pairing publiziert die **ausstellende** CA (`servingCertIssuerCaPem`). Lokale Cert-Ausstellung
  nur aktiv, wenn das Serving-Cert von der EIGENEN CA signiert ist (`.94` behält Ausstellung;
  ein Node mit behaltenem fremd-signierten Cert deaktiviert sie fail-safe).
- **CO** `pal:consensus` gpt-5.5 (8/10; gemini 429-Quota). **CR** gpt-5.5 (3 Runden): alle
  HIGH gefixt (Flip-Gate-CA, Trust-Distribution-CA, Issuance-Topologie) + re-reviewed → 0
  CRITICAL/HIGH. **PC** gpt-5.3-codex: 0 Blocker. **TS:** +12 Tests (`tls.test.ts`), 941 unit +
  6 integration grün, tsc clean.
- **Offen (merge-blocking VOR Deploy):** CA-Gültigkeit im Retention-Verify; Trust-Distribution-
  Lifecycle bei retained fremd-Certs (siehe ADR-024). **Rollout NICHT Teil dieses Drafts.**

### v0.34.5 — mDNS-Interface-Pin abschaltbar (.55 dual-homed-macOS connectx-Fix)

**Befund (2026-06-08, .55 / MacBook, dual-homed: en10=10.10.10.55 Mesh + zweite Default-Route-NIC):**
Die blosse **Anwesenheit** des laufenden Daemons brach macOS-`connectx`-scoped-routing
**prozessweit** — die 10.10.10/24-Route kippte in **REJECT**, und **jeder** ausgehende Connect
(auch ein nacktes `node net.connect`) bekam `EHOSTUNREACH`. Route heilte bei gestopptem Daemon,
brach beim Neustart sofort wieder. Der Daemon ruft **kein** `route`/`IP_BOUND_IF` auf — die
**einzige** Interface-Scoping-Operation im ganzen Daemon ist der mDNS-Socket-Interface-Pin:
`bonjour-service` wird mit `{ interface: meshIp }` konstruiert → `multicast-dns` ruft
`setMulticastInterface(meshIp)` auf dem UDP-Socket auf → das vergiftet auf macOS den
connectx-scoped-routing-Zustand. (#162-Escape-Hatch — Outbound-Pinning — half **nicht**, weil
das Problem im mDNS-Socket sitzt, nicht im Outbound-Connect.)

**Fix:** neues Opt-out-Flag `disable_mdns_interface_pin` (Default **false** → Linux/Standard-Nodes
pinnen exakt wie bisher). Aktiv (`TLMCP_DISABLE_MDNS_INTERFACE_PIN=1` oder
`[discovery] disable_mdns_interface_pin = true`) wird `bonjour-service` **ohne** `interface`-Key
gebaut (nur `bind: '0.0.0.0'` für Multicast-Receive) → **kein** `setMulticastInterface` → Routing
bleibt heil. Outbound-mDNS läuft dann über das Default-IF; Mesh-Konnektivität via `static_peer`.

- **`resolveBonjourOptions(meshIp, disableInterfacePin)`** (discovery.ts, rein/testbar):
  ohne meshIp → `{}`; Pin an → `{ interface, bind:'0.0.0.0' }`; Pin aus → `{ bind:'0.0.0.0' }`.
- **A-Record-Hygiene bleibt aktiv** (`restrictServiceToIp` hängt an `this.meshIp`, nicht am Pin) —
  der Service annonciert weiterhin **nur** die Mesh-IP. Auch der Fail-Closed-Pfad
  (`allowed_mesh_cidrs` gesetzt, kein Match → Ctor wirft) ist unabhängig vom Flag.
- **Empfehlung:** Pin-Disable **immer** mit `allowed_mesh_cidrs` kombinieren — ohne Pin können
  mDNS-Pakete (Hostname + Mesh-IP im A-Record) auf dem Default-IF sichtbar werden; die
  CIDR-Policy + A-Record-Hygiene begrenzen den Restschaden auf Paket-Sichtbarkeit (keine
  routbare Exposition, fremde Peers werden weiter abgewiesen).
- **CR (gpt-5.5, security):** 0 CRITICAL/HIGH. 1 MEDIUM + 2 LOW (alle Test-/Doku-Lücken) gefixt:
  publish()-Pfad-Test (A-Record-Filter unter Pin-Disable), Fail-Closed-unter-Pin-Disable-Test,
  Config-/Env-Plumbing-Regressionstest.
- **Tests:** +12 (discovery.test.ts: resolveBonjourOptions-Pure + Ctor-Wiring + publish()-Pfad +
  Fail-Closed; config-mdns-pin.test.ts: Default/Env). Full Suite 909 grün, tsc clean.

**Nachtrag (Live-Verifikation .55, 2026-06-08): ZWEITE Vergiftungsquelle — libp2p-mDNS.**
Der Operator bestätigte: der Pin-Fix entfernt die **Startup**-Vergiftung (Route geheilt → flag-Daemon
→ connect OK), aber **~27s nach Start** kippte `10.10.10/24` wieder in REJECT. Ursache: `@libp2p/mdns`
(`libp2p-runtime.ts`, `interval: 20_000`) ist eine **zweite, unabhängige multicast-dns-Instanz** (eigener
Socket, 20s-LAN-Query-Loop) — vom bonjour-Pin (oben) gar nicht erfasst. multicast-dns ruft `update()`
beim Bind **und alle 5s** auf (`addMembership` je Interface inkl. Mesh-NIC + `setMulticastInterface`);
diese periodische interface-gescopte Multicast-Aktivität auf dem Mesh-NIC re-vergiftet die connectx-Route.
- **Fix:** der **gleiche Flag** `disable_mdns_interface_pin` lässt jetzt auch den `@libp2p/mdns`-Service
  weg (`resolveLibp2pMdnsEnabled()`, reine testbare Predicate; gleiche `...(cond ? {svc} : {})`-Mechanik
  wie autoNAT/circuitRelay). libp2p startet weiter (identify/ping/transports bleiben) — nur die
  mDNS-Peer-Discovery entfällt. Auf dual-homed macOS ist libp2p ohnehin EHOSTUNREACH; Mesh läuft via
  `static_peer`/HTTPS. Default (Flag aus): libp2p-mDNS bleibt aktiv (Linux/Standard-Nodes unverändert).
- **Tests:** +4 (resolveLibp2pMdnsEnabled, createInitialLibp2pState `mdns:false`, Runtime-Test dass
  `start()` `services.mdns` weglässt + `deps.mdns()` NIE aufruft wenn geflaggt + Positiv-Pfad). 913 grün.
- **Live-Re-Test (beide mDNS-Quellen aus): RE-VERGIFTUNG BLEIBT → dritte, HOST-SEITIGE Quelle bestätigt.**
  Daemon stop → sudo Route-Heal → flag-Daemon → connect OK → ~30s später wieder EHOSTUNREACH. Ursache:
  der laufende Daemon macht ausgehende `connectx`-Dials auf einem Host mit ZWEI Default-Routes
  (en10→10.10.10.1 + en0→10.10.25.1) + IFSCOPE; ein fehlschlagender gescopter Dial lässt macOS einen
  negativen/REJECT-Eintrag auf `10.10.10/24` installieren. **Keine Code-, sondern Host-Routing-Fehlkonfig.**
- **Konsequenz:** dieser Fix **lindert** den .55-Fall (beide mDNS-Beiträge + mDNS-Breakage weg), ist aber
  **kein vollständiger Fix**. Die **durable Lösung ist host-seitig** (en10 als einzige/primäre
  Default-Route bzw. persistenter Route-Heal) und liegt beim Operator — kein weiterer Daemon-Code hilft.

Siehe `docs/architecture/ADR-019-multi-interface-discovery.md` (Abschnitt „.55 connectx-Vergiftung“).
### v0.34.4 — Bug #2: Canonical-Sender-Akzeptanz auf allen v0.34.2-Nachbarn (Host-Bind nach Cert-Attestierung)

Beim Flip eines Nodes (`emit_canonical_sender=true`) akzeptierten **nicht alle** v0.34.2-Nachbarn den neuen `node/<PeerID>`-Sender: .52/.94 ✅, **.56/.222 ❌** („Peer kennt unseren Sender-Key nicht", kein Retry, heilt nicht). Blockierte den fleet-weiten Sender-Flip. (Hinweis: v0.34.3 = #162 Outbound-Debug/Escape, separater offener Branch.)

- **Root-Cause:** `markPeerIdVerified(peerId, senderUri)` band/verifizierte nur, wenn ein Eintrag unter der kanonischen `senderUri` existiert (kanonische mDNS-Entdeckung) ODER genau ein Bestands-Eintrag bereits `libp2p.peerId===peerId` trug. Auf .56/.222 hatte der Legacy-Eintrag des flippenden Nodes die PeerID **nie gelernt** (kein mDNS-TXT/static_peer, stale Card) → kein Treffer → kanonischer Sender unauflösbar → 403.
- **Fix:** Die issuer-gepinnte **Cert-Attestierung beweist die PeerID kryptografisch**; `agent-card.ts` reicht die TLS-authentifizierte Source-IP (`socket.remoteAddress`) durch. `markPeerIdVerified` bindet die attestierte PeerID an den **eindeutigen card-gestützten Host-Eintrag** dieser Source-IP (gleicher ECDSA-Signing-Key über den Flip — Option B). Zusätzlich werden exakte `senderUri`-Treffer mit `peerId===null` jetzt gebunden.
- **CR gpt-5.5 (security):** 2 HIGH + 1 MEDIUM + 2 LOW gefunden, alle gefixt + re-reviewt (0 Residual):
  - **HIGH 1:** Trust-State wurde vor der Envelope-Signaturprüfung mutiert → `markPeerIdVerified` ist jetzt **transaktional** (`{ ok, rollback }`); `agent-card.ts` rollbackt bei „Unknown sender"/ungültiger Signatur (sichert Vorzustand + stellt supersedete Einträge wieder her) → keine persistente Fehlbindung.
  - **HIGH 2:** exakter `senderUri`-Treffer mit `peerId===null` wurde nicht gebunden → jetzt gebunden.
  - **MEDIUM** (Shared-IP-Fehlbindung) durch den HIGH-1-Rollback abgedeckt. **LOW:** stale Kommentar + zentrale Host-Normalisierung (`normHost`: `::ffff:`/Zone-ID).
- **Spoof-Sicherheit:** Bindung erfordert ein issuer-gepinntes attestiertes Cert für PeerID P (nicht fälschbar) UND eine echte mTLS-Verbindung von der passenden Host-IP; nur genau EIN Kandidat; nie Umbinden eines bereits anders verifizierten Eintrags; falscher Key ⇒ Signaturprüfung fail-closed.
- **PC:** clean. **904 Tests grün** (+6 mesh: Host-Bind/IPv6-mapped/no-match/no-rebind/Rollback/peerId-null), 6 Integration grün, tsc clean. Version → **0.34.4**.

**Akzeptanz:** nach Deploy auf alle v0.34.2-Nachbarn muss ein TH01-Flip SKILL_ANNOUNCE 5/5 erfolgreich liefern (auch .56/.222). Live-Gegenprobe durch .94.

### v0.34.3 — Outbound-Connect: Debug-Instrumentierung + Escape-Hatch (dual-homed macOS EHOSTUNREACH)

Phase-3-Restbug: auf dem dual-homed macOS-Node .55 scheitert der ausgehende mTLS-Connect zu Peers konsistent mit `EHOSTUNREACH` (Source 10.10.10.55), obwohl `nc`/`ping` zur selben Peer-IP funktionieren. Neues Modul `mesh-connect.ts` liefert Diagnose + opt-in-Fix; **Default-Verhalten unverändert**.

- **`TLMCP_DEBUG_CONNECT=1`** → loggt pro Outbound-Connect die **exakten Parameter** (host/port/servername/autoSelectFamily) und im Callback **Erfolg** (localAddress/localPort/remoteAddress/family) bzw. den **vollständigen Socket-Fehler** (code/errno/syscall/address/port/localAddress). Macht sichtbar, was der Daemon-Connect anders macht als `nc`.
- **`TLMCP_DISABLE_OUTBOUND_PINNING=1`** (Escape-Hatch) → Connector ohne Source-Bind (kein `localAddress`) + `autoSelectFamily=false` → sauberer Default-Source-Connect wie `nc` ohne `-s`. Reversibel, opt-in.
- **WICHTIG — diese Escape-Hatch fixt .55 NICHT** (per SSH auf .55 verifiziert 2026-06-08): der EHOSTUNREACH ist ein **macOS-Host-Routing-Problem**, kein Daemon-Bug. Plain `node net.connect` (ohne Daemon) reproduziert EHOSTUNREACH zu allen 10.10.10.x; `nc` geht. Auch `localAddress`/`family=4`/`autoSelectFamily=false` helfen NICHT (libuv `connectx` + Dual-Default-Route + IFSCOPE/REJECT-Routen + utun-Tunnel). **Fix ist host-seitig** (Network-Service-Order/zweite Default-Route/Reject-Route auf .55) — Node exponiert `IP_BOUND_IF` nicht. Diese PR liefert dennoch die **Debug-Instrumentierung** (Root-Cause-Beweis) + die generische Escape-Hatch für ANDERE (nicht-.55) Source-Bind-Fälle.
- **Befund (am Code belegt):** der HTTP-Outbound-Dispatcher setzt **selbst KEIN `localAddress`** — das ADR-019-Interface-Pinning betrifft nur den mDNS-Multicast-Socket, nicht diesen Pfad. „Local (…)" im Fehler ist die OS-gewählte Source. Der Default-Pfad (beide Flags aus) ist **byte-äquivalent** zum bisherigen Inline-Connector.
- **CR gpt-5.5 (security):** kein CRITICAL/HIGH/MEDIUM (mTLS unverändert scharf — `rejectUnauthorized:true` in allen Pfaden, keine Key-Leakage im Log). 2× LOW gefixt: Debug-Passthrough jetzt real getestet (Base injizierbar, Fehler/Erfolg genau einmal weitergereicht), `ConnectorOptions` getypt.
- **PC:** clean. **908 Tests grün** (+10 mesh-connect), 6 Integration grün, tsc clean. Version 0.34.2 → **0.34.3**.

Diagnose-Ergebnis (.55, 2026-06-08): EHOSTUNREACH ist host-seitig (macOS Dual-Default-Route + IFSCOPE/REJECT-Routen + utun), nicht durch Daemon-Connect-Optionen behebbar → .55 wird host-seitig gefixt (Christian). Die Debug-Flags bleiben als generisches Diagnose-/Escape-Werkzeug im Code.

### v0.34.2 — Attesting-CA-Pin Auto-Derive (Fleet-Voraussetzung, kein Hardcode)

Fleet-Voraussetzung für den Produktiv-Flip: jeder Node bekommt den `TLMCP_PEERID_ATTESTING_CA_FP`-Pin automatisch, sonst fail-safe-blockt der Flip (`cert_issuer_not_attesting`, live auf TH02 beobachtet). Statt den Fingerprint pro Node hart zu verdrahten, wird er **aus der eigenen Mesh-CA abgeleitet**.

- **`resolveAttestingCaFingerprints(env, caCertPem)`** (cert-issuer.ts, rein/testbar): Env gesetzt → explizit (gewinnt); `none` → deaktiviert (Staged-Rollout-Escape, fail-closed); **Env ungesetzt → aus der eigenen `ca.crt.pem` abgeleitet** (`certFingerprint`), **NUR wenn diese genau EIN Zertifikat enthält** (Bundle/defekt/leer → fail-closed). Leitet **nie** aus dem gemergten Trust-Bundle / gepairten CAs ab → Malicious-Paired-CA-Schutz (WS-2) bleibt zu. Quelle wird laut geloggt.
- **CO:** `pal:consensus` (gpt-5.5 adversarial; gemini billing-capped) → auto-derive + env-override + Guards, unter der Singleton-Mesh-CA-Invariante (direkte Issuance, kein Intermediate — im Code verifiziert: `cert.sign(caKey)`). Net: kanonische Attestierung wechselt von opt-in (leer/inert) zu **automatisch aktiv für die EIGENE Mesh-CA** — supersediert das manuelle Verdrahten der Env in Unit/Installer (Zero-Config).
- **CR gpt-5.5 (security):** kein HIGH/CRITICAL. MEDIUM (defektes Single-Cert-PEM → Boot-Crash) **gefixt** (try/catch → fail-closed + Test). LOW (Env-Pin-Format-Warnung, stale Kommentar) **gefixt**. Offene MEDIUM als Follow-up dokumentiert: (a) token-onboarded TLS-Bundle ohne Validierung laden (pre-existing, tls.ts); (b) Integrationstest, dass `peerCert.issuerCertificate.fingerprint256 === certFingerprint(ca.crt.pem)` unter echtem mTLS (live bereits via TH01↔TH02-Flip bewiesen).
- **PC:** clean. **898 Tests grün** (+6 Resolver: env/derived/none/bundle-guard/null/broken-PEM), 6 Integration grün, tsc clean. Version 0.34.1 → **0.34.2**.

**Live verifiziert (2026-06-06):** TH01-Hub + TH02 auf v0.34.1; TH02-Flip gegen den v0.34.1-Nachbarn TH01 **grün** (Announces 200, TH02 kanonisch, Härtung greift). Produktiv-Flotten-Flip (.56/.52/.222) bleibt bis Christians Wort gestoppt.

### v0.34.1 — Phase-3-Härtung (TH02-Live-Flip-Test-Befunde) — Pflicht vor Produktiv-Flip

Der TH02-Live-Flip (2026-06-06) deckte echte Härtungs-Punkte auf — genau dafür wurde TH02 zuerst getestet. Fixes flag-unabhängig (Default OFF unverändert), reversibel:

- **Card-Re-Fetch / Identity-Supersession (TH02-Deadlock-Root-Cause):** Flippt ein verbundener Node `host/<id>` → `node/<PeerID>`, blieb beim Nachbarn der alte Legacy-Eintrag mit derselben (mDNS-)PeerID stehen → `markPeerIdVerified` sah **zwei** Treffer → Ambiguität → kanonischer Sender nicht auflösbar → **403-Deadlock**. **Fix:** `markPeerIdVerified(peerId, senderUri)` ist jetzt sender-gekeyt — markiert den exakt cert-attestierten Eintrag eindeutig und supersedet (nur bei kanonischem attestiertem Sender = echter Flip) alte PeerID-Duplikate; Discovery-Lag-Fallback markiert den eindeutigen Legacy-Eintrag, falls der kanonische noch nicht entdeckt ist.
- **CR gpt-5.5 (security) — HIGH + MEDIUM + LOW, alle gefixt + re-reviewt (0 Residual):**
  - **HIGH:** Die Supersession lag zuerst im **mDNS-getriebenen `addPeer`** → LAN-Angreifer hätte mit selbstkonsistenter `node/<victimPeerId>`-Ankündigung einen legitimen Peer evicten können (DoS). **Fix:** `addPeer` entfernt nichts mehr (nur Warn-Log); destruktive Supersession strikt an **issuer-gepinnte Cert-Attestierung** gebunden (`onPeerCertVerified(peerId, senderUri)`), nie an rohes mDNS.
  - **MEDIUM:** Sticky Endpoint bei Re-Announcement (mDNS-Preemption). **Fix:** `confirmPeerDiscovery()` aktualisiert host/port/endpoint **erst nach** dem Card-Identitäts-Check.
  - **LOW:** Kanonische `node/<PeerID>`-Pairings wurden als „Legacy" gewarnt → `isCanonicalNodeUri` aus dem Warn-Filter ausgenommen.
- **#159-HIGH (Issuer-Pin-Symmetrie):** `resolveSelfIdentity` flippt nur, wenn der **eigene Cert-Issuer** in `TLMCP_PEERID_ATTESTING_CA_FP` gepinnt ist (Symmetrie zur Empfangsseite). Neuer `blockedReason 'cert_issuer_not_attesting'`.
- **#159-MEDIUM (Guard-Reihenfolge):** `skillHealthMonitor`/`registrySync.coordinator` starten erst **nach** dem fail-closed Runtime-vs-Key-PeerID-Guard.
- **CR-MEDIUM-2 (Pairing URI→pubkey):** `PairingStore.isPairedByPublicKey()` erkennt einen gepairten Peer über seinen stabilen, signatur-verifizierten Public-Key-Fingerprint — ein geflippter Peer (neue URI, gleicher Key) bleibt gepairt (vorher fail-closed abgelehnt).

**TS:** 892 Tests grün (+8), 6 Integration grün, tsc clean. **CR:** gpt-5.5 (HIGH+MEDIUM+LOW gefixt, 0 Residual). **PC:** clean. Version 0.34.0 → **0.34.1**.

**Produktiv-Flip bleibt gestoppt**, bis diese Härtung gemergt UND auf TH02 live re-verifiziert ist (sauberer Flip ohne 403).

### v0.34.0 — Per-Node-Sender-Flip: kanonische node/<PeerID>-Identität (ADR-022 Schritt 3, Phase 3)

Schließt den ADR-022-Identitäts-Cutover code-seitig ab: der Daemon kann seine kanonische `spiffe://thinklocal/node/<PeerID>`-Identität als `envelope.sender` / agent_id / Skill-Author / Audit-Identität / Inbox-Adresse emittieren — statt Legacy `host/<stableNodeId>/agent/<type>`. **Flag-gegatet, default OFF, per Flag reversibel.** Die Empfangsseite (WS-1/2/3) akzeptiert beide Formen bereits.

- **Neues Flag `daemon.emit_canonical_sender`** (env `TLMCP_EMIT_CANONICAL_SENDER=1`), default `false`. Default-Pfad ist verhaltens-identisch (`selfIdentityUri === identity.spiffeUri`).
- **Option B (ADR-022 §3):** der **ECDSA-Agent-Signing-Key bleibt** — nur die Self-Identitäts-URI flippt. Peers lösen den Key über die verifizierte, PeerID-gekeyte Agent-Card auf (`resolvePeerPublicKey`).
- **Sicherheits-Interlock „Cert-SAN VOR Sender-URI":** der Flip greift NUR, wenn (1) Flag gesetzt, (2) libp2p aktiv → stabile PeerID, UND (3) das laufende mTLS-Cert die **EIGENE** `node/<PeerID>`-SAN trägt. Fail-safe → Legacy + laute Warnung sonst. Reine Helfer-Funktion `resolveSelfIdentity()` (testbar).
- **CR gpt-5.5 (security):** 3 HIGH + 2 MEDIUM gefunden, alle gefixt + re-reviewt (0 Residual):
  - **HIGH 1:** Agent-Card gab Legacy-`spiffeUri` aus, während mDNS kanonisch annoncierte → Card verworfen → 403. Card gibt jetzt `selfIdentityUri` aus.
  - **HIGH 2:** Interlock prüfte nur „SAN ist kanonisch", nicht „ist UNSERE kanonische URI" → `node/<andere-PeerID>`-Cert hätte geflippt → 403. Jetzt exakte Mitgliedschaft `certSans.includes(canonicalSelfUri)` (faltet zugleich Dual-SAN-Cert-Handling, ex-LOW 1). +Regression-Test.
  - **HIGH 3:** Flip wurde gegen die persistierte Key-PeerID entschieden, bevor die Runtime startete → fail-closed Guard nach `start()` (Runtime-PeerID ≠ Key-PeerID + aktiver Flip → harter Abbruch).
  - **MEDIUM 1:** `/api/status.agent_id` + REGISTRY_REPUBLISH-Audit blieben Legacy → jetzt `selfIdentityUri`.
  - **MEDIUM 2 (dokumentiert, fail-closed):** Pairing-Store ist URI-gekeyt; nach einem Flip werden gepairte Peers über die alte URI nicht erkannt → SECRET_REQUEST/AGENT_MESSAGE werden **fail-closed abgelehnt** (kein Spoof). Tritt nur beim operator-gesteuerten Live-Flip auf. Follow-up: pubkey-/fingerprint-basiertes Pairing bzw. Legacy↔Canonical-Alias (TODO).
  - **LOW 2 (kein Code):** stale Legacy-Self-Caps — Registry wird pro Boot frisch konstruiert (kein `load()` von Disk) + Flank-2-Owner-Gate verhindert fremde Injektion eigener Caps → keine lokalen stale Caps; transientes Peer-seitiges Artefakt im Accept-both-Fenster, altert via `markAgentOffline` aus.
- **PC:** clean. **884 Tests grün** (+7 resolveSelfIdentity inkl. Interlock/Dual-SAN/other-PeerID/libp2p-aus), 6 Integration grün, tsc clean. Version 0.33.0 → **0.34.0**.

**Live-Flip bleibt ein separater, kontrollierter Ops-Schritt** (Flag scharf + Noise-Re-Handshake + Mesh-Gegenprobe), NICHT Teil dieser PR. `TLMCP_STRICT_IDENTITY=1` (Legacy-Pfad entfernen) erst danach.

### v0.33.0 — Owner-wins für availability: direct-only (ADR-020 v2.2) [Architektur-Flanke 2]

`pal:consensus` (3 Modelle, einstimmig) → **HYBRID**: JETZT direct-only, signierte Provenance als Phase-2. Schließt die latente Korrektheitslücke „relay-witness-wins" — ein Peer kann nicht mehr die `availability` eines Dritten setzen.

**Topologie-Befund (ausschlaggebend):** Die Registry repliziert via Automerge Anti-Entropy **transitiv** (store-and-forward) → `availability` würde über Dritt-Nodes relayed (origin != last hop), mTLS bürgt nur für den last hop. Naive „writer==owner"-Gate würde legitime Relays verwerfen.

- **`availability` raus aus dem Automerge-CRDT** → eigene **nicht-replizierte, owner-gegatete Side-Map** (`registry.ts`: `availability`-Map, `setAvailability`/`getAvailability`). Reist nie transitiv mit.
- **Owner-Gate im Merge:** `importPeerCapabilities(caps, writer)` — `writer` = authentifizierter Direkt-Peer (`envelope.sender`), NICHT aus dem Payload. `cap.agent_id !== writer` → **HARD reject** + Metrik `rejected_foreign_availability_write` (`getRejectedForeignWrites()`).
- **Propagation:** über den owner-gegateten direkten GossipSync-Pfad (trägt jetzt availability im Payload); Existenz/Metadaten gossippen weiter via Automerge (Discovery, unkritisch). Routing-Filter liest aus der Side-Map.
- **Guardrail-Test (Pflicht):** beweist, dass relayte availability (writer != owner) beim Merge verworfen wird → „direct-only ist Absicht, kein Bug".
- **Phase-2 reserviert (additiv, kein Krypto jetzt):** optionales `provenance`-Feld im RegistrySync-Payload (`messages.ts`) für spätere signierte Per-Key-Origin-Provenance — kein Schema-Retrofit nötig. Verworfen: Relay-Ingress-Attestation („relay-witness-wins").
- **CR gpt-5.5 (security):** 3 HIGH + 3 MEDIUM gefunden, alle gefixt + re-reviewt (0 Residual):
  - **HIGH 2** — Hash-Short-Circuit übersprang availability-only-Updates (availability ist nicht im Metadaten-Hash) → `handleSyncMessage` importiert jetzt **vor** dem Hash-Vergleich; der Hash steuert nur noch die Metadaten-Rückantwort. (+Regression-Test)
  - **HIGH 3** — roher Automerge-Merge konnte availability in das replizierte Doc tragen → `normalizeCrdtSchema()` strippt availability/provenance nach `receiveSyncMessage` **und** in `load()` (Migration alter Nodes).
  - **MEDIUM 1/3/4** — `register()` strippt Nicht-CRDT-Felder vor dem Doc-Write; `unregister()` räumt die Side-Map; `importPeerCapabilities` akzeptiert nur `'healthy'|'unhealthy'` + `consecutive_failures` finite≥0. (+2 Regression-Tests)
  - **HIGH 1 (Disposition, gemeldet)** — `envelope.sender` ist **nicht** an den literalen mTLS-Direkt-Hop gebunden. Bewusst NICHT der vorgeschlagene Cert-SAN-Bind angewandt: während der Legacy-Migration ist Cert-SAN (`host/<hostname>` bzw. `node/<PeerID>` für rejoined Nodes) ≠ `envelope.sender` (`host/<stableNodeId>`) → ein striktes Binding würde **alle** REGISTRY_SYNC ablehnen und das Live-Mesh brechen. Begründung: `envelope.sender` ist **signatur-authentifiziert** (Envelope mit Sender-Key signiert, in `agent-card.ts` gegen den aufgelösten Sender-Key geprüft) ⇒ `sender == Signer == Owner`. Das Owner-Gate (`cap.agent_id===sender`) erzwingt damit, dass nur die **eigenen signierten** Caps/availability des Owners akzeptiert werden — ein Relay liefert nur owner-signierte, manipulationssichere Daten (60s-TTL + replayGuard). Owner-wins **hält** via Signatur-Auth (effektiv leichtgewichtige signierte Provenance). Echtes Direkt-Hop-Binding wird erst **post-Phase-3** möglich (wenn `sender == cert-SAN`).
- **PC:** clean. **877 Tests grün** (+3: HIGH-2-Import-trotz-gleichem-Hash, MEDIUM-3-unregister-clear, MEDIUM-4-Wert-Validierung; +1 Guardrail), tsc clean. ADR-020 v2.2 → implementiert. Version 0.32.1 → **0.33.0**.

Voraussetzung (Konsens): Heim-LAN voll-vermascht → jeder Node lernt jede Peer-availability direkt. Bei bewusst sparse Mesh wäre direct-only ungeeignet (dann Phase-2 direkt) — für Heim-LAN unzutreffend.

---

### v0.32.1 — Auth-Modell: mTLS-only (toter JWT-Hook entfernt) [Architektur-Flanke 1]

`pal:consensus` (3 Modelle, einstimmig) → **Option A „mTLS-only"**. Die Zugangsgrenze des LAN-Mesh ist mTLS + Mesh-CA + .94-Issuer-Pin; ein JWT-`onRequest`-Hook existierte als **toter, nie verdrahteter Code** (`api-auth.ts`/`registerApiAuth` — keine Aufrufstelle) und täuschte in der Doku eine nicht vorhandene Kontrolle vor.

- **Entfernt:** `packages/daemon/src/api-auth.ts` (vollständig tot — kein Import, kein Test, kein Client erwartet `/api/auth/token`).
- **Doku korrigiert auf Realität:** SECURITY.md (neuer Auth-Modell-Absatz + korrigierte Limitierungs-Zeile) + THREAT-MODEL.md (JWT-Zeile → mTLS-only). `localhost` (CLI/MCP) ist bewusst exempt.
- **Roadmap:** Bei Internet-Exposure JWT/Session-Auth **vorher** aktivieren (`@fastify/jwt` bleibt als Dependency verfügbar).
- CR gpt-5.5: 0 Findings. PC clean. **873 Tests grün** (kein Test betroffen — der Code war tot), tsc clean. Version 0.32.0 → **0.32.1**.

---

### v0.32.0 — Build-/Versions-Stempel im Mesh sichtbar

Beim 5-Node-Rollout war nicht erkennbar, welcher Node welchen Build fährt (das agent_card meldete hartkodiert `version:'0.2.0'`). Jetzt trägt jeder Daemon einen echten Build-Stempel ins Mesh.

- **`build-info.ts`** (neu): `loadBuildInfo()` → `build_version` (VERSION-Datei → `package.json`), `build_number` (BUILD-Datei → `git rev-parse --short HEAD`), `build_date` (`git log -1 --format=%cI`), `build_node` (hostname). Fallbacks (`unknown`/`null`), nie crashend; git-Quellen + Pfad intern (keine externe Eingabe → keine Injection-Fläche). Reine Funktion, injizierbare Quellen → unit-getestet.
- **`agent_card.build`** + **`/api/status`** (`build_version`/`number`/`node`/`date`) + **`/api/peers`** (Peer-`build`) → die MCP-Tools `mesh_status`/`discover_peers` zeigen es automatisch. Ersetzt das stale `version:'0.2.0'`.
- **CR gpt-5.5:** 0 Findings. **PC:** clean. **873 Tests grün** (+4), tsc + lint clean. Version 0.31.1 → **0.32.0** (= ab jetzt der gemeldete `build_version`). Voraussetzung für den Auto-Update-Mechanismus ist damit erfüllt.

---

## [Unreleased] — 2026-06-04

### v0.31.1 — Boot-Race-Schutz im Installer (Skill-Service-Deps generisch)

Spiegelt den manuell auf dem influxdb-Host (.56) angewandten Boot-Race-Fix (`After=influxdb.service`/`Wants=influxdb.service`) generisch in den Installer — ein frischer Install hat denselben Schutz, ohne influxdb-Hartkodierung.

- **`service-dependencies.ts`** (neu): `collectSkillServiceDeps()` (Vereinigung der `requirements.services` über Skill-Manifests), `BUILTIN_SKILL_SERVICE_DEPS` (= `['influxdb']`, aus den Manifests abgeleitet), `serviceUnitDependencyLines(services, exists)` → `After=/Wants=`-Zeilen **nur** für Services, deren systemd-Unit auf dem Host existiert (kein hängendes `Wants=` auf Nicht-influxdb-Hosts).
- **`thinklocal.ts`** (CLI-Bootstrap, der Pfad der die Mesh-`--user`-Units erzeugte): `systemdUnitExists()` (Injection-Regex-geschützt) + Einbau der Dep-Zeilen in die generierte Unit.
- **`install.sh`**: generischer Shell-Loop + Presence-Check (kanonische Quelle: `service-dependencies.ts`).
- **`build-deb.sh`** bewusst ausgenommen (Build-Zeit — Host-Presence-Check gehört nicht dorthin).
- **CR gpt-5.5:** 0 Findings. **PC:** clean. **869 Tests grün** (+7), tsc clean, `bash -n` ok. Version 0.31.0 → **0.31.1**.

---

### v0.31.0 — ADR-021 Generisches Skill-Health-Monitoring

Behebt den Boot-Race von 2026-05-17 generisch: Skills mit externer Abhängigkeit werden periodisch re-evaluiert, statt nur einmal beim Daemon-Start.

- **`skill-health-monitor.ts`** (neu): zentraler `SkillHealthMonitor`. Skills liefern nur ihre `healthcheck.fn(signal)`; der Monitor schedult (linear 30s healthy / 60s unhealthy, Jitter ±20%), debounced per Hysterese (2 Erfolge → healthy, 3 Fehlschläge → unhealthy, binäre State-Machine, kein DEGRADED), single-flight, kooperatives AbortController-Timeout, `stop()` cancelt alles.
- **Registry (`registry.ts`)**: Capability bekommt `availability`/`last_checked_at`/`consecutive_failures` (ADR-021 §4: Attribut statt Remove). `setAvailability()` schreibt **nur die eigene** Capability (Owner-only) und nur bei echtem Flip (minimaler Hash-Churn; `availability` ist im Capability-Hash). **Routing-Lookups (`findBySkill`/`findByCategory`) filtern `availability==='unhealthy'`** — ausgefallene Skills werden nicht mehr geroutet (back-compat: fehlendes Feld = verfügbar).
- **`index.ts`**: InfluxDB-Skill wird jetzt IMMER registriert (initial-availability aus Boot-Check); Monitor verdrahtet (`influxdb`-Check) — bei Flip: `setAvailability` + Audit `SKILL_HEALTH_TRANSITION` + Registry-Republish; graceful stop im Shutdown.
- **`/api/status`**: neuer `skills`-Block (State, last/next_check, consecutive_failures, last_error pro Skill).
- **CR gpt-5.5:** 1 HIGH (Routing ignorierte availability) + 2 MEDIUM (Shutdown-Race, Hash ohne availability) + 2 LOW (idempotenz, stale re-register) — alle gefixt + Regressionstests; Re-Review bestätigt HIGH geschlossen. PC clean. **862 Tests grün** (+11), tsc clean. ADR-021 → Accepted. Version 0.30.3 → **0.31.0**.

Voraussetzung-Hinweis (ADR-021 §8): Owner-wins im CRDT-Layer (ADR-020 v2.2) ist am Write-Site (`setAvailability` nur eigener Key) adressiert, im CRDT-Layer aber noch nicht erzwungen — offene Flanke, ADR-acknowledged.

---

### v0.30.3 — Registry-Republish-Endpoint: Test-Abdeckung + Live-Verifikation

`POST /api/registry/republish` (ADR-020 v1 Safety-Valve, manueller Force-Push des Registry-Resyncs) existierte bereits (`dashboard-api.ts`, wired via `registrySyncRepublish`), war aber **untestet**. Verify-First: live bestätigt (authentifiziert → `{status:ok}` + Audit-Event `REGISTRY_REPUBLISH`, `audit_events` 36→37). Neuer Regressionstest `dashboard-api.test.ts` (Fastify-`inject`, 4 Fälle: ok / 503 unwired / 500 throws / 429 rate-limited). AuthZ = mTLS-Handshake (Mesh-Member) auf dem Hauptserver; LAN-only. **851 Tests grün** (+4), tsc+eslint clean. Version 0.30.2 → **0.30.3**.

Side-note (pre-existing, out of scope): `registerApiAuth` (JWT-Hook) hat aktuell keine Aufrufstelle → `/api/*` ist nur per mTLS-Handshake gated (Mesh-Authz erfüllt; JWT-Schicht inaktiv). Nicht angefasst — separater Befund.

---

### Verify-First — „CRDT-Registry repliziert nicht" (17.05.) ist behoben ✅ (kein Code)

Verifikation des 🔴-TODO von 2026-05-17 gegen das **heutige** Mesh: **nicht mehr reproduzierbar.** Behoben durch ADR-020 v1 (#139, 18.05.) — der Placeholder-Stream-Handler, der `/thinklocal/mesh/registry/1.0.0` sofort schloss, war der dortige „Smoking-Gun"-Fix. Live-Belege: TH01s `/api/capabilities` = **16 Caps aus 6 Nodes** gemerged; TH01 + .94 konsistent `registry_sync conv=5/5` (Automerge kein-Diff = in Sync); je 8 libp2p-Verbindungen; periodischer 45s-Resync-Coordinator + `republish()` vorhanden (= der vom TODO geforderte Fix). Kein Code-Fix nötig — TODO als erledigt markiert. (Optionaler Follow-up: expliziter HTTP-`/api/registry/republish`-Endpoint; intern bereits verdrahtet.)

---

### Fix v0.30.2 — `thinklocal restart` verlor Runtime-Flags

`thinklocal restart --lan` (bzw. `--local`) verlor die Flags: `cmdRestart()` nahm keine Argumente und rief `cmdStart()` ohne Flags, und der Main-Dispatch reichte `args.slice(1)` nicht weiter → der Daemon startete nach dem Restart im Default-Modus statt im gewünschten (relevant im Vordergrund-/Dev-Pfad; der systemd-Pfad nutzt ohnehin die Unit-Env).

- **`runtime-mode.ts`** (daemon): neue reine, exportierte `runtimeModeFromFlags(flags, fallback)` (`--local`→local, `--lan`→lan, sonst fallback) als single source — von der CLI genutzt, im daemon-Suite **CI-getestet**.
- **`thinklocal.ts`**: `cmdRestart(flags)` reicht Flags an `cmdStart` durch; Main: `case 'restart': return cmdRestart(args.slice(1))` (wie alle anderen flag-nehmenden Befehle); `resolveCliRuntimeMode` delegiert an den Helfer (Verhalten identisch, `--local` schlägt `--lan`); Hilfe/Header zeigen `restart … [--local|--lan]`.
- **CR gpt-5.5:** 0 Findings. **PC:** clean. **847 Tests grün** (+5 inkl. Regression „leere Flags → fallback statt lan"), tsc+eslint clean. Version 0.30.1 → **0.30.2**.

---

### Fix v0.30.1 — Token-Onboarding Port-Mismatch (`thinklocal join`)

Der dokumentierte Join-Weg war kaputt: `thinklocal join` schickte den **certlosen** `POST /onboarding/join` an die `--admin-url` (mTLS-Haupt-Port 9440, `requestCert+rejectUnauthorized`) — der certlose Onboarding-Server lauscht aber auf **Haupt-Port + 1 (9441)**. Ein neuer Node ohne Cert scheiterte am TLS-Handshake.

- **`packages/daemon/src/onboarding-port.ts`** (neu, **single source of truth**): `ONBOARDING_PORT_OFFSET`, `onboardingPort(mainPort)`, `onboardingUrlFromAdminUrl(adminUrl)` (URL-robust: nur http/https, `URL.origin`-Serialisierung (IPv6-sicher), Portbereich-Check, strippt Userinfo/Pfad/Query/Hash).
- **`index.ts`**: Onboarding-Listen-Port nutzt jetzt `onboardingPort(config.daemon.port)` statt hartem `+1`.
- **`thinklocal.ts` (CLI `join`)**: leitet die certlose Join-Origin via Helfer ab (Port+1) und postet dorthin; `--admin-url` bleibt die mTLS-Haupt-URL (9440). Variante A → kein Doppel-Bump, dokumentierter `:9440`-Weg funktioniert wieder.
- **Live-verifiziert:** `join --admin-url https://10.10.10.94:9440` erreicht jetzt den Onboarding-Server auf `:9441` (App-403 „Token rejected", kein TLS-/Verbindungsfehler).
- CR gpt-5.5: kein HIGH/CRITICAL; 1 MEDIUM (prozessweites `NODE_TLS_REJECT_UNAUTHORIZED=0` im CLI-Join — **vorbestehend**, sauberer Fix bräuchte undici-Dep in der CLI → als Follow-up in TODO.md, da Task abhängigkeitsfrei) + 2 LOW (Helfer-Härtung + Edge-Tests) gefixt. PC clean. **842 Tests grün** (+11), tsc+eslint clean. Version 0.30.0 → **0.30.1**.

---

### ADR-022 Schritt 3 — LIVE VERIFIZIERT (TH01-Rejoin grün, 403 weg) ✅

WS-1 + WS-2 + WS-3 + Loopback-Fix sind im **Live-Mesh** end-to-end verifiziert:

- **TH01 (10.10.10.80)** hat per `requestNodeCert` (PoP über seinen libp2p-Ed25519-Key) von der Admin-CA **.94 (10.10.10.94)** ein Cert mit SAN `spiffe://thinklocal/node/12D3KooWKZ4…Ynb` erhalten und serviert es (SAN inkl. Eigen-Loopback `localhost`/`127.0.0.1`/`::1`).
- **.94-Gegenprobe grün:** **kein** SKILL_ANNOUNCE-403 / „Unknown sender" mehr auf dem .94↔TH01-Link; .94 importiert TH01s Announces (Gossip), `/api/peers` zeigt TH01 `status=online`. Die kanonische `node/<PeerID>`-Attestierung läuft über das CA-validierte Cert-SAN (Empfänger-Pin `TLMCP_PEERID_ATTESTING_CA_FP` = .94-CA-Fingerprint) — genau der Grund, warum der 403 verschwindet.
- **MCP-Proxy geheilt:** lokaler mTLS-Fetch `https://localhost:9440/health` → HTTP 200 (Hostname-Verify gegen das wieder vorhandene localhost-SAN).
- **Daemon:** active/running, 0 Restarts, Port 9440.
- **Stand:** authz/`envelope.sender` weiterhin Legacy `host/cf00a5…` (Phase-3-Sender-Flip bewusst noch NICHT). Die 3 Alt-Code-Nodes (68f7cd8e/b4768fe0/e7aeb01312) ohne Accept-both ignorieren TH01 erwartungsgemäß.

Damit ist der ursprüngliche SKILL_ANNOUNCE-403 auf dem Admin-Link **konstruktiv behoben** (über die PeerID-gewurzelte Identität statt Legacy-Resolution).

---

### ADR-022 WS-3 Fix — Eigen-Loopback im ausgestellten Cert (Live-Test-Befund)

Beim TH01-Rejoin-Live-Test fiel auf: das WS-3-HIGH-Fix hatte mit dem Admin-Hostnamen versehentlich **auch `localhost`** aus dem ausgestellten `node/<PeerID>`-Cert entfernt. Der lokale mTLS-MCP-Proxy (`mcp-stdio` → `https://localhost:9440`, `rejectUnauthorized`) braucht aber ein `localhost`-SAN. `signNodeCertFromCsr` fügt jetzt das **eigene Loopback** (`localhost`/`127.0.0.1`/`::1`) wieder hinzu — kein Cross-Node-Vektor (Loopback ist stets lokal), Admin-/Fremd-Hostname bleibt ausgeschlossen, `CN=='localhost'` wird abgelehnt. gpt-5.5-CR bestätigt: WS-3-HIGH bleibt geschlossen. 831 Tests grün.

---

### ADR-022 Schritt 3 / WS-3 — Cross-Node PoP Cert-Issuance (node/<PeerID>)

Dritter Workstream von Schritt 3: der joinende Node beweist per **Proof-of-Possession** (libp2p-Ed25519-Key = PeerID-Wurzel) seine Berechtigung und erhält von der Admin-CA (.94) ein X.509-Cert mit SAN `spiffe://thinklocal/node/<PeerID>`. Code **beider Seiten** gebaut.

- **`cert-pop.ts`** (shared): domain-separierter, length-präfixierter PoP-Scope (`Domain ‖ CA-Fingerprint ‖ Nonce ‖ PeerID ‖ SPIFFE-URI ‖ CSR-Public-Key-Hash`); `signCertPop`/`verifyCertPop` über den libp2p-Ed25519-Key. Der **CSR-Key-Hash im Scope** schließt Cert-Substitution aus.
- **`cert-issuer.ts`** (Admin/.94): `NonceStore` (single-use, TTL, Kapazitäts-Limit), CSR-Verify, `signNodeCertFromCsr` (signiert den CSR-Key; SAN = kanonische URI + **nur** Antragsteller-eigener CN/IP), `CertIssuer.verifyAndIssue` (Nonce→CSR→PoP→Sign, fail-closed).
- **`cert-request.ts`** (Client): CSR/Keypair-Erzeugung, PoP-Aufbau, HTTP-Flow `requestNodeCert` (mTLS-Dispatcher authentifiziert, privater Key bleibt lokal).
- **`cert-issuance-api.ts`**: `POST /api/cert/nonce` + `/api/cert/sign` auf dem Haupt-mTLS-Server (Mesh-Mitgliedschaft via mTLS gated; 503 bei Nonce-Erschöpfung).
- **`index.ts`**: Admin-only-Wiring (nur mit CA-Key); `TLMCP_PEERID_ATTESTING_CA_FP` env verdrahtet den WS-2-Attestierungs-Pin (Default leer → inert).
- **.94-Instruktion:** `docs/runbooks/ADR-022-WS3-94-cert-issuance.md` (Endpoints, Request/PoP-Format, Verifikation, Signing, Cert-Ablage, Empfänger-Pin, TH01-Rejoin-Test).
- **CR gpt-5.5 (security):** 1 HIGH (Admin-Hostname/localhost-DNS-SAN-Impersonation im ausgestellten Cert) + 1 MEDIUM (Nonce-DoS) + 3 LOW — alle gefixt + Regressionstests; Re-Review bestätigt HIGH geschlossen, 0 Restfindings. PC clean. **831 Tests grün** (22 neue), tsc + eslint clean.

---

### ADR-022 Schritt 3 / WS-2 — Accept-both + Self-Identity (Phase 0, additiv, fail-closed)

Zweiter Workstream von Schritt 3 (ADR-022 Migrations-Sequenz Phase 0): Jeder Node **akzeptiert** beide SPIFFE-SAN-Formen (Legacy `host/<id>/agent/<type>` UND kanonisch `node/<PeerID>`) und **emittiert weiterhin Legacy**. Damit wird ein in Phase 1 von .94 neu auf `node/<PeerID>` ausgestelltes Cert sofort als PeerID-Beweis erkannt, bevor irgendwer den Sender-URI flippt.

- **`peer-identity.ts`** — neue reine Helfer: `spiffeUrisFromSubjectAltName()` (extrahiert **alle** URI-SANs → dual-SAN-Migrationscerts), `isAttestingIssuer()` (Fingerprint-Pin, normalisiert), `attestedPeerIdFromCert()` (zentrale Attestierungs-Entscheidung), `peerIdFromCertSan()`.
- **`agent-card.ts`** — `/message` zieht die kanonische SAN aus dem (nur bei `authorized===true` gelesenen) Peer-Cert und attestiert die PeerID **nur**, wenn das Cert von einer **gepinnten PeerID-attestierenden CA** stammt (`opts.peerIdAttestingCaFingerprints`). Kanonischer Sender ohne attestierendes Cert → 403.
- **`mesh.ts`** — `markPeerIdVerified` loggt bei mehrdeutigem mDNS-Match jetzt die Konflikt-Peers (Diagnose).
- **`index.ts`** — leitet die kanonische Self-Identität (`node/<PeerID>`) ab + loggt sie samt Accept-both-Posture; emittiert weiter Legacy.
- **Scope:** Phase-0-Default setzt **keinen** CA-Pin → die kanonische Attestierung ist **echt inert** (WS-3 setzt den .94-Admin-CA-Fingerprint). Kein Emit-/Cert-Ausstellungs-Wechsel.
- **CR gpt-5.5 (security):** 1 HIGH (CA-Konflation: jede transport-vertraute CA konnte `node/<PeerID>` attestieren) + 1 MEDIUM (mDNS-Duplikat-Sichtbarkeit) + 2 LOW (Single-SAN-Parser, mark-vor-Sigverify). HIGH+MEDIUM+1 LOW (dual-SAN) gefixt + 12 Regressionstests; Re-Review (intern) bestätigt HIGH geschlossen, 0 Restfindings. PC clean. **809 Tests grün**, tsc clean.

---

### ADR-022 Schritt 3 / WS-1 — channel-gebundene HTTPS-Authz (additiv, fail-closed)

Erster Implementierungs-Workstream von ADR-022 Schritt 3 (Cert-SAN-Cutover). Bindet die Autorisierung eingehender HTTPS-`/message`-Nachrichten **an den präsentierten mTLS-Client-Cert-SAN** — nie an ein globales Flag, nie an mDNS/Card (Konsensus-Kernprinzip „channel-bound authz").

- **`peer-identity.ts`:** `spiffeFromSubjectAltName()` (parst `URI:spiffe://` aus dem TLS-`subjectaltname`), `authorizeHttpsSender(senderUri, certSpiffe)` — kanonischer `node/<PeerID>`-Sender MUSS einen CA-validierten Cert-SAN mit **exakt derselben PeerID** präsentieren (`verifiedPeerId`); fehlt/Mismatch → Ablehnung. `isLegacyHostUri()` — **nur** das exakte `host/<id>/agent/<type>`-Schema bekommt den Migrations-Bypass (`legacy:true`), alles andere ist fail-closed.
- **`mesh.ts`:** `markPeerIdVerified(peerId)` — schaltet die kanonische PeerID-Auflösung für einen Peer frei, **nur bei eindeutigem Treffer** (mehrdeutige PeerID → nicht markiert + Warnung).
- **`agent-card.ts`:** `/message`-Handler liest den SAN **nur** eines TLS-validierten Sockets (`authorized===true`) und gated über `authorizeHttpsSender`; bei verifiziertem kanonischem Sender → `onPeerCertVerified`-Callback.
- **`index.ts`:** verdrahtet `onPeerCertVerified → mesh.markPeerIdVerified`.
- **Scope:** inert bis .94 `node/<PeerID>`-Certs ausstellt (kein Live-Verhaltenswechsel für Legacy-`host/`-Sender, kein .94-Eingriff). CR gpt-5.5: 1 HIGH (Legacy-Bypass zu breit) + 1 MEDIUM (mark-all) + 2 LOW — HIGH+MEDIUM+1 LOW gefixt (+ Regressionstests), 1 LOW (PeerID-Regex-Präfix) bewusst zurückgestellt.
- **Tests:** 792 grün, `tsc` clean; neuer HIGH-Regressionstest (non-host non-canonical → fail-closed), unique-match-Test für `markPeerIdVerified`.

---

### ADR-022 Security-Review-Fixes — Branch jetzt MERGEBAR (2× gpt-5.5-reviewt)

Zwei unabhängige `pal:codereview`-Läufe (gpt-5.5) über den ADR-022-Branch fanden 2 HIGH + 3 MEDIUM + LOW; alle gefixt, finale gpt-5.5-Bestätigung: **beide HIGH geschlossen, keine neuen HIGH/CRITICAL**.

- **HIGH 1 (Spoofing) — `mesh.ts resolvePeerPublicKey`:** kanonische `spiffe://thinklocal/node/<PeerID>`-Sender-URIs lösen jetzt **ausschließlich** über eine **kryptografisch verifizierte** PeerID-Bindung auf (`peer.libp2p.peerIdVerified`, eindeutiger Match), NIE über die exakten `agentId`/`card.spiffeUri`-Treffer (die nur Legacy-`host/…`-URIs bedienen). `peerIdVerified` ist default `false` und wird **nie** aus mDNS/Card gesetzt → Pfad faktisch aus bis zum Cert-Cutover. Schließt den verifizierten Angriff (mDNS `agent-id=node/<victimPeerId>` + eigene Card/Key) konstruktiv. Commit `f023d38`.
- **HIGH 2 (Key-Race) — `libp2p-identity.ts`:** exklusiver Create-Lock (`openSync 'wx'`) + Re-Check unter Lock + bounded fail-loud Wait (30s) → parallele First-Starts erzeugen nicht mehr zwei divergente Keys (PeerID-Drift). Commit `cb7f14d`.
- **MEDIUM:** stale-verified — `updateAgentCard` setzt `peerIdVerified=false` bei PeerID-Wechsel (`f023d38`); keys/-Dir `0700` erzwingen/warnen + dir-fsync-Fehler warnen (`cb7f14d`); strenger SPIFFE-Parser (kein `trim`, `[A-Za-z0-9]+`) (`8d8088c`).
- **LOW:** `writeSync` bis volle Länge; Lock-Timeout 5s→30s (`cb7f14d`).
- **Tests:** 4 neue Security-Regressionstests (Spoofing-blockiert, Parallel-Race→selbe PeerID, Malformed-URI-abgelehnt, stale-verified-reset). Suite **784 grün**, `tsc` clean.

**Status: ADR-022-Branch mergebar.** (Push/PR/Merge durch Operator.)

---

## [Unreleased] — 2026-06-03

### ADR-022 Voraussetzung #0 — libp2p-Ed25519-Key persistiert (stabile PeerID)

**Grundlage** der PeerID-gewurzelten Identität: der libp2p-Key wurde bisher bei JEDEM Start neu erzeugt (belegt durch 2 Smoke-Tests mit verschiedenen PeerIDs) → PeerID instabil. Jetzt persistiert.

- **`libp2p-identity.ts`** (neu): `loadOrCreateLibp2pPrivateKey` — Ed25519 via `@libp2p/crypto`, protobuf nach `<dataDir>/keys/libp2p-ed25519.key`, **crash-durable** (fsync Datei+Verzeichnis), `0600` (keys/-Dir `0700`), Perm-Warnung, Ed25519-Typcheck, **fail-loud** bei korruptem Key (kein stilles Neugenerieren → kein Identitätswechsel).
- **`libp2p-runtime.ts` / `index.ts`**: `createLibp2p({ privateKey })` verdrahtet; Key-Laden gated auf `libp2p.enabled`.
- **Deps:** `@libp2p/crypto@^5.1.19` + `@libp2p/peer-id@^5.1.9` (auf libp2p v2 gepinnt, kein Versions-Skew).
- **Akzeptanz:** Unit-Test beweist zwei aufeinanderfolgende Loads → **IDENTISCHE PeerID** (Gegenbeweis zu den 2 Smoke-Tests). Suite **779 grün**, `tsc` clean.
- **CR** (gpt-5.3-codex): 2 HIGH (fsync-Durability, enabled-Gating) + 4 MEDIUM — alle gefixt (+Regressionstest). **PC** clean. Commit `8718f0b`.

Verbleibt: authz vollständig auf PeerID + Cert-SAN=`node/<PeerID>` (admin-seitiges CSR-Signing auf .94, cross-node).

### ADR-022 Schritt 1 — PeerID-gewurzelte Identität (Code → TS → CR → PC)

Teil-Umsetzung des ADR-022-Migrations-Pfads (additiv/kompatibel, **kein** harter Cutover). Adressiert die zwei Root-Causes des SKILL_ANNOUNCE-403 „Unknown sender":

- **`peer-identity.ts`** (neu): kanonische SPIFFE-Ableitung aus der libp2p-PeerID (`spiffe://thinklocal/node/<PeerID>`, strikt geankert) + `checkIdentityConsistency()` für die §Startup-Assertion.
- **`mesh.ts` `resolvePeerPublicKey()`**: tolerante, **fail-closed** Auflösung des Signatur-Public-Keys (exakter agentId → exakte card-spiffeUri → eindeutige PeerID). Behebt Root-Cause (a) Identitäts-Drift.
- **`index.ts`**: SKILL_ANNOUNCE mit **Retry+Backoff** (4 Versuche) gegen den 403 (Root-Cause b, Timing); **Startup-Assertion** (loggt PeerID/Cert-SAN/authz-Identität; warn, harter Abbruch via `TLMCP_STRICT_IDENTITY=1`); Resolver-Wiring.
- **Tests:** peer-identity 10, mesh-Resolver 6 (inkl. fail-closed). Suite **774 grün**, `tsc` clean.
- **CR** (gpt-5.3-codex): 1 HIGH (fail-closed) + 3 MEDIUM + 1 LOW — alle gefixt (+Regressionstest). **PC** clean. Commit `1683396` (unsigniert — kein GPG-Key auf TH01).

**Offene Blocker (separat):** (1) libp2p-Ed25519-Key wird nicht persistiert → PeerID je Start neu — **Voraussetzung** für PeerID-als-Identität (braucht `@libp2p/crypto` + `createLibp2p({privateKey})` + `npm install`). (2) Cert-SAN-Umstellung auf `node/<PeerID>` braucht admin-seitiges CSR-Signing (.94, cross-node). Details: `docs/architecture/ADR-022-peerid-rooted-identity.md`.

### Governance — Regel „signierte Commits" entfernt (HISTORY-Vermerk)

CLAUDE.md, UNVERHANDELBARE REIHENFOLGE Schritt 9: „**git commit** — signed" → „**git commit** (unsigniert ok)". Die Pflicht zu signierten Commits (GPG / signoff) ist **entfernt**.

**Begründung:** Solo-Betrieb, eigene Repos, kein externer Contributor — Commit-Signing löst hier kein reales Problem und erzeugt nur Key-Verwaltungs-Aufwand über viele Maschinen (z.B. hat TH01 keinen GPG-Secret-Key). Die Regel war für dieses Setup **nicht anwendbar**. **Unsignierte Commits sind ab sofort regelkonform.**

(Das Repo führt keine separate HISTORY.md; dieser CHANGES-Eintrag ist der History-Vermerk.)

---

## [Unreleased] — 2026-05-20

### Test-Tooling — SQLite-ABI-Smoke-Test + `.nvmrc`-Check + `pretest`-Hook

**Problem:** Die 227 Test-Failures der Daemon-Suite auf Node v26 (Homebrew-Default) waren bisher als „pre-existing Test-Failures" bekannt — verursacht durch ABI-Mismatch zwischen better-sqlite3 (vorgebaut gegen Node v22 NODE_MODULE_VERSION 127) und der laufenden Node v26 (NODE_MODULE_VERSION 147). `scripts/check-native-modules.cjs` versuchte das automatisch zu erkennen, aber:

1. `require('better-sqlite3')` reicht nicht zur Erkennung — Bindings werden lazy beim Konstruktor-Aufruf geladen
2. Nach fehlgeschlagenem Rebuild fehlt die `.node`-Datei komplett → Fehler-Meldung wird „Could not locate the bindings file" (kein NODE_MODULE_VERSION-Match mehr)
3. Auto-Rebuild auf Node v26 scheitert hart (kein prebuilt + node-gyp-Inkompatibilitaet)

**Aenderungen:**

- **`.nvmrc`** (neu): pinnt Node-Version auf `22.22.3` (deckt sich mit `~/.thinklocal/bin/daemon-launchagent.sh`)
- **`scripts/check-native-modules.cjs`** (refaktoriert):
  - **Smoke-Test** (`SMOKE_TESTS['better-sqlite3']`): `new mod(':memory:')` triggert echtes Binding-Load, erzwingt ABI-Check
  - **Missing-Binding-Detection**: erkennt „Could not locate the bindings file" als Symptom eines vorausgegangenen Crashs und behandelt es wie ABI-Mismatch
  - **`.nvmrc`-Check** vor Rebuild-Versuch: bei Major-Version-Mismatch → klare Fehlermeldung mit konkretem Loesungs-Hint (`nvm use 22.22.3` oder `PATH=...`) statt verzweifeltem node-gyp-Crash
  - **Refactoring**: pure helpers `classifyLoadError`, `checkNvmrcMatch`, `formatNvmrcMismatchMessage`, `probeNativeModule` extrahiert + via `module.exports` exponiert; CLI-Code in `main()` mit `if (require.main === module)`-Guard
- **`packages/daemon/package.json`**: neuer `pretest`-Hook `node ../../scripts/check-native-modules.cjs` — bricht `npm test` mit klarer Anleitung ab, statt 227 cryptische Test-Failures zu zeigen
- **`scripts/check-native-modules.test.cjs`** (neu, 16 Tests): node:test-Suite fuer die Helper-Funktionen
- **`package.json` (root)**: neuer `test:scripts`-Hook in `npm test`

**Verifikation:**

```
PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" npm --prefix packages/daemon test
→ Test Files  69 passed (69)
   Tests  758 passed (758)   # vorher: 758 - 227 = 531 grün
   Duration  2.59s

node scripts/check-native-modules.cjs               (auf v26)
→ exit=1, klare Anleitung wie auf v22 zu wechseln

node scripts/check-native-modules.cjs               (auf v22)
→ exit=0, "OK: better-sqlite3"

node --test scripts/check-native-modules.test.cjs   (auf v22)
→ 16 / 16 pass
```

### ADR-020 Phase 1.1 Bug-Report #4 — Pairing-URI-Migrationsskript

**Symptom:** AGENT_MESSAGE-Sender bekommen `ack_status: "rejected"`, Empfaenger loggen `AGENT_MESSAGE von nicht-gepairtem Sender abgelehnt`. SKILL_ANNOUNCE bekommt 403. Systemisch auf allen 5 Nodes.

**Root Cause:** Pairing-Eintraege vom 7.-10.4.2026 nutzen Host-ID-basierte SPIFFE-URIs (`spiffe://thinklocal/host/<16-hex>/agent/<type>`), Pairings vom 13.4.2026 (vor einem Schema-Wechsel) nutzen hostname-basierte URIs (`spiffe://thinklocal/host/iobroker/agent/...`). Alte Eintraege wurden nie automatisch migriert. AGENT_MESSAGE wird gegen den falschen Eintrag verglichen.

**Fix:**
- **`packages/daemon/scripts/migrate-pairings.mjs`** (neu): One-Shot-Script, holt agent-card vom Peer via mTLS, ersetzt Legacy-URI durch aktuelle Host-ID-URI. Atomares Schreiben mit Backup. Unterstuetzt `--dry-run`. Verfuegbar als `npm run migrate-pairings`.
- **`packages/daemon/src/pairing.ts`**: Neue exportierte Hilfsfunktion `isHostIdSpiffeUri()` + Regex `HOST_ID_URI_PATTERN`. `PairingStore.load()` warnt bei Start wenn Legacy-Eintraege erkannt werden, mit Hinweis auf das Migrationsskript.

**Tests:** `pairing.test.ts`: 8 neue Tests (6 fuer URI-Klassifizierung, 2 fuer Startup-Warning).

**Manuelle Verifikation:** Migrationsskript live auf MacBook ausgefuehrt — 1 Legacy-Eintrag erfolgreich ersetzt. Backup-Datei erzeugt.

### ADR-020 Phase 1.1 Bug-Report #3 — libp2p `connectionEncrypters` Config-Key (Critical-Hotfix)

**Symptom (Live-Befund 2026-05-19):** Nach PR #135 (Auto-Dial-Fix) feuerten die Discovery-Listener wie erwartet, aber **alle** libp2p-Dials scheiterten mit `"All multiaddr dials failed"` oder `"aborted due to timeout"`. 0 erfolgreiche Verbindungen, `registry_sync = {}` auf allen 5 Nodes. Verifiziert via libp2p-Probe-Skript: `EncryptionFailedError: At least one protocol must be specified`.

**Root Cause:** Die Daemon-Konfig in `libp2p-runtime.ts` setzte `connectionEncryption: [noise()]`. In libp2p v2+ wurde dieser Key umbenannt zu `connectionEncrypters` (mit `-ers`, Plural). Der alte Key wird **silent ignoriert** — Noise war im laufenden Daemon nie konfiguriert. Bei jedem Dial scheiterte multistream-select an "keine Encryption-Protokolle".

**Fix:** `packages/daemon/src/libp2p-runtime.ts`: `connectionEncryption` → `connectionEncrypters`. One-line change.

**Tests:** `packages/daemon/src/libp2p-runtime-config.test.ts` (neu, 4 Regression-Tests): prueft sowohl den Source-Text als auch die zur Laufzeit an `createLibp2p()` uebergebenen Optionen. Damit kann der Bug nie wieder zurueckkehren.

**Folge:** Loest den Live-Befund aus PR #135 (alle Auto-Dials scheiterten) UND einen Teil von Bug #3 (Asymmetrisches Sync-Hole) — das libp2p-CRDT-Sync war komplett kaputt, der GossipSync-Fallback hat die teilweise Sichtbarkeit liefert.
### ADR-020 Phase 1.1 Bug-Report #2 — `execute_remote_skill` Port-Mix (Hotfix)

**Symptom:** `execute_remote_skill` liefert auf bestimmten Hosts `"Parse Error: Expected HTTP/, RTSP/ or ICE/"`. Verifiziert live auf influxdb gegen iobroker.

**Root Cause:** In `mcp-stdio.ts` war das Protokoll fuer die Remote-Peer-URL an `RUNTIME_MODE === 'lan' ? 'https' : 'http'` gekoppelt. Die mcp-stdio-Subprocess wird vom Claude-Code-MCP-Harness ohne `TLMCP_RUNTIME_MODE` gestartet (verifiziert: `/proc/<pid>/environ` auf influxdb enthaelt nur `TLMCP_DAEMON_URL`, kein RUNTIME_MODE). Default → `'local'` → `peerProto='http'` → HTTP-Bytes an HTTPS-only Peer-Port 9440 → Parse-Error im HTTP-Parser.

**Fix:** `packages/daemon/src/mcp-stdio.ts`: neue exportierte Hilfsfunktion `buildRemotePeerUrl(host, port)` liefert immer `https://`. Remote-Peers im Mesh laufen grundsaetzlich mit mTLS+HTTPS (Production-Config), unabhaengig vom lokalen RUNTIME_MODE. `RUNTIME_MODE` bleibt fuer den LOKALEN Daemon-URL erhalten.

**Tests:** `packages/daemon/src/mcp-stdio-remote-skill.test.ts` (neu, 4 Tests).

### ADR-020 Phase 1.1 — libp2p Auto-Dial nach Peer-Discovery (Hotfix)

**Behebt das Convergenz-Problem aus PR #134:** Nach Merge von ADR-020 v1 lief der `RegistrySyncCoordinator`, aber `peers`-Map blieb permanent leer. Root Cause: libp2p v3 dialt nach `peer:discovery` NICHT automatisch — `Libp2pNode.#onDiscoveryPeer` macht nur `peerStore.merge`. Die Anwendung muss explizit dialen. mDNS funktionierte, aber niemand baute Verbindungen auf → kein peer:connect → CRDT-Sync nie aktiv.

- **`packages/daemon/src/libp2p-runtime.ts`:** Neuer `peer:discovery`-Listener in
  `attachEventListeners()`, der `node.dial(peer.id)` aufruft. Schutzschichten:
  Self-Filter, Already-Connected-Filter, In-Flight-Dedup via Set, Stop-Guard.
  Listener-Anbringung VOR `node.start()` (statt danach) + defensiver
  PeerStore-Scan via `dialKnownPeers()` nach Start, schliesst Race mit fruehen
  Discovery-Events.
- **`packages/daemon/src/libp2p-runtime.ts`:** Neue Hilfsfunktion
  `extractPeerIdFromConnectionEvent()` ersetzt das fehlerhafte
  `detail.toString()`-Parsing. libp2p `peer:connect` liefert
  Connection-Objekte deren generic `toString()` `"[object Object]"`
  zurueckgibt — der Coordinator bekam Garbage-Peer-IDs. (HIGH-Finding aus
  pal:codereview gpt-5.5).
- **`packages/daemon/src/registry-sync-coordinator.ts`:** Inflight-Race im
  converged-Pfad gefixt. Wenn `generateSyncMessage` `null` liefert, lief die
  IIFE synchron bis zum inneren `finally`, das `inflight=null` setzte; danach
  ueberschrieb der outer `entry.inflight = promise` das mit dem resolved
  Promise → Peer permanent blockiert. Cleanup ausschliesslich im outer
  finally. (HIGH-Finding aus pal:codereview gpt-5.5).
- **Tests:** 14 Unit-Tests in neuer `libp2p-autodial.test.ts` + 1 Regression-Test
  fuer Inflight-Race in `registry-sync-coordinator.test.ts`. 53 sync/libp2p-
  Tests gruen.
- **Konsens vorab:** GPT-5.5 + Gemini 2.5 Pro einstimmig (Konsens-ID 5801b78c).
- **Doku:** `docs/architecture/ADR-020-Phase-1.1-autodial.md`.

### ADR-020 v1.0 Production-Genesis-Blob — Bake-In (PR #134, Mac mini)

Setzt den `REGISTRY_GENESIS_BLOB_BASE64` in `packages/daemon/src/registry.ts`
durch einen echten Automerge-Blob (192 Bytes Base64) statt dem
`__GENESIS_PLACEHOLDER__`. Damit greift der Production-Guard und der
v1-Branch ist live-deploy-faehig.

- **`packages/daemon/scripts/produce-genesis-blob.mjs`** (neu, 49 LoC):
  reproduzierbares Skript fuer Audit-Trail. Erzeugt
  `Automerge.from({capabilities:{}, last_sync:{}}, {actor: all-zero})`.
  **Wichtige Erkenntnis verifiziert:** Automerge 2.x ist zwischen
  Process-Runs nicht bit-deterministisch — Save() enthaelt eine variable
  Komponente. Konsequenz: der eingebettete Blob in registry.ts ist die
  verbindliche Quelle (Code-as-Truth), das Skript produziert nur
  semantisch aequivalente Blobs.
- **`packages/daemon/src/registry.ts`** (geaendert):
  - Real-Blob statt Placeholder
  - Typisierung der Konstante auf `string` (verhindert TS-Literal-Narrowing,
    damit der Production-Guard nicht eliminiert wird)
  - `GENESIS_PLACEHOLDER` als benannte Konstante statt Inline-String
  - Fail-fast Schema-Check nach `Automerge.load`: capabilities + last_sync
    muessen leere Maps sein
  - Dev-Bootstrap-Fallback bleibt erhalten (Backward-Compat)
- **`packages/daemon/tests/registry-genesis.test.ts`** (neu, 5 Tests):
  - Blob ist nicht mehr Placeholder
  - Blob laesst sich als Automerge-Doc mit kanonischer Empty-Schema laden
  - Zwei Registries aus demselben Genesis koennen Caps mergen
  - Blob hat genau einen Single-Root-Head (`/^[0-9a-f]{64}$/`)
  - Skript-Output ist schematisch valide (Code-as-Truth gilt fuer Konstante,
    nicht fuer Bit-Equality)
- **Code-Review (GPT-5.4)**: 0 HIGH/CRITICAL, 3 MEDIUM + 1 LOW gefunden,
  alle vor Commit gefixt:
  - MED Doc-Kommentare aktualisiert (Determinismus-Behauptung raus)
  - MED `as string`-Cast ersetzt durch typisierte Konstante + named placeholder
  - MED Runtime-Schema-Check nach Automerge.load
  - LOW `execFileSync` nutzt `process.execPath` statt `'node'`
- **Tests**: 672/672 gruen, tsc clean, 0 Regressionen.

### ADR-020 v1+v2 Registry Replication Recovery — Code-Implementierung (PR #134)

- **Hauptbug behoben**: `libp2p-runtime.ts:335-356` registriert nicht mehr
  Placeholder-Handler, die alle eingehenden Streams sofort schliessen. Stattdessen
  pluggable Protocol-Handler via Constructor-Hooks (Default bleibt Placeholder fuer
  Protokolle ohne Implementierung).
- **`packages/daemon/src/registry-sync-protocol.ts`** (neu): Length-prefix Framing
  mit 8 MiB Max-Frame, multi-chunk reads, abortable iterator, 1-Frame-per-Stream-
  Konvention. Cleanup via `iterator.return()` bei jedem Fehlerpfad.
- **`packages/daemon/src/registry-sync-coordinator.ts`** (neu): Per-Peer
  Anti-Entropy Sync mit Inflight-Singleflight, AbortController + Generation-Token
  fuer Reconnect-Safety, 3-Strike-HangUp bei Timeouts, Inbound-Buffer-Limit gegen
  Memory-DoS (16 Messages / 16 MiB), Jitter-Timer (±20 %).
- **`packages/daemon/src/registry-sync-libp2p-adapter.ts`** (neu):
  `wireRegistrySync()` verheiratet Coordinator und libp2p. Erzeugt SyncTransport,
  Protocol-Handler fuer `/thinklocal/mesh/registry/1.0.0`, Peer-Events.
- **`packages/daemon/src/registry.ts`**: Shared-Genesis-Doc via
  `REGISTRY_GENESIS_BLOB_BASE64` + `loadGenesisDoc()`. Loest entdeckten
  Architektur-Bug (disjoint history-trees) — `Automerge.clone(genesis)` statt
  separater `Automerge.init()` pro Daemon. Production-Guard verhindert
  versehentlichen Deploy mit Placeholder. v2.1: `last_sync` deprecated. v2.4: neue
  Methode `getHeads()` als verlaessliche Konvergenz-Metrik.
- **`/api/registry/republish`** (Safety Valve, admin-only via mTLS,
  rate-limited): erzwingt sofortige Sync-Round pro Peer fuer Triage.
- **`/api/status`** erweitert um `libp2p.registry_sync` Per-Peer-Block
  (rounds, converged, last_round_at, consecutive_timeouts, last_error, in_flight).
- **AuditEventType**: neuer Event-Typ `REGISTRY_REPUBLISH`.
- **Compliance**: CO ✅ (4-Modell-Konsens: gpt-5.2 + gemini-3-pro + gpt-5.5 +
  MiniMax-M2.7), CG ✅ (gemini-3-pro auf Test-Skizzen), TS ✅ (31/31 gruen:
  11 Protocol + 18 Coordinator + 2 Integration), CR ✅ (gpt-5.5: 5 HIGH-Findings
  alle gefixt mit Regression-Tests), PC ✅ (internal), DO ✅ (ADR-020 v1+v2 +
  COMPLIANCE-TABLE PR #139).
- **Production-Deploy-Hinweis**: Bevor v1 in Production live geht, muss der echte
  `REGISTRY_GENESIS_BLOB_BASE64` produziert werden (aktuell Placeholder, schuetzt
  Production-Guard).

### ADR-019 Phase 1.1 — Bind-Regression-Hotfix

Phase-1-Code hatte `new Bonjour({ interface: meshIp })` ohne `bind`-Option. Das
fuehrt in `multicast-dns/index.js` Zeile 65 dazu, dass der UDP-Socket auf die
**unicast**-IP `meshIp:5353` gebunden wird statt auf `0.0.0.0:5353`. Folge: der
Kernel verwirft Multicast-Pakete an 224.0.0.251 — Receive ist tot, Outbound
funktioniert weiter. Live beobachtet auf Mac mini `10.10.10.94`: 0 Peers im
mesh_status trotz vollstaendiger Sichtbarkeit im OS-`dns-sd`.

- **Multi-Modell-Konsens** (GPT-5.4 8/10, GPT-5.1-Codex 8/10, Gemini-3-Pro 9/10):
  einstimmig **Option 3** statt Option 1 (Rollback) oder Option 2 (private
  internals). `new Bonjour({ interface: meshIp, bind: '0.0.0.0' })` nutzt das
  natuerliche multicast-dns API: `bind` gewinnt fuer Receive (Zeile 65),
  `interface` bleibt fuer outbound `setMulticastInterface()` (Zeile 153).
- **`packages/daemon/src/discovery.ts`**: Konstruktor um `bind: '0.0.0.0'`
  erweitert. Log-Message angepasst.
- **`packages/daemon/src/discovery.ts`**: Konstruktor um optionalen
  `networkInterfacesSource`-Parameter erweitert (Test-Hook, MEDIUM-Fix
  Code-Review GPT-5.4 — deterministische Tests statt CI-Host-Abhaengigkeit).
- **`packages/daemon/src/discovery.test.ts`** (5 neue Tests):
  - `bind:"0.0.0.0"` + `interface:meshIp` deterministisch via Stub
  - Positiver CIDR-Policy-Pfad mit matching Interface (LOW-FIX CR)
  - Ohne Mesh-IP: Bonjour mit `{}` (Backward-Compat)
  - Regression-Invariante: `bind !== interface`
  - Shutdown-Ordering: `stop()` ruft `browser.stop` + `unpublishAll` + `destroy` (LOW-FIX CR)
- **`docs/architecture/ADR-019-multi-interface-discovery.md`**: Status auf
  Phase 1.1, neuer Hotfix-Block mit Symptom/Root-Cause/Konsens/Fix/Tests.
- **Code-Review (GPT-5.4)**: 0 HIGH/CRITICAL, 1 MEDIUM + 2 LOW gefunden, alle
  vor Commit gefixt mit Regression-Tests.
- **Tests**: 690/690 gruen (vorher 685), 0 Regressionen.

### ADR-020 + ADR-021: CRDT-Replikation und Skill-Health (Proposed)

- **`docs/architecture/ADR-020-registry-replication-recovery.md`** (neu):
  Root-Cause-Analyse + Fix-Plan fuer den eingefrorenen CRDT-Registry-Sync
  im 5-Node-Mesh. Smoking Gun: `packages/daemon/src/libp2p-runtime.ts:335-356`
  registriert fuer **alle** Mesh-Protokolle Placeholder-Handler, die
  eingehende Streams sofort schliessen — Sync ueber libp2p hat nie
  funktioniert, Heartbeats laufen nur deshalb, weil sie HTTPS-basiert sind.
- **4-Modell-Konsens** (`gpt-5.2` 9/10, `gemini-3-pro-preview` 9/10,
  `gpt-5.5` 8/10, `MiniMax-M2.7` 7/10): Confidence sinkt mit jedem Reviewer,
  weil neue Edge-Cases sichtbar wurden. Loesung: **v1** (5 Blocker:
  echte Handler, Length-Prefix-Framing, RegistrySyncCoordinator mit
  Per-Peer-Singleflight, bidirektionaler Sync, Timeout-basiertes
  SyncState-Cleanup) und **v2** (5 Robustheits-Punkte: `last_sync` aus
  CRDT-Doc raus, Owner-wins erzwingen, libp2p-connected-SLO statt
  HTTPS-online, Heads-Hash statt Capability-Hash, Backpressure/Chunking).
- **Konvergenz-Garantie**: divergent + connected nicht laenger als 120 s
  (v1) bzw. 60 s (v2). Verletzung = Regression.
- **`docs/architecture/ADR-021-skill-health-lifecycle.md`** (neu):
  Generisches Skill-Health-Monitoring als Antwort auf den InfluxDB-Boot-Race
  (2026-05-17, Skill war 70 Min unsichtbar bis manueller Daemon-Restart).
  Zentraler `SkillHealthMonitor` statt Plugin-Pattern, State-Machine binaer
  (HEALTHY/UNHEALTHY, **kein** DEGRADED), Hysterese 2-up/3-down. Backoff
  **linear** (30 s healthy / 60 s unhealthy, gegen GPTs Position), Registry-
  Update via `availability`-Attribut (gegen Geminis Position, weil
  k8s/Consul-Standard, weniger Hash-Churn, Debug-Sicht bleibt). Voraussetzung
  ADR-020 v2.2 (Owner-wins).
- **Verworfene Hypothese**: „Crash-Loops haben libp2p-Streams in Half-Open-
  Zustand gebracht" — der Bug war von Anfang an im Code, fiel nur jetzt
  durch den 5-Node-Test auf.

### ADR-019 Multi-Interface mDNS Discovery (Phase 1)

Bei Hosts mit mehreren Netzwerk-Interfaces (z.B. MacBook mit Ethernet im LAN
+ WLAN + DMZ-Verbindung) wurden Peers ueber falsche IPs entdeckt — der Daemon
verbendete sich gegen DMZ-IPs (10.0.0.20) statt Mesh-IPs (10.10.10.55) und
mTLS-Handshakes scheiterten. Multi-Modell-Konsensus (GPT-5.4 + Gemini 3 Pro):
CIDR-basierte Interface-Selektion + Bonjour mit explizitem Pinning + empfangs-
seitige CIDR-Validierung gegen Reflector-Leakage.

- **PoC via tcpdump bewiesen:** `bonjour-service`'s `{ interface }` Option
  steuert nur den Multicast-Socket, NICHT die A-Records. Selbst mit Pinning
  werden alle lokalen IPs in den A-Records published. Loesung: zusaetzlich
  `Service.records()` monkey-patchen.
- **`packages/daemon/src/discovery-policy.ts`** (neu): CIDR-Match (`ipInCidr`),
  Interface-Inventarisierung mit Dependency-Injection (testbar), Default-Excludes
  fuer 15 virtuelle Interface-Typen (docker/tailscale/utun/veth/bridge/...).
- **`packages/daemon/src/discovery.ts`** (erweitert): Konstruktor pinned auf
  `getMeshIp(policy)`, publish() ruft `restrictServiceToIp()` auf, browse()
  filtert empfangene Peer-IPs via `isPeerIpAllowed()`.
- **`packages/daemon/src/config.ts`** (erweitert): `allowed_mesh_cidrs` und
  `exclude_interface_patterns` in `[discovery]`, fail-fast bei ungueltigen CIDRs.
- **Env-Vars**: `TLMCP_ALLOWED_MESH_CIDRS`, `TLMCP_EXCLUDE_INTERFACE_PATTERNS`.
- **`docs/architecture/ADR-019-multi-interface-discovery.md`**: Vollstaendige
  Konsensus-Doku mit Phase-2-Limitationen (kein Reconcile-Loop, IPv6 spaeter).
- **`docs/USER-GUIDE.md`**: Neuer Troubleshooting-Eintrag "Mesh nicht gefunden
  trotz aktivem Daemon".
- **Code-Review (GPT-5.4)**: 1 HIGH + 2 MEDIUM + 4 LOW Findings — alle vor
  Merge gefixt mit Regression-Tests (parseInt-Spoofing, leere Excludes,
  Idempotenz, CIDR-Validation, Hostname-Fallback, leere A-Records).
- **Precommit-Review (GPT-5.4)**: weitere 1 HIGH + 1 MEDIUM + 1 LOW gefunden:
  - HIGH: `allowed_mesh_cidrs` ohne Match = silent fallback → jetzt fail-closed
  - MEDIUM: User-Excludes ersetzten Defaults → jetzt gemerged
  - LOW: Tests prueften nur Helper → 3 echte MdnsDiscovery-Wiring-Tests ergaenzt
- **Tests**: 37 Unit-Tests + 12 Integration-Tests, Gesamt **685/685 gruen**
  (vorher 672), 0 Regressionen.

## [Unreleased] — 2026-05-16

### macOS-Deployment als LaunchDaemon dokumentiert

- **`docs/MACOS-DEPLOYMENT.md`** (neu): Empfohlener Setup-Pfad fuer macOS-Hosts,
  speziell fuer headless / SSH-only / FileVault-Setups.
- **Architekturentscheidung**: LaunchDaemon statt LaunchAgent, weil
  LaunchAgents eine aktive Aqua-User-Session voraussetzen — bei FileVault
  ohne Auto-Login (typisches Mac-mini-Setup) startet niemand automatisch
  eine Session. LaunchDaemon laeuft ab Boot, KeepAlive aktiv, als
  unprivilegierter User via `UserName=chris`.
- **Wrapper `~/.thinklocal/bin/daemon-launchagent.sh`** wartet auf
  Multicast-Route und IPv4-Adresse, verhindert `EHOSTUNREACH 224.0.0.251:5353`-
  Crash bei zu fruehem Start.
- **Stolperfallen dokumentiert**: Hostname-Hochzaehlen, `backgroundtaskmanagementd`-
  TCC-Block fuer LaunchAgents seit Ventura, `launchctl bootstrap gui/<uid>`-
  Fehler 125 ohne Aqua-Session, `better-sqlite3` ABI-Mismatch nach Node-Upgrade.
- **Node-Empfehlung**: nvm-Node 22 LTS, nicht Homebrew (das aktuell 25/26
  ausliefert, womit `better-sqlite3 11.x` nicht baut).
- Relevant fuer den **Installer/Distribution**: alle hartkodierten Pfade
  (`/Users/chris/...`, Node-Version, `UserName`) muessen per Template ersetzt
  werden.

---

## [Unreleased] — 2026-04-14

### ADR-018 Observer Agent Phase 1 — lokale Intelligenz fuer headless Nodes

- **`docs/architecture/ADR-018-observer-agent.md`** (neu): Architektur fuer
  einen separaten Observer-Prozess der proaktiv read-only System-Checks
  ausfuehrt und Auffaelligkeiten ueber das lokale Modell analysiert.
- **`packages/observer/`** (neues Paket): 4 Module + CLI-Einstiegspunkt:
  - `model-selector.ts` — RAM-basierte Auswahl (qwen3.5:0.6b bis gemma4:26b)
  - `system-probes.ts` — Whitelist sicherer Befehle (df, free, journalctl, crontab -l, apt list, …)
  - `ollama-client.ts` — Minimalclient ohne externe Dependencies
  - `analyzer.ts` — Prompt-Building + JSON-Parsing der Modell-Antwort
  - `observer-agent.ts` — Hauptprozess mit `--send --admin=<uri>` Flags
- **Sicherheit**: Read-only by default, keine rohen Logs in Prompts,
  strikte Befehls-Whitelist, keine automatischen Schreib-Aktionen.
- **Tests**: 44 Unit-Tests (model-selector 10, analyzer 14, system-probes 6, ollama-client 14).
- **Daemon-Tests**: 636/636 unveraendert, 0 Regressionen.

## [Unreleased] — 2026-04-13

### ADR-017 Auto-Update CLI-Befehl (Phase 1)

- **`docs/architecture/ADR-017-auto-update.md`** (neu): ADR fuer zweistufigen
  Auto-Update-Mechanismus. Phase 1: lokaler `thinklocal update` CLI-Befehl
  (GitHub Releases, SHA256-Verifikation, Admin-Approval). Phase 2 (Zukunft):
  Mesh-propagierte Updates ueber ADR-015 OTS-Mechanismus.
- **`packages/cli/src/thinklocal.ts`**: Neuer `thinklocal update` Befehl mit
  drei Modi: interaktiv (zeigt Version-Diff, fragt nach), `--check` (nur pruefen,
  Exit-Code 0/1), `--auto` (automatisch fuer Cron/CI). Liest aktuelle Version
  aus package.json, fragt GitHub API ab, zeigt Release-Notes, fuehrt bei
  Bestaetigung `git pull --ff-only` + `npm install` + Daemon-Restart durch.
  Hilfetext aktualisiert.

### ADR-016 Token-Onboarding Phase 3: CLI + MCP Tools

- **`packages/cli/src/thinklocal.ts`**: 4 neue CLI-Kommandos:
  `thinklocal token create --name <name> [--ttl <hours>]` (Token erstellen),
  `thinklocal token list` (Tokens auflisten mit farbiger Status-Tabelle),
  `thinklocal token revoke <id>` (Token widerrufen),
  `thinklocal join --token <token> --admin-url <url>` (Mesh beitreten,
  speichert Certs in `~/.thinklocal/tls/`).
- **`packages/daemon/src/mcp-stdio.ts`**: 2 neue MCP-Tools:
  `token_create` (Token erstellen via MCP), `token_list` (Tokens auflisten via MCP).
- Hilfetext aktualisiert mit Token- und Join-Befehlen.

### ADR-016 Token-Onboarding Phase 2: REST API (PR #125)

- **`packages/daemon/src/token-api.ts`** (neu): 4 REST-Endpoints:
  `POST /api/token/create` (loopback), `GET /api/token/list` (loopback),
  `POST /api/token/revoke` (loopback), `POST /onboarding/join` (remote).
  Join-Flow: Bearer-Token validieren → Node-Cert signieren mit CA →
  Peer registrieren → TrustStore hot-reloaden.
- **`packages/daemon/src/audit.ts`**: 4 neue Event-Types (TOKEN_CREATE,
  TOKEN_REVOKE, TOKEN_JOIN_REJECTED, TOKEN_JOIN_SUCCESS) + EntityType `token`.
- 15 neue Tests. Full Suite 633/633 gruen.

### ADR-016 Token-Onboarding Phase 1 (PR #124)

- **`docs/architecture/ADR-016-token-onboarding.md`**: Neues ADR fuer Bearer-Token-
  basiertes Onboarding als Alternative zur SPAKE2-PIN-Zeremonie. Single-Owner-Meshes
  koennen Nodes per `thinklocal token create` + `thinklocal join --token` hinzufuegen,
  ohne physischen Terminal-Zugang auf beiden Nodes.
- **`packages/daemon/src/token-store.ts`**: SQLite-backed Token-Store mit SHA-256
  Hash-Speicherung, single-use Semantik, TTL-Validierung (5min–7d), Revokation und
  Audit-Callback-Integration. 256 Bit Entropie (crypto.randomBytes), base64url-Format
  mit `tlmcp_` Prefix.
- **`packages/daemon/src/token-store.test.ts`**: 41 Unit-Tests covering creation,
  validation, single-use enforcement, expiration, revocation, listing, pruning,
  persistence, hash verification, format validation und edge cases.

### Nachtschicht Inbox-Fixes (PR #122)

- **`packages/daemon/src/index.ts`**: AgentRegistry Initialisierung VOR
  registerInboxApi() verschoben. Broadcast-Pattern (`to=…/instance/*`) war
  ohne agentRegistry Dependency nicht funktional.
- **`packages/daemon/src/inbox-api.ts`**: Neues `pairingStore` Dependency-Feld
  in InboxApiDeps. Outbound Remote-Path prueft jetzt `pairingStore.isPaired()`
  vor dem Senden — unpaired Peers bekommen 403 (SECURITY: verhindert dass
  lokale MCP-Clients Messages an entdeckte-aber-ungepairte Nodes schicken).
- 3 neue Tests in `inbox-api-adr005.test.ts`: ACL blocked (403), ACL passed,
  backwards-compat ohne pairingStore. Full Suite 577/577 gruen.

### TLS Hot-Reload + Graceful Unregister (PR #116)

- **`packages/daemon/src/agent-card.ts`**: Neue `reloadTlsContext()` Methode.
  Nutzt `httpsServer.setSecureContext()` fuer Hot-Swap des CA-Bundles
  ohne Daemon-Restart. Nur neue Verbindungen nutzen den neuen Context.
- **`packages/daemon/src/pairing-handler.ts`**: `trustStoreNotifier.rebuild()`
  nach `store.addPeer()` — triggert den Hot-Reload nach erfolgreichem Pairing.
- **`packages/daemon/src/index.ts`**: `onChange` Listener verdrahtet:
  TrustStoreNotifier → cardServer.reloadTlsContext().
- **`packages/daemon/src/mcp-stdio.ts`**: Agent-Registry Register beim Start,
  Unregister beim Shutdown (fire-and-forget, 200ms Grace-Period).
  Instance-ID: `mcp-stdio-{pid}`.
- 8 neue Tests (TrustStoreNotifier callbacks). Full Suite 574/574 gruen.
- CR Gemini Pro: 0 HIGH, 1 MEDIUM (Exit-Timeout 50→200ms), 2 LOW (beide gefixt).

### Phase D: Resource Governance (PR #115)

- **`packages/daemon/src/session-checkout.ts`** (neu): Atomic Branch-Locking.
  SQLite-backed, auto-expiry nach 2h, idempotent re-checkout, force-release.
  Verhindert dass zwei Agents am selben Branch kollidieren. 13 Tests.
- **`packages/daemon/src/budget-guard.ts`** (neu): Token/Cost Budget Guard.
  Per-Agent Tracking (prompt + completion tokens), soft limit (80%) + hard limit.
  SQLite-backed, auto-prune nach 7 Tagen. 11 Tests.
- **`packages/daemon/src/config-rollback.ts`** (neu): Config Rollback.
  Erweitert ConfigRevisions (PR #96) um Rollback-Faehigkeit. Stellt den
  "before"-Snapshot einer Revision wieder her. 7 Tests.
- **`packages/daemon/src/circuit-breaker.ts`** (neu): Circuit Breaker fuer
  Skill-Execution. 3-State-Pattern (closed/open/half_open), configurable
  failure threshold + reset timeout. In-Memory, pro Skill. 17 Tests.
- Full Suite: 621/621 Tests, 63 Test-Files, 0 Regressionen.

### ADR-004 Phase 3+4: WebSocket-Push + Compliance-Check (PR #114)

- **`packages/daemon/src/websocket.ts`**: Erweitert von simplem Broadcast zu
  Subscription-basiertem Filtering. Clients koennen per Query-String oder
  JSON-Message fuer bestimmte Event-Typen und Agent-IDs subscriben.
  Agent-Filter sind loopback-only (CR Gemini Pro: Snooping-Schutz).
- **`packages/daemon/src/compliance-check.ts`** (neu): Async Compliance-Check
  Endpunkt `GET /api/compliance/status`. Prueft: dirty working tree,
  CHANGES.md, COMPLIANCE-TABLE.md, unpushed commits, TODO.md open items.
  Loopback-only. CR-Fix: execSync → async exec (Event-Loop-Blocking).
- **`packages/daemon/src/index.ts`**: `inbox:new` Event emittiert bei
  AGENT_MESSAGE Delivery (remote + loopback). eventBus an InboxApiDeps.
  registerComplianceApi verdrahtet.
- **`packages/daemon/src/inbox-api.ts`**: eventBus optional in InboxApiDeps,
  `inbox:new` bei loopback-Zustellung emittiert.
- 24 neue Tests (16 WebSocket + 8 Compliance). Full Suite 518/518 gruen.
- CR Gemini Pro: 0 CRITICAL, 0 HIGH (2 gefixt → async exec + WS loopback),
  1 MEDIUM (Event-Type-Validation → WONTFIX v1), 1 LOW (Rate-Limiting).

### ADR-015: Mesh-basierte Update-Distribution (Proposed)

- **`docs/architecture/ADR-015-mesh-update-distribution.md`** (neu): Design-Dokument
  fuer Over-The-SPIFFE (OTS) Update-Distribution. Idee: ein Node mit neuerer
  Daemon-Version kann Updates signiert via mTLS an andere Peers verteilen.
  Status: Proposed, Prioritaet: Deferred.

### 4-Node Full-Mesh Skill Exchange — Live-Test bestanden ✅

- **MacMini** (10.10.10.94), **influxdb** (10.10.10.56), **ai-n8n** (10.10.10.222),
  **MacBook Pro** (10.10.25.103) — alle 4 Nodes tauschen Skills bidirektional
  ueber mTLS aus. SKILL_ANNOUNCE Envelopes fliessen in alle Richtungen.
  Claude Code Skill-Files (`~/.claude/skills/*.md`) auf allen Nodes materialisiert.
  Der "ioBroker-Moment" ist Realitaet: Peers entdecken sich, announzen Skills,
  und Agenten wissen automatisch was sie koennen.

### Skill Discovery Wire-Send (PR #112)

- **`packages/daemon/src/index.ts`**: peer:join Handler sendet jetzt einen
  echten SKILL_ANNOUNCE Envelope via mTLS an den neuen Peer (gleicher Pattern
  wie gossip.ts syncWithPeer). Vorher war nur ein lokales Event emittiert
  worden. Jetzt fliessen die Skills tatsaechlich ueber das Netzwerk.

### Skill Discovery Wiring (PR #111)

- **`packages/daemon/src/index.ts`**: SkillDiscovery + CapabilityActivationStore
  im Daemon-Lifecycle verdrahtet. peer:join Event → announced lokale Skills.
  SKILL_ANNOUNCE Handler → leitet an SkillDiscovery.handlePeerAnnouncement()
  weiter (zusaetzlich zum alten SkillManager). capActivation.close() im
  graceful shutdown. Discovery-Summary beim Startup geloggt.

### Skill Discovery — Der ioBroker-Moment (PR #110)

- **`packages/daemon/src/skill-discovery.ts`** (neu): Automatisiert den Flow
  Peer-Announcement → Neutrales Manifest installieren → Capability auto-activate
  → Claude-Code-Adapter triggern. Brücke zwischen dem alten SkillManager (Phase 3)
  und dem neuen agent-neutralen Format (PR #98). Trust-Model dokumentiert:
  Auto-Activate fuer gepaarte Peers, Approval-Gate fuer untrusted.
- 13 Tests (inkl. Path-Traversal-Regression + Re-Announcement-Idempotenz).
- CR Gemini Pro: 0 CRITICAL, 1x HIGH (Counter-Fix) + 2x MEDIUM (Path-Test,
  Trust-Model-Doku) + 1x LOW (Prompt bei Re-Announcement) — alle gefixt.

### Dokumentations-Update (PR #109)

- **README.md** aktualisiert auf v0.32 (Feature-Stand 2026-04-11, Architekturprinzipien)
- **docs/API-REFERENCE.md** neu erstellt (alle REST-Endpoints des Daemon)
- **SECURITY.md** erweitert (Reviews #86-#104, Compliance-Enforcement-Architektur)
- **TODO.md** aufgeraeumt (ADR-005 + Compliance-Check abgehakt)
- 4 Zombie-Worktrees entfernt (agitated-leavitt, angry-goldstine, lucid-sinoussi, recursing-newton — alle safe, 0 unmerged commits)

### Compliance Enforcement Infrastructure

- **PR #105** CI repariert: vitest-Pfad gefixt (packages/daemon statt root),
  Compliance-Gate-Job (prueft CHANGES.md + COMPLIANCE-TABLE.md), CI wrap-up
  Job als Required Status Check fuer Branch Protection.
- **PR #108** Workflow-Hardening: CODEOWNERS fuer Security-Pfade (vault, tls,
  identity, audit, pairing → @2000teddy Human Review), Pre-Commit Hook
  (scripts/install-hooks.sh), Bot-Approve Helper (scripts/bot-approve.sh).
- GitHub Branch Protection aktiviert: enforce_admins=true, Required Check CI,
  Required Review 1, CODEOWNERS Review required, no force push.

---

### Post-Paperclip Roadmap (ADR-007/008/009) — 9 PRs in 3 Phasen

Inspiriert durch die Paperclip-Analyse (BORG.md Methodik). Multi-Modell-Konsensus
(GPT-5.1 9/10, Gemini-2.5-Pro 8/10, Claude Opus 4.6 8/10).

#### Phase A — Governance Foundation (ADR-007)

- **PR #95** Activity-Log Entity-Model: `entity_type` + `entity_id` Spalten in audit_events + Peer-Sync-Parity + getEventsByEntity() Query. 12 Tests.
- **PR #96** Config-Revisions: before/after JSON-Snapshots bei jeder Konfigurationsaenderung, diffTopLevelKeys, rollback-ready. 10 Tests.
- **PR #97** Approval Gates: generischer Approval-Service (pending→approved/rejected), erster Use-Case: Peer-Join. 15 Tests.

#### Phase B — Dynamic Capabilities (ADR-008)

- **PR #98** Neutral Skill Manifest: agent-neutrales `~/.thinklocal/skills/<name>/manifest.json + SKILL.md` Format. 14+5 Tests.
- **PR #99** Claude Code Skill Adapter: erster Agent-Adapter, transformiert Manifest in Claude Code .md mit YAML-Frontmatter. 7 Tests.
- **PR #100** Capability Activation State: 4-State-Modell (discovered/active/suspended/revoked), automatische Aktivierung fuer signierte Skills von gepaarten Peers. 14 Tests.
- **PR #101** WebSocket Event Types: 8 neue Event-Typen (inbox:new, approval:*, config:changed, capability:*). 4 Tests.

#### Phase C — Execution Semantics (ADR-009 kondensiert)

- **PR #102** Execution-ID + Lifecycle-State: 5-State-Lifecycle (accepted→running→completed/failed/aborted), atomarer WHERE-Guard. 13 Tests.
- **PR #103** Goal-Context auf Sessions: goal, expectedOutcome, blockingReason, nextAction Felder + HISTORY.md-Sektion. 3 Tests.

#### Compliance-Catchup (PR #104)

Retroaktiver Gemini-Pro Batch-CR ueber alle 8 Module (#96-#103): **2× CRITICAL (Path-Traversal in skill-manifest + skill-adapter), 1× HIGH (TOCTOU Race in execution-state), 2× MEDIUM (metadata-merge, decode-logging)**. Alle CRITICALs und HIGHs sofort gefixt mit 5 Regression-Tests. COMPLIANCE-TABLE, CHANGES, 3 ADR-Dokumente, TODO, USER-GUIDE, SECURITY nachgeholt.

**Lektion gelernt:** 9 PRs in 17 Minuten ohne CR/PC/DO ist **kein Beweis fuer Effizienz, sondern fuer uebersprungene Qualitaets-Gates**. Zwei Security-Luecken (Path-Traversal) waeren ohne den retroaktiven CR unentdeckt geblieben. BORG.md wurde um eine Warnung ergaenzt.

---

#### PR #91 — ADR-005 Per-Agent-Inbox Phase 1 (SPIFFE 4-Komponenten + Schema-Migration)

Implementiert den letzten Baustein im ADR-004/005/006 Triptychon: mehrere
Agent-Instances (Claude Code, Codex, Gemini CLI) koennen sich denselben
Daemon teilen und behalten ihre eigene Inbox, ohne Nachrichten untereinander
zu sehen.

- **`packages/daemon/src/spiffe-uri.ts`** (neu) — strikte 3- vs 4-Komponenten
  SPIFFE-URI-Helper. `parseSpiffeUri`, `normalizeAgentId`, `getAgentInstance`,
  `buildInstanceUri`, `hasInstance`. Zentraler
  `SPIFFE_COMPONENT_REGEX = /^[A-Za-z0-9._-]+$/` fuer alle Parse- und Build-
  Pfade, importiert vom API-Layer fuer kohaerente Validation. 27 Unit-Tests.
- **`packages/daemon/src/agent-inbox.ts`** — Schema-Migration v1 → v2 via
  `PRAGMA user_version`. Neue Spalte `to_agent_instance TEXT NULL` + Index.
  Saubere Trennung: `createSchemaV2` fuer fresh-DBs, `migrateToV2` fuer
  bestehende v1-DBs. Beide idempotent. `store()` normalisiert `to` und
  extrahiert Instance-ID. `list()` / `unreadCount()` mit neuen `forInstance`
  + `includeLegacy` Parametern. Back-compat: `unreadCount(string)` bleibt
  funktional. 12 neue ADR-005-Tests.
- **`packages/daemon/src/inbox-api.ts`** — Loopback-Check gegen
  `normalizeAgentId(body.to) === ownAgentId` (GPT-5.4 Gotcha aus Konsensus
  2026-04-08 — 4-Komponenten-Targets fielen sonst durch auf den
  Remote-Peer-Pfad mit 404). Peer-Lookup nutzt normalisierte URI. Store-Pfad
  persistiert `to_agent_instance`. Neue Query-Parameter `for_instance` +
  `include_legacy` in `GET /api/inbox` und `GET /api/inbox/unread`.
  Zentraler `validateInstanceParam` Helper mit importiertem
  `SPIFFE_COMPONENT_REGEX`. 8 neue Fastify-Inject Tests.
- **`docs/architecture/ADR-005-per-agent-inbox.md`** — Status auf
  `Accepted, Phase 1 Implemented`, Impl-Block + Phase-2-Backlog.
- **`SECURITY.md`** — neuer Abschnitt "SPIFFE-URI 4-Komponenten-Form ist
  Application-Layer-Routing" mit Threat-Model, `normalizeAgentId` Pflicht-
  Pattern fuer alle Trust-Entscheidungen, SQL-Injection-Defense.

**Tests:** 61/61 neue Tests gruen (27 SPIFFE + 12 ADR-005 Inbox + 8 Fastify +
14 back-compat Inbox), 0 Regressionen, `tsc --noEmit` clean.

**Compliance:**
- CO: entfaellt (Konsensus aus PR #84, 2026-04-08)
- CG: entfaellt (Scope in 3 Layer strukturiert)
- TS: 61/61 gruen inkl. 8 SPIFFE-Injection-Regression + 3 CR/PC-Regression
- CR: pal:codereview Gemini Pro (security) — 0 HIGH/CRITICAL, 2× MEDIUM +
  1× LOW alle gefixt:
  - MEDIUM #1 → `SPIFFE_COMPONENT_REGEX` zentral, in `parseSpiffeUri` +
    `buildInstanceUri` durchgesetzt, 8 Injection-Regression-Tests
  - MEDIUM #2 → `init()` split in `createSchemaV2` + `migrateToV2`
  - LOW #3 → `validateInstanceParam` DRY helper
- PC: pal:precommit Gemini Pro — 1× HIGH (duplizierter Regex im DRY-Helper
  statt Import aus `spiffe-uri.ts`) — mid-fix **gefixt**: Helper importiert
  jetzt `SPIFFE_COMPONENT_REGEX`, kein zweiter Regex-Literal mehr im Code.
- DO: ADR-005 Status + SECURITY.md + CHANGES.md + COMPLIANCE-TABLE.md #111

---

#### PR #89 — ADR-006 Phase 1: Agent Session Persistence & Crash Recovery MVP

Supersedes #85 (Design-only). Liefert die 7 Kern-Module fuer Session-
Persistence + einen End-to-End Crash+Resume Integration-Test.

- **`packages/daemon/src/atomic-write.ts`**: write(tmp → fsync → rename)
  Helper. Single-Writer-Garantie fuer `state.json`, `HISTORY.md`,
  `START-PROMPT.md`. Swallows cleanup errors (kommentiert per CR).
- **`packages/daemon/src/session-events.ts`**: SQLite-backed append-only
  event store. WAL + `PRAGMA user_version` fuer Migration. Idempotente
  Inserts via `UNIQUE(instance_uuid, seq)`. Content-Hash pro Event.
- **`packages/daemon/src/session-state.ts`**: `state.json` TypeScript
  interface + `writeSessionState` / `readSessionState` / `isPidAlive`.
  Writes via atomic-write.
- **`packages/daemon/src/session-adapters/claude-code-adapter.ts`**:
  defensive jsonl-Parser fuer `~/.claude/projects/*/sessions/*.jsonl`.
  UTF-8 BOM-Strip, unknown types → silent skip, malformed JSON → silent
  skip. Mappt Claude-Code v2.1.x records auf `SessionEventType`.
- **`packages/daemon/src/recovery-generator.ts`**: DETERMINISTISCHER
  HISTORY.md Generator (kein LLM). Sektionen: Goals, Decisions,
  Files Touched, Commands Run, Errors, Next Actions (letzter
  TodoWrite), Recent Narrative mit UNTRUSTED-Markierung fuer
  Prompt-Injection-Defense.
- **`packages/daemon/src/session-watcher.ts`**: poll-basiertes
  (NICHT fs.watch) tail-ingest. `tick(path, state)` mit in-memory
  Promise-Lock pro `instanceUuid` gegen Race Conditions. Liest
  `state.json` unter dem Lock neu als authoritative source. Returns
  `newState` immutable (keine Input-Mutation). Defers half-written
  tail lines bis newline ankommt.
- **`packages/daemon/src/session-binding.ts`**: Orphan-Scan (kill -0)
  + Fingerprint-Matching auf `(cwd, gitBranch, agentType)`. Liefert
  0/1/N orphans — caller entscheidet. Injectierbarer `isAlive` fuer Tests.
- **`tests/integration/session-recovery.test.ts`**: vollstaendiger E2E-
  Flow: Agent start → jsonl grows → watcher ingests → HISTORY.md
  generated → Agent "crashes" (pid=99999) → Binding findet Orphan →
  neuer Agent nimmt pid ueber → mehr Turns → weiter-Ingest.

#### Tests

53/53 neue Tests gruen, 0 Regressionen, `tsc --noEmit` clean.
- 6 atomic-write (incl. concurrent writers)
- 6 session-events (idempotent inserts, persistence)
- 4 session-state (round-trip, isPidAlive edge cases)
- 13 claude-code-adapter (incl. BOM regression)
- 10 recovery-generator (incl. determinism check)
- 8 session-watcher (incl. concurrent tick lock regression + newState contract)
- 5 session-binding (fingerprint matching, deterministic isAlive)
- 1 integration (crash+resume E2E)

#### Compliance

- CO: entfaellt (Design-Konsensus in ADR-006 aus PR #85, 2026-04-08)
- CG: entfaellt (Scope teilweise per Divide-and-Conquer abgeleitet,
  Layer-basierte Implementation mit Tests parallel zu jedem Modul)
- TS: 53/53 gruen inkl. 3 Regression-Tests fuer CR-Findings
- CR: `pal:codereview` Gemini Pro (security focus) — 0 CRITICAL,
  2× HIGH (watcher race, isPidAlive PID-reuse), 2× MEDIUM (BOM,
  UNTRUSTED marker doc), 2× LOW (state mutation, cleanup errors) —
  alle adressiert:
  - HIGH #1 → Per-instance Promise-Lock im Watcher selbst
  - HIGH #2 → Dokumentiert in ADR-006 §Bekannte Limitierungen
  - MEDIUM #3 → UTF-8 BOM strip im adapter + Regression-Test
  - MEDIUM #4 → Pflicht-Doku fuer resumierende Agents in ADR-006
  - LOW #5 → `newState` im IngestResult + immutable contract
  - LOW #6 → Kommentar an swallowed cleanup errors
- PC: `pal:precommit` Gemini Pro — 1× MEDIUM (State mutation
  anti-pattern) — vollstaendig entfernt: Watcher ist jetzt strict
  immutable. Watcher liest `state.json` unter dem Lock neu als
  authoritative source fuer concurrent callers.
- DO: ADR-006 Phase 1 Impl-Block + `Bekannte Limitierungen` +
  CHANGES.md + COMPLIANCE-TABLE.md Zeile #110

---

#### PR #88 — ADR-004 Phase 2 Agent Registry REST API

- **`packages/daemon/src/agent-registry.ts`**: in-memory Agent-Instance Tracking.
  `register`/`heartbeat`/`unregister`/`sweep`/`listeners` mit deterministisch
  injectierbarem Clock + `setInterval`/`clearInterval`-Shim. Stale-Eviction
  nach `3 × heartbeatIntervalMs`. Hard-Cap `maxEntries = 1000` mit dedizierter
  `AgentRegistryFullError` gegen DoS durch lokale Clients.
- **`packages/daemon/src/agent-api.ts`**: Fastify-Plugin mit vier
  loopback-only Endpoints: `POST /api/agent/register` (4-Komponenten-SPIFFE-URI,
  409 Conflict, 503 wenn voll, 500 bei malformed Daemon-URI), `POST /api/agent/heartbeat`
  (404 → Client re-registriert), `POST /api/agent/unregister` (idempotent),
  `GET /api/agent/instances` (read-only). Strict Regex-Validation `[A-Za-z0-9._-]+`,
  `requireLocal()` Pattern aus PR #83.
- **`packages/daemon/src/audit.ts`**: 4 neue AuditEventType — `AGENT_REGISTER`,
  `AGENT_HEARTBEAT`, `AGENT_UNREGISTER`, `AGENT_STALE`.
- **`packages/daemon/src/index.ts`**: Wire-up mit `start()`/`stop()` im
  Daemon-Lifecycle.
- **ADR-004** Status: "Accepted, Phase 1 + Phase 2 Implemented".

#### Tests

34 neue Tests gruen (19 Registry Unit + 15 API Integration via `fastify.inject()`),
0 Regressionen, `tsc --noEmit` clean.

#### Compliance

- CO: entfaellt (Design-Konsensus aus PR #84)
- CG: entfaellt (kleiner Scope, Code direkt)
- TS: 34/34 gruen inkl. 6 Regression-Tests fuer alle Review-Findings
- CR: `pal:codereview` Gemini Pro — 0 HIGH/CRITICAL, 1× MEDIUM (maxEntries DoS-Cap) + 2× LOW (heartbeat race, SPIFFE-URI silent fallback) — alle gefixt
- PC: `pal:precommit` Gemini Pro — 1× MEDIUM (unregister race analog zum heartbeat-Fix) — gefixt mit Regression-Test
- DO: ADR-004 Status-Update + CHANGES.md + COMPLIANCE-TABLE.md Zeile #109

---

#### PR #86 — ADR-004 Phase 1 Cron-Heartbeat (2026-04-09)
- **`packages/daemon/src/heartbeat/interval.ts`**: pure-function adaptive Backoff
  + ±20 % Jitter Modul. `nextInterval(state, hadMessages, mode)` mit
  exponentiellem Backoff bis zum mode-spezifischen Cap, `applyJitter(intervalMs, rng?)`
  fuer Anti-Thundering-Herd. Mode-Tabelle aus ADR-004 (`local`/`lan`/`federated`/`adhoc`).
  11 Unit-Tests.
- **`packages/cli/src/thinklocal-heartbeat.ts`**: neuer Subcommand
  `thinklocal heartbeat show|status|help`. `show` druckt die zwei Cron-Prompts
  aus `docs/agents/{inbox,compliance}-heartbeat.md` zum Reinpasten in
  `CronCreate` der Agent-Harness. `status` liest und pretty-printed
  `~/.thinklocal/heartbeat.json`. 8 Unit-Tests inkl. Regression fuer JSON-Parse.
- **`tests/integration/heartbeat-loop.test.ts`**: simuliert die Heartbeat-Loop
  gegen eine Mock-Inbox und verifiziert die ADR-konforme Pattern
  `[5s, 10s, 20s, 5s, 5s]`.
- **`docs/agents/inbox-heartbeat.md`** + **`compliance-heartbeat.md`**:
  Cron-Prompt-Bodies fuer Inbox-Polling (5 s, adaptiv) und Compliance-Check
  (5 min, fix). Beide mit Early-Return und Read-Only-Constraints.
- **ADR-004** Status: `Proposed → Accepted, Phase 1 Implemented`.
- **USER-GUIDE.md** Section 8a "Cron-Heartbeat aktivieren" mit Schritt-fuer-Schritt
  Anleitung fuer Claude Code, Codex, Gemini CLI.

### Konsensus-Entscheidungen umgesetzt

- Polling-Jitter ±20 % (GPT-5.4 Anti-Thundering-Herd)
- Inbox- und Compliance-Heartbeat als getrennte Cron-Jobs (GPT-5.4 Separation of Concerns)
- Adaptive Backoff nur fuer Inbox, Compliance fix
- Inbox-Prompt mit Early-Return zur Context-Budget-Schonung

### Code Review (Gemini Pro, 2026-04-09)

0 HIGH/CRITICAL. 2× MEDIUM (REPO_ROOT brittleness, cmdStatus JSON parsing) + 1× LOW
(unnoetiges async) — alle drei adressiert: Kommentar bei REPO_ROOT, JSON pretty-print
mit Fallback fuer cmdStatus (+ 2 Regression-Tests), `async` bewusst beibehalten fuer Phase 2.

### Tests

20/20 neue Tests gruen, 0 Regressionen in der bestehenden Suite (200 Tests bleiben gruen,
12 pre-existing better-sqlite3 Load-Failures unveraendert — separates Infra-Issue).

### Behoben

#### PR #87 — Socket-Pool-Fix fuer langlaufenden MCP-Stdio-Subprocess (Bug-Fix)

- **`packages/daemon/src/local-daemon-client.ts`**: bisher wurde bei **jedem**
  `requestDaemon`-Call ein neuer `HttpsAgent` ohne `keepAlive` erzeugt. In
  einem langlaufenden mcp-stdio-Subprocess (der die ganze Claude-Code-Session
  am Leben bleibt) fuehrte das zu Socket-Pool-Exhaustion: TIME_WAIT-Akkumulation,
  ungepoolte TLS-Handshakes, haengende Sockets ohne Timeout-Trigger. Symptom
  nach ~4 h: **`socket hang up`** auf jeden MCP-Tool-Call, obwohl der Daemon
  einwandfrei laeuft (siehe PR #86 Live-Test-Follow-Up).
- **Fix**: globaler `HttpsAgent`-Cache pro `dataDir` mit `keepAlive: true`,
  `maxSockets: 50`, `maxFreeSockets: 10`, `scheduling: 'lifo'`. Invalidierung
  ueber `mtime`-Fingerprint der Trust-Material-Dateien (`ca.crt.pem`,
  `paired-peers.json`, Client-Certs); bei Rotation wird der alte Agent mit
  `agent.destroy()` sauber abgebaut und ein neuer aufgebaut. Trust-Bundle
  wird nicht mehr bei jedem Call neu gelesen.
- **`packages/daemon/src/mcp-stdio.ts`**: Graceful-Shutdown-Handler fuer
  `SIGTERM`/`SIGINT`/`SIGHUP`/`exit`. Rufen `__resetDaemonClientCache()` und
  exiten mit dem 128+signal-Code (`SIGINT` → 130, `SIGTERM` → 143,
  `SIGHUP` → 129), damit Supervisor (launchd, systemd) das Ende korrekt
  einordnen. Verhindert die Zombie-Subprocesses, die `ps aux | grep mcp-stdio`
  zuletzt als >19 h alte Hangs gezeigt hat.
- **`packages/daemon/src/local-daemon-client.test.ts`** (neu): 5 Regression-Tests:
  100 sequenzielle HTTP-Requests ohne Leak, HTTP-only-Pfad ohne Cache-Entry,
  HTTPS-Cache genau 1 Entry nach mehreren Calls zum selben `dataDir`,
  Cache-Invalidierung bei `mtime`-Aenderung, `__resetDaemonClientCache` leert
  komplett.

#### Konsequenzen

- ADR-004 Phase 1 (PR #86) ist in der Praxis erst mit diesem Fix nutzbar.
- Erkenntnis aus Live-Test: **Memory-Hinweis `mcp_subprocess_staleness.md`
  war halb richtig** — der Fix ist kein Thin-Client-Rewrite, sondern ein
  5-Zeilen-Architektur-Bug (fehlender keepAlive + fehlendes Pooling). Kein
  ADR-007 noetig.

#### Compliance

- CG: entfaellt (Bug-Fix, keine neue API)
- TS: 5/5 Tests gruen, 0 Regressionen
- CR: `pal:codereview` (Gemini Pro) — 0 HIGH/CRITICAL, 1× MEDIUM + 3× LOW, alle gefixt
- PC: `pal:precommit` (Gemini Pro) — 1× CRITICAL (Race) als False-Positive
  via `pal:challenge` bestaetigt (Funktion ist vollstaendig synchron,
  atomisch im Node Event-Loop — defensiver Kommentar eingebaut), 1× HIGH
  (Exit-Code) gefixt
- DO: CHANGES.md + COMPLIANCE-TABLE.md (neue Zeile #108)

---

## [0.31.0] — 2026-04-08 09:50 UTC

**Mesh-Live-Session: 4 Nodes verbunden, Agent-zu-Agent Messaging funktioniert.**

### Hinzugefuegt

#### PR #79 — Agent-to-Agent Messaging (2026-04-08 06:47 UTC)
- **`agent-inbox.ts`**: SQLite-basierter Inbox-Store (`~/.thinklocal/inbox/inbox.db`, WAL), 64 KB Body-Limit, Dedupe via UUID, soft read/archive Flags, Filter (unread/from/limit/include_archived), `unreadCount()`. 14 neue Tests.
- **`messages.ts`**: Neue MessageTypes `AGENT_MESSAGE` + `AGENT_MESSAGE_ACK` mit Payload-Interfaces. Beide signiert via Mesh-Envelope, ueber CBOR transportiert.
- **`inbox-api.ts`**: REST-Endpoints `POST /api/inbox/send`, `GET /api/inbox`, `POST /api/inbox/mark-read`, `POST /api/inbox/archive`, `GET /api/inbox/unread`. Send-Pfad baut signierten Envelope und schickt ihn via mTLS an den Ziel-Peer.
- **MCP-Tools** (in `mcp-stdio.ts`): `send_message_to_peer`, `read_inbox`, `mark_message_read`, `archive_message`, `unread_messages_count` — direkt von Codex/Claude CLI nutzbar.
- **AuditEventTypes**: `AGENT_MESSAGE_RX`, `AGENT_MESSAGE_TX`.

#### PR #80 — Loopback fuer Same-Daemon Sibling-Agents (2026-04-08 07:14 UTC)
- **Loopback-Pfad** in `inbox-api.ts`: Wenn `body.to === ownAgentId` (mehrere Agenten teilen einen Daemon), wird die Nachricht direkt im lokalen Inbox abgelegt statt ueber Netzwerk geroutet. Erlaubt Claude ↔ Codex auf demselben Host.
- **`delivery`-Feld** in der Send-Response: `"loopback"` oder `"remote"`.
- **`onSent`-Hook** fuer `AGENT_MESSAGE_TX`-Audit, beide Pfade.

#### PR #75 — SPAKE2 Trust-Store Integration (2026-04-07 17:13 UTC)
- **`trust-store.ts`**: `buildTrustedCaBundle()` aggregiert eigene CA + alle CAs gepairter Peers. `TrustStoreNotifier` als Observer fuer spaetere Hot-Reload.
- **`agent-card.ts`**: Neue `trustedCaBundle: string[]` Option fuer Fastify-HTTPS `ca`-Parameter. Fallback auf eigene CA fuer backwards-compat.
- **`index.ts`**: PairingStore wird vor Fastify/undici angelegt, das aggregierte Bundle fliesst in beide.
- **10 neue trust-store Tests.**

#### PR #74 — Daemon Usability Bundle (2026-04-07 17:13 UTC)
- **`scripts/health-check.sh`**: mTLS-aware Health-Check mit 3 Fallbacks (mTLS+ClientCert → HTTPS-k → HTTP). 3s-Timeout. Loest "Daemon nicht erreichbar"-Fehlmeldung obwohl HTTPS-Daemon laeuft.
- **`scripts/check-native-modules.cjs`**: postinstall-Hook (root + daemon), erkennt `NODE_MODULE_VERSION`-Mismatch nach Node-Upgrade und macht automatisch `npm rebuild better-sqlite3`. Verhindert ABI-Crash-Loop.
- **Stable Node-Identity** (`identity.ts`): Neue `loadOrCreateStableNodeId()` aus 16-hex Hardware-Fingerprint (sortierte MACs + CPU + Plattform), persistiert in `keys/node-id.txt`. SPIFFE-URI ist jetzt `host/<stableNodeId>/agent/<type>` statt `host/<hostname>`. Loest "Hostname-Drift" auf macOS, wo Bonjour bei Kollisionen den Hostname dynamisch aendert. **11 neue Tests.**
- **`scripts/service/service.sh`**: launchd-Wrapper fuer macOS (bootstrap/bootout, Logs nach `~/Library/Logs/thinklocal-mcp/`, Subcommands install/start/stop/restart/status/logs/errors).

#### PR #73 — Codex Sandbox (Cherry-Pick) (2026-04-06 18:23 UTC)
- **`sandbox.ts`**: WASM-Pfad via `wasmtime --dir`, Docker-Fallback via `docker run --read-only --network none --memory --cpus 1 --pids-limit 64`. SKILL_INPUT_BASE64-Contract.
- **Security-Fix**: `isPathAllowed()` nutzt `path.relative()` statt `startsWith()` (loest `/skills-evil/`-Bypass).
- **TypeScript-Folgefix**: `as ChildProcessWithoutNullStreams` → `ChildProcessByStdio<null, Readable, Readable>` (TS2352).

#### PR #76 — Codex Deno Sandbox (Cherry-Pick) (2026-04-07 18:30 UTC)
- **`sandbox.ts`**: `runtime=deno` ueber `deno run --no-prompt` mit expliziten `--allow-*`-Flags und lokalem `DENO_DIR` im Skill-Verzeichnis. Drittes Sandbox-Backend nach Node und WASM.

#### PR #78 — SSH-Bootstrap-Trust-Script (2026-04-07 19:05 UTC)
- **`scripts/ssh-bootstrap-trust.sh`**: Nutzt bestehenden SSH-Trust zwischen Operator-eigenen Nodes statt manuelle PIN-Zeremonie. ssh-Reachability + base64-encoded JSON via stdin (vermeidet Newline/Quoting-Issues mit mehrzeiligen PEM-Strings). Idempotent (jq upsert by agentId). Backwards-kompatibel: Legacy-Hostname-Fallback wenn Peer noch keine `node-id.txt` hat.

### Sicherheits-Fixes (kritisch)

#### PR #77 — CA Subject DN Collision Fix (2026-04-07 19:03 UTC)
**Cross-Node mTLS Blocker.** Jede ThinkLocal-Node generierte ihre CA mit dem **identischen** Subject DN `CN=thinklocal Mesh CA, O=thinklocal-mcp`. Wenn der Trust-Store mehrere CAs mit gleichem Subject enthielt (eigene + gepairte Peer-CAs), pickte OpenSSL/Node.js beim Issuer-Name-Lookup die ERSTE passende CA — nicht die mit dem richtigen Public-Key. Resultat: `certificate signature failure` selbst wenn die richtige CA im Bundle lag.

PR #75 (TrustStore-Aggregation) war damit zwar **strukturell korrekt** aber funktional **wirkungslos**, bis dieser Fix kam.

- **`createMeshCA(meshName, nodeId?)`**: nodeId fliesst in CN ein → `CN=thinklocal Mesh CA <nodeId>`. Ohne nodeId: 16-hex Random-Suffix als Fallback fuer Tests.
- **`loadOrCreateTlsBundle(..., nodeId?)`**: Migration detektiert Legacy-CAs (`CN === "thinklocal Mesh CA"`), sichert sie als `*.legacy.pem` und reissued CA + Node-Cert.
- **`index.ts`**: uebergibt `identity.stableNodeId` an `loadOrCreateTlsBundle`.
- **Live-verifiziert**: `certificate signature failure` → `other side closed` (TLS-Verify funktioniert) → voller bidirektionaler Handshake nach Peer-Deploy.

#### PR #103 (GitHub #81) — Compliance Catchup + Retro-Review-Findings (2026-04-08 09:50 UTC)
**GPT-5.4 retroaktiver Security-Review von PR #77 fand 1 HIGH + 4 MEDIUM/LOW.** Alle gefixt:
- **HIGH**: Node-Cert Reuse-Pfad ohne Signatur-Verifikation gegen aktuelle CA. Ein partial-migration-crash konnte ein Cert hinterlassen, das nicht mehr von der aktuellen CA signiert war aber zufaellig die SPIFFE-URI matchte. Jetzt: try/catch + caCert.verify(cert) check.
- **MEDIUM**: Keine CA-Validity-Window-Pruefung beim Laden. Jetzt: `notBefore <= now <= notAfter` Check, sonst reissue.
- **LOW**: `getCertDaysLeft()` zeigte auf falschen Pfad (`certs/node.crt` statt `tls/node.crt.pem`). Startup-Warnings fuer ablaufende Certs feuerten nie.

### Live-Mesh-Status

| Node                   | IP             | Plattform     | Stable Node-ID     | Rolle                       |
|------------------------|----------------|---------------|--------------------|------------------------------|
| MacMini (mein)         | 10.10.10.94    | macOS arm64   | `69bc0bc908229c9f` | Daemon + Claude Code + Codex |
| influxdb               | 10.10.10.56    | Ubuntu x64    | `68f7cd8e330acfe3` | Daemon + InfluxDB-Skill      |
| ai-n8n-local           | 10.10.10.222   | Linux x64     | `e7aeb01312e25b42` | Daemon + n8n                 |
| MacBook Pro            | 10.10.10.55    | macOS arm64   | `813bdd161fea12ab` | Daemon                       |

**Erste echte Mesh-Nachricht** am 2026-04-08 06:59:31 UTC: MacMini → influxdb → Reply zurueck mit korrektem Threading via `in_reply_to`.

### Compliance-Bruch und Aufarbeitung

PRs #95-#102 (GitHub #73-#80) wurden ohne `pal:codereview` und ohne `pal:precommit` gemerged — die in COMPLIANCE-TABLE.md am 2026-04-06 verbindlich gemachten Regeln wurden nicht eingehalten. Aufarbeitung:
- Retroaktiver Review fuer den sicherheitskritischsten PR (#77) durch GPT-5.4 — siehe Findings oben
- Findings sofort gefixt in PR #103 (HIGH und 2 MEDIUM)
- 3 verbleibende Eintraege (#100, #101, #102) sind funktional unkritisch (Bash-Script, isolierter Code-Pfad, Bug-Fix-Patch) — in Folge-Batch-Review
- COMPLIANCE-TABLE.md aktualisiert mit neuer Gesamtstatistik (92% statt 100%)

---

## [0.30.0] — 2026-04-05 22:22 UTC

### Hinzugefuegt
- **Unix-Socket-Optimierung**: `unix-socket.ts` — Server+Client fuer Same-Host-Agents, Framed Protocol (4-Byte Length + JSON), FrameBuffer mit Max-Message-Size-Schutz, ~30% weniger Latenz als TCP
- **CLI-Adapter-Konfiguration**: `cli-adapters.ts` — Setup-Generatoren fuer Codex CLI, Gemini CLI, Claude Desktop, Claude Code
- **`thinklocal setup`-Kommando**: Konfiguriert AI-Tools (`thinklocal setup codex|gemini|claude-desktop|claude-code|all`)
- **`thinklocal remove user@host`**: Remote-Deinstallation via SSH mit `--purge` Option
- **Homebrew-Formel**: `Formula/thinklocal.rb` mit launchd-Service, 3 Binaries (thinklocal, tlmcp-daemon, tlmcp-mcp)
- **`.deb`-Paket**: `scripts/build-deb.sh` mit systemd-Service und Sicherheitshaertung
- **Docker Compose**: `docker-compose.yml` 3-Node Test-Umgebung mit eigenem Bridge-Netzwerk
- **GraphQL-Schema-Doku**: `docs/GRAPHQL-SCHEMA.md` mit Beispiel-Queries und Subscriptions
- **Release-Checksums**: SHA256SUMS.txt + Archive + .deb in GitHub Release
- **Security-Tests**: 20 Tests (Replay, TTL, ECDSA, Path-Traversal, Rate-Limit, QR-Token)
- **QR-Code Pairing**: `qr-pairing.ts` — 32-Byte Token als Alternative zur 6-stelligen PIN
- **JWT Token-Refresh**: `api-auth.ts` — `/api/auth/refresh` Endpoint

### Verbessert
- **mesh-client.ts**: Exponential Backoff (Jitter) fuer transiente HTTP-Fehler (5xx, 429)
- **graphql-api.ts**: Subscription Queue-Limit (100), Idle-Timeout (5min), Handler-Leak-Fix
- **policy.ts**: matchesPattern-Dokumentation mit Beispielen und Limitierungen
- **release.yml**: Security-Tests + .deb-Build + Archive-Checksums im CI
- **Task-Router**: Zufaelliger Tiebreak bei gleichem Score

### Tests (Neu)
- 20 Security-Tests, 13 Unix-Socket-Tests, 7 CLI-Adapter-Tests
- Gesamt: 300+ Tests

---

## [0.29.0] — 2026-04-05 20:50 UTC

### Hinzugefuegt
- **CRL (Zertifikat-Widerrufsliste)**: `crl.ts` — revoke/isRevoked/list + JSON-Persistenz
- **Deploy --with-ca**: CA-Zertifikat-Transfer fuer mTLS-Trust ueber SSH
- **Multi-Step-Task-Chains**: `task-chain.ts` — sequenzielle Ausfuehrung mit Result-Forwarding
- **Version-Kompatibilitaet**: `version-compat.ts` — Feature-Matrix + Graceful Degradation
- **Recovery-Flows**: `recovery.ts` — Auto-Recovery (Cert, Port, Hostname, DB-Integrity)
- **Threat Model**: `docs/THREAT-MODEL.md` — Angreifer-Profile, Angriffsvektoren, Trust-Grenzen
- **Entwicklerhandbuch**: `docs/DEVELOPER-GUIDE.md` — Skills, Adapter, API, Events, Policies
- **Benutzerhandbuch**: `docs/USER-GUIDE.md` — 10 Sektionen
- **Dockerfile**: Multi-Stage Build + Release-Workflow

### PRs #58-#64 (7 PRs)
- Phase 4: Task-Chains (#62), Approval-Gates + Task-Queue (#56), Skill-Dependencies (#57)
- Phase 6: Deploy CA-Transfer (#63), Recovery-Flows (#60), Version-Compat (#61)
- Docs: User-Guide + Dev-Guide + Threat-Model + Dockerfile (#58, #59)
- CRL + Vector Clocks (#64)

---

## [0.28.0] — 2026-04-05

### Hinzugefuegt
- **Benutzerhandbuch**: `docs/USER-GUIDE.md` (10 Sektionen)
- **Entwicklerhandbuch**: `docs/DEVELOPER-GUIDE.md` (Skills, Adapter, API, Events)
- **Threat Model**: `docs/THREAT-MODEL.md` (Assets, Angreifer, Vektoren, Trust-Grenzen)
- **Dockerfile**: Multi-Stage Build (node:22-slim + avahi)
- **Release-Workflow**: Automatischer GitHub Release bei v* Tags
- **Approval-Gates**: Konfigurierbare auto/approve/deny pro Skill-Pattern
- **Task-Queue**: Priorisierte Warteschlange (5 Levels, max Parallelitaet)
- **Skill-Dependencies**: checkDependencies + topologische Sortierung
- **Recovery-Flows**: Auto-Recovery fuer Cert-Expiry, Port-Konflikte, Hostname, DB-Corruption

### Statistik Tag 2 (2026-04-05)
- 23 PRs (#38-#60)
- Phase 2: KOMPLETT abgeschlossen
- Phase 3: 67% erledigt (WASM/Docker offen)
- Phase 4: 30% erledigt
- 3 Nachholreviews durchgefuehrt (1 CRITICAL Shell-Injection gefixt!)
- 5 neue Dokumentations-Dateien
- ~120 neue Tests

---

## [0.27.0] — 2026-04-05

### Phase 2 abgeschlossen
- Worker-Auslastung in Agent Card (active/completed/failed/load_percent)
- Capability-Freshness-Tracking (markStaleCapabilities)
- Coordinator-Node-Wahl (aeltester Node)
- OpenAPI 3.0.3 Spec (docs/openapi.yaml)

### Phase 3 Fortschritt (8/12 Items)
- **Credential Revocation**: revoke/isRevoked/listRevoked + revoked_credentials Tabelle
- **Brokered Access**: executeBrokered() — Proxy ohne Secret-Exposure
- **Shamir's Secret Sharing**: splitSecret/combineShares (K-von-N Threshold)
- **Skill Rollback**: Backup/Restore bei fehlgeschlagener Installation
- **Policy Verteilung + Versionierung**: exportForSync/importFromPeer/getVersion/save
- **Skill-Sandbox**: fork()-basierte Isolation mit Timeout, Memory-Limit, Netzwerk-Flag, Path-Traversal-Schutz

---

## [0.26.0] — 2026-04-05

### Hinzugefuegt
- **SemVer-Versionierung**: Leichtgewichtiges SemVer-Modul (parse, compare, range, compatible) ohne npm-Dependency
- **Task-Router**: Score-basiertes Capability-Matching (exakt +100, health +30, lokal +20, CPU +10)
- **SSH Remote-Deploy**: `thinklocal deploy user@host` mit --dry-run und --with-env

### Behoben (Nachholreviews PR #39-#51)
Retroaktive Code Reviews fuer 13 PRs die ohne Review gemergt wurden:
- **CRITICAL: Shell-Injection in keychain.ts** (GPT-5.1) — `execSync("cmd ${var}")` → `execFileSync('cmd', [args])`. Unsanitierte Parameter konnten beliebige Shell-Befehle ausfuehren!
- **HIGH: Toast Timer-Leak** (Gemini 2.5 Pro) — useEffect cleanup loeschte nur den letzten Timer. Bei schnellen Events blieben Timer aktiv. Fix: useRef Map fuer alle Timer-IDs
- **MEDIUM: JWT-Secret in Plaintext-Datei** (Gemini 2.5 Pro) — Secret wird jetzt bevorzugt im OS-Keychain gespeichert (macOS Keychain / Linux libsecret), Datei nur als Fallback
- **MEDIUM: CSS !important Overrides** (Gemini 2.5 Pro) — Desktop-first CSS Pattern, keine !important mehr
- **LOW: Schema-Cache-Hash** — SHA-256 statt truncated JSON (verhindert Cache-Kollision)
- **LOW: Audit-Dedup** — INSERT OR IGNORE changes statt separatem SELECT
- **LOW: Accessibility** — aria-label + aria-expanded auf Hamburger-Button

### Code Reviews (5 Reviews heute)
- Gemini 2.5 Pro: Dashboard UI (PR #39+#40)
- GPT-5.1: Security Review Daemon Core (PR #42-#47) — Shell-Injection gefunden!
- Gemini 2.5 Pro: GraphQL, JWT, Router, SemVer (PR #48-#51)

### Sonstiges
- **install.sh**: Node-Mindestversion auf v22 angehoben (undici braucht >=22.19)
- **PR-Checkliste**: Neue Pflicht-Checkliste in Memory-Files (Review, Precommit, Tests vor jedem Merge)

---

## [0.25.0] — 2026-04-05

### Hinzugefuegt
- **Security Docs**: Detaillierte Bedrohungsanalyse fuer Root-Compromise, Bootstrap-Trust, Prompt Injection (SECURITY.md)
- **Protocol Contract Tests**: 15 Tests fuer Wire Protocol (Envelope, Signatur, TTL, CBOR, Cross-Agent)
- **I/O Schema Validation**: @cfworker/json-schema fuer Task-Input/Output Validierung
- **AUDIT_EVENT Mesh-Sync**: peer_audit_events Tabelle fuer Mesh-weite Audit-Synchronisation
- **Adapter-Abstraktionsschicht**: MeshDaemonClient + BaseHttpMeshAdapter fuer AI-CLI-Adapter
- **Skill-Manifest-Schema**: JSON Schema mit 9 Pflichtfeldern, Permissions, Kategorien, Runtimes
- **OS-Keychain-Integration**: macOS Keychain + Linux libsecret (Shell-Out, kein native Build)
- **ESLint + Prettier**: Linting-Setup mit Flat Config

### Code Reviews (6 heute)
- GPT-5.1: Telegram Gateway, Architektur-Konsensus Deploy, Adapter-Design, Keychain-Empfehlung, Schema-Lib-Empfehlung
- Gemini 2.5 Pro: Static Peers + Gossip, Deploy Command

---

## [0.24.0] — 2026-04-05

### Hinzugefuegt
- **Dashboard Toast-Notifications**: Peer join/leave, Task complete/fail, System start/stop — auto-dismiss, max 5, slide-in Animation
- **Wire Protocol Specification v1.0**: Vollstaendige Dokumentation in `docs/WIRE-PROTOCOL.md` (Envelope, Gossip, Heartbeat, Pairing, 16 Nachrichtentypen)

---

## [0.23.0] — 2026-04-05

### Hinzugefuegt
- **SSH Remote-Deploy**: `thinklocal deploy user@host` — Deployment auf Linux-Server mit --dry-run und --with-env (Architektur-Konsensus GPT-5.1 + Gemini 2.5 Pro)
- **Dashboard Responsive**: Hamburger-Menu auf Mobile (<768px), Slide-Sidebar, Touch-Overlay

### Code Reviews
- Gemini 2.5 Pro: Deploy Command (host-match fix, ssh LogLevel, gossip response filter)
- Gemini 2.5 Pro: Static Peers + chatId + Gossip

---

## [0.22.0] — 2026-04-05

### Hinzugefuegt
- **Dashboard Dark/Light Mode**: Toggle in Sidebar, CSS-Variablen fuer beide Themes, Badge-Farben angepasst, Praeferenz in localStorage persistiert
- **Statische Peer-Liste**: Konfigurierbar in `daemon.toml` oder via `TLMCP_STATIC_PEERS` Env-Variable — ermoeglicht Mesh ueber VPN/Subnetz-Grenzen ohne mDNS
- **Telegram chatId-Persistenz**: Gespeichert in `~/.thinklocal/telegram-chat-id` — kein `/start` mehr noetig nach Daemon-Restart

### Behoben
- **Gossip Hash-Mismatch** (Code Review Gemini 2.5 Pro): Hash wird jetzt nur ueber eigene Capabilities berechnet — verhindert unnoetige Sync-Zyklen
- **Gossip Stale-Capability-Relay**: Offline-Peers werden aus Registry entfernt, Gossip sendet nur eigene Capabilities
- **Telegram Markdown V1**: Hyphens nicht mehr escaped (nur V2 braucht das)
- **Bootstrap Service-Update**: Aktualisiert bestehende launchd/systemd Services statt zu skippen
- **Static Peers**: Parallele Verbindung via Promise.allSettled + dynamisches Protokoll

### Code Reviews
- GPT-5.1: Telegram Gateway Hardening (PR #38)
- Gemini 2.5 Pro: Statische Peers + chatId + Gossip Fix

---

## [0.21.0] — 2026-04-04

### Behoben (Code Review GPT-5.1)
- **Telegram Gateway Hardening**: Markdown-Escaping, Chat-ID Allowlist (`TELEGRAM_ALLOWED_CHATS`), Rate-Limiting pro Befehl, Anchored Regex, Error-Logging, res.ok-Check, EventBus Listener Cleanup, 429 Rate-Limit Handling
- **mDNS IP-Aufloesung**: Discovery bevorzugt IPv4-Adresse aus mDNS addresses[] statt Hostname (fixt `ENOTFOUND influxdb` — bare Hostnames ohne `.local` nicht aufloesbar)
- **Service-Umgebungsvariablen**: CLI liest `.env` und fuegt TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHATS, INFLUXDB_* automatisch in launchd-plist und systemd-Unit ein

---

## [0.1.0] — 2026-04-03 14:30 UTC

### Hinzugefügt
- **Projektinitialisierung**: Repository-Struktur, README.md, CHANGES.md, TODO.md, CONTRIBUTING.md, SECURITY.md
- **Architektur-Entwurf**: Kombination aus MCP (Nov 2025 Spec) + A2A Agent Cards für lokale Mesh-Kommunikation
- **Sicherheitskonzept**: mTLS mit lokaler CA, TOFU-Enrollment, PKI Envelope Encryption für Credential Sharing
- **Skill-System-Spezifikation**: Portables MCP-Server-Manifest-Format für Skill-Austausch zwischen Nodes
- **Agent Card Schema**: Erweiterte A2A-kompatible Agent Card mit Health, Mesh-Status und Capability-Listen
- **Dashboard-Konzept**: Chronograf-inspirierte Visualisierung mit Topologie-Graph, Health-Panels, Skill-Marketplace
- **Bedrohungsmodell**: Dokumentation von 7 Bedrohungsszenarien mit Gegenmaßnahmen
- **Branch-Strategie**: Multi-Agenten-Workflow mit `agent/<n>/<task>` Branch-Konvention
- **Tech-Stack**: TypeScript/Node.js, React/Next.js, JSON-RPC 2.0, tweetnacl-js
- **TODO**: 6-Phasen-Implementierungsplan mit ~120 Aufgaben

### Architektur-Entscheidungen
- MCP + A2A statt Custom-Protokoll (Ökosystem-Kompatibilität, Nov 2025 Spec hat Tasks + Sampling)
- TypeScript statt Python als Hauptsprache (MCP SDK-Unterstützung, Node.js native mDNS)
- Ed25519 statt RSA (schneller, kleinere Schlüssel, moderne Kryptografie)
- TOFU statt Pre-Shared Keys (bessere UX, akzeptables Risiko im LAN)
- JSON-RPC 2.0 über HTTPS statt gRPC (MCP/A2A-kompatibel, einfacher zu debuggen)

### Multi-Modell-Konsensus (6 Modelle, Ø Confidence 7.8/10)

Einstimmig: mTLS + Zero-Trust, libp2p/mDNS Mesh, CRDT Registry, signierte Skills, Audit ab Phase 1, Human Approval Gates.

| Modell | Fokus | Confidence | Kernbeitrag |
|--------|-------|-----------|-------------|
| GPT-5.4 | Security | 8/10 | SPIFFE-Identitäten, OPA/Cedar Policy Engine, 4-Phasen-Rollout |
| Gemini 3 Pro | MCP Integration | 8/10 | Daemon als transparenter MCP-Proxy, libp2p statt Custom-Mesh |
| Claude Sonnet 4.6 | Kritische Bewertung | 7/10 | SPAKE2 Bootstrap, Shamir Secret Sharing, Human Approval Gates |
| DeepSeek R1 | Skill Exchange | 8/10 | Rust für Sandboxing, Merkle-Tree Audit, Skill-Ownership-Tokens |
| Kimi K2 | Daemon-Architektur | 8/10 | GossipSub, Protobuf-Schemas, LibSodium Sealed Boxes, ECDSA |
| GLM 4.5 | Gap-Analyse | 6/10 | MVP-first mit 3-5 Agents, Warnung vor O(n²) Registry-Wachstum |

### Recherche
- Web-Recherche zu MCP Nov 2025 Spec, A2A v0.3, ACP (IBM), ANP
- Analyse der Agent Card / Agent Discovery Muster
- Sicherheitsanalyse: MCP Tool Poisoning, Cross-Server Shadowing

---

## [0.2.0] — 2026-04-03

### Phase 1, Schritt 2+3: Node Daemon Grundgerüst + PoC

**Branch:** `agent/claude-code/phase1-daemon` | **PR:** #1

#### Hinzugefügt — Neue Module (`packages/daemon/src/`)

| Modul | Beschreibung |
|-------|-------------|
| `config.ts` | TOML-Config (`config/daemon.toml`) + Env-Override (`TLMCP_*`) mit Input-Validierung |
| `identity.ts` | ECDSA P-256 Keypair-Generierung, SPIFFE-URI, Sign/Verify |
| `audit.ts` | Append-only SQLite WAL-Log mit signierter Hash-Chain (`entry_hash` persistiert) |
| `discovery.ts` | mDNS Discovery via `bonjour-service` (`_thinklocal._tcp`) |
| `agent-card.ts` | Fastify HTTP-Server auf `/.well-known/agent-card.json` + `/health` |
| `mesh.ts` | Peer-Tracking, paralleler Heartbeat mit Overlap-Schutz |
| `index.ts` | Orchestrierung, Graceful Shutdown, Agent Card Identitäts-Verifizierung |
| `logger.ts` | Pino-basiertes strukturiertes JSON-Logging |

#### Sicherheit (nach GPT-5.4 Code Review)

- Agent Card wird nur akzeptiert wenn SPIFFE-URI + Public-Key-Fingerprint zur mDNS-Ankündigung passen
- mDNS TXT-`endpoint` wird ignoriert — Endpoint immer aus `host:port` abgeleitet
- Audit-Hash-Chain hasht alle Felder inkl. Signatur, `entry_hash` wird für Restart-Sicherheit persistiert
- Numerische Umgebungsvariablen werden als positive Ganzzahl validiert

#### Tests

- 4 Integration-Tests: Identität, Agent Cards, Peer-Discovery + Audit, Heartbeat Health-Check

#### PoC-Ergebnis

Zwei Daemon-Instanzen auf `minimac-3.local` (Ports 9440/9441) finden sich via mDNS, tauschen Agent Cards aus und halten Heartbeats aufrecht. PoC bestanden am 2026-04-03.

---

## [0.3.0] — 2026-04-03

### mTLS — Gegenseitige TLS-Authentifizierung

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `tls.ts` | Lokale Self-Signed CA (RSA-2048, node-forge), Node-Zertifikate mit SPIFFE-URI in SAN, 90-Tage-Gültigkeit, Auto-Renewal bei <7 Tagen, Peer-Cert-Verifizierung |

#### Geändert

- `agent-card.ts`: Unterstützt jetzt HTTP und HTTPS mit `requestCert: true, rejectUnauthorized: true` für echte mTLS-Validierung
- `mesh.ts`: Heartbeat-Requests über `undici` mit custom TLS-Dispatcher für Self-Signed CA
- `index.ts`: TLS-Bundle wird automatisch erstellt, alle Peer-Kommunikation über mTLS. Abschaltbar via `TLMCP_NO_TLS=1`
- `discovery.ts`: Publiziert `proto`-Feld im mDNS TXT-Record (`http`/`https`)

#### Sicherheit (nach Gemini 2.5 Pro Code Review)

- `rejectUnauthorized: true` auf dem Server (war `false` — Client-Certs werden jetzt validiert)
- `undici` statt `node:https` für ausgehende Requests (native fetch unterstützt keine custom CA)
- Zertifikats-Private-Keys mit Dateiberechtigung `0o600`

#### Tests

- 7 neue Unit-Tests für TLS-Modul (CA-Erstellung, Cert-Validierung, SPIFFE-Extraktion, Fremd-CA-Ablehnung)
- 4 bestehende Integration-Tests weiterhin grün

---

## [0.4.0] — 2026-04-03

### CBOR Message Envelope — Signiertes Nachrichtenprotokoll

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `messages.ts` | CBOR-basiertes Nachrichtenprotokoll mit signierten Envelopes: Correlation-ID, TTL, Idempotency-Key, ECDSA-Signatur |

#### Nachrichtentypen (Phase 1)

- `HEARTBEAT` — Lebenszeichen mit Uptime, Peer-Count, CPU-Load (TTL: 15s)
- `DISCOVER_QUERY` / `DISCOVER_RESPONSE` — Peer-Suche mit optionalem Agent-Typ-Filter
- `CAPABILITY_QUERY` / `CAPABILITY_RESPONSE` — Fähigkeiten abfragen (skill_id oder category)

#### Geändert

- `agent-card.ts`: Neuer `/message`-Endpoint für CBOR-Nachrichten mit Signaturprüfung und Content-Type-Parser für `application/cbor`

#### Tests

- 8 neue Unit-Tests: Envelope-Erstellung, CBOR Encode/Decode, Signaturverifizierung, TTL-Ablauf, Serialisierung/Deserialisierung

---

## [0.5.0] — 2026-04-03

### CRDT Capability Registry — Verteilte Fähigkeiten-Datenbank

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `registry.ts` | Automerge-basierte CRDT-Registry für Capabilities. Register, Unregister, Suche nach skill_id/category/agent. Import/Export für Peer-Sync, Capability-Hashing, Save/Load-Persistenz |

#### Features

- `register()` / `unregister()` — Capabilities anmelden/abmelden
- `findBySkill()` / `findByCategory()` / `getAgentCapabilities()` — Suche
- `markAgentOffline()` — Alle Capabilities eines Agents als offline markieren
- `importPeerCapabilities()` / `exportCapabilities()` — Peer-Synchronisation mit Timestamp-basierter Konfliktauflösung
- `getCapabilityHash()` — SHA-256-Hash für kompakte Announcements
- `save()` / `load()` — Persistenz via Automerge Binary

#### Tests

- 9 neue Unit-Tests: Register, Unregister, Suche, Offline-Markierung, Hash-Berechnung, Peer-Import, Konflikauflösung, Save/Load

---

## [0.6.0] — 2026-04-03

### Gossip-Sync + Rate-Limiting

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `gossip.ts` | Gossip-basierte Registry-Synchronisation: Pull-Push-Pattern, konfigurierbarer Fanout (Default: 3 Peers), 30s-Intervall, Hash-Vergleich vor Import |
| `ratelimit.ts` | Token Bucket Rate-Limiter pro Peer: 20 Tokens Burst, 2 Tokens/s Refill, automatisches Cleanup inaktiver Buckets |

#### Geändert

- `index.ts`: Registry, Gossip-Sync und Rate-Limiter vollständig integriert. Message-Handler verarbeitet REGISTRY_SYNC. Peers werden bei Offline-Markierung aus Rate-Limiter entfernt, Capabilities als offline markiert
- `messages.ts`: Neue Typen REGISTRY_SYNC / REGISTRY_SYNC_RESPONSE mit Capability-Payload

#### Tests

- 2 Gossip-Tests: Import von Peer-Capabilities, Hash-Vergleich bei Sync
- 6 Rate-Limiter-Tests: Burst-Limit, Refill, Separate Buckets, Remove, Overflow-Schutz

---

## [0.7.0] — 2026-04-03

### Security-Hardening (nach GPT-5.1 Review)

**Branch:** `agent/claude-code/phase1-daemon`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `replay.ts` | In-Memory Replay-Guard: Idempotency-Key pro Sender, TTL-basierte Duplikatserkennung, Auto-Cleanup |

#### Security-Fixes

- **Gossip agent_id Validation** (HIGH): `handleSyncMessage` filtert Capabilities mit fremder `agent_id` — nur Capabilities des tatsächlichen Senders werden importiert
- **Replay-Schutz** (MEDIUM): Idempotency-Key wird jetzt im `/message`-Handler geprüft, Duplikate mit HTTP 409 abgelehnt
- **Rate-Limiter auf allen Endpoints** (MEDIUM): `/.well-known/agent-card.json` und `/health` sind jetzt IP-basiert rate-limited (HTTP 429)
- **CBOR Size-Limit** (LOW): Zusätzliches 256 KB Limit für `/message` Body vor CBOR-Parsing

#### Tests

- 4 Replay-Guard-Tests + 1 Gossip-agent_id-Validierungstest

---

## [0.8.0] — 2026-04-03

### Phase 2: Task-Delegation + Dashboard REST-API

**Branch:** `agent/claude-code/phase2-tasks`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `tasks.ts` | Task-Manager: Lifecycle (requested→accepted→completed/failed/timeout), Correlation-ID-Tracking, Deadline mit Auto-Timeout |
| `dashboard-api.ts` | REST-API für Dashboard: GET /api/status, /api/peers, /api/capabilities, /api/tasks, /api/audit (mit CSV-Export, Filtern, Paginierung) |

#### Geändert

- `messages.ts`: Neue Typen TASK_REQUEST, TASK_ACCEPT, TASK_REJECT, TASK_RESULT

#### Tests

- 8 neue Task-Manager-Tests (Lifecycle, State-Übergänge, Correlation, Timeout)

---

## [0.9.0] — 2026-04-03

### SPAKE2 Trust-Bootstrap — PIN-basierte Peer-Authentifizierung

**Branch:** `agent/claude-code/phase1-spake2`

#### Hinzugefügt

| Modul | Beschreibung |
|-------|-------------|
| `pairing.ts` | PIN-Generierung (6-stellig), AES-256-GCM Verschlüsselung für CA-Zertifikat-Austausch, PairingStore (JSON-Persistenz mit 0o600), Key-Derivation via SHA-256 |
| `pairing-handler.ts` | Fastify-Routen: POST /pairing/start (PIN generieren), POST /pairing/init (SPAKE2 Handshake), POST /pairing/confirm (verschlüsselter CA-Austausch), GET /pairing/status |
| `types/niomon-spake2.d.ts` | TypeScript-Deklarationen für @niomon/spake2 |

#### Pairing-Flow

1. Node A: `POST /pairing/start` → generiert PIN `123456`, zeigt sie im Terminal
2. Benutzer teilt PIN an Benutzer von Node B
3. Node B: `POST /pairing/init` mit PIN + SPAKE2 Message
4. Bei gleicher PIN: Shared Secret → AES-256-GCM → CA-Zertifikate tauschen
5. Node B: `POST /pairing/confirm` mit eigenen verschlüsselten Daten
6. Beide Nodes speichern sich gegenseitig als vertrauenswürdig (PairingStore)
7. Bei falschem PIN: SPAKE2 Handshake schlägt fehl, kein Informationsleck

#### Tests

- 9 neue Tests: PIN-Generierung, Key-Derivation, AES-256-GCM Encrypt/Decrypt, falscher Schlüssel, PairingStore (Persistenz, Remove, Liste)

---

## [0.10.0] — 2026-04-03

### Dashboard UI + vollstaendige API-Integration

**Branch:** `agent/claude-code/phase2-dashboard`

#### Hinzugefuegt — Dashboard UI (`packages/dashboard-ui/`)

| View | Beschreibung |
|------|-------------|
| **Topologie** | React Flow Netzwerkgraph — eigener Node (blau) + Peers (gruen/rot), animierte Kanten fuer Online-Peers |
| **Skill-Matrix** | Tabelle Agent x Capability mit Health-Badges und Version |
| **Health** | CPU/RAM/Disk Gauges mit Farbbalken, Uptime, Peer-Count, Task-Count |
| **Pairing** | PIN-Generierung, Session-Status, Liste gepaarter Peers |
| **Audit-Log** | Event-Tabelle mit farbcodierten Typen, CSV-Export-Button |

#### Technologie

- React 19 + Vite 6 + TypeScript strict
- @xyflow/react (React Flow) fuer Topologie-Graph
- Tailwind CSS 4 fuer Styling
- Auto-Polling-Hook (5-10s Intervall)
- Vite-Proxy zu Daemon API (localhost:9440)

#### Geaendert — Daemon

- `index.ts`: TaskManager, PairingStore, Dashboard-API und Pairing-Routen vollstaendig integriert
- `agent-card.ts`: getServer() Methode fuer Plugin-Registrierung

---

## [0.11.0] — 2026-04-03

### Skill-System — Skill-Announce + Transfer zwischen Peers

**Branch:** `agent/claude-code/phase2-skills`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `skills.ts` | SkillManager: Manifest-Format, lokale Skill-Registrierung, SKILL_ANNOUNCE-Handling, Transfer-Request/Response, Persistenz in JSON |

#### Features

- **Skill-Manifest**: ID, Version, Runtime (node/python/wasm/docker), Tools, Resources, Permissions, Integrity-Hash
- **SKILL_ANNOUNCE**: Peers kuendigen ihre Skills an, Remote-Skills mit Trust-Level 2 in Registry
- **SKILL_REQUEST / TRANSFER**: Transfer-Lifecycle (requested→transferring→installed/failed)
- **Lokale Persistenz**: Installierte Skills in `installed.json`
- **Registry-Integration**: Lokale Skills als Capabilities mit Trust-Level 3

#### Geaendert

- `messages.ts`: SKILL_ANNOUNCE, SKILL_REQUEST, SKILL_TRANSFER Typen
- `index.ts`: SkillManager initialisiert, SKILL_ANNOUNCE im Message-Handler

#### Tests

- 6 neue Skill-Tests: Register, Unregister, Announce, Announce-Dedup, Transfer-Request, Persistenz

---

## [0.12.0] — 2026-04-03

### WebSocket Echtzeit-Events + Live-Dashboard

**Branch:** `agent/claude-code/phase2-websocket`

#### Hinzugefuegt — Daemon

| Modul | Beschreibung |
|-------|-------------|
| `events.ts` | Zentraler MeshEventBus (EventEmitter): 16 Event-Typen (peer, task, capability, skill, audit, system) |
| `websocket.ts` | @fastify/websocket Server auf /ws: Broadcast an alle Clients, Ping/Pong (30s), Graceful Disconnect |

#### Hinzugefuegt — Dashboard

| View | Beschreibung |
|------|-------------|
| **Live-Events** | Echtzeit-Event-Feed via WebSocket mit Emoji-Icons, Auto-Reconnect, max 200 Events |
| **useWebSocket** | React-Hook: WebSocket-Verbindung mit Auto-Reconnect (3s), Event-Buffer |

#### Geaendert

- `index.ts`: EventBus initialisiert, Events bei Peer-Join/Leave emittiert
- `App.tsx`: Live-Indikator (gruen/rot) in Sidebar, neue "Live-Events"-Route
- `vite.config.ts`: WebSocket-Proxy (/ws → ws://localhost:9440)

---

## [0.13.0] — 2026-04-03

### Phase 3: Credential Vault — Verschluesselter Credential-Speicher

**Branch:** `agent/claude-code/phase3-vault`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `vault.ts` | Verschluesselter Credential-Speicher: AES-256-GCM at-rest (PBKDF2 Key-Derivation), NaCl Sealed Boxes fuer Peer-Sharing, Credential-TTL mit Auto-Expiry, Tags/Kategorien, Human Approval Gate (pending/approved/denied) |

#### Features

- **Store/Retrieve**: Credentials verschluesselt speichern und abrufen
- **NaCl Sealed Boxes**: `sealForPeer()` / `unsealFromPeer()` fuer sicheren Peer-zu-Peer-Austausch
- **TTL + Auto-Expiry**: Credentials laufen nach konfigurierbarer Zeit ab
- **Approval Gate**: Anfragen fuer Credential-Zugriff mit pending/approved/denied-Workflow
- **Scoping**: Kategorien + Tags fuer feingranulaere Zugriffskontrolle
- **Zugriffs-Tracking**: Access-Count + Last-Accessed-At pro Credential

#### Tests

- 10 neue Vault-Tests: Store/Retrieve, TTL, NaCl Seal/Unseal, falscher Schluessel, Approval-Workflow

---

## [0.14.0] — 2026-04-03

### Vault-Integration — SECRET_REQUEST + Dashboard Vault-UI

**Branch:** `agent/claude-code/phase3-vault-integration`

#### Hinzugefuegt

- `SECRET_REQUEST` / `SECRET_RESPONSE` Message-Typen mit NaCl-verschluesseltem Credential-Transport
- Dashboard Vault-View: Credentials anzeigen/hinzufuegen/entfernen, Approval-Gate (genehmigen/ablehnen)
- REST-Endpoints: GET/POST/DELETE /api/vault/credentials, GET /api/vault/approvals, POST approve/deny

#### SECRET_REQUEST Flow

1. Peer sendet SECRET_REQUEST mit NaCl Public Key + Begruendung
2. Daemon erstellt Approval-Request (Human Gate)
3. Wenn Peer gepaart: Auto-Approve, Credential wird mit NaCl Sealed Box verschluesselt zurueckgegeben
4. Wenn nicht gepaart: Status "pending", Human muss im Dashboard genehmigen
5. Audit-Event bei jedem Credential-Zugriff

---

## [0.15.0] — 2026-04-03

### Agent-Detail-Ansicht + klickbare Topologie

**Branch:** `agent/claude-code/phase2-agent-detail`

- **AgentDetailView.tsx**: Drill-down-Ansicht pro Agent mit Health-Gauges (CPU/RAM/Disk), Capabilities-Liste, Audit-Events, Verbindungsdetails
- **TopologyView**: Nodes sind jetzt klickbar — Klick auf Peer navigiert zu `/agent/:agentId`
- Route: `/agent/:agentId`

---

## [0.16.0] — 2026-04-03

### MCP-Server — AI-Agent-Integration

**Branch:** `agent/claude-code/phase4-mcp-proxy`

#### Hinzugefuegt

| Modul | Beschreibung |
|-------|-------------|
| `mcp-server.ts` | In-Process MCP-Server mit 7 Tools: discover_peers, query_capabilities, get_agent_card, delegate_task, list_credentials, mesh_status, list_skills |
| `mcp-stdio.ts` | Standalone MCP-Server fuer stdio-Transport — verbindet sich mit laufendem Daemon ueber REST-API. 8 Tools inkl. store_credential, get_audit_log, start_pairing |

#### Integration in Claude Code

```json
{
  "mcpServers": {
    "thinklocal": {
      "command": "npx",
      "args": ["tsx", "packages/daemon/src/mcp-stdio.ts"],
      "env": { "TLMCP_DAEMON_URL": "http://localhost:9440" }
    }
  }
}
```

Damit kann Claude Code direkt Mesh-Funktionen nutzen: Peers entdecken, Capabilities abfragen, Tasks delegieren, Credentials verwalten.

---

## [0.17.0] — 2026-04-03

### Signierte Skill-Pakete (.tlskill)

**Branch:** `agent/claude-code/phase3-skill-packages`

- `skill-package.ts`: Erstellung, Speicherung, Verifizierung und Installation von .tlskill-Paketen
- Format: JSON-Container mit Manifest, Base64-Code, SHA-256 Integrity, ECDSA-Signatur
- Verifizierung: Format-Check, Integrity-Hash, Signatur-Pruefung, Manifest-Validierung
- Installation nur nach erfolgreicher Verifizierung
- 7 Tests: Create, Verify, Tamper Detection, Wrong Key, Save/Load, Install, Reject Tampered

---

## [0.18.0] — 2026-04-03

### CI Pipeline + CLI Tool

- `.github/workflows/ci.yml`: GitHub Actions fuer Daemon (TypeScript + Tests) und Dashboard (TypeScript + Vite Build)
- `packages/cli/src/tlmcp.ts`: CLI fuer Mesh-Verwaltung: status, peers, caps, tasks, vault, pairing, audit
- Root package.json: Neue Scripts `dashboard:dev`, `dashboard:build`, `tlmcp`

---

## [0.19.0] — 2026-04-03

### Installation, Distribution + Netzwerk-Scanner

- `scripts/install.sh`: One-Line-Installer fuer macOS/Linux — klont, installiert, richtet Service ein, konfiguriert MCP
- `scripts/deploy-remote.sh`: SSH-Deployment auf entfernte Rechner mit Node-Check
- `scripts/service/com.thinklocal.daemon.plist`: macOS launchd Service
- `scripts/service/thinklocal-daemon.service`: Linux systemd User-Service
- `scripts/service/thinklocal-daemon.ps1`: Windows Scheduled Task
- `packages/cli/src/scan-network.ts`: Netzwerk-Scanner — findet laufende Daemons, SSH-Hosts, prueft Node.js, schlaegt Deployment vor
- `INSTALL.md`: Umfassende Installationsanleitung (alle Plattformen, Claude Code, Claude Desktop, Fehlerbehebung, Deinstallation)
- `README.md`: Quick Start aktualisiert

---

## [0.20.0] — 2026-04-04

### Produktisierung + Multi-Agent-Meilenstein

**34 PRs gemergt** | 3 Code Reviews | Cross-Machine Live-getestet (macOS + macOS + Ubuntu)

#### Phase 5 — Produktisierung (PR #22-#33)

- `thinklocal` CLI: 11 Befehle (start/stop/status/doctor/bootstrap/peers/check/mcp/logs/uninstall/config)
- Automatische Service-Installation: launchd (macOS) + systemd (Linux)
- Claude Desktop + Code MCP Auto-Config (sicheres Einfuegen mit Backup)
- One-Command-Installer: `curl ... | bash` mit vollstaendiger Dependency-Pruefung
- Auto-Install: curl, git, Node.js (via nvm), npm, avahi-daemon, build-essential
- nvm-aware Node-Pfad (System-Node bleibt unangetastet)
- Dashboard als systemd Background-Service (Port 3000)
- Update/Reinstall-Modus: `curl ... | bash -s -- update`
- Security-Haertung: XML-Escaping, systemd-Quoting, atomicWrite, spawnSync
- Remote-Check: `thinklocal check host:port` prueft entfernte Daemons
- Peers mit Health-Daten (CPU/RAM/Disk/Uptime mit Farbcodes)

#### Multi-Agent-Meilenstein (PR #34)

- **Erster Remote-Agent-PR**: Claude Code auf dem Linux-Server hat eigenstaendig einen InfluxDB-Skill gebaut, getestet, committet und PR erstellt
- InfluxDB 1.x Skill: 4 Tools (query, databases, measurements, write)
- Cross-Machine Skill-Execute: Mac fragt InfluxDB auf Linux-Server ab — ueber das Mesh
- Destruktive Queries blockiert (DROP, DELETE, ALTER)

#### Drei-Node-Mesh Live-getestet

| Node | Plattform | Rolle |
|------|-----------|-------|
| minimac | macOS (ARM64) | Daemon + Dashboard + Claude Code |
| MacBook-Pro | macOS (ARM64) | Daemon + Claude Code |
| influxdb | Ubuntu 24.04 (x64) | Daemon + Dashboard + Claude Code + InfluxDB-Skill |

---

## [Unreleased]

### Geplant
- Credential-Management: GitHub Token im Vault fuer automatischen Agent-Push
- Telegram-Skill: Agent-zu-Agent-Kommunikation (User muss nicht mehr Mittelsmann sein)
- ThinkHub: Skill-Marketplace (Skills nicht im Repo, sondern in eigener Registry)
- WASM/Docker Sandbox fuer Skill-Ausfuehrung
- Vision: ThinkLocal → ThinkWide → ThinkHub → ThinkBig
- OS-Keychain-Integration
- Homebrew-Formel
