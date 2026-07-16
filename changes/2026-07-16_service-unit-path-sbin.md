# changes/2026-07-16 — fix(service): /sbin+/usr/sbin in Unit-PATH (KW29 Bug-Pfad 2)

**Typ:** Service-Unit-Config-Fix (macOS-Plist + systemd) + Diagnose-Doku + Regression-Test.
**Kein** Secret/Christian-Gate. Deploy-Fenster für die `.55`-Live-Bestätigung ist der einzige gated Rest.

## Warum
Auf `.55` (macOS/launchd) flutete `mount: command not found` den `daemon.error.log`. Root-Cause **vollständig
verifiziert** (siehe `docs/DIAGNOSE-55-mount-command-not-found-flood.md`):
1. Unit-PATH war `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` — **ohne** `/sbin`+`/usr/sbin`.
2. `systeminformation.fsSize()` shellt auf darwin `execSync('mount')` + `execSync('diskutil list')` **ohne**
   stderr-Unterdrückung (`filesystem.js:130-152`; der Linux-Zweig nutzt `execOptsLinux` = `stdio:'ignore'`,
   `util.js:61`).
3. Node `execSync` **erbt** die Child-stderr an den Parent (Default-`stdio`) → `/bin/sh: mount: command not
   found` → `StandardErrorPath`. Das `try/catch{noop}` fängt die Exception, nicht die stderr-Zeile.
4. `fsSize()` läuft periodisch (`index.ts:1129` Resource-Refresh-Timer, `agent-card.ts:484`,
   `system-monitor.ts:40/126`) → Flut. `.55`-spezifisch: nur darwin-Pfad-ohne-`ignore` **+** macOS-`/sbin`-Tools
   **+** PATH-ohne-`/sbin`.

## Was
`/usr/sbin:/sbin` an **alle 7** Unit-PATH-Definitionen angehängt (macOS-Default-PATH enthält beide, sicher):
- macOS: `com.thinklocal.daemon.plist.template:38`, `…plist:25`, `thinklocal.ts:1321` (CLI-launchd-Gen).
- systemd: `install.sh:459/519`, `thinklocal-daemon.service:18`, `thinklocal.ts:1387` (CLI-systemd-Gen,
  Linux-Source-of-Truth — CR-MEDIUM nachgezogen).
- Regression: `launchd-plist.test.ts` prüft die gerenderte Plist-PATH auf `:/sbin` + `:/usr/sbin`.

## Bewusste Grenze
Upstream-`systeminformation` (execSync ohne `ignore`) **nicht** angefasst (Third-Party). PATH-Fix ist die
minimale, richtige Stelle. Optionaler Folge-Slice: `si`-Aufrufe in einen stderr-unterdrückenden Wrapper hüllen
(Defense-in-Depth gegen künftigen PATH-Drift). `.55`-Live-Bestätigung (`daemon.error.log`→0 nach Neustart) ist
deploy-gated (Fenster).

## Compliance
- **CO/CG:** entfallen (reiner Bug-Fix, CLAUDE.md-Ausnahme).
- **TS:** `launchd-plist.test.ts` +1 Regression (PATH enthält `:/sbin`+`:/usr/sbin`); voller Lauf **1767 grün**;
  `install.sh` `bash -n` OK; Mechanismus lokal bewiesen (execSync-stderr-Erbe vs. `ignore`).
- **CR:** adversarialer Claude-Subagent — Root-Cause-Kette **bestätigt** (execSync-Default-stderr-Erbe;
  darwin-Pfad unsuppressed vs. Linux-`ignore`; mount/diskutil in /sbin,/usr/sbin); Append sicher (Homebrew bleibt
  vorne, keine Dupes, kein Escaping-Problem). **1 MEDIUM** (übersehene 7. PATH-Stelle `thinklocal.ts:1387`)
  **in-slice gefixt**, 1 LOW (Doku-Count 6→7) korrigiert.
- **PC:** `git diff` + Secret-Scan clean.
- **DO:** Diagnose-Doku, `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
