# T2.2-Follow-up — Alert-Events in den Daemon-Telegram-Sink verdrahten

**Datum:** 2026-06-30
**Branch:** `claude/t22-telegram-alert-sink-wire`
**Owner:** Claude (ThinkLocal — daemon-seitiger Sink)
**Typ:** Bugfix (Observability-Lücke) — kein Deploy
**V5-DoD:** Punkt 4 („kein stiller Fehler mehr")

## Problem (live belegt)

T2.1 (#213) und T2.2 (#214) emittieren zwei Alert-Events auf dem Mesh-EventBus:
- `system:cert_expiry` — TLS-Node-Cert läuft bald ab (warn/critical), vom periodischen
  Monitor (`cert-expiry-monitor.ts`).
- `system:skill_health` — debouncter Skill-Health-State-Flip, aus `index.ts onTransition`.

Der Daemon hat einen **eigenen** Telegram-Sink (`TelegramGateway`), der via `onAny`
am EventBus hängt und bereits sechs Event-Typen an einen Operator-Chat weiterleitet
(`peer:join/leave`, `task:completed/failed`, `system:startup/shutdown`). **Aber:** der
Forwarding-`switch` kannte die beiden neuen Alert-Events nicht — sie fielen durch und
erreichten **keinen** Operator. Die T2.1/T2.2-Alerts waren damit emittiert, aber
de-facto stumm (der Emit ging an keinen Telegram-Empfänger).

Belegt durch Code-Lesen (`git log` + Switch-Inspektion): vor diesem Slice gab es im
gesamten Daemon **keinen** Subscriber, der `system:skill_health`/`system:cert_expiry`
an einen Operator zustellte — nur den generischen `onAny`-Switch ohne passenden Case.

## Fix

`telegram-gateway.ts`:
1. **Refactor (testbarkeits-getrieben):** die Mapping-Logik des Switch wurde in eine
   **reine, exportierte** Funktion `formatMeshEventForTelegram(event, ts): string | null`
   extrahiert. `null` = nicht weiterleiten (Spam-Unterdrückung für Heartbeats etc.).
   Grund: der `TelegramGateway`-Konstruktor startet echtes Bot-Polling
   (`new TelegramBot(token, { polling: true })`) — die reine Funktion ist ohne Bot
   testbar. Die sechs bestehenden Cases sind **byte-identisch** übernommen (kein
   Verhaltens-Drift), `setupEventBridge` delegiert nur noch an die Funktion.
2. **Zwei neue Cases:**
   - `system:cert_expiry` → 🟠 WARNUNG bzw. 🔴 KRITISCH (+ „Neustart für Reissue"-Hinweis
     bei critical), mit `daysLeft`.
   - `system:skill_health` → ⚠️ „ungesund" bzw. ✅ „wieder gesund" (bei `to==='healthy'`),
     mit `from→to`, `consecutiveFailures` und optionalem `lastError`-Suffix.

**Keine Flap-Dämpfung hier nötig** — sie passiert upstream: skill_health feuert nur bei
einem debouncten Flip (SkillHealthMonitor-Hysterese), cert_expiry nur an den Schwellen
(warn/critical) im 12h-Check. `sendNotification` behandelt Telegram-429 bereits (drop).

## Scope-Grenze

Dies verdrahtet den **daemon-eigenen** TelegramGateway-Sink. Die breitere
Operator-Routing-Infrastruktur (Hermes-Orchestrator-Kanal) bleibt Admin/Hermes-Seite —
dieser Slice macht lediglich die bereits gemergten T2.1/T2.2-Alerts über den vorhandenen
Daemon-Sink tatsächlich zustellbar, statt sie im Switch verfallen zu lassen.

## Tests

`telegram-gateway.test.ts` (neu, 11 Tests) — erste Testdatei für dieses Modul:
- skill_health: ungesund-Flip (⚠️, Fehlerzahl, lastError), Recovery-Flip (✅, kein Suffix).
- cert_expiry: warn (🟠, kein Reissue-Hinweis), critical (🔴, Reissue-Hinweis).
- Regression: alle sechs bestehenden Cases liefern weiterhin ihre Strings.
- Spam-Unterdrückung: `peer:heartbeat`/`capability:synced`/`audit:new`/`task:created` → `null`.

Volle Suite **104 Files / 1249 grün**, tsc 0, eslint 0. Empirischer Beleg:
`system:skill_health`-Case entfernt ⇒ 2 rot, restauriert ⇒ 11 grün.

## Was dieser Slice NICHT tut

Kein Deploy, keine neue Infra, kein neuer Event-Typ. Nur die Zustellung der zwei
bestehenden Alert-Events über den vorhandenen Daemon-Telegram-Sink + Tests.
