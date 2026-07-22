# changes/2026-07-22 — feat(mcp): TL-08 Slice 2c — Live-Tool-Class-Drift-Check-Hook (ADR-042)

**Typ:** additive **Verdrahtung** (Code + Tests) — verdrahtet den bereits vorhandenen, aber ungenutzten
Live-Drift-Check-Seam `checkToolClassDrift` (`tool-class-drift.ts`) ehrlich in den Daemon. **Read-only /
kein Gate-Flip**, **secret-sicher**, kein Deploy/Secret. Der Gate-Flip (sensitive→allow-with-redaction)
bleibt Christian-gated und ist **außer Scope** (TODO.md TL-08 Slice 2c).

## Was
- **`packages/daemon/src/tool-class-drift-hook.ts` (neu):**
  - `buildGovernedToolListFetcher(deps)` → ein konkreter `ToolListFetcher`: resolved den servierenden Peer
    eines governed Servers (`resolveMcp` → erster Online-Provider; `mesh.getPeer(id)?.endpoint`) und holt
    dessen **live `tools/list`** über die **bereits vorhandene** ausgehende mTLS-Forward-Primitive
    (`mcpForwardHttp.forward` → Peer-`/api/mcp/<server>`, identitäts-gepinnt). **Secret-sicher:** forwardet
    **nur** `buildToolsListRpc()` (Namen/Schemata, nie Werte) — **kein** `tools/call`. Extrahiert die Namen
    via neuem `extractToolNames`.
  - `runGovernedToolClassDriftChecks(deps)` → Orchestrator: prüft je governed Server (Default
    `SERVER_TOOL_CLASSES`, heute nur `unifi`) die Klassen-Map gegen das Live-Inventar und emittiert bei Drift
    **ein** neues **`TOOL_CLASS_DRIFT`-Audit** (Kurations-Signal). Details = nur Zähler + `unclassified`-Namen
    (keine Werte).
- **`mcp-proxy-client.ts`:** `extractToolNames(body)` (fail-safe `tools/list`-Ergebnis → Namen, dedupliziert)
  + `hasToolsArray(body)` (unterscheidet legitim-leeres Inventar von unbrauchbarer 200-Antwort, s. CR-M1).
- **`audit.ts`:** neuer Event-Typ `TOOL_CLASS_DRIFT` (ADR-042; read-only, kein Gate-Flip).
- **`index.ts`:** Hook fail-safe verdrahtet — `setTimeout(60s)` (Mesh-Warmup) + `setInterval(1h)`, beide
  `.unref()`, im Shutdown via `clearTimeout`/`clearInterval` geräumt. Jeder Fehlerpfad (kein Provider/
  Endpoint / Non-200 / 200-ohne-`result.tools` / Fetch-Wurf) → übersprungen (`checkToolClassDrift → null`),
  **nie** ein Crash, **nie** ein false-positive.

## Tests (+22; Suite **1919 grün**, 139 Files)
- `tool-class-drift-hook.test.ts` (**15**): Fetcher (resolve→forward→extract, korrekte Adressierung/`tools/list`-
  only, Würfe bei kein-Provider/kein-Endpoint/Non-200, trailing-slash, **CR-M1** 200-ohne-tools → Wurf,
  legitim-leeres `[]`), Orchestrator (Drift→Audit für stale **und** unclassified, kein-Drift/ungoverned/
  Fetch-Fehler→kein Audit, Per-Server-Isolation, Default-Serverliste, **CR-M1 E2E** kein false-positive).
- `mcp-proxy-client.test.ts` (**+7**): `extractToolNames` (Namen/dedupe/fail-safe) + `hasToolsArray`.

## CR (adversariales Claude-Subagent; `agy` fehlt für `pal:codereview`)
- Secret-safe / fail-safe / no-gate-flip / Forward-Korrektheit / Resource-Safety (unref+Shutdown) **bestätigt**.
- **1 MEDIUM (M1) an der Wurzel gefixt:** ein 200 **ohne** populiertes `result.tools`-Array (leerer
  mcporter-stdout → `result:{}`, JSON-RPC-`error`@200, doppelt-gewrappt, Server mid-init) ließ
  `extractToolNames`→`[]` → `computeToolClassDrift` meldete fälschlich **alle** kuratierten Tools als stale →
  false-positive Audit. Fix: `hasToolsArray`-Guard im Fetcher (wirft statt `[]` → Seam skippt) + 3
  Regressionstests (Fetcher-Ebene + E2E). Kein HIGH.

## Abgrenzung
- **Gate-Flip** (sensitive→allow-with-redaction) = Christian-gated, unverändert blockiert.
- **Live-E2E gegen einen echten `unifi`-Peer**: eigenes Live-Fenster (kein governed Peer im CI erreichbar);
  die gesamte Logik ist seam-/unit-getestet, der Hook ist bei fehlendem Peer ein sicherer No-op.

## Compliance
- **CO:** entfällt — implementiert ein bereits konsentiertes Design (ADR-042; der Seam + die Slice-Grenze
  „Verdrahtungs-Hook = Folge" stehen in TODO.md/ADR-042). Keine neue Architektur-Frage.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH).
- **TS ✅:** +22 Tests, Suite **1919 grün**, `tsc --noEmit` (strict) 0, neue/geänderte Dateien eslint 0 /
  prettier clean (`index.ts` bewusst NICHT ganz-reformatiert — nur additive Zeilen; ein pre-existing
  `no-non-null-assertion` in `index.ts` ist vorbestehend, CI lintet nicht).
- **CR ✅:** s.o. — 1 MEDIUM gefixt + Regressionstests, kein HIGH.
- **PC ✅:** Secret-Scan clean (der Hook ruft nie ein Tool auf, loggt/auditiert keine Werte).
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
