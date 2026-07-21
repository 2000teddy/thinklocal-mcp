# TODO.md — thinklocal-mcp

Vollständiger Entwicklungsfahrplan, Aufgabenstruktur und Zukunftsideen.
Priorität: 🔴 Kritisch | 🟠 Hoch | 🟡 Mittel | 🟢 Niedrig | 💡 Idee/Zukunft

---

## v5.1-Roadmap — Arbeits-Wahrheit (übernommen 2026-07-07 aus Architektur-Referenz)

> Quelle (bleibt **Referenz**, read-only): `~/hermes/reference/architecture-v5.1/todos/TODO-thinklocal-mcp.md`.
> Diese `TODO.md` ist ab jetzt die **Arbeits-Wahrheit**. Jeder übernommene Punkt trägt `[v5.1]`.
> P0 = kritischer Pfad, strikt in Reihenfolge. Überschneidungen mit Bestandseinträgen sind per
> „↔ vgl." verlinkt statt dupliziert (Detail bleibt am Original-Eintrag weiter unten).

**Reconcile-Befund (Hermes 05.07.):** Spur-3-Code liegt bereits in `main` (#229→#241). TL-01…TL-06 sind
damit **Verifikations-/Live-Wiring-Punkte, kein Neubau**. Echter Blocker = **Re-Pair** .52/.55
(Legacy-`host/…` → kanonisch `node/…`; cross-host heute `403 peer not paired`).

- [ ] **[v5.1] TL-00a (≈3 h)** Re-Pair-Migrationsstufe: EINE Stufe mit Übergangsfenster (Legacy lesen,
  kanonisch schreiben), Lock fürs Cert-Re-Key — keine zwei parallelen Identitäten. ↔ vgl. **umgesetzt**:
  ADR-034 (#245, v0.34.69) + CA-verankerter Re-Key (#246, v0.34.70, `pairing-canonicalize.ts`).
- [ ] **[v5.1] TL-00b (je ≈1 h, ⛔ Fenster)** Re-Enroll `.52`, dann `.55` (nach Christians Pfad-A-Schritt),
  dann `.94`. ↔ vgl. bestehend „ADR-024-Rollout-Gate" + „Produktiv-Flotten-Flip (.56/.52/.222)" + „.55
  Pfad A/C2". **.52-Fenster aktiv (heute Nacht, zielt auf TL-07-Beweis).**
- [ ] **[v5.1] TL-00c (≈2 h)** Cert-Dry-Run: Test-Peer-Cert <30 Tage → Wochen-Restart simulieren → Reissue
  + Schlüssel-Sync verifiziert. **Abnahmekriterium vor weiterem Staffel-Rollout.** ↔ vgl. #242 renew_before_days.
- [x] **[v5.1] TL-00d** #242-Konfig-Keys dokumentieren (`cert.renew_before_days`,
  `TLMCP_CERT_RENEW_BEFORE_DAYS`) — **verifiziert erledigt (2026-07-20)** gegen HEAD: `docs/USER-GUIDE.md`
  deckt **beide** Knobs vollständig & korrekt ab — TOML-`[cert]`-Beispiel (l.79-82) + Env-Var-Tabelle (l.105) +
  dedizierter Abschnitt „Zertifikats-Erneuerung (`[cert]`)" mit Mapping-Tabelle TOML-Key ↔ Env ↔ Default `30` ↔
  Wertebereich `[1, 89]` ↔ Bedeutung (l.115-117), #242-Attribution + Validierungs-Begründung. Doku stimmt mit
  HEAD überein (`NODE_CERT_VALIDITY_DAYS=90` → gültig `[1, 89]`; Default `config.ts:251`; Env-Wiring
  `config.ts:406-407`; Post-Merge-Validator `config.ts:465-476`). Ursprüngliche Abdeckung via #243 (KW28 §2 B).
  Kein weiterer Doc-Change nötig.

### P0 — Weg zum Zwei-Rechner-Beweis (Kap. 07; Status: Code in main, live beweisen)
- [ ] **[v5.1] TL-01 (≈2–3 h)** `[[mcp.share]]` für `pal`+`unifi` (remote-forward-only). *Fertig wenn:*
  `query_capabilities` zeigt `mcp:pal`/`mcp:unifi` auf **allen** Peers; ADR-032-Phantom-Guard ruhig.
  ↔ vgl. #229 (T3.1/T3.2), #232 ADR-032.
- [ ] **[v5.1] TL-02 (≈3 h)** Fastify-Route `POST /api/mcp/<server>` um `handleMcpIngress()` (Gerüst +
  Unit-Tests). ↔ vgl. #229 Live-Ingress.
- [ ] **[v5.1] TL-03 (≈3 h)** Absender-Prüfung an der Route: SPIFFE-URI aus dem mTLS-Client-Cert,
  ungültig/fehlend → **403**.
- [ ] **[v5.1] TL-04 (≈4 h)** Live-Executor 1: undici-mTLS-Forward an den Owner-Peer, Happy-Path
  `tools/list`. ↔ vgl. #237/#238 Forward-Executor.
- [ ] **[v5.1] TL-05 (≈4 h)** Live-Executor 2 (Härtung): Streaming, Timeout 30 s (`AbortSignal`),
  Body-/Stream-Limits, 1-Sprung-Schutz (`x-tlmcp-mcp-hop`), Socket-Leak-Test. ↔ vgl. #238 1-Hop-Guard.
- [ ] **[v5.1] TL-06 (≈3 h)** Client-Seite: Proxy-Werkzeuge in `mcp-stdio` (`tools/list` + `tools/call`
  Passthrough). ↔ vgl. #231 (T3.4 mcp-stdio-Proxy-Tools).
- [ ] **[v5.1] TL-07 (≈2–3 h) 🎯 ZWEI-RECHNER-BEWEIS:** Spoke .52 → Mesh → TH01-unifi `list_clients`, ohne
  stunnel, Prüfeinträge auf **beiden** Seiten. *Fertig wenn:* Bericht (Befehle+Ausgaben) in
  `~/hermes/reference/`, Telegram an Christian. **= Beta-Kernlücke geschlossen. ← heutiges .52-Fenster.**

### P0-parallel — Sicherheits-Pflicht (Beta-Blocker, Kap. 7.4/10)
- [~] **[v5.1] TL-08 (≈4 h)** Stufen-Durchsetzung am Hub-Eingang (Werkzeugname → lesend/schreibend/kritisch
  → frei/Gate/verweigert; unifi READ_ONLY/WRITE_OP/DESTRUCTIVE übernehmen). ↔ ADR-033 (Verb-Heuristik)
  + ADR-039 (gepflegte Map).
  - [x] **TL-08 Slice 1** (ADR-039): gepflegte Read-only-Allowlist je governed Server (unifi, 24 non-secret
    Reads aus echtem 67-Tool-Inventar). `deriveToolTierForServer`: readOnly→self, unlisted `tools/call`→
    ≥gate (nie Downgrade), `tools/list`/ungoverned→Heuristik; Server kanonisiert, Tool exakt; Credential-
    Reads (wlan/voucher/radius/vpn/wans/networks) gegatet; Fixture-Subset-Drift-Test. +14 Tests.
  - [x] **TL-08 Slice 2a** (ADR-040, **reine Telemetrie**): `sensitive`-Set (10 credential-Reads explizit),
    `classifyGateReason` (diskriminiert, single source of truth, Cross-Check-Test), `reason=`-Audit-Suffix,
    `computeToolClassDrift` (Snapshot-Lint). Null Gate-Verhaltensänderung. +16 Tests.
  - [x] **TL-08 Slice 2b** (ADR-041): owner-seitige **fail-closed** Redaction-Mechanik. `redact-mcp-response.ts`
    (deny-by-default Feld-Allowlist, Policy R = unconditional), verdrahtet im Owner-Local-Exec; kein
    Gate-Flip (Gate-still-blocks-Regression). `SERVER_SAFE_FIELDS['unifi']` leer (maximale Redaction).
    CR: HIGH (Array-Skalar-Leak) + MEDIUM (Error-Pfad) in-slice gefixt. +21 Tests.
  - [~] **TL-08 Slice 2c** — teils geliefert, Kern BLOCKED:
    - [x] **Live-Drift-Check** (ADR-042): `checkToolClassDrift`-Seam gegen live `tools/list` (secret-sicher,
      fail-safe), +6 Tests. Verdrahtungs-Hook (index.ts/Mesh) = Folge.
    - [ ] ⛔ **Gate-Flip BLOCKED (Christian-Gate):** sensitive → allow-with-redaction braucht kuratierte
      Safe-Field-Allowlist; die 10 sensitiven unifi-Tools haben **kein `outputSchema`** → Feldnamen nur per
      Tool-Aufruf (= Secret-Exposition). Unblock: (c) Doku-/Quell-Transkription der Feldnamen (UniFi-API +
      FastMCP-Quelle), (a) Christian-sanitisierte Liste, (b) autorisierter redact-before-log-Sampling-Harness.
      Dann Gate-Flip + nested-JSON-`content[].text`-Redaction + Tool-Name-Casing als eigener Security-CR.
- [~] **[v5.1] TL-09 (≈4 h)** Meldekanal-Abstraktion (Entsch. 10) + Telegram-Adapter + **Fail-safe: kein
  erreichbarer Kanal = schreibender Aufruf bleibt verweigert.**
  - [x] **TL-09 Slice A** (ADR-036): reine Abstraktion `meldekanal.ts` (`Meldekanal`/`MeldekanalRegistry`/
    `DenyAllChannel`/`isApproved`) + Fail-safe Deny-Default + 22 Tests. `mcp-ingress.ts` unangetastet.
  - [x] **TL-09b Slice B** (Wiring, ADR-037): `mcp-ingress.ts` `gate`-Pfad optional auf
    `resolveApproval(...)` (→ `MeldekanalRegistry`) verdrahtet, hinter Env-Flag `TLMCP_APPROVAL_CHANNEL_ENABLED`
    (Default aus, leere Registry → 403 = verhaltensidentisch). Nur `isApproved` lässt durch; `consensus`
    bleibt 403; fail-closed bei Throw/malformed. **Korrelierbares `MCP_FORWARD_GATE`-Audit** (requestId/
    outcome/channelId) VOR Dispatch/Denial (CR-Codex #264). `meldekanal.ts` hat jetzt einen lebenden Consumer.
  - [x] **TL-09c** (2026-07-20, ADR-038): realer `TelegramMeldekanal implements Meldekanal` — Inline-Keyboard
    (`tlgate:approve|reject:<id>`) → durabler `approvals.ts`-Store (`type:'mcp_gate'`). **Injizierbar** in die
    Registry; ein Test beweist end-to-end `approved → ApprovalDecision('approved')` über eine reale Registry.
    Fail-closed (ADR-036 C1/C2): Abort terminal (später Klick No-op), fremder Chat/malformed ignoriert,
    Doppelklick idempotent, Persistenz-/Sende-Fehler ⇒ `error` (nie stilles `approved`). Bot-Glue über schmalen
    `TelegramApprovalTransport` (kein zweiter Polling-Bot). **`index.ts` unangetastet** (Registry weiter leer →
    gate=403, Risiko-Delta null). **OFFEN (Aktivierung, Christian-gegatet, RUNBOOK-TL-11 §TL-09c):** Gateway-Bot
    als Transport hereinreichen + Freigabe-Chat setzen — braucht Bot-Token/Secret, kein Repo-Schritt.
- [~] **[v5.1] TL-10 (≈3 h)** Freigabe-Matrix v1 (Werkzeug-Klasse → Kanal → Entscheider), Auswertung im Gate.
  Schiebt sich zwischen Ingress (TL-09b, verdrahtet) und Registry — der `resolveApproval`-Seam existiert jetzt.
  CO-Auflagen (2026-07-15): Feld `tier` statt `tool_class` (tier = harter Predikat-Filter, nie Label);
  Parse-Rejects (tool-ohne-server, Duplikat-Spezifität, unbekannte Keys, non-kanonischer Server,
  unbekannte decider-Grammatik, `consensus` ohne `quorum:N` N≥2); `isRoutable()`-Guard analog `isApproved`.
  - [x] **Scoping/Discovery** (2026-07-18, #287): `docs/architecture/TL-10-freigabe-matrix-scoping.md` — Seam
    gegroundet (Matrix ersetzt die „erster-gesunder-Kanal"-Auswahl `meldekanal.ts:194-213` am `resolveApproval`-
    Seam `mcp-ingress.ts:105-110`), CO-Auflagen gepinnt, v1-Vorschlag (Schema/Spezifität/decider-Grammatik) +
    Slice-Zerlegung A(rein)→B(Verdrahtung). **§5: 5 exakt offene Entscheidungen VOR Code** (Matrix-Quelle/TOML,
    Kanal-Bindung `channelId` vs. Instanz, decider-v1-Semantik, kanonische Server-Prüfquelle, leere-Matrix=403).
  - [x] **§5-CO** (2026-07-20, read-only `pal:consensus` opus 8/10 + sonnet 8/10 einstimmig): D1 eigene Datei
    `config/freigabe-matrix.toml`; D2 `channelId`-Ref + Registry-`requestApprovalOn` (Slice B); D3 `human:<id>`
    v1 **deklarativ** (nur parse-validiert) → **Owner-Sign-off + SECURITY.md-Notiz VOR Slice B**; D4 gegen
    `resolveMcp`-`knownServers` (injiziert); D5 leer/kein-Match ⇒ 403 Default-Deny. **Slice A entsperrt** (D1/D4/D5
    als Vertrag), nur Slice B ist D2/D3-gated.
  - [x] **Slice A** (rein, 2026-07-20): `freigabe-matrix.ts` (`parseFreigabeMatrix`/`resolveEntry`/`isRoutable`
    + `FreigabeMatrixError`) — fail-closed Parser (alle §2.2-Rejects), Spezifitäts-Resolver (exakt > `*`),
    einziger `isRoutable`-Guard. **Keine Verdrahtung.** +28 Tests, Suite **1797 grün**, tsc(strict)/Lint 0.
  - [x] **SECURITY.md-Anteil (D3-Guardrail)** (2026-07-20): neue Sektion „Freigabe-Matrix (TL-10)" —
    „`decider: human:<id>` ist v1 REIN DEKLARATIV, NICHT durchgesetzt", Fail-closed/Default-Deny-Guardrails,
    4 Aktivierungs-Vorbedingungen, owner-gated-Teile. Doc-only, kein Runtime-Change.
  - [ ] **Slice B** (Verdrahtung, **D2/D3-gated**): Resolver konsultiert die Matrix vor `registry.requestApproval`
    (Env-Flag wie TL-09b); braucht D2 (Registry-`requestApprovalOn(channelId)`) + **D3 Christian-Sign-off**
    (SECURITY.md-Note liegt jetzt vor). **Owner-gated:** Aktivierungs-Flag-Flip.

### P1 — Identität, Autonomie, Robustheit
> **Discovery + Reihenfolge (CO 2026-07-15, opus+sonnet einstimmig):** **TL-12 VOR TL-11.** TL-12 Slice A
> ist additiv/risikoarm/eigenständig wertvoll und stabilisiert die diskriminierte Nachrichtenform, die
> TL-11s Wake lesen muss. Scoping-Doku: `docs/architecture/TL-11-12-wake-postbox-discovery.md`.
- [~] **[v5.1] TL-12 (≈4 h)** Ausgewiesene Mesh-Zustellung an Agenten (signierter Auftrag → Postfach →
  Abarbeitung; Ersatz für tmux-Zuruf, Kap. 11.3).
  - [x] **TL-12 Slice A** (ADR-038): signierter, re-verifizierbarer Auftrag im Postfach. `signed-order.ts`
    (Order = signierter `type='ORDER'`-Envelope im Body-Marker), Inbox-Schema v3 (verbatim `signed_bytes` +
    immutable `signer_pubkey` + `order_nonce`/keyid/verdict/`trust_status`), `store()` nur `OrderContext|null`
    (is_order typsystemisch unfälschbar, issuer===sender Relay-Schutz), `verifyStoredOrder` fail-closed,
    Ingest-Wiring + `ORDER_RX`/`ORDER_VERIFY_FAILED`-Audit, **Read-Surface: `GET /api/inbox` re-verifiziert
    live + surfaced `is_order`/`order`-Block** + Tri-State-Marker (`classifyInboundOrder`-Seam: malformed → INVALID+Audit, Reviewer #266). +37 Tests.
  - [~] **TL-12 Slice B**: **Ausführung** eines gelesenen Auftrags. **Scoping-Doku (CO 2026-07-16, opus+sonnet)
    fertig:** `docs/architecture/TL-12-slice-b-execution-scoping.md` — Votum **B1 nicht starten**, bis Owner-Opt-in
    + Epoch-Grenze entschieden. Korrigierte Zerlegung **B0→B1→B2a→B2b→B3**: B0 Executable-Profil (`ttl_ms>0`,
    `order_type` aus `signed_bytes`, DER-SPKI-Keyid, Epoch-Grenze) → B1 Ledger `UNIQUE(signer_keyid,order_nonce)`
    reserve-vor-dispatch/at-most-once → B2a TTL-strenger Execute-Resolver → B2b **neues** keyid-Denylist (NICHT
    `crl.ts` — Fingerprint-gekeyt+unverdrahtet) → B3 Ausführung hinter allen Gates + per-signer Rate-Fence.
    Offen (Christian): `[orders] execute` + `(signer_keyid×order_type)`-Allowlist, Epoch `T` vs. max-TTL,
    ausführbare Startmenge, Revocation-Autorität. Human-Approval-Gate existiert noch nicht → sensible Typen = Deny.
  - [~] **TL-12 Slice C**: first-class `MessageType='ORDER'` (Marker ablösen), sobald Peers ≥ dieser Version.
    **PARK (Gate-Check 2026-07-21, doc-first):** nicht ehrlich low-ambiguity baubar. Scoping/Beleg:
    `docs/architecture/TL-12-slice-c-scoping.md`. Drei blockierende Vorbehalte: (V1) top-level ORDER fällt in
    den `default`-Drop des Empfangs-Dispatch (`index.ts:932-934`) → still verworfen gegen jeden nicht
    upgegradeten Peer; (V2) „Peers ≥ Version"-Gate nicht evaluierbar — `version-compat.ts` außerhalb Tests
    nirgends aufgerufen, kein Wire-Versionsaustausch; (V3) selbst der additive Empfänger-Handler ist
    ADR-pflichtig, weil `store()` an `AgentMessagePayload` gekoppelt ist (`agent-inbox.ts:256`) → wrapper-lose
    ORDER erzwingt neues message_id/subject/body/to-Mapping. **Ehrlicher nächster Baustein = Wire-Level-
    Feature/Version-Exchange (Agent-Card-Feld)**, nicht Slice C selbst.
  - [~] **TL-12 Prereq — Wire-Feature/Version-Exchange** (Scoping: `docs/architecture/ADR-046-wire-feature-version-exchange.md`,
    Status **Proposed**). Der Slice-C-Enabler: additiver `protocol`-Block auf der Agent-Card
    (`protocol_version`/`min_compatible_version`/`features[]` aus `version-compat.ts`) + reiner fail-closed
    Consumer-Helper `peerSupportsFeature(uri, feature)`. Konsumenten-Seite existiert schon (`mesh.getPeer`
    hält die volle Card, `mesh.ts:20,189,258`); es fehlt nur die annoncierte Feld-Seite + `version-compat`-
    Verdrahtung (heute tot). Seed-Flag `order-envelope-v2`. **Impl-Slice ist CO-gated** (Vokabular/Semver-
    Governance) und rein additiv/rückwärtskompatibel; **kein** ORDER-Handler/Sender-Flip hier (= Slice C proper).
- [~] **[v5.1] TL-11 (≈4 h)** Heartbeat-Weckruf (Entsch. 16): Daemon weckt Agenten; geweckter Agent prüft
  Mesh-Postfach. ↔ baut auf ADR-004.
  - [x] **TL-11 Slice A** (ADR-043): edge-driven Wake-Kontrakt — `wake-contract.ts` (fail-closed Resolver,
    kein Broadcast; Coalescer; Zero-Content `WakeSignal`), verdrahtet: `inbox:new`+`to_agent_instance` →
    `agent:wake`-Event über Registry-Fanout. Transport = WS-`inbox:new`-Reuse (best-effort/lossy/idempotent).
    **Kein neuer Transport.** +14 Tests. CR: 6 Invarianten PASS, 2 LOW in-slice gefixt.
  - [x] **TL-11 §4 directed-wake** (#277, b459bdf): `agent:wake` ist jetzt ein **gerichtetes** Event —
    Payload trägt `spiffe_uri` (fail-closed ohne SPIFFE), WS liefert es NUR an einen Client, dessen
    `agentFilter` `spiffe_uri`/`instance_id` matcht, **nie** an Ungefilterte. **Schließt die beiden
    Backlog-Befunde** (Leak D1 + Mis-Routing D2) aus dem vorigen Eintrag — beide bewacht (`websocket.test.ts:92,97,102,107,112`).
  - [x] **TL-11 Consumer-Contract-Spec** (2026-07-16): `docs/architecture/TL-11-wake-consumer-contract.md`
    — implementierbare Schnittstelle für den Out-of-Repo-Supervisor (WS `/ws` mTLS-Pflicht, Subscribe
    `?subscribe=agent:wake&agent=<spiffe>`, Zero-Content-Payload-Schema, best-effort/lossy/coalesced-Semantik,
    Referenz-Loop, jede Garantie testgebunden). **De-riskt** Slice B, ohne den externen Hop zu bauen; kein
    neuer Beschluss (aus gemergtem #271/#277-Code abgeleitet).
  - [x] **TL-11 Wire-Conformance-Scaffold** (2026-07-17, #282): `tl11-wake-wire.conformance.test.ts` — treibt den
    **realen `/ws`-Socket** (echter Fastify-Server + `registerWebSocket`, Node-22-`WebSocket`-Client, Loopback)
    statt nur reine Funktionen: **7 grün** (§3 Subscribe, §4 Zero-Content-Wire-Shape, directed Match/deny/drop,
    §8.1 Frame-Pfad, §2 Loopback-Positivpfad). Wire-Shape-Befund: Payload liegt **unter `.data`** →
    Consumer-Doc §4/§6/§7.1 korrigiert. De-riskt Slice B, ohne den externen Hop zu bauen.
  - [x] **TL-11 cert-fixture Slice** (2026-07-17, #283): die zwei ex-`it.todo` sind jetzt **echte Tests** (→ **11 grün**):
    §2 **mTLS-Pflicht** über einen zweiten Harness mit demselben Vertrag wie der cardServer (Fastify `https` +
    `requestCert`+`rejectUnauthorized`, agent-card.ts:229-230), In-Memory-CA/Server-/Client-Leaf (node-forge),
    undici-`WebSocket`+`Agent`-Client → gültiges Client-Cert erreicht `/ws`, cert-los/`ws://` werden TLS-resettet;
    §2 **Nicht-Loopback-`4003`** über Bindung an eine echte Nicht-Loopback-IPv4 (kein `trustProxy` → `req.ip` =
    Socket-Peer, `it.skipIf` auf reinen Loopback-Hosts).
  - [x] **TL-11 cardServer-Wiring-Test (CR-M2)** (2026-07-20): der #283-Slice prüfte die mTLS-Pflicht über
    einen ZWEITEN Harness — nicht die reale Klasse; ein Regress von `requestCert` in `agent-card.ts` blieb
    ungefangen. Neu `agent-card-mtls-wiring.test.ts` (+3): konstruiert den ECHTEN `AgentCardServer` mit
    In-Memory-TLS-Bundle (`createMeshCA`/`createNodeCert`, kein Secret, kein Port-Listen) und liest
    `requestCert`/`rejectUnauthorized` direkt vom darunterliegenden Node-`tls.Server` (`fastify.server`) ab
    — beweist agent-card.ts:229-230 (`requestCert=true` UND `rejectUnauthorized=true`), plus Bundle-Pfad
    schwächt nicht + Negativkontrolle. **Mutations-verifiziert** (`requestCert:false` → Test rot). Suite
    **1831 grün**. Test-only/additiv, kein Deploy/Secret.
  - [x] **TL-11 Slice-B Integrations-Runbook (Prep)** (2026-07-19): `docs/RUNBOOK-TL-11-wake-supervisor.md` —
    operativer Companion zur Consumer-Contract-Spec: Verortung (derselbe Host/Loopback, sonst `4003`),
    vorhandenes Client-Cert (kein Secret), Subscribe-Form, `.data`-Payload-Reaktion, Cold-Start-Sweep-Pflicht,
    **Zwei-Peer-Proof-Prozedur** + Verifikations-Checkliste + No-op-Rückfall. **De-riskt** Slice B, entfernt
    den Blocker NICHT (letzter Hop out-of-repo, Host-/Fenster-gated). Doc-only, kein Deploy/Secret.
  - [ ] **TL-11 Slice B** (extern-blocked): Out-of-Repo Agent-Home-Supervisor konsumiert `agent:wake` →
    weckt CLI (`pokeCli`); **Zwei-Peer-Live-Proof** (CLI-Reaktion ohne dazwischenliegenden Poll). Gegen den
    fixen Consumer-Contract (s.o.) **und jetzt das Runbook** baubar. **Echter Blocker:** der letzte Hop
    (Supervisor → CLI) ist out-of-repo + Deploy/Host-gated (vgl. `[[dod-two-peer-mcp-proof]]`,
    `[[week1-remote-restart-rollout]]`). Optional/danach: WS-Instanz-Bindung, Opt-in-Broadcast-Wake,
    Reconciliation-Sweep.
  - [x] 🟠 **TL-11 Sicherheits-Härtung: Frame-Pfad-Loopback-Loch GESCHLOSSEN** (entdeckt+gefixt 2026-07-16) —
    der `4003`-Loopback-Gate prüfte nur `query.agent` beim Connect; der Frame-Pfad `{type:'subscribe',agent:…}`
    setzte `agentFilter` **ohne** Loopback-Check → Nicht-Loopback-mTLS-Peer konnte per Frame fremde `agent:wake`
    abonnieren. **Fix:** reine `rejectsAgentFilter(agent,isLoopback)` von **beiden** Pfaden benutzt,
    `ClientState.isLoopback` am Connect aus `req.ip` gestempelt (kein `trustProxy` → nicht spoofbar), Frame-
    Verstoß schließt `4003` vor jeder State-Mutation. **Entscheidung:** konservativ strikt-loopback-only (die
    bereits gemergte Invariante) — keine Schwächung, kein neuer Beschluss. +15 Tests. Doc §8.1/§3 aktualisiert.
- [ ] **[v5.1] TL-13 (≈1 h je Rechner + ⛔ Fenster)** Re-Enroll .56/.222/.94 → `node/<PeerID>`; danach
  Duldungs-Ende Alt-Format aktivieren (Entsch. 17, spätestens **01.08.**). ↔ vgl. „Produktiv-Flotten-Flip"
  + `TLMCP_STRICT_IDENTITY`.
- [~] **[v5.1] TL-14a (≈3 h)** CA-Zweistufen-Umzug: Runbook (Offline-Wurzel-Zeremonie, Intermediate TH01,
  Geschwister-Intermediate TH02) — nur Papier+Skripte.
  - [x] **Scoping/Discovery** (2026-07-19): `docs/architecture/TL-14a-ca-two-stage-scoping.md` — Ist-Zustand
    gegroundet (heute flache Self-Signed-Root `createMeshCA` `tls.ts:59`, Root-Key online + ko-lokalisiert;
    Attesting-Pfad `cert-issuer.ts`), Zielhierarchie (offline Root → Intermediate TH01 → Geschwister TH02),
    bindende Beschlüsse konsolidiert (ADR-022/024/034, Decision-7, TL-13-Vorlauf), Runbook-Skelett (7 Schritte).
    **§5: 6 exakt offene Entscheidungen VOR Runbook-Volltext + Skripten** (Trust-Domain-Kopplung, `pathLen`,
    Intermediate-Validität, Cross-Sign vs. Cutover, Chain-Ausroll-Mechanik = TL-14b-Kern, TH02-Rolle).
  - [x] **Entscheidungs-Checkliste** (2026-07-19): `docs/architecture/TL-14a-decision-checklist.md` — die 6
    §5-Punkte als aktionierbares Change-Order-Register (Frage/Optionen/nicht-bindende Empfehlung/Abhängigkeit/
    Entscheider/blockiert/Status) + Kopf-Tabelle + Sign-off-Zeile. Nächster Schritt: Folge-CO (`pal:consensus`)
    über D1–D6 + Christian-Sign-off (D1/D4/D5/D6) → ADR.
  - [x] **Consensus-Brief D1–D6** (2026-07-19, #290): `docs/architecture/TL-14a-consensus-brief-D1-D6.md` —
    kompakte Abstimmungsvorlage.
  - [~] **`pal:consensus`-Lauf** (2026-07-19): `docs/architecture/TL-14a-consensus-result-D1-D6.md` —
    **Same-Vendor-2-Modell-Panel** (claude-opus 8/10 + claude-sonnet 7/10; `codex`+`agy` fehlen im PATH,
    `[[pal-review-backend-agy-missing]]` → kein Cross-Vendor-Pass). **Einstimmig 5/6** bestätigt; einzige
    Divergenz **D3-Laufzeit** (beide verwerfen ≥5 J: opus 12–24 Mon., sonnet 3 J → Korridor ~1–3 J, Owner-
    Entscheidung). Auflagen A (pathLen/Chain-Enforcement in `verifyPeerCert` `tls.ts:729`), B (Intermediate-
    Expiry-Monitoring fehlt), C (keine Revocation-Infra; sonnet: gepinnte Denylist statt CRL/OCSP) — beide
    Modelle: **blockierend**. **Optional:** Re-Run mit codex/agy für Cross-Vendor.
  - [~] **Auflage A + B gegroundet** (2026-07-19): `docs/architecture/TL-14a-blocker-AB-grounding.md` —
    code-verifiziert. **A:** pathLen/Chain **NICHT garantiert** — App-`verifyPeerCert` (`tls.ts:729`) ist ein
    flacher Ein-Aussteller-Verify (kein Chain-Building/pathLen; `verifyCertificateChain`/`createCaStore` = 0
    Treffer), genutzt von Pin-/Retention-/Trust-Distribution (`tls.ts:388/516/769`); Transport-mTLS
    (`agent-card.ts:225-231`) würde via Node-TLS prüfen, ist aber einstufig verdrahtet + für 2 Stufen
    ungetestet → D2 auf App-Pfad kosmetisch. **B:** **kein** Intermediate/CA-Expiry-Monitoring — Monitor liest
    nur `node.crt.pem` (`getCertDaysLeft`, `index.ts:1613`, `tls.ts:708-724`), rotiert nicht → Vorbedingung
    für D3. **Offene Folge-Slices (Code):** chain-fähiger Verify + Charakterisierungs-Test (A); `getCertDaysLeft`
    um CA/Intermediate-Quelle erweitern (B).
  - [~] **ADR-045 CA-Zweistufen-Hierarchie (Draft)** (2026-07-19): `docs/architecture/ADR-045-ca-two-stage-
    hierarchy.md` — **Status Proposed**. Entscheidet D1 (entkoppeln), D2 (`pathLen 0`), D4 (Doppel-Pin-Cutover),
    D5 (Token-Re-Onboard), D6 (TH02 kalt) konsens-getragen; **parkt D3** (Intermediate-Laufzeit, Korridor
    1–3 J) als einzige Owner-Entscheidung. Vorbedingungen A/B als blockierende Code-Folge-Slices verankert.
  - [ ] **Christian-Sign-off** — exakte D3-Laufzeit (1–3 J) setzen → ADR-045 auf `Accepted`; D1/D4/D5/D6-Gates
    bestätigen.
  - [~] **Vorbedingungs-Slices A + B** (Code, repo-safe, non-gated):
    - [x] **A — Charakterisierungs-Test** (2026-07-19): `tls-chain-characterization.test.ts` — belegt
      regressionsfest, dass `verifyPeerCert` ein **flacher Ein-Aussteller-Verify** ist:
      `verifyPeerCert(root, leaf@intermediate) === false`, nur der **direkte** Aussteller (Intermediate)
      verifiziert (+4 Tests, Suite 1756 grün). **Kein Fix** — dokumentiert die Lücke.
    - [~] **A — chain-fähiger Verify** (2026-07-20): neue Primitive `verifyPeerCertChain(trustAnchorPems,
      chainPems)` (`tls.ts`) — volle Ketten-Verifikation (forge `verifyCertificateChain`: Signaturen/
      Gültigkeit/`cA`-Flag) **+ manuelles `pathLenConstraint`-Enforcement** (forge-Lücke: forge prüft pathLen
      NICHT — belegt + gefixt). +6 Tests (`chain-verify.test.ts`: gültige 2-Stufen-Kette, **pathLen-0-Reject**,
      Charakterisierung-Kontrast, Fremd-Anker, unvollständige Kette, fail-closed). Der **flache** `verifyPeerCert`
      + Charakterisierungs-Test #295 bleiben unverändert.
      - [x] **A2 — Rewire `isRetainableCanonicalCert`** (2026-07-20): auf `verifyPeerCertChain(attestingCaPems,
        [certPem])` umgestellt (single-tier äquivalent). **Voraussetzung dafür gehärtet:** `verifyPeerCertChain`
        prüft jetzt auch das **Anker-Gültigkeitsfenster** (ADR-024 MEDIUM-1) — forge tut das nicht (Probe:
        `verifyPeerCertChain([expiredCA],[leaf])` gab fälschlich `true`); +1 Test. `tls.test.ts` 49/49 grün
        (inkl. abgelaufene-Attesting-CA-Retention), Suite **1769 grün**.
      - [ ] **A2-rest** (bewusst NICHT rewired): `selectTrustDistributionCa` (Semantik „welche CA verifiziert
        direkt" → gibt CA zurück, nicht bool) + Token-Onboard (Single-Anchor-Direktprüfung) — flacher
        `verifyPeerCert` ist dort der natürliche Fit; Rewire erst falls 2-Tier es erfordert (TL-14b).
    - [x] **B — CA/Intermediate-Expiry-Monitoring** (2026-07-20): neue Quelle `getCaCertDaysLeft` (`tls.ts`,
      liest `tls/ca.crt.pem`) + `subject`-Label im `cert-expiry-monitor` (Default `'Node'` → Meldungen byte-identisch, Audit-Detail additiv) +
      zweiter CA-Monitor in `index.ts` (subject `'CA'`, gleiche Schwellen, im Shutdown geräumt). Damit ist die
      CA/das Intermediate **live** überwacht (vorher nur Node-Leaf). +6 Tests, Suite **1762 grün**. Reissue
      bleibt Start-gebunden (own-CA); token-onboarded/künftiges Intermediate = eigener Pfad.
  - [ ] **Runbook-Volltext + Zeremonie-Skripte** (nach Sign-off/ADR-045, Papier+Skripte, non-gated).
- [ ] **[v5.1] TL-14b (≈4 h, ⛔ Termin)** CA-Umzug durchführen (mit Christian). ↔ vgl. Decision-7
  Trust-Domain-Flip (KW30).
- [ ] **[v5.1] TL-15 (≈3 h)** Uhr-Abweichungs-Erkennung zwischen Partnern (Skew-Messung im
  Handshake/Heartbeat, Alarm ab Schwelle; Kap. 3.5/3).
- [ ] **[v5.1] TL-16 (≈3 h + ⛔ Fenster)** Tresor-Passphrase von der Platte lösen (systemd-credentials);
  Startweg dokumentieren. ↔ vgl. bestehend „Unsicherer Vault-Default" (env/Keychain/random erledigt) —
  dies ist der Off-Disk-Folgeschritt.
- [ ] **[v5.1] TL-17 (≈4 h)** Fremdtext-Kontrakt: Entschärfungs-Modul an den Eintrittspunkten
  (Discovery-Banner, Katalogtexte, fremde Antworten; Kap. 10.3).
- [ ] **[v5.1] TL-18 (≈2 h)** place-or-refuse: >90 % RAM → Ablehnung + Alarm (Ressourcen-Daten laufen live).
- [ ] **[v5.1] TL-19 (≈4 h)** Verbindungs-Pooling + Sicherungs-Schalter je Owner-Peer; `resolveMcp` meidet
  kranke Anbieter.
- [ ] **[v5.1] TL-20 (≈3 h)** Pro-Rechner-Transportpolitik (ADR-031) + Relay netzweit „aus" (Entsch. 5).
- [~] **[v5.1] TL-21 (≈4 h)** Skelett-Auskunft (Kap. 06): zweistufig „Übersicht (Name + 1 Satz) → Details
  auf Abruf" am lokalen Daemon. Design: `docs/architecture/TL-21-skeleton-disclosure.md`.
  - [x] **Slice 1** (2026-07-16, #281): REST `GET /api/capabilities/overview` (dedupliziert pro `skill_id`, Name +
    erster Satz + Health-Aggregation) + reines Modul `capability-skeleton.ts` (`firstSentence`,
    `buildCapabilitySkeleton`), +13 Tests. Stufe 2 = bestehendes `/api/capabilities?skill_id=`. Read-only/additiv.
  - [x] **Slice 2** (2026-07-17): identische Skelett-Projektion als MCP-Tool `list_capabilities_overview`
    (Agent-Kontext-Ökonomie). Gemeinsamer Envelope-Builder `buildCapabilityOverview` von REST **und** MCP
    benutzt → strukturelle Parität (kein Drift, CR-MEDIUM-Fix). +6 Tests (echtes registriertes Tool via
    `_registeredTools[name].handler` invoked; Envelope-Unit). Read-only/additiv. Optional danach: Skelett
    für Peers/Tools/Tasks.
  - [x] **Slice 3 (Peers)** (2026-07-20): REST `GET /api/peers/overview` + reines Modul `peer-skeleton.ts`
    (`buildPeerSkeleton`/`buildPeerOverview`, `{ agent_id, name, status, version, skills:count, load_percent }`,
    sortiert nach `agent_id`) — ersetzt für „wer ist im Mesh?" die vollen Agent-Card-`capabilities`-Arrays durch
    **Zähler**; same-source `getOnlinePeers()`, Details via unverändertes `GET /api/peers`. Total gegen malformed
    Wire-Card-Daten (kein 500er). +15 Tests, Suite **1824 grün**. Read-only/additiv. Optional danach: MCP-Tool
    All-known-Variante (inkl. offline) = eigener Slice (neuer Mesh-Getter). Tools/Tasks-Skelett bleibt offen.
  - [x] **Slice 4 (Peer-MCP-Tool)** (2026-07-20): identische Peer-Skelett-Projektion als MCP-Tool
    `list_peers_overview` (Agent-Kontext-Ökonomie). Gemeinsamer Envelope-Builder `buildPeerOverview` von REST
    **und** MCP benutzt (same-source `getOnlinePeers()`) → strukturelle Parität, kein Drift — genau die
    Trennung wie Slice 1→2. +4 Tests (echtes registriertes Tool via `_registeredTools[name].handler`;
    Envelope-Parität; leeres Mesh; malformed-Card→kein throw), Suite **1828 grün**. Read-only/additiv.
    Tools/Tasks-Skelett bleibt offen.
  - [x] **Slice 5 (Task-Skelett REST + MCP)** (2026-07-21): dasselbe Muster für **Tasks** — reines Modul
    `task-skeleton.ts` (`buildTaskSkeleton`/`buildTaskHistogram`/`buildTaskOverview`), REST `GET /api/tasks/overview`
    + MCP-Tool `list_tasks_overview`, beide über den **einen** Envelope-Builder `buildTaskOverview(tasks.getAllTasks())`
    → strukturelle Parität, kein Drift. Ein Eintrag pro Task ersetzt die vollen `input`/`result`/`error`-Blobs durch
    Signale (`{ id, skill_id, state, executor, has_result, has_error }`, sortiert nach `id`); zusätzlich ein
    Status-Histogramm `by_state` (Invariante `Summe===count`) — der Kontext-Ökonomie-Gewinn „was läuft gerade?".
    Total gegen malformed/geforgte Felder (kein 500er; unbekannter `state`→`requested` konsistent gezählt).
    +25 Tests (18 pure `task-skeleton.test.ts` + 4 MCP `mcp-server.test.ts` + 3 REST `dashboard-api.test.ts`),
    Suite **1856 grün**. Read-only/additiv, `index.ts` unangetastet. Verbleibt offen: **Tools**-Skelett
    (MCP-Tool-Fläche selbst) = eigener Slice, dasselbe Muster.

### P2 — Ausbau
- [ ] **[v5.1] TL-22a (≈4 h)** Mesh-Dateiübertragung Slice 1 (Chunk-Endpunkt am 9440, Prüfsummen je Stück;
  ADR-015 reaktivieren statt neu schreiben).
- [ ] **[v5.1] TL-22b (≈4 h)** Slice 2: Wiederaufsetzen nach Abbruch, Gesamtprüfsumme, `.tlskill`-Paket als
  erster Nutzlast-Typ.
- [ ] **[v5.1] TL-23 (≈1 h)** Tote GraphQL-Schnittstelle entfernen (`graphql-api.ts`, kein Aufrufer —
  Befund 04.07.).
- [ ] **[v5.1] TL-24 (nach Beta)** ADR „Erneuerung ohne Neustart" (TLS-Hot-Reload). ↔ vgl. bestehend
  „Hot-Reload TrustStore #117" (verwandt, aber Trust-Store ≠ Cert-Renewal).

### P0 — Discovery-Resilienz (ADR-035; Neustart-Wellen heilen nicht — Christian 11.07.)
- [x] **[v5.1] TL-25a** Card-Fetch-Retry mit Backoff im Async-Learn (ADR-035 A3). *Erledigt: dieser PR.*
- [x] **[v5.1] TL-26** Peer-Cache-Persistenz (ADR-035 A1). *Erledigt: dieser PR.* CO (`pal:consensus`,
  einstimmig **Option A / Locator-only**, s. `docs/architecture/ADR-035-A1-peer-cache-CO-brief.md`):
  persistiert NUR Locator (kein publicKey → Platte ist keine AUTHN-Quelle), TTL 14d, Cap 512 LRU,
  fail-closed, atomarer chmod-600-Write. **Verhaltens-inert** (Boot-Ziele für A2). ⚠️ **A2/TL-27 muss
  unmittelbar folgen** — A1 allein behebt den Outage nicht.
  - ⏳ **Cross-Vendor-CO-Follow-up:** GPT-5/Gemini liefen nicht (codex/agy nicht im PATH); CO lief auf
    2 Claude-CLI-Modellen. Bei Bedarf stärkeren Cross-Vendor-CO aus einer Shell mit codex/agy nachziehen.
- [x] **[v5.1] TL-27** Aggressives Boot-Re-Learn (ADR-035 A2). *Erledigt: dieser PR.* Konsumiert die
  A1-Boot-Ziele (`mesh.getBootReLearnTargets()`), stellt die AUTHN-Auflösung nach Restart selbst her.
  **INV-A2-1** erfüllt: je Dial ein dedizierter, HART auf `expectedSpiffeUri` gepinnter mTLS-Dial
  (`spiffeServerIdentity:true` nur für diesen Dial + `makeMeshCheckServerIdentity` → volle Chain +
  SPIFFE-SAN-Match, unabhängig vom global-AUS D2b-Flag; `certFingerprint` bleibt HINT). **INV-A2-2**
  erfüllt: `isReLearnHostAllowed`-SSRF-Gate + Timeout + Rate-Limit. Kein neuer CO nötig (Primitive
  `verifyMeshServerIdentity` schon ADR-028-D2b-CO-blessed; A2 wendet sie maximal strikt an). **Offen:
  Zwei-Peer-Restart-Live-Proof** (Peer-Fenster).
- [x] **[v5.1] TL-28** Periodisches mDNS-Re-Query (ADR-035 A4a). *Erledigt: dieser PR (`reQuery()`/`resolveMdnsRequeryIntervalMs`).*
- [x] **[v5.1] TL-28b** Identitäts-gebundener `remoteAddress`-Fallback (ADR-035 A4b). *Erledigt: dieser PR.*
  Reaktiviert den in #258 verschobenen Fallback — der Fallback-Fetch läuft NUR über einen per-Dial
  hart auf `expectedSpiffeUri` gepinnten mTLS (`pinned-card-fetch.ts`, geteilt mit A2), unabhängig vom
  global-aus D2b-Flag → kein Christian-Gate mehr nötig. Fehlt Adresse/Pin-Dep → fail-closed; Source-IP-
  Pfad unverändert. Adversarial-Regressionstests (Fremd-Card→rejected; kein ungepinnter Pfad).
- [ ] **[v5.1] TL-29 (≈5 h)** Hub-verankerte Pull-Discovery (ADR-035 B): `/api/mesh/peers`-Endpoint (mTLS)
  + Client-Pull + Fallback-Kette (Cache/mDNS/static). Skaliert O(n) statt O(n²). ⚠️ Architektur → CO.

---

## Follow-ups aus Code-Reviews :

> **Doku-Konvention (ab 2026-06-15 15:51):** Datumsangaben in .md mit Uhrzeit `hh:mm`. Ältere Einträge tragen Pre-Konventions-Daten (historisch belassen).
> **Hygiene 2026-06-15 16:19:** gemergte PRs abgehakt; .55-Posten unter ADR-027 konsolidiert (korrigierte Root-Cause ersetzt die alten Dual-Default-Route/mDNS-Pin-Thesen).

### ✅ Erledigt / gemergt
- [x] **#168 ADR-026 Symmetrische Auth-Peer-Discovery** (commit 58377b8) — 403-„Unknown sender"-Fix; AUTHN-only seen-map + `isApprovedPeerSender`-AUTHZ-Gate. Fleet-deployed.
- [x] **#169 Static-Peer Online-Self-Healing** (b1e5b48) — Steady-Reconcile immer (mdns-unabhängig) + `onPeerOnline` beim Re-Connect.
- [x] **#170 emit_canonical_sender Default true** (a804f2f) — committed-Default false→true; sicher via Fail-safe-Interlock; behebt Legacy-Reversion beim `git pull`.
- [x] **#165 ADR-024 Canonical-Cert-Retention** (357842f) — re-enrolltes canonical Cert wird behalten. **Rest-MEDIUMs geschlossen** (v0.34.20 / **#191 gemergt 2026-06-23**) → s. „ADR-024-Rollout-Gate" unten (offen nur noch Re-Enroll = Deploy-Gate).
- [x] **#166 ADR-025 .55-Mesh-Join** (92e6058) — mdns_enabled=false + Static-Peer-Reconciler + preferred_interfaces.
- [x] **Owner-wins ADR-020 v2.2** (v0.33.0) — HYBRID, availability direct-only (owner-gated Side-Map).
- [x] **JWT-on-mTLS** (v0.32.1) — Option A „mTLS-only"; toter JWT-Hook entfernt, Doku korrigiert.
- [x] **#164 .55 mDNS-Interface-Pin** (v0.34.5) — beide mDNS-Quellen abschaltbar. **Theorie überholt:** Root-Cause ist NICHT der mDNS-Pin (s. ADR-027).

### Offen — .55 ins Mesh (konsolidiert unter ADR-027)
- [ ] 🟠 **.55 Pfad A (Tailscale-Bridge) = AKTIVER Mesh-Weg** — config-only, Runbook `docs/RUNBOOK-55-A-tailscale-bridge.md` (Doku-PR #171). `.55 peers_online=3` heute (TH01/TH02/.94 haben Tailscale); **für 6: `tailscale up` auf .52/.56/.222** (Produktiv-Gate) + deren 100.x ergänzen. **Apply nur Christian via Jump-GUI, kein blind-ssh.**
- [ ] 🟡 **.55 Pfad C2 (Netzkonfig-Reset, Hygiene)** — `docs/RUNBOOK-55-C2-netconfig-reset.md`: Geister-en1-6 + Surfshark entfernen (Jump-GUI), Reboot=FileVault-Gate; Eskalation **C1** (WD-D50-Dock tauschen) falls Dock-HW die Wurzel. **Korrigierte Root-Cause:** wedged macOS-netstack/Dock-HW (Daemon-stopped-Test: raw `net.connect` EHOSTUNREACH) — NICHT Daemon, NICHT (nur) Dual-Default-Route. ADR-027 + Memory.
- [ ] 🟠 **ADR-024-Rollout-Gate (= „Identität voll canonical", vor Re-Enroll .56/.222/.94)** — die 2 CR/PC-MEDIUMs aus #165: (a) CA-Gültigkeit `notBefore/notAfter` fail-closed im Retention-Verify + Test — ✅ **geschlossen (v0.34.20, `verifyPeerCert` caValid + Tests)**; (b) Trust-Distribution-Lifecycle retained fremd-Certs + Test — ✅ **geschlossen (v0.34.20, `selectTrustDistributionCa` fail-closed + Tests)**. **PR #191 gemergt 2026-06-23 — Code auf main.** **Offen nur noch:** Re-Enroll .56/.222/.94 → 100% canonical-emit = **Christian-Deploy-Gate** (kein Re-Enroll/Deploy ohne Christians Wort).

### Offen — Backlog (Design-First, nächste Sprints)
- [x] 🟡 **registry_sync-Coordinator `getPeerId`-Bug + Capability-Count-Drift** — `multiaddrs[0].getPeerId is not a function` → ✅ **gefixt via #175 (4b55f69, `libp2p-runtime.ts` `toPeerId`/`peerIdFromString` in dialProtocol+hangUp)** + ✅ **Repro/Regressionstest #204 (v0.34.31): nagelt die Original-Fehlersignatur fest, empirisch bewacht (Fix-Revert → 5 Tests rot, restore → grün).** (5-Tage-Plan B7, Teil 1.) **Offen nur noch:** Live-Re-Check `/api/status converged` = **Deploy-Gate** (laufende Daemons pre-#175, Diagnose #194 — Christian).
- [ ] 🟡 **ADR-028: intelligente NIC-Auswahl + allowed-CIDR überstimmt `tailscale*/utun*`-Exclude** — ermöglicht .55-self-advertise über Tailscale + saubere mDNS-NIC-Wahl. (5-Tage-Plan B4/B5.) **Repo-Code erledigt (v0.34.34):** `selectMeshInterfaces` — eine IP in einem explizit gesetzten `allowed_mesh_cidrs` überstimmt jetzt den `tailscale*/utun*`-Exclude (default-neutral; +5 Tests, empirisch guard-bewiesen). **Offen nur noch:** Live-Aktivierung auf `.55` (Config `allowed_mesh_cidrs=["10.10.10.0/24","100.64.0.0/10"]` + Tailscale auf den Peers) = **Christian-Deploy-Gate** (Pfad A, RUNBOOK-55-A).
- [ ] 🟡 **ADR-029: macOS-LaunchDaemon-Installer** — durable Start, Env-durable, KeepAlive/RunAtLoad, kein mystery-relauncher, FileVault-aware. (5-Tage-Plan B6.) **Repo-intern erledigt:** Doku/Template/Render-Kern (v0.34.21/#192), **Installer-Umbau `install.sh`→System-Domain + bootstrap + Uninstall (#196)**, Operator-Runbook (v0.34.27/#200), **Homebrew-Formel + USER-GUIDE angeglichen (v0.34.28/#201)**. **Offen nur noch (Christian-Deploy-Gate):** tatsächliches `install.sh`/`bootstrap system`-Ausführen + Service-User-Anlage + Live-Install/Reboot (FileVault).
- [ ] 🟡 **Owner-wins Phase-2: signierte Per-Key-Origin-Provenance** (ADR-020 v2.2 Phase-2) — additiv, Schema-Feld `provenance` reserviert. Nötig falls Mesh sparse/partitioniert.
- [ ] 🟡 **CLI-Join: request-lokaler TLS-Skip statt prozessweit** (v0.30.1) — undici-`Agent({connect:{rejectUnauthorized:false}})` + dispatcher; braucht undici als CLI-Dep.
- [x] 🟡 **KW29 Bug-Pfad 1 — Phantom-ROT von unten (`peers_online=0` trotz bekannter Peers)** (2026-07-16 14:50) — `/api/status` exponierte nur `peers_online`; ein fehlschlagender **ausgehender** HTTP-Heartbeat (CA-Rotation/SAN/EHOSTUNREACH) markiert alle Peers `offline`, obwohl sie im Map bleiben → Board färbt ROT ohne „0 bekannt" von „N bekannt, 0 online" trennen zu können. ✅ **Sichtbar gemacht (PR-Slice `getPeerCounts` → `peers_known`/`peers_offline` auf `/api/status` + `mesh_status`; Live-Beleg TH01 6 known / 3 online; DIAGNOSE §9; CR APPROVE, 1706 grün).** **Offen (out of scope, Christian-gated):** das eigentliche Cert-/CA-/SAN-Heilen der Fleet (`mesh-ca-rotation-repair-all` / `th55-pathA-cert-san-blocker` / `th55-ehostunreach-host-routing`). Transport-Phantom-ROT (Konsument→Knoten) = #272.
- [~] 🟡 **KW29 Bug-Pfad 2 — `.55` Log-Flut (zwei getrennte Hälften)** (einsortiert 2026-07-17, #284) — Beleg/Issue-Vorlage: `docs/BUGPFAD-2-logflut-status.md`.
  - [x] **2a `mount: command not found`-Flut (Unit-PATH ohne `/sbin`)** — repo-seitig GESCHLOSSEN: #273 (`f57ae5a`) `/usr/sbin:/sbin` an allen 7 Unit-PATH-Stellen + Regression-Test `launchd-plist.test.ts` (25 grün). Root-Cause: `DIAGNOSE-55-mount-command-not-found-flood.md`. **Offen:** `.55`-Live-Beleg (Runbook `VERIFY-55-mount-flood-fix.md`, operator-/deploy-gated, kein Christian-Gate).
  - [ ] **2b Unbegrenztes Log-Wachstum (keine Rotation)** — OFFEN: `daemon.log`/`daemon.error.log` append-only (launchd `StandardErrorPath` / systemd `append:`), Logger nach stdout (`logger.ts` pino `destination:1`), **keine** Rotation/Size-Cap/newsyslog/logrotate im Repo. Fix = eigener Deploy-/Unit-Slice (macOS `newsyslog.d` / Linux `logrotate`) oder daemon-seitig `pino-roll` (Code-Slice, **CO** zur Weg-Wahl). Noch NICHT umgesetzt.

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
  - [x] **Follow-up (nicht-blockierend):** (a) ✅ **erledigt (v0.34.54, PR 127a):** Mesh-Peer-Eintrag wird bei krypto-attestiertem Flip auf die kanonische agentId umgeschlüsselt (`mesh.ts` `markPeerIdVerified`, Map-Key + `peer.agentId`, transaktional, nur eindeutiger PeerID-Pfad; kosmetisch/Bookkeeping + 3 Tests); (b) ✅ **erledigt (v0.34.52, PR 127b):** token-onboarded TLS-Bundle wird beim Laden fail-closed gegen `ca.crt.pem` validiert (`tls.ts` `loadOrCreateTlsBundle`, `certKeyMatches && verifyPeerCert` + 6 Regressionstests); (c) ✅ **erledigt (v0.34.53, PR 127c):** dedizierter mTLS-Integrationstest `issuerCertificate.fingerprint256 === certFingerprint(ca.crt.pem)` — echter `node:tls`-Handshake gegen den Produktionspfad (`mtls-issuer-fingerprint.test.ts`, 6 Tests).
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
> **⚠️ 2026-07-01: `policy.ts`/`PolicyEngine` HART ENTFERNT** (war totes Modul, 0 Produktions-Importeure; erst @deprecated #222, dann entfernt). Nie an den Request-Pfad angeschlossen. Real verdrahtete Autorisierung: mTLS/Trust + `isApprovedPeerSender` (ADR-026) + Vault-Approval-Flow (`vault.createApprovalRequest`). Ein künftiger AUTHZ-Policy-Layer braucht ein eigenes ADR (nicht dieses Legacy wiederbeleben).
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
  - [x] `scripts/service/com.thinklocal.daemon.plist.template` angelegt mit Platzhaltern `{{RUN_USER}}`, `{{RUN_GROUP}}`, `{{DATA_DIR}}`, `{{CONFIG}}`, `{{NODE_BIN}}`, `{{REPO}}` (System-Domain, `UserName`/`GroupName`). Keine hartkodierten Literale (Regressionstest). Render+Validierung via `launchd-plist.ts` (fail-closed, XML-escaped). ✅ v0.34.21
  - [x] `scripts/install.sh` (macOS-Zweig): Template per `sed` (Werte escaped) → `/Library/LaunchDaemons/`, `chown root:wheel`/`chmod 644`, läuft als `${SUDO_USER}` (nicht root), fail-closed Placeholder-Guard. ✅ **#196** (v0.34.18 era), CR 3 MED+2 LOW gefixt.
  - [ ] Installer-Sub-Task: Wrapper-Skript `~/<user>/.thinklocal/bin/daemon-launchagent.sh` aus Template generieren (analog), `chmod +x`. Wrapper enthaelt Netzwartungs-Loop gegen `EHOSTUNREACH 224.0.0.251:5353`-Race.
  - [x] Installer prueft: `$SUDO_USER` gesetzt + nicht-root (`resolve_run_user_home`, Abbruch sonst, #196), Node 22+ (`check_prerequisites`, #196). Bestehender LaunchAgent wird beim Migrate **reversibel** gesichert (`unload` + `mv` → `.disabled.<datum>` statt `rm`) ✅ **v0.34.30**. (User-Existenz-Check via `dscl`/`id -gn` implizit.)
  - [x] `bootstrap`-Schritt im Script: `sudo launchctl bootstrap system …` (Label-Form bootout). ✅ **#196** (Ausführen = Deploy-Gate).
  - [x] Uninstaller-Pendant in `cleanup_existing` / `--uninstall`: `bootout system/<label>` + plist entfernen (Lauf-Nutzer-Home-aware). ✅ **#196**.
  - [x] Homebrew-Formel (`Formula/thinklocal.rb`) konsistent: `keep_alive successful_exit:false` + `run_type :immediate` + ADR-029-Caveat (headless→System-Domain-Installer). ✅ **#201** (v0.34.28).
  - [x] README/INSTALL.md / USER-GUIDE: macOS-Abschnitt auf LaunchDaemon umstellen, Wrapper-Sinn kurz erklaeren, FileVault-Hinweis aufnehmen. **Erfasst via v0.34.27 (`docs/operations/RUNBOOK-ADR-029-launchdaemon-operator.md`) + INSTALL.md-updates aus #196.** Operator-Runbook (Pre-Flight/Operator-Sequenz/Smoke/Reboot/Rollback) liegt vor; Vor-Ort-Termin = Christians Deploy-Gate (Gate #5-Sequenz).

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
- [x] 🟡 Security-Lifecycle: Cert-Rotation, Revocation, Trust-Reset — `cert-rotation.ts` + `crl.ts` (2026-04-05). **⚠️ 2026-07-01: `cert-rotation.ts` HART ENTFERNT** (war totes Modul, 0 Produktions-Importeure — RE-CHECK-Verdikt; erst @deprecated #221, dann entfernt). Kanonisch: Erneuerung via `loadOrCreateTlsBundle` (Reissue beim Start), Live-Alert via `cert-expiry-monitor.ts` (T2.1). (`crl.ts` bleibt unberührt.)
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
