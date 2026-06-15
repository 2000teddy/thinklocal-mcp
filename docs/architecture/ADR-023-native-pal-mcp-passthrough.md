# ADR-023: Nativer pal-MCP-Passthrough auf dem Spoke (faithful passthrough)

**Status:** Proposed (Scoping/Design — Entscheidung beim Orchestrator .94 offen)
**Datum:** 2026-06-06
**Autor:** Claude Code / TH01 (Scoping), Christian/Orchestrator (Entscheidung)
**Verwandt:** ADR-022 (PeerID-Identität / node-Cert), Mesh-Ingress, `mcp-stdio.ts`
**Konsens-Vorlage:** `pal:consensus` (Spoke-Footprint) → HYBRID

## Kontext

Heute erreicht ein Spoke-Agent die `pal`-Tools (`pal.consensus`, `pal.codereview`, …)
über eine Hilfskette **mcporter + stunnel** auf jedem Spoke. `pal` ist ein
**streamable-http-MCP** hinter dem Hub-Ingress (`https://10.10.10.80:8443/mcp`).

Ziel: Der ThinkLocal-Daemon stellt lokal einen **nativen MCP-Endpunkt** bereit, der
`tools/list` + `tools/call` **schema-treu 1:1 durchreicht** (faithful passthrough,
**KEIN** generischer `call_pal_tool`-Wrapper) und zum Hub-Ingress über das bestehende
**Mesh-node-mTLS-Cert** verbindet. Damit fallen **mcporter UND stunnel** auf dem Spoke
weg; der Agent sieht `pal.*` weiterhin nativ.

## Befund: vorhandene Primitive (wiederverwendbar)

| Primitiv | Ort | Wiederverwendung |
|----------|-----|------------------|
| **MCP-SDK v1.29.0** (Dependency vorhanden) | `daemon/package.json` | liefert **`StreamableHTTPClientTransport`** (Client → pal, akzeptiert `fetch: FetchLike` → mTLS-Injektion) UND die Server-Transports. Der Passthrough ist **Verdrahtung, kein Protokoll-Neubau**. |
| **Lokaler MCP-Server** | `mcp-stdio.ts` (`McpServer` + `StdioServerTransport`) | Einstiegspunkt vorhanden. **ABER:** für faithful passthrough den **Low-Level `Server`** (`@modelcontextprotocol/sdk/server/index.js`) mit Roh-Request-Handlern nutzen — NICHT den High-Level `McpServer` mit Zod (Zod-Round-Trip verfälscht das JSON-Schema). |
| **node-mTLS-Dispatcher** | `index.ts:150-159` (`UndiciAgent{connect:{ca,cert,key}}`) | direkt wiederverwendbar als custom `fetch` zum 8443-Ingress; CA-Bundle (eigene + gepairte) + node-Cert schon korrekt. |
| **Cert-Rotation/Hot-Reload** | `TrustStoreNotifier`, `getCachedHttpsAgent` | greift automatisch, keine Neuimplementierung. |

## Befund: konkrete Lücken (zu bauen)

1. **MCP-Client-Transport zu pal** — `StreamableHTTPClientTransport(url, { fetch: mtlsFetch })` + `Client.connect()` + Reconnect/Backoff. *(klein, SDK-getragen)*
2. **Low-Level-Forwarder** — Handler für `ListToolsRequestSchema` / `CallToolRequestSchema`, die die Antwort des Upstream-`Client` **verbatim** zurückgeben (Schemas unverändert). *(Kern)*
3. **Progress + Cancellation faithful** — `tools/call`-Progress-Notifications und `notifications/cancelled` **bidirektional** durchreichen (SDK gibt `extra.signal` → an den Upstream-Call weiterreichen). *(fummeligster Korrektheits-Teil)*
4. **Tool-List-Refresh** — Upstream-`notifications/tools/list_changed` abonnieren bzw. TTL-Cache; lokal `list_changed` weiterreichen. *(klein)*
5. **mTLS zum 8443-Ingress** — **Ingress-/.94-seitige Abhängigkeit:** der Hub-Ingress muss das Mesh-node-Cert als Client-Cert akzeptieren. *(Koordination, kein Spoke-Code)*

## Aufwandsschätzung (ehrlich)

| Arbeitspaket | Aufwand |
|--------------|---------|
| Client-Transport + mTLS-custom-fetch + Reconnect | ~1 Tag |
| Low-Level-Forwarder tools/list + tools/call (schema-treu) | ~2 Tage |
| Progress-Notifications + Cancellation bidirektional | ~1–2 Tage |
| Tool-List-Refresh (list_changed / TTL) + Caching | ~0,5–1 Tag |
| Tests (Mock-Upstream-MCP + Live-Parität gegen pal) + Schema-Treue-Regression | ~1–2 Tage |
| Reconnect/Backoff, Error-Mapping, Flag-Gating, Doku/ADR-Finalisierung | ~1 Tag |
| **Summe** | **~6–10 Arbeitstage** |

**Verdikt: < 2 Wochen** (komfortabel), SOFERN auf **tools** + progress + cancellation
geschnitten. Faithful passthrough von prompts/resources würde etwas draufrechnen — `pal`
ist aber tools-zentriert, daher zunächst raus aus dem Scope.

## Hauptrisiken (MCP-Semantik-Treue)

- **Streamable-HTTP-Fidelity** (SSE- vs. JSON-Response-Modus, Session-IDs, Resumption-Tokens, Reconnect) — *mittel, SDK trägt das meiste.*
- **Progress + Cancellation faithful** — bidirektionale Notification-Weiterleitung ist die heikelste Korrektheitsfläche — *mittel.*
- **Protokoll-Evolution** — Spoke-SDK und pal müssen kompatible Protokoll-Versionen aushandeln; der Proxy muss `initialize`/capabilities **faithful weiterreichen** statt eigene aufzuzwingen. SDK-Versionsverhandlung nutzen, SDK-Range pinnen — *mittel.*
- **mTLS-Ingress** — 8443 muss node-Cert akzeptieren (server-seitig) — *niedrig–mittel, .94-Koordination.*
- **Schema-Treue** — NICHT durch Zod round-trippen; rohes JSON-Schema durchreichen (Low-Level-`Server`) — *niedrig bei korrektem Design.*

## Entscheidung (Empfehlung)

**HYBRID als deklariertes Ziel (dieser ADR), inkrementell + flag-gegatet bauen — mcporter+stunnel
als befristete Brücke behalten, bis ein Live-Paritätstest gegen pal grün ist, DANN deprecaten.**

Begründung: < 2 Wochen UND entfernt zwei bewegliche Teile (mcporter + stunnel) pro Spoke.
Aber nicht am Tag 1 die Brücke reißen: nativen Passthrough **hinter Flag** bauen, Live-Parität
verifizieren (`tools/list` deckungsgleich, echter `pal.consensus`-Call, Streaming, Cancellation),
**erst dann** die Brücke abschalten. Reversibel, fail-safe — dasselbe Muster wie ADR-022 Phase 3.

**Verworfen:** generischer `call_pal_tool`-Wrapper (verliert native Discovery/Schemas);
Sofort-Rip-out der Brücke ohne Paritätsnachweis (Bruch-Risiko ohne Netz).

## Offene Punkte (vor Bau)

- [ ] .94: akzeptiert der 8443-Ingress das Mesh-node-Cert als Client-Cert? (Server-seitige Trust-/Authz-Frage.)
- [ ] pal-Protokoll-Version + Streamable-HTTP-Modus (SSE vs. JSON) bestätigen.
- [ ] Scope: nur `tools`, oder auch `prompts`/`resources`?
- [ ] Flag-Name + Default (analog `emit_canonical_sender`: default OFF, opt-in).
- [ ] Entscheidung Orchestrator: SOFORT bauen vs. ADR-Ziel + Brücke halten.

*Scoping/Design — keine Vollimplementierung. Bei „go" folgt der CLAUDE.md-Workflow
(CO ist mit diesem ADR + dem pal:consensus abgedeckt → Code je eigener Branch + TS + CR + PC + PR).*
