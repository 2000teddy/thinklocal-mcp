# changes/2026-07-13 — docs: COMPLIANCE-/CHANGES-PR-Felder auf Realzustand (Reconcile-Nachtrag)

**Typ:** Doc-only (kein Code, kein Deploy).
**Auslöser:** Reconcile-Wächter 2026-07-13 03:34 — die COMPLIANCE-Tabellen-Zeilen der bereits
gemergten ADR-035-A-Reihe standen noch als `(offen, base=main)` bzw. ohne `(merged)`-Marker.

## Was
- **`COMPLIANCE-TABLE.md`:** PR-Feld der gemergten Slices auf den echten Zustand gezogen:
  - `adr035-a3` → **#257 (merged)**
  - `adr035-a4a` → **#258 (merged)** (vorher `#258 (offen, base=main)`)
  - `adr035-a1` → **#259 (merged)**
  - `adr035-a2` → **#260 (merged)**
  - `adr035-a4b` → **#261 (merged)**
  (Alle fünf PRs sind in `main`: #257 1aecf97-Reihe … #261 Merge 41bf984.)
- **`CHANGES.md`:** beim A4b-Eintrag den PR-Bezug **`PR #261`** explizit in die Überschrift gesetzt,
  damit der Reconcile-Wächter den Eintrag der PR-Nummer zuordnet.
- **`changes/2026-07-13_docs-compliance-pr-reconcile.md`** (diese Datei) + eine eigene
  COMPLIANCE-Sweep-Zeile für diesen Doc-only-Nachtrag.

## Abgrenzung
Reiner Doku-Realabgleich — keine inhaltliche Änderung an den dokumentierten Slices, kein Code, keine
Config, kein Deploy. Ältere, nicht-ADR-035-Zeilen mit `(offen, base=main)` sind **nicht** Teil dieses
Nachtrags (nur die vom Wächter benannten #257–#261).

## Status
Offen (Doc-only-PR gegen main).
