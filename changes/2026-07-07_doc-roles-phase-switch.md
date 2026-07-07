# changes/2026-07-07 — docs(governance): Doku-Rollen festschreiben + Phasen-Schalter streichen

**Typ:** Doc-only (CONTRIBUTING.md, CLAUDE.md). Kein Code, kein Verhalten.
**Auftrag:** Christian/Hermes MD-Pflege-Audit, Punkte 3 (Phasen-Schalter) + 4 (Rollen).

## Warum
Das Audit legte offen: „Doku, die dem einzelnen PR dient, wird gepflegt; Doku, die Zustand über PRs führt,
franst aus." Ursache u. a. der **Phasen-Schalter** — COMPLIANCE-Pflicht an „ab Phase 2" gekoppelt, aber
niemand ruft den Phasenübergang aus. Beschluss: Rollen festschreiben, Schalter streichen, COMPLIANCE immer
Pflicht.

## Was
- **CONTRIBUTING.md:** neuer Abschnitt „Doku-Kanon & Compliance-Pflicht (verbindlich)" mit der 5-Datei-
  Rollentabelle (`changes/` je PR · `CHANGES.md` technische Historie · `HISTORY.md` Agenten-Erzählung ·
  `COMPLIANCE-TABLE.md` immer Pflicht · `TODO.md` Backlog+Fortschritt), Leser/Takt/Durchsetzung je Datei,
  Verweis auf das kommende Ebene-1-CI-Gate (2 Wochen warnend → blockierend).
- **Phasen-Schalter gestrichen:** ausdrücklich festgehalten, dass COMPLIANCE für JEDEN PR gilt und die
  „Phase 1/2"-Überschriften in COMPLIANCE-TABLE.md nur chronologische Gruppierung sind (kein Gate). In
  thinklocal existierte die Kopplung nie als Regel — dokumentiert, damit sie auch nicht entsteht.
- **`changes/`-vs-`TODO.md`-Rolle festgeschrieben:** `changes/` = Fortschritts-Log je PR, `TODO.md` =
  Backlog+Fortschritt (die stillschweigende Umwidmung ist jetzt Norm, nicht „veraltet").
- **`HISTORY.md`:** Rolle vorab festgeschrieben; in thinklocal läuft die Erzählung derzeit über ADRs +
  `changes/`; separate Datei bei Bedarf zum nächsten Meilenstein (keine leere Datei erfunden).
- **CLAUDE.md:** Ein-Zeilen-Hinweis „COMPLIANCE für JEDEN PR, kein Phasen-Vorbehalt" + Verweis auf den
  CONTRIBUTING-Abschnitt.

## Tests / Verifikation
Doc-only → keine Unit-Tests. PC: `git diff` — nur `CONTRIBUTING.md`/`CLAUDE.md`/`changes/`/COMPLIANCE/CHANGES.

## Status
Offen (PR gegen main). Teil des KW28/29-Durchsetzungs-Sweeps: Altlasten (SECURITY #248) erledigt; das
Ebene-1-CI-Gate, das diese Rollen erzwingt, folgt als eigener PR.
