# DIAGNOSE — `.55` Log-Flut „mount: command not found" (PATH-Defizit)

**KW29 · Bug-Pfad 2 · Erstellt 2026-07-16 · Root-Cause vollständig verifiziert (lokal reproduziert) + Fix.**

## 1. Phänomen
Auf `.55` (minimac, macOS/launchd) flutet `mount: command not found` (bzw. `diskutil: …`) den
`daemon.error.log`. Der Daemon läuft dabei normal — es ist ein **PATH-Defizit im Service-Unit**, keine
Fehlfunktion des Daemons selbst.

## 2. Verifizierte Root-Cause-Kette
1. **Unit-PATH ohne `/sbin`+`/usr/sbin`.** Die macOS-LaunchDaemon-PATH war
   `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` — **ohne `/sbin` und `/usr/sbin`**
   (`scripts/service/com.thinklocal.daemon.plist.template:38`, `…plist:25`, CLI-Generator
   `packages/cli/src/thinklocal.ts:1321`). Auf macOS liegen aber:
   - `mount` → `/sbin/mount`
   - `diskutil` → `/usr/sbin/diskutil`
2. **`systeminformation.fsSize()` shellt auf darwin nach `mount` + `diskutil` — ohne stderr-Unterdrückung.**
   `node_modules/systeminformation/lib/filesystem.js:130-152` (darwin-Zweig):
   ```js
   if (_darwin) {
     cmd = 'df -kP';
     try {
       macOsDisks = execSync('diskutil list')…   // /usr/sbin/diskutil
       execSync('mount')…                          // /sbin/mount
     } catch { util.noop(); }
   }
   ```
   Anders als der Linux-Zweig (`execSync(… , util.execOptsLinux)` mit `stdio:['pipe','pipe','ignore']`,
   `util.js:61`) werden die darwin-`execSync`-Aufrufe **ohne Optionen** ausgeführt.
3. **Node `execSync` erbt die Child-stderr an den Parent** (Default-`stdio`). Fehlt das Binary, schreibt
   `/bin/sh` `… command not found` auf die **Daemon-stderr** → per `StandardErrorPath` in
   `daemon.error.log`. Der `try/catch { noop }` fängt die *Exception*, **nicht** die bereits vom Kind
   ausgegebene stderr-Zeile.
4. **Periodischer Treiber → Flut.** `fsSize()` läuft bei jedem Resource-Refresh
   (`index.ts:1129` `setInterval(refreshNodeResources, resource_refresh_interval_ms)`), bei jedem
   Agent-Card-/`/api/status`-Aufbau (`agent-card.ts:484`) und im `system-monitor`-Skill
   (`system-monitor.ts:40/126`) → wiederkehrende Zeile.

**Warum `.55`-spezifisch:** Auf Linux liegt `mount` in `/usr/bin` (im Unit-PATH) **und** der Linux-Code-Pfad
unterdrückt stderr (`'ignore'`). Nur die Kombination darwin-`execSync`-ohne-`ignore` **+** macOS-`/sbin`-Tools
**+** PATH-ohne-`/sbin` erzeugt die Flut.

## 3. Lokale Reproduktion (2026-07-16, Linux — Mechanismus-Beweis)
```bash
# (a) execSync erbt stderr an den Parent (Default-stdio):
node -e "try{require('child_process').execSync('this_cmd_does_not_exist_xyz')}catch(e){}" 2>cap.err
cat cap.err     # -> /bin/sh: 1: this_cmd_does_not_exist_xyz: not found      == Flut-Zeile
# (b) mit stderr:'ignore' (wie execOptsLinux) — still:
node -e "try{require('child_process').execSync('x_missing',{stdio:['pipe','pipe','ignore']})}catch(e){}" 2>cap2.err
cat cap2.err    # -> leer
# (c) systeminformation swallowed auf Linux (execOptsLinux ignore) → fsSize() liefert leer, KEINE stderr:
#     (packages/daemon) PATH=/tmp node --input-type=module -e "import * as si from 'systeminformation'; …fsSize()"
#     -> "fsSize() OK, entries=0", 0 stderr-Zeilen  (bestätigt: Linux-Pfad unterdrückt, darwin-Pfad nicht)
```
`(a)`+`(b)` beweisen den stderr-Erb-Mechanismus plattformunabhängig; `(c)` zeigt, dass der Linux-Pfad ihn
unterdrückt (deshalb kein Flood auf TH01/Linux), der darwin-Pfad (Schritt 2) aber nicht.

## 4. Fix (in diesem PR)
`/usr/sbin:/sbin` an **alle** Service-Unit-PATHs angehängt (macOS-Default-PATH enthält beide):
- `scripts/service/com.thinklocal.daemon.plist.template`, `…plist`, `packages/cli/src/thinklocal.ts` (macOS)
- `scripts/install.sh` (2×), `scripts/service/thinklocal-daemon.service` (systemd, Konsistenz/Defense-in-Depth)
- Regression-Test: `launchd-plist.test.ts` prüft, dass die gerenderte Plist-PATH `:/sbin` + `:/usr/sbin` enthält.

**Bewusst NICHT geändert:** das Upstream-`systeminformation`-Verhalten (execSync ohne `ignore`) — das ist
Third-Party; der PATH-Fix ist die richtige, minimale Stelle. Optionaler Folge-Slice: `si`-Aufrufe in einen
stderr-unterdrückenden Wrapper hüllen (Defense-in-Depth, falls PATH künftig wieder driftet).

## 5. Live-Bestätigung auf `.55` (deploy-gated, nicht in diesem Repo-Schritt)
Nach Re-Install/Plist-Update auf `.55`:
```bash
launchctl print system/com.thinklocal.daemon | grep -A2 PATH   # PATH enthält jetzt /sbin, /usr/sbin
/sbin/mount >/dev/null && echo "mount ok"; /usr/sbin/diskutil list >/dev/null && echo "diskutil ok"
tail -n 200 ~/.thinklocal/logs/daemon.error.log | grep -c "command not found"   # -> 0 nach Neustart
```
Diese Live-Verifikation ist der finale Beweis und gehört in den Deploy-Schritt (Fenster/Christian-gated).

## 6. Artefakte
- PATH-Defizit (vorher): `com.thinklocal.daemon.plist.template:38`, `…plist:25`, `thinklocal.ts:1321`,
  `install.sh:459/519`, `thinklocal-daemon.service:18`.
- Flut-Quelle: `systeminformation/lib/filesystem.js:130-152` (darwin `execSync('mount')`/`('diskutil list')`),
  `util.js:61` (Linux `ignore`-Kontrast).
- Treiber: `index.ts:1129` (Resource-Refresh-Timer), `agent-card.ts:484`, `system-monitor.ts:40/126`.
- Verwandt: `[[macos-daemon-env-and-inbox-gaps]]` (launchctl-setenv erreicht den Daemon nicht → nur Plist-Env zählt).
