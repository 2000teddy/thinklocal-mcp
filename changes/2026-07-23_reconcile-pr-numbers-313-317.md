# changes/2026-07-23 — docs(reconcile): PR-Nummern-Nachtrag COMPLIANCE + CHANGES + TODO (#313–#317)

**Typ:** **Doc-only** Bookkeeping-Reconcile (kein Code/Test/Design). Schließt den vom Reconcile-Wächter
gemeldeten Drift (`~/hermes/reports/reconcile-drift-2026-07-23-0333.md`) nach den 2026-07-22-Merges.
**Keine** inhaltliche Änderung an bestehenden Einträgen — nur die nach dem Merge fällige PR-Nummer-
Annotation (Placeholder → verifizierte Merge-Nummer). Kein Deploy/Secret/Cross-Host.

## Befund (Wächter-Bericht 2026-07-23 03:33)
- „Neue Merges seit #312: 5 (bis #317)" — `#317/#316/#314/#313 fehlt in COMPLIANCE-TABLE`,
  `CHANGES.md ohne Eintrag zu #317`.
- **#315 wurde vom Wächter NICHT gemeldet, war aber ebenfalls stale:** die Nummer kommt im Fließtext der
  #316-Zeile vor („CR-LOW aus #315-Review") und erfüllt damit die Substring-Prüfung des deterministischen
  Wächters, obwohl die #315-**Zeile** selbst noch `(offen, base=main)` trug. Hier mit-reconcilet
  (Wahrheit vor Report-Buchstaben).
- Effektiver Ist-Stand vor diesem PR: **5** COMPLIANCE-Zeilen mit Erst-Spalte `(offen, base=main)`
  (#313–#317), **5** CHANGES-Überschriften ohne `#NNN`-Marker, **4** gemergte TODO-Einträge ohne PR-Ref
  (höchste TODO-PR-Ref hing bei **#312**).

## Was
- **COMPLIANCE-TABLE.md (5 Zeilen):** `| (offen, base=main) | <ts> |` → `| #NNN | (base=main, gemergt) | <ts> |`
  (9→10 Spalten, Format wie #288–#312). Zuordnung über den eindeutigen Timestamp-Anker:
  06:05→**#313**, 06:20→**#314**, 08:30→**#315**, 09:45→**#316**, 10:45→**#317**.
- **COMPLIANCE-TABLE.md (18 weitere Zeilen, aus dem CR):** dieselbe Staleness eine **Spalte weiter** —
  Zeilen, deren **Erst**-Spalte die verifizierte Nummer schon trägt, deren **PR-Spalte** aber noch
  `(offen, base=main)` sagte: **#271, #272, #273, #277–#287** (14) sowie die vier älter formatierten
  Zeilen `#262`, `#229`, `#234`, `#235` (dort steht die Nummer *in* Spalte 2). Für den Wächter unsichtbar,
  weil die Nummer ja vorkommt (`PR #NNN fehlt` feuert nie). **Alle 18 einzeln `gh`-verifiziert `MERGED`**
  → `(base=main, gemergt)`. Die Reconcile-Ära begann faktisch erst bei #288.
- **CHANGES.md (5 Überschriften):** `, #NNN` im Datums-Klammerausdruck ergänzt (Format wie `(…, #312)`) —
  damit hat auch **#317** seinen nummerierten Eintrag (Wächter-Befund erledigt).
- **TODO.md (4 Einträge):** `Verdrahtungs-Hook` → `, #315`; `CR-LOW-Härtung` → `, #316` (die vorhandene
  `Post-#315-Review`-Referenz bleibt); `Ungegateter Consumer-Kern` → `, #314`; `D2-Prep
  (Kanal-Bindungs-Primitive)` → `, #317`. Höchste **Eintrags-Annotation** rückt **#312 → #317** (als
  bloßer *Substring* stand `#315` schon in der `Post-#315-Review`-Prosa — dieselbe Substring-Falle wie
  beim Wächter, hier nur der Präzision halber benannt).
  **#313 bekommt keinen TODO-Eintrag** — Doc-only-Housekeeping ohne Roadmap-Slice (Präzedenz #286/#296/#313).

## TODO-Wahrheit gegen den Merge-Stand (geprüft, keine Korrektur nötig)
- **TL-08 Slice 2c** bleibt korrekt `[~]`: Live-Drift-Check + Verdrahtungs-Hook + CR-LOW-Härtung `[x]`,
  **Gate-Flip (sensitive→allow-with-redaction) weiter `[ ]` ⛔ Christian-Gate** — nichts wurde durch
  #315/#316 mit-erledigt.
- **TL-10:** `D2-Prep` `[x]`, **Slice B** (Matrix-Wiring/Env-Flag/**D3-Sign-off**) weiter offen — die
  gemergte Primitive hat 0 Aufrufer, kein Runtime-Change; die Slice-B-Zeile nennt D2 bereits als „liegt vor".
- **TL-12 Prereq (ADR-046):** `Ungegateter Consumer-Kern` `[x]`, Platzierung/Vokabular/Semver/Producer
  weiter **CO-gated** — unverändert.
- Kein gemergter PR ist als offen, kein offener Punkt als erledigt markiert.

## Verifikation
- **Merge-Zustand live:** `gh pr list --state merged` → #313 (04:16Z) / #314 (04:34Z) / #315 (07:40Z) /
  #316 (08:04Z) / #317 (09:05Z), alle `MERGED`, Titel-/Topic-Match je Zeile geprüft.
- Alle 5 Anker (Timestamp der stale Zeile) waren **eindeutig** (genau 1 Treffer) vor der Ersetzung.
- **Die 18 Spalte-2-Zeilen einzeln geprüft:** `gh pr view <n>` → alle `MERGED`
  (#271/#272/#273/#277–#287 + #262/#229/#234/#235); die Erst-Spalte trug die Nummer bereits, geändert
  wurde ausschließlich der Zustandstext.
- Effektive Spaltenzahl (rohe Pipes minus escaped `\|`) der reconcilten Zeilen = Referenz-Zeile #312
  (11); die #313-Zeile hat 12 rohe / 1 escaped = **11 effektive**, weil ihr eigener Fließtext einen
  **pre-existing escaped** `\|` in einem Code-Span zitiert (identisch zur #302-Zeile).
- **Verbleibender Rest — bewusst NICHT hier gefixt (Folge-Hygiene, eigener PR):** **28** Zeilen aus der
  Vor-#271-Ära (Zeilen ~1226–1625, Erst-Spalte = Version/Label wie `v0.34.43`, `ADR-033`, `tl07-tier`)
  tragen ebenfalls `(offen, base=main)` — dort steht aber **gar keine PR-Nummer** in der Zeile. Die
  Auflösung Version→PR ist Archäologie, nicht mechanisch verifizierbar, und wäre in einem
  Drift-Fix-PR unbelegtes Raten. **Explizit benannt statt still gelassen.** Danach sind die einzigen
  `(offen, base=main)`-Erst-Spalten mit PR-Bezug 0 (außer der Zeile dieses PRs).
- Diff rein 1:1 in-place (14 Nummer-Annotationen + 18 Zustandstexte) + additive Selbst-Doku; keine
  Struktur-/Inhaltsänderung, keine Verdikt-/Häkchen-Änderung an einer Bestandszeile.

## Compliance
- **CO/CG/TS:** entfällt — Doc-only-Reconcile (Ausnahme wie #84/#286/#296/#313), kein Code/Test/Design-Diff.
  Verifikation über die CI-Checks am PR (inkl. Ebene-1 `Doc-Compliance-Gate`: `changes/`-Eintrag +
  COMPLIANCE-Zeile) statt der Unit-Suite — kein `.ts`-Diff, die Suite ist durch #317 unverändert **1932 grün**.
- **CR ✅:** adversariales Claude-Subagent (`agy`/`codex` nicht im PATH, `[[pal-review-backend-agy-missing]]`)
  — **kein HIGH**. Alle 14 Nummer-Zuordnungen unabhängig gegen `gh pr list --state merged` re-derived
  (Topic-Match, UTC↔CEST beachtet) → korrekt; Diff mechanisch als 1:1-in-place bestätigt (kein Verdikt/
  Häkchen/Timestamp verändert); Substring-Erklärung zu #315 gegen Wächter-Bericht **und**
  `git show main:COMPLIANCE-TABLE.md` verifiziert; TODO-Wahrheit (TL-08-Gate-Flip / TL-10 Slice B /
  ADR-046-Producer weiter gated) bestätigt; Suite 1932/139 nachgefahren; Secret-Scan 0 Treffer.
  **1 MEDIUM an der Wurzel gefixt:** „0 stale Zeilen" war für **Spalte 2** falsch → die 18 belegbaren
  Zeilen mit-reconcilet, der nicht mechanisch belegbare Vor-#271-Rest (28) **explizit benannt** statt
  weggelassen. 3 LOW ebenfalls adressiert: „höchste PR-Ref" → *Eintrags-Annotation* präzisiert,
  „rendert korrekt" durch die tatsächliche Pipe-Arithmetik ersetzt (der Block ab #278 hat keine
  Delimiter-Zeile — Prosa-Zeilen, vorbestehend), CR-Feld erst **nach** dem Review gesetzt.
  Zusätzlich Self-CR: jede PR↔Zeile-Zuordnung gegen PR-Titel/-Timestamp gegengeprüft, keine erfundene Nummer.
- **PC:** Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
