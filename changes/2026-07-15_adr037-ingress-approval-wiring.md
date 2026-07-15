# changes/2026-07-15 — feat(security): ADR-037 Ingress-Wiring der Meldekanal-Freigabe (TL-09b)

**Typ:** Daemon-Code (`mcp-ingress.ts`, `mcp-ingress-api.ts`, `mcp-service-registry.ts`, `meldekanal.ts`,
`index.ts`) + Tests + Design-Doku (ADR-037).
**Slice:** TL-09b (Slice B von TL-09; Folge von ADR-036 / PR #263).

## Warum
ADR-036 lieferte die Meldekanal-Abstraktion **unverdrahtet**. Ohne einen Aufrufer bleibt jeder
schreibende (`gate`) MCP-Aufruf per ADR-033 dauerhaft 403 — es gibt keinen Weg, eine Freigabe
**einzuholen**, und die Abstraktion wäre toter Code. TL-09b verdrahtet den Ingress an die Registry.

## Was
- `handleMcpIngress` (`mcp-ingress.ts`): neuer optionaler `resolveApproval`-Dep. Für `tier==='gate'` MIT
  Resolver wird eine Freigabe eingeholt; **nur `isApproved(decision)`** lässt zum Executor durch, jeder
  andere Ausgang → 403. `consensus` wird **nie** über diesen Pfad geroutet (bleibt 403). `self`
  unverändert frei. Resolver fail-closed umhüllt (Throw **oder** malformed-Resolve ⇒ 403, kein 500).
- `mcp-ingress-api.ts`: baut den Resolver aus einer `MeldekanalRegistry` (requestId/summary +
  `requestApproval`), nur wenn eine Registry injiziert ist.
- `index.ts`: Env-Flag `TLMCP_APPROVAL_CHANNEL_ENABLED` (Default **aus**) → **leere** `MeldekanalRegistry`
  (→ `DenyAllChannel` → `denied-no-channel` → 403). Flag-an ist damit verhaltensidentisch zu Flag-aus,
  bis ein realer Kanal existiert („doppelte Sicherheit").
- `mcp-service-registry.ts`: neuer reiner `deriveToolName(payload)` (Freigabe-Kontext).
- `meldekanal.ts`: `ApprovalRequest.tier` von `string` auf `McpExecutionTier` verengt (CO).

## Bewusste Grenze
Kein realer Kanal (TelegramMeldekanal), keine Freigabe-Matrix (TL-10 schiebt sich zwischen Ingress und
Registry), `consensus` bleibt hart 403 (kein Quorum). Verhaltensidentisch zu `main` (gate=403 in beiden
Flag-Zuständen) → kein Regressionsrisiko, TL-07-Beweis (self) unberührt.

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (`cli-claude-opus` neutral + `cli-claude-sonnet` against) — beide
  empfahlen **TL-09b VOR TL-10** (Reorder ggü. Sweep): ADR-036s `ApprovalRequest` hat keinen
  `decider`-Consumer → TL-10-first wäre ein blinder Seam; TL-09b ist verhaltensidentisch/risikoarm.
  Vom Nutzer bestätigt. Cross-Vendor (codex/agy) nicht im PATH. Beleg:
  `~/hermes/reports/2026-07-15_1105_TL09b-consensus.md`.
- **CG:** n/a (agy fehlt; Testdesign aus CO).
- **TS:** +11 Ingress-Tests (gate approved→execute; rejected/denied-no-channel/timeout/error→403;
  Resolver-Throw→403; malformed-Resolve→403; gate ohne Resolver→403; consensus+approver→403;
  self-nicht-konsultiert; ctx server/tool/tier; tool-raise→approved→execute) + `deriveToolName`-Abdeckung.
  Volle Suite **1598 grün**, tsc sauber, ESLint 0 auf allen geänderten Dateien.
- **CR:** Claude-Review-Subagent (adversarial, Fail-open-Fokus; agy fehlt) — **kein CRITICAL/HIGH
  Fail-open**, alle 7 Invarianten verifiziert. LOW-1 (`isApproved` außerhalb try → Unhandled-Reject bei
  malformed-Resolve) + LOW-3 (fehlende Dispatch-Assertion) **beide in-slice gefixt + Regressionstest**.
  LOW-2 (Verb-Heuristik-Klassifizierung) = pre-existing ADR-033, für TL-10 notiert.
- **CR (extern, Codex #264, CHANGES NEEDED → behoben):** MEDIUM — die Freigabe-Entscheidung verlor ihre
  Korrelationsdaten (requestId/outcome/channelId), nur generisches RX/REJECT wurde auditiert → approved
  Write ununterscheidbar von ungegatetem Read; zudem war das in `main:TODO.md` für TL-09b geforderte
  `MCP_FORWARD_GATE` fälschlich nach TL-09c verschoben. **Fix in-slice:** neues `MCP_FORWARD_GATE`-Audit
  (audit.ts + Resolver-Adapter) trägt requestId/outcome/channelId VOR Dispatch/Denial; +4 adapter-Level-
  Tests mit ECHTER `MeldekanalRegistry` (approved/rejected/denied-no-channel/ohne-Registry). 1602 grün.
- **PC:** `git diff` — 6 Dateien + 1 ADR; Secret-Scan clean. **Vorbestehend (nicht in diesem Slice):**
  `index.ts:284` `tlsBundle!.certPem` non-null-assertion (ESLint-Error auf `main`, durch meinen +1-Import
  nur verschoben, nicht eingeführt).
- **DO:** ADR-037, `TODO.md` (TL-09b ✅), `CHANGES.md`, `COMPLIANCE-TABLE.md` (+ #263→merged Reconcile),
  dieser Eintrag.
