# changes/2026-07-20 — feat(mcp): TL-21 Peer-Skelett als MCP-Tool (`list_peers_overview`)

**Typ:** additive, **read-only** MCP-Auskunft. **Kein** Christian-/Deploy-/Secret-Gate, **kein** neuer
State, **keine** Änderung an bestehendem Tool-/Endpoint-Verhalten. Setzt das im TL-21-Design (§4) als
optionales Folgeslice benannte MCP-Companion zur bereits gemergten REST-Peer-Übersicht (`GET /api/peers/overview`,
#303) um — genau die Slice-1 → Slice-2-Trennung, mit der schon `list_capabilities_overview` von seinem
REST-Zwilling getrennt wurde.

## Warum
`discover_peers` (MCP) und `GET /api/peers` (REST) liefern je (online-)Peer die **volle** Agent-Card inkl.
der kompletten `capabilities`-Arrays. Für die Erst-Orientierung „wer ist im Mesh?" ist das für einen Agenten
zu viel Kontext-Budget (Kap. 06). Ein Agent, der schon per MCP im Mesh arbeitet, hatte bisher **keine**
kompakte Skelett-Sicht auf die Peers — nur den REST-Umweg. Dieses Tool schließt die Lücke transport-symmetrisch.

## Was
- **`packages/daemon/src/mcp-server.ts`:** neues MCP-Tool `list_peers_overview` (keine Parameter), platziert
  direkt hinter `discover_peers` (analog zur REST-Nachbarschaft `/api/peers` → `/api/peers/overview`).
  - Ruft den **gemeinsamen** Envelope-Builder `buildPeerOverview(mesh.getOnlinePeers())` auf — **dieselbe
    reine Funktion und dieselbe Datenquelle** wie REST `GET /api/peers/overview` → strukturelle Parität,
    kein Drift (exakt das Muster von `list_capabilities_overview`/`buildCapabilityOverview`).
  - Kein neuer Builder, keine neue Projektion, kein neuer Mesh-Getter — reine Transport-Wiederverwendung.
  - Header-Kommentar (Tool-Liste) um den Eintrag ergänzt.
- **Tests (+4):** `mcp-server.test.ts` — echtes registriertes Tool via `_registeredTools[name].handler`
  invoked (nicht nur die reine Funktion, die in `peer-skeleton.test.ts` erschöpfend abgedeckt ist):
  (a) Registrierung unter exaktem Namen, (b) content **exakt** `buildPeerOverview(getOnlinePeers())` →
  Envelope-Parität mit REST, (c) leeres Mesh → `{ peers: [], count: 0 }` (kein throw), (d) geforgte
  Wire-Card-Daten (non-string version, non-array skills, unbekannter status) → Tool bleibt total, kein throw.

## Abgrenzung (bewusst außer Scope)
- **All-known statt online-only:** spiegelt bewusst dieselbe Quelle (`getOnlinePeers()`) wie REST → identische
  Nutzlast auf beiden Transporten. Eine Variante über alle bekannten Peers (inkl. offline) bräuchte einen
  neuen Mesh-Getter → eigener Slice (wie in #303 und TL-21 §4 festgehalten).
- **Tools/Tasks-Skelett** — dasselbe Muster später anwendbar, nicht in diesem Umfang.

## Compliance
- **CO:** entfällt — additive Read-View einer bereits konsentierten Design-Linie (TL-21-Design §4 benennt das
  MCP-Companion ausdrücklich als optionales Folgeslice; Präzedenz `list_capabilities_overview` Slice 2).
  Keine neue Architektur-Frage.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH; kein Boilerplate-Delegat nötig — Muster aus Slice 2).
- **TS ✅:** +4 Tests; Full-Suite **1828 grün** (134 Files), `tsc --noEmit` (strict) 0, eslint/prettier auf
  den geänderten Dateien 0.
- **CR ✅:** Diff-Review (code-review-Skill, medium; `agy` fehlt für `pal:codereview`). **Keine
  Korrektheits-Bugs**, kein HIGH/CRITICAL — die Änderung spiegelt 1:1 den bereits gemergten Slice-2-/Slice-3-Pfad
  (gemeinsamer Builder, same-source), nichts entfernt, keine neue Call-Site-Vorbedingung.
- **PC ✅:** Secret-Scan clean (keine Tokens/Keys im Diff).
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, TL-21-Design §4, die zwei
  Modul-/Testdateien.
