# Prompt fuer Claude Code auf dem Mac Mini — Genesis-Blob produzieren

Kopiere den folgenden Block in deine Claude-Code-Session auf dem Mac Mini.
Er enthaelt allen noetigen Kontext.

---

Hallo Claude. Du bist auf dem **Mac Mini (`minimac-60`, IP 10.10.10.94)**.
Repo-Pfad: `~/Entwicklung_local/thinklocal-mcp`.

## Aufgabe

Erzeuge den **Production-Genesis-Blob** fuer ADR-020 v1, commit ihn auf den
Branch `agent/macbook/registry-replication-recovery-v1` und pushe.

## Hintergrund (in zwei Saetzen)

Der MacBook hat PR #134 mit dem CRDT-Sync-Fix aufgemacht. Damit alle Daemons
im Mesh aus demselben Automerge-History-Tree starten, muss der
`REGISTRY_GENESIS_BLOB_BASE64` in `packages/daemon/src/registry.ts` durch
einen echten Blob ersetzt werden — nicht der `__GENESIS_PLACEHOLDER__`-String.

Details siehe `docs/HANDOVER-MINIMAC-POST-MERGE.md` und ADR-020 Abschnitt
"v1.0 Shared Genesis-Doc".

## Konkret zu tun

1. **Branch checkouten + Pull**:
   ```bash
   cd ~/Entwicklung_local/thinklocal-mcp
   git fetch origin
   git checkout agent/macbook/registry-replication-recovery-v1
   git pull
   ```

2. **Blob produzieren** — Skript im Repo erzeugen (damit es reproduzierbar
   und ueberpruefbar ist), nicht inline:

   ```bash
   cat > packages/daemon/scripts/produce-genesis-blob.mjs <<'EOF'
   /**
    * Erzeugt den REGISTRY_GENESIS_BLOB_BASE64 fuer ADR-020 v1.
    * Output ist deterministisch fuer den gleichen Input — der Blob
    * darf nach Erst-Deploy NICHT mehr veraendert werden, sonst
    * bricht Sync zu bestehenden Nodes.
    */
   import * as Automerge from '@automerge/automerge';
   const doc = Automerge.from({ capabilities: {}, last_sync: {} });
   const blob = Automerge.save(doc);
   const b64 = Buffer.from(blob).toString('base64');
   process.stdout.write(b64);
   EOF
   ```

3. **Blob ausfuehren und ausgeben**:
   ```bash
   cd packages/daemon
   node scripts/produce-genesis-blob.mjs
   ```
   Output sind ~50-100 Byte Base64. Notiere ihn.

4. **In `packages/daemon/src/registry.ts` einsetzen**: ersetze die Zeile
   ```ts
   export const REGISTRY_GENESIS_BLOB_BASE64 =
     '__GENESIS_PLACEHOLDER__';
   ```
   durch den echten Wert. Stelle sicher, dass der Kommentar darueber
   den Genesis-Charakter weiterhin erklaert (nicht aus Versehen
   loeschen).

5. **Verifizieren mit einem Test**:
   - Schreibe einen kleinen Test `packages/daemon/tests/registry-genesis.test.ts`
     der prueft:
     * `REGISTRY_GENESIS_BLOB_BASE64 !== '__GENESIS_PLACEHOLDER__'`
     * Genesis kann via `Buffer.from(...,'base64')` + `Automerge.load()` geladen werden
     * Zwei `new CapabilityRegistry()` Instanzen koennen Caps austauschen (Mini-Sync)
   - `npx vitest run tests/registry-genesis.test.ts` muss gruen sein
   - Bestehende `npx vitest run tests/registry-sync-*.test.ts` (31 Tests) duerfen
     NICHT brechen

6. **TS-Check**: `npx tsc --noEmit` muss clean sein.

7. **Compliance-Pipeline minimal-Form** (Bug-Fix-PR, also CO+CG optional):
   - **TS** ✅ — neuer Test + bestehende 31 weiterhin gruen
   - **CR** ✅ — `pal:codereview` mit `gpt-5.5` oder `gemini-3-pro-preview`,
     Focus: Blob-Integritaet, Production-Guard noch wirksam?
   - **PC** ✅ — `pal:precommit` internal
   - **DO** ✅ — CHANGES.md Eintrag im `[Unreleased]`-Block + Hinweis in
     COMPLIANCE-TABLE.md
   - **Eintrag in COMPLIANCE-TABLE.md** als PR #140 (oder welche Nummer
     der Block jetzt hat)

8. **Commit + Push**:
   ```
   [claude-code/minimac] feat(daemon): ADR-020 v1.0 Production-Genesis-Blob produziert

   Ersetzt den __GENESIS_PLACEHOLDER__ in registry.ts durch den
   tatsaechlichen Base64-encoded Automerge-Genesis-Blob. Damit kann
   der Production-Guard greifen und ein 5-Node-Mesh-Deploy ist
   moeglich.

   Script in packages/daemon/scripts/produce-genesis-blob.mjs liegt
   bei fuer Reproduzierbarkeit / Audit.

   Test `tests/registry-genesis.test.ts` verifiziert Load-Round-Trip
   und Sync-Faehigkeit zwischen zwei Instanzen.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

9. **PR #134 nicht neu** — der Branch ist derselbe, der Push laesst den
   bestehenden PR weiterlaufen. `gh pr view 134 --web` oeffnen, dass
   der Push registriert wurde.

## Erwartetes Ergebnis

- PR #134 hat einen zusaetzlichen Commit auf dem Branch
- CI laeuft erneut, alle drei Checks gruen
- SeppiPeppi (`peppiseppiullmann-ci`) reviewt automatisch — Review-Outcome
  wird im PR sichtbar

## Was nicht tun

- **Den Blob NICHT in einem zweiten Folge-PR machen.** Er gehoert
  semantisch zum v1-Branch, sonst ist v1 unvollstaendig.
- **Den Blob NICHT in eine .env oder ein gitignore-File schreiben.** Er
  IST die Code-Konstante, kein Secret.
- **NICHT** den Placeholder-Default-Fallback in `loadGenesisDoc()`
  entfernen — der bleibt fuer Dev/Test wichtig, der Production-Guard
  schaltet ihn in NODE_ENV=production aus.

Frag mich (den User) zurueck, wenn etwas unklar ist. Wenn du fertig bist,
gib mir den exakten Blob-String, den du in registry.ts eingesetzt hast.
