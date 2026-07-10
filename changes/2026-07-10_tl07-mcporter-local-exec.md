# changes/2026-07-10 — feat(mcp): TL07 reale mcporter-local-exec-Primitive + Wiring

**Typ:** Daemon-Code (`mcp-mcporter-exec.ts` neu, `index.ts` Wiring) + Tests. Kein Deploy,
kein Daemon-Neustart. Aktiviert local-exec erst bei `serve_shared=true` UND nächstem Deploy.
**Auftrag:** TL07 / Kap. 7.7 — Folge-Slice zur local-exec-Naht (#253). Vertrag grounded aus
`mcporter --help` + live-Probe (2026-07-10), NICHT geraten.

## Warum
Die Naht (#253) machte local-exec injizierbar, ließ sie aber unverdrahtet → Owner antwortete
weiter 501. Dieser Slice liefert die **reale** Primitive + das Wiring, sodass ein designierter
Provider einen `tools/call`/`tools/list` tatsächlich lokal über `mcporter` serviert.

## Was
- `mcp-mcporter-exec.ts` (neu): `createMcporterLocalExec` (erfüllt `McpLocalExec`).
  - `tools/list` → `mcporter list <server> --json`.
  - `tools/call` → `mcporter call <server>.<tool> --args '<json>' --output json --timeout <ms>`.
  - Mapping: Exit0+JSON → 200 `{jsonrpc,id,result}`; Timeout → 504; Exit≠0 → 502; non-JSON → 502;
    unsupported Methode / ungültiger Tool-Name → 400 (fail-closed).
  - Sicherheit: `execFile` (KEIN Shell), Argument-Vektor; `<server>.<tool>` + `--args` je EIN
    Token → keine Flag-/Shell-Injection. `TOOL_NAME_RE` muss alphanumerisch beginnen; Server
    wird kanonisiert. Prozess-Timeout = mcporter-Timeout + Grace (deterministisches 504).
- `index.ts`: injiziert die Primitive in den Executor **nur bei `serve_shared=true`**
  (defense-in-depth; Non-Provider bleibt bei 501).

## Tests / Verifikation
- `mcp-mcporter-exec.test.ts` (18): argv-Bau (list/call, --args/--output/--timeout), Security-
  Reject (führendes `-`), Status-Mapping (200/504/502/400), Timeout-Grace, Kanonisierung + id:0-Echo,
  **und der REALE `execFileRunner`** gegen echte node-Kindprozesse (Exit0/Exit≠0/ENOENT→1/Kill→null).
- **Echter End-to-End-Smoke** (grounded, read-only, keine Mutation): reale Primitive gegen den
  lokalen `thinklocal`-MCP-Server → `{status:200, body:{jsonrpc,id:42,result:{unread_count:1}}}`.
- Voll: 1481 Tests grün, `tsc --noEmit` sauber, ESLint sauber (der 1 vorbestehende
  `index.ts`-non-null-assertion-Fehler ist NICHT aus diesem Slice — s. `git stash`-Gegenprobe).
- CR: claude-Subagent → PASS, keine HIGH/CRITICAL; MED (execFileRunner-Test) + 2 LOW
  (Timeout-Race, Server-Kanonisierung) direkt eingebaut.

## Was noch fehlt bis zum grünen TH01↔.52-Beweis (Deploy, nicht dieser PR)
1. `serve_shared=true` am unifi-Owner (TH01) + Daemon-Neustart → registriert `mcp:unifi` (behebt 503).
2. Dann `.52 → /api/mcp/unifi tools/call` → 200 + beidseitiger Audit (`MCP_FORWARD_TX` am Client,
   `MCP_EXEC_LOCAL` am Owner).
Beides ist eine autorisierte Live-Mutation, hier bewusst NICHT ausgeführt.

## Sicherheits-Hinweis (Operator, separat)
`~/.mcporter/mcporter.json` auf TH01 enthält den `UNIFI_API_KEY` im Klartext. Kein Code-Fix hier;
Rotation/Absicherung ist Operator-Sache. Der Key wurde NICHT in Code/Tests/Doku übernommen.

## Status
Offen (PR gegen main).
