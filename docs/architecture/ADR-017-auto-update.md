# ADR-017: Auto-Update-Mechanismus

**Status:** Proposed
**Datum:** 2026-04-13
**Autor:** Christian (Anforderung), Claude Code (Dokumentation)
**Verwandt:** ADR-015 (OTS Mesh-Update-Distribution), ADR-007 (Governance)

## Kontext

Das thinklocal-mcp Mesh besteht aus mehreren Nodes (aktuell 4, geplant 5+).
Ein Software-Update erfordert derzeit auf **jedem Node** manuell:

```bash
ssh peer
cd ~/Entwicklung_local/thinklocal-mcp   # oder /opt/thinklocal
git pull
npm install
systemctl --user restart thinklocal-daemon
```

Bei 5+ Nodes ist das zeitaufwaendig und fehleranfaellig:
- Vergessene Nodes laufen auf alter Version
- npm install kann fehlschlagen (native Module, Node-Version)
- Kein zentraler Ueberblick welcher Node welche Version hat
- Downtime waehrend des manuellen Prozesses

## Entscheidung

Zweistufiger Auto-Update-Mechanismus:

### Phase 1: CLI-Update (`thinklocal update`)

Lokales Kommando das den aktuellen Node aktualisiert:

```bash
thinklocal update              # Interaktiv: zeigt Diff, fragt nach
thinklocal update --auto       # Automatisch ohne Prompt (fuer Cron/CI)
thinklocal update --check      # Nur pruefen, nicht installieren
```

**Flow:**
1. Aktuelle Version aus `package.json` lesen
2. Neueste Version via GitHub API (`/repos/{owner}/{repo}/releases/latest`) abfragen
3. Versionsvergleich anzeigen (current vs. latest)
4. Bei `--check`: nur Status ausgeben, Exit-Code 0 (aktuell) oder 1 (veraltet)
5. Bei interaktivem Modus: Bestaetigung abfragen
6. Release-Tarball herunterladen (`.tar.gz` von GitHub Releases)
7. SHA256-Checksum verifizieren (aus Release-Assets)
8. In temporaeres Verzeichnis entpacken
9. `npm install --production` ausfuehren
10. Daemon neu starten (`thinklocal restart`)
11. Health-Check nach Restart

### Phase 2: Mesh-propagierte Updates (Zukunft, baut auf ADR-015 OTS)

Nutzt den bestehenden OTS-Mechanismus (ADR-015) fuer Mesh-weite Updates:

1. Admin updated einen Node via `thinklocal update`
2. Agent-Card enthaelt `version`-Feld (bereits vorhanden)
3. Andere Peers erkennen Versions-Unterschied via Heartbeat/Gossip
4. Admin sendet `UPDATE_SIGNAL` an alle Peers (ueber Mesh-Messaging)
5. Jeder Peer fuehrt `thinklocal update --auto` lokal aus
6. Ergebnis wird an Admin zurueckgemeldet

**Wichtig:** Phase 2 erfordert explizites Admin-Approval (kein automatisches
Update nur weil ein Peer eine neuere Version hat). Dies verhindert
unkontrollierte Rollouts und Supply-Chain-Angriffe.

## Sicherheit

### Release-Signierung
- Jedes GitHub Release enthaelt eine `SHA256SUMS`-Datei
- Die Checksum wird nach dem Download verifiziert
- Spaeter: GPG-signierte Checksums (optional, Phase 2)

### Admin-Approval
- `thinklocal update` im interaktiven Modus fragt immer nach Bestaetigung
- `--auto` Flag nur fuer vertrauenswuerdige Umgebungen (Cron auf Admin-Node)
- Phase 2 Mesh-Updates erfordern explizites Admin-Signal (ADR-007 Governance)

### Rollback
- Vor dem Update wird ein Backup des aktuellen Stands erstellt
- Bei fehlgeschlagenem npm install: automatischer Rollback
- Bei fehlgeschlagenem Health-Check nach Restart: Warnung + Anleitung

### Integritaet
- Download nur ueber HTTPS
- Keine Ausfuehrung von heruntergeladenem Code vor Verifikation
- npm install laeuft in der bestehenden Node.js-Umgebung (kein eval)

## Alternativen (verworfen)

| Alternative | Problem |
|------------|---------|
| Homebrew | Nur macOS, Linux-Nodes nicht abgedeckt |
| apt/deb-Paket | Nur Debian/Ubuntu, erfordert eigenes PPA |
| Docker | Overhead fuer Mesh-Daemon zu hoch, native Module problematisch |
| Nix/Flake | Lernkurve zu steil fuer alle Beteiligten |
| Ansible/Chef | Externes Tooling, Overkill fuer 5-10 Nodes |
| git pull direkt | Erfordert git-Credentials auf jedem Node, unsicher |

Die GitHub-Release-basierte Loesung ist plattformunabhaengig (macOS + Linux),
erfordert keine zusaetzliche Infrastruktur und nutzt den bestehenden
Release-Workflow.

## Implementation

### Phase 1 (dieses ADR)
- `cmdUpdate()` in `packages/cli/src/thinklocal.ts`
- Versionsvergleich via GitHub API (unauthentifiziert, 60 req/h)
- Download + Verify + Install + Restart
- Tests in `packages/cli/src/__tests__/update.test.ts`

### Phase 2 (separates ADR, nach ADR-015 Implementation)
- `UPDATE_SIGNAL` Message-Type im Mesh-Protokoll
- Versions-Tracking in Peer-Status
- Admin-Dashboard zeigt Versions-Matrix
- Automatischer Rollout mit Canary-Strategie (1 Node zuerst, dann Rest)

## Abhaengigkeiten

- GitHub Releases muessen fuer das Repository aktiviert sein
- Node.js `https` (built-in) fuer API-Calls
- Kein zusaetzliches npm-Package noetig (nur Node.js built-ins)

## Risiken

1. **GitHub API Rate-Limit**: 60 req/h ohne Token. Mitigiert durch `--check`
   (nur 1 Request) und Caching der letzten Abfrage.
2. **Netzwerk-Abhaengigkeit**: Update erfordert Internetzugang. Mesh-interne
   Updates (Phase 2) koennen ohne Internet funktionieren.
3. **Breaking Changes**: Major-Version-Updates koennten Config-Migration
   erfordern. Mitigiert durch Semver-Check (Minor/Patch = auto, Major = manuell).
