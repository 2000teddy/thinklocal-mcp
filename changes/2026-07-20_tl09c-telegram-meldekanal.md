# changes/2026-07-20 — feat(gate): TL-09c realer TelegramMeldekanal (Inline-Keyboard → approvals.ts)

**Typ:** Daemon-Feature (realer `Meldekanal`, **injizierbar**, **KEINE** `index.ts`-Verdrahtung). **Kein**
Runtime-Change auf dem laufenden Daemon, kein Deploy/Secret. Die Registry wird weiter **leer** konstruiert
(`new MeldekanalRegistry([])`) → `DenyAllChannel` → `gate` bleibt 403, byte-identisch zu heute.

## Warum
Nach TL-09b/ADR-037 ruft der Ingress zwar `MeldekanalRegistry.requestApproval(...)`, aber die Registry ist
**leer** (kein realer Kanal) → jede `gate`-Freigabe endet `denied-no-channel` → 403. Der `approved →
Executor`-Pfad ist prinzipiell unerreichbar. TL-09c liefert den **ersten realen Kanal**, sodass eine
`gate`-Freigabe technisch `approved` werden **KANN** — ohne die Produktion anzufassen (Aktivierung bleibt
token-gegatet, RUNBOOK-TL-11 §TL-09c).

## Was
- **Neu `packages/daemon/src/telegram-meldekanal.ts`** — `TelegramMeldekanal implements Meldekanal`
  (ADR-036-Interface, unverändert):
  - **`TelegramApprovalTransport`** (schmale Bot-Glue-Naht) statt direkter `node-telegram-bot-api`-Kopplung.
    Grund: der bestehende `TelegramGateway` betreibt bereits einen Polling-Bot — ein zweiter Polling-Bot auf
    demselben Token ⇒ Telegram `409`. Die (gegatete) Aktivierung reicht den **bestehenden** Gateway-Bot als
    Transport herein (genau **ein** Bot). Zugleich macht die Naht die Fail-closed-Logik netzfrei testbar.
  - `requestApproval`: `approvals.create({type:'mcp_gate',…})` (durabler Anker) → Inline-Keyboard mit
    `callback_data` `tlgate:approve:<id>` / `tlgate:reject:<id>` → In-Memory `Map` bridged Callback↔Promise →
    `approvals.decide(...)` (idempotent) → `ApprovalDecision`.
  - **Fail-closed (ADR-036 C1/C2):** Abort ist **terminal** (Resolver aus Map entfernt → späterer Klick =
    No-op); unbekanntes `callback_data`-Shape ignoriert; **Chat-Bindung** (nur konfigurierter Freigabe-Chat);
    Doppelklick idempotent; `create`/`decide`/`sendPrompt`-Fehler ⇒ `error`, **nie stilles `approved`**.
  - `isHealthy` delegiert an `transport` (z.B. `getMe`); Fehler/Timeout ⇒ unhealthy → Registry überspringt.
- **`approvals.ts`:** `ApprovalType` additiv um `'mcp_gate'` erweitert (kein exhaustiver Switch existiert;
  Wert wird als freies TEXT-Feld persistiert = durable Audit-/Korrelations-Spur der gate-Freigaben).
- **`telegram-meldekanal.test.ts` (+12 Tests):** Injektions-Beweis über eine **reale** `MeldekanalRegistry`
  (approve→`approved`/`isApproved`, reject→`rejected`, unhealthy→`denied-no-channel`) inkl. durabler
  `approvals.ts`-Spiegelung; plus Fail-closed-Invarianten und **2 CR-Regressionstests** (s.u.).

## Abgrenzung (bewusst außer Scope — Aktivierung, gegatet)
- **Keine `index.ts`-Live-Verdrahtung** des Gateway-Bots als Transport → Registry bleibt leer, Risiko-Delta
  **null**. Die Aktivierung (Bot-Token + Freigabe-Chat) ist Christian-gegatet (RUNBOOK-TL-11 §TL-09c).
- **Keine Freigabe-Matrix** (TL-10, wählt später Kanal+Entscheider; hier gilt „erster gesunder Kanal").
- **`consensus` bleibt hart 403** (ADR-037).

## Compliance
- **CO:** entfällt als eigener Lauf — Interface + Fail-closed-Vertrag sind bereits in **ADR-036**
  (`pal:consensus` opus+sonnet, 2026-07-15) konsentiert; dieser Slice **implementiert** akzeptiertes Design
  (keine neue Architektur-Frage). Verankert in **ADR-038** VOR dem Code.
- **CG:** entfällt (Adapter eines bereits spezifizierten Interfaces).
- **TS ✅:** +12 Tests; Full-Suite **1809 grün** (133 Files), `tsc --noEmit` (strict) 0, eslint neue
  Produktionsdatei 0.
- **CR ✅:** externer Claude-Review-Subagent (agy fehlt für `pal:codereview`). **1 HIGH** gefunden & gefixt:
  Abort **während** `await sendPrompt` → `{once:true}`-Abort-Listener feuerte nie → pending-Eintrag leakte →
  später Klick setzte die durable Zeile nach Timeout auf `approved` (C1-Verletzung). Fix: `signal.aborted`-
  Recheck im Promise-Executor vor `pending.set` → terminal `timeout`. **Regressionstest** (Abort-in-flight)
  + MEDIUM-Test (decide-throws→`error`) ergänzt. LOW (toter `note`) entfernt.
- **PC ✅:** `git diff` gesichtet, Secret-Scan clean (nur Doku-Referenzen auf „Token", warum **kein** Secret
  im Code/Test liegt).
- **DO ✅:** dieser Eintrag, `ADR-038`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die zwei Modul-/
  Testdateien.
