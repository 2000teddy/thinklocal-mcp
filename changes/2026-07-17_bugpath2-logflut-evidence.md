# changes/2026-07-17 — docs(kw29): Bug-Pfad 2 Log-Flut konsolidierter Beleg + Issue-Vorlage

**Typ:** Doc-only (KW29-Freitag-Deliverable „saubere Belegdatei/Issue-Vorlage"). **Kein** Code/Runtime-Change,
**kein** Deploy/Secret/Christian-Gate.

## Warum
Der KW29-Plan (`WOCHENPLAN-KW29.md`, Fr) verlangt „Logrotation + PATH-/`mount`-Fehler **einsortieren**, saubere
**Belegdatei/Issue-Vorlage**". Bislang war nur die **eine** Hälfte belegt (mount-Flood: DIAGNOSE + VERIFY +
Fix #273). Die **zweite** Hälfte aus §0.2 („Logs laufen aus dem Ruder") — **unbegrenztes Log-Wachstum ohne
Rotation** — war weder dokumentiert noch als offener Posten sichtbar. Es fehlte ein konsolidiertes Bug-Pfad-2-
Dokument, das beide Hälften trennt und den offenen 2b-Gap belegt.

## Was
- **Neu `docs/BUGPFAD-2-logflut-status.md`:** konsolidierter Beleg + copy-paste-Issue-Vorlage.
  - **2a mount-Flood/PATH:** repo-seitig GESCHLOSSEN (#273 `f57ae5a`, 7 Unit-PATH-Stellen, Regression-Test
    `launchd-plist.test.ts` 25 grün), `.55`-Live-Beleg operator-/deploy-gated (Runbook VERIFY-55). Cross-Link
    auf DIAGNOSE + VERIFY.
  - **2b unbegrenztes Log-Wachstum:** OFFEN, mit verifizierter Evidenz — append-only Senken
    (`com.thinklocal.daemon.plist:37/40`, `thinklocal-daemon.service:25-26`), Logger nach stdout
    (`logger.ts:5-11`, pino `destination:1`, kein rotierender Transport), **kein** Rotations-/Cap-/newsyslog-/
    logrotate-Mechanismus im Repo (Grep-Falsifikation negativ). Optionen (macOS `newsyslog.d` / Linux
    `logrotate` / daemon-seitig `pino-roll`) skizziert, **nicht** umgesetzt (Weg-Wahl = CO).
- **`TODO.md`:** Bug-Pfad-2-Eintrag ergänzt (fehlte) — 2a `[x]`, 2b `[ ]`.

## Abgrenzung
Reines Einsortieren/Belegen. **Fixt 2b nicht** (eigener Deploy-/Unit- oder Code-Slice mit CO). 2a bleibt bis
zum `.55`-Live-Beleg end-to-end offen — nicht aus diesem Repo erreichbar.

## Compliance
- **CO/CG:** entfallen — Doc-only, keine Design-Entscheidung getroffen (2b-Weg-Wahl explizit an CO delegiert).
- **TS:** entfällt (kein Code); volle Suite dennoch **1746 grün** (127 Files) als Regressions-Absicherung.
- **CR:** Doc-Accuracy-Subagent (adversarial, jede Datei:Zeile gegen das Repo geprüft, „no rotation"
  aktiv falsifiziert) — **kein HIGH/MEDIUM**; 1 LOW (`maxBytes`-Label präzisiert) gefixt.
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku + TODO).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, das neue Beleg-Dokument.
