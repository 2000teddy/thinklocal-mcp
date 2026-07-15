# ADR-040 — Werkzeugklassen-Observability: `sensitive`-Set, Gate-Grund, Snapshot-Lint (TL-08 Slice 2a)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-08 Slice 2 (Folge auf ADR-039). Schließt zwei der drei ADR-039-Folge-Items —
Audit-Signal (c) + halb den Drift-Check (b) — **rein telemetrisch**. Die Field-Redaction (a) = Slice 2b.
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against). Beleg:
`~/hermes/reports/2026-07-15_1635_TL08b-consensus.md`.

## Wichtig: dieser Slice ändert **null** Gate-Verhalten
2a ist **reine Telemetrie/Struktur**: die Entscheidungsfläche `deriveToolTierForServer` (ADR-039) bleibt
**bit-identisch**. Es kommen nur (1) ein explizites `sensitive`-Set (dokumentiert die schon heute
gegateten credential-Reads strukturell), (2) ein diskriminierter Gate-Grund fürs Audit, (3) ein
Snapshot-Selbstkonsistenz-Lint. Kein Bit an Sicherheits-Posture bewegt sich — damit 2b keine falsche
Momentum-Rechtfertigung erbt.

## Entscheidung

### 1. `sensitive`-Set in `ServerToolClasses`
`interface ServerToolClasses { readOnly; consensus?; sensitive? }`. `sensitive` listet die **bewusst
gegateten, nicht-mutierenden** credential-/PII-Reads (ADR-039 CO-B). Für unifi: `get_wlan`, `list_wlans`,
`get_voucher`, `list_vouchers`, `list_radius_profiles`, `list_vpn_servers`, `list_vpn_tunnels`,
`list_wans`, `get_network`, `list_networks` (10). **Verhaltensneutral** — diese Tools sind nicht in
`readOnly`, gaten also weiterhin über den else-Zweig; das Set macht die Absicht nur explizit und ist der
**Input für Slice 2b** (Field-Redaction). Invariante: `readOnly ∩ sensitive = ∅` (getestet).

### 2. `classifyGateReason(server, payload) → GateReason | null`
`GateReason = 'invalid-call' | 'destructive-verb' | 'write-verb' | 'sensitive-governed' | 'unlisted-governed'`.
**Kein zweiter Wahrheitspunkt:** die Funktion ruft intern `deriveToolTierForServer` und gibt `null`
zurück, wenn das Ergebnis `self` ist (= nicht gegatet). Erst danach wird der Grund-Bucket bestimmt. Ein
Cross-Check-Test sichert über die volle 67-Tool-Fixture: `classifyGateReason(…) !== null` **⟺**
`deriveToolTierForServer(…) !== 'self'` — die beiden können per Konstruktion + Test nicht auseinanderlaufen.
Der operativ wichtige Grund ist **`unlisted-governed`** (governed Read/unbekanntes Verb, nicht in
readOnly/sensitive/consensus) = „kuratiere dieses Tool", klar getrennt von `write-/destructive-verb`
(erwartetes Gate) und `sensitive-governed` (bewusste Policy).

### 3. Audit-Verdrahtung (`mcp-ingress-api.ts`)
Der bestehende `MCP_FORWARD_REJECT`-Audit bekommt ein `reason=<GateReason>`-Suffix — **gegated auf
dieselbe `typeof tier === 'string'`-Bedingung** wie das `tier=`-Suffix, damit Sender-Auth-/Hop-/5xx-Rejects
(ohne Tier) **nicht** fälschlich als Kurations-Kandidaten etikettiert werden.

### 4. Snapshot-Lint `computeToolClassDrift(classes, liveTools)`
Rein: `{ staleReadOnly, staleSensitive, unclassified }`. `stale*` = Map-Einträge, die nicht mehr im
Inventar sind (Tippfehler/entferntes Tool). `unclassified` = live ∧ read-Verb ∧ ∉readOnly ∧ ∉sensitive ∧
∉consensus (heute **leer**, weil die 34 read-Verb-Tools = 24 readOnly + 10 sensitive).
**Ehrlichkeit (CO):** gegen die **committete Fixture** ist das ein Map/Snapshot-**Selbstkonsistenz-Lint**
(Regressionstest), **keine Live-Drift-Erkennung** — es feuert nur, wenn ein Mensch die Fixture erneuert.
`unclassified` ist ein Heuristik-Residuum-Bucket (schwaches Signal, nur fixture-getestet, **nicht** live
verdrahtet). Die **Live-Verdrahtung** (periodischer Check gegen echtes `tools/list` + Warn-Log) ist
bewusst **Folge-Slice**.

## Bewusste Grenze — Field-Redaction = Slice 2b (eigener CO)
Reklassifizierung eines credential-Reads von GATED → executed-with-redaction ist eine
**Sicherheits-Verhaltensänderung mit Fail-open-Risiko** (unvollständige Redaction leakt ein Secret —
schlimmer als das heutige Gate). Der 2b-CO muss **vor Code** festlegen: (i) **Fail-closed-Default**
(unbekannte Response-Form → bleibt gegatet), (ii) **Platzierung beim Owner-Daemon** (Secret verlässt den
Owner gar nicht erst — nicht erst beim Requester redigieren), (iii) konservative Secret-Key-Liste. Das
`sensitive`-Set aus 2a ist der Eingabe-Umfang.

## Konsequenzen
- **+** Operatives Signal „unlisted-on-governed → kuratieren" im Audit; `sensitive`-Absicht strukturell + testbar.
- **+** Cross-Check-Test schließt Signal-Gate-Drift strukturell aus.
- **0** **Null** Gate-Verhaltensänderung (reine Telemetrie/Struktur). Ungoverned + Plain unberührt.
- **−** Der „Drift-Check" ist bis zur Live-Verdrahtung nur ein Snapshot-Lint — im ADR/PR ehrlich benannt.
