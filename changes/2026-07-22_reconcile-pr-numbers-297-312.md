# changes/2026-07-22 — docs(reconcile): PR-Nummern-Nachtrag COMPLIANCE + CHANGES + TODO-Cursor (#297–#312)

**Typ:** **Doc-only** Bookkeeping-Reconcile (kein Code/Test/Design). Hermes-Housekeeping nach den Merges
vom 2026-07-20/21. **Keine** inhaltliche Änderung an bestehenden Einträgen — nur die nach dem Merge fällige
PR-Nummer-Annotation (Placeholder → verifizierte Merge-Nummer). Kein Deploy/Secret/Cross-Host.

## Befund
Seit dem letzten Reconcile (#296 deckte #288–#295 ab) sind **#297–#312** gemergt, aber ihre Bookkeeping-
Einträge trugen noch den Vor-Merge-Zustand:
- **COMPLIANCE-TABLE.md:** 16 Zeilen mit Erst-Spalte `(offen, base=main)` statt der Merge-Nummer.
- **CHANGES.md:** 16 Überschriften ohne `#NNN`-Marker (plus die Selbst-Referenz von #296).
- **TODO.md:** höchste PR-Ref hing bei **#299** (13 hinter #312).

## Was
- **COMPLIANCE-TABLE.md:** je Zeile `| (offen, base=main) | <ts> |` → `| #NNN | (base=main, gemergt) | <ts> |`
  für **#297–#312** (16 Zeilen; 9→10 Spalten, Format wie die #288–#295-Zeilen). Zusätzlich #296 Col-2
  `(offen…)` → `(base=main, gemergt)` (Selbst-Referenz nachgezogen). **Jede Zuordnung inhaltlich gegen den
  PR-Titel verifiziert** (`gh pr list --state merged`, Ts+Topic-Match — z.B. #297 B-Monitor, #298
  chain-verify, #299 A2-Rewire, #300 TL-10 Slice A, …, #312 Tool-Skelett).
- **CHANGES.md:** 17 Überschriften um `, #NNN)` im Datums-Klammerausdruck ergänzt (Format wie
  `(…, #295)`), #296–#312.
- **TODO.md:** 9 gemergte Slice-Einträge (`Slice 3/4/5/6`, TL-14a `A`/`A2`/`B`/`D2`/Cross-Vendor) um
  `(…, #NNN)` annotiert → höchste PR-Ref rückt auf **#312**.

## Verifikation
- Alle 16 Anker (Timestamp der stale Zeile) waren **eindeutig** (genau 1 Treffer) vor der Ersetzung.
- Spaltenzahl der reconcilten Zeilen = Referenz-Zeile #292 (11 Pipes; #302 hat 12 wegen eines
  **pre-existing escaped** `\|` im Code-Span `tlgate:approve\|reject` — rendert korrekt).
- Diff ist rein 1:1 in-place (43 ins / 43 del) + additive Selbst-Doku; keine Struktur-/Inhaltsänderung.
- `gh`-verifiziert: #297–#312 alle `state=MERGED`.

## Compliance
- **CO/CG/TS:** entfällt — Doc-only-Reconcile (Ausnahme wie #84/#286/#296), kein Code/Test/Design-Diff.
- **CR:** Self-CR — jede PR↔Zeile-Zuordnung gegen den gemergten PR-Titel/-Timestamp gegengeprüft, keine
  erfundene Nummer.
- **PC:** Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
