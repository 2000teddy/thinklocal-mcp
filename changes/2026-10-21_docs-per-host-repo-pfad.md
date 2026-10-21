# changes/2026-10-21 — docs: Per-Host-Notiz für den Repo-Pfad (Folge-Slice)

**Typ:** Doc-only. **Kein `packages/`-Diff**, kein Test-Diff, kein Deploy, kein Secret, kein Daemon
angefasst. Risiko-Delta **null**.

**Auftrag:** Folge-Slice zu `changes/2026-10-21_docs-stale-workdir-paths.md`. Dort blieben zwei
Treffer bewusst offen, weil es **Mehr-Host-Anleitungen** sind: jeder einzelne Pfad wäre dort falsch,
egal welcher. Sie bekommen jetzt statt eines Pfades eine **Per-Host-Notiz**.

---

## Was geändert wurde

### `docs/HANDOVER-MINIMAC-POST-MERGE.md:33` — §4 „Verteilung auf alle 5 Mesh-Nodes"
Das Blockkommando sagte `cd ~/Entwicklung_local/thinklocal-mcp` für „jede der 5 Nodes". Jetzt
`cd "$TLMCP_REPO"` plus eine Liste **„Repo-Pfad je nach Host"** — bewusst in derselben Form wie die
bereits vorhandene Liste „Daemon-Restart je nach Host" direkt darunter, die dasselbe Problem für den
Restart schon richtig löst.

### `docs/architecture/ADR-017-auto-update.md:15` — §Kontext
Der Block beschreibt den manuellen Ist-Zustand („auf **jedem Node** manuell"). `cd <repo>` mit
Per-Host-Annotation; ergänzt um den Satz, dass der unterschiedliche Pfad **Teil des Problems** ist,
das die ADR löst — das stützt die Entscheidung, statt sie zu verwässern. Zusätzlich der Hinweis, dass
der Restart auf macOS `launchctl` ist, nicht `systemctl --user`.
**Nicht angefasst:** §Entscheidung, §Status (`Proposed`, 2026-04-13) und jede andere Aussage der ADR —
geändert wurde allein die Pfad-/Restart-Annotation im Kontext-Block.

## Belegte Pfade (nichts geraten)
| Host | Pfad | Beleg |
|---|---|---|
| TH01 (`ThinkHub`, .80, Linux) | `/opt/thinklocal-mcp` | dieses Repo, live verifiziert |
| Mac Mini `minimac-60` / .94 | `~/Entwicklung_local/thinklocal-mcp` | `docs/PROMPT-MINIMAC-GENESIS.md:9` |
| `.55` | `/Users/chris/Entwicklung_local/thinklocal-mcp` | `docs/REENROLL-55-RUNBOOK.md:7` |
| ein Mac (launchd) | `~/Entwicklung_lokal/` — **mit k** | `docs/LIVE-TEST-2026-04-09.md:117` |
| Installer-Nodes | `${TLMCP_INSTALL_DIR:-$HOME/thinklocal-mcp}` | `scripts/install.sh:15` |

Für `.52`/`.56`/`ai-n8n-local` ist im Repo **kein** Pfad belegt — deshalb steht dort kein geratener
Wert, sondern die Anweisung, vor dem `cd` mit `ls -d` zu prüfen. Ein falscher Pfad lässt `git pull`
im falschen Repo laufen; das ist die Fehlerklasse, die der Slice verhindern soll.

## Abgrenzung
Keine Re-Enroll-Aktion, kein `.94`-Admin-Token, kein Daemon-Eingriff — bleibt Christian-Gate.
TL-14 bleibt C1-gated. Keine Beschlussänderung.

## Tests
Doc-only, keine Test-Änderung. Verifikation: beide Blöcke vor dem Edit im Volltext gelesen, jeder
Pfad in der Tabelle mit Datei:Zeile belegt.
