# T1.1 — Daemon-Startpfad: `tsx` → `node dist/` (V5 Spur 1)

**Datum:** 2026-06-29 16:xx CEST
**Branch:** `claude/t11-tsx-to-node-dist`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Performance / Packaging — kein Verhaltens-/Protokoll-Change, kein Deploy
**V5-Bezug:** T1.1 (Spur 1, Status S) — Daemon-Startpfad von `tsx` (Runtime-Transpile, devDependency) auf vorkompiliertes `node dist/index.js` umstellen.

## Problem

Der scharfe Daemon lief über `tsx` (esbuild-Transpile zur Laufzeit). `tsx` ist
eine **devDependency** (root + daemon). Das kostet RAM (esbuild-Service +
Transpile-Cache) und Start-CPU. Zudem latent inkonsistent: der Deb-Postinst läuft
`npm install --omit=dev` — installiert `tsx` also gar nicht, während die systemd-
Unit `node --import tsx …/src/index.ts` startete.

## Messung (Beleg)

Identische Env je Lauf (`TLMCP_NO_TLS=1`, `TLMCP_MDNS_ENABLED=0`, temp Data-Dir,
unique Ports), Single-Process im systemd-Stil (`node --import tsx src/index.ts`
vs. `node dist/index.js`), Settle 12s (nach erstem Heartbeat @10s), Median aus 3
Läufen, Node v22.22.3:

| Variante | RSS (Median) | Start-CPU (Median, bis 12s) |
|---|---|---|
| **vorher** `tsx` / `src` | **201 MiB** | **2.08 s** |
| **nachher** `node dist/` | **132 MiB** | **1.19 s** |
| **Delta** | **−69 MiB (−34 %)** | **−0.89 s (−43 %)** |

Rohwerte (RSS MiB je Lauf): tsx = 201 / 219 / 196 · node-dist = 132 / 130 / 169.
Harness: `/tmp/tl-measure.sh` (nicht im Repo — reine Messung, keine Quelle).

## Änderung

- **`package.json`** (root): `start` + `daemon:start` → `npm run daemon:build && node packages/daemon/dist/index.js`. `start:tsx` als Dev-Fallback (Hot-Iteration) ergänzt. `daemon:build` (=`tsc`) unverändert.
- **`scripts/build-deb.sh`**: tsc-Build (`cd packages/daemon && npm run build`) + Guard auf `dist/index.js` **vor** `cp -r packages` (dist wird ins .deb übernommen). systemd `ExecStart` und `tlmcp-daemon`-Wrapper → `node …/dist/index.js` (kein `--import tsx` mehr). `dist` überlebt das spätere `rm -rf …/node_modules` (liegt nicht unter `node_modules`).
- **`packages/daemon/src/start-path.test.ts`** (neu): Regressionstest — Daemon-Startpfad zeigt auf `dist`, enthält kein `tsx` (Loader-form-agnostisch); build-deb hat Build-Schritt + Guard. **Empirisch bewiesen:** ExecStart→tsx zurückgedreht ⇒ 1 rot; restauriert ⇒ 4 grün.

## Bewusst NICHT im Scope (T1.1 = Daemon-only)

Die CLI-Wrapper `thinklocal` und `tlmcp-mcp` laufen weiter über `--import tsx`
(`src/*.ts`). Das ist **vorbestehend**, nicht durch diesen Slice verschlechtert —
der Daemon wird hier sogar von der `--omit=dev`/tsx-Inkonsistenz *befreit*.
**Follow-up:** CLI/mcp-Wrapper ebenfalls auf dist umstellen ODER `tsx` zur
runtime-`dependency` machen (separater Slice).

## Live-Cutover (gated, NICHT Teil dieses Repo-Slices)

TH01 läuft den Daemon aktuell via `tsx`/`src` aus dem git-Checkout (RUNBOOK-D1).
Für den Live-Umstieg braucht der Deploy künftig ein `npm run build` nach
`git pull` vor dem Restart. Das ist ein **gateter Deploy-Schritt** (Christian),
kein Bestandteil dieses PRs.

## Tests

- Volle Daemon-Suite grün: **96 Files / 1178 Tests** (inkl. neuem `start-path.test.ts`).
- `bash -n scripts/build-deb.sh` clean. `npm run daemon:build` erzeugt `dist/index.js`. Daemon bootet via `node dist/index.js` (3× im Messlauf verifiziert).

## Review

- `pal:codereview` (gemini-3.1-pro-preview) — strukturierter Durchlauf; externer Validator-Backend (`agy`) im Env nicht installiert, daher zusätzlich:
- Unabhängiges **Claude**-Review (Subagent) auf den Diff: **APPROVE-WITH-NITS**, alle Findings low/info, kein HIGH/CRITICAL. Einziger PR-Hinweis = der oben genannte vorbestehende CLI/mcp-tsx-Scope-Rand.
