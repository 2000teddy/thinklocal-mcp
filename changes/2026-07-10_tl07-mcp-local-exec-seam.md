# changes/2026-07-10 — feat(mcp): TL07 local-exec-Naht (Owner-Seite, injizierbar)

**Typ:** Daemon-Code (`mcp-forward-executor.ts`, `audit.ts`) + Tests. Kein Deploy, kein Live-Wiring
(index.ts injiziert bewusst KEINE `localExec` → Produktionsverhalten unverändert 501).
**Auftrag:** TL07 / Kap. 7.7 Modell-B tools/call-Forward — kleinster Code-Slice Richtung echtem
`tools/call`-Beweis. Live-Root-Cause siehe `hermes/reports/2026-07-10_0610_TL07-toolscall-forward-status.md`.

## Warum
Der Owner-seitige local-exec war ein 501-Stub („local-exec deferred, Q1 remote-forward-only").
Damit endet JEDER Forward am Owner in 501 → ein grüner tools/call ist strukturell unmöglich.
Dieser Slice baut die **Naht**, an der ein echter lokaler Serve andocken kann — ohne die reale
`mcporter`-Ausführung zu erraten.

## Was
- `mcp-forward-executor.ts`: `McpForwardExecutorDeps.localExec?` (injizierbare
  `McpLocalExec`-Primitive) + `McpLocalExecRequest`. Der `mcporter-local`-Zweig:
  - **ohne** `localExec` → unverändert **501** + `MCP_FORWARD_REJECT` (rückwärtskompatibel, Q1-Default);
  - **mit** `localExec` → lokaler Serve, `MCP_EXEC_LOCAL`-Audit (Owner-Hälfte des beidseitigen
    Kap.-7.7-Audits), `>=500` → zusätzlich `MCP_FORWARD_REJECT`, **werfende Primitive → 502**
    (Vertrag `{status,body}` gehalten, analog Self-Catch in `createUndiciMcpForward`).
- `audit.ts`: neuer `AuditEventType` `MCP_EXEC_LOCAL` (Gegenstück zu `MCP_FORWARD_TX`).

## Tests / Verifikation
- `mcp-forward-executor.test.ts` +4: injizierter Exec → 200 (Spec+Payload durchgereicht, KEIN
  Net-Egress); `MCP_EXEC_LOCAL` auditiert, nicht deferred-REJECT; Exec-Fehler `>=500` →
  zusätzlich REJECT; werfende Primitive → 502.
- Rückwärtskompatibilität: die bestehenden 501-Tests (ohne `localExec`) bleiben grün.
- Voll: 1462 Tests grün, `tsc --noEmit` sauber, ESLint sauber.
- CR: claude-Subagent → PASS, keine HIGH/MED. Security-Kernpunkt bestätigt: die Ausführungsstufe
  (gate/consensus) wird UPSTREAM in `handleMcpIngress` (`mcp-ingress.ts:148`) VOR `execute()`
  durchgesetzt; nur `self` erreicht den Executor → die Naht öffnet keinen Bypass für write/critical.

## OFFENE Runtime-/Interface-Fragen (nächster Slice — NICHT geraten)
Der reale `createMcporterLocalExec` (child_process-`spawn`) folgt separat; ungeklärt und daher
bewusst nicht implementiert:
1. **mcporter-Aufrufvertrag:** Nimmt `mcporter run <server>` einen `tools/call` als JSON-RPC über
   **stdin** entgegen und liefert das Ergebnis über **stdout**? Oder braucht es Subcommands/Flags?
2. **Status-Mapping:** Wie wird mcporter-exit-code/stderr auf HTTP-`{status,body}` gemappt?
3. **Owner-Voraussetzungen:** mcporter installiert + `config`-Pfad (`configPath`) auf dem
   unifi-Owner (TH01)? Wo wird der Pfad gesetzt (Env/TOML)?
4. **execution_tier:** self ist gesetzt; braucht der lokale Serve zusätzliche Sandbox/Timeout-Semantik?

## Abgrenzung
Kein Live-Deploy, kein `serve_shared`-Flip, kein Daemon-Neustart. Der 503-Blocker (kein Provider
registriert, `serve_shared=false`) ist separate Deploy-Arbeit, nicht Teil dieses PRs.

## Status
Offen (PR gegen main).
