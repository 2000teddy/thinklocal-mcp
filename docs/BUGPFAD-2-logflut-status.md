# Bug-Pfad 2 — `.55` Log-Flut: konsolidierter Beleg + Issue-Vorlage

**KW29 · Freitag-Deliverable („Logrotation + PATH-/`mount`-Fehler einsortieren, saubere Belegdatei/Issue-Vorlage").**
Stand: 2026-07-17 · repo-seitig read-only verifiziert.

## TL;DR — Bug-Pfad 2 hat ZWEI getrennte Hälften
Die KW29-Ausgangslage (`WOCHENPLAN-KW29.md` §0.2) nennt „`.55`-Logs laufen aus dem Ruder
(`daemon.log`/`daemon.error.log`, `mount: command not found`)". Das sind **zwei** Befunde, nicht einer:

| Teil | Was | Status |
|---|---|---|
| **2a** | `mount: command not found`-**Flut** (Unit-PATH ohne `/sbin`) | **repo-seitig GESCHLOSSEN** (#273) · Live-Beleg operator-gated |
| **2b** | **Unbegrenztes Log-Wachstum** (`daemon.log`/`daemon.error.log` ohne Rotation) | **OFFEN** · keine Repo-Mechanik vorhanden |

Der Fix zu 2a stoppt die *Flut-Quelle*; er adressiert **nicht** das generelle unbegrenzte Wachstum (2b).
Wer „Bug-Pfad 2 = mount-Fix = erledigt" liest, übersieht 2b.

---

## 2a — `mount: command not found`-Flut (PATH-Defizit) — GESCHLOSSEN (repo)
- **Root-Cause + Mechanismus-Beweis:** `docs/DIAGNOSE-55-mount-command-not-found-flood.md`.
  Kurz: darwin-`systeminformation.fsSize()` shellt `mount`/`diskutil` via `execSync` **ohne** stderr-`ignore`
  (anders als der Linux-Pfad), die LaunchDaemon-PATH hatte kein `/sbin`+`/usr/sbin` → `/bin/sh: … command
  not found` wird an die Daemon-stderr vererbt → periodisch (Resource-Refresh + `/api/status` + system-monitor).
- **Fix:** #273 (Merge `f57ae5a`, auf `main`) — `/usr/sbin:/sbin` an **allen 7** Unit-PATH-Stellen
  (`plist.template:38`, `plist:25`, `thinklocal.ts:1321` launchd + `:1387` systemd, `install.sh:459/519`,
  `thinklocal-daemon.service:18`). Regression-Test `launchd-plist.test.ts` (25 Tests grün) pinnt die
  gerenderte Plist-PATH auf `/sbin`+`/usr/sbin`.
- **Offen (operator-/deploy-gated, NICHT von diesem Repo aus):** der `.55`-Live-Beleg nach Reinstall/Restart —
  Runbook `docs/VERIFY-55-mount-flood-fix.md` (gehärtete DoD: post-window `alive=1 && api_ok=1`, dann
  `new_flood=0`). Kein Christian-Gate, nur ein Reinstall/Restart-Fenster.

## 2b — Unbegrenztes Log-Wachstum (keine Rotation) — OFFEN
**Befund:** Die Daemon-Logs wachsen **unbegrenzt**; im gesamten Repo existiert **keine** Rotation, kein
Size-Cap und kein `newsyslog`/`logrotate`-Eintrag für `daemon.log`/`daemon.error.log`.

**Verifizierte Evidenz (read-only, 2026-07-17):**
1. **Senken sind append-only, ohne Rotation:**
   - macOS launchd: `scripts/service/com.thinklocal.daemon.plist:37/40` (`StandardOutPath`/`StandardErrorPath`
     → `~/.thinklocal/logs/daemon.log` bzw. `daemon.error.log`), ebenso `…plist.template:54-58`. launchd
     rotiert diese Dateien **nicht** (macOS-`newsyslog` ist für diese Pfade **nicht** konfiguriert).
   - systemd: `scripts/service/thinklocal-daemon.service:25-26` (`StandardOutput=append:…`,
     `StandardError=append:…`) — `append:` schreibt in **dieselbe** Datei, journald-Rotation greift dabei nicht.
2. **Daemon-Logger schreibt nach stdout, ohne rotierenden Transport:** `packages/daemon/src/logger.ts:5-11` —
   `pino({ transport: … { target: 'pino/file', options: { destination: 1 } } … })` (`destination: 1` = stdout);
   in `production` (kein Transport) ebenfalls Default-stdout. Kein `pino-roll`/`sonic-boom`-Rotationsziel.
3. **Kein Rotations-/Cap-Mechanismus im Repo:** Grep über `scripts/`, `docs/`, `packages/*/src`, `config/`
   nach `newsyslog|logrotate|rotate.*log|size_?limit|max_?bytes` → **kein** Treffer für Logdateien
   (`boot-relearn.ts:124` `maxBytes` = Body-/Stream-Lese-Cap beim Boot-Relearn-Fetch, `unix-socket.ts:332`
   `maxSize` = Frame-/Nachrichtengröße — beides logfremd).

**Wirkung:** Auf einem langlebigen Knoten (`.55`) wächst `daemon.log`/`daemon.error.log` monoton — verschärft
durch 2a-Flut (vor dem Fix), aber unabhängig davon persistent. Disk-Füllung + langsames `tail`/Grep bei
Diagnose. 2a mindert die Wachstumsrate, entfernt aber die fehlende Rotation nicht.

**Optionen (noch NICHT umgesetzt — kein Fix in diesem Beleg-Slice):**
- **macOS:** `newsyslog.d`-Eintrag für `~/.thinklocal/logs/*.log` (size/time-basiert, native, kein Daemon-Code).
- **Linux:** `logrotate`-Dropin mit `copytruncate` **oder** systemd-journald statt `append:`-Datei-Redirect.
- **Cross-Platform (daemon-seitig):** pino-Ziel auf `pino-roll` (size/interval) umstellen — betrifft `logger.ts`,
  ist aber ein **Code**-Slice (Tests + Review + evtl. Dependency), kein Docs-only.

**Empfehlung:** die OS-nativen Wege (newsyslog/logrotate) sind die kleinste Stelle; sie sind Deploy-/Unit-Slices
(neue Templates), analog zum 2a-PATH-Fix. Der daemon-seitige pino-roll-Weg ist Defense-in-Depth. Priorisierung
+ ob überhaupt daemon-seitig gehört zu einer Design-Frage (CO), nicht in dieses Beleg-Dokument.

---

## Issue-Vorlage (Copy-Paste für GitHub-Issue)
```
Titel: [bug] .55 Daemon-Logs wachsen unbegrenzt — keine Rotation (Bug-Pfad 2b)

Kontext: Bug-Pfad 2 (KW29) hat zwei Hälften. 2a (mount:command-not-found-Flut / Unit-PATH) ist
mit #273 repo-seitig gefixt. 2b (unbegrenztes Log-Wachstum) ist davon UNABHÄNGIG offen.

Befund: daemon.log/daemon.error.log werden append-only geschrieben (launchd StandardErrorPath /
systemd append:), Daemon-Logger schreibt nach stdout (pino destination:1). Es existiert KEINE
Rotation / kein Size-Cap / kein newsyslog|logrotate-Eintrag im Repo.

Evidenz: com.thinklocal.daemon.plist:37/40, thinklocal-daemon.service:25-26,
packages/daemon/src/logger.ts:5-11; Grep ohne Rotations-Treffer. Details:
docs/BUGPFAD-2-logflut-status.md.

Vorschlag: OS-nativ (macOS newsyslog.d / Linux logrotate copytruncate) als kleinste Stelle;
pino-roll als daemon-seitige Alternative (Design-Frage/CO). Live-Größen-Beleg auf .55 operator-gated.

DoD: Rotation greift (Datei rolliert bei size/interval); alter Inhalt archiviert/gekappt; Daemon
schreibt nach Rotation weiter (kein Truncation-Verlust); Live-Beleg auf .55.
```

## Beweispfade
- **2a Fix:** `git merge-base --is-ancestor f57ae5a HEAD` (→ auf main); PATH: `com.thinklocal.daemon.plist:25`,
  `…plist.template:38`, `thinklocal.ts:1321/1387`, `install.sh:459/519`, `thinklocal-daemon.service:18`.
  Test: `packages/daemon/src/launchd-plist.test.ts` (25 grün). Runbook: `docs/VERIFY-55-mount-flood-fix.md`.
- **2b Gap:** `com.thinklocal.daemon.plist:37/40`, `thinklocal-daemon.service:25-26`,
  `packages/daemon/src/logger.ts:5-11`; kein Rotations-Treffer im Repo-Grep.
- **Live (beide, operator-gated, nicht von diesem Repo):** `.55` — `daemon.error.log`-Größe + `new_flood`
  nach Restart (VERIFY-55-Runbook); `.55` ist nicht aus diesem Repo erreichbar (`[[macos-daemon-env-and-inbox-gaps]]`).

## Abgrenzung
Dieses Dokument **sortiert ein und belegt** (KW29-Freitag-Deliverable). Es **fixt 2b nicht** — der Rotations-
Fix ist ein eigener Deploy-/Unit- oder Code-Slice (mit CO zur Weg-Wahl). 2a bleibt bis zum `.55`-Live-Beleg
end-to-end offen.
