# T1.1 — Daemon-Start von tsx auf kompiliertes `node dist/` umstellen (Launch-Configs)

**Datum:** 2026-06-30
**Branch:** `claude/t11-node-dist-start`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Performance/Härtung (Runtime-Umstellung) — kein Deploy, repo-intern
**V5-Bezug:** Spur 1 T1.1 (D, S); Belegt-erst V5 §H

## Problem

Der **langlaufende Daemon** wurde über `tsx` gestartet (`node_modules/.bin/tsx src/index.ts`),
also TypeScript-Transpilation zur Laufzeit via residenter esbuild-Pipeline. Das kostet RSS,
einen zusätzlichen Loader-Prozess und Startzeit. Schwerwiegender: `tsx` ist eine
**devDependency** — ein Produktions-Install mit `npm install --omit=dev` installiert sie
gar nicht, sodass ein tsx-basierter Start dort **schlicht fehlschlägt**.

Teilweise war T1.1 schon erledigt (PR #210: root/daemon `package.json`-Scripts + `build-deb.sh`
liefen bereits über `dist/`, abgesichert durch `start-path.test.ts`). **Nicht** umgestellt waren
die realen Launch-Configs: der vom Installer generierte systemd-User-Service, die statischen
Service-/Plist-Templates, die macOS-`service.sh` und der Windows-Task. Diese starteten den
Daemon weiterhin via tsx.

## Messung (Belegt-erst, V5 §H)

Reproduzierbare Harness (temp data-dir, `TLMCP_NO_TLS=1`, eigener Port, RSS des Prozessbaums
nach Boot+Settle, 2 Läufe je Variante):

| Metrik | VORHER (tsx) | NACHHER (node dist/) | Δ |
|---|---|---|---|
| RSS (Prozessbaum) | ~256–273 MB | ~165–167 MB | **−~100 MB (≈ −37 %)** |
| Prozesse | 2 (node + tsx/esbuild) | 1 | **−1 Loader-Prozess** |
| Boot-bis-ready | ~1.0–1.14 s | ~0.62–0.73 s | **≈ −35 %** |

(CPU-Zeit nicht als Headline geführt — die Messung erfasst die esbuild-Kindprozess-Zeit der
tsx-Variante nicht zuverlässig; RSS + Prozesszahl + Boot sind die belastbaren Metriken.)

## Änderungen

- **`scripts/install.sh`**: Build-Schritt (`npx tsc` + `dist/index.js`-Guard) in `install_deps`
  ergänzt — läuft VOR `install_macos_service`/`install_linux_service`. Generierter
  systemd-User-ExecStart: `$NODE_PATH $TSX_PATH $INDEX_PATH` → `$NODE_PATH $INDEX_PATH`
  (INDEX_PATH = `dist/index.js`). `TSX_PATH` für den Daemon entfernt.
- **`scripts/service/thinklocal-daemon.service`** (statisch): ExecStart → `dist/index.js`.
- **`scripts/service/com.thinklocal.daemon.plist.template`** + **`…plist`** (Legacy):
  `ProgramArguments` von 3 Einträgen (node, tsx, src/index.ts) auf 2 (node, dist/index.js).
- **`scripts/service/service.sh`** (macOS Legacy-LaunchAgent, **CR-HIGH-Fix**): neuer
  `ensure_daemon_built`-Guard baut/garantiert `dist/index.js` VOR `render_plist`/`bootstrap` —
  sonst würde launchd ein fehlendes File starten.
- **`scripts/service/thinklocal-daemon.ps1`** (Windows, **CR-MEDIUM**): Scheduled-Task-Entry
  → `dist\index.js` (Konsistenz; Windows bleibt v1-out-of-scope).
- **`scripts/ssh-bootstrap-trust.sh`**: Restart-Hinweis `pkill -f 'tsx.*src/index.ts'` →
  `pkill -f 'daemon/dist/index.js'` (matchte den dist-Prozess sonst nicht).

**Bewusst NICHT umgestellt** (out of scope T1.1, wie PR #210 / `build-deb.sh`): die
on-demand CLI-Wrapper `thinklocal.ts` und die `mcp-stdio.ts`-Bridge laufen weiter über tsx.

## Tests

- **`packages/daemon/src/launchd-plist.test.ts`** (+1): rendert das echte Plist-Template,
  pinnt `ProgramArguments == [node, dist/index.js]`, kein tsx/src.
- **`packages/daemon/src/start-path.test.ts`** (+6): install.sh-ExecStart + Build-Guard,
  statisches `.service`, Legacy-Plist, `service.sh`-Guard (CR-HIGH-Regression, inkl.
  Reihenfolge vor `render_plist`), `ssh-bootstrap`-pkill, `.ps1`-Entry.

Volle Suite **104 Files / 1256 grün**, tsc 0, eslint 0, bash -n grün. Empirischer Beleg:
Plist-Template auf tsx zurückmutiert ⇒ T1.1-Test rot, restauriert ⇒ grün. Smoke: `node dist/index.js`
bootet vollständig durch (Identity/TLS/Vault/Skills).

## Was dieser Slice NICHT tut

Kein Deploy, keine Live-Service-Neuinstallation. Reine Repo-Umstellung der Launch-Definitionen
+ Build-Schritt + Tests. Die scharfe Service-Neuinstallation bleibt Christians Deploy-Gate.
