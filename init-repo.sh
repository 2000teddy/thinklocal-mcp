#!/bin/bash
# thinklocal-mcp — GitHub Repository Initialisierung
# Dieses Skript erstellt ein privates GitHub-Repository und pusht die Projektdateien.
# Voraussetzung: gh CLI installiert und authentifiziert

set -e

REPO_NAME="thinklocal-mcp"
REPO_DESC="Secure, encrypted local-network mesh for AI agent collaboration via MCP"

echo "=== thinklocal-mcp Repository Initialisierung ==="

# Git initialisieren
cd "$(dirname "$0")"
git init
git branch -M main

# Alle Dateien hinzufügen
git add -A
git commit -m "[human/christian] init: Projektinitialisierung mit Multi-Modell-Architektur-Konsensus

Erstellt durch Claude Desktop (Opus 4.6) basierend auf strukturiertem
Konsensus von GPT-5.4, Gemini 3 Pro, Claude Sonnet 4.6, DeepSeek R1,
Kimi K2 und GLM 4.5.

Enthält:
- README.md: Vollständige Architekturdokumentation
- CHANGES.md: Changelog mit Zeitstempeln
- TODO.md: Entwicklungsfahrplan & Zukunftsideen
- CONTRIBUTING.md: Multi-Agenten-Beitragsrichtlinien
- SECURITY.md: Sicherheitsrichtlinie & Bedrohungsmodell
- .gitignore: Standard-Ausschlüsse"

# Privates GitHub-Repository erstellen
echo ""
echo "Erstelle privates GitHub-Repository..."
gh repo create "$REPO_NAME" --private --description "$REPO_DESC" --source . --push

echo ""
echo "=== Fertig! ==="
echo "Repository: https://github.com/$(gh api user -q '.login')/$REPO_NAME"
echo ""
echo "Nächste Schritte:"
echo "  1. Branch Protection für 'main' einrichten"
echo "  2. CODEOWNERS-Datei aktivieren"
echo "  3. GitHub Actions CI/CD Pipeline erstellen"
echo "  4. Erste ADR (Architecture Decision Record) schreiben"
