# changes/2026-07-15 — feat(security): ADR-039 gepflegte Read-only-Werkzeugklasse je Server (TL-08 Slice 1)

**Typ:** Daemon-Code (`mcp-service-registry.ts`, `mcp-ingress.ts`) + Fixture + Tests + Design-Doku (ADR-039).
**Slice:** TL-08 Slice 1 (Folge auf ADR-033 Verb-Heuristik-Stopgap).

## Warum
Die Werkzeug-Stufe am Ingress war eine **generische Verb-Heuristik** (`get_`/`list_`→self, …) — ADR-033
markierte sie als Stopgap: ein unifi-Tool mit ungewöhnlichem Verb oder ein `get_`-Read, der Secrets
zurückgibt, wird geraten, nicht gewusst. TL-08 verlangt eine **gepflegte, autoritative Klassen-Map je Server**.

## Was
- `mcp-service-registry.ts`: `SERVER_TOOL_CLASSES` (`{ readOnly, consensus? }`) + `deriveToolTierForServer(
  server, payload)`. Für **governed** unifi: readOnly-Allowlist (24 non-secret `get_*`/`list_*`) → self;
  `tools/call`-unlisted → `maxTier('gate', Heuristik-auf-getrimmtem-Namen)` (mind. gate, destruktiv →
  consensus, **nie Downgrade**, unlisted-Read nie self). Server **kanonisiert**, Tool-Name **exakt**.
  Nicht-`tools/call` (z.B. `tools/list`) + ungoverned Server → `deriveToolTier` (unverändert).
- `mcp-ingress.ts`: nutzt `deriveToolTierForServer(input.server, input.payload)`; effektive Stufe bleibt
  `maxTier(capabilityTier, toolTier)`.
- `fixtures/unifi-tools-2026-07-15.json`: echtes 67-Tool-Live-Inventar (Snapshot) für den Drift-Test.

## Bewusste Grenze
Nur unifi governed (weitere Server folgen); credential-/PII-Reads (wlan/voucher/radius/vpn/wans/networks)
gegatet bis Slice 2 („mutation ≠ sensitivity" + Feld-Redaktion); Startup-Drift-Check + Audit-Signal
„unlisted-on-governed" = Folge-Slices (ADR-039).

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet) — Design bestätigt + gehärtet (tools/list-Blocker,
  Kanonisierung, Credential-Reads, Fixture-Test). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. Beleg:
  `~/hermes/reports/2026-07-15_1603_TL08a-consensus.md`.
- **CG:** n/a. **TS:** +14 Tests (deriveToolTierForServer: readOnly→self, block→gate, delete→consensus,
  unlisted→gate, credential-Reads→gate, `tools/list`→self **Blocker-Regression**, Kanonisierung UNIFI,
  exakter Name fail-closed, ungoverned-Heuristik, **Fixture-Subset `readOnly ⊆ 67`**, whitespace→consensus;
  Ingress e2e: list_clients→200 / get_wlan→403 / tools/list→200). Volle Suite **1643 grün**, tsc/ESLint 0.
- **CR:** adversarialer Claude-Subagent — **kein Self-Bypass für write/destruktiv**, alle Invarianten ok.
  3 MEDIUM **in-slice gefixt**: `list_wans` (PPPoE-Passwort) + `get_network`/`list_networks` (IPsec-PSK) aus
  readOnly entfernt (→ gegatet); whitespace-Name-Klassifikation getrimmt (`" delete_network "` bleibt
  consensus). LOW (client-PII) für Slice-2-Sensitivity-Review notiert.
- **PC:** `git diff`; Secret-Scan clean.
- **DO:** ADR-039, `TODO.md` (TL-08 Slice 1 ✅), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
