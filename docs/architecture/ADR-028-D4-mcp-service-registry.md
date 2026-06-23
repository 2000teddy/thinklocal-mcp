# ADR-028 D4 — Zentrale MCP-Service-Registry über den erweiterten RegistrySyncCoordinator

**Status:** Proposed (**reines DESIGN — docs-only**). **KEIN Code, KEIN Cert-Rollout, KEIN Flag-Flip.** Patch 2026-06-19: Christians Arbeitslinie eingearbeitet (Discovery **default-open**, **3-Stufen-Ausführung self/gate/consensus**, keine deny-by-default-per-Agent).
**Datum:** 2026-06-17 07:25 (Design) → 2026-06-19 11:30 (Arbeitslinien-Patch)
**Parent:** ADR-028 §L4 (Discovery). **Verwandt:** ADR-020 (RegistrySyncCoordinator + Automerge-CRDT), ADR-021 (owner-gegatete Availability-Side-Map), ADR-028 D1/D2/D2b/D3, CLAUDE.md („Daemon als transparenter MCP-Proxy").
**CO:** ADR-028-Konsens (D4 = **hybrider Index über dem bestehenden CRDT-Gossip, KEIN SPOF**) + **Christians Steuer-Entscheid Q2 = ERWEITERN (nicht neu)**.

## Problem (Fall A, real)
Shared MCPs (**UniFi / IDM / E3DC / markitdown**) sind **lokal pro Node** via `mcporter` konfiguriert und im Mesh **nicht auffindbar**. Folge: `.52` (ioBroker) konnte nicht ermitteln, *welcher* Node einen MCP serviert, und musste `~/.mcporter` **per SSH von .55 kopieren**. Es fehlt: „**wer serviert MCP X**" (Auflösung) + **Request-Routing über mTLS** (kein SSH).

## Bestandsaufnahme (geerdet — was schon trägt)
- **CRDT-Registry** (`registry.ts`): `RegistryDoc.capabilities: Record<"${agent_id}::${skill_id}", Capability>`. `Capability` = `{ skill_id, version, description, agent_id (SPIFFE), health, trust_level, category, permissions, updated_at }`. **Owner-gegated** (`importPeerCapabilities`: `cap.agent_id === envelope.sender`), gesynct via **RegistrySyncCoordinator** (ADR-020).
- **Auflösung existiert:** `query_capabilities(skill_id?, category?)` → `/api/capabilities` (liest die replizierte Registry).
- **mTLS-Routing existiert:** `execute_remote_skill` löst `skill_id` → gesunde Capability → Peer-Endpoint (`/api/peers`, `agent_id→host:port`) → führt **über den mTLS-Dispatcher** aus (**kein SSH**; Bug-Fix 2026-05-19).
- **Availability:** ADR-021 owner-gegatete, NICHT-replizierte Side-Map (Health pro `agentId::skillId`).
- **Lücke:** **MCP-Server sind KEINE Capabilities** — sie tauchen nie in der Registry auf, daher nicht auflösbar/routbar.

## Entscheidung (Q2 = ERWEITERN): MCPs als namespaced Capabilities im bestehenden CRDT
**SyncHub = der ERWEITERTE RegistrySyncCoordinator**, kein neuer Dienst. Jeder geteilte MCP wird als Eintrag in der **bestehenden** `capabilities`-Map repräsentiert:
- `skill_id = "mcp:<server>"` (z.B. `mcp:unifi`, `mcp:idm`, `mcp:e3dc`, `mcp:markitdown`)
- `category = "mcp"`, `agent_id` = servierender Node, `health` + Availability via **ADR-021-Side-Map** (MCP-Prozess up?), `trust_level`/`permissions` zur Ableitung der Ausführungsstufe, **aussagekräftige `description` + angebotene Tools** (was der MCP tut — damit ein fremder Agent ohne Vorwissen entscheiden kann) + `version` aus dem MCP-Manifest. Die **Ausführungsstufe** (`execution_tier: self|gate|consensus`) ist Teil der Beschreibung (default-ableitbar aus `permissions`/`trust_level`).
- **Gleicher Owner-Gate, gleicher Gossip, gleiche Genesis** → keine neue Sync-Schicht, kein SPOF (ADR-028-Konsens: „hybrider Index über CRDT-Gossip").

> **Alternative erwogen + verworfen:** parallele `services`-Map in `RegistryDoc` → mehr Schema-/Code-Churn, eigener Owner-Gate/Query-Pfad. Die **namespaced-Capability**-Variante wiederverwendet Owner-Gate, Health (ADR-021) und `query_capabilities` **verbatim** → minimaler Eingriff, exakt „erweitern statt neu".

## Auflösung (Acceptance: von .52 „wer serviert UniFi-MCP")
- `query_capabilities(category="mcp")` listet alle `mcp:*`; Komfort-Primitive **`resolve_mcp(server)`** → `{ agent_id, endpoint, health, trust_level }` der servierenden Node(s), gelesen aus der **replizierten** Registry.
- **Von .52:** `resolve_mcp("unifi")` (oder `query_capabilities(category=mcp, skill_id="mcp:unifi")`) liefert den servierenden Peer über das Mesh — **CRDT-repliziert, kein SSH**. ✅ Akzeptanzkriterium erfüllt.

## Request-Routing über mTLS (kein SSH) — „Daemon als MCP-Proxy"
- **Neuer Daemon-Ingress `/api/mcp/<server>`** (Folge-Code): nimmt MCP-JSON-RPC entgegen.
- **Owner == self:** Daemon führt den lokalen MCP via `mcporter` aus (lokaler stdio-Proxy, wie heute für eigene MCPs).
- **Owner == remote:** Daemon **forwardet** den MCP-Call über den **bestehenden mTLS-Dispatcher** an `/api/mcp/<server>` des Owners — **interlockt mit D2** (`checkServerIdentity`/Pin auf dem Forward-Dial) **und D3** (Sender-Binding auf dem Ingress). Reuse des `execute_remote_skill`-mTLS-Pfads.
- Ergebnis: ein Agent (z.B. auf .52) ruft seinen lokalen Daemon-MCP-Proxy; der Daemon löst über die Registry auf und routet transparent zum Owner — **ohne** dass der Agent weiß/braucht, *welcher* Node serviert.

## markitdown entblocken (Variante B: central via mcporter, wie pal)
- Ein Admin baut/serviert `markitdown` **einmal zentral** via `mcporter` (analog zu `pal`) auf einem Node und registriert `mcp:markitdown` (category=mcp) → der Eintrag gossipt fleet-weit → **jeder Node löst markitdown auf und routet dorthin**. Kein per-Node-Build, kein SSH-Config-Kopieren. → **Admin-Bau entblockt.**

## Discovery-Policy — DEFAULT-OPEN (Christians Arbeitslinie, 2026-06-19)
- **Discovery + Auflösung sind default-open.** Lokal als „shared" markierte MCPs werden **automatisch** als `mcp:<server>` announced; **jeder** Mesh-Peer darf sie auflösen und anfragen. **Kein opt-in-Allowlist, kein deny-by-default, KEINE per-Agent-Allow/Deny-Welt.**
- **Opt-out statt opt-in:** ein Node kann einen lokalen MCP per Config explizit vom Sharing ausnehmen (`share=false`), Default ist `share=true` für als shared deklarierte MCPs. Risiko wird **nicht** über Discovery-Sichtbarkeit gesteuert, sondern über die **Ausführungsstufe** (s.u.).
- **Aussagekräftige Beschreibung:** jeder `mcp:<server>`-Eintrag trägt eine mensch+ agent-lesbare `description` (was der MCP tut), `category="mcp"`, `version` (aus dem MCP-Manifest) und die angebotenen Tools/Capabilities — damit ein konsumierender Agent ohne Vorwissen entscheiden kann, ob der MCP passt.

## Ausführungs-Modell — 3 Stufen: self / gate / consensus
Discovery/Auflösung offen; das **Ausführungs**-Risiko wird pro MCP-Aufruf über eine von drei Stufen gesteuert (NICHT über Per-Agent-Allowlists):
- **self** — risikoarm/read-only/idempotent → der servierende Node führt **automatisch** aus (kein Mensch nötig). Default für unkritische MCPs (z.B. markitdown, read-only-Queries).
- **gate** — seiteneffekt-/credential-behaftet (UniFi/IDM/E3DC-Schreibzugriff, Credential-Nutzung) → **Human-Approval-Gate** (CLAUDE.md: Credential Sharing/Skill Transfer) vor der Ausführung; Approval-Audit.
- **consensus** — hoch-impaktierend/destruktiv → Mehr-Parteien-Bestätigung (mind. zwei Approver / Orchestrator-Konsens) vor der Ausführung.
Die Stufe ist Teil der Service-Beschreibung (`execution_tier: self|gate|consensus`, ableitbar aus `permissions`/`trust_level`), default **self** für read-only, **gate** sobald Credentials/Schreibzugriff im Spiel sind. Fail-closed nur auf der EXECUTION-Ebene (unklare Stufe → mindestens `gate`), nie auf der Discovery-Ebene.

## Sicherheit / Blast-Radius
- **Owner-Gate (Write):** nur der servierende Node schreibt seinen `mcp:<server>`-Eintrag (`importPeerCapabilities` erzwingt `agent_id===sender`) — kein Fremd-Announce. (Das ist KEINE per-Agent-Deny-Welt, sondern Authentizität des Eintrags.)
- **D3 (Route-Request):** der MCP-Proxy-Ingress bindet den Aufrufer an seinen Kanal-Principal (Sender-Binding, fail-closed) — für Audit/Stufen-Entscheid, NICHT als Discovery-Sperre.
- **D2 (Forward-Dial):** Server-Identität des Owners SPIFFE-validiert + gepinnt.
- **Ausführung:** 3-Stufen-Modell (self/gate/consensus, s.o.) statt eines binären Gates; Audit jedes MCP-Routings + jeder Approval.
- **Kein SPOF:** Auflösung lebt im replizierten CRDT; fällt ein Provider aus → Health/Availability markiert ihn offline, Routing überspringt ihn (Multi-Provider-Failover, s. offene Punkte).

## Abgrenzung / Interlocks
- **D1:** Owner-`agent_id` ist die kanonische `node/<PeerID>`-Identität (adressierbar).
- **D2/D2b:** Server-Identität auf dem Forward-Dial.
- **D3:** Sender-Binding auf dem MCP-Proxy-Ingress.
- **ADR-020/021:** Sync-Substrat + Health — **unverändert wiederverwendet**.

## Umsetzungs-Plan (Folge-PRs, je CO/CG/TS/CR/PC/DO — NICHT Teil dieses Design-PRs; Christians Gate)
1. **D4-a:** Config „welche lokalen MCPs sind *shared*" → Registrierung als `mcp:<server>`-Capability (category=mcp) + `resolve_mcp`-Primitive + `/api/capabilities`-Filter.
2. **D4-b:** Daemon-MCP-Proxy-Ingress `/api/mcp/<server>` + Forward-Routing über mTLS (D2/D3-Interlock).
3. **D4-c:** MCP-Health via ADR-021 (Prozess-Liveness des MCP); Routing überspringt offline; Multi-Provider-Auswahl/Failover.
4. **D4-d:** 3-Stufen-Ausführungs-Enforcement (**self/gate/consensus**) + `permissions`/`trust_level`→`execution_tier`-Ableitung + Audit jeder Stufe/Approval.

## Definition of Done (dieses Design-PRs)
- Schema-Erweiterung (namespaced `mcp:<server>`-Capability im bestehenden CRDT), **Discovery default-open**, Auflösung (`resolve_mcp`), mTLS-Routing (Daemon-MCP-Proxy), **3-Stufen-Ausführung (self/gate/consensus)** + Owner-Gate + D2/D3, und die zwei Akzeptanzfälle (`.52`→UniFi-Auflösung; markitdown-Variante-B-Entblockung) dokumentiert.
- **Kein Code, kein Cert-Rollout, kein Flag-Flip.**

## Entschieden (2026-06-19, Christians Arbeitslinie)
- **Shared-Policy = DEFAULT-OPEN** (war offener Punkt 2): als shared deklarierte MCPs default `share=true`, opt-out per Config; kein opt-in-Allowlist, keine deny-by-default-per-Agent-Welt. (s. „Discovery-Policy".)
- **Ausführung = 3 Stufen self/gate/consensus** (statt binärem Gate). (s. „Ausführungs-Modell".)

## Offene Punkte (Christian)
1. **Single- vs Multi-Provider** je MCP: genau ein servierender Node, oder mehrere mit Failover/Last-Routing?
2. **Stufen-Zuordnung:** wird `execution_tier` rein aus `permissions`/`trust_level` abgeleitet, oder pro MCP-Server explizit in der Share-Config gesetzt (Override)? Default-Ableitung: read-only→self, credential/write→gate.
3. **Approval-Caching:** gate/consensus pro Tool-Call vs. mit TTL gecacht?

## D4-b Forward-Spec (Prep, v0.34.22 — deploy-frei)

Zwischen dem reinen Routing-Planner (`planMcpRoute`, v0.34.19/#190) und dem späteren
Live-Ingress steht die **Forward-Spec**: `mcp-forward.ts` `buildMcpForwardSpec(plan, …)`
übersetzt einen `McpRoutePlan` in eine ausführungs-freie Spezifikation:

- `local-exec` — eigener Node serviert (späterer lokaler mcporter-Exec; `execution_tier` durchgereicht),
- `remote-forward` — Forward an den Owner-Peer: `url = ${peerEndpoint}/api/mcp/<server>`,
  `senderUri` (eigene SPIFFE-Identität für **D3**-Sender-Binding), `expectedServerSpiffeId`
  (= Owner-`agent_id` für den **D2**-`checkServerIdentity`-Pin) und `requireServerIdentity`
  (Spiegel von `TLMCP_SPIFFE_SERVER_IDENTITY`),
- `unavailable` — fail-closed bei jeder Lücke: kein Provider, kein/leerer Endpoint, **nicht-HTTPS**
  Endpoint (kein Plaintext-Forward), ungültige URL, fehlende eigene Sender-Identität.

**Rein:** kein Netz/mTLS, kein `child_process`/mcporter, kein I/O. Die Endpoint-Auflösung wird als
`resolvePeer`-Callback injiziert (im Daemon: `MeshManager.getPeer` → `MeshPeer.endpoint`).
**NICHT enthalten (Folge-Slices, Christians Gate):** der `/api/mcp/<server>`-Fastify-Ingress, der
tatsächliche undici-mTLS-Forward (D2-Dispatcher + Server-Identity-Pin), der lokale mcporter-Exec
und das 3-Stufen-Enforcement (D4-d).
