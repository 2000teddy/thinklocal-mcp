# ADR-029: macOS LaunchDaemon (System-Domain) statt LaunchAgent

**Status:** Proposed (Draft-PR, wartet auf Review — KEIN Deploy/Install ohne Christians Wort)
**Datum:** 2026-06-23
**Autor:** Claude (Design + Implementierung), Christian (Auftrag), Orchestrator .94 (Steuerung)
**Konsensus (CO):** n/a — Umsetzung eines bereits beschlossenen Backlog-Items (TODO „macOS-Installer auf LaunchDaemon umstellen", 5-Tage-Plan B6); kein neuer Architektur-Konflikt.
**Verwandt:** `macos-daemon-env-and-inbox-gaps` (launchctl-setenv-Gap), `th55-ehostunreach-host-routing` (FileVault/headless-.55), ADR-021 (Skill-Service-Boot-Race).

## Kontext

Der macOS-Installer (`scripts/install.sh`, `install_macos_service`) installiert das
Daemon aktuell als **LaunchAgent** (`~/Library/LaunchAgents/com.thinklocal.daemon.plist`,
`launchctl load`). Das hat drei harte Probleme im Fleet-Betrieb:

1. **Kein headless-Start.** Ein LaunchAgent startet erst nach **GUI-Login** des
   Benutzers. Auf SSH-only/headless Macs (z.B. `.55` minimac-2) und nach einem
   FileVault-Reboot (Unlock = Christian, danach KEIN GUI-Login) läuft das Daemon
   damit nicht von allein an. Genau das hat den `.55`-Betrieb wiederholt blockiert.
2. **Env erreicht das Daemon nicht durabel.** `launchctl setenv` propagiert NICHT
   in einen bereits laufenden Agent (siehe Memory `macos-daemon-env-and-inbox-gaps`);
   nur die `EnvironmentVariables` der Plist sind verlässlich. Eine korrekt
   templatisierte Plist ist die einzige durable Env-Quelle.
3. **Hartkodierte Pfade/Benutzer.** Die alte Plist nutzt `__HOME__`/`__INSTALL_DIR__`
   und der Installer setzt sie per `sed`; ein fehlerhaftes `sed` (leerer Wert,
   unersetzter Platzhalter) erzeugt **still** ein kaputtes Service-File. Es gibt
   keinen Test, der das abfängt.

## Entscheidung

Umstieg auf einen **System-Domain-LaunchDaemon** (`/Library/LaunchDaemons/`,
`launchctl bootstrap system`), der unter einem **dedizierten Benutzer** (NICHT root)
läuft. Konkret:

1. **Template statt Inline-Plist:** `scripts/service/com.thinklocal.daemon.plist.template`
   mit `{{NODE_BIN}} {{REPO}} {{DATA_DIR}} {{CONFIG}} {{RUN_USER}} {{RUN_GROUP}}`.
   Keine hartkodierten `chris`/`staff`/`/Users/chris`-Literale mehr.
2. **System-Domain + Least-Privilege:** `UserName`/`GroupName` setzen (in System-
   LaunchDaemons erlaubt+nötig, in LaunchAgents verboten). Das Daemon läuft NICHT
   als root; Datei-Eigentum der Plist `root:wheel`, `chmod 644`.
3. **Durable + headless:** `RunAtLoad=true` (Start bei Boot nach FileVault-Unlock,
   ohne GUI-Login). `KeepAlive={SuccessfulExit:false}` — ein sauber beendetes
   (SIGTERM/`launchctl bootout`) Daemon wird NICHT neu hochgezogen → **kein
   mystery-relauncher**, der bewusste Stops überstimmt.
4. **Getesteter Render-Kern:** `packages/daemon/src/launchd-plist.ts`
   (`renderLaunchDaemonPlist`/`validateLaunchDaemonContext`/`assertRenderedPlistClean`)
   — rein, fail-closed: erzwingt absolute Pfade, nicht-leere Werte, keine im Output
   verbliebenen `{{…}}`/`__…__`-Platzhalter. Der Installer kann sein `sed`-Ergebnis
   gegen denselben `assertRenderedPlistClean`-Vertrag prüfen.
5. **Bootstrap/Uninstall:** `sudo launchctl bootstrap system /Library/LaunchDaemons/…`
   bzw. `launchctl bootout system …` + Plist löschen im `--uninstall`-Zweig.

## Umsetzungsstatus (dieser PR)

**Enthalten (deploy-frei, getestet):**
- ADR-029 (dieses Dokument).
- `com.thinklocal.daemon.plist.template` (System-Domain-Variante).
- `launchd-plist.ts` Renderer/Validator + 15 Unit-Tests (`launchd-plist.test.ts`),
  inkl. Regressionstest „Template enthält keine hartkodierten Benutzer-/Pfad-Literale".

- `launchd-plist.ts` Renderer/Validator + Unit-Tests (`launchd-plist.test.ts`),
  inkl. Regressionstest „Template enthält keine hartkodierten Benutzer-/Pfad-Literale".

**Operationalisierung (v0.34.24, deploy-frei nachgezogen):**
- `install_macos_service` (`scripts/install.sh`) auf **System-Domain** umgestellt:
  rendert das `.plist.template`, validiert fail-closed gegen verbliebene Platzhalter,
  schreibt nach `/Library/LaunchDaemons/` mit `root:wheel`/`644` und
  `launchctl bootstrap system`. Läuft als `${SUDO_USER}` (NICHT root; bricht ab, wenn
  der Service-Nutzer root wäre).
- **Migration** integriert: alter `~/Library/LaunchAgents/…`-LaunchAgent wird vor dem
  Bootstrap entladen + entfernt (kein Doppelstart); `cleanup_existing` + Uninstall via
  `bootout system`.
- **Getesteter Plan** (`buildLaunchDaemonInstallPlan` in `launchd-plist.ts`): Pfad/Domain/
  Rechte/Migration als EINE getestete Quelle; der Bash-Installer spiegelt sie.
- Das Editieren des Skripts ist **deploy-frei** — es wird hier NICHT ausgeführt.

**NICHT enthalten (bewusst — Christians Deploy-Gate):**
- Tatsächliches Ausführen von `install.sh`/`bootstrap system` auf einem Host.
- Anlage des dedizierten Service-Benutzers (Infra).
- Live-Install/Reboot-Test (FileVault = Christian).

Diese Schritte sind **Run-/Deploy-Operationen**, die ausdrücklich Christians Freigabe
brauchen; Template, getesteter Render-Kern + Install-Plan + die Installer-Verdrahtung sind
die Voraussetzung und hier vorab abgesichert.

## Konsequenzen

- **+** Headless/FileVault-tauglicher, durable Start; durable Env; kein still
  kaputtes Service-File mehr (fail-closed Render).
- **+** Least-Privilege (dedizierter Benutzer statt root, statt am GUI-Login hängend).
- **−** System-Domain braucht `sudo` beim Install/Uninstall (einmalig, Christian).
- **−** Ein dedizierter Service-Benutzer muss existieren/angelegt werden (Install-Schritt).
- **Migration:** bestehende LaunchAgent-Installationen müssen einmalig
  `launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist` + Datei
  entfernen, bevor der System-Daemon bootstrapt wird (Doppelstart vermeiden) —
  Teil des späteren Installer-Umbaus.
