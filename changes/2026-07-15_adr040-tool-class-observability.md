# changes/2026-07-15 — feat(security): ADR-040 Werkzeugklassen-Observability (TL-08 Slice 2a)

**Typ:** Daemon-Code (`mcp-service-registry.ts`, `mcp-ingress-api.ts`) + Tests + Design-Doku (ADR-040).
**Slice:** TL-08 Slice 2a (Folge auf ADR-039). **Reine Telemetrie/Struktur — null Gate-Verhaltensänderung.**

## Warum
ADR-039 nannte drei Folge-Items: (a) Field-Redaction, (b) Drift-Check, (c) Audit-Signal. 2a schließt (c)
voll + (b) als Snapshot-Lint und legt die Struktur für (a). Field-Redaction (a) = **Slice 2b, eigener CO**
(Fail-open-Risiko: gated→executed).

## Was (verhaltensneutral)
- `ServerToolClasses` += `sensitive?: ReadonlySet` — die 10 bewusst gegateten unifi-credential-/PII-Reads
  (wlan/voucher/radius/vpn/wans/networks) **explizit**. Nicht in `readOnly` → gaten weiter (kein Bit
  bewegt); Set = Absicht + 2b-Input. Invariante `readOnly ∩ sensitive = ∅` (getestet).
- `classifyGateReason(server, payload) → GateReason | null`: diskriminierter Gate-Grund
  (`invalid-call`/`destructive-verb`/`write-verb`/`sensitive-governed`/`unlisted-governed`). **Single source
  of truth:** ruft intern `deriveToolTierForServer`, `null` wenn self → kann nie vom echten Gate abweichen
  (Cross-Check-Test über die volle 67-Tool-Fixture).
- `mcp-ingress-api.ts`: `MCP_FORWARD_REJECT` hängt `reason=<GateReason>` an — **gegated auf dieselbe
  `typeof tier==='string'`-Bedingung** wie `tier=` (Auth-/Hop-/5xx-Rejects bekommen kein reason=).
- `computeToolClassDrift(classes, live) → { staleReadOnly, staleSensitive, unclassified }`: reiner
  **Snapshot-Selbstkonsistenz-Lint** (KEINE Live-Drift — gegen die committete Fixture ein Regressionstest;
  Live-Verdrahtung = Folge-Slice).

## Bewusste Grenze
`deriveToolTierForServer` **byte-unverändert** — 2a bewegt **null** Sicherheits-Posture-Bit (Telemetrie).
Field-Redaction (2b) braucht eigenen CO: Fail-closed-Default (unbekannte Response-Form → gegatet),
Redaction **beim Owner-Daemon**, konservative Secret-Key-Liste. Live-Drift-Verdrahtung = Folge-Slice.

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet) — classifyGateReason (single source of truth), `sensitive`-
  Set, `reason=`-Gating, Ehrlichkeit (Telemetrie/Snapshot-Lint). ⚠️ Cross-Vendor (codex/agy) nicht im PATH.
  Beleg: `~/hermes/reports/2026-07-15_1635_TL08b-consensus.md`.
- **CG:** n/a. **TS:** +16 Tests (classifyGateReason-Buckets + **Cross-Check-Biconditional über 67-Tool-
  Fixture**, computeToolClassDrift leer-heute + Drift-Fälle, `readOnly∩sensitive=∅`; Ingress-API
  `reason=write-verb`/`sensitive-governed`, Auth-403 ohne reason=). Volle Suite **1651 grün**, tsc/ESLint 0.
- **CR:** Claude-Review-Subagent — **zero-gate-change bestätigt**, alle 5 Invarianten verifiziert, keine
  HIGH/MEDIUM.
- **PC:** `git diff`; Secret-Scan clean.
- **DO:** ADR-040, `TODO.md` (TL-08 Slice 2a ✅ / 2b offen), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
