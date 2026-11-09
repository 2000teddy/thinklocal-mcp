# Reconcile — COMPLIANCE-Status-Zellen #369, #370, #371

**Datum:** 2026-11-09
**Branch:** `agent/claude-code/reconcile-cells-369-371`
**Basis:** `main` @ `8fc7c69` (Merge von #371)
**PR:** #372
**Auftrag:** `~/hermes/dispatches/2026-11-09-compliance-zellen-369-370-371.md` (Sweep #122),
nach Christians Aufweisung „Die drei Zellen im nächsten Durchgang mitnehmen."
**Art:** Doku-only. **Kein** `packages/`-Diff, kein Code, kein Test, kein Deploy, kein Release,
kein Secret.

---

## 1. Was gezogen wurde

Drei Zellen standen auf `(offen, base=main)`, obwohl alle drei PRs gemergt sind. Die
Merge-Zustände sind **einzeln per `gh pr view`** erhoben, nicht aus der Tabelle übernommen:

| Zelle | Zustand laut `gh` | Merge-Commit |
|---|---|---|
| #369 | MERGED 2026-11-09T12:16:34Z | `5707f33` |
| #370 | MERGED 2026-11-09T13:09:04Z | `d5c3d3a` |
| #371 | MERGED 2026-11-09T13:35:49Z | `8fc7c69` |

Geändert wurde **ausschließlich die zweite Spalte**, und zwar per erstem Vorkommen je Zeile, damit
eine identische Zeichenkette im Nachweistext (Spalte 10) unberührt bleibt. Der Fließtext beschreibt
den Stand des jeweiligen PRs zu dessen Zeitpunkt und wird nicht rückwirkend umgeschrieben.

*Kleine Richtigstellung am Auftragstext: dort steht an einer Stelle „Spalte 1 ⇒
`(base=main, gemergt)`"; gemeint und an anderer Stelle korrekt benannt ist die **zweite** Spalte —
Spalte 1 trägt die PR-Nummer.*

**Drei Assertions, alle vor dem Schreiben bzw. am Diff geprüft:**

1. Getroffen wurden genau `369`, `370`, `371` — per Assertion gegen die Zielliste.
2. Jede geänderte Zeile trägt **11 unescaped Pipes** (10 Spalten), sonst bricht die Tabelle.
3. `git diff --numstat` **vor** dem Anhängen von Zeile #372 und Footer ⇒ **+3/−3** in
   `COMPLIANCE-TABLE.md`, und der Zeilen-Diff enthält **ausschließlich** `#369`, `#370`, `#371` —
   keine Zeile **vor** #369 wurde angefasst. *Der Enddiff dieser Datei ist `+5/−4`: die drei
   gezogenen Zellen plus die neue Zeile #372 (+1) plus der Footer (+1/−1).*

## 2. Zwei Überraschungen — gemeldet statt geraten

Der Auftrag verlangt, Abweichungen zu melden statt den Umfang eigenmächtig zu erweitern. Zwei
Dinge sind beim Durchzählen aufgefallen; **beide bleiben unangetastet**.

### (a) Zeile #164 trägt in der Status-Spalte gar keinen Status

Eine Auswertung der Statuszellen **aller Zeilen, die mit einer PR-Nummer in Spalte 1 beginnen**
(98 Stück: die Einzelzeile #164 plus lückenlos #271…#371) ergibt drei Werte:
`(base=main, gemergt)` **94×**, `(offen, base=main)` **3×** (die soeben gezogenen) — und **einmal**
den Text `mDNS-Interface-Pin-Disable (.55-Bug)`. Das ist Zeile **#164** vom 2026-06-08: dort steht
in der Statusspalte ein **Titel**, kein Status.

**Einschränkung, die mein erster Text unterschlagen hat** (CR-Runde 1, LOW-1): „alle Statuszellen"
stimmt nur für diese 98 Zeilen. **Vor #271** trug Spalte 1 noch keine PR-Nummer, sondern einen
Versions- oder Kurz-Slug (`v0.34.43`, `ADR-033`, `adr039-tl08a` …), und dort stehen in Spalte 2
noch **31** Zeilen mit `offen`: 28× `(offen, base=main)` ohne PR-Bezug, dazu `v0.34.57`
(`restacked nach #229-Merge`), `v0.34.58` (`#231 (offen, base=#237 T3.3, restacked)`) und
`adr039-tl08a` (`#267 (offen)`). Mein Suchmuster hat diesen ganzen Bereich übersprungen. Die
Altzeilen sind **bekannt und bereits abgegrenzt** — #357–#361 führen sie als Altbestand vor #296 —
und bleiben unberührt; der Auftrag schließt alles vor #369 aus. Die Formulierung „alle" war
trotzdem zu groß und ist hiermit eingeschränkt.

Die Zeile ist strukturell intakt (11 Pipes), die Tabelle bricht nicht. PR #164 ist laut `gh`
**MERGED** (2026-06-08T17:02:39Z), müsste nach heutiger Konvention also `(base=main, gemergt)`
tragen.

**Nicht angefasst**, aus zwei Gründen: der Auftrag schließt Zellen **vor #369** ausdrücklich aus,
und die Zeile stammt aus einer Zeit, in der die Spaltenbelegung noch nicht einheitlich war — sie
zu „korrigieren" hieße zu entscheiden, wohin der Titel gehört und ob er verloren gehen darf. Das
ist eine eigene, kleine Entscheidung und kein Nebenprodukt dieses Schnitts.

### (b) Ältere `CHANGES.md`-Einträge zitieren Zeilennummern, die nicht mehr stimmen

Mehrere Einträge verweisen auf `COMPLIANCE-TABLE.md:<zeile>`. Gegen den heutigen Stand geprüft:

| Zitat (und wo es steht) | gemeint war | zeigt heute auf | richtig wäre heute |
|---|---|---|---|
| `:299` | eine HIGH-Befundzeile | Fließtext | `:326` |
| `:1791` | Zeile **#281** | eine Tabellen-Trennzeile | `:1818` |
| `:2063` (im Eintrag zu **#357**) | Zeile **#356** | **leer** | `:2090` |
| `:2064` (im Eintrag zu **#358**) | Zeile **#357** | Zeile **#344** | `:2091` |
| `:2065` (im Eintrag zu **#360**) | Zeile **#358** | **leer** | `:2092` |
| `:2066` (im Eintrag zu **#360**) | Zeile **#359** | Fließtext unter #344 | `:2093` |

**Zwei Korrekturen gegenüber meinem ersten Text** (CR-Runde 1, MEDIUM-1): ich hatte die Zitate
pauschal „zitiert als #358" zugeordnet und damit den **zitierenden Eintrag** mit der **zitierten
Zeile** verwechselt — tatsächlich meinen sie drei verschiedene Zeilen (#356, #357, #358). Und
`:2066` hatte ich ganz übersehen; es steht im selben Halbsatz wie `:2065`.

**Die Ursache ist benennbar — und sie trifft mich selbst.** Alle sechs Zitate sind um **exakt +27
Zeilen** gewandert, an jedem einzelnen nachgerechnet. Der Grund steht im Diff von **#369**
(`5707f33`): dessen erster Hunk ist `@@ -27,6 +27,33 @@` — der Konventions-Block im Kopf dieser
Tabelle, netto **+27** Zeilen oberhalb von allem anderen. Mein erster Text nannte den Drift
„vorbestehend"; das ist **falsch**. Verursacht hat ihn **mein eigener Slice #369** — ausgerechnet
der, der diese Fehlerklasse dokumentiert hat. Von *diesem* Schnitt (#372) stammt die Verschiebung
dagegen nicht: die Ziehung ersetzt drei Zeilen in-place, und die neue Zeile #372 steht **unterhalb**
von #371, alle Zitate liegen darüber.

**Nicht angefasst**, und das ist dieselbe Begründung wie in #366 und #369: diese Einträge sind
**Historie**, sie beschreiben den Stand ihres jeweiligen PRs. Rückwirkend umzuschreiben wäre
Geschichtsfälschung. Festhalten will ich trotzdem, dass hier die Lehre aus #369 ein zweites Mal
sichtbar wird — diesmal in `CHANGES.md` statt in `TODO.md`: **Zeilennummern auf eine Datei, die
weiter wächst, halten nicht.** Für neue Einträge gilt die Regel bereits (Namen statt Zahlen); ob
die alten je nachgezogen werden, ist eine Kanon-Frage und liegt nicht bei der Lane.

## 3. Was dieser Schnitt nicht anfasst

- **Keine Status-Zelle vor #369.** Unter den Zeilen mit PR-Nummer in Spalte 1 ist die Konvention
  bis #368 eingehalten (94×), die eine Ausnahme ist #164 unter (a). Die **31** Altzeilen vor #271,
  deren Spalte 1 einen Versions-/Kurz-Slug trägt, stehen teils noch auf `offen` — seit #357–#361
  als Altbestand abgegrenzt, hier unberührt.
- **Kein `TODO.md`-Diff.** Der Schnitt ist reine Prozess-Hygiene an der Compliance-Tabelle; es gibt
  keinen TL-Punkt, der dadurch seinen Zustand ändert. Geprüft wurde auch, ob die Zellen-Ziehung
  `TODO.md`-Zeilenangaben kippt — `TODO.md` zitiert **keine** `COMPLIANCE-TABLE.md`-Zeilennummern,
  also nein.
- **Keine `[Unreleased]`-Datumskonvention** in `CHANGES.md` (Kanon-Beschluss, liegt bei Christian);
  die Zeitangabe selbst ist nach der in #369 beobachteten Praxis auf den jüngsten Eintrag gezogen.
- **Kein `packages/`-Diff** — `git diff --stat -- packages/` ⇒ **0 Dateien**.
- `TL-16`, `TL-17`, `TL-19`, `TL-22a/b` unberührt; kein Branch-Delete, kein Merge durch die Lane.

## 3b. Externe Code-Review

`pal:codereview` unverändert unbrauchbar (beide Fremd-Backends unter `~/.local/bin`, der
`pal`-Serverprozess erbt den PATH nicht — CO-Vorbehalt seit #364). Review-of-Record über
`~/.local/bin/agy --sandbox` (Gemini); nie MiniMax, nie `pal:chat`.

**Runde 1: CHANGES REQUESTED — 0 HIGH / 1 MEDIUM / 1 LOW / 1 NIT, alle drei eingearbeitet.** Keiner
traf den Diff; alle drei trafen meine Begründung.

- **MEDIUM-1** — die Zitat-Zuordnung war falsch (zitierender Eintrag mit zitierter Zeile
  verwechselt), `:2066` fehlte ganz, und ich hatte den Drift „vorbestehend" genannt. Der Reviewer
  hat die Ursache geliefert, die ich selbst hätte finden müssen: **exakt +27**, aus dem ersten Hunk
  von **#369**. Siehe Abschnitt 2 (b).
- **LOW-1** — „Auswertung aller Statuszellen" deckte nur die Zeilen mit PR-Nummer in Spalte 1 ab.
  Siehe Abschnitt 2 (a).
- **NIT-1** — `+3/−3` war der Zwischenstand, der Enddiff der Datei ist `+5/−4`.

**Runde 2: APPROVE — 0 HIGH / 0 MEDIUM / 0 LOW / 0 NIT.** Der Reviewer hat die neue
Zuordnungstabelle **Zeile für Zeile** gegen den Arbeitsbaum nachgerechnet — für jedes der sechs
Zitate: wo es steht, was es meinte, wohin es heute zeigt, wo die Zeile heute liegt —, die
`+27`-Ursache am Hunk von `5707f33` bestätigt, die Grundgesamtheiten **98** und **31** nachgezählt,
die 11 Pipes in #369–#372 geprüft und bestätigt, dass in #369–#371 **ausschließlich Spalte 2**
geändert wurde.

**Ein Zusatzbefund ohne Befundstatus, hier festgehalten statt verschwiegen:** dieselben Zitate
`:1791` und `:2063…:2066` stehen **auch** in den Nachweistexten dieser Tabelle selbst (#357, #358,
#360, #361) und in deren `changes/`-Dateien. Der Drift ist also breiter als die sechs
`CHANGES.md`-Stellen. Meine Aufzählung bleibt korrekt, weil sie ausdrücklich von
`CHANGES.md`-Einträgen spricht; die weiteren Fundstellen sind ebenfalls Historie und bleiben aus
demselben Grund unangetastet.

## 4. Und der Rest, der bleibt

Die Zeile **#372** dieses PRs steht beim Anlegen korrekt auf `(offen, base=main)` und wird nach
ihrem Merge selbst stale — das ist der Rest, den die Kopf-Notiz seit #369 beschreibt: **jede
Reconcile-Runde lässt genau eine Zeile offen, ihre eigene.** Neu ist diesmal die Beobachtung, dass
der Rest zwischen zwei Durchgängen auf **drei** angewachsen war, weil #370 und #371 die Tabelle
zwar beschrieben, die Vorgängerzellen aber laut Auftrag nicht ziehen durften. Der in #369 notierte
**Vorschlag** — ein Folge-PR, der ohnehin an der Tabelle schreibt, zieht gemergte Vorgänger mit —
hätte genau das verhindert; er ist weiterhin **nicht** entschieden und wird hier nur erinnert.
