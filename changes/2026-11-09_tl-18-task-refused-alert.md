# TL-18-Rest — `task:refused` erreicht den Operator (Alarm-Weg geschlossen)

**Datum:** 2026-11-09
**Branch:** `agent/claude-code/tl-18-task-refused-alert`
**Basis:** `main` @ `ee6e9ca` (Merge von #366)
**PR:** #367
**Auftrag:** Workday-Watchdog Sweep #115 — Rest von `TODO.md` TL-18
**Art:** Verhaltens-Ergänzung an einer reinen Abbildungsfunktion + Tests. Kein Deploy,
kein Release, kein Secret, kein State, kein Dienst-Eingriff, kein Beschluss.

---

## 1. Befund selbst nachgeprüft — mit einer Präzisierung gegen den Auftragstext

Der Auftrag kam aus der externen CR-Runde zu #366 und verlangte ausdrücklich eine eigene
Nachprüfung. Ergebnis: **der Kern des Befunds stimmt, seine Formulierung nicht ganz.**

| # | Prüfung | Befehl / Stelle | Ergebnis |
|---|---------|-----------------|----------|
| 1 | Gibt es `task:refused`-Consumer? | `grep -rn "task:refused" packages/` | 3 Treffer: Typ-Union `events.ts:28`, Emit `task-executor.ts:155`, plus die mitgebaute `dist/events.d.ts`. **Kein** Handler. |
| 2 | Welche Sinks stellen `task:failed` zu? | `git grep -n "task:failed" -- 'packages/*/src/*'` | **drei** typ-bewusste Stellen: der `case 'task:failed'` in `telegram-gateway.ts` und in `dashboard-ui/.../Toasts.tsx` sowie der Symbol-Eintrag in `dashboard-ui/.../EventFeed.tsx` (Zeilennummern bewusst weggelassen — dieser PR verschiebt sie selbst). Der Auftrag griff nur `packages/daemon/src/` ab und sah die zwei Dashboard-Sinks nicht. |
| 3 | Gibt es typ-**agnostische** Consumer? | `git grep -n "onAny" -- 'packages/daemon/src/*.ts'` | **ja, zwei**: `setupEventBridge` in `telegram-gateway.ts` (filtert über `formatMeshEventForTelegram`) und `websocket.ts:263` (broadcastet **jedes** Event an Dashboard-Clients). |
| 4 | Payload-Felder | `task-executor.ts:155` | `taskId, skillId, requester, reason:'capacity', limit, ramUsedPercent, cpuLoad, agentCount` — `cpuLoad`/`agentCount` sind `number \| null`. |
| 5 | Typ von `limit` | `resource-metrics.ts:53` | `limit?: 'ram' \| 'cpu' \| 'agents'` — **optional**, also im Sink gegen `undefined` zu sichern. |
| 6 | Verschluckt ein zweiter Sink das Event? | `default`-Zweig in `Toasts.tsx`, Symbol-Lookup in `EventFeed.tsx` | `Toasts.tsx` **ja** (`default: return null`, wie Telegram). `EventFeed.tsx` **nein** — dort greift der Fallback `?? '📌'`, das Event war also nur ohne eigenes Symbol sichtbar. |

**Präzisierung, die in `TODO.md` und in der Compliance-Zeile von #366 so nicht steht:**
„repo-weit keinen Consumer" ist zu scharf. Der WebSocket-Broadcast ist typ-agnostisch und
hat `task:refused` immer schon an offene Dashboard-Clients geliefert. Was fehlte, war ein
**typ-bewusster Alarm-Sink**: beide Switches, die `task:failed` kennen, warfen
`task:refused` in den `default`-Zweig. Für TL-18 („Ablehnung **+ Alarm**") ist das der
tragende Punkt — ein Event, das nur in einem offenen Browser-Tab auftaucht, erreicht
keinen Operator. Der Befund bleibt damit gültig, seine Begründung wird genauer.

## 2. Was geändert wurde

| Datei | Änderung |
|-------|----------|
| `packages/daemon/src/telegram-gateway.ts:55-85` | neue reine Hilfsfunktion `describeRefusalLimit` — macht die ausgelöste Dimension plus Messwert lesbar (`RAM 95.5 %`, `CPU 97.2 %`, `agent_count 25`) statt das Roh-Objekt zu dumpen. |
| `packages/daemon/src/telegram-gateway.ts:111-117` | `case 'task:refused':` direkt neben `case 'task:failed':` — `🚫 [ts] Task abgelehnt (Ueberlast): <skill> — <Dimension> ueber Schwelle (Anfrage: <requester>)`. |
| `packages/daemon/src/telegram-gateway.test.ts` | +8 Tests (eigener `describe`-Block), Regression-Block unverändert. |
| `packages/daemon/src/place-or-refuse.test.ts` | +6 Tests (eigener `describe`-Block „TL-18 — Alarmwege") auf alle **drei** Wege plus die Kette Executor→Sink. |
| `packages/dashboard-ui/src/components/Toasts.tsx:23-29` (`case` + Kommentar) | `case 'task:refused':` parallel zum Telegram-Sink, `type: 'warning'` (Überlast ist kein Fehlschlag). |
| `packages/dashboard-ui/src/views/EventFeed.tsx:11` | Symbol `🚫` statt Fallback-Pin. |

**Keine** Änderung an `task-executor.ts`, `events.ts`, `websocket.ts`, am Bot-/Polling-Code
oder an der Entscheidungslogik. Der Alarm-Weg wird am Sink geschlossen, nicht an der Quelle —
damit ändert sich am Verhalten des Gates selbst nichts.

### Warum die drei Entscheidungen im Text so gefallen sind

- **Messwert mitgeben, nicht nur die Dimension.** „Knoten überlastet" ohne Zahl ist für
  einen Operator nicht handlungsfähig. `describeRefusalLimit` spiegelt bewusst
  `describeLimit` (`task-executor.ts:35-50`), aber **ohne** Schwellwert: das Event trägt
  ihn nicht mit, und einen Default zu erfinden wäre eine Falschaussage im Alarmtext.
- **Fehlende Werte fallen auf die Dimensionsbezeichnung zurück.** `cpuLoad`/`agentCount`
  sind `number | null`, `limit` ist optional. Ohne Absicherung stünde `RAM undefined %`
  oder `NaN` in der Telegram-Nachricht. Ein Test prüft genau das.
- **Ganzzahl bleibt Ganzzahl, Prozent bleibt Prozent.** `agent_count 25` (nie `25.0`), aber
  `RAM 91.0 %` auch bei glattem Wert — `toFixed(1)` gilt für **alle** Prozentwerte, damit der
  Alarmtext und die Audit-Zeile aus `describeLimit` dieselbe Form haben. Ein erster Entwurf hatte
  `Number.isInteger` dimensionsunabhängig angewandt und wäre bei `ramUsedPercent: 91` auf `RAM 91 %`
  gelaufen (CR-Runde 1, LOW 2) — korrigiert und mit einem eigenen Test gesichert.

## 3. Test-Beleg

Alle Zahlen gemessen, Baseline **vorher auf demselben Arbeitsbaum** per `git stash` erhoben.

| Gate | Baseline (`main` @ `ee6e9ca`) | nach der Änderung |
|------|-------------------------------|-------------------|
| `packages/daemon`: `npx tsc --noEmit` | 0 Fehler | **0 Fehler** |
| `packages/daemon`: `npx tsc --noEmit -p tsconfig.scripts.json` | 0 | **0** |
| `packages/daemon`: `npm run lint:scripts` | 0 | **0** |
| `packages/daemon`: `npx vitest run` | 151 Dateien / 2123 Tests grün | **151 Dateien / 2137 Tests grün** (+14) |
| `packages/dashboard-ui`: `npx tsc --noEmit` | 0 | **0** |
| `packages/dashboard-ui`: `npx vite build` | Exit 0 | **Exit 0** (213 Module) |
| `packages/daemon`: `npx eslint src/` (nicht CI-gated, Altbestand rot) | 460 Probleme (245 Fehler / 215 Warnungen) | **460** |
| Wurzel `npm run lint`-Umfang (daemon+cli+dashboard+daemon-scripts, nicht CI-gated) | 462 Probleme (245 Fehler / 217 Warnungen) | **462** |

Die +14 Tests sind 8 im Telegram-Sink (`telegram-gateway.test.ts` 11 → 19) und 6 an den Alarmwegen
(`place-or-refuse.test.ts` 25 → 31). Die in #366 und im Auftrag genannten „21 Tests“ dieser Datei waren
`it(`-Vorkommen; vitest zählt die `it.each`-Fälle einzeln, daher 25 als Baseline. Ein erster Entwurf hatte
**zwei zusätzliche** Lint-Warnungen erzeugt (fehlende Rückgabetypen an zwei Arrow-Funktionen
im Logger-/Reader-Stub, im Daemon-Scope `460 → 462`); nachgezogen, beide Zähler wieder exakt auf
Baseline. Alle fünf geänderten Dateien liefern **0 Fehler**; die 5 Warnungen in
`place-or-refuse.test.ts` sind unverändert die vorbestehenden. **Die beiden Zahlen sind zwei
verschiedene Umfänge, nicht ein Widerspruch** — ein erster Entwurf dieses Dokuments hatte den
Daemon-Wert als „Wurzel-eslint“ ausgegeben; beide sind jetzt getrennt gemessen und benannt.

### Was die 6 neuen Alarmweg-Tests belegen

1. **Weg Event** — genau ein `task:refused` mit vollständiger Payload, und **kein**
   `task:accepted` (die Ablehnung reiht den Task gar nicht erst ein).
2. **Weg Audit** — genau eine `TASK_DELEGATE`-Zeile, `details` exakt
   `system.health refused: RAM 95.5% > 90%`, `peer_id` = Anfrager. Gegen die echte
   `AuditLog` (SQLite im Temp-Verzeichnis), nicht gegen einen Stub.
3. **Weg Log** — genau eine `log.warn` mit `[place-or-refuse]`-Kontext und den
   Entscheidungsfeldern inklusive `refuseRamPercent: 90`.
4. **CPU-Dimension** — `limit: 'cpu'` in Event **und** Audit-Detail.
5. **Unter der Schwelle** — kein Event, keine `refused`-Audit-Zeile, keine Warnung
   (Negativprobe gegen einen Alarm, der immer feuert).
6. **Kette Executor→Sink** — das **tatsächlich emittierte** Event durch
   `formatMeshEventForTelegram` geschickt ⇒ nicht `null`, enthält Skill und Messwert.
   Das ist der eigentliche Regressionsschutz: er bricht, sobald jemand den `case` wieder
   entfernt oder die Payload-Feldnamen in `task-executor.ts` umbenennt.

## 4. Was bewusst **nicht** getan wurde

- **Kein Test in `packages/dashboard-ui`.** Das Paket hat **keine** Test-Infrastruktur
  (`package.json` führt weder vitest noch ein `test`-Script, es existiert keine
  `*.test.*`-Datei). Die beiden Zeilen sind durch `tsc --noEmit` + `vite build` der CI
  abgedeckt; einen Test-Stack dafür einzuziehen wäre ein eigener Slice.
- **Keine Flap-Dämpfung / kein Rate-Limit** für `task:refused`. Ein überlasteter Knoten
  kann in Folge ablehnen und entsprechend viele Nachrichten erzeugen. Die bestehende
  Lösung im Haus ist Dämpfung **upstream** (Hysterese beim SkillHealthMonitor,
  Schwellwert-Check im cert-expiry-monitor — so steht es im Kommentar über
  `formatMeshEventForTelegram`), nicht im Sink. Das wäre eine Design-Entscheidung an der
  Quelle (`task-executor.ts`) und liegt außerhalb dieses Zuschnitts. **Als Rest in
  `TODO.md` benannt.**
- **Nichts an `TL-16`, `TL-17`, `TL-19`, `TL-22a/b`** — unberührt, bleiben offen.
- **Kein Branch-Delete** des alten lokalen `agent/claude-code/tl-23-graphql-dead-code`
  (Squash ⇒ `-d` lehnt ab, `-D` ist nicht freigegeben).

## 5. Abweichungen vom Auftragstext — ausdrücklich benannt

1. **Zwei Dateien mehr als die Scope-Liste**, beide im Dashboard. Der Auftrag listet
   `telegram-gateway.ts` + dessen Test (+ optional `place-or-refuse.test.ts`), verlangt im
   Prüfteil aber zugleich, `task:refused` **parallel** zu jeder Stelle zu behandeln, die
   `task:failed` zustellt — und nennt dafür einen Grep, der nur `packages/daemon/src/`
   abdeckt. Die zwei Dashboard-Sinks fallen in die Forderung, nicht in den Grep. Statt
   nach der Abbruchregel („mehrere Stellen ⇒ abbrechen") zu stoppen, sind es hier **ein
   `case` und ein Map-Eintrag ohne Logik** — abzubrechen hätte genau das Loch gelassen,
   das die Regel verhindern soll. Als Abweichung gemeldet, nicht stillschweigend getan.
2. **Die Formulierung des Befunds wurde korrigiert**, nicht nur übernommen: der
   WS-Broadcast *ist* ein Consumer (Abschnitt 1).
3. **`pal:codereview`** weiter unbrauchbar — Ersatzweg und Ergebnis in Abschnitt 5b.

## 5b. Externe Code-Review

`pal:codereview` ist unverändert unbrauchbar (beide Fremd-Backends melden
`executable not found in PATH`, wie in #364/#365/#366). Review-of-Record daher über
`~/.local/bin/agy --sandbox` — Gemini, also ein **anderes** Modell als das implementierende;
nie MiniMax, nie `pal:chat`. Als Abweichung gemeldet.

**Runde 1: APPROVE, 0 HIGH / 0 MEDIUM / 2 LOW / 2 NIT — alle vier eingearbeitet.**

- **LOW 1 (echter Selbstwiderspruch):** `TODO.md` trug einen Platzhalter `COMMIT_SHA`, den
  ein Commit per Konstruktion nicht auflösen kann — jede Ersetzung nach `git commit` ändert
  den Hash erneut. Die Hausformel ist „Erledigt <Datum>, PR #<N>" ohne SHA (so steht TL-23
  da). Gestrichen.
- **LOW 2 (echter Formatierungs-Bruch):** mein erster `num()`-Helfer wandte
  `Number.isInteger` **dimensionsunabhängig** an. Bei `ramUsedPercent: 91` wäre `RAM 91 %`
  herausgekommen, während `describeLimit` in die Audit-Zeile immer `91.0%` schreibt — zwei
  verschiedene Darstellungen derselben Messung in zwei Kanälen. Jetzt getrennte Helfer
  (`pct` immer `toFixed(1)`, `count` unverändert) plus ein eigener Test auf den glatten
  Prozentwert.
- **NIT 1:** die Zeilenangabe für `describeRefusalLimit` war um eine Zeile zu kurz — Zeile 82
  schloss damals nur das `switch`. Berechtigt; da die beiden Code-Fixes dieser Runde die Datei
  ohnehin verlängern, sind alle Angaben in den drei Dokumenten auf den **Endstand** gezogen
  (Helfer `:55-85`, `case` `:111-117`, `chatId`-Guard `:440`) und nach dem letzten Eingriff
  gegengeprüft. Runde 2 hat genau diese Verschiebung noch einmal gefunden — die Nummern hier
  sind der Stand **nach** ihr.
- **NIT 2:** der JSDoc über `formatMeshEventForTelegram` behauptete pauschal, die
  Flap-Dämpfung der Alert-Events passiere upstream, „daher hier kein zusätzliches
  Rate-Limiting nötig". Für `task:refused` gilt das **nicht**. Ausnahme dort benannt, mit
  Verweis auf den in `TODO.md` offenen Rest.

**Zwei Punkte hat der Reviewer bestätigt statt beanstandet**, die ich selbst für die
angreifbarsten hielt: die Scope-Erweiterung auf die zwei Dashboard-Dateien (Auslassen wäre
eine unvollständige Umsetzung gewesen) und die `[x]`-Setzung von TL-18.

**Ein Hinweis von ihm ohne Befundstatus, hier festgehalten, weil er einen echten Unterschied
benennt:** das Gate greift **vor** dem Skill-Check (`task-executor.ts:130` vor `:161`), also
landet bei Überlast ein vom anfragenden Peer **frei gewählter** `skillId`-String im
Telegram-Text — anders als bei `task:completed`/`task:failed`, die nur für registrierte
Skills feuern. Harmlos für den Parser, weil Notifications ohne `parse_mode` als Plaintext
gehen; die Entschärfung fremder Strings ist **TL-17** und bleibt dort.

## 6. Grenzen dieses Slices

Der Alarm geht an **einen** Kanal, und nur wenn der Telegram-Gateway läuft und eine
`chatId` kennt (`telegram-gateway.ts:440`). Ob er auf diesem Host aktiv ist, ist
Betriebszustand und wurde hier **nicht** geprüft — dieser Slice macht die Zustellung
möglich, er garantiert keinen Empfang. Ein Live-Beleg („RAM über 90 %, Nachricht kam an")
bräuchte einen überlasteten Knoten oder einen Testkanal und ist kein Agent-Schritt.
