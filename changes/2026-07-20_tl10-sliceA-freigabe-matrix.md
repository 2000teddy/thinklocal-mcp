# changes/2026-07-20 — feat(gate): TL-10 Freigabe-Matrix Slice A (reiner Parser/Resolver/Guard)

**Typ:** Daemon-Feature (reines Modul, **KEINE** Verdrahtung). **Kein** Runtime-Change, kein Deploy/Secret/
Cross-Host. `mcp-ingress.ts`/`-api.ts` unangetastet.

## Warum
Der read-only **§5-CO** (`pal:consensus` opus 8/10 + sonnet 8/10, einstimmig) hat die 5 offenen §5-
Entscheidungen der TL-10-Scoping-Note mit Defaults versehen und **Slice A freigeschaltet**: das reine
`freigabe-matrix.ts` (Grammatik parsen, nichts durchsetzen) ist mit D1/D4/D5 als Vertrag schreibbar; nur
Slice B ist D2/D3-gated.

## Was
- **Neu `packages/daemon/src/freigabe-matrix.ts`** (reine Funktionen, deterministisch, kein I/O):
  - `parseFreigabeMatrix(raw, knownServers)` — **fail-closed**; `FreigabeMatrixError` bei JEDEM CO-§2.2-Verstoß:
    unbekannte Wurzel-/Eintrags-Keys, `entries` kein Array, ungültige `tier`, **tool-ohne-server** (server
    Pflicht), **non-kanonischer Server** (D4, gegen injizierte `knownServers`), leerer `channel`/`tool`,
    unbekannte `decider`-Grammatik, `human:` ohne id, `consensus` ohne `quorum=N` bzw. N<2, **Duplikat-
    Spezifität** (gleiche `tier|server|tool`). Leere/fehlende `entries` ⇒ gültige LEERE Matrix (D5).
  - `resolveEntry(matrix, ctx)` — spezifischster Eintrag (exakter `tool` > Wildcard `*`); kein Match ⇒ `null`.
  - `isRoutable(target)` — der **einzige** Auswertungspfad (analog `isApproved`): `null`/leerer Kanal/
    ungültiger Entscheider ⇒ `false`.
- **§5-CO-Vertrag (Slice A):** **D1** Quelle = eigene Datei `config/freigabe-matrix.toml` (Loader = Slice B;
  dieses Modul nimmt das geparste Objekt); **D4** Server-Prüfung gegen `resolveMcp`-`knownServers` (Parameter,
  kein I/O); **D5** kein Match/leer ⇒ nicht routable ⇒ Default-Deny 403.
- **`freigabe-matrix.test.ts` (+28 Tests):** Erfolg (human/consensus, exakt+Wildcard, Default-`*`, leere
  Matrix), jeder Parse-Reject, Resolver-Spezifität, `isRoutable`-Allowlist + End-to-End resolve→isRoutable.

## Abgrenzung (bewusst außer Scope — Slice B, gated)
- **D2** (Kanal-Bindung): `channelId`-Referenz + Registry-Zusatz `requestApprovalOn(channelId)` + Kanal-
  Liveness — reine Technik, aber Slice B (dieses Modul kennt die Registry nicht).
- **D3** (`decider: human:<id>`): v1 **rein deklarativ** — hier nur **Grammatik**-validiert, **NICHT**
  durchgesetzt. Braucht **Christian-Sign-off + SECURITY.md-Notiz** („deklarativ ≠ enforced") VOR Slice B, da
  ein `human:<id>`-Feld wie Zugriffskontrolle aussieht, es aber (noch) nicht ist. `consensus:quorum=N` bleibt
  ebenfalls nur parse-validiert (Consensus-Pfad = hartes 403).

## Compliance
- **CO ✅:** §5-CO (read-only `pal:consensus`, opus 8/10 + sonnet 8/10 einstimmig) → D1/D4/D5 als Slice-A-
  Vertrag; D2/D3 als Slice-B-Gate dokumentiert.
- **CG:** entfällt. **TS ✅:** +28 Tests; Full-Suite **1797 grün** (132 Files), `tsc --noEmit` (strict) 0,
  eslint neue Dateien 0.
- **CR:** externer Claude-Review-Subagent vor Merge (prüft: fail-closed-Vollständigkeit der Rejects,
  Spezifitäts-Determinismus, `isRoutable`-Guard-Disziplin, keine Verdrahtung).
- **PC:** `git diff` gesichtet, Secret-Scan clean.
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die zwei Modul-/Testdateien.
