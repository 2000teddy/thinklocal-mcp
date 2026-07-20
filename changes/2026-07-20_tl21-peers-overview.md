# changes/2026-07-20 — feat(api): TL-21 Peer-Skelett-Auskunft (`GET /api/peers/overview`)

**Typ:** additive, **read-only** Daemon-Auskunft. **Kein** Christian-/Deploy-/Secret-Gate, **kein** neuer
State, **keine** Änderung an bestehendem Endpoint-Verhalten. Setzt das im TL-21-Design (§4) als „dasselbe
Muster später" benannte Skelett-Folgeslice um — nach `capabilities/overview` (Slice 1/2) jetzt für **Peers**.

## Warum
`GET /api/peers` liefert je (online-)Peer die **volle** Agent-Card inkl. der kompletten `capabilities`-Arrays
(agents/skills/services/connectors) und des numerischen `health`-Objekts. Für die Erst-Orientierung „wer ist
im Mesh?" ist das zu viel Kontext-Budget (Kap. 06). Die Skelett-Sicht gibt **ein kompaktes Signal-Set pro
Peer**; Details bleiben auf Abruf über das unveränderte `GET /api/peers`.

## Was
- **Neu `packages/daemon/src/peer-skeleton.ts`** — reine, deterministische Projektion (kein Date/Random,
  kein I/O), analog `capability-skeleton.ts`:
  - `PeerSkeletonEntry = { agent_id, name, status, version|null, skills:number, load_percent:number|null }`.
  - `buildPeerSkeleton(peers)` — ein Eintrag pro Peer, sortiert nach `agent_id` (locale-unabhängiger
    Comparator, Cross-Host-Determinismus). **Total gegen malformed/geforgte Agent-Card-Daten**
    (untrusted Wire-Quelle): non-string `agent_id`/`name`/`version` → `''`/`null`, `skills` non-array → `0`,
    `load_percent` NaN/Infinity/non-number → `null`, unbekannter `status` → `'unknown'`. Kein throw → die
    additive Read-View kippt **nicht** in einen 500er (gleiche Härtungs-Klasse wie CR-MEDIUM #281).
  - `buildPeerOverview(peers)` — Envelope `{ peers, count }`, `count === peers.length` (EINE Quelle der
    Wahrheit, wie `buildCapabilityOverview`; ein späteres MCP-Tool teilt denselben Builder → keine Drift).
- **`dashboard-api.ts`:** neuer Endpoint `GET /api/peers/overview` (rate-limited wie die Nachbarn),
  **same-source** wie `GET /api/peers` (`mesh.getOnlinePeers()`) → kein neuer Daten-/Identitätspfad.
- **Tests (+15):** `peer-skeleton.test.ts` (12 — Projektion, Sortier-Determinismus, sieben Malformed-/
  Totality-Regressionen, Envelope) + `dashboard-api.test.ts` (+3 — Endpoint-Wiring, leere-Liste,
  malformed-Card→200-kein-500).

## Abgrenzung (bewusst außer Scope)
- **MCP-Tool** (`list_peers_overview`, dieselbe reine Projektion als Agent-transport) — nächstes optionales
  Folgeslice, exakt wie Slice 1 → Slice 2 bei den Capabilities getrennt wurde (klein/separat reviewbar).
- **All-known statt online-only:** die Übersicht spiegelt bewusst dieselbe Quelle (`getOnlinePeers()`) wie
  `GET /api/peers` (Verhaltensparität; `status` ist dort wie hier faktisch immer `online`). Eine Variante
  über alle bekannten Peers (inkl. offline, vgl. `peers_known`/Phantom-ROT-Observability) bräuchte einen
  neuen Mesh-Getter → separater Slice, nicht in diesem minimalen Umfang.
- Paginierung/Volltextsuche (Peer-Menge ist heute klein) — außer Scope, wie im TL-21-Design.

## Compliance
- **CO:** entfällt — additive Read-View einer bereits konsentierten Design-Linie (TL-21-Design §2/§4 benennt
  „Skelett für Peers/Tools/Tasks" ausdrücklich als dasselbe Muster; Präzedenz #278 „additive Observability").
  Keine neue Architektur-Frage.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH; kein Boilerplate-Delegat nötig — Muster aus Slice 1/2).
- **TS ✅:** +15 Tests; Full-Suite **1824 grün** (134 Files), `tsc --noEmit` (strict) 0, eslint neue
  Dateien 0, prettier neue Dateien clean.
- **CR ✅:** Diff-Review (code-review-Skill, medium; `agy` fehlt für `pal:codereview`). **Keine
  Korrektheits-Bugs**; 1 LOW (helper-Duplikat `asStr`/`cmpStr` — bewusst belassen, spiegelt die
  per-Modul-private-Konvention von `capability-skeleton.ts`; Extraktion würde eine gemergte Datei anfassen).
  **Kein HIGH/CRITICAL** → keine Fix-/Regressionspflicht.
- **PC ✅:** `git diff` gesichtet, Secret-Scan clean (keine Tokens/Keys). `dashboard-api.ts` war bereits vor
  dieser PR nicht prettier-clean → **nicht** ganz-Datei-reformatiert (nur die 11 additiven Zeilen, Stil der
  Nachbar-Endpoints), um Fremd-Churn zu vermeiden.
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, TL-21-Design §4, die zwei
  Modul-/Testdateien.
