# changes/2026-07-27 — refactor+test(tl14a): Vorbedingung-B-Monitor-Verdrahtung regressionsfest

**Typ:** **Behavior-preserving Refactor + Test** (kein Verhaltens-Delta). Gate-frei, D3-unabhängig. **Kein
Doppel:** die B-Funktionsteile sind seit #297 gemergt — dies schließt die **ungetestete Verdrahtung**, nicht
die Funktion.

## Kontext: B ist funktional bereits da (#297) — die Verdrahtung war ungetestet
ADR-045 Vorbedingung B verlangt: der Monitor überwacht Node **und** CA/Intermediate getrennt. **#297**
(gemergt) lieferte die Funktionsteile — `getCaCertDaysLeft` (`tls.ts`), das `subject`-Label in
`cert-expiry-monitor.ts` und `ca-cert-expiry.test.ts`. **Aber** die **Auswahl „welcher Monitor liest welche
Quelle"** lag als zwei fast identische `startCertExpiryMonitor(...)`-Blöcke **inline in `index.ts`** und war
**ungetestet**: ein versehentliches „beide Monitore lesen `node.crt.pem`" oder ein weggefallener CA-Monitor
wäre **unsichtbar** geblieben (die Unit-Tests decken die reinen Funktionen, nicht die Verdrahtung).

## Was
- **Neu `packages/daemon/src/cert-monitor-wiring.ts`** — reine `buildCertExpiryMonitorSpecs(dataDir,
  thresholds)`: liefert genau zwei Specs — Node (`getCertDaysLeft`, `subject:'Node'`) + CA/Intermediate
  (`getCaCertDaysLeft`, `subject:'CA'`), gemeinsame Schwellen. Kein I/O beim Bauen (die `getDaysLeft`-Closures
  lesen erst beim Aufruf).
- **`index.ts`**: die zwei inline-Blöcke ⇒ `buildCertExpiryMonitorSpecs(...).map((spec) =>
  startCertExpiryMonitor({ ...spec, log, audit, eventBus }, interval))`; Shutdown räumt jetzt
  `certExpiryTimers.forEach((t) => clearInterval(t))`. **Verhalten identisch** (zwei Monitore, gleiche
  Quellen/Subjects/Schwellen/Intervall, beide im Shutdown geräumt); `getCertDaysLeft`/`getCaCertDaysLeft`-Import
  aus `index.ts` entfernt (nur noch im Wiring-Modul genutzt).
- **Neu `cert-monitor-wiring.test.ts`** (+4): genau 2 Specs mit subjects `['Node','CA']`; Schwellen
  durchgereicht; **getrennte Quellen bewiesen** — nur `node.crt.pem` ⇒ Node-Quelle liefert, CA-Quelle `null`;
  nur `ca.crt.pem` ⇒ umgekehrt; kein I/O beim Bauen (nicht-existentes dataDir wirft nicht, Aufruf ⇒ `null`).

## Tests
`tsc --noEmit` grün; `eslint` auf den neuen Dateien grün (der 1 vorbestehende `index.ts:293`-Error ist nicht
aus diesem Slice). Full Suite **2101 grün** (150 Files; +4 ggü. 2097). Der index.ts-Refactor ist
verhaltensbewahrend — **keine** bestehende Test brach.

## Compliance
- **CO/CG:** entfallen — Refactor + Test, keine Design-Entscheidung.
- **TS ✅:** +4 Tests (die Verdrahtung ist jetzt regressionsfest), Suite 2101 grün.
- **CR:** Self-Review; **claude/codex/agy** am PR (codex fällt derzeit aus — OAuth; also claude/agy). **Nie**
  MiniMax/pal:chat.
- **PC:** Secret-Scan clean (In-Memory-Testzertifikate).
- **DO ✅:** dieser Eintrag, `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** D3-Sign-off/ADR-045-Status/Runbook/TL-14b, C-Entscheidung. **Nicht berührt:** ADR-046
§9, msg 1453, TL-08/09/10-Gates. **Kein Christian-Ping.**
