# changes/2026-07-26 — docs(reconcile): #339-Nachtrag + TODO-PR-Nummern-Aufholung (#331 → #339)

**Typ:** **Doc-only** Post-Merge-Reconcile + Doku-Hygiene. Kein Code/Test/Design, kein Gate verschoben, kein
Deploy/Secret/Host. Nimmt **keine** offene §9/ADR-046/TL-12-Gate-Antwort vorweg.

## Die Drift
Zwei zusammenhängende Lücken nach der PR-Serie #331–#339:
1. **#339 selbst** (der Reconcile für #336–#338) konnte seine **eigene** Merge-Nummer beim Schreiben nicht
   kennen ⇒ COMPLIANCE-Erst-Spalte `(offen, base=main)`, CHANGES-Überschrift ohne `#339`-Marker.
2. **`TODO.md` hing >5 PRs zurück:** die abgeschlossenen Slices von #331 bis #338 waren mit Datum, aber
   **ohne** Merge-PR-Nummer notiert (eine PR kennt ihre Nummer beim Schreiben nicht; der Nachtrag blieb
   liegen). `COMPLIANCE-TABLE.md`/`CHANGES.md` trugen die Nummern bereits (per Reconcile-Serie), `TODO.md`
   nicht — die drei Doku-Kanon-Dateien waren also gegeneinander driftend.

## Was (1:1 in-place, `gh`-verifiziert)
- **COMPLIANCE-TABLE.md:** #339-Erst-Spalte `(offen, base=main)` → `#339` + `(base=main, gemergt)`.
- **CHANGES.md:** #339-Überschrift `(2026-07-25 14:03)` → `(2026-07-25 14:03, #339)`.
- **TODO.md — PR-Nummern nachgezogen** (Datum → Datum + `#NNN`), Bezug #331 → #339:
  | Eintrag | PR |
  |---|---|
  | TL-11 konsumentenseitiger Wake-Kern | **#331** |
  | TL-11 Emit→Decision-Brücke | **#333** |
  | TL-11 §6-Referenz an getestete Primitive gebunden | **#334** |
  | TL-12 S5 Read-Surface-Härtung am HTTP-Rand | **#335** |
  | TL-10 Slice-A #300/#319-Altlasten erledigt | **#337** |
  | TL-10 D1-TOML-Loader-Prep gebaut | **#338** |

  (Die reinen Reconcile-PRs #332/#336/#339 haben keinen eigenen TODO-Eintrag.) Danach spiegeln COMPLIANCE,
  CHANGES und TODO dieselben PR-Nummern für #331–#338.

Danach **0** stale `(offen, base=main)`-Erst-Spalten mit PR-Bezug außer der Erst-Spalte **dieses** PRs.

## Compliance
- **CO/CG/TS:** entfallen — kein Code/Test/Design-Diff, reine Doku-Hygiene; `clink`/`gemini` nicht im PATH.
  Suite unverändert **2087 grün** (147 Files; kein `.ts`-Diff).
- **CR:** externes Review am PR (Bot-Pfad) + Self-CR (Erst-Spalten-Split + Überschriften-/TODO-Marker gegen
  `gh pr view` abgeglichen).
- **PC:** Secret-Scan clean (nur Doku).
- **DO ✅:** dieser Eintrag, `COMPLIANCE-TABLE.md`, `CHANGES.md`, `TODO.md`.

**Unverändert gated/liegen gelassen:** ADR-046 §9, msg 1453 (Ball bei Christian), TL-10 Slice B, TL-12
S6/Slice B/C, TL-11 Slice B — **nicht** berührt. Risiko-Delta **null**.
