# TL-15 — Uhr-Abweichungs-Erkennung zwischen Partnern

**Datum:** 2026-11-09
**Branch:** `agent/claude-code/tl-15-clock-skew`
**Basis:** `main` @ `9e944ef` (Merge von #367)
**PR:** #368
**Design-Doku (vor dem Code):** `docs/architecture/TL-15-clock-skew-detection.md`
**Auftrag:** `TODO.md` TL-15, freigegeben nach der Rest-Filter-Prüfung vom 2026-11-09 11:16 UTC
**Art:** neue Messung + Alarm, Default **aus**. Kein Deploy, kein Release, kein Secret,
kein State, kein Dienst-Eingriff, keine Protokoll-Änderung.

---

## 1. Warum der Punkt echt offen war — gemessen, nicht aus der Checkbox gelesen

Vor dem Code stand die Prüfung, ob TL-15 nicht längst erledigt ist (dieselbe Falle wie bei
TL-02/TL-03, deren Code vorliegt, während die Checkbox offen steht):

| Prüfung | Ergebnis |
|---|---|
| `git grep -niE "skew\|clock_offset\|clockDrift\|time_drift"` über `packages/*/src` | **2** Treffer, **beide nur Kommentare**: `peer-cache.ts:132` wirft Zukunfts-Timestamps weg, `tls.ts:595` prüft das Gültigkeitsfenster. Keine Messung, keine Schwelle, kein Alarm. |
| dieselben Begriffe über `docs/` | **0** |
| Trägt der Heartbeat eine Partner-Uhrzeit? | **Ja, schon heute** — `checkPeers` in `mesh.ts` holt `GET ${peer.endpoint}/health` (vor diesem PR Zeile 604, jetzt 632 — der Slice verschiebt sie zweimal selbst, zuletzt durch den LOW-2-Fix), und `agent-card.ts:256` antwortet `{ status: 'ok', timestamp: new Date().toISOString() }`. |
| Wird dieser Wert benutzt? | **Nein** — `checkPeers` prüfte nur `response.ok` und **verwarf den Body** (vor diesem PR `mesh.ts:599-619`; der Slice verschiebt die Stelle selbst). |

Der zweite Teil ist der eigentliche Befund: die Messstelle existiert bereits. Damit braucht
TL-15 **keinen** neuen Endpunkt, **keine** Wire-Format-Änderung, **keine**
Peer-Versions-Abhängigkeit und **keinen** zusätzlichen Netzverkehr. Die Frage aus dem
TODO-Text („Skew-Messung im Handshake/Heartbeat") ist damit auch entschieden: der Heartbeat,
weil die Messung dort gratis ist und sich wiederholt — ein Handshake-Wert wäre eine
Einmalmessung beim Verbindungsaufbau.

## 2. Was gemessen wird — Offset, nicht Differenz

Die naive Rechnung `localNow - peerTimestamp` ist **falsch**: sie gibt die halbe
Antwortlaufzeit als Uhrenabweichung aus. Stattdessen die NTP-übliche Offset-Schätzung über
das lokale Fenster:

```
rtt         = t1 - t0                  // t0 = vor dem fetch, t1 = nach dem Body
skewMs      = tp - (t0 + t1) / 2       // tp = Partner-Uhrzeit; > 0 ⇒ Peer läuft vor
uncertainty = rtt / 2
```

**Klassifikation konservativ in beide Richtungen** — der wahre Offset liegt im Intervall
`[|skew| - u, |skew| + u]`, und entschieden wird nur, was dieses Intervall hergibt: `skewed`,
wenn die **untere** Schranke die Schwelle überschreitet; `ok`, wenn die **obere** sie einhält;
sonst `unknown` und damit neutral für die Hysterese. Netzlaufzeit allein kann so weder
alarmieren noch eine Erholung vortäuschen. Tests: 6 s Punktschätzer bei 4 s RTT ⇒ `unknown`,
dieselben 6 s bei 20 ms RTT ⇒ `skewed`.

Die **erste Fassung prüfte nur die untere Schranke** und gab alles andere als `ok` aus. Das ist
auf dem Hinweg konservativ, auf dem **Rückweg** aber das Gegenteil — die CR-Runde 1 hat das als
MEDIUM zurückgewiesen, mit einem Szenario, das ich nachvollzogen und als Regressionstest
festgeschrieben habe: ein Peer mit konstant 6 s Vorlauf (Schwelle 5 s) hätte bei einer
RTT-Spitze von 3 s dreimal als „ok" gezählt, damit einen `skewed→ok`-Flip ausgelöst und dem
Operator die in sich widersprüchliche Meldung „behoben: läuft jetzt 6.0 s vor (Schwelle 5.0 s)"
geschickt — und beim nächsten schnellen Heartbeat wieder zurückgekippt. Die Zusage „ein
dauerhaft schiefer Peer erzeugt **eine** Meldung" wäre also unter schwankender Netzlatenz
gebrochen.

## 3. Flap-Dämpfung ist Teil des Slices, nicht sein Rest

TL-18 hat die Dämpfung offengelassen und als Rest benannt. Hier **nicht**: bei 10-s-Heartbeat
würde ein an der Schwelle wackelnder Peer 8640 Nachrichten pro Tag erzeugen. Übernommen ist
die Hysterese-Mechanik des `SkillHealthMonitor`: pro Peer ein Zustand `ok | skewed`, der erst
nach `clock_skew_debounce` **aufeinanderfolgenden** gleichgerichteten Messungen kippt.
Alarmiert wird **ausschließlich der Wechsel**. Ein Test fährt 50 Messungen und erwartet
**genau eine** Meldung.

Nicht klassifizierbare Messungen sind **neutral** — sie kippen nichts und brechen die Serie
nicht. Sonst würde ein Peer mit altem Daemon ohne `timestamp`-Feld als „wieder gut" gelten.

## 4. Default: aus. Begründet.

`mesh.clock_skew_threshold_ms` ist `0` = aus, nach dem Vorbild
`placement.refuse_cpu_percent` und **nicht** `refuse_ram_percent: 90`.

Ein Default-an würde am laufenden Dienst sofort Alarme erzeugen: in dieser Flotte sind
mehrere Peers schlafende macOS-Rechner (`.55`, `.52`, `.44`, `.158`), also genau die Klasse
mit Uhrensprüngen nach dem Aufwachen. Ein Slice, der ohne Zutun des Operators eine
Telegram-Flut auslösen kann, ist kein inerter Slice. Solange die Schwelle `0` ist, wird der
Health-Body **nicht einmal gelesen** — der Heartbeat verhält sich exakt wie vorher.
Messung und alle drei Alarmwege sind fertig und getestet; **die Aktivierung ist eine
Betriebsentscheidung**, kein Code-Default. Empfohlener Startwert im USER-GUIDE: `5000`.

## 5. Was geändert wurde

| Datei | Änderung |
|---|---|
| `packages/daemon/src/clock-skew.ts` | **neu** (290 Zeilen), rein: `parsePeerTimestamp`, `estimateClockSkew`, `classifyClockSkew`, `ClockSkewMonitor` (Hysterese), `observeHeartbeatSkew` (fail-open-Klammer) |
| `packages/daemon/src/mesh.ts` | Sendemarke vor dem `fetch`, Messaufruf nach `recordHeartbeat`, `onClockSkew?` in `MeshEvents`, optionaler 6. Konstruktor-Parameter, `forget` in `removePeer` **und** im 127a-Re-Key samt dessen `rollback` (CR-Runde 1, LOW-2) |
| `packages/daemon/src/events.ts` | + `'system:clock_skew'` |
| `packages/daemon/src/audit.ts` | + `'CLOCK_SKEW_WARNING'` (Vorbild `CERT_EXPIRY_WARNING`) |
| `packages/daemon/src/config.ts` | + `mesh.clock_skew_threshold_ms` / `clock_skew_debounce`, Env-Override, Post-Merge-Range-Validierung |
| `packages/daemon/src/index.ts` | Monitor nur bei Schwelle > 0 bauen; die drei Alarmwege (Log, Audit, EventBus) |
| `packages/daemon/src/telegram-gateway.ts` | + `case 'system:clock_skew'` und reine Hilfsfunktion `describeClockSkew` |
| `packages/dashboard-ui/.../Toasts.tsx` | + `case` parallel zum Telegram-Sink |
| `packages/dashboard-ui/.../EventFeed.tsx` | + Symbol `⏱️` |
| `docs/USER-GUIDE.md` | TOML-Beispiel, Env-Tabelle und eigener Abschnitt mit Mapping-Tabelle (TL-00d-Pflicht für neue Config-Keys) |
| `docs/architecture/TL-15-clock-skew-detection.md` | **neu**, Design-Doku **vor** dem Code (`CLAUDE.md` Schritt 3) |

### Drei Entscheidungen, die im Code begründet stehen

- **Nur ISO-8601-Strings mit Zonen-Designator, per Regex vor `Date.parse` geprüft.** Eine
  blanke Zahl wird **abgelehnt**, weil Sekunden und Millisekunden sich nicht unterscheiden
  lassen — eine um Faktor 1000 fehlinterpretierte Epoche wäre ein garantierter Fehlalarm. Die
  Formatprüfung kam aus CR-Runde 1 (LOW-1) und ist **nachgemessen** nötig: `Date.parse` liefert
  für `'1'`, `'12'`, `'99'`, `'2026'` und sogar `'foo 10'` endliche Millisekunden — genau
  derselbe Epochen-Fehlalarm durch die Hintertür. Und ein Zeitstempel **ohne** Zone wird laut
  Spezifikation in der *Lokalzeit des Empfängers* gelesen, was zwischen zwei Zonen einen
  künstlichen Stunden-Skew erzeugt (hier real 1 h Differenz gemessen).
- **Negative RTT ⇒ keine Messung.** Springt die *lokale* Uhr zwischen den beiden Marken
  zurück, ist die Messung selbst unbrauchbar; dann wird nicht geraten.
- **`Object.hasOwn` statt direktem Feldzugriff** auf den Fremd-Body — ein Peer darf den Wert
  nicht über die Prototypenkette liefern (Härtung analog `normalizeDecision`, dort ein
  CR-MEDIUM). Ein Test mit `Object.create({timestamp})` schreibt das fest.

### Warum `observeHeartbeatSkew` eine eigene Funktion ist

Damit die **fail-open-Klammer** (Body unlesbar, kein JSON, falscher Typ, werfender Reader)
unit-testbar ist, ohne `undici` zu mocken — dafür gibt es im Repo **keinen** Präzedenzfall
(`git grep "vi.mock('undici')"` ⇒ 0). `mesh.ts` behält dadurch nur Zeitnahme und Aufruf.
Das ist auch der ehrliche Teil der Testabdeckung, siehe Abschnitt 7.

## 6. Test-Beleg

Baseline **vorher auf demselben Arbeitsbaum** per `git stash -u` erhoben.

| Gate | Baseline (`main` @ `9e944ef`) | nach der Änderung |
|---|---|---|
| `packages/daemon` `npx vitest run` | 151 Dateien / 2137 grün | **152 Dateien / 2188 grün** (+51) |
| `packages/daemon` `npx tsc --noEmit` | 0 | **0** |
| `packages/daemon` `npx tsc --noEmit -p tsconfig.scripts.json` | 0 | **0** |
| `packages/daemon` `npm run lint:scripts` | 0 | **0** |
| `packages/dashboard-ui` `npx tsc --noEmit` | 0 | **0** |
| `packages/dashboard-ui` `npx vite build` | Exit 0 | **Exit 0** (213 Module) |
| `packages/daemon` `eslint src/` (nicht CI-gated, Altbestand) | 460 (245e/215w) | **460 (245e/215w)** |
| Wurzel-`npm run lint`-Umfang (nicht CI-gated, Altbestand) | 462 (245e/217w) | **462 (245e/217w)** |

Die +51 sind 41 in `clock-skew.test.ts`, 6 im Telegram-Sink (`telegram-gateway.test.ts`
19 → 25) und 4 in `mesh.test.ts` (42 → 46). Ein erster Entwurf erzeugte **eine** neue
Lint-Warnung (fehlender Rückgabetyp am `onClockSkew`-Hook in `index.ts`, beide Umfänge +1);
nachgezogen, beide Zähler wieder exakt auf Baseline.

### Was die Tests belegen

- **Messung:** synchrone Uhren trotz 200 ms RTT ⇒ `skewMs: 0` — mit der naiven Rechnung wären
  es 100 ms „Abweichung" gewesen (der Test rechnet beides vor). Beide Richtungen, unlesbare
  Zeit, negative RTT, nicht-endliche Marken.
- **Klassifikation:** Schwelle `0`/negativ/`NaN` ⇒ `unknown` (aus heißt *keine Aussage*, nicht
  „ok"); genau auf der Schwelle ⇒ `ok` (strikt `>`); hohe RTT frisst die Abweichung.
- **Hysterese:** kein Flip unter der Dämpfung, genau einer auf ihr; 50 Messungen ⇒ **1**
  Meldung; unterbrochene Serie setzt zurück; Rückweg `skewed→ok` wird gemeldet; `unknown` ist
  neutral; Peers sind unabhängig; `forget()` räumt; Schwelle `0` ⇒ Monitor völlig inert.
- **fail-open:** werfender Reader, Nicht-Objekt (String/Array/`null`), Body ohne `timestamp`,
  `timestamp` nur über die Prototypenkette — jeweils `null` und **kein** Zustand angelegt.
- **Config:** Defaults `0`/`3`, Env-Override, negative Schwelle und Dämpfung `0` abgelehnt —
  und zwar auf **beiden** Wegen: Env (Reader wirft) **und** TOML (Post-Merge-Validator, über
  eine temporäre `.toml` gefahren, sonst wären die zwei neuen Validator-Zweige ungetestet).
- **Verdrahtung:** `removePeer` vergisst den Monitor-Eintrag, und ebenso der 127a-Re-Key von der
  Legacy- auf die kanonische `agentId` sowie dessen `rollback` (beide Tests sind ohne den LOW-2-Fix
  rot); ohne Monitor bleibt `removePeer` unverändert.

## 7. Was bewusst **nicht** getan wurde

- **Keine Uhr wird gestellt.** TL-15 macht die Abweichung sichtbar; Synchronisation ist NTP
  auf dem jeweiligen Rechner und gehört nicht in den Daemon.
- **Kein Test für die drei Plumbing-Zeilen in `mesh.ts`** (`Date.now()` vor dem `fetch`,
  `response.json()` als `readBody`, Weitergabe der Transition). Die gesamte Logik inklusive
  Fehlerbehandlung liegt in `observeHeartbeatSkew` und ist dort voll getestet; was in
  `mesh.ts` bleibt, bräuchte einen `undici`-Mock, für den es im Repo keinen Präzedenzfall
  gibt. **Als Lücke benannt, nicht wegerklärt.** Die Lebensdauer-Hälfte der Verdrahtung
  (`removePeer`, 127a-Re-Key, dessen `rollback`) ist getestet.
- **Keine Dashboard-Tests** — `packages/dashboard-ui` hat keine Test-Infrastruktur (kein
  vitest, kein `test`-Script, keine `*.test.*`-Datei); dort decken `tsc --noEmit` +
  `vite build` der CI ab. Wie bei TL-18.
- **Kein Live-Beleg.** Dass bei einem echten schiefen Peer eine Nachricht ankommt, bräuchte
  einen Peer mit verstellter Uhr und einen aktiven Gateway — ein Betriebsschritt, kein
  Agent-Schritt. Zusätzlich ist das Feature per Default aus.
- **Nichts angefasst an** `TL-16`, `TL-17`, `TL-19`, `TL-22a/b`; kein Branch-Delete der
  lokalen Referenzen `tl-23-graphql-dead-code` / `tl-18-task-refused-alert`.

## 7b. Externe Code-Review

`pal:codereview` unverändert unbrauchbar (beide Fremd-Backends `executable not found in PATH`).
Review-of-Record über `~/.local/bin/agy --sandbox` (Gemini) — anderes Modell als das
implementierende; nie MiniMax, nie `pal:chat`.

**Runde 1: CHANGES REQUESTED — 0 HIGH / 2 MEDIUM / 3 LOW / 2 NIT, alle sieben eingearbeitet,
jeder Befund mit Regressionstest.** Ich habe jede Behauptung vor dem Fix selbst nachgemessen;
alle sieben waren echt.

- **MEDIUM-1 — TOML-Pfad ließ `nan`/`inf`/Strings/Floats durch.** Der Env-Pfad geht über
  `readNonNegativeInt`/`readPositiveInt`, der TOML-Pfad (`deepMerge`) übernimmt dagegen jeden
  Typ, und meine Validierung prüfte nur `< 0` bzw. `< 1`. **Nachgemessen:**
  `clock_skew_debounce = nan` ⇒ `NaN < 1` ist `false`, die Validierung wirft nicht, und im
  Monitor ist `streak < NaN` ebenfalls immer `false` ⇒ **die Hysterese wäre vollständig
  ausgehebelt** (Flip bei der ersten Messung). `inf` ⇒ alarmiert nie.
  `clock_skew_threshold_ms = "5000"` ⇒ der Daemon baut den Monitor und loggt „aktiv", während
  jede Messung stumm als `unknown` endet. Fix: `!Number.isInteger(…)` in beiden Validatoren
  (Vorbild `cert.renew_before_days`), plus sechs Testfälle über echte `.toml`-Dateien.
- **MEDIUM-2 — einseitige Klassifikation.** Siehe Abschnitt 2: der eigentliche Fehler des
  Slices. Fix: drei Zustände, symmetrische Schranken; drei neue Tests, darunter das vom
  Reviewer beschriebene Szenario als Regression.
- **LOW-1 — `Date.parse` ohne Formatprüfung.** Siehe Abschnitt 5. Fix: ISO-8601-mit-Zone-Regex
  vor `Date.parse`, plus zwei Tests, die erst belegen, dass `Date.parse` die Werte akzeptiert,
  und dann, dass wir sie ablehnen.
- **LOW-2 — verwaister Monitor-Eintrag beim ADR-022-Re-Key.** `markPeerIdVerified` schlüsselt
  einen Peer von der Legacy- auf die kanonische `agentId` um und löscht den Map-Key direkt;
  mein `forget` saß nur in `removePeer`. Ein vorher gemessener Peer wäre damit als Leiche
  stehengeblieben, weil `removePeer(LEGACY)` danach nicht mehr greift. Fix: `forget` im
  Re-Key **und** im `rollback`-Zweig, plus zwei Tests, die ohne den Fix rot sind.
- **LOW-3 — `skewMsExact` redundant plus `NaN`-Falle.** Die Nachkommastelle ist höchstens
  0,5 ms aus der RTT-Halbierung, also weit unter der 0,1-s-Anzeige, und mein
  `typeof === 'number'`-Test fiel bei `NaN` **nicht** auf `skewMs` zurück. Fix: Feld ganz
  entfernt, der Sink liest nur `skewMs`; der Test prüft jetzt `NaN`, `Infinity` und einen
  String.
- **NIT-1** Design-Doku sagte noch `ISO/epoch` statt „ISO-8601-String mit Zone" — korrigiert.
- **NIT-2** `audit.append` war nicht isoliert: wirft es (geschlossene DB im Shutdown), fiel der
  Operator-Alarm darunter aus. Fix: eigenes `try/catch` mit `log.warn`.

**Runde 2 über den nachgebesserten Stand: APPROVE, 0 HIGH / 0 MEDIUM / 0 LOW / 2 NIT, beide
eingearbeitet.** Die Runde hat die dreiwertige Klassifikation an allen Grenzen durchgerechnet und
bestätigt (`u = 0` lässt keinen `unknown`-Spalt; genau auf der Schwelle mit `u = 0` ⇒ `ok`; mit
`u > 0` ⇒ `unknown`, weil das Intervall die Schwelle schneidet) und den Regex gegen das tatsächliche
Produzenten-Format geprüft. Die zwei NITs waren wieder meine Buchhaltung: der `/health`-`fetch` war
durch den LOW-2-Fix **ein zweites Mal** gewandert (624 → 632), die `mesh.ts`-Zeile meiner
Änderungstabelle nannte noch nur `removePeer`, und das Datum stand in der Compliance-Zeile auf 12:05
während der Footer 12:25 sagte. Alles drei gezogen.

Der Reviewer hat außerdem **bestätigt**, was ich selbst für die wackeligsten Punkte hielt: die
Offset-Formel und die Unsicherheitsrechnung sind korrekt, der Startzustand `ok` ist richtig
gewählt, `unknown` ist strikt neutral, die Heartbeat-Integrität ist über beide `try/catch`-Ebenen
gesichert, das Konsumieren des Bodys ist für `undici` sogar günstiger (gibt die Keep-Alive-
Verbindung sofort frei), es fehlt kein Sink, und der Schnitt über `observeHeartbeatSkew` mit den
drei untesteten Plumbing-Zeilen ist vertretbar. Ein Hinweis ohne Befundstatus, hier festgehalten:
ein **kompromittierter** Peer könnte seine gemeldete Uhrzeit absichtlich im Takt
`debounce × heartbeat_interval_ms` pendeln lassen und damit rund zwei Transitionen pro Minute
erzeugen; gegen zufälliges Wackeln reicht die Hysterese, gegen Vorsatz bräuchte es einen
Pro-Peer-Cooldown. Das ist **nicht** umgesetzt und als eigener Punkt zu behandeln.

## 8. Prozess-Abweichung

**CO** (`pal:consensus`, 2-3 Modelle) ist weiter unbenutzbar — beide Fremd-Backends melden
`executable not found in PATH`. Die Design-Entscheidungen liegen daher **schriftlich vor dem
Code** in `docs/architecture/TL-15-clock-skew-detection.md` (nach dem Muster der übrigen
`TL-NN-*`-Scoping-Dokumente dieses Repos) und wurden anschließend von der externen
CR-Runde geprüft, nicht von einem Konsens-Lauf. Als Abweichung gemeldet.
