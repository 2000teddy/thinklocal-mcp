# T2.2 — InfluxDB-Health-Probe-Fix + Skill-Health-Alert-Event (V5 Spur 2)

**Datum:** 2026-06-29
**Branch:** `claude/t22-influx-probe-alert-sink`
**Owner:** Claude (ThinkLocal — Probe-/Daemon-Seite; Push-Zustellung = Admin/Hermes)
**Typ:** Bugfix + Observability — kein Deploy
**V5-DoD:** Punkt 4 („kein stiller Fehler mehr")

## Problem

Die InfluxDB-Health-Probe meldete **22.786 Fehlversuche bei gesundem Dienst**.
Root-Cause: `influxdbHealthCheck` prüfte `${INFLUXDB_URL}/health` — dieser Endpoint
existiert **erst ab InfluxDB 1.8**. Auf älteren 1.x-Knoten liefert `/health` **404**
→ `res.ok === false` → die Probe stufte einen GESUNDEN Dienst dauerhaft als
unhealthy ein (Queries/Writes funktionierten parallel einwandfrei).

## Fix (Probe — der eigentliche Bug)

`influxdbHealthCheck` (`builtin-skills/influxdb.ts`):
- `/health` zuerst (reichere Readiness-Aussage, wo vorhanden) → bei `ok` healthy.
- Bei **nicht-ok oder Netzwerkfehler**: Fallback auf **`/ping`** — den universellen,
  auth-freien Liveness-Endpoint (204 No Content) über alle 1.x/2.x — statt sofort
  „unhealthy" zu melden.
- Geteiltes AbortSignal über beide Fetches; `if (sig.aborted) return false`-Guard
  dazwischen. Funktion gibt **immer** einen Boolean zurück (wirft nie).
- **Bewusster Trade (dokumentiert):** `/ping` ist Liveness-only — ein degradierter,
  aber lauschender Knoten gilt damit als healthy. Korrekt gegen die 1.x-false-negatives;
  Readiness nutzt weiterhin `/health`, wo vorhanden.

## Alert-Sink (daemon-seitig)

Flap-Dämpfung existiert bereits: der `SkillHealthMonitor` (ADR-021) debounced
State-Flips über Hysterese (`debounceUp`/`debounceDown`) — kein Flattern. Bisher
emittierte `onTransition` aber **kein** Sink-Event (nur Registry + Audit). Neu:
- **`events.ts`**: `system:skill_health`.
- **`index.ts`** `onTransition`: emittiert `system:skill_health` (skillId, from, to,
  consecutiveFailures, lastError) — **nur bei einem debouncten Flip**. Emit ist
  listener-isoliert (try/catch), damit ein werfender Sink-Listener den nachfolgenden
  Registry-Republish nicht überspringt.
- **Scope-Grenze (Plan):** die eigentliche **Push-Zustellung** an Hermes/Telegram ist
  Admin/Hermes-Seite; `system:skill_health` liegt als strukturiertes Event bereit.

## Tests

`builtin-skills/influxdb.test.ts` (neu, **6 Tests**): /health-200→healthy (kein /ping),
**/health-404→/ping-204→healthy (Regression)**, /health-Netzwerkfehler→/ping-Fallback,
beide-nicht-ok→unhealthy, beide-werfen→unhealthy, bereits-aborted-Signal→false-ohne-/ping.
Empirisch guard-bewiesen: /ping-Fallback entfernt ⇒ 3 rot; restauriert ⇒ 6 grün.
Volle Suite **102 Files / 1222 grün**, tsc 0, eslint 0 (neue Dateien).

## Review

Unabhängiger **Claude**-Subagent: **APPROVE-WITH-NITS**, Probe-Fix CORRECT, kein
High/Critical-Bug. Beide Nits adressiert: (1) `/ping`-Liveness-Semantik im Doc-Comment
dokumentiert; (2) `eventBus.emit` listener-isoliert (try/catch). (`pal`-externes
`agy`-Backend im Env nicht installiert → Claude-Subagent als echtes Review.)

## Out of scope / Folge

- **Push-Zustellung** `system:skill_health` → Telegram/Hermes (Admin/Hermes, T2.3-nah).
- Readiness-Detail aus `/health`-JSON (degraded-Erkennung) — größerer Folge-Slice.
