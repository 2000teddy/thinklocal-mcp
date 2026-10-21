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
| `.55` (MacBook Pro) | **widersprüchlich:** `…Entwicklung_lo**c**al/` vs. `~/Entwicklung_lo**k**al/` | `docs/REENROLL-55-RUNBOOK.md:7` vs. `docs/LIVE-TEST-2026-04-09.md:117` (dritte Fundstelle mit **c**: `packages/daemon/scripts/discovery-poc.ts:28`) |
| `.52` (`iobroker`, **Linux**/systemd-user) | `~/Entwicklung_local/thinklocal-mcp` | `docs/REENROLL-52-RUNBOOK.md:108`, Host-Klasse aus `docs/HANDOVER-MINIMAC-POST-MERGE.md:55` |
| Installer-Nodes | `${TLMCP_INSTALL_DIR:-$HOME/thinklocal-mcp}` | `scripts/install.sh:15` |

Für `.55` ist die Doku **widersprüchlich** (c- vs. k-Schreibweise für denselben Host, s. Tabelle) —
deshalb steht dort keine „Korrektur", sondern der Widerspruch plus Pflicht-`ls -d`.
Für `.56` und `ai-n8n-local` ist im Repo **kein** Pfad belegt — deshalb steht dort kein geratener
Wert, sondern die Anweisung, vor dem `cd` mit `ls -d` zu prüfen. (`.52` **ist** belegt, s. Tabelle; der
Vorgänger-Slice hatte es fälschlich unter „Mac-Hosts" geführt — `HANDOVER-MINIMAC:55` listet `iobroker`
unter systemd-user, also Linux. Korrigiert.) Ein falscher Pfad lässt `git pull`
im falschen Repo laufen; das ist die Fehlerklasse, die der Slice verhindern soll.

## Abgrenzung
Keine Re-Enroll-Aktion, kein `.94`-Admin-Token, kein Daemon-Eingriff — bleibt Christian-Gate.
TL-14 bleibt C1-gated. Keine Beschlussänderung.

## Tests
Doc-only, keine Test-Änderung. Verifikation: beide Blöcke vor dem Edit im Volltext gelesen, jeder
Pfad in der Tabelle mit Datei:Zeile belegt.

## Code-Review (`agy`, echtes Fremd-Vendor-Review auf den 4-Commit-Diff) — 4 Findings, alle behoben
| Schwere | Finding | Behebung |
|---|---|---|
| **HIGH** | `cd "$TLMCP_REPO"` ohne Guard: bei ungesetzter Variable expandiert das zu `cd ""` — das ist in bash **Exit 0** und bleibt im aktuellen Verzeichnis, d. h. `git pull` läuft **still** im falschen Repo | `cd "${TLMCP_REPO:?…}" &&`-Kette; live geprüft: ungesetzt ⇒ Abbruch mit Exit 127, kein stilles Weiterlaufen. Dass der Kommentar hinter `npm install &&` die `&&`-Kette **nicht** bricht, wurde ebenfalls live geprüft |
| **HIGH** | Trefferzahlen falsch („8 von 20", Tabellen-Überschrift „(6)" über 5 Zeilen) | Universum gegen den Basis-Commit `a16b475` gezählt statt gegen den eigenen Arbeitsbaum: **22 Treffer, 12 geändert, 10 gelassen**; alle Zwischensummen angeglichen |
| **MEDIUM** | Widerspruch zu `.52`: Slice 1 führte es unter „Mac-Hosts", Slice 2 behauptete „kein Pfad belegt" | `.52` ist **Linux** (`HANDOVER-MINIMAC:55`, systemd-user) und **hat** einen belegten Pfad (`REENROLL-52:108`); beide Dateien korrigiert, der Host steht jetzt in der Per-Host-Liste |
| **LOW** | Slice-1-Eintrag sagte „eigener Slice" / „nur noch 12 gelassene Treffer", obwohl der Folge-Slice im selben PR liegt | Querverweis + Gesamtbilanz des PR in beide Einträge aufgenommen |

Ein Punkt wurde **nicht** übernommen: `agy` wollte `cd <repo>` in ADR-017 unangetastet lassen (NIT,
„als Platzhalter erkennbar") — das deckt sich mit der Umsetzung, dort wurde nichts weiter geändert.

## Merge-Blocker (festgehalten 2026-10-21 12:10) — Self-Approval, **nicht** OAuth

Das Re-Review über `agy` lief real durch: **0 HIGH / 0 MEDIUM / 3 LOW** (reine Kosmetik — PR-Body-Text,
`changes/`-Wortlaut, `CHANGES.md`-PR-Nummern-Suffix), alle **12 Pfadkorrekturen gegen das Live-Dateisystem
verifiziert**, die **10** „begründet gelassen"-Entscheidungen belegt, **CI 5/5 grün**, PR `MERGEABLE`.

**Trotzdem blockiert**, und zwar aus einem Grund, der nichts mit dem OAuth-Lock zu tun hat:
| Fakt | Wert (verifiziert 2026-10-21 12:11) |
|---|---|
| Branch-Protection `main` | `required_approving_review_count=1`, Required-Check `CI` (`strict: true`) |
| `allow_auto_merge` | `false` |
| `gh` angemeldet als | `2000teddy` |
| Autor von #356 | `2000teddy` ⇒ `gh pr review --approve` → `Can not approve your own pull request` |
| Collaborators mit `push` | `2000teddy`, `ChristianUllmann`, `peppiseppiullmann-ci` |

⇒ **Der Merge braucht ein approving Review von `ChristianUllmann` oder `peppiseppiullmann-ci`.** Das ist ein
echtes Christian-Gate, kein Werkzeugproblem und nichts, was der Agent umgehen kann oder soll. Festgehalten in
`TODO.md` §B1.

**Kein `HISTORY.md`-Eintrag:** diese Datei existiert im Repo bewusst **nicht** — `CONTRIBUTING.md:34-36` führt
die Agenten-Erzählung derzeit über **ADRs + `changes/`** und sieht eine separate `HISTORY.md` erst „bei Bedarf
zum nächsten Meilenstein" vor. Sie eigenmächtig anzulegen wäre eine Änderung am Doku-Kanon, kein Protokoll-
Eintrag — deshalb steht die Erzählung hier, wo der Kanon sie vorsieht.

