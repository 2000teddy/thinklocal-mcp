# Reconcile — COMPLIANCE-Status-Zellen, verschobene Zeilenangaben, `[Unreleased]`-Datum

**Datum:** 2026-11-09
**Branch:** `agent/claude-code/reconcile-compliance-status`
**Basis:** `main` @ `27cc2e6` (Merge von #368)
**PR:** #369
**Auftrag:** Nachkontrolle nach dem TL-15-Merge — „prüfe, ob `TODO.md`/`CHANGES.md` nach dem
Merge noch etwas brauchen"; Reconcile anschließend freigegeben
**Art:** Doku-only. **Kein** `packages/`-Diff, kein Code, kein Test, kein Deploy, kein Release,
kein Secret, kein State, kein Dienst-Eingriff. Präzedenz: **#296** (Doc-only-Reconcile).

---

## 1. Neun Status-Zellen behaupteten „offen", obwohl gemergt

`COMPLIANCE-TABLE.md` führt in der zweiten Spalte `(offen, base=<ziel>)`, solange der PR läuft,
und `(base=<ziel>, gemergt)` danach. Die Konvention läuft lückenlos bis **#359** und ist ab
**#360** ausgefallen.

| PR | Status-Zelle vorher | tatsächlich (`gh pr view`) |
|---|---|---|
| #360 | `(offen, base=main)` | MERGED 2026-10-26T11:11:10Z |
| #361 | `(offen, base=main)` | MERGED 2026-10-26T11:45:50Z |
| #362 | `(offen, base=main)` | MERGED 2026-11-03T05:18:52Z |
| #363 | `(offen, base=main)` | MERGED 2026-11-03T05:50:33Z |
| #364 | `(offen, base=main)` | MERGED 2026-11-03T06:32:17Z |
| #365 | `(offen, base=main)` | MERGED 2026-11-03T15:16:15Z |
| #366 | `(offen, base=main)` | MERGED 2026-11-09T08:35:24Z |
| #367 | `(offen, base=main)` | MERGED 2026-11-09T10:11:25Z |
| #368 | `(offen, base=main)` | MERGED 2026-11-09T11:35:14Z |

In einer Tabelle, die als **Prozess-Nachweis** gilt und per CI-Gate erzwungen wird, ist das eine
Falschaussage über neun PRs — und zwar in genau der Spalte, aus der ein Prüfer abliest, ob ein
Compliance-Stand abgeschlossen ist. Der Ausfall reicht über **zwei Wochen und neun PRs**
(2026-10-26 bis 2026-11-09); die „vier Monate", die ein erster Entwurf dieses Dokuments hier
nannte, gehören zum `[Unreleased]`-Datum in Abschnitt 4 und waren eine Verwechslung (CR-LOW-1).

**Umsetzung:** alle neun Zellen gezogen, und zwar **nur die Zelle** — das Skript ersetzt das erste
Vorkommen pro Zeile, damit eine identische Zeichenkette im Zeilentext unberührt bleibt. Vor dem
Schreiben wurde für jede geänderte Zeile die Anzahl **unescaped Pipes auf 11** geprüft (10 Spalten),
sonst bricht die Tabelle. Dass genau die neun erwarteten Zeilen getroffen wurden, ist per Assertion
gegen die Liste `360…368` abgesichert.

## 2. Der durable Teil — und eine Regel, die ich zuerst erfunden hatte

Weder `COMPLIANCE-TABLE.md` noch `CONTRIBUTING.md` noch `CLAUDE.md` beschreiben die Status-Zelle;
sie war **nur aus dem Muster der Zeilen** ablesbar. Sie ist jetzt im Kopf der Tabelle festgehalten.

**Der erste Entwurf dieser Notiz behauptete, der Wechsel „passiert beim Merge" und werde „von dem
gezogen, der mergt". Das war falsch, und die externe CR-Runde hat es als MEDIUM zurückgewiesen.**
Nachgeprüft:

- Ein Squash-Merge ändert **keine Datei**, und ein Commit davor würde das gepinnte Review/CI-Gate
  entwerten. Die Zelle lässt sich beim Merge also gar nicht ziehen — genau die
  **Selbst-Reconcile-Lücke**, die #357–#360 beschreiben.
- Wer die Zelle zieht, hat **zwei Epochen** — und hier lag ich im zweiten Entwurf erneut falsch
  (CR-Runde 2, MEDIUM-1). Meine Gegenprobe suchte nach einer Zeile der Form `-| #NNN | (offen, …)`
  und fand bei #353/#354/#356 nichts; **das Muster kann die ältere Form per Konstruktion nicht
  treffen**: bis einschließlich **#356** wurde eine Zeile **ohne** PR-Nummer angelegt: Spalte 1 trug
  `(offen, base=main)`, dahinter folgte bei #319/#325/#326/#351 direkt das Datum (9 Spalten) und bei
  #352–#355 zuerst noch `(base=main)` (10 Spalten) — der Folge-PR setzte dann Spalte 1 auf `#NNN`
  **und** Spalte 2 auf `(base=main, gemergt)` in **einem** Schritt. (Diese Nuance kam aus CR-Runde 3,
  NIT-1; an der Kernaussage ändert sie nichts, aber die Behauptung, die mich zwei Runden gekostet
  hat, sollte am Ende genau stimmen.) `git show … -- COMPLIANCE-TABLE.md`
  zeigt es sofort. Damit zogen **auch reguläre** PRs im Vorbeigehen: #320, #326, #327, #353, #354
  und #356 — letzterer gleich drei Zeilen (#351, #354, #355). **#356** schrieb erstmals Nummer und
  Status zusammen beim Eröffnen; **ab #357** zogen nur noch dedizierte Reconcile-PRs (#357 eine,
  #358 eine, #360 zwei), die regulären #362–#368 keine mehr.
  *Methodisch ist das die dritte Variante derselben Falle: ein Grep über die heutige Form findet
  die historische nicht — wie in #366 der Bezeichner-Grep den gebauten Baum nicht fand.*
- **#360 hat die Kette bewusst abgeschlossen** („Abschluss der Reconcile-Kette — #357/#358/#359
  nachgezogen") und keinen Nachfolger geschrieben, um eine endlose Folge rein-reconcilierender PRs
  zu vermeiden; die Zeilen #360/#361/#363 nennen das ausdrücklich „dokumentierter Endzustand aus
  #360, bewusst nicht fortgeschrieben". Das erklärt die offene Zelle von **#360** — und entlarvt
  meinen zweiten Fehler: der Ausfall war **keine** blinde Nachlässigkeit über neun PRs, sondern
  ein bewusst gesetzter Endpunkt, hinter dem die Praxis dann auslief.

Die Notiz nennt jetzt **beobachtete Praxis statt erfundener Regel**, beide Epochen getrennt, und
den Rest, der zur Konvention gehört: jede Reconcile-Runde lässt genau **eine** Zeile offen, ihre
eigene. Der Vorschlag, dass ein Folge-PR gemergte Vorgänger mitzieht, steht dort ausdrücklich **als
Vorschlag und nicht als Beschluss** — und ist, wie sich jetzt zeigt, die Wiederaufnahme der bis
#356 geübten Praxis, nicht eine Neuerfindung.

**Folge für diesen PR, offen benannt:** Zeile **#369** steht beim Anlegen auf `(offen, base=main)`
und ist damit korrekt; sie bleibt es bis ein späterer PR sie zieht. Die Lane mergt nicht selbst.

## 3. Neun Zeilenangaben in `TODO.md` waren falsch — alle von eigenen Folge-Slices gekippt

Zwei hatte der Watchdog gemeldet, drei kamen bei meiner Prüfung dazu — **vier weitere fand erst
die externe CR** (MEDIUM-2), und zwar genau da, wo ich Vollständigkeit behauptet hatte. **Keine**
davon ist durch fremden Code entstanden:

| Angabe in `TODO.md` | Stand heute | gekippt durch |
|---|---|---|
| `telegram-gateway.ts:111-117` (`task:refused`-Block) | liegt bei **133-139** | TL-15 (#368) fügte `describeClockSkew` oberhalb ein |
| `telegram-gateway.ts:440` (`chatId`-Guard) | liegt bei **471** | TL-15 (#368) |
| `config.ts:255` (`refuse_ram_percent: 90`) | Zeile 255 ist heute `logging: {` | TL-15 (#368) ergänzte zwei `[mesh]`-Keys |
| `config.ts:480` (Validator 1..100) | Zeile 480 ist heute eine CIDR-Fehlermeldung | TL-15 (#368) |
| `index.ts:956-957` (Executor-Verdrahtung) | Zeile 956 gehört heute zum Inbox-Pfad | TL-15 (#368) |
| `mesh.ts:600` (`p.status !== 'offline'`-Filter, B2) | liegt bei **625** | TL-15 (#368), von mir **übersehen** |
| `config.ts:251` (`renew_before_days: 30`, B2) | liegt bei **271** | TL-15 (#368), von mir **übersehen** |
| `config.ts:252` (`migrate_legacy_identity: false`, B2) | liegt bei **272** | TL-15 (#368), von mir **übersehen** |
| `index.ts:175` (`identity.spiffeUri`, B2) | liegt bei **176** | TL-15 (#368), von mir **übersehen** |

Die unteren vier stehen in **Sektion B2**, geschrieben von **#365** — also derselben
Slice-Familie — und von denselben #368-Einschüben gekippt. Ich hatte nur den TL-18-Absatz
durchgesehen und dabei behauptet, alle selbst gekippten Stellen gezogen zu haben; das war zu klein
angesetzt und ist der eigentliche Gehalt von MEDIUM-2.

**Statt neue Zahlen einzusetzen sind alle neun auf stabile Namen gezogen** — der `placement`-Block
der `DEFAULTS`, der Post-Merge-Validator, `formatMeshEventForTelegram`, `setupEventBridge`, der
`decision.refuse`-Zweig, die Peer-Auswahl am Kopf von `checkPeers`, der `cert`-Block der `DEFAULTS`
(zweimal) und das dritte Argument des `loadOrCreateTlsBundle`-Aufrufs. Eine neue Zahl wäre beim
nächsten Slice in derselben Datei wieder falsch; das ist die Fehlerklasse, die die externe Review in
#367 **und** #368 je zweimal angekreidet hat und die hier zum dritten Mal auftrat, diesmal über
einen PR hinweg.

**Vorbeugend mitgezogen, obwohl heute noch korrekt** — und hier hatte ich die Zuordnung zuerst
falsch (CR-NIT-1): `Toasts.tsx:23-29` und `EventFeed.tsx:11` stimmten noch, aber nur, weil TL-15
seine Fälle in denselben Dateien *unterhalb* einfügte; `task-executor.ts:147-149` und die Spanne
`:55-85` von `describeRefusalLimit` stimmten ebenfalls noch, standen in meinem ersten Text aber
teils bei den gekippten und teils gar nicht. Alle vier heißen jetzt `eventToToast`, `EVENT_ICONS`,
`decision.refuse`-Zweig bzw. „ebenda".

**Bewusst nicht angefasst:** die vier Verweise auf `agent-card.ts:256`, `peer-cache.ts:132`,
`tls.ts:595` und `websocket.ts:263`. Sie zeigen in Dateien, die diese Slice-Familie nie berührt
hat, sie sind der Beleg *dafür*, warum TL-15 nötig war, und jeder einzelne wurde heute gegen den
Arbeitsbaum geprüft. Zahlen sind dort stabil und tragen Information.

## 4. Das `[Unreleased]`-Datum stand seit 2026-06-26 still

Eigener Punkt, **nicht** Folge des TL-15-Merges — im Auftrag ausdrücklich nur erlaubt, wenn er als
solcher benannt wird.

Der Verlauf der Zeile (`git log -L '9,9:CHANGES.md'`) zeigt, dass die Zeitangabe bei **jedem** PR
mitgezogen wurde: `2026-06-25 06:30` → `10:05` → `13:05` → `14:35` → `2026-06-26 09:05`, fünf
Änderungen an zwei Tagen. Danach blieb sie liegen, während darunter inzwischen Einträge vom
09.11. stehen — die Kopfzeile war also um gut vier Monate falsch. Auf den Zeitpunkt des jüngsten
Eintrags gezogen (`2026-11-09 13:05`).

Die Konvention selbst ist damit **nicht** dokumentiert — sie bleibt wie die Status-Zelle aus dem
Verlauf erschlossen. Sie hier ebenfalls festzuschreiben wäre ein Kanon-Beschluss über `CHANGES.md`
und gehört nicht in einen Reconcile; **als offener Punkt benannt**, nicht nebenbei entschieden.

## 4b. Externe Code-Review

`pal:codereview` unverändert unbrauchbar (beide Fremd-Backends `executable not found in PATH`).
Review-of-Record über `~/.local/bin/agy --sandbox` (Gemini), anderes Modell als das
implementierende. Nach `CLAUDE.md` dürfte eine Doc-only-PR das CR auslassen — nach zwei Runden, in
denen gerade meine **Doku-Zahlen** die Befunde lieferten, wäre das die falsche Ersparnis. Es war
die richtige Entscheidung:

**Runde 1: CHANGES REQUESTED — 0 HIGH / 2 MEDIUM / 1 LOW / 1 NIT, alle vier eingearbeitet.**
Bemerkenswert ist, **was** getroffen wurde: nicht der Diff, sondern meine Begründung.

- **MEDIUM-1 — ich hatte eine Prozess-Regel erfunden.** Siehe Abschnitt 2. Das ist der schwerste
  der vier: ich habe eine Konvention dokumentiert, die das Repo nie so gelebt hat, und sie
  ausgerechnet in die Datei geschrieben, die als Prozess-Nachweis gilt. Eine erfundene Regel im
  Kanon ist schlimmer als eine fehlende.
- **MEDIUM-2 — zu klein angesetzter Umfang bei gleichzeitiger Vollständigkeitsbehauptung.** Siehe
  Abschnitt 3: vier weitere gekippte Angaben in B2, geschrieben von #365, gekippt von #368.
- **Runde 2 fand einen Fehler, den erst mein Fix erzeugt hat** — siehe Abschnitt 2: die Behauptung,
  reguläre PRs hätten *nie* gezogen. Zwei Entwürfe, zwei Mal daneben, beide zur Historie derselben
  Spalte. Das ist der ehrliche Befund dieses Slices: die Zellen zu ziehen war trivial, ihre
  **Geschichte korrekt zu beschreiben** war es nicht.
- **LOW-1 — „vier Monate" war eine Verwechslung.** Das ist die Stillstandszeit des
  `[Unreleased]`-Datums (2026-06-26 → 2026-11-09); die Status-Zelle fiel über **zwei Wochen und
  neun PRs** aus (2026-10-26 → 2026-11-09). Ich hatte die beiden Befunde desselben Dokuments
  miteinander verrechnet.
- **NIT-1 — falsche Zuordnung in meiner eigenen Aufzählung.** Siehe Abschnitt 3.

**Runde 2: CHANGES REQUESTED — 0 HIGH / 1 MEDIUM / 1 LOW / 0 NIT, beide eingearbeitet.** Das
MEDIUM war der Fehler, den erst mein Fix für MEDIUM-1 erzeugt hatte (oben, Abschnitt 2); das LOW
zwei „fünf"-Reste in den Gate-Aufzählungen, die ich beim Hochzählen auf neun übersehen hatte.
Runde 2 hat außerdem die vier neuen B2-Namen einzeln im Code aufgesucht und als treffend bestätigt,
die Pipe-Zählung aller zehn berührten Zeilen nachgerechnet, die Zeitstempel geprüft und — das ist
der nützlichste Teil — **alle 18 in `TODO.md` belassenen Zeilennummern dieser Slice-Familie**
einzeln gegen `HEAD` nachgesehen (`discovery-poc.ts:28`, elf Stellen in `tls.ts`,
`cert-issuance-api.ts:43-45`/`:59-61`, `agent-card.ts:229-230`/`:256`, `peer-cache.ts:132`,
`websocket.ts:263`): alle treffen weiterhin exakt. **Keine** weiteren durch #366/#367/#368
gekippten Stellen.

**Runde 3: APPROVE — 0 HIGH / 0 MEDIUM / 0 LOW / 1 NIT (nicht blockierend), eingearbeitet.** Der
NIT war eine letzte Ungenauigkeit in genau der Aussage, die zwei Runden gekostet hat: die ältere
Zeilenform hatte nicht einheitlich `(base=main)` in Spalte 2 — bei #319/#325/#326/#351 stand dort
direkt das Datum (9 Spalten), erst bei #352–#355 das `(base=main)` (10 Spalten). Nachgemessen,
korrigiert. Runde 3 hat zudem alle genannten Commits einzeln gegen `git show` verifiziert, die
Zwei-Epochen-Darstellung an allen fünf Stellen als widerspruchsfrei bestätigt und die Pipe-Zählung
aller zehn Zeilen #360–#369 nachgerechnet.

**Gegengeprüft und bestätigt** hat der Reviewer in Runde 1: alle neun Merge-Zustände; dass genau die neun
Zeilen und darin **nur die zweite Spalte** geändert wurden (die Vorkommen von `(offen, base=main)`
im Nachweistext von #360/#361/#363 blieben unberührt); dass jede geänderte Zeile und #369 **11
unescaped Pipes** tragen und keine Zeile vor #360 angefasst wurde; dass alle neun alten Zahlen erst
durch #368 kippten (in `9e944ef` stimmten sie noch); dass die eingesetzten Namen im Code eindeutig
auffindbar und **besser als Zeilennummern** sind; dass die vier belassenen Angaben heute punktgenau
stimmen; den `[Unreleased]`-Verlauf samt neuem Wert; und die Abgrenzung gegen Zeile #367 als
tragfähig.

## 5. Was bewusst **nicht** geändert wurde

- **`COMPLIANCE-TABLE.md` Zeile #367 und `changes/2026-11-09_tl-18-task-refused-alert.md`** tragen
  dieselben alten Zeilennummern wie `TODO.md` vorher. Das sind Prozess- und Fortschrittsnachweis
  *jenes* PRs und beschreiben korrekt den Stand von damals. Rückwirkend zu ändern wäre dieselbe
  Geschichtsfälschung, die in #366 für die GraphQL-Nennungen abgelehnt wurde
  (`CONTRIBUTING.md:15-21`). Der Unterschied ist die Rolle der Datei, nicht der Inhalt:
  `TODO.md` ist ein **lebendes** Dokument, dem ein Leser heute folgt.
- **Keine fremden `TODO.md`-Einträge.** Der Arbeitsbaum enthält hunderte Zeilenangaben aus Jahren
  von Einträgen; gezogen wurden ausschließlich die Stellen, die diese Slice-Familie selbst
  geschrieben **und** selbst gekippt hat — der TL-18-Absatz (#367) und Sektion B2 (#365), beide
  durch #368. Als Gegenprobe wurde jede `*.ts:<zeile>`-Angabe in `TODO.md` geprüft, ob sie noch
  innerhalb der jeweiligen Datei liegt: **keine** zeigt ins Leere. Das ist kein Beweis, dass jede
  verbleibende Zahl die richtige Zeile trifft — nur, dass keine offensichtlich kaputt ist; ältere
  Einträge fremder Slices sind bewusst nicht einzeln nachgezählt.
- **Keine Status-Zelle vor #360** — bis #359 ist die Konvention eingehalten.
- Nichts an `TL-16`, `TL-17`, `TL-19`, `TL-22a/b`; kein Branch-Delete der lokalen Referenzen.

## 6. Gates

Reine `.md`-Änderung, also gibt es weder etwas zu bauen noch zu testen. Trotzdem gegen den
Arbeitsbaum belegt, damit „Doku-only" nicht ungeprüft bleibt:

- `git diff --stat` ⇒ **0** Dateien unter `packages/`.
- Tabellen-Integrität: jede geänderte COMPLIANCE-Zeile trägt **11** unescaped Pipes; die Tabellen
  dieses Dokuments ebenfalls per Zähler geprüft.
- Jede der **neun** korrigierten, der vier vorbeugend mitgezogenen und der vier belassenen
  Angaben einzeln gegen den Arbeitsbaum nachgesehen (Abschnitt 3).
- Jeder der neun Merge-Zustände einzeln per `gh pr view` geprüft (Abschnitt 1).
- Externe CR-Runde gefahren, obwohl eine Doc-only-PR sie auslassen dürfte (Abschnitt 4b) — sie
  hat zwei MEDIUM gefunden, beide in meiner Begründung statt im Diff.
