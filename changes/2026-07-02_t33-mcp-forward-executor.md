# T3.3 — Live-Forward-Executor (undici-mTLS, D2-Pin, 1-Hop-Guard, beidseitiges Audit)

**Datum:** 2026-07-02
**Branch:** `claude/t33-mcp-forward-executor` (gestackt auf `claude/t31-t32-modell-b-mcp-ingress` / PR #229)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Mesh/MCP-Proxy) — **remote-forward-only**, kein Deploy
**V5-Bezug:** Spur 3 (Modell B, kritischer Pfad) T3.3 — strikt linear nach T3.1/T3.2 (#229)

## Kontext

T3.2 (#229) verdrahtete `POST /api/mcp/:server` + D3-mTLS-Sender-Auth und ließ den Executor
als 501-Stub. T3.3 ersetzt den Stub durch den **echten remote-forward-Executor**.

## Lösung

**`mcp-forward-executor.ts` (neu):**
- `createMcpForwardExecutor(deps)` — konsumiert `buildMcpExecSpec(dispatch)`; remote-forward-only:
  `mcporter-local` → 501 (Q1 zurückgestellt), `reject` → Status durchgereicht, `mtls-forward` →
  Guards → Audit → `httpForward`.
- `createUndiciMcpForward(deps)` — reale undici-mTLS-Primitive: **persistenter Agent pro Owner**
  (Connection-Reuse), Payload-Passthrough, `AbortSignal.timeout` (Cancel/Timeout), Antwort
  (Status+Body) zurück; `fetch` injizierbar → unit-testbar ohne Net-Egress.
- **D2-Server-Pin:** per-Owner-`checkServerIdentity` via `verifyMeshServerIdentity` auf die erwartete
  Owner-SPIFFE-Identität (aktiver Pin) bzw. TOFU.
- **1-Hop-Guard:** ausgehender `x-tlmcp-mcp-hop = incomingHop+1`; eingehender `hop>=1` → **502**
  (kein Re-Forward); `target==self` → **508**. Loop-/Amplifikations-sicher (Owner-Terminus).
- **Beidseitiges Audit:** `MCP_FORWARD_TX` / `MCP_FORWARD_REJECT` (Sender), `MCP_PROXY_RX` /
  `MCP_FORWARD_REJECT` (Owner/Ingress). Neue AuditEventTypes in `audit.ts`.

**Wiring (`index.ts`):** Executor + undici-Forward gebaut (aus `tlsBundle`/`initialCaBundle`/
`outboundConnectPolicy`), in `registerMcpIngressApi` injiziert (+ Audit-Hook); `close()` im Shutdown.
**`mcp-ingress-api.ts`:** `execute`+`audit` injizierbar, Hop-Header-Extraktion, ctx (Hop/Payload/
Server) an den Executor, RX/Reject-Audit.

## Tests

- **`mcp-forward-executor.test.ts`** (neu, 13): remote (hop+1/Payload/Audit-TX), Pin-Durchreichung,
  Self-Loop 508, 1-Hop 502, local 501, reject 500, **CR-M4** Audit (reject/local/502-fail);
  `createUndiciMcpForward` (fetch injiziert): Success (Hop-Header/Body/URL), Non-JSON, Fehler→502,
  kein-TLS→503, per-Owner-Cache.
- **`mcp-forward-executor-pin.test.ts`** (neu, 4): **CR-H2** Connector-Pin aus Request (kein TOFU-
  Downgrade), TOFU ohne check; **CR-H1** Cache-Key inkl. expectedSpiffeId (kein Stale-Pin-Reuse).
- **`mcp-ingress-api.test.ts`** (+6): Hop-Header→incomingHop, Payload/Server-Durchreichung, RX/Reject-Audit.
- **Live-Evidence (dist):** kompiliertes `dist`-Modul via Node: Forward hop=1 → 200+Body, Self-Loop
  508, Route-D3-403 ohne Cert intakt.
- Volle Suite **108 Files / 1332 grün**, tsc 0, authored-eslint 0, build 0.

## Review

Unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy`
fehlt im Env). 0× CRITICAL. Behoben:
- **CR-H1 (HIGH):** Agent-Cache nur nach `targetAgentId` → Stale-Pin-Reuse bei abweichendem
  `expectedSpiffeId`. Fix: Cache-Key `target|pin|expectedSpiffeId` + 2 Regressionstests.
- **CR-H2 (HIGH):** Connector-Policy kam aus der globalen `outboundPolicy` → möglicher stiller
  TOFU-Downgrade (Pin angefordert, nicht erzwungen). Fix: Policy aus dem Request ableiten
  (`spiffeServerIdentity = req.requireServerIdentity`) → strukturell konsistent + Regressionstests.
- **CR-M4 (MEDIUM):** reject/local/fehlgeschlagene-Forward-Pfade nicht auditiert → `MCP_FORWARD_REJECT`
  ergänzt + Tests. **CR-L1:** Ingress-RX-Audit mappt 5xx (Guard/Exec-Reject) jetzt auf REJECT.
  **CR-L4:** `agent.close()` mit `.catch` (kein unhandled im Shutdown).
- **CR-M1/M2 (Trust-Modell, dokumentiert, kein Code):** Hop-Header untrusted → Loop-Sicherheit ruht
  am Owner-Terminus, nicht am Header; Origin-Attribution ist in der Beta forwarder-basiert
  (Owner autorisiert den forwardenden Node). In ADR-028-D4 als bewusste Entscheidung vermerkt.
- **CR-L2 (LOW, bekannt):** Body-Read hängt am `fetch`-`AbortSignal` (undici); dedizierte Body-Read-
  Deadline optional. In ADR notiert.

## Folge / offen

- **T3.4** client-seitige `mcp-stdio`-Proxy-Tools (`tools/list`/`tools/call`-Passthrough).
- **T3.5** Zwei-Peer-DoD-Beweis (.52 → TH01-`unifi` `list_clients` ohne stunnel, Audit beidseitig).
- Owner-lokales Serving (local-exec) bleibt per **Q1** zurückgestellt. **Kein Deploy.**
