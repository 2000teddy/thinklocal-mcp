# changes/2026-07-18 — docs(reconcile): PR-Nummern-Cursor in TODO/CHANGES nachgezogen (#281–#284)

**Typ:** Doc-only (Doku-Hygiene / Reconcile-Cursor). **Kein** Code/Runtime-Change, **kein** Deploy/Secret/Gate.

## Warum
Der deterministische Reconcile-Wächter (Hermes, read-only, `2026-07-18 03:32`,
`reports/reconcile-drift-2026-07-18-0332.md`) meldete für thinklocal-mcp Doku-Drift gegen `main`:
- **TODO.md** referenzierte als höchste PR nur **#277** → Cursor 7 hinter dem letzten Merge #284.
- **CHANGES.md**-Eintrag zu #284 ohne literalen „#284"-Marker.

Live verifiziert (2026-07-18 06:04): die Einträge der gemergten Slices #281–#284 **existierten**, trugen
aber **keine PR-Nummer** → der Cursor las sie als stale. `COMPLIANCE-TABLE.md` war bereits aktuell
(letzte Zeile #284) — dort **keine** Drift.

## Was
PR-Nummern an die **bestehenden** Einträge annotiert (kein neuer Inhalt, keine Umformulierung):
- **TODO.md:** TL-21 Slice 1 → `#281`; TL-11 Wire-Conformance-Scaffold → `#282`; TL-11 cert-fixture Slice →
  `#283`; KW29 Bug-Pfad 2 → `#284`.
- **CHANGES.md:** die vier zugehörigen Eintrags-Header analog mit `#281`…`#284` gestempelt.

Jede Zuordnung gegen den **echten Merge-Commit** verifiziert (`git log origin/main`):
`#281`=830feed (TL-21 Skelett-Auskunft), `#282`=898802b (Draht-Ebenen-Scaffold), `#283`=94f24f7
(cert-fixture), `#284`=58c7df9 (Bug-Pfad 2 Beleg). Cursor rückt damit auf **#284** (= letzter Merge).

## Abgrenzung
Reine Doku-Hygiene; kein Verhalten geändert. #285 (TL-21 Slice 2) ist noch offen → bewusst NICHT annotiert.

## Compliance
- **CO/CG/TS:** entfallen — Doc-only, kein Code, keine Design-Frage.
- **CR:** Self-CR, **mechanisch** — jede der 8 Annotationen per `git log`/`grep` gegen ihren Merge-Commit
  gegengeprüft (kein Mis-Mapping). Kein externer Reviewer nötig für eine reine PR-Nummern-Annotation.
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
