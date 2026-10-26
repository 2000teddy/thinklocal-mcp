# changes/2026-10-26 — docs(reconcile): CHANGES-Suffixe für #351, #354, #355

**Typ:** Doc-only Post-Merge-Reconcile. **Kein `packages/`-Diff**, kein `.ts`/`.sh`-Diff, kein Test-Diff,
kein Deploy, kein Secret, kein Daemon angefasst, **kein Beschluss**, kein Gate verschoben. Risiko-Delta
**null**. Präzedenz: #328 / #330 / #332 / #336 / #339 / #340 / #345 / #346 / #347 / #348 / #357 / #358.

**Auftrag/Anlass:** Teilfreigabe aus dem #358-Bericht. Drei `CHANGES.md`-Überschriften trugen ihre PR-Nummer
**gar nicht** — `grep -nE '^### .*#(351|354|355)'` fand sie nicht. Ursache: ihre COMPLIANCE-Zeilen wurden in
**#356** von `(offen, base=main)` auf die PR-Nummern gehoben, die Hebung war damals aber **auf die Tabelle
beschränkt**; dadurch lief der Doku-Kanon zwischen `COMPLIANCE-TABLE.md` (Nummer vorhanden) und `CHANGES.md`
(Nummer fehlt) gegeneinander.

---

## Was geändert wurde — 3 Zeilen, 1:1 in-place

Suffix `, #NNN)` jeweils **vor** der schliessenden Klammer, Format exakt wie der Bestand
(**73 → 76** Überschriften mit Suffix). Zeilennummern = `main`-Stand vor diesem Diff:

| Datei:Zeile | vorher (Ende der Überschrift) | nachher | PR | Merge-Commit |
|---|---|---|---|---|
| `CHANGES.md:100` | `… (2026-08-31 06:20)` | `… (2026-08-31 06:20, #355)` | #355 | `a16b475` |
| `CHANGES.md:139` | `… (2026-08-26 07:50 / Korrektur 08:40)` | `… (2026-08-26 07:50 / Korrektur 08:40, #354)` | #354 | `132c1ad` |
| `CHANGES.md:224` | `… (2026-07-29 07:40)` | `… (2026-07-29 07:40, #351)` | #351 | `136c2f7` |

**Der Sonderfall `:139`:** diese Überschrift hat einen **zweiteiligen** Zeitstempel
(`07:50 / Korrektur 08:40`). Der Suffix gehört hinter den **ganzen** Stempel, nicht hinter den ersten Teil —
der Korrektur-Hinweis bleibt vollständig erhalten. Nur der Text **nach** dem letzten Zeitbestandteil und
**vor** der schliessenden Klammer wurde eingefügt; kein Wort der Überschriften wurde sonst angefasst.

**Reihenfolge wie beauftragt:** erst die drei Überschriften, dann dieser Eintrag und der `CHANGES.md`-Eintrag
mit den **korrigierten** Zeilennummern — der eigene Einschub verschiebt die drei Ziele um +26 Zeilen auf
`:126` / `:165` / `:250`. Beide Nummernsätze sind gegen den Dateistand gegengeprüft, nicht gerechnet.

## Was bewusst NICHT geändert wurde

- **Die Überschriften von #357 und #358** tragen ihre eigene PR-Nummer weiterhin nicht: #357
  (`main`-Stand `:33`, nach dem Einschub `:59`) und #358 (`:11` → `:37`). Das ist die bekannte
  **Selbst-Reconcile-Lücke** — eine PR kennt ihre Merge-Nummer beim Schreiben nicht; das erklärt, warum
  auch die Überschrift *dieses* Slices keinen Suffix trägt. **Dass sie hier nicht geschlossen wird, hat
  aber einen zweiten Grund:** diese Teilfreigabe ist ausdrücklich auf die drei #356-Altfälle
  (#351/#354/#355) begrenzt. Das ist der entscheidende Grund bei **#357**, dessen COMPLIANCE-Zeile in
  #358 schon gehoben wurde — dort trägt die Selbst-Reconcile-Begründung allein nicht mehr. Beide gehen
  in den nächsten **regulären** Reconcile-Nachtrag (Muster #346 → #348); kein Versäumnis dieses Slices.
- **#350:** ausdrücklich nicht Teil dieser Freigabe, bleibt unangetastet.
- **Die COMPLIANCE-Zeile von #358** bleibt auf `(offen, base=main)` — dieselbe Lücke, nächster Nachtrag.
- **Die 43 nicht-PR-nummerierten `(offen, base=main)`-Zeilen** (Erst-Spalte `v0.34.x`/`ADR-033`/
  `tl07-seam`/`drift` …, alle älter als #296) ⇒ anderer Slice.
- **Nicht berührt:** `TODO.md`, TL-08/09/10, **TL-14 bleibt C1-gated**, ADR-046 §9,
  `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`, `packages/daemon/scripts/discovery-poc.ts`, der
  `.55`-c/k-Widerspruch, Re-Enroll / `.94`-Admin-Token (Christian-Gate, TH01-Daemon weiter in Crash-Loop).
  Keine `HISTORY.md` (existiert bewusst nicht, `CONTRIBUTING.md:34-36`).

## Tests
**Kein `.ts`-Diff ⇒ Suite nicht betroffen**, kein Verhaltens-Delta. Statt Tests die Verifikation:

| Prüfung | Ergebnis |
|---|---|
| #351 / #354 / #355 `gh pr view --json state,mergeCommit` | ✅ alle `MERGED`: `136c2f7` / `132c1ad` / `a16b475` |
| Zuordnung Überschrift → PR gegen den Dateiinhalt geprüft (nicht gegen den Dispatch) | ✅ `:100` Runbook-Volltext = #355, `:139` D2-pathLen = #354, `:224` G1-Brief = #351 |
| Suffix-Bestand vor/nach | ✅ **73 → 76** Überschriften mit `, #NNN)` |
| Post-Diff-Zeilen `:126`/`:165`/`:250` tragen wirklich die drei Überschriften | ✅ einzeln per `sed -n` gegengeprüft |
| Post-Diff-Zeilen `:33`/`:55` tragen die #358-/#357-Überschrift | ✅ gegengeprüft (eine erste Fassung hatte die beiden **verdreht**, korrigiert) |
| Nur Überschriften-Enden angefasst, kein Rumpftext | ✅ `--numstat` = 3 geänderte Bestandszeilen |

## Precommit (manuell)
`pal:precommit` ist weiter am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen, Secret-Scan
clean (**nur Markdown**), kein Code/Config/Deploy/State, keine Datei ausserhalb von `CHANGES.md` /
`COMPLIANCE-TABLE.md` / `changes/`.
