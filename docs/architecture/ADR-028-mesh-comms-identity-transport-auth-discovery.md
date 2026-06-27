# ADR-028: Mesh-Comms — Agent↔Agent-Kommunikation reparieren (Identity / Transport / Auth / Authz / Discovery)

**Status:** **ACCEPTED** (2026-06-16 20:16, Christians 3 Entscheidungen — s.u.). Umsetzung gestaffelt D1→D4; **Merge/Deploy jedes PRs bleibt Christians Gate** (kein Produktiv-Rollout/Cert-Änderung/Daemon-Flip ohne sein Wort).
**Datum:** 2026-06-16 ~18:45 (Proposed) → 2026-06-16 20:16 (Accepted)
**Autor:** Claude (claude-code @ TH01, Design + Code-Verifikation), Christian (Auftrag + Freigabe der 3 offenen Punkte)
**CO:** `pal:consensus` — gpt-5.5 (for, 9/10) + gpt-5.3-codex (against, 8/10). Konsens: hoch. Beide einig bei Layer-Zerlegung + D1-first; Skeptiker erzwang 3 Härtungen (Authz-Layer, PKI-Vorbedingung, SyncHub=hybrid statt SPOF) — in dieser ADR eingearbeitet.
**Verwandt:** ADR-020 (RegistrySyncCoordinator — wird für D4 erweitert), ADR-022 (kanonische node/<PeerID>-Identität), ADR-026 (symmetric auth-discovery), ADR-027 (Overlay-Transport / .55), RUNBOOK-55-A, `[[th55-pathA-cert-san-blocker]]`, `[[macos-daemon-env-and-inbox-gaps]]`.

## Christian-Entscheidungen (2026-06-16, ACCEPTED)
1. **HTTPS-universal-Cutover (Sequenz Schritt 5): JA mitplanen** — nicht deferren; als expliziter geplanter Schritt nach D4 (Cutover-Plan unten).
2. **D4/SyncHub = den bestehenden ADR-020 `RegistrySyncCoordinator` ERWEITERN, KEIN Neubau** (Orchestrator-.94-Empfehlung; Christian kann redigieren). Die MCP-Capability-Registrierung wird zu einem zusätzlichen Replikations-Topic auf dem vorhandenen CRDT-Gossip-Substrat — der „hybride Index" ist also genau diese Erweiterung, kein separater Dienst.
3. **Priorität: JA — ADR-028 (D1…) VOR dem TH02-Phase-3-Flip-Blocker** (`[[th02-phase3-flip-blocker]]` wird zurückgestellt, bis D1 die kanonische Adressierung repariert hat — der Flip-Blocker hängt selbst an kanonischer Identität).

## Kontext — Mesh-Comms trägt nicht, trotz vorhandener Primitive

Die Primitive `discover_peers` / `query_capabilities` / `execute_remote_skill` / `send_message_to_peer` **existieren** (`mcp-stdio.ts`, `mcp-server.ts`), aber Agent→Agent-Kommunikation über das Mesh **funktioniert in der Praxis nicht**. Zwei reale Vorfälle:

### Fall A — .52 ioBroker: MCP nicht über Mesh auffindbar (Discovery-Layer)
Node .52 brauchte den MCP-Server `mcporter`, konnte über `query_capabilities` **nicht** ermitteln, **welcher Node** ihn hostet, und musste die `~/.mcporter`-Config **per SSH von .55 kopieren**. Ursache: MCP-Server sind **lokal pro Node** konfiguriert, **nicht** als mesh-weite, auffindbare + invokierbare Capabilities registriert. `execute_remote_skill` matcht nur generische Capabilities per `agent_id` — lokal konfigurierte MCPs bleiben unsichtbar.

### Fall B — Report an .94 unmöglich: kanonische Identität nicht adressierbar (Identity-Layer)
`POST /api/inbox/send` (und die MCP-Tools `send_message_to_peer` / `execute_remote_skill`) leiten das `to`-Feld durch `parseSpiffeUri()` / `normalizeAgentId()` (`spiffe-uri.ts`). Diese verlangen **hart** die Legacy-Grammatik `spiffe://thinklocal/host/<stableNodeId>/agent/<type>[/instance/<id>]`:

```ts
// spiffe-uri.ts:76-85
if (parts.length !== 4 && parts.length !== 6) throw ... // "got 2"
if (parts[0] !== 'host' || parts[2] !== 'agent')  throw ...
// normalizeAgentId() rebuildet IMMER `…/host/<id>/agent/<type>`
```

ADR-022 Phase 3 hat die Identitäts-**Emission** aber auf **kanonisch** `spiffe://thinklocal/node/<PeerID>` (2 Tokens) geflippt. Folge: kanonisch-only Nodes (z.B. Orchestrator **.94**, dessen agent-card **keine** Legacy-Alias mehr führt) sind **nicht adressierbar** → `send` scheitert mit „must have 3 or 4 components". **Selbst Agent→Agent-Reporting über das Mesh ist kaputt** (live verifiziert 2026-06-16 beim .55-Report).

### Fall C (verwandt, ADR-027) — Overlay-Dial scheitert an IP-SAN (Transport/Auth-Layer)
Peer-mTLS-Certs SANen nur die LAN-IP (z.B. `10.10.10.80`), nicht die Tailscale-100.x. `rejectUnauthorized:true` + IP-altname-Check → `ERR_TLS_CERT_ALTNAME_INVALID` beim Overlay-Dial. **Wichtig:** Die Certs tragen die **SPIFFE-URI als SAN bereits** (SPIFFE-mTLS) — der Default-TLS-Check vergleicht nur die **IP**, nicht die URI.

## Layer-Zerlegung der Root-Cause (Konsens beider Modelle)

| Layer | Root-Cause | Symptom | Fall |
|-------|-----------|---------|------|
| **L1 Identity** | `parseSpiffeUri`/`normalizeAgentId` kennen nur Legacy `host/agent`, nicht kanonisch `node/<PeerID>` | kanonisch-only Nodes unadressierbar | B |
| **L2 Transport** | Default-TLS validiert IP-altname statt SPIFFE-URI-SAN | Overlay/Cross-Subnet-Dial scheitert | C |
| **L3 Authz/Binding** | verifizierter TLS-Principal ist **nicht** an app-level `envelope.sender`/`to` gebunden | Spoofing-Risiko, bleibt auch nach L1/L2 | (latent) |
| **L4 Discovery** | MCPs lokal pro Node, nicht als mesh-Capabilities registriert/invokierbar | „welcher Node hat MCP X?" unbeantwortbar | A |

> **L3 ergänzt vom Skeptiker:** Identity + Transport allein verhindern Sender-Spoofing NICHT — der authentifizierte Cert-Principal MUSS kryptografisch an die App-Identität gebunden werden.

## Entscheidungen (mit CO-Härtungen)

### D1 (L1 Identity) — kanonische Grammatik first-class machen
- `parseSpiffeUri` um einen **`node/<PeerID>`-Arm** erweitern; ein **kanonisches Principal-Objekt** einführen: `{ trustDomain, nodePeerId, agentType?, instanceId? }`. **Keine** Reduktion auf mehrdeutige Strings; **Agent-Dimension (agentType/instance) nicht verlieren** (Skeptiker-Härtung).
- Kompatibilitäts-Shim: Legacy `host/agent` ↔ kanonisch `node/<PeerID>` (dual-accept). Vergleiche/Equality-Keys/Inbox-Routing/Capability-Matching/Cert-Vergleich an **eine** kanonische Compare-Funktion ziehen.
- **Root-Blocker — zuerst.** Ohne D1 trägt nichts.

### D2 (L2 Transport/Auth) — SPIFFE-mTLS über HTTPS als Prio-1, in ZWEI Schritten
- **D2a (PKI/Cert-Profil):** sicherstellen, dass jedes Cert die **SPIFFE-URI-SAN + korrekte EKU** trägt und das Trust-Bundle stabil verteilt ist. *(Bei uns ist die URI-SAN bereits vorhanden → D2a ist primär Verifikation, kein Fleet-Reissue.)*
- **D2b (Verifier + Binding):** custom `checkServerIdentity`, **fail-closed**:
  1. `rejectUnauthorized:true` bleibt; volle Chain/Expiry/EKU werden vom TLS-Layer weiter erzwungen (NICHT schwächen).
  2. IP/DNS-altname-Mismatch nur **nach** erfolgreicher CA-Chain-Validierung ignorieren.
  3. **Alle** URI-SANs scannen (nicht die erste); exakte Trust-Domain `spiffe://thinklocal/` + strikte `node/<PeerID>`-Grammatik erzwingen; keine Prefix-/Normalisierungs-Lockerung.
  4. **Erwartete Identität aus dem Dial-Target (Peer-Registry/static_peer-Eintrag) binden — NICHT aus dem präsentierten Cert.** Sonst kann jedes gültige Mesh-Cert jeden Peer impersonieren (Auth-Bypass). *(beide Modelle, Kern-Härtung)*
  5. Fail-closed bei fehlender/malformer URI-SAN, falscher Trust-Domain, mehrdeutigen SANs, Legacy-only nach Cutoff. Logge peerId, präsentierte URI, CA-FP, Dial-Adresse.
- **libp2p bleibt Fallback-Transport** (NAT-Traversal/Gossip-Resilienz) — nicht vollständig kaltstellen.

### D3 (L3 Authz/Binding) — TLS-Principal ↔ App-Identität
- Empfangsseitig (bereits teils via `authorizeHttpsSender`, ADR-022/026): `envelope.sender` MUSS gegen den **verifizierten Cert-SPIFFE-Principal** des mTLS-Channels geprüft werden (kanonisch). Inbox-`from`, Skill-Author, Audit-Identität ebenso. Das schließt die latente Spoofing-Lücke aus L1/L2-Sicht.

### D4 (L4 Discovery) — MCPs als mesh-Capabilities, SyncHub als HYBRIDER Index
- MCP-Server als **mesh-Capabilities registrieren** (Endpoint, Tool-Manifest, Health, Version, Scope, Invocation-Policy), **lease-based + node-signiert/mTLS-authentifiziert**.
- **SyncHub = Index/Beschleuniger ÜBER dem vorhandenen signierten CRDT-Capability-Gossip — KEINE harte Abhängigkeit / KEIN SPOF** (beide Modelle). Korrektheit muss auch ohne SyncHub gelten (dezentral); SyncHub liefert nur schnelle, deterministische Lookups. Kein „Hub publiziert Capabilities im Namen von Nodes" (Privilege-Escalation vermeiden).
- Ziel-UX: .52 fragt „wer hostet `mcporter`?" → Antwort „node X" → `execute_remote_skill` invokiert remote, **ohne SSH-Config-Kopie**.

## Sequencing (Konsens-verfeinert + Christian-Entscheidungen)
1. **D1** Identity-Kanonisierung + dual-accept + **Telemetrie** (legacy-vs-canonical-Nutzung). ← **als nächstes, vor TH02-Flip-Blocker (Entscheid 3)**
2. **D2a** Cert-Profil/PKI-Check (URI-SAN/EKU/Trust-Bundle).
3. **D2b** strikter SPIFFE-Verifier + **Principal↔App-Binding (D3)**.
4. **D4** Discovery-Rework als **Erweiterung des ADR-020 `RegistrySyncCoordinator`** (Entscheid 2) — MCP-Capability als zusätzliches CRDT-Replikations-Topic, hybrider Lookup-Index, kein neuer Dienst.
5. **HTTPS-universal-Cutover — GEPLANT (Entscheid 1)**, siehe Plan unten.

Jeder Schritt = eigener PR mit **vollständiger CO/CG/TS/CR/PC/DO**-Pipeline. Migration mit Instrumentierung (verification failures, registry staleness) **vor** jedem Hard-Cutover.

### Schritt 5 — HTTPS-universal-Cutover-Plan (Entscheid 1: JA)
Nach D1–D4 wird HTTPS(mTLS) :9440 von „CORE, libp2p sekundär" zum **expliziten universellen Primary** promotet; libp2p :9540 bleibt dokumentierter **Fallback** (NAT/Cross-Subnet), nicht abgeschaltet (Skeptiker-Härtung). Cutover-Gates:
1. **Vorbedingung:** D1+D2b+D3 grün auf allen 6 Core-Nodes (kanonische Adressierung + SPIFFE-Verifier + Principal-Binding), Migrations-Telemetrie zeigt 0 Legacy-only-Sender.
2. **Flag-gesteuert + reversibel:** Cutover hinter Config/Env-Flag pro Node, Rollback = Flag zurück (Lehre aus ADR-022/.55: nie Bare-Config, plist-Env/committed Default).
3. **Reihenfolge:** zuerst 1 Canary-Node, dann Fleet; libp2p-Fallback bleibt erreichbar bis 2 Wochen stabil.
4. **DoD-Cutover:** alle Core-Comms (inbox/registry-sync/skill-exec/heartbeat) laufen über HTTPS-Primary, libp2p nur noch als Fallback-Pfad gemessen.
5. **Merge/Deploy = Christians Gate** (wie alle Schritte).

## Sicherheit / Blast-Radius
- **Höchstes Risiko: D2b checkServerIdentity** — die 6 Bypass-Modi (loose prefix, Trust-Domain nicht exakt, erste-SAN-Falle, Normalisierungs-Äquivalenz, fehlendes App-Binding, versehentliches Schwächen der Default-Checks) sind im Verifier explizit auszuschließen + Regression-Tests je Modus.
- **L3-Binding** ist nicht optional — ohne es bleibt Sender-Spoofing trotz L1/L2-Fix.
- **SyncHub kein SPOF**: Partition/Outage darf Mesh-Korrektheit nicht brechen.
- mTLS/SPIFFE-Trust-Domain unverändert; 6-Node-Core nur additiv berührt.

## Definition of Done (akzeptanz, integrationstest-gedeckt)
1. **Fall B:** `send_message_to_peer` an .94 (kanonisch `node/<PeerID>`) liefert zu — Inbox-Roundtrip grün.
2. **Fall C:** .55 dialt Peers über Tailscale-100.x per mTLS, `peers_online` steigt (kein ALTNAME), Identität SPIFFE-validiert.
3. **Fall A:** ein Node ohne lokalen `mcporter` findet den hostenden Node via `query_capabilities` und invokiert ihn via `execute_remote_skill` — **ohne SSH**.
4. Spoofing-Negativtest: gefälschter `envelope.sender` ≠ Cert-Principal → 403.

## Offene Punkte (Christian) — ENTSCHIEDEN 2026-06-16
1. ~~„HTTPS universeller Primary"-Cutover jetzt mitplanen oder deferren?~~ → **JA mitplanen** (Schritt-5-Plan oben).
2. ~~SyncHub: neuer Dienst vs. Erweiterung RegistrySyncCoordinator?~~ → **ADR-020 erweitern, kein Neubau** (D4 oben).
3. ~~Reihenfolge ggü. TH02-Phase-3-Flip-Blocker?~~ → **ADR-028/D1 zuerst** (Flip-Blocker zurückgestellt).

## Umsetzungs-Status
- **D1** — IN ARBEIT (Branch `agent/claude-code/adr-028-d1-canonical-identity`): `parseSpiffeUri`/`normalizeAgentId` akzeptieren kanonische `node/<PeerID>`; Ziel: .94 wieder adressierbar. Code + Unit-Tests + CR + PC; Merge/Deploy = Christians Gate.
- **D2a/D2b/D3/D4/Cutover** — geplant, je eigener PR.

## NIC-Auswahl — allowed-CIDR überstimmt den `tailscale*/utun*`-Exclude (v0.34.34)

`selectMeshInterfaces` (`discovery-policy.ts`) schloss virtuelle Interfaces (`tailscale*`/`utun*`/`docker*`/…)
**vor** der `allowed_mesh_cidrs`-Prüfung aus → ein Tailscale-Interface (z.B. `utun4` mit `100.x`) wurde
verworfen, **bevor** seine IP gegen die erlaubten Mesh-CIDRs geprüft wurde. Folge: `.55` konnte sich nicht
über Tailscale self-advertisen (Overlay-Transport, ADR-027/Pfad A).

**Fix (kleinster, default-neutral):** eine IP, die in einem **explizit konfigurierten** `allowed_mesh_cidrs`
liegt, **überstimmt** den Exclude — der Betreiber hat diese CIDR bewusst als Mesh-Netz opt-in't (z.B.
`100.64.0.0/10`). Bei leerer `allowed_mesh_cidrs`-Liste greift der Override nie → Linux/Standard-Nodes
unverändert. Reine Auswahl-Logik (rein/testbar); kein Cert-/Flag-/Deploy-Eingriff. Live-Aktivierung auf `.55`
(Config + Tailscale auf den Peers) bleibt Christians Deploy-Gate (Pfad A, RUNBOOK-55-A).
