# MCP-Forward-Naht-Integrationstest (v5 Spur 3, T3.2+T3.3) — Coverage-Lücke geschlossen

**Datum:** 2026-07-02
**Branch:** `claude/t3x-mcp-forward-seam-integration-test`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Test-only — KEIN Produktionscode, KEIN Deploy, ungated.

## Problem

Der MCP-Proxy-Forward-Pfad ist bisher nur **schicht-isoliert** getestet:
- `mcp-ingress-api.test.ts` verdrahtet den Ingress-Handler mit einem **gemockten** Executor.
- `mcp-forward-executor.test.ts` testet `createMcpForwardExecutor` mit gemocktem `httpForward`
  und `createUndiciMcpForward` mit gemocktem `fetch` — **getrennt**.

Die **Naht** zwischen den drei realen Modulen
(`makeMcpIngressHandler` → `createMcpForwardExecutor` → `createUndiciMcpForward`) war
nicht als Ganzes getestet. Ein voller Zwei-Peer-mTLS-Beweis ist **T3.5** (deploy-gated);
diese Lücke lässt sich aber ungated in-process schließen.

## Lösung (kleinster echter Slice)

`mcp-forward-integration.test.ts` (neu, 5 Tests) verdrahtet die **echten** Module und
ersetzt **nur** die äußerste Primitive (`fetch`) durch einen Stub-Owner. Kein `vi.mock`,
kein Net-Egress, kein TLS-Handshake (`requireServerIdentity=false`, synthetisches
TLS-Material; der gestubbte `fetch` ignoriert den Dispatcher — der Undici-Connector wird
dennoch real gebaut).

Bewiesene Naht-Contracts:
1. **Happy-Path:** D3-Sender (Client-Cert) → Executor; realer ausgehender Hop **= incomingHop+1**
   (von `createUndiciMcpForward` gesetzt); URL `${owner}/api/mcp/unifi`, Payload und Servername
   korrekt durchgereicht; 200-Owner-Antwort unverändert zum Client; Audit **MCP_FORWARD_TX**
   (Executor) + **MCP_PROXY_RX** (Ingress).
2. **1-Hop-Guard:** eingehender `hop=1` → **502** ohne Owner-Fetch; REJECT beidseitig.
3. **local-exec deferred (Q1):** Provider == self → **501** ohne Fetch (remote-forward-only).
4. **Owner-5xx:** 503 wird durchgereicht; Executor `MCP_FORWARD_TX`+`MCP_FORWARD_REJECT` (CR-M4),
   Ingress REJECT.
5. **Non-JSON-Owner-Antwort:** Text unverändert durchgereicht (200).

## Tests / Build

Neuer Test **5/5 grün**; volle Suite **114 Files / 1412 grün** (+5), tsc 0, authored-eslint 0, build 0.

## CR

Unabhängiger **Claude**-Subagent (adversarial, Fokus False-Green; `agy` fehlt im Env):
**APPROVE-WITH-NITS**, 0× HIGH/MEDIUM/LOW. Quellen-verifiziert: kein `vi.mock`, realer
Modulgraph, Connector wird real konstruiert (synthetisches PEM wirft erst beim nie
stattfindenden Handshake), `hop='1'` stammt aus dem realen `+1`, alle Audit-Assertions
decken sich mit dem Kontrollfluss. NIT: Audit-`details`-String-Kopplung (inhärent bei
Audit-Content-Tests, akzeptiert).

## Scope-Grenze

Schließt NICHT den deploy-gated **T3.5**-Zwei-Peer-DoD (.52 → TH01-`unifi`, echter
Cross-Host-mTLS-Handshake + beidseitiges Live-Audit). De-riskt ihn nur in-process.
