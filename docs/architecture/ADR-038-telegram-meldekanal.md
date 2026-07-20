# ADR-038 — Realer `TelegramMeldekanal` (TL-09c, Slice C)

**Status:** Accepted
**Datum:** 2026-07-20
**Kontext-Task:** TODO TL-09c (Folge von TL-09b / ADR-037). Der erste **reale** `Meldekanal`:
Inline-Keyboard-Callback → `approvals.ts`-Store. Damit KANN eine `gate`-Freigabe technisch `approved`
werden — die Naht aus ADR-037 bekommt ihren ersten lebenden Kanal.
**Gate:** Architektur-Gate 2 (ENTSCHEIDUNGEN.md 02.07.), Design-Vorgabe 10.
**Verwandt:** ADR-036 (`meldekanal.ts` Interface + Registry), ADR-037 (Ingress-Wiring, Allowlist
`isApproved`), `telegram-gateway.ts` (bestehender Bot-Peer), `approvals.ts` (Store), TL-10 (Freigabe-Matrix).
**CO:** Interface + Fail-closed-Vertrag sind bereits in ADR-036 (`pal:consensus` opus+sonnet, 2026-07-15)
konsentiert; dieser Slice **implementiert** das akzeptierte Interface, er entwirft keine neue Architektur.
Keine neue Design-Frage → kein zusätzlicher `pal:consensus`-Lauf (CLAUDE.md: CO nur bei Design-Fragen).

## Problem

Nach ADR-037 ruft der Ingress hinter `TLMCP_APPROVAL_CHANNEL_ENABLED` zwar
`MeldekanalRegistry.requestApproval(...)` auf, aber die Registry wird **leer** konstruiert
(`new MeldekanalRegistry([])`) → `DenyAllChannel` → jede `gate`-Freigabe endet `denied-no-channel` → 403.
Es gibt **keinen realen Kanal**, über den ein Betreiber tatsächlich zustimmen könnte. Solange keiner
existiert, ist der `approved → Executor`-Pfad prinzipiell unerreichbar.

## Entscheidung

**Slice C (dieser ADR): der erste reale `Meldekanal` — `TelegramMeldekanal`. Kein Runtime-Flip.**

`packages/daemon/src/telegram-meldekanal.ts` liefert `TelegramMeldekanal implements Meldekanal`
(ADR-036-Interface, unverändert) plus einen schmalen `TelegramApprovalTransport` (Bot-Glue-Naht).

### Warum eine Transport-Naht statt direkter `node-telegram-bot-api`-Kopplung

- **Kein zweiter Polling-Bot.** Der bestehende `TelegramGateway` betreibt bereits `TelegramBot({polling:true})`.
  Ein zweiter Polling-Bot auf demselben Token ⇒ Telegram-`409 Conflict`. Der `TelegramMeldekanal` besitzt
  **keinen** eigenen Bot; er spricht gegen `TelegramApprovalTransport`. Die (spätere, token-gegatete)
  Live-Aktivierung reicht den **bestehenden** Gateway-Bot als Transport herein — genau **ein** Bot.
- **Unit-testbar ohne Netz.** Die gesamte Fail-closed-Logik (Abort-Invalidierung, unbekannte Callbacks,
  Doppelklick, fremder Chat) wird gegen einen Fake-Transport getestet — keine Telegram-API im Test.

### Ablauf `requestApproval(req, signal)`

1. **Persistenz:** `ApprovalService.create({ type: 'mcp_gate', payload: req, summary: req.summary })` →
   `approvalId` (durabler Audit-/Korrelations-Anker; `mcp_gate` ist ein neuer, additiver `ApprovalType`).
2. **Vorlage:** `transport.sendPrompt(...)` mit zwei Inline-Buttons; `callback_data`
   `tlgate:approve:<approvalId>` / `tlgate:reject:<approvalId>`.
3. **Bridge:** ein In-Memory `Map<approvalId, resolver>` verbindet den asynchronen Callback mit dem
   awaitenden Promise.
4. **Warten:** Rennen zwischen Betreiber-Entscheidung und `signal` (Registry-Timeout).
5. **Entscheidung:** `ApprovalService.decide(approvalId, 'approved'|'rejected', note)` (idempotent),
   Keyboard einfrieren (best-effort), `ApprovalDecision` zurück.

### Fail-closed-Invarianten (ADR-036 C1/C2, hier konkret durchgesetzt)

- **C1 Abort ist terminal.** Bei `signal.abort` (Timeout) wird der Resolver **aus der Map entfernt**
  (invalidiert). Eine danach eintreffende Betreiber-Antwort findet keinen Resolver → **No-op**, wird
  **nie** nachträglich als Entscheidung konsumiert. Der interne Promise resolved dann `timeout` (von der
  Registry ohnehin verworfen — kein Leak, kein Hänger).
- **C2 Nur `approved`/`rejected` aus Callback.** `callback_data` wird streng geparst
  (`tlgate:approve:<id>` | `tlgate:reject:<id>`); jedes andere Shape ⇒ ignoriert. Der Registry-Normalizer
  (`normalizeDecision`) bleibt die zweite Mauer.
- **Chat-Bindung.** Ein Callback wird nur akzeptiert, wenn `chatId` dem konfigurierten Freigabe-Chat
  entspricht (Defense-in-depth zusätzlich zur Transport-/Gateway-Allowlist).
- **`isHealthy(signal)`** delegiert an `transport.isHealthy` (z.B. `getMe`); Fehler/Timeout ⇒ unhealthy
  (Registry überspringt den Kanal — nie „approved by accident").

### Injizierbarkeit & fail-closed Default (kein Runtime-Flip)

- Der Kanal ist als `Meldekanal` **injizierbar**: `new MeldekanalRegistry([telegramMeldekanal])`. Ein Test
  beweist end-to-end `approved → ApprovalDecision('approved')` über eine **reale** Registry (die „KÖNNTEN"-
  Anforderung des Tasks).
- **`index.ts` bleibt in diesem Slice unverändert**: die Registry wird weiter **leer** konstruiert
  (`new MeldekanalRegistry([])`). Ohne realen Bot-Token existiert kein Transport → nichts zu injizieren.
  Damit ist das Risiko-Delta auf dem laufenden Daemon **null** (gate bleibt 403, byte-identisch zu heute).
- Die **Aktivierung** (Gateway-Bot als Transport hereinreichen + Freigabe-Chat setzen) braucht
  Bot-Token/Secret und ist damit **Christian-gegatet** (RUNBOOK-TL-11 §TL-09c). Sie ist der explizite
  Freischalt-Schritt, **nicht** Teil dieses PRs.

## Bewusste Grenze (Folge-Slices)

- **Keine Live-Verdrahtung** des Gateway-Bots in `index.ts` (token-gegatet, Folge-Slice / Aktivierung).
- **Keine Freigabe-Matrix** — TL-10 wählt später Kanal+Entscheider; hier gilt weiter „erster gesunder Kanal".
- **`consensus` bleibt hart 403** (ADR-037, Quorum-Konstrukt fehlt).
- **Kein Restart-übergreifendes Wieder-Aufnehmen** einer pending Freigabe: der awaitende HTTP-Request ist
  nach Restart ohnehin tot. Der `approvals.ts`-Eintrag bleibt als Audit-Spur bestehen.

## Konsequenzen

- **+** Erster realer Kanal existiert; der `approved`-Pfad ist über eine echte Registry **beweisbar**
  erreichbar (Unit-/Injektions-Test), ohne die Produktion anzufassen.
- **+** `approvals.ts` bekommt einen zweiten realen Consumer (`mcp_gate`) — durable Audit-Spur der
  gate-Freigaben.
- **0** Laufender Daemon unverändert (leere Registry) → TL-07-Beweis und Produktions-Denials unberührt.
- **−** Bis zur (gegateten) Aktivierung bleibt `gate` real 403. Beabsichtigt.
