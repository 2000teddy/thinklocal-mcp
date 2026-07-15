# changes/2026-07-15 — feat(security): ADR-036 Meldekanal-Abstraktion + Fail-safe Deny-Default (TL-09 Slice A)

**Typ:** Daemon-Code (`meldekanal.ts` neu + `meldekanal.test.ts` neu) + Design-Doku (ADR-036).
**Slice:** TL-09 **Slice A** (P0-parallel Sicherheits-Pflicht, Beta-Blocker). Folge-Design zu ADR-033
(das Design-Vorgabe 10 „Meldekanal + Freigabe-Matrix" ausdrücklich als offen markiert).

## Warum
Seit ADR-033 verweigert der Hub-Ingress jeden schreibenden (`gate`) und kritischen (`consensus`)
MCP-Aufruf **hart mit 403** — die sichere Untergrenze, aber ohne jeden Weg, eine Freigabe **einzuholen**.
Design-Vorgabe 10 (Entscheidung 10) verlangt einen **austauschbaren** Meldekanal, über den ein
angehaltener Schreib-Aufruf einem Betreiber vorgelegt wird, mit der eisernen Regel (Kap. 7.4): *kein
erreichbarer Kanal ⇒ verweigert, niemals durchwinken.* Diese Regel lag bisher nur als hartkodiertes
403 im Ingress; Slice A verankert sie strukturell in einer testbaren, wiederverwendbaren Einheit.

## Was
- **`interface Meldekanal`** — `id`, `isHealthy(signal): Promise<boolean>`, `requestApproval(req, signal): Promise<ApprovalDecision>`.
- **`MeldekanalRegistry`** — wählt den ersten **gesunden** Kanal (Health timeout-umhüllt; Fehler/Timeout ⇒
  unhealthy → nächster Kanal). Der erste gesunde Kanal ist **terminal** (kein „frage bis einer Ja sagt").
  Kein gesunder Kanal (inkl. leerer Liste) ⇒ `denied-no-channel`.
- **`DenyAllChannel`** — eingebauter, immer-unhealthy Default; leer konstruierte Registry injiziert ihn →
  Default-Pfad liefert **beweisbar** `denied-no-channel`.
- **`isApproved(decision)`** — der EINZIGE erlaubte Auswertungspfad (Allowlist: nur `approved`).
- Fail-open-Härtung: `AbortSignal` in der Signatur (Timeout terminal, späte Resolution/Rejection verworfen,
  kein Unhandled-Rejection), Rückgabe-Shape-Normalisierung (unbekanntes Shape ⇒ `error`), synchroner Wurf
  eines Kanals wird zu Rejection gewandelt (bricht die Kette nicht ab).

## Bewusste Grenze
`mcp-ingress.ts` **unverändert** (hartes 403 bleibt) → Risiko-Delta null, TL-07-Beweis unberührt. Kein
Telegram-Adapter, kein Audit-Logging in diesem Slice. Das Ingress-Wiring (403 →
`registry.requestApproval`, hinter Env-Flag, Default = heutiges Verhalten) + der `TelegramMeldekanal`
sind **Slice B / TL-09b** (in TODO.md als Folge-Ticket geführt, damit `meldekanal.ts` nicht als toter
Code liegen bleibt). Die Freigabe-Matrix (Werkzeug-Klasse → Kanal → Entscheider) ist **TL-10**.

## Compliance
- **CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) —
  Konsens: Zerlegung annehmen, drei Interface-Nachschärfungen (async `isHealthy`, Deny-Default in Registry
  + Allowlist-Auswertung, `AbortSignal` in Signatur). ⚠️ Cross-Vendor (codex/agy) nicht im PATH → nur
  Claude-Modelle diese Runde. Beleg: `~/hermes/reports/2026-07-15_1004_TL09-consensus.md`.
- **CG:** n/a (Backend agy/gemini nicht installiert; Testdesign aus dem CO abgedeckt).
- **TS:** +22 Unit-Tests (Deny-Default leer/Default-Ctor, erster gesunder Kanal terminal für
  approved/rejected/timeout/error/bad-shape, unhealthy-skip, sync-Wurf Health+Approval, non-boolean-truthy
  Health, späte Rejection kein Unhandled-Rejection, `isApproved`-Allowlist). Volle Suite **1588 grün**,
  tsc sauber, ESLint 0.
- **CR:** Claude-Review-Subagent (adversarial, Fail-open-Fokus; agy-Backend fehlt) — kein direkter
  Fail-open-Pfad. HIGH (Test-Lücke: terminal-erster-Kanal bei timeout/error nicht gepinnt) + MEDIUM
  (synchroner Kanal-Wurf entkommt `withTimeout`) **beide in-slice gefixt + Regressionstests**; 2 LOW ebenfalls.
- **PC:** `git diff` — nur 3 neue Dateien (Modul + Test + ADR), `mcp-ingress.ts` unangetastet; Secret-Scan clean.
- **DO:** ADR-036, `TODO.md` (TL-09 Slice A ✅ / TL-09b offen), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
