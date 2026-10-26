# changes/2026-10-26 — docs(reconcile): Footer-Nachtrag + #357-Zeile

**Typ:** Doc-only Post-Merge-Reconcile. **Kein `packages/`-Diff**, kein `.ts`/`.sh`-Diff, kein Test-Diff,
kein Deploy, kein Secret, kein Daemon angefasst, **kein Beschluss**, kein Gate verschoben. Risiko-Delta
**null**. Präzedenz: #328 / #330 / #332 / #336 / #339 / #340 / #345 / #346 / #347 / #348 / **#357**.

**Auftrag/Anlass:** der Footer von `COMPLIANCE-TABLE.md` (letzte Zeile) stand seit dem **2026-07-28** auf
dem #346/#347-Stand, während die Tabellenzeilen darüber längst nachgezogen waren — der Doku-Kanon driftete
**gegen sich selbst**. Der Befund stammt aus #357 (dort als „eigener Slice" vermerkt, nicht
eigenmächtig mitgenommen) und wurde separat freigegeben.

---

## Korrektur der Auftragsannahme: **zehn** Merges, nicht sieben

Der Dispatch nannte sieben Merges seit #347 (#348/#349/#351/#354/#355/#356/#357). Gegen `gh` nachgezählt
sind es **zehn** — drei fehlten in der Liste:

| PR | mergedAt | Merge-Commit | im Dispatch? |
|---|---|---|---|
| #348 | 2026-07-28T04:25:16Z | `6ef6b11` | ja |
| #349 | 2026-07-29T04:07:42Z | `8d2c088` | ja |
| **#350** | 2026-07-29T04:36:20Z | **`27c5cc0`** | **nein** |
| #351 | 2026-07-29T05:43:02Z | `136c2f7` | ja |
| **#352** | 2026-08-25T16:35:34Z | **`de77a2f`** | **nein** |
| **#353** | 2026-08-26T04:40:00Z | **`63cd72f`** | **nein** |
| #354 | 2026-08-26T07:35:52Z | `132c1ad` | ja |
| #355 | 2026-08-31T04:39:41Z | `a16b475` | ja |
| #356 | 2026-10-26T10:09:05Z | `8e7f683` | ja |
| #357 | 2026-10-26T10:24:45Z | `0c8d4b6` | ja |

Der Footer nennt deshalb **alle zehn**. Die drei Nachträge sind #350 (`docs(reconcile): finalize merged #348
and #349`), #352 (G2-Consensus zu Auflage C — Revocation gesplittet) und #353 (Owner-Sign-off G1+G2,
`ADR-045` → `Accepted`, D3 = 24 Monate). **Nicht stillschweigend übernommen, sondern nachgezählt** — eine
Footer-Zeile, die „sieben Merges" behauptet, wäre genau die Drift, die dieser Slice schließen soll.

## Was geändert wurde — 2 Zeilen

1. **`COMPLIANCE-TABLE.md:2064`** (Status-Spalte, **1:1 in-place**): `(offen, base=main)` →
   `(base=main, gemergt)`. **#357** ist seit **2026-10-26T10:24:45Z** `MERGED` (Merge-Commit **`0c8d4b6`**,
   `reviewDecision=APPROVED`) — dieselbe Selbst-Reconcile-Lücke wie bei #346: eine PR kennt ihre eigene
   Merge-Nummer beim Schreiben nicht. Inhalt, Spaltenzahl und Pipe-Zahl der Zeile **unverändert**
   (11 unescaped Pipes = 10 Spalten, vor und nach dem Edit verglichen), kein Textumbau.
2. **Footer (letzte Zeile)**: `Letzte Aktualisierung: 2026-07-28 06:15` → **`2026-10-26 11:40`**, mit allen
   zehn Merges und ihren `gh`-verifizierten Merge-Commits.

**Reihenfolge wie beauftragt:** erst Zeile 2064, dann der Footer formuliert — sonst hätte der Footer einen
Stand behauptet, den die Tabelle noch nicht hatte.

**Format gewahrt:** Semikolon-getrennte Kette, `Zuvor: …`-Historie **vollständig erhalten und nicht
abgeschnitten** — die Kette wuchs von **26** auf **36** `Zuvor:`-Glieder (10 neue, davon eines die bisherige
Kopf-Beschreibung, die jetzt als `Zuvor: 2026-07-28 06:15 — …` weiterläuft); das Schluss-`*` und der
letzte Kettenpunkt (`… Suite 1992 grün; Verdrahtung/Slice B/TL-12 bleiben gated.*`) sind unverändert.
Die Datumsangaben der Kettenglieder folgen der **COMPLIANCE-Zeilen-Konvention** (nicht der Merge-Zeit) —
so, wie es die bestehenden Glieder tun; für #350 existiert keine Zeile, dort steht deshalb ausdrücklich
`(ohne COMPLIANCE-Zeile, Merge 2026-07-29T04:36:20Z)` statt eines abgeleiteten Datums.

## Dabei gefunden, bewusst NICHT in diesem Slice gefixt

Zwei echte Lücken, beide **ausserhalb des freigegebenen Scopes** — als eigener Slice vermerkt statt
stillschweigend mitgenommen:

- **#350 hat überhaupt keine COMPLIANCE-Zeile** (`grep -cE '^\| #350 \|'` → **0**) und auch **keinen
  `CHANGES.md`-Eintrag**. Das ist kein stale Status, sondern eine **fehlende Zeile** — ein anderer Fehlertyp
  als dieser Nachtrag, und das Nachtragen einer vollständigen 10-Spalten-Zeile für eine fremde PR wäre
  Rekonstruktion, nicht Hygiene.
- **Drei `CHANGES.md`-Überschriften ohne `, #NNN)`-Suffix** (Zeilennummern = `main`-Stand vor diesem Diff;
  nach dem Einschub des neuen `CHANGES.md`-Eintrags `:224`/`:139`/`:100`): `:202` = #351
  (G1-Entscheidungs-Brief), `:117` = #354 (D2-pathLen-Blocker), `:78` = #355 (Runbook-Volltext). Die zugehörigen COMPLIANCE-Zeilen wurden in #356 gehoben, die CHANGES-Überschriften
  dabei nicht — die Hebung war damals auf die Tabelle beschränkt.

## Was sonst bewusst NICHT angefasst wurde

- **Die 43 übrigen `(offen, base=main)`-Zeilen:** nicht PR-nummeriert (Erst-Spalte `v0.34.x`/`ADR-033`/
  `tl07-seam`/`drift` …, alle älter als #296, aus der Zeit vor der PR-Nummern-Konvention) ⇒ anderer Slice.
  Nach diesem PR: **0** `(offen, base=main)`-Zeilen **mit PR-Bezug** ausser der eigenen.
- **Kein Textumbau** an der #357-Zeile oder an irgendeiner anderen Tabellenzeile.
- **Nicht berührt:** `TODO.md` (dort steht nichts Falsches zu diesem Slice), TL-08/09/10, TL-14 (bleibt
  C1-gated), ADR-046 §9, `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`,
  `packages/daemon/scripts/discovery-poc.ts`, der `.55`-c/k-Widerspruch, Re-Enroll / `.94`-Admin-Token
  (Christian-Gate, TH01-Daemon weiter in Crash-Loop). Keine `HISTORY.md` (existiert bewusst nicht,
  `CONTRIBUTING.md:34-36`).

## Tests
**Kein `.ts`-Diff ⇒ Suite nicht betroffen**, kein Verhaltens-Delta. Statt Tests die `gh`-Verifikation, live
gelesen statt aus dem Dispatch übernommen:

| Prüfung | Ergebnis |
|---|---|
| Alle zehn PRs #348…#357 `gh pr view --json state,mergedAt,mergeCommit` | ✅ alle `MERGED`, Commits wie in der Tabelle oben |
| `#357` Status-Spalte gehoben | ✅ Zeilen mit PR-Nummer **und** `(offen, base=main)`: **0** ausser der eigenen #358-Zeile |
| Spalten-/Pipe-Zahl der #357-Zeile vor/nach | ✅ je 11 unescaped Pipes = 10 Spalten |
| `Zuvor:`-Kette nicht abgeschnitten | ✅ 26 → 36 Glieder, Schluss-Satz und `*` identisch |
| Zeilenzahl der Datei | ✅ Footer-Neufassung bleibt **eine** Zeile (kein Zuwachs); 2068 → **2069** allein durch die eigene #358-Zeile |

## Precommit (manuell)
`pal:precommit` ist weiter am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen, Secret-Scan
clean (**nur Markdown**), kein Code/Config/Deploy/State, keine Datei ausserhalb von
`COMPLIANCE-TABLE.md` / `CHANGES.md` / `changes/`.
