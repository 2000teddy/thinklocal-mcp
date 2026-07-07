# CONTRIBUTING.md — thinklocal-mcp

## Multi-Agenten-Entwicklungsrichtlinien

Dieses Projekt wird sowohl von Menschen als auch von AI-Agenten entwickelt. Deshalb gelten besondere Regeln zur Koordination.

## Doku-Kanon & Compliance-Pflicht (verbindlich, ab 2026-07-07)

> Aus Christians Beschluss `~/hermes/reference/2026-07-07_MD-Pflege-Audit-und-Durchsetzungssystem.md`.
> Grund: Doku, die dem **einzelnen PR** dient, wird gepflegt; Doku, die **Zustand über PRs** führt, franst
> aus. Deshalb sind die Rollen hier **festgeschrieben** und (Ebene 1) per CI erzwungen.

**Die fünf Doku-Dateien haben verschiedene Leser und Takte — sie sind KEINE Redundanz:**

| Datei | Leser | Inhalt | Takt | Durchsetzung |
|-------|-------|--------|------|--------------|
| `changes/<datum>_*.md` | Review/Audit | **je PR** ein granularer Eintrag (was, warum, Tests, Status) | **jeder PR** | CI-Wand (Ebene 1), blockierend¹ |
| `CHANGES.md` | Nutzer / Versionsstand | **technische** Programm-Historie, konsolidiert, versioniert | je PR/Release | CI-Wand¹ |
| `HISTORY.md` | die Agenten | **Erzählung fürs Team** — Kontext, Warum, Entscheidungen (Agentenwissen, das nicht als Anweisung in CLAUDE.md gehört) | fortlaufend, narrativ (nicht zwingend je PR) | Wächter (Ebene 2), soft |
| `COMPLIANCE-TABLE.md` | Prozess-Nachweis | wurde CO/CG/TS/CR/PC/DO je PR eingehalten | **jeder PR — IMMER Pflicht** | CI-Wand, blockierend¹ |
| `TODO.md` | nächste Arbeit | **Backlog + Fortschritt** (offene/erledigte Aufgaben) | fortlaufend | Wächter, soft (Sync-Drift wird gemeldet) |

¹ Ebene-1-CI-Gate: startet **2 Wochen warnend**, danach **blockierend** (required status check). Verlangt je
PR mindestens einen `changes/`-Eintrag **und** eine COMPLIANCE-Zeile — Ausnahme nur via Label `no-doc-needed`
(mit Begründung) oder Titel-Präfix `docs:`/`chore:`.

**Verbindliche Klarstellungen:**
- **COMPLIANCE-TABLE.md ist ab sofort für JEDEN PR Pflicht.** Der frühere „ab Phase 2"-Schalter ist
  **ersatzlos gestrichen** — er koppelte die Pflicht an eine Zustandsmarke, die niemand ausrief. (In
  thinklocal-mcp existierte diese Kopplung nie als Regel; die „Phase 1/2"-Überschriften in
  COMPLIANCE-TABLE.md sind rein **chronologische Gruppierung**, kein Gate.)
- **`changes/` ist das Fortschritts-Log je PR, `TODO.md` das Backlog.** thinklocal war stillschweigend
  dazu übergegangen — das ist jetzt die **festgeschriebene** Rolle, nicht „veraltet".
- **`CHANGES.md` vs. `HISTORY.md`:** CHANGES = technische Historie (Was/Version), HISTORY = Agenten-Erzählung
  (Warum/Kontext). In thinklocal-mcp wird die Erzählung derzeit in **ADRs + `changes/`** geführt; eine
  separate `HISTORY.md` wird bei Bedarf zum nächsten Meilenstein eingeführt (Rolle hier vorab festgeschrieben).

## Branch-Strategie

```
main                                    # Geschützt — nur mit Human-Merge-Approval
├── agent/<agent-name>/<feature>        # AI-Agent-Arbeitsbranches
├── human/<n>/<feature>              # Mensch-Arbeitsbranches
└── release/<version>                   # Release-Branches
```

### Regeln

1. **Kein Agent pusht direkt auf `main`** — alle Änderungen gehen über Pull Requests
2. **Jeder Agent checkt seinen eigenen Branch aus** für größere Änderungen
3. **Sourcecode-Arbeit läuft in einem eigenen Worktree pro Agent** — der Haupt-Checkout bleibt Integrationspunkt für Menschen
4. **PRs für sicherheitskritische Pfade** erfordern menschliche Merge-Genehmigung:
   - `packages/vault/`
   - `packages/daemon/` (Krypto-/Auth-Code)
   - `docs/security/`
   - Alle `*.pem`, `*.key`, `*.cert` Dateien
5. **Signierte Commits** sind Pflicht für sicherheitskritische Pfade
6. **ADRs** (Architecture Decision Records) für Protokoll- oder Sicherheitsänderungen
7. **Contract-Tests** müssen vor dem Merge jeder Protokolländerung bestehen

## Worktree-Workflow fuer Agenten

Empfohlenes Muster fuer parallele Agent-Arbeit:

1. Im Haupt-Checkout auf `main` bleiben. Von dort wird nur integriert.
2. Fuer jeden Agent einen separaten Worktree unter `.claude/worktrees/` oder `.codex/worktrees/` anlegen.
3. Im Worktree auf einem Agent-Branch arbeiten und dort committen.
4. Der Maintainer uebernimmt die fertigen Agent-Commits selektiv per `git cherry-pick` nach `main`.
5. Danach richtet der Agent seinen Worktree wieder auf den aktuellen lokalen `main` aus, bevor neue Arbeit beginnt.

Beispiel:

```bash
cd ~/Entwicklung_local/thinklocal-mcp
git worktree add .codex/worktrees/codex-source -b agent/codex/source-worktree main

# im Worktree arbeiten und committen
git -C .codex/worktrees/codex-source commit -m "[codex] mesh: ..."

# im Haupt-Checkout integrieren
git checkout main
git cherry-pick <commit-a> <commit-b>

# Worktree fuer die naechste Runde synchronisieren
git -C .codex/worktrees/codex-source reset --hard main
```

Warum `cherry-pick` statt direktem Merge:

- nur die wirklich gewuenschten Agent-Commits werden integriert
- Konflikte bleiben auf klar abgegrenzte Commits beschraenkt
- mehrere Agenten koennen parallel arbeiten, ohne dieselbe Branch-Historie teilen zu muessen

### Commit-Format

```
[agent-name] scope: beschreibung

Beispiele:
[claude-code] daemon: mDNS Discovery implementiert
[codex] vault: Shamir's Secret Sharing hinzugefügt
[gemini] dashboard: Topologie-Ansicht erstellt
[human/christian] security: Threat Model für Skill-Transfer aktualisiert
```

### Scopes

| Scope | Bereich |
|-------|---------|
| `daemon` | Mesh Daemon (Node.js/TypeScript) |
| `worker` | Python MCP Worker |
| `vault` | Credential Vault |
| `dashboard` | Dashboard API + UI |
| `sdk` | Client SDK |
| `cli` | CLI Management Tool |
| `adapter` | Agent-Adapter |
| `skill` | Skill-System |
| `protocol` | Wire-Protokoll |
| `security` | Sicherheit |
| `docs` | Dokumentation |
| `test` | Tests |
| `build` | CI/CD, Build-System |
| `config` | Konfiguration |

## CODEOWNERS

```
packages/vault/              @human-security-reviewer
packages/daemon/src/crypto/  @human-security-reviewer
docs/security/               @human-security-reviewer
docs/architecture/           @human-architecture-reviewer
packages/dashboard-ui/       @any-agent OR @human
packages/mcp-worker/         @any-agent OR @human
adapters/                    @any-agent OR @human
skills/                      @any-agent OR @human
```

## Konfliktvermeidung

### Beim gleichzeitigen Arbeiten
1. Vor dem Start: `git pull origin main && git rebase main`
2. Eigene Dateien klar benennen (kein Zwei-Agenten-Edit der gleichen Datei)
3. Bei Konflikten: Rebase bevorzugen, nicht Merge
4. Integration-Branch für Multi-Agent-Features verwenden

### Reine Doku-Mergekonflikte — Agent-Autonomie (verbindlich)
- Betrifft ein Mergekonflikt **ausschließlich Dokumentation** (`*.md`: Changelog/`CHANGES.md`, `COMPLIANCE-TABLE.md`, ADRs, README, `docs/**`, Tabellen, Begleittext), **löst der verantwortliche Agent ihn selbst.**
- Das ist **ausdrücklich erlaubt** und braucht **keine Human-Freigabe**.
- Solche Doku-Konflikte dürfen die Arbeit **nicht blockieren** — auflösen, betroffene Doku konsistent zusammenführen, die kleinsten relevanten Checks laufen lassen, Branch pushen, PR wieder merge-fähig machen. (Der Merge selbst bleibt das normale Gate.)
- **Ausnahme → normaler Review-/Gate-Pfad:** sobald beim Auflösen auch **Code, Config, Verhalten, Security, Build oder Runtime-Artefakte** betroffen sind (oder der „Doku"-Konflikt solche Dateien mitzieht), greift wieder der reguläre CR/PC-/Review-Pfad — dann ist es kein reiner Doku-Konflikt mehr.

### Kommunikation
- Issues für geplante Arbeit erstellen
- Work-in-Progress PRs mit `[WIP]` markieren
- Fertige PRs mit `[REVIEW]` markieren

## Code-Qualität

### TypeScript (Daemon, Dashboard API)
- ESLint + Prettier
- Strict TypeScript (`"strict": true`)
- Keine `any`-Typen in sicherheitskritischem Code

### Python (MCP Worker, Skills)
- Ruff für Linting + Formatierung
- Type Hints (mypy strict)
- Tests: pytest mit >80% Coverage

### Allgemein
- Keine Secrets im Code (auch nicht temporär)
- Alle externen Eingaben validieren
- Error Handling: niemals Fehler verschlucken
- Logs: strukturiertes Logging (JSON)
