# ADR-037 — Ingress-Wiring der Meldekanal-Freigabe (TL-09b, Slice B)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-09b (Folge von TL-09 Slice A / ADR-036). Verdrahtet die Meldekanal-Abstraktion
an den Hub-Ingress, sodass ein schreibender (`gate`) Aufruf eine echte Freigabe **einholen** kann.
**Gate:** Architektur-Gate 2 (ENTSCHEIDUNGEN.md 02.07.), Design-Vorgabe 10.
**Verwandt:** ADR-033 (Tier-Enforcement, hartes 403), ADR-036 (`meldekanal.ts`), TL-10 (Freigabe-Matrix, folgt).
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — beide
empfahlen **TL-09b VOR TL-10** (Reorder gegenüber dem Sweep), weil ADR-036s `ApprovalRequest` keinen
`decider`-Consumer hat (TL-10 wäre ein blinder Seam) und dieses Wiring verhaltensidentisch/risikoarm ist.
Beleg: `~/hermes/reports/2026-07-15_1105_TL09b-consensus.md`.

## Problem

Seit ADR-033 verweigert der Ingress `gate`/`consensus` **hart mit 403** — ADR-036 lieferte die
Meldekanal-Abstraktion, aber **unverdrahtet**. Solange niemand `MeldekanalRegistry.requestApproval`
aufruft, bleibt jeder Schreib-Aufruf dauerhaft verweigert; die Abstraktion ist toter Code.

## Entscheidung

`handleMcpIngress` (`mcp-ingress.ts`) bekommt einen **optionalen** Freigabe-Resolver
`resolveApproval?(ctx) → Promise<ApprovalDecision>`. Die Stufen-Behandlung VOR dem Executor:

| Stufe | Verhalten (ADR-037) |
|---|---|
| `self` (lesend) | **frei** → Executor (unverändert) |
| `consensus` (kritisch) | **403** (unverändert — Quorum-Konstrukt noch nicht gebaut; TL-10+). Selbst mit Resolver wird `consensus` **nicht** geroutet. |
| `gate` (schreibend), **kein** Resolver | **403** (ADR-033-Untergrenze, unverändert) |
| `gate`, **mit** Resolver | Freigabe einholen: `resolveApproval(ctx)`; `isApproved(decision)` → Executor, sonst **403** (`outcome` im Body). Resolver **fail-closed umhüllt**: Throw ⇒ 403. |

**Auswertung ausschließlich über `isApproved()`** (ADR-036-Allowlist) — nur `approved` lässt durch,
jeder andere (auch künftige) Ausgang verweigert.

### Flag & Default (verhaltensidentisch zu heute)

Der Resolver wird nur konstruiert, wenn `TLMCP_APPROVAL_CHANNEL_ENABLED` (Env, Default **aus**) gesetzt
ist. Er kapselt eine `MeldekanalRegistry`. Da **noch kein realer Kanal** (TelegramMeldekanal) existiert,
wird die Registry **leer** konstruiert → `DenyAllChannel` → jede Freigabe endet `denied-no-channel` → 403.

Daraus folgt die **doppelte Sicherheit**:
- Flag **aus** (Default) → kein Resolver → gate = hartes 403 (exakt ADR-033).
- Flag **an** → Resolver mit leerer Registry → jede gate-Anfrage `denied-no-channel` → 403.

Das Risiko-Delta gegenüber `main` ist damit **null**: `gate` bleibt in beiden Fällen 403. Der Pfad
„approved → Executor" ist erst erreichbar, sobald in einem Folge-Slice ein realer Kanal in die Registry
injiziert wird. Genau das macht dieses Wiring zur sicheren Naht, an der TL-10 (Matrix wählt Kanal+Entscheider)
und der TelegramMeldekanal andocken.

### Typ-Straffung (CO)

`ApprovalRequest.tier` wird von `string` auf `McpExecutionTier` verengt (Import aus
`mcp-service-registry`). Neuer `deriveToolName(payload)` (rein) extrahiert den Werkzeugnamen für den
Freigabe-Kontext (parallel zu `deriveToolTier`).

## Bewusste Grenze (Folge-Slices)

- **Kein realer Kanal** (TelegramMeldekanal mit Inline-Keyboard → `approvals.ts`) — Folge-Slice.
- **Keine Freigabe-Matrix** — TL-10 schiebt sich zwischen Ingress und Registry (`resolveApproval` wählt
  dann Kanal+Entscheider anhand der Matrix statt „erster gesunder Kanal").
- **`consensus` bleibt hart 403** bis ein Quorum-Konstrukt existiert.
- **Kein dediziertes `MCP_FORWARD_GATE`-Audit** in diesem Slice — das bestehende RX/REJECT-Audit
  (`mcp-ingress-api.ts`) unterscheidet approved (RX) von denied (REJECT `tier=gate`) bereits.

## Konsequenzen

- **+** Die Meldekanal-Abstraktion hat jetzt einen **lebenden Consumer**; der Freigabe-Pfad ist end-to-end
  verdrahtet und getestet (nur der reale Kanal fehlt noch).
- **+** Verhaltensidentisch zu `main` (gate = 403 in beiden Flag-Zuständen) → kein Regressionsrisiko,
  TL-07-Beweis (self) unberührt.
- **+** Fail-closed an jeder Kante: kein Resolver → 403; Resolver-Throw → 403; nicht-`approved` → 403.
- **−** `gate` bleibt bis zum realen Kanal 403 (kein Queueing). Beabsichtigt.
