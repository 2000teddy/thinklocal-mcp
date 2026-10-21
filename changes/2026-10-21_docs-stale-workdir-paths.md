# changes/2026-10-21 — docs: veraltete Arbeitsverzeichnis-Pfade korrigiert

**Typ:** Doc-only. **Kein `packages/`-Diff**, kein Test-Diff, kein Deploy, kein Secret, kein Daemon
angefasst. Risiko-Delta **null**.

**Auftrag:** `~/Entwicklung_local/thinklocal-mcp` wird in der Doku als Arbeitsverzeichnis genannt —
dieses Verzeichnis existiert auf TH01 **nicht** (`ls ~/Entwicklung_local` → ENOENT). Betroffen waren
20 Treffer in `*.md` (ohne `chatlogs/`).

---

## Was geändert wurde — 8 von 20 Treffern

**Agenten-/Repo-Workdir auf TH01 → `/opt/thinklocal-mcp`** (6)
| Datei:Zeile | Beleg für TH01 |
|---|---|
| `CLAUDE.md:40` | §Arbeitsverzeichnis — der Pfad, aus dem die Agenten arbeiten |
| `CONTRIBUTING.md:74` | Worktree-Beispiel für parallele Agent-Arbeit |
| `docs/REENROLL-52-RUNBOOK.md:36` | §2 Preflight, Kommentar in derselben Zeile: „TH01: Ist-Zustand nur lesen" |
| `docs/REENROLL-52-RUNBOOK.md:87` | Überschrift: „§4 Apply (im Fenster) — **TH01-Seite**" |
| `docs/DEVELOPER-GUIDE.md:223` | §6 Testing, Repo-Workdir dieses Projekts |

**Endnutzer-Pfad → `~/thinklocal-mcp`** (5, `docs/USER-GUIDE.md:26,34,144,433,436`)
Hier wäre `/opt` **ebenfalls falsch** gewesen: der Installer klont nach
`INSTALL_DIR="${TLMCP_INSTALL_DIR:-$HOME/thinklocal-mcp}"` (`scripts/install.sh:15`). Das
Benutzerhandbuch beschreibt die Ein-Befehl-Installation, nicht TH01.

## Was bewusst NICHT geändert wurde — 12 Treffer

- **Mac-Hosts, Pfad dort korrekt (9):** `RUNBOOK-55-C2:46` (ruft `/Users/chris/.nvm/…/node`),
  `RUNBOOK-55-A:63` („.55-Terminal (Jump-GUI)", `launchctl`), `REENROLL-55:7,14`,
  `REENROLL-52:108` („# Auf .52"), `PROMPT-MINIMAC-GENESIS:9,30` („Du bist auf dem Mac Mini
  `minimac-60`"), `LIVE-TEST-2026-04-09:117` (`Entwicklung_lokal` mit k, launchd),
  `.codex/CODEX_HISTORY:7,10` (reine Historie).
  **Merke:** drei dieser Treffer schreiben `~/…` **ohne** `/Users/chris/` und laufen trotzdem auf dem
  Mac — ein pauschales `sed` über alle Dateien hätte sie zerstört. Pro Treffer wurde der umgebende
  Host-Kontext gelesen.
- **Mehr-Host-Anleitungen ohne eindeutigen Host (2):** `HANDOVER-MINIMAC:33` („Auf jeder der 5
  Nodes") und `ADR-017:15` (`ssh peer`, enthält bereits `# oder /opt/thinklocal`; zudem
  ADR-Kontextbeschreibung = Historie). Ein einzelner Pfad ist dort falsch, egal welcher — bräuchte
  eine Per-Host-Notiz, das ist ein eigener Slice.
- **`chatlogs/`** per Auftrag nicht angefasst.

## Abgrenzung
Keine Re-Enroll-Aktion, kein `.94`-Admin-Token, kein Daemon-Eingriff — das bleibt Christian-Gate.
TL-14 bleibt C1-gated. Keine Beschlussänderung.

## Tests
Doc-only, keine Test-Änderung. Verifikation: `ls ~/Entwicklung_local` → ENOENT (Befund belegt),
`scripts/install.sh:15` (Endnutzer-Pfad belegt), `grep -r Entwicklung_local --include=*.md` ohne
`chatlogs/` → nur noch die 12 bewusst gelassenen Treffer.
