# T3.1 + T3.2 — Modell-B MCP-Proxy: Share-Deklaration + Live-Ingress-Route

**Datum:** 2026-07-01
**Branch:** `claude/t31-t32-modell-b-mcp-ingress`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Mesh/MCP-Proxy) — **remote-forward-only**, kein Net-Egress, kein Deploy
**V5-Bezug:** Spur 3 (Modell B, kritischer Pfad) T3.1 + T3.2 — freigeschaltet durch
**Christian-Gate Q1 = JA** (2026-07-01): remote-forward-only, Hub serviert `pal` + `unifi`,
local-exec später; `e3dc`/`idm` (knotengebundene Hardware) NICHT im Beta-Forward.

## Kontext

ADR-028 D4 + die Routing-Kette (`resolveMcp`/`planMcpRoute`/`buildMcpForwardSpec`/
`buildMcpForwardDispatch`/`handleMcpIngress`, #185–#199) existieren bereits deploy-frei.
Bisher hinter „Christians Gate" geparkt waren: (a) das Fastify-**Route-Wiring** von
`/api/mcp/<server>` in den Live-`cardServer` und (b) der echte undici-mTLS-Executor.
Q1 = JA öffnet das Gate. Diese PR liefert T3.1 + T3.2 (strikt linear; T3.3 = Live-Executor).

## Lösung

**T3.1 — `[[mcp.share]]` für `pal` + `unifi` (`config/daemon.toml`):**
Die beiden Hub-servierten MCPs werden als geteilt (default-open) deklariert → der bereits
verdrahtete Start-Pfad (`buildSharedMcpCapabilities`/`registerSharedMcps`) registriert sie als
`mcp:pal` / `mcp:unifi` (category=`mcp`) in der replizierten Registry → fleet-weit auflösbar
(kein SSH). Read-only-Beta (`query`/`network.read`, hohes Trust) → abgeleitete Stufe `self`;
schreibende Tools später → `write`/`control`/`credential` in `permissions` heben automatisch auf
`gate` (`deriveExecutionTier`). Klarer Config-Kommentar: Einträge NUR auf dem servierenden Hub
aktiv; Hardware-MCPs (`e3dc`/`idm`) bewusst nicht deklariert.

**T3.2 — `mcp-ingress-api.ts` (`registerMcpIngressApi`) → `POST /api/mcp/:server`:**
hängt den Ingress in den mTLS-`cardServer` (index.ts, neben `registerInboxApi`).
- **D3-Sender-Auth aus dem mTLS-Client-Cert:** `extractCanonicalSender(socket)` liest den
  bereits CA-validierten Cert-SAN (`request.raw.socket`, nur `authorized===true`;
  `getPeerCertificate(true)` → `spiffeUrisFromSubjectAltName`) und akzeptiert **strikt** eine
  kanonische `spiffe://thinklocal/node/<PeerID>`-SAN (`isCanonicalNodeUri`). Kein/ungültiger/
  nur-Legacy/malformter Cert → `senderUri=null` → **403** (fail-closed, canonical-only).
- danach der reine `handleMcpIngress`-Ablauf (#199): 400 leerer Server → resolve/plan/dispatch
  → 503 `none`.
- **Executor bewusst deferred → T3.3 (remote-forward-only):** der injizierte Executor quittiert
  einen routbaren Dispatch **fail-closed mit 501** — KEIN Net-Egress, KEIN local-exec
  (`local` → 501 „local-exec deferred (Q1)"). Der echte persistente undici-mTLS-Forward
  (Streaming/Cancel/Timeout/**1-Hop-Guard**) ist T3.3; der Zwei-Peer-`tools/call`-Beweis T3.5.

## Tests

- **`mcp-ingress-api.test.ts`** (neu, 13): `extractCanonicalSender` (kein Socket / nicht-authorized /
  fehlendes Cert / nur-Legacy → null; **CR-M1** malformte canonical-artige SANs → null;
  canonical gewinnt über Legacy); Handler 403 (unauthorized Socket, nur-Legacy, **CR-M1** `node/evil/extra`),
  400 (leerer Server), 503 (kein Provider), 501-remote (Executor deferred, `/T3\.3/`),
  501-local (`/local-exec deferred/`). Gefakte Fastify-`request/reply` — kein TLS-Server.
- **`mcp-share-beta.test.ts`** (neu, 3): lädt die **echte** `config/daemon.toml` und verifiziert
  pal+unifi geteilt, e3dc/idm NICHT geteilt, Bau zu `mcp:pal`/`mcp:unifi` ohne Skip.
- **Live-Evidence (Route-Ebene):** `fastify.inject()` gegen die registrierte Route ohne Client-Cert
  → **403** (D3 fail-closed) — bestätigt das echte Fastify-Wiring, nicht nur die Handler-Logik.

Volle Suite **107 Files / 1312 grün**, `tsc` 0, authored-files eslint 0 Errors. `npm run build` 0.

## Review

Unabhängiger **Claude**-Subagent (adversarial, Security+Correctness; nur claude/codex/agy —
`agy`-Backend im Env nicht installiert, s. #210). Verdikt: Gate fail-closed & korrekt,
0× CRITICAL/HIGH. Behoben:
- **CR-M1 (MEDIUM):** `extractCanonicalSender` nutzte einen **losen** Prefix-Regex (akzeptierte
  `node/` leer, `node/evil/extra`) → auf **strikte** `isCanonicalNodeUri`-Validierung umgestellt
  + 2 Regressionstests (Extraktion + Route-403).
- **CR-L2 (LOW):** Self-Forward-1-Hop-Risiko (Migration Legacy↔canonical) als expliziter
  T3.3-Executor-Guard-Hinweis im Code vermerkt (heute inert, da 501).
Invarianten geprüft (PASS): kein Net-Egress/local-exec in diesem Slice; Status-Leiter
403→400→503→501 fail-closed; `authorized===true`-Gate; 500-Vertrag via try/catch.

## Folge / offen

- **T3.3** (strikt linear, nächster Slice): Live-undici-mTLS-Executor (persistent pro Owner-Peer,
  Streaming/Cancel/Timeout, **1-Hop-Guard** self==target), D2-Server-Pin + beidseitiges Audit.
- **T3.4** client-seitige MCP-Proxy-Tools in `mcp-stdio`; **T3.5** Zwei-Peer-DoD-Beweis (.52→TH01-unifi
  `list_clients` ohne stunnel). **Kein Deploy** in dieser PR.
