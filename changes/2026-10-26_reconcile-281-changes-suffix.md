# changes/2026-10-26 — docs(reconcile): CHANGES-Suffix für #281 nachgezogen

**Typ:** Doc-only Post-Merge-Reconcile, **eine** Zeile. **Kein `packages/`-Diff**, kein `.ts`/`.sh`-Diff,
kein Test-Diff, kein Deploy, kein Secret, kein Daemon angefasst, **kein Beschluss**, kein Gate verschoben.
Risiko-Delta **null**. Präzedenz: **#359** (gleiche Fehlerklasse, gleiches Vorgehen) sowie #357/#358/#360.

**Anlass:** in #360 als Nebenbefund **belegt, aber nicht gefixt** (damals ausserhalb der Freigabe), jetzt
freigegeben. #281 hat **zwei** `CHANGES.md`-Einträge geliefert — nur einer trug die PR-Nummer.

---

## Was geändert wurde — 1 Zeile, 1:1 in-place

| Datei:Zeile | vorher (Ende der Überschrift) | nachher |
|---|---|---|
| `CHANGES.md:1162` | `… (CR-MEDIUM codex-Review #281) (2026-07-17 06:14)` | `… (2026-07-17 06:14, #281)` |

Suffix `, #NNN)` **vor** der schliessenden Klammer und hinter dem **ganzen** Zeitstempel — Muster aus #359.
Der Klammerausdruck `(CR-MEDIUM codex-Review #281)` **mitten** in der Überschrift bleibt unangetastet;
angefasst wurde nur die **letzte** Klammer. Suffix-Bestand **79 → 80**. Zeilennummer = `origin/main`-Stand
vor diesem Diff; nach dem Einschub des neuen Eintrags `:1191`.

## Zeilennummer: selbst gemessen, nicht übernommen

Der Dispatch nannte zuerst `:1131` und korrigierte sich dann auf `:1162`. Beides nachgemessen — die
Korrektur ist richtig, `:1131` war der Stand **vor** dem #360-Merge:

```bash
git show origin/main:CHANGES.md | grep -nE '^### .*281'
# 1110: ### docs(reconcile): PR-Nummern-Cursor … (#281–#284) (2026-07-18 06:04, #286)   ← fremder Eintrag
# 1162: ### fix(api): TL-21 Skelett-Übersicht total gegen malformed … (2026-07-17 06:14) ← Ziel, ohne Suffix
# 1176: ### feat(api): TL-21 Skelett-Auskunft … (2026-07-16 18:10, #281)                 ← hat den Suffix
```

`origin/main` = **`d747145`** zum Messzeitpunkt. Die Zeile `:1110` nennt #281 nur im Text und gehört zu
**#286** — sie wurde **nicht** angefasst.

## Zuordnung zu #281 — belegt, nicht geraten

| Beleg | Ergebnis |
|---|---|
| `gh pr view 281` | `MERGED`, mergedAt **2026-07-17T09:44:22Z**, mergeCommit **`830feed`** |
| `git log -S'Skelett-Übersicht total gegen malformed' -- CHANGES.md` | genau **ein** Commit: `830feed … (#281)` |
| derselbe Commit schrieb `:1176` | ja — und **die** Überschrift trägt `, #281)` bereits |
| Body der Zielzeile, erster Satz | „**Robustheits-Fix auf dem offenen PR #281**: `firstSentence(text)` nahm einen Laufzeit-String an …" |

Der Eintrag gehört damit zweifelsfrei zum Änderungssatz von #281: ein Review-Fix, der **während** des
offenen PR dazukam und einen zweiten `CHANGES.md`-Block bekam, aber nicht den Nummern-Suffix.

## Abschluss-Zählung — und warum „0" strukturell unerreichbar ist

Belegt mit dem Kommando, begrenzt auf den Bereich der nummerierten PRs:

```bash
# Grenze = aelteste Ueberschrift, die den Suffix traegt (dynamisch, nicht hart kodiert)
LAST=$(grep -nE '^### .*, #[0-9]+\)$' CHANGES.md | tail -1 | cut -d: -f1)
grep -nE '^### ' CHANGES.md | grep -vE ', #[0-9]+\)$' | awk -F: -v L="$LAST" '$1<L'
```

**Ergebnis: 2 Treffer** — und zwar **ausschliesslich Reconcile-PRs, die ihre eigene Nummer noch nicht
kennen konnten**: die Überschrift von **#360** und die Überschrift **dieses** Slices. Der #281-Fall, der
diesen Slice ausgelöst hat, ist weg.

**Die Abschlussbedingung „0" ist mit diesem Mechanismus nicht erreichbar, nicht nur noch nicht:** jede
Reconcile-PR fügt beim Schliessen fremder Lücken genau eine eigene hinzu. Der erreichbare Endzustand ist
deshalb nicht „0", sondern „**nur noch Eigen-Einträge von Reconcile-PRs**" — und der ist jetzt erreicht.
Das ist der Endpunkt, nicht eine weitere Stufe: ein `#362` würde zwei Felder nachziehen und zwei neue
öffnen.

## Korrekturen zur Beleglage des Auftrags

Zwei Punkte weichen von der Dispatch-Angabe ab, beide nachgemessen:

- **Die Konventionsgrenze ist #281, nicht #261.** Der Auftrag nennt „im Zeitraum ab PR #261". Im Bestand
  ist die **kleinste** PR-Nummer mit Suffix aber **#281** (`:1176`), und für **#261 … #280** existiert
  **keine** einzige suffigierte Überschrift (`for n in $(seq 261 280)` ⇒ 0 Treffer). Die Grenze wird in
  diesem Slice deshalb **dynamisch** über `LAST` bestimmt statt auf eine Nummer festgenagelt.
- **Eine eigene COMPLIANCE-Zeile ist doch nötig** — nur keine *für #281*. Der Auftrag sagt „keine
  COMPLIANCE-Zeile nötig"; gemeint ist #281, das hat seine Zeile (`COMPLIANCE-TABLE.md:1791`,
  `| #281 | (base=main, gemergt) | 2026-07-16 18:10 |` — gegengeprüft, **nicht angefasst**). Für **diesen**
  PR ist eine Zeile dagegen Pflicht (`CLAUDE.md`: „für JEDEN PR") und wird vom CI-Gate
  „Doku-Compliance (changes/ + COMPLIANCE-Zeile)" erzwungen.

## Was bewusst NICHT angefasst wurde

- **`CHANGES.md:1110`** — nennt #281 nur im Text, gehört zu #286, trägt seinen Suffix korrekt.
- **`COMPLIANCE-TABLE.md:1791`** (#281) — nur gegengeprüft, nicht editiert.
- **Die Überschrift von #360** (`:11`) und die **COMPLIANCE-Zeile von #360** (`:2067`) — Selbst-Reconcile-
  Lücke, dokumentierter Endzustand aus #360, bewusst nicht fortgeschrieben.
- **Die historischen Überschriften** unterhalb der Konventionsgrenze und die **43** alten
  `(offen, base=main)`-Zeilen ohne PR-Bezug (alle älter als #296).
- **Nicht berührt:** `TODO.md`, TL-08/09/10, **TL-14 bleibt C1-gated**, ADR-046 §9,
  `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`, `packages/daemon/scripts/discovery-poc.ts`, der
  `.55`-c/k-Widerspruch, Re-Enroll / `.94`-Admin-Token (Christian-Gate, TH01-Daemon weiter in Crash-Loop).
  Keine `HISTORY.md`. **#350** bleibt ohne eigene Zeile.

## Tests
**Kein `.ts`-Diff ⇒ Suite nicht betroffen**, kein Verhaltens-Delta. Statt Tests:

| Prüfung | Ergebnis |
|---|---|
| Zeilennummer gegen `git show origin/main:CHANGES.md` | ✅ `:1162` (Dispatch-Erstangabe `:1131` war Pre-#360-Stand) |
| #281 `gh pr view` | ✅ `MERGED`, `830feed`, 2026-07-17T09:44:22Z |
| Zuordnung über `git log -S` **und** den Body-Text | ✅ beide zeigen auf #281 |
| nur die **letzte** Klammer geändert, Inline-`(… #281)` intakt | ✅ `--numstat` = 1 geänderte Bestandszeile |
| Suffix-Bestand vor/nach | ✅ **79 → 80** |
| #281-COMPLIANCE-Zeile existiert und ist unangetastet | ✅ `:1791`, nicht im Diff |
| Abschluss-Zählung | ✅ **2**, nur Eigen-Einträge von Reconcile-PRs |

## Precommit (manuell)
`pal:precommit` ist weiter am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen, Secret-Scan
clean (**nur Markdown**), kein Code/Config/Deploy/State, keine Datei ausserhalb von `CHANGES.md` /
`COMPLIANCE-TABLE.md` / `changes/`.
