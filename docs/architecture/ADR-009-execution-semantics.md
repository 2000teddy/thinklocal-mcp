# ADR-009: Execution Semantics (kondensiert)

**Status:** Implemented (Phase C, 2026-04-10)
**Datum:** 2026-04-10
**Autoren:** Claude Code, Multi-Modell-Konsensus
**Verwandt:** ADR-010 (Codex, Leitplanke), ADR-011 (Codex, Leitplanke)
**Kondensiert aus:** Codex ADR-009 bis ADR-014 (6 explorative ADRs → 2 PRs)

## Kontext

Codex hat 6 ADRs (009-014) als explorative Architektur-Analyse geschrieben.
Diese wurden im Multi-Modell-Konsensus (GPT-5.1, Gemini-Pro, Claude Opus)
auf 2 konkrete PRs kondensiert. Die Kodensierung verliert keine Architektur-
Strenge — sie eliminiert Redundanz. Die Original-ADRs bleiben als Leitplanke
in `/Volumes/Dropbox/Dropbox/Entwicklung/_AI/paperclip/` erhalten.

## Entscheidungen

### 1. Execution-ID + Lifecycle State (PR #102)

Jede verteilte Aktion (Task-Request, Skill-Execution, Message-Reply) bekommt
eine eindeutige `execution_id` + einen 5-State Lifecycle:

```
accepted → running → completed | failed | aborted
```

- Transport-Retries behalten dieselbe `execution_id` (idempotent).
- Bewusste Neuversuche bekommen eine neue ID.
- Atomarer WHERE-Guard im UPDATE verhindert TOCTOU-Races.

### 2. Goal-Context auf Sessions (PR #103)

SessionState bekommt 4 optionale Felder:

```typescript
goal?: string;              // "Implementiere ADR-007 Phase A"
expectedOutcome?: string;   // "3 PRs gemerged, Tests gruen"
blockingReason?: string;    // "Warte auf CR-Ergebnis"
nextAction?: string;        // "Findings fixen, dann PC"
```

Der Recovery-Generator rendert daraus eine neue `## Goal & Status` Sektion
in HISTORY.md, damit der naechste Agent nicht nur "was passiert ist" sieht,
sondern "wozu und was als naechstes".

## Architekturprinzipien (uebernommen aus Codex ADR-009)

1. Keine privilegierte verteilte Aktion ohne explizite Ausfuehrungssemantik.
2. Recovery ist eine Primaerfunktion, kein Komfort-Feature.
3. Capabilities sind dynamisch, aber nie implizit.
4. Governance passiert lokal vor der Ausfuehrung.
5. Kryptografische Wahrheit zuerst, menschenlesbare Sichten danach.
6. Session-State muss Zweck transportieren, nicht nur Verlauf.
7. Keine zentrale SaaS-Semantik in den Mesh-Kern importieren.

## Retroaktiver CR-Befund

**1× HIGH:** TOCTOU Race in `execution-state.ts` transition().
Die Methode las den aktuellen State, validierte die Transition, und
fuehrte dann das UPDATE ohne WHERE-Guard aus. Zwischen Read und Write
konnte ein anderer Caller den State aendern. Fix: `AND lifecycle_state = ?`
im UPDATE (atomarer Guard). 13 bestehende Tests gruen nach Fix.
