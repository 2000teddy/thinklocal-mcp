# BORG.md — Assimilations-Anleitung fuer fremden Source-Code

> "Wir sind die Borg. Widerstand ist zwecklos.
> Ihr biologischen und technologischen Eigenarten werden
> den unsrigen hinzugefuegt." — Star Trek TNG

**Zweck:** Diese Datei beschreibt den verbindlichen Prozess, wie thinklocal-mcp
nuetzliche Ideen, Patterns und Architektur-Prinzipien aus fremden Projekten
**assimiliert** — ohne die eigene Identitaet zu verlieren.

**Erste Anwendung:** Paperclip (2026-04-10)
**Autoren:** Claude Code (Chefentwickler), Multi-Modell-Konsensus (GPT-5.1, Gemini-2.5-Pro, Claude Opus 4.6)

---

## 1. Grundregel: Assimiliere Prinzipien, nicht Code

Das Ziel ist **nicht**, fremden Code zu kopieren, zu forken oder als Basis-
Framework zu benutzen. Das Ziel ist:

1. **Gute Regeln identifizieren** — was macht das andere Projekt richtig?
2. **Auf eigene Primitive mappen** — wie uebersetzen sich deren Konzepte
   in unsere Welt (Peer, Agent, Capability, Trust, Session)?
3. **Gezielt implementieren** — kleiner PR, eigene Tests, eigene Doku.

**Anti-Pattern:** "Lass uns deren `approvals.ts` kopieren und anpassen."
**Richtig:** "Paperclip hat ein Approval-Gate-Pattern. Wir bauen unser
eigenes in `pairing-handler.ts`, inspiriert von deren Semantik."

---

## 2. Der 6-Schritt Assimilations-Prozess

### Schritt 1: Quell-Projekt analysieren (1-2 Stunden)

**Wer:** Mindestens 2 verschiedene AI-Modelle + optional ein Mensch.

**Wie:**
- README, Architektur-Docs, Schema-Definitionen lesen
- Kernmodule identifizieren (max 20 Dateien tief)
- Tech-Stack und Design-Entscheidungen notieren

**Deliverable:** `docs/analysis/PROJEKT-ANALYSIS-YYYY-MM-DD.md`

**Regel:** Analyse immer mit mindestens 2 Modellen (PAL consensus oder
separate Analysen), um Bias zu reduzieren. Einzelne Modelle uebersehen
systematisch bestimmte Aspekte.

### Schritt 2: Relevanz-Filter (30 Minuten)

Fuer jedes identifizierte Pattern drei Fragen beantworten:

| Frage | Antwort |
|-------|---------|
| Loest es ein Problem das wir **heute haben**? | ja / nein / spaeter |
| Passt es zu unseren Primitiven (Peer/Agent/Trust/Mesh)? | ja / nein / braucht Adaption |
| Ist es **einfacher** als das was wir schon haben? | ja / nein / gleichwertig |

**Regel:** Nur Patterns die mindestens 2x "ja" bekommen, kommen in den Fahrplan.
Alles andere wird als "beobachtet, nicht uebernommen" dokumentiert.

### Schritt 3: Multi-Modell-Konsensus (1 Stunde)

**Wer:** PAL consensus mit mindestens 3 Modellen (FOR, AGAINST, NEUTRAL).

**Was wird gefragt:**
- Ist die Reihenfolge der Uebernahme korrekt?
- Geht bei der Vereinfachung etwas Kritisches verloren?
- Was fehlt im Uebernahmeplan?

**Deliverable:** Konsensus-Ergebnis mit konkreten Anpassungen am Fahrplan.

**Regel:** AGAINST-Stimme ist **Pflicht**. Ohne Gegenargument kein Konsensus.
Die AGAINST-Stimme deckt Risiken auf die der Enthusiasmus uebersieht.

### Schritt 4: Fahrplan mit konkreten PRs (30 Minuten)

Jedes uebernommene Pattern wird **einem konkreten PR zugeordnet**:

- PR-Nummer (oder Platzhalter)
- Betroffene Dateien
- Geschaetzter Aufwand
- Abhaengigkeiten zu anderen PRs
- Explizite "v1-Vereinfachung"-Markierung wo zutreffend

**Regel:** Kein Pattern ohne PR. Kein PR ohne Tests. Kein Test ohne Spec.

### Schritt 5: Implementierung nach CLAUDE.md Compliance-Pipeline

Fuer jeden PR die volle Pipeline:

```
CG (falls noetig) → Code → TS (Tests) → CR → PC → Commit → DO → PR → Merge
```

**Regel:** Assimilierte Patterns bekommen **keine Sonderbehandlung**. Sie
muessen dieselbe Compliance-Pipeline durchlaufen wie eigener Code. Kein
"das ist ja nur von Paperclip kopiert, braucht kein Review".

### Schritt 6: Rueckblick nach Abschluss einer Phase (15 Minuten)

Nach jeder abgeschlossenen Phase (3-5 PRs):

- Hat die Uebernahme das Problem geloest das wir hatten?
- Haben wir uns verzettelt?
- Stimmt die Reihenfolge fuer die naechste Phase noch?
- Sind neue Erkenntnisse aufgetaucht die den Fahrplan aendern?

**Deliverable:** Kurzer Eintrag in CHANGES.md.

---

## 3. Was wir NICHT assimilieren

Explizite Grenzen die bei jeder Uebernahme gelten:

| Nicht uebernehmen | Warum |
|--------------------|-------|
| Zentrale Control-Plane-Semantik | thinklocal ist dezentral |
| Company/Board/Issue-Modell | Unsere Primitive sind Peer/Agent/Capability/Trust |
| Embedded Postgres | SQLite WAL ist leichter und offline-faehig |
| Bearer-Token-Auth | mTLS + SPIFFE-URIs sind staerker |
| Multi-Tenant-Isolation | Trust Domains + Node/Agent Scoping reichen |
| Produktspezifische UI-Logik | Unsere UI hat andere Anforderungen |

**Regel:** Wenn ein Pattern eines dieser Elemente implizit einfuehrt,
muss es explizit in unsere Primitive uebersetzt werden — oder es wird
nicht uebernommen.

---

## 4. Qualitaets-Checks waehrend der Assimilation

### Check 1: Vendor-Lock vermeiden

Kein assimiliertes Pattern darf an einen bestimmten AI-Agent-Typ gebunden
sein. Skills, Capabilities und Manifests muessen agent-neutral sein.
Agent-spezifische Adapter (Claude Code, Codex, Gemini) sind separate
Module die auf dem neutralen Format aufbauen.

### Check 2: State-Explosion vermeiden

In einem dezentralen Mesh multipliziert jeder zusaetzliche State die
Synchronisations-Komplexitaet. Faustregel: maximal 4-5 States fuer jedes
neue Zustandsmodell in v1. Die volle Taxonomie wird als Referenz
dokumentiert, aber nur implementiert wenn noetig.

### Check 3: Leichtigkeit bewahren (ioBroker-Moment)

Jede neue Governance- oder Lifecycle-Schicht muss die Frage beantworten:
"Macht das den ioBroker-Moment kaputt?" Der ioBroker-Moment ist:

> "Ich habe diese Peers gefunden. Sie koennen X, Y, Z.
> Moechtest du diese Faehigkeiten nutzen?"

Wenn ein Pattern dazu fuehrt, dass der User 3 Approval-Gates durchlaufen
muss bevor er eine entdeckte Faehigkeit nutzen kann, ist es **zu schwer**
fuer den Default-Pfad. Approvals sind fuer sensitive Operationen, nicht
fuer normalen Mesh-Betrieb.

### Check 4: Kein zweiter Wahrheits-Stack

Jedes assimilierte Feature muss mit der bestehenden Single-Source-of-Truth
kompatibel sein:
- Audit-Log (Ed25519 + Merkle-Chain) bleibt kanonisch
- Session-Events (SQLite WAL) bleiben kanonisch
- CRDT-Capability-Registry bleibt kanonisch fuer Mesh-Sichtbarkeit
- Alles andere ist derived view

---

## 5. Dokumentations-Pflichten

Fuer jede Assimilation muessen folgende Dokumente existieren oder
aktualisiert werden:

| Dokument | Inhalt |
|----------|--------|
| `docs/analysis/PROJEKT-ANALYSIS-*.md` | Quell-Analyse |
| `BORG.md` (diese Datei) | Prozess-Referenz |
| `docs/ROADMAP-POST-*.md` | Fahrplan mit PRs |
| ADR-Dateien | Formelle Architektur-Entscheidungen fuer jede Phase |
| `CHANGES.md` | Jeder PR hat einen Eintrag |
| `COMPLIANCE-TABLE.md` | Jeder PR hat eine Zeile |

---

## 6. Erfolgs-Kriterien fuer eine gelungene Assimilation

Eine Assimilation ist erfolgreich wenn:

1. Das identifizierte Problem ist geloest
2. Die Loesung ist in eigenen Tests verifiziert
3. Kein zentraler Fremd-Code im Repository
4. Die dezentrale Mesh-Architektur ist intakt
5. Der ioBroker-Moment ist nicht kaputt
6. Ein neuer Agent kann in < 30s verstehen was passiert ist
   (via HISTORY.md + CHANGES.md)

---

## 7. Bisherige Assimilationen

| Quelle | Datum | Prinzipien | Status |
|--------|-------|------------|--------|
| **Paperclip** | 2026-04-10 | Activity-Log Entity-Model, Config-Revisions, Approval-Gates, Dynamic Capabilities, Execution Semantics, Goal-Context | Fahrplan erstellt, Phase A-D definiert |

---

*"Wir fuegen ihre biologischen und technologischen Eigenarten den unsrigen
hinzu. Ihre Kultur wird sich anpassen und uns dienen."*

*Uebersetzt: Gute Ideen werden uebernommen und in unsere dezentrale,
Security-first, Local-first Architektur integriert. Schlechte Ideen
werden zurueckgelassen. Der Borg-Kubus fliegt weiter.*
