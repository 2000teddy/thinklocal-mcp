# changes/2026-10-26 — docs(reconcile): Abschluss der Reconcile-Kette (#357/#358/#359)

**Typ:** Doc-only Post-Merge-Reconcile — der **letzte** Nachtrag der Welle, die mit #356 begann.
**Kein `packages/`-Diff**, kein `.ts`/`.sh`-Diff, kein Test-Diff, kein Deploy, kein Secret, kein Daemon
angefasst, **kein Beschluss**, kein Gate verschoben. Risiko-Delta **null**. Präzedenz: #328 / #330 / #332 /
#336 / #339 / #340 / #345 / **#346** / #347 / #348 / #357 / #358 / #359.

**Anlass:** jede Reconcile-PR hinterlässt ihre **eigene** Nummer offen — sie kennt ihre Merge-Nummer beim
Schreiben nicht. Nach #357/#358/#359 waren das genau fünf Stellen. Dieser Slice schliesst sie und **beendet
die Kette ausdrücklich**, statt sie fortzuschreiben.

---

## (a) COMPLIANCE-Status-Spalten — 2 Zeilen, 1:1 in-place

| Datei:Zeile | vorher | nachher | mergedAt | Merge-Commit |
|---|---|---|---|---|
| `COMPLIANCE-TABLE.md:2065` | `(offen, base=main)` | `(base=main, gemergt)` | 2026-10-26T10:44:48Z | **#358** `9c551d2` |
| `COMPLIANCE-TABLE.md:2066` | `(offen, base=main)` | `(base=main, gemergt)` | 2026-10-26T10:54:55Z | **#359** `2cd3101` |

Nachweis-Text, Spaltenzahl und Pipe-Zahl beider Zeilen **unverändert** (je 11 unescaped Pipes = 10 Spalten,
vor und nach dem Edit verglichen), kein Textumbau.

## (b) CHANGES-Überschriften — 3 Zeilen, 1:1 in-place

Suffix `, #NNN)` jeweils **vor** der schliessenden Klammer; Suffix-Bestand **76 → 79**. Zeilennummern =
`main`-Stand vor diesem Diff (nach dem Einschub des neuen Eintrags `:42`/`:68`/`:90`):

| Datei:Zeile | Überschrift | PR | Merge-Commit |
|---|---|---|---|
| `CHANGES.md:11` | `docs(reconcile): CHANGES-Suffixe für #351, #354, #355 … (2026-10-26 12:00)` | **#359** | `2cd3101` |
| `CHANGES.md:37` | `docs(reconcile): Footer-Nachtrag + #357-Zeile (2026-10-26 11:40)` | **#358** | `9c551d2` |
| `CHANGES.md:59` | `docs(reconcile): PR-Nummern-Nachtrag für #356 (2026-10-26 11:30)` | **#357** | `0c8d4b6` |

## (c) Footer

`Letzte Aktualisierung: 2026-10-26 11:40` → **`2026-10-26 12:15`**, mit #357/#358/#359 und ihren
`gh`-verifizierten Merge-Commits. Semikolon-Kette und `Zuvor:`-Historie **vollständig erhalten**
(36 → **38** Glieder; eines davon ist die bisherige Kopf-Beschreibung, die jetzt als
`Zuvor: 2026-10-26 11:40 — …` weiterläuft), Schluss-Satz und abschliessendes `*` byte-identisch.
Die Neufassung bleibt **eine** Zeile; die Datei wächst allein um die eigene #360-Zeile (**2070 → 2071**).

**Reihenfolge wie beauftragt:** erst (a) und (b), dann (c) — sonst hätte der Footer einen Stand behauptet,
den die Tabelle noch nicht hatte.

## Abschluss-Beleg — live gezählt nach dem Edit

Die beiden Kommandos, mit denen gezählt wurde, und ihr Ergebnis:

```bash
# 1) Status-Spalten mit PR-Bezug, die noch offen stehen
grep -cE '^\| #[0-9]+ \| \(offen, base=main\) \|' COMPLIANCE-TABLE.md
# 2) Ueberschriften OHNE ", #NNN)"-Suffix, begrenzt auf den nummerierten Bereich:
#    bis zur aeltesten suffigierten Ueberschrift (:1171 auf main, :1176 in diesem Branch).
#    Ohne diese Begrenzung liefert der Grep zusaetzlich alle historischen Ueberschriften
#    aus der Zeit vor der PR-Nummern-Konvention und damit weit mehr als 2 Treffer.
LAST=$(grep -nE '^### .*, #[0-9]+\)$' CHANGES.md | tail -1 | cut -d: -f1)
grep -nE '^### ' CHANGES.md | grep -vE ', #[0-9]+\)$' | awk -F: -v L="$LAST" '$1<L'
```

**Ergebnis: 1 und 2 — nicht 0 und 0.** Die Auftrags-Erwartung trifft damit **nicht ganz**, und das ist
wichtiger als ein glattes Ergebnis:

| Kommando | Treffer | welche |
|---|---|---|
| (1) Status-Spalten | **1** | nur die eigene `#360`-Zeile |
| (2) Suffix-Lücken im nummerierten Bereich (`main`-Zeilen 11–1171, bis zur ältesten suffigierten Überschrift) | **2** | die eigene `#360`-Überschrift **+ `CHANGES.md:1157`** |

**Treffer 1 ist strukturell unvermeidbar:** die Selbst-Reconcile-Lücke lässt sich nicht in derselben PR
schliessen, in der sie entsteht — die eigene `#360`-Zeile steht auf `(offen, base=main)` und die eigene
Überschrift trägt keinen Suffix. Keine Restarbeit.

**Treffer 2 ist ein neuer Fund und wird hier nur belegt, nicht gefixt.**
`CHANGES.md:1157` lautet `fix(api): TL-21 Skelett-Übersicht total gegen malformed CRDT-Daten (CR-MEDIUM
codex-Review #281) (2026-07-17 06:14)` und trägt keinen Suffix. Er gehört zu **#281** — belegt, nicht geraten:

```bash
git log -S'Skelett-Übersicht total gegen malformed' --oneline -- CHANGES.md
# 830feed [claude-code] feat(api): TL-21 Skelett-Auskunft GET /api/capabilities/overview (Kap. 06) (#281)
```

Derselbe Merge-Commit schrieb auch `:1171`, das den Suffix `, #281)` **hat** — **#281 lieferte zwei
`CHANGES.md`-Einträge, nur einer bekam die Nummer.** Das ist dieselbe Fehlerklasse wie die drei in #359,
liegt aber **ausserhalb dieser Freigabe** (historische Überschriften ausdrücklich ausgeschlossen). Der
nächste Slice bräuchte dafür genau eine Zeile: `:1157` → `… (2026-07-17 06:14, #281)`.

**Die Kette dieser Welle endet hier trotzdem bewusst.** Ein `#361`, das nur die beiden Eigen-Felder nachzieht,
würde dabei zwei neue öffnen — reine Buchhaltung ohne Informationswert. Der Reststand ist damit
**dokumentiert statt fortgeschrieben**: wer die Felder später braucht, findet hier die Begründung, warum sie
offen sind, und mit `:1157` gleich den einen Fall, bei dem ein Nachtrag wirklich noch etwas bewirkt.

## Was bewusst NICHT angefasst wurde

- **#350** — hat weiterhin **keine** eigene COMPLIANCE-Zeile, und das bleibt so: der Merge-Commit `27c5cc0`
  hat die bestehenden Zeilen von #348/#349 **geändert** statt eine eigene anzulegen. Das ist das dokumentierte
  Muster eines Reconcile-Slices — er reconciliert fremde PRs und ist nicht selbst Gegenstand der Tabelle.
  Eine 10-Spalten-Zeile dafür zu rekonstruieren wäre Erfindung.
- **Die 43 alten `(offen, base=main)`-Zeilen ohne PR-Bezug** (Erst-Spalte `v0.34.x`/`ADR-033`/`tl07-seam`/
  `drift` …, alle älter als #296, aus der Zeit vor der PR-Nummern-Konvention) ⇒ anderer Slice.
- **Die historischen `CHANGES.md`-Überschriften ohne Suffix** aus derselben Zeit — nicht Teil des Scopes.
- **Nicht berührt:** `TODO.md`, TL-08/09/10, **TL-14 bleibt C1-gated**, ADR-046 §9,
  `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`, `packages/daemon/scripts/discovery-poc.ts`, der
  `.55`-c/k-Widerspruch, Re-Enroll / `.94`-Admin-Token (Christian-Gate, TH01-Daemon weiter in Crash-Loop).
  Keine `HISTORY.md` (existiert bewusst nicht, `CONTRIBUTING.md:34-36`).

## Tests
**Kein `.ts`-Diff ⇒ Suite nicht betroffen**, kein Verhaltens-Delta. Statt Tests die Verifikation:

| Prüfung | Ergebnis |
|---|---|
| #357 / #358 / #359 `gh pr view --json state,mergedAt,mergeCommit` | ✅ alle `MERGED`: `0c8d4b6` / `9c551d2` / `2cd3101` |
| Zuordnung Überschrift → PR gegen den Dateiinhalt geprüft | ✅ `:11`=#359, `:37`=#358, `:59`=#357 |
| Pipe-/Spaltenzahl der zwei gehobenen Zeilen vor/nach | ✅ je 11 unescaped Pipes = 10 Spalten |
| Suffix-Bestand vor/nach | ✅ **76 → 79** |
| `Zuvor:`-Kette nicht abgeschnitten | ✅ 36 → 38, Schluss-Satz und `*` identisch |
| Post-Diff-Zeilen `:42`/`:68`/`:90` tragen die drei Überschriften | ✅ einzeln per `sed -n` gegengeprüft |
| Abschluss-Zählung | ⚠️ **1 / 2**, nicht 0/0 — Eigen-Einträge plus der neue Fund `:1157` (#281), s. o. |

## Precommit (manuell)
`pal:precommit` ist weiter am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen, Secret-Scan
clean (**nur Markdown**), kein Code/Config/Deploy/State, keine Datei ausserhalb von `CHANGES.md` /
`COMPLIANCE-TABLE.md` / `changes/`.
