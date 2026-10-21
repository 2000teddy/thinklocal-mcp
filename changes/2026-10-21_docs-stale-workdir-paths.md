# changes/2026-10-21 — docs: veraltete Arbeitsverzeichnis-Pfade korrigiert

**Typ:** Doc-only. **Kein `packages/`-Diff**, kein Test-Diff, kein Deploy, kein Secret, kein Daemon
angefasst. Risiko-Delta **null**.

**Auftrag:** `~/Entwicklung_local/thinklocal-mcp` wird in der Doku als Arbeitsverzeichnis genannt —
dieses Verzeichnis existiert auf TH01 **nicht** (`ls ~/Entwicklung_local` → ENOENT).

**Trefferuniversum:** `git grep -c "Entwicklung_local\|Entwicklung_lokal" a16b475 -- '*.md'` ohne
`chatlogs/` ⇒ **22 Treffer** in 13 Dateien. (Einer davon, `LIVE-TEST-2026-04-09.md:117`, ist
`Entwicklung_lo**k**al` mit k und damit kein `Entwicklung_local`-Treffer — er zählt nur mit, weil das
Suchmuster beide Schreibweisen fängt.)

---

## Was geändert wurde — 10 von 22 Treffern

**Agenten-/Repo-Workdir auf TH01 → `/opt/thinklocal-mcp`** (5)
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

**Zwei weitere Treffer** (`docs/HANDOVER-MINIMAC-POST-MERGE.md:33`,
`docs/architecture/ADR-017-auto-update.md:15`) sind **Mehr-Host-Anleitungen** — dort ist jeder
einzelne Pfad falsch, egal welcher. Sie werden im unmittelbaren Folge-Slice
`changes/2026-10-21_docs-per-host-repo-pfad.md` (**im selben PR**) durch eine Per-Host-Notiz gelöst.
Gesamtbilanz des PR damit: **12 geändert, 10 bewusst gelassen**.

## Was bewusst NICHT geändert wurde — 10 Treffer

- **Fremde Hosts, Pfad dort gültig (8):**
  - **macOS:** `RUNBOOK-55-C2:46` (ruft `/Users/chris/.nvm/…/node`), `RUNBOOK-55-A:63`
    („.55-Terminal (Jump-GUI)", `launchctl`), `REENROLL-55:7,14`, `PROMPT-MINIMAC-GENESIS:9,30`
    („Du bist auf dem Mac Mini `minimac-60`").
  - **`.52` (`iobroker`) — Linux, nicht macOS** (`HANDOVER-MINIMAC:55` führt `iobroker` unter
    **systemd-user**): `REENROLL-52:108` steht unter „# Auf .52" und meint dessen **eigenes** Home.
    Gleich geschriebener Pfad wie auf den Macs, anderer Host.
  - **Merke:** vier dieser Treffer schreiben `~/…` **ohne** `/Users/chris/`-Präfix und sind trotzdem
    nicht TH01 — ein pauschales `sed` über alle Dateien hätte sie zerstört. Pro Treffer wurde der
    umgebende Host-Kontext gelesen.
- **Historie (2):** `.codex/CODEX_HISTORY:7,10` (`/Users/chris/Entwicklung_lokal/…`, reines
  Sitzungsprotokoll).
- **Nicht gezählt, weil andere Schreibweise:** `LIVE-TEST-2026-04-09:117` (`Entwicklung_lokal` mit k,
  launchd-Mac) — bleibt unangetastet und ist in den 10 oben enthalten.
- **`chatlogs/`** per Auftrag nicht angefasst (dort weitere Treffer, bewusst ignoriert).

## Abgrenzung
Keine Re-Enroll-Aktion, kein `.94`-Admin-Token, kein Daemon-Eingriff — das bleibt Christian-Gate.
TL-14 bleibt C1-gated. Keine Beschlussänderung.

## Tests
Doc-only, keine Test-Änderung. Verifikation: `ls ~/Entwicklung_local` → ENOENT (Befund belegt),
`scripts/install.sh:15` (Endnutzer-Pfad belegt), Trefferzählung gegen `a16b475` (Basis-Commit)
statt gegen den Arbeitsbaum, damit die Zahlen nicht vom eigenen Diff verfälscht werden.
