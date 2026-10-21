# changes/2026-10-21 — docs: veraltete Arbeitsverzeichnis-Pfade korrigiert

**Typ:** Doc-only. **Kein `packages/`-Diff**, kein Test-Diff, kein Deploy, kein Secret, kein Daemon
angefasst. Risiko-Delta **null**.

**Auftrag:** `~/Entwicklung_local/thinklocal-mcp` wird in der Doku als Arbeitsverzeichnis genannt —
dieses Verzeichnis existiert auf TH01 **nicht** (`ls ~/Entwicklung_local` → ENOENT).

**Trefferuniversum:** `git grep -c "Entwicklung_local\|Entwicklung_lokal" a16b475 -- '*.md'` ohne
`chatlogs/` ⇒ **22 Treffer in 13 Markdown-Dateien**. Beide Schreibweisen (`…local` / `…lokal`) sind im
Muster, weil die Doku beide benutzt.

**Ein 23. Treffer liegt ausserhalb von `*.md`:** `packages/daemon/scripts/discovery-poc.ts:28` —
ein **Kommentar** mit einem `ssh chris@10.10.10.55 'cd ~/Entwicklung_local/…'`-Beispiel. Bewusst
**nicht** angefasst: ein `.ts`-Diff würde diesen Slice aus „doc-only" herausheben (TS-Spalte, Suite).
Er ist in §`.55`-Widerspruch unten als dritte Fundstelle dokumentiert und gehört in einen eigenen
Slice.

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
  - **`.55`** (MacBook Pro, 10.10.10.55) — **4 Treffer:** `RUNBOOK-55-C2:46` (ruft
    `/Users/chris/.nvm/…/node`), `RUNBOOK-55-A:63` („.55-Terminal (Jump-GUI)", `launchctl`),
    `REENROLL-55:7,14`.
  - **Mac Mini `minimac-60`/.94 — 2 Treffer:** `PROMPT-MINIMAC-GENESIS:9,30` („Du bist auf dem Mac
    Mini `minimac-60`").
  - **`.52` (`iobroker`) — Linux, nicht macOS** (`HANDOVER-MINIMAC:55` führt `iobroker` unter
    **systemd-user**) — **1 Treffer:** `REENROLL-52:108` steht unter „# Auf .52" und meint dessen
    **eigenes** Home. Gleich geschriebener Pfad wie auf den Macs, anderer Host.
  - **`LIVE-TEST-2026-04-09:117` — 1 Treffer**, ebenfalls `.55` (Überschrift „MacBook Pro
    (10.10.10.55)"), aber in der Schreibweise `Entwicklung_lo**k**al` — s. §`.55`-Widerspruch unten.
- **Historie (2):** `.codex/CODEX_HISTORY:7,10` (`/Users/chris/Entwicklung_lokal/…`, reines
  Sitzungsprotokoll).
- **Merke:** **6 dieser 10 Treffer** (in **5 Dateien**) schreiben `~/…` **ohne** `/Users/chris/`-Präfix
  und sind trotzdem nicht TH01 — davon **5 Treffer in 4 Dateien** in der `…local`-Schreibweise plus
  `LIVE-TEST:117` in der `…lokal`-Schreibweise. Ein pauschales `sed` über alle Dateien hätte sie
  zerstört; pro Treffer wurde der umgebende Host-Kontext gelesen.
- **`chatlogs/`** per Auftrag nicht angefasst (dort weitere Treffer, bewusst ignoriert).

## Nebenbefund: `.55` hat drei widersprüchliche Pfad-Angaben
Für denselben Host nennt die Doku drei Varianten:
| Fundstelle | Pfad | Schreibweise |
|---|---|---|
| `docs/REENROLL-55-RUNBOOK.md:7` | `/Users/chris/Entwicklung_local/thinklocal-mcp` | **c** |
| `docs/LIVE-TEST-2026-04-09.md:117` | `~/Entwicklung_lokal/thinklocal-mcp` — ausdrücklich „(nicht `Entwicklung_local`!)" | **k** |
| `packages/daemon/scripts/discovery-poc.ts:28` | `~/Entwicklung_local/…` (ssh-Beispiel, Kommentar) | **c** |

Welche heute stimmt, ist **aus dem Repo nicht entscheidbar** — nur auf `.55` selbst prüfbar. Deshalb
wurde **keine** der drei Stellen „korrigiert"; statt dessen hält
`HANDOVER-MINIMAC-POST-MERGE.md` den Widerspruch fest und verlangt für `.55` einen `ls -d`-Check
**vor** dem `cd`. Das ist der ehrliche Stand, keine geratene Vereinheitlichung.

## Abgrenzung
Keine Re-Enroll-Aktion, kein `.94`-Admin-Token, kein Daemon-Eingriff — das bleibt Christian-Gate.
TL-14 bleibt C1-gated. Keine Beschlussänderung.

## Tests
Doc-only, keine Test-Änderung. Verifikation: `ls ~/Entwicklung_local` → ENOENT (Befund belegt),
`scripts/install.sh:15` (Endnutzer-Pfad belegt), Trefferzählung gegen `a16b475` (Basis-Commit)
statt gegen den Arbeitsbaum, damit die Zahlen nicht vom eigenen Diff verfälscht werden.
