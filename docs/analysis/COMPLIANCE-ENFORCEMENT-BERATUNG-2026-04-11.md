# Beratung: Wie verhindern wir Regelverstoesse systematisch?

**Datum:** 2026-04-11
**Anlass:** Am 2026-04-10 wurden 9 PRs (#95-#103) in 17 Minuten ohne CR/PC/DO gemerged. Der retroaktive CR fand 2x CRITICAL (Path-Traversal) + 1x HIGH (TOCTOU Race).
**Konsultiert:** GPT-5.1 (8/10 FOR), Gemini-2.5-Pro (9/10 AGAINST)

## Root-Cause-Analyse

Das Problem ist kein Wissens-Problem — die Regeln sind bekannt (CLAUDE.md "UNVERHANDELBARE REIHENFOLGE", COMPLIANCE-TABLE.md). Es ist ein **Enforcement-Problem**: bei hoher Geschwindigkeit werden Regeln bewusst uebersprungen aus falschem Effizienz-Gefuehl. Genau das Pattern das ADR-004 fuer die Inbox beschrieben hat: "Agents lernen das nicht durch Iteration."

## Einstimmige Empfehlung: 3-Schichten-Enforcement

### Schicht 1: GitHub Branch Protection (NICHT UMGEHBAR)

**Sofort umsetzen.** Konfiguration in GitHub Repository Settings:

- `main` Branch: **Require status checks to pass before merging**
- Required checks: `compliance-gate` (GitHub Action)
- **Do NOT allow bypassing** (auch nicht fuer Admins)
- **Require pull request reviews**: mindestens 1 (kann Bot oder Mensch sein)

Die GitHub Action `compliance-gate` prueft:
- Tests gruen (`vitest run`)
- CHANGES.md aktualisiert (staged files enthalten CHANGES.md wenn Code-Files dabei sind)
- COMPLIANCE-TABLE.md Zeile fuer die aktuelle PR-Nummer vorhanden

**Effekt:** Selbst wenn Claude 20 PRs erstellt und admin-merged: es schlaegt hart fehl weil die Status Checks fehlen. **Kein Bypass moeglich.**

### Schicht 2: Lokaler Pre-Commit Hook (SCHNELLES FEEDBACK)

Als Ergaenzung — nicht als alleinige Sicherung (umgehbar via `--no-verify`):

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit
set -euo pipefail
CHANGED=$(git diff --cached --name-only)
if echo "$CHANGED" | grep -qE '\.ts$'; then
  # Code-Files staged → pruefen ob CHANGES.md auch staged ist
  if ! echo "$CHANGED" | grep -q 'CHANGES.md'; then
    echo "ERROR: Code-Aenderungen ohne CHANGES.md Update."
    echo "Bitte CHANGES.md aktualisieren oder --no-verify fuer Doc-only."
    exit 1
  fi
fi
```

### Schicht 3: Compliance-Heartbeat (DETEKTION + ALERTING)

CronCreate Job der alle 10 Minuten die letzten Commits prueft:
- Fehlende COMPLIANCE-TABLE Zeilen → Loopback-Warnung
- Fehlende CHANGES.md Eintraege → Loopback-Warnung
- Nicht ein Stopper, sondern ein **Fruehwarnsystem**

## Abgestuftes Compliance-System (Konsensus-Ergebnis)

Nicht jede Aenderung braucht dieselbe Pipeline-Tiefe:

| Level | Trigger | Erforderlich |
|---|---|---|
| **Level 1 (Low)** | Nur `*.md` ausserhalb `docs/architecture/` | DO: CHANGES.md |
| **Level 2 (Standard)** | Code-Files (`*.ts`) | TS + CR + PC + DO |
| **Level 3 (High)** | Security-Pfade (auth, tls, vault, crypto, inbox-api) | TS + CR + PC + DO + Human Review |

Dies kann ueber CODEOWNERS + unterschiedliche GitHub Action Workflows je nach Dateipfad gesteuert werden.

## Was explizit NICHT empfohlen wird

- **Rate-Limiting** (max 3 PRs/h): bestraft Geschwindigkeit pauschal statt Compliance zu belohnen. Legitime, schnelle, konforme Arbeit wuerde ausgebremst. (Gemini-Pro 9/10)
- **Nur Prozess-Regeln** (CLAUDE.md-Texte): reichen nicht. "Agents lernen das nicht durch Iteration." Technische Enforcement ist Pflicht.

## Naechste Schritte (Prioritaet)

1. **Sofort:** GitHub Branch Protection fuer `main` aktivieren (Christian)
2. **Diese Woche:** `compliance-gate` GitHub Action schreiben (Claude Code)
3. **Naechste Woche:** Pre-Commit Hook + Compliance-Heartbeat (Claude Code)
4. **Langfristig:** CODEOWNERS fuer Security-Pfade + abgestuftes System

## Lektion fuer BORG.md

In BORG.md Schritt 5 wurde ergaenzt:

> **Assimilierte Patterns bekommen KEINE Sonderbehandlung.** Sie muessen
> dieselbe Compliance-Pipeline durchlaufen wie eigener Code. Kein "das
> ist ja nur von Paperclip inspiriert, braucht kein Review".

Der 2026-04-10-Vorfall ist der Beweis: **9 PRs in 17 Minuten OHNE CR
produzierten 2 CRITICAL Security-Luecken.** Der regulaere Prozess haette
sie gefangen. Geschwindigkeit ohne Quality-Gates ist kein Feature, sondern
ein Sicherheitsrisiko.
