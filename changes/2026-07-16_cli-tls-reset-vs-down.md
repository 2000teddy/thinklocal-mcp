# changes/2026-07-16 — fix(cli): TLS/mTLS-Reset von „down" unterscheiden (KW29 Bug-Pfad 1)

**Typ:** CLI-Bug-Fix + Diagnose-Doku. **Kein** Deploy/Secret/Christian-Gate, **kein** neuer Transport,
**kein** geändertes Endpoint-Verhalten. Bundle mit dem Evidence-Pack derselben Bug-Path.

## Warum
`tl check`/`cmdCheck` (`packages/cli/src/thinklocal.ts`) probte `/health` + `/api/status` über
`http://` gegen Port 9440 und meldete **jeden** `fetch`-Fehler als `fail("Daemon nicht erreichbar")`.
Beide Endpunkte hängen aber am mTLS-`cardServer` (`agent-card.ts:225-230`, `requestCert +
rejectUnauthorized`, keine Public-Path-Allowlist). Eine `http://`- oder client-cert-lose Probe wird auf
TLS-Ebene **resettet** → der Port antwortet, der Daemon läuft — das Tooling erzeugte also **Phantom-ROT**
(Beleg: `docs/DIAGNOSE-api-status-phantom-rot.md`).

## Was
- **Neu `packages/cli/src/probe-classify.ts`** (reines Modul, testbar; `thinklocal.ts` läuft `main()`
  beim Import — Muster wie `thinklocal-heartbeat.ts`): `classifyProbeError(err) → { kind, likelyUp, code,
  hint }`.
  - `down` — `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`/`EHOSTUNREACH`/`ENETUNREACH` (Port antwortet nicht).
  - `tls` (**`likelyUp=true`**) — `ECONNRESET`/`EPROTO`/`UND_ERR_SOCKET`/`ERR_SSL_WRONG_VERSION_NUMBER`/
    `HPE_*`/cert-trust (`altname`/`verify`/`ssl`/…): Port antwortet, TLS/mTLS bricht ab → Daemon läuft.
  - `timeout` — `TimeoutError`/`AbortError`/`UND_ERR_CONNECT_TIMEOUT`/`ETIMEDOUT` (Signal top-level **oder**
    in `cause.name`).
  - `unknown` — konservativer Fallback (`likelyUp=false`, kein Über-Claim).
- **`thinklocal.ts` `cmdCheck`:** Health-Catch meldet TLS-Reset als `warn`+Hinweis („Port antwortet, aber
  TLS/mTLS … kein down") statt `fail`-ROT; Status-Catch trägt `kind`/`code` + Hinweis. Import ergänzt.

## Bewusste Grenze
`classifyProbeError` ist eine **Heuristik über Fehlercodes**, kein echter Handshake. False-UP-Grenze
(Fremdprozess auf dem Port → `ECONNRESET` → „wahrscheinlich UP") ist **dokumentiert und akzeptiert**: es
bleibt ein `warn`+Hinweis (https:// + Cert prüfen), nie ein grünes `ok` — besser als Phantom-ROT. Die
eigentliche mTLS-Auth-Umstellung der Probe (Client-Cert präsentieren) ist ein **separater** Folge-Slice.

## Compliance
- **CO:** entfällt (reiner Bug-Fix, CLAUDE.md-Ausnahme) — eine kleine Design-Entscheidung (Code-Buckets,
  False-UP-Tradeoff) ist im Modul + hier dokumentiert und wurde im CR geprüft.
- **CG:** n/a.
- **TS:** `packages/cli/src/probe-classify.test.ts` — **19 Unit-Tests** (jede Klasse, Kern-Invariante
  „kein down je `likelyUp` / kein TLS-Reset je down", null/`{}`-Robustheit, wrapped-`cause.name`-Timeout,
  code-only EPROTO/HPE, False-UP-Grenze). Voller Lauf **1763 grün** (packages/, Scripts via `node --test`
  separat). tsc (strict) + ESLint 0 auf den geänderten Dateien.
- **CR:** adversarialer Claude-Subagent — **APPROVE, keine HIGH/MEDIUM**; Buckets vs. reale
  Node/undici-Semantik bestätigt (ECONNREFUSED≠ECONNRESET), `pickErr` null-sicher, `cause.code`-Vorrang
  korrekt, keine Control-Flow-Regression. 2 LOW **in-slice gefixt** (Timeout aus `cause.name`; Test-Lücken).
- **PC:** `git diff main...HEAD` gesichtet; Secret-Scan clean.
- **DO:** `docs/DIAGNOSE-api-status-phantom-rot.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`
  (Bug-Path-Notiz), dieser Eintrag.
