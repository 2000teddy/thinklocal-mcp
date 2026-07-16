# VERIFY — `.55` mount-Flood-Fix Live-Bestätigung (KW29 Bug-Pfad 2 · deploy-gated Rest)

**Zweck:** die einzige noch offene Verifikation zu Bug-Pfad 2 auf dem Live-Knoten `.55` (minimac, macOS/launchd)
abschließen: nach Ausrollen des PATH-Fixes darf `daemon.error.log` **keine** neuen `mount: command not found`
(bzw. `diskutil: …`) mehr enthalten.

- **Fix im Repo:** PR #273 (merge `f57ae5a`) — `/usr/sbin:/sbin` an alle Unit-PATH-Definitionen.
- **Root-Cause + Mechanismus-Beweis:** `docs/DIAGNOSE-55-mount-command-not-found-flood.md`.
- **Ausführung:** Operator auf `.55` (nicht aus diesem Repo erreichbar). Kein Secret, kein Christian-Gate —
  nur ein Reinstall/Restart-Fenster.

---

## 0. Vorher-Zustand festhalten (Beleg „vorher floodet es")
```bash
# Zähle die Flood-Zeilen im aktuellen (alten) Log:
grep -c "command not found" ~/.thinklocal/logs/daemon.error.log
# Effektiver PATH des laufenden Daemons — sollte /sbin,/usr/sbin NICHT enthalten (alter Stand):
sudo launchctl print system/com.thinklocal.daemon | grep -A1 -i 'PATH'
```
Erwartung (alt): Count > 0, PATH ohne `/sbin`/`/usr/sbin`.

## 1. Fix ausrollen
Der bereits installierte Plist unter `/Library/LaunchDaemons/com.thinklocal.daemon.plist` trägt noch den
**alten** PATH — das Mergen von #273 ändert ihn NICHT automatisch. Neu generieren, eine der beiden Wege:

**A) Über den Installer/CLI (bevorzugt — regeneriert aus dem gefixten Template):**
```bash
cd <repo-auf-.55> && git pull --ff-only        # holt f57ae5a
# Reinstall des System-LaunchDaemon (ADR-029) bzw. `tl service install` — je nach .55-Setup.
```
**B) Minimal-invasiv (nur die PATH-Zeile im installierten Plist patchen):**
```bash
sudo plutil -replace EnvironmentVariables.PATH -string \
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  /Library/LaunchDaemons/com.thinklocal.daemon.plist
```

## 2. Daemon neu starten (Log ab hier frisch bewerten)
```bash
LOG=~/.thinklocal/logs/daemon.error.log
# Byte-Offset VOR dem Restart merken. WICHTIG: NICHT nach Zeitstempel filtern — die geerbten
# "/bin/sh: … command not found"-Zeilen sind NICHT ISO-timestamped, ein `awk '$0>=ts'` würde sie
# fälschlich verwerfen und 0 melden (Codex-Review #274). Byte-Offset ist zeilen-/formatunabhängig.
err_off=$(wc -c < "$LOG" 2>/dev/null || echo 0)
sudo launchctl kickstart -k system/com.thinklocal.daemon
```

## 3. Bestätigen
```bash
# (a) Effektiver PATH enthält jetzt /sbin + /usr/sbin:
sudo launchctl print system/com.thinklocal.daemon | grep -A1 -i 'PATH'
# (b) Die Binaries sind unter dem neuen PATH auflösbar:
/sbin/mount >/dev/null 2>&1 && echo "mount ok"
/usr/sbin/diskutil list >/dev/null 2>&1 && echo "diskutil ok"
# (c) KEINE neuen Flood-Zeilen seit dem Restart — mind. 2 Resource-Refresh-Intervalle abwarten.
#     Post-Restart-Bytes zählen (positions-, nicht zeitstempelbasiert → erfasst auch untimestamped
#     "command not found"-Zeilen). Rotation/Truncation MUSS im Check selbst behandelt werden, sonst
#     liest tail hinter dem Dateiende und meldet fälschlich 0 (Codex-Review #274):
sleep 120
now=$(wc -c < "$LOG" 2>/dev/null || echo 0)
if [ "$now" -lt "$err_off" ]; then
  # Log wurde beim Restart rotiert/getruncatet → die frische Datei enthält NUR Post-Restart-Inhalt:
  new_flood=$(grep -c "command not found" "$LOG")
else
  # Append-Fall → nur die nach err_off angehängten Bytes:
  new_flood=$(tail -c +$((err_off + 1)) "$LOG" | grep -c "command not found")
fi
echo "new_flood=$new_flood"     # DoD (c): muss 0 sein
# (d) Positiv-Nachweis, dass fsSize jetzt Disk-Daten liefert (vorher leer):
curl -s --cert <peer.crt> --key <peer.key> --cacert <ca.crt> https://127.0.0.1:9440/api/status \
  | grep -o '"resources":[^}]*'          # resources/disk-Felder gefüllt statt null/0
```

## 4. Definition of Done
- **(c) `new_flood=0`** — keine neuen `command not found`-Zeilen nach dem Restart (mind. 2 Poll-Intervalle);
  der Check behandelt Append **und** Rotation/Truncation inline, meldet also kein false-zero bei Log-Shrink.
- **(a)** PATH enthält `/sbin` **und** `/usr/sbin`; **(b)** `mount ok` + `diskutil ok`.
- Optional **(d):** Disk-Metriken in `/api/status`/Dashboard nicht mehr leer (Sekundär-Symptom behoben).

Ergebnis (`new_flood`, PATH-Zeile, `err_off`) im Deploy-Schritt / PR-Body dokumentieren — damit ist
Bug-Pfad 2 **end-to-end** geschlossen (Repo-Fix #273 + Live-Beleg).

## 5. Rollback
`plutil -replace … -string "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"` + `kickstart -k`. Risiko minimal:
`/sbin`+`/usr/sbin` sind macOS-Default-PATH-Bestandteile; das Anhängen ändert keine Programm-Auflösung außer
den zuvor fehlenden System-Tools.
