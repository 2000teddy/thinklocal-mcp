# MCP-Ingress Ausführungsstufen-Durchsetzung (7.8 Punkt 6, ADR-033)

**Datum:** 2026-07-03
**Branch:** `claude/mcp-tier-enforcement` (base=main)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Security-Gate) — **repo-only, kein Deploy/Device/systemd**
**V5-Bezug:** Kapitel 07 Arbeitsliste 7.8 **Punkt 6** — „Lese-/Schreib-Stufen am Hub-Eingang durchsetzen".
**Gate:** Architektur-Gate **2** (ENTSCHEIDUNGEN.md, 02.07.): Lese-/Schreib-Stufen = Beta-Pflicht.

## Kontext

Die Ausführungsstufe `execution_tier` (`self`/`gate`/`consensus`) fließt seit ADR-028 D4 durch die
ganze Forward-Kette und wird sogar auditiert — aber **nirgends durchgesetzt**. `handleMcpIngress`
reichte jeden routbaren Dispatch **unabhängig von der Stufe** an den Executor. Mit dem Live-Executor
(T3.3) hieße das: ein schreibender/kritischer MCP-Aufruf würde ohne jede Freigabe forwarded.

## Lösung (fail-closed)

**`mcp-ingress.ts`:** neue reine Funktion `enforceExecutionTier(tier, server)` (exhaustiv über die
`McpExecutionTier`-Union) + Wiring in `handleMcpIngress` **nach** dem `none`→503-Guard und **vor**
`execute`. Die Stufe kommt aus demselben Dispatch, den der Executor auditiert (`local.execution_tier`
bzw. `remote.request.execution_tier`) — keine zweite, driftende Ableitung.

- `self` (lesend) → weiter an den Executor.
- `gate` (schreibend) → **403** — Freigabe nötig, Meldekanal (Vorgabe 10 / 7.8 P6a) noch nicht gebaut
  → eiserne Regel „kein Kanal ⇒ verweigert".
- `consensus` (kritisch) → **403** — zentral in der Beta verweigert.

**`mcp-ingress-api.ts` (CR-MEDIUM):** REJECT-Audit-Detail trägt bei Tier-Denials ein `tier=<..>`-Suffix
→ Tier-Verweigerung von Sender-Auth-Ablehnung (beide 403) im Audit unterscheidbar.

## Q1-Grenze (unberührt)

Kein Owner-local-exec, keine Q1-Änderung: das Gate sitzt **vor** dem Executor; der self+local-Pfad
endet weiterhin im 501-Stub „local-exec deferred (Q1)". Read-only remote-forward-Pfad (`self`) läuft
unverändert durch. **Bewusste Grenze:** Stufe ist pro-Server (aus Steckbrief-`permissions`), noch nicht
pro einzelnem Tool-Namen — echte pro-Tool-Granularität braucht ein strukturiertes Steckbrief-Feld
(eigener Folge-Slice). Details: `docs/architecture/ADR-033-mcp-ingress-tier-enforcement.md`.

## Tests

- `mcp-ingress.test.ts`: +8 (gate/consensus je remote+local → 403 KEIN Dispatch; self-Regression → execute;
  3× reine `enforceExecutionTier`).
- `mcp-ingress-api.test.ts`: +1 (Tier-403 → REJECT mit `tier=gate`; Gegenprobe Auth-403 ohne `tier=`).
- Full Suite: **1421/1421 grün**, tsc clean, eslint clean.

## Review

Claude adversarialer Reviewer (agy/pal-Backend nicht verfügbar): **APPROVE**, 0× HIGH/CRITICAL.
1× MEDIUM (Audit-Unterscheidbarkeit) + 1× LOW (consensus×local-Test) — **beide gefixt + Test**.
