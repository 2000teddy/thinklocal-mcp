# changes/2026-07-25 — test(tl12): S5 Read-Surface am HTTP-Rand gehärtet (`GET /api/inbox` re-verifiziert live)

**Typ:** **Test-only**. Keine Produktionsdatei berührt, keine Entscheidung, kein Deploy/Secret/Host. Bewacht
eine bereits gebaute Zusage (TL-12 Slice A / ADR-038, S5) — **vor** dem owner-gateten S6.

## Die Lücke
`verifyStoredOrder` (die reine Re-Verify-Funktion) ist in `agent-inbox.test.ts` gut bewacht — inkl. eines
Byte-Flip-Tamper-Falls. Aber der **Read-Surface-Endpunkt** (`inbox-api.ts` `GET /api/inbox`, S5 des
Zustellpfads) war für Aufträge nur **mittelbar** getestet: die vorhandenen inbox-api-Tests decken
send/Filter/ACL, **nicht** das `order`-Surfacing (`is_order` + `verify_verdict`) und **nicht** die zentrale
Zusage aus `inbox-api.ts:382` — „ein auf der Platte manipulierter Auftrag zeigt hier `INVALID` … eine
bösartige Zeile legt die Liste nicht lahm".

## Was
Neu `packages/daemon/src/tl12-order-read-surface.test.ts` (+3 Tests) — fährt `GET /api/inbox` über
`fastify.inject()` (kein Socket) gegen eine echte `AgentInbox`:
- **gültiger Auftrag** → `is_order=true`, `order.verify_verdict=VALID`, Provenienz (`signer_spiffe`/
  `order_nonce`) surfaced.
- **echte On-Disk-Manipulation** — eine **zweite** `better-sqlite3`-Verbindung auf dieselbe `inbox.db` kippt
  ein Byte in `signed_bytes` (WAL erlaubt den Fremd-Writer; genau das, was ein Angreifer mit Plattenzugriff
  täte). Das **Live-Re-Verify beim Lesen** dreht `VALID → INVALID`, der Endpunkt bleibt `200`. Belegt
  `inbox-api.ts:382` am HTTP-Rand, nicht nur an der reinen Funktion.
- **fail-closed-Loop** — eine manipulierte Auftragszeile neben einer Plain-Nachricht: `count` bleibt
  vollständig, die bösartige Zeile verschluckt die andere nicht.

**Abgrenzung:** **S6 (Abarbeitung) ist NICHT Gegenstand** — owner-gated, nicht gebaut. Hier nur das
Lese-Verdikt (S5). Kein Executor/Ledger, kein Gate-Vorgriff.

## Tests
`npx vitest run` grün. **Mutations-verifiziert:** gäbe der Handler die **gespeicherte** `verify_verdict`-Spalte
zurück (`m.verify_verdict`) statt live `inbox.verifyStoredOrder(m)` aufzurufen, würden die On-Disk-Tamper- und
der fail-closed-Loop-Test rot (`expected 'VALID' to be 'INVALID'`). `tsc --noEmit` grün, `eslint` grün. Full
Suite **2074 grün** (146 Files; +3 ggü. 2071).

## Compliance
- **CO/CG:** entfallen — keine Design-Entscheidung; Test gegen bereits gemergten Code (ADR-038).
- **TS ✅:** +3 Tests, mutations-verifiziert, Suite 2074 grün.
- **CR:** Self-Review — der Test fährt den echten Endpunkt + eine echte DB-Manipulation, keine Tautologie
  (Mutation beißt zweifach); externes `agy`-Review am PR nachzuziehen.
- **PC:** Secret-Scan clean (In-Memory-Testschlüssel via `generateKeyPairSync`, keine echten Keys/Secrets).
- **DO ✅:** dieser Eintrag, `TL-12-delivery-path.md` §S5, `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-12 **S6/Slice B** (Abarbeitung, owner/CO), ADR-046 §9, msg 1453 — **nicht** berührt.
