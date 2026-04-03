# CONTRIBUTING.md — thinklocal-mcp

## Multi-Agenten-Entwicklungsrichtlinien

Dieses Projekt wird sowohl von Menschen als auch von AI-Agenten entwickelt. Deshalb gelten besondere Regeln zur Koordination.

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
3. **PRs für sicherheitskritische Pfade** erfordern menschliche Merge-Genehmigung:
   - `packages/vault/`
   - `packages/daemon/` (Krypto-/Auth-Code)
   - `docs/security/`
   - Alle `*.pem`, `*.key`, `*.cert` Dateien
4. **Signierte Commits** sind Pflicht für sicherheitskritische Pfade
5. **ADRs** (Architecture Decision Records) für Protokoll- oder Sicherheitsänderungen
6. **Contract-Tests** müssen vor dem Merge jeder Protokolländerung bestehen

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
