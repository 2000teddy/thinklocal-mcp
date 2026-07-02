# ADR-032 — Phantom-Announce-Guard für geteilte MCP-Server (`serve_shared`)

**Status:** Accepted
**Datum:** 2026-07-02
**Kontext-Task:** Hardening zu ADR-028 D4-a (MCP-Service-Registry) / v5 Spur 3 (Modell B).
**Auslöser:** MEDIUM-Finding im unabhängigen Review von PR #229 (T3.1/T3.2).
**Verwandt:** ADR-028 D4 (namespaced `mcp:<server>`-Capabilities, Discovery default-open).

## Problem

`config/daemon.toml` ist ein **fleet-weit ausgeliefertes Template**. Die Shared-MCP-Deklaration ist
**default-open** (`mcp-share-config.ts`: ein Eintrag ist geteilt, außer `share=false`), und
`registerSharedMcps` (index.ts) announced beim Start **jeden** deklarierten Eintrag als
`mcp:<server>`-Capability in die replizierte CRDT-Registry — **ohne** Prüfung, ob der Node den MCP
tatsächlich serviert.

Folge: sobald das Template mit aktiven `[[mcp.share]]`-Einträgen (z.B. `pal`, `unifi`; PR #229) auf
**alle** Nodes ausgerollt wird, announced **jeder Spoke** `mcp:pal`/`mcp:unifi`, die er nicht
servieren kann → **Phantom-Provider** im CRDT → Multi-Provider-Auflösungs-Ambiguität. Heute ist der
Blast-Radius durch den 501-Executor begrenzt (ein mis-routed Call failt), wird aber mit dem
T3.3-Live-Executor zu einem **Live-Mis-Forward-Risiko**.

## Entscheidung

Ein Node announced seine deklarierten Shared-MCPs **nur, wenn er als Provider designiert ist**:

- Neues Config-Feld **`[mcp] serve_shared`** (bool), Env-Override **`TLMCP_MCP_SERVE_SHARED`**.
- **Default `false`** (fail-safe): das Template deklariert MCPs, aber ein Node announced sie erst,
  wenn `serve_shared=true` gesetzt ist. Der **Hub** setzt es (Config oder `TLMCP_MCP_SERVE_SHARED=1`).
- Umsetzung: reine `guardSharedMcpAnnounce(serveShared, buildResult)` (mcp-registration.ts) filtert
  vor der Registrierung — `false` → keine Capabilities announced (die deklarierten wandern mit klarem
  Grund nach `skipped`, laut geloggt). Gegatet am `registerSharedMcps`-Aufruf in index.ts.

### Warum eine Provider-Designation statt Reachability-Probe
Ideal wäre „announce nur, wenn der MCP lokal erreichbar ist". Solange **local-exec (Q1)
zurückgestellt** ist, gibt es aber **keinen** lokalen Serve-Prozess zu proben. Die Designation
(`serve_shared`) ist der pragmatische, fail-safe Guard für die Beta. Eine echte Liveness-Probe
**supersediert** diesen Gate, sobald das lokale Serving landet (Folge-Slice).

### Verhältnis zu „Discovery default-open" (ADR-028 D4)
Unverändert: `serve_shared` ist **orthogonal** zur Sharing-Policy. Ein designierter Provider
(`serve_shared=true`) teilt weiterhin **default-open** (kein Allowlist, opt-out via `share=false`).
`serve_shared` entscheidet nur, **ob dieser Node überhaupt Provider ist** — nicht, *welche* Agents
auflösen dürfen.

## Konsequenzen

- **Positiv:** kein Phantom-Provider im CRDT; default-sicher (Nicht-Provider announcen nichts);
  Hub-Rolle explizit; schließt das Live-Mis-Forward-Risiko vor dem T3.3-Executor.
- **Negativ / bewusst:** der Hub **muss** `serve_shared=true` setzen, sonst wird nichts announced
  (laut geloggt → sichtbar, kein stiller Ausfall).
- **Migration:** rein additiv, default-off. Ein bestehender Node ohne aktive `[[mcp.share]]` ist
  unbetroffen. Nodes, die bereits `mcp:*` announcen sollen, brauchen das Flag.

## Out of scope (Folge)
Reachability-/Liveness-Probe des lokalen MCP-Serve-Prozesses (ersetzt/ergänzt die Designation, sobald
local-exec landet); per-MCP-granulare Provider-Designation (heute node-global genügt für die Beta,
in der der Hub alle deklarierten MCPs serviert).
