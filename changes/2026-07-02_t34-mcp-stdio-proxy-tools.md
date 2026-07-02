# T3.4 — Client-seitige MCP-Proxy-Tools in mcp-stdio (tools/list / tools/call Passthrough)

**Datum:** 2026-07-02
**Branch:** `claude/t34-mcp-stdio-proxy-tools` (gestackt auf `claude/t33-mcp-forward-executor` / PR #230)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (MCP-Client/Adapter) — **remote-forward-only**, kein Deploy
**V5-Bezug:** Spur 3 (Modell B) T3.4 — strikt linear nach T3.3 (#230)

## Kontext

T3.2/T3.3 (#229/#230) bauten den Daemon-seitigen MCP-Proxy (`/api/mcp/<server>` + Live-Executor).
T3.4 gibt dem lokalen Agenten (Claude Code) die **Client-Tools**, um die geteilten Hub-MCPs
(`pal`, `unifi`) transparent über seinen lokalen Daemon-Proxy aufzurufen — ohne direkten Peer-Kontakt.

## Lösung

**`mcp-proxy-client.ts` (neu, reine Helfer):** `buildToolsListRpc`/`buildToolsCallRpc` (JSON-RPC 2.0),
`parseMcpResponseBody` (JSON/Non-JSON/leer), `extractSharedMcpServers` (Filter `category=mcp`+`mcp:`,
defensiv gegen null/garbage), `callMcpProxy(server, rpc, requester)` (POST `/api/mcp/<server>`,
`encodeURIComponent`, Status+Body durchgereicht). `nextRpcId` monoton.

**`mcp-stdio.ts` (3 Tools):**
- `mcp_list_servers` — `/api/capabilities?category=mcp` → geteilte MCPs (server/owner/health/description).
- `mcp_list_tools({server})` — JSON-RPC `tools/list` Passthrough.
- `mcp_call_tool({server, name, args})` — JSON-RPC `tools/call {name, arguments}` Passthrough.

Bewusst **Low-Level `requestDaemon`** (nicht `requestDaemonJson`): 501 (local-exec deferred),
502/503 (Owner offline), 403 erreichen den Agenten als lesbares `{status, body}` statt Throw.
Auth: loopback-Call trägt via `local-daemon-client` das eigene mTLS-Node-Cert → Daemon leitet den
D3-Sender aus dem Cert ab; der Client kann keinen fremden Sender fälschen (Enforcement bleibt im Daemon).

## Tests

- **`mcp-proxy-client.test.ts`** (neu, 15): JSON-RPC-Bau (list/call, args-default), Body-Parsing
  (JSON/Non-JSON/leer/Scalar), `extractSharedMcpServers` (Filter, defensiv null/garbage,
  **unpräfixierter skill_id ausgeschlossen**), `callMcpProxy` (Pfad-Enkodierung, Status-Durchreichung
  inkl. 501/**503**, **Security: Path-Traversal `../peers` → `..%2Fpeers`**).
- **Defensiv-Bug gefixt (Test-getrieben):** `extractSharedMcpServers` crashte auf `null`-Array-Einträgen
  → `typeof c !== 'object' || c === null`-Guard + Regressionstest.
- **Live-Evidence (dist):** kompiliertes `mcp-proxy-client` via Node → `mcp_list_servers` parst, `tools/list`
  → 200+Ergebnis, `tools/call` → 501-Passthrough (local-exec deferred); die 3 Tools sind in `dist/mcp-stdio.js`.
- Volle Suite **108→109 Files / 1347 grün**, tsc 0, authored-eslint 0, build 0.

## Review

Unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt
im Env). **0× CRITICAL/HIGH.** Passthrough korrekt, Fehler-Surfacing korrekt, **kein Path-Traversal**
(encodeURIComponent neutralisiert; Servername = reiner Registry-Lookup-Key), Trust-Modell intakt
(Client kann keinen Sender fälschen). Umgesetzt: Zusatz-Tests (Traversal-Encoding, 502/503-Passthrough,
unpräfixierter skill_id, Scalar-JSON). Bewusst belassen (dokumentiert): **M1** `mcp_list_servers` nutzt
den gleichen `fetchDaemon`-Fehlermodus wie alle GET-List-Tools der Datei (Konsistenz); **M2** Servername
wird daemon-seitig kanonisiert (lowercase/trim) — Client sendet verbatim.

## Folge / offen

- **T3.5** Zwei-Peer-DoD-Beweis (.52 → TH01-`unifi` `list_clients` ohne stunnel, Audit beidseitig) =
  der echte Ende-zu-Ende-Nachweis. Owner-lokales Serving (local-exec) bleibt per **Q1** zurückgestellt
  (heute `local` → 501). **Kein Deploy.**
