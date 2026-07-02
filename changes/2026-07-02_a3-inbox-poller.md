# A3 — ADR-004 Inbox-Empfangs-Loop (wiederverwendbare Poller-Primitive, code-only)

**Datum:** 2026-07-02
**Branch:** `claude/mesh-a3-inbox-poller` (eigenständig gegen `origin/main`)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Mesh-Messaging / ADR-004) — **code-only, kein Deploy**
**Bezug:** Mesh-Messaging-Auftrag `hermes-task-mesh-messaging-20260702.md`, Slice **A3**

## Kontext

Kein Agent pollt heute die Inbox (inbox.db überall leer). A3 liefert die **wiederverwendbare,
deploy-agnostische Empfangs-Loop-Primitive** gemäß ADR-004 (`unread → deliver → mark-read`). Die
eigentliche Session-Zustellung (Hook/agent-send/Supervisor) bleibt bewusst **außerhalb des Repos**
(Agent-Home) — dieser Slice kapselt nur die Poll-/Mark-/Fehler-Isolations-Logik.

## Lösung (`inbox-poller.ts`)

- **`pollInboxOnce(deps)`** — ein Zyklus: ungelesene holen, je Nachricht `deliver` → (nur bei Erfolg)
  `mark-read`. **At-least-once:** mark-read passiert ERST nach erfolgreicher Zustellung → ein
  Zustell-Crash verliert nie eine Nachricht (Redelivery, Dedupe per `message_id`). Pro-Nachricht
  fehler-isoliert, Reihenfolge erhalten.
- **`createInboxPoller(deps, opts)`** — Interval-Runner: **nicht-überlappend** (inFlight-Guard gegen
  Doppel-Zustellung bei langsamem `deliver`), fehler-gekapselt (Zyklus-Fehler crasht den Loop nie),
  `unref()`, `start/stop` idempotent (Timer injizierbar für Tests).
- **`buildDaemonInboxDeps` / `createDaemonInboxPoller`** — Daemon-I/O gegen `requestDaemon`
  (`GET /api/inbox?unread=true[&for_instance=<uri>]`, `POST /api/inbox/mark-read`); `for_instance`
  nutzt die A1-Instanz-URI, sodass nur an die eigene Instanz adressierte Nachrichten gepollt werden.

## Tests

- **`inbox-poller.test.ts`** (13): `pollInboxOnce` (leer, happy+Reihenfolge, at-least-once-Zustell-Fehler,
  **CR-M1** markRead-Fehler→`markFailed`≠`failed`), `createInboxPoller` (Interval-Runner, **Nicht-
  Überlappung** unter async, Fetch-Fehler crasht Loop nicht, start/stop), `buildDaemonInboxDeps`
  (Endpoint + `for_instance`-Enkodierung, non-2xx→wirft, **CR-M2** malformter JSON→klarer Fehler,
  defensives messages-Array, mark-read POST/Fehler) — via `vi.mock` von `requestDaemon`.
- Volle Suite **1319 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: at-least-once (boom bleibt ungelesen).

## Review

Unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env):
**APPROVE-WITH-NITS**, 0× CRITICAL/HIGH. At-least-once korrekt (kein mark-without-deliver; kein
Message-Loss), Nicht-Überlappung hält unter async, `for_instance` enkodiert, kein Body-Logging.
- **CR-M1 (MEDIUM):** `failed` konflierte Zustell- und mark-read-Fehler → eigenes `markFailed`-Feld
  (Betrieb unterscheidet „sicher wartend" von „Duplikat kommt").
- **CR-M2 (MEDIUM):** malformter JSON-2xx-Body → nackter SyntaxError (log-ununterscheidbar von „down")
  → klarer Fehler + Test; `buildDaemonInboxDeps` extrahiert + getestet (vorher uncovered).
- **CR-L1** (`as`-Cast trusted-source) + **CR-L2** (`stop()` ist kein Quiesce) im Code dokumentiert.

## Folge / offen

- **A2** Flotten-Rollout (Deploy-Gate). **A4** Runbook + Probelauf.
- **Deploy-Zeit (Agent-Home, außerhalb Repo):** `createDaemonInboxPoller` in den jeweiligen
  Agent-Supervisor/Hook einhängen (deliver → Session via agent-send) + `forInstance` aus der
  A1-Registrierung. CR-M1 (E2E send-to-instance) wird beim Live-Probelauf (DoD) verifiziert.
- **Kein Deploy in diesem Slice.**
