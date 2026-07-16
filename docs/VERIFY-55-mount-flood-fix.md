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
# Alten Log als Beweis beiseite legen. `kickstart -k` killt+relauncht den Daemon; launchd legt eine
# FRISCHE $LOG an → der Post-Restart-Zähler ist eindeutig. Bewusst KEIN Byte-Offset und KEIN
# Zeitstempel-Filter: beide Ansätze hatten false-zero-Pfade (untimestamped stderr-Zeilen; tail liest
# nach Rotation/Truncation hinter dem Dateiende). Die frische Datei entfernt die ganze Fehlerklasse.
mv "$LOG" "$LOG.pre-fix" 2>/dev/null || true
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
#     $LOG wurde in §2 weggerückt → die vom neuen Daemon angelegte Datei enthält AUSSCHLIESSLICH
#     Post-Restart-Inhalt. Ein simpler Vollzähler ist damit eindeutig — kein Offset, keine Rotation/
#     Truncation-Sonderfälle, kein false-zero:
sleep 120
new_flood=$(grep -c "command not found" "$LOG" 2>/dev/null || echo 0)
echo "new_flood=$new_flood"     # DoD (c): muss 0 sein
# Sanity: der Daemon läuft wirklich (frische $LOG existiert / (a) zeigt loaded) — sonst wäre 0 aus
# einem toten Daemon, nicht aus einem behobenen Flood.
[ -f "$LOG" ] && echo "frische $LOG vorhanden" || echo "WARN: keine $LOG — (a) prüfen, ob Daemon läuft"
# (d) Positiv-Nachweis, dass fsSize jetzt Disk-Daten liefert (vorher leer):
curl -s --cert <peer.crt> --key <peer.key> --cacert <ca.crt> https://127.0.0.1:9440/api/status \
  | grep -o '"resources":[^}]*'          # resources/disk-Felder gefüllt statt null/0
```

## 4. Definition of Done
- **(c) `new_flood=0`** — keine neuen `command not found`-Zeilen in der frischen `$LOG` (mind. 2
  Poll-Intervalle). Der weggerückte Alt-Log (`$LOG.pre-fix`) belegt den Vorher-Zustand; der Zähler ist
  offset-/rotationsfrei und kann daher nicht false-zero werden.
- **(a)** PATH enthält `/sbin` **und** `/usr/sbin`; **(b)** `mount ok` + `diskutil ok`; frische `$LOG` existiert
  (Daemon läuft wirklich → 0 stammt nicht von einem toten Daemon).
- Optional **(d):** Disk-Metriken in `/api/status`/Dashboard nicht mehr leer (Sekundär-Symptom behoben).

Ergebnis (`new_flood`, PATH-Zeile, Pfad des `$LOG.pre-fix`-Belegs) im Deploy-Schritt / PR-Body dokumentieren
— damit ist Bug-Pfad 2 **end-to-end** geschlossen (Repo-Fix #273 + Live-Beleg).

## 5. Rollback
`plutil -replace … -string "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"` + `kickstart -k`. Risiko minimal:
`/sbin`+`/usr/sbin` sind macOS-Default-PATH-Bestandteile; das Anhängen ändert keine Programm-Auflösung außer
den zuvor fehlenden System-Tools.
