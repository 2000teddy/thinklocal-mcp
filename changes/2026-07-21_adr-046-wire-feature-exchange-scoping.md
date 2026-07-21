# changes/2026-07-21 — docs(arch): ADR-046 Wire-Feature/Version-Exchange (Scoping)

**Typ:** **doc-only** Scoping/ADR (Design-Discovery, Status **Proposed**; **kein** Code/Test/Config-Change;
kein Christian-/Deploy-/Secret-Gate). Präzedenz: `TL-12-slice-b/c-scoping.md`.

## Warum
Der TL-12-Slice-C-Park (PR #307) benannte als ehrlichen nächsten Baustein **nicht** Slice C, sondern den
fehlenden Mechanismus, mit dem ein Sender „Peer ≥ Feature X" fail-closed entscheiden kann. KW30-Auftrag:
genau diesen Prerequisite doc-first scopen, gegen realen Code geerdet — statt Slice-C-Code zu forcieren.

## Ergebnis: ADR-046 (Proposed), Groundwork ist additiv/machbar
Repo-Ist-Stand (geerdet):
- **Fehlt:** `AgentCard` (`agent-card.ts:22-111`) trägt `version`/`build.version`, aber **kein**
  `protocol_version`/`features` — kein Wire-Feature-Signal. `version-compat.ts` (`PROTOCOL_VERSION`,
  `FEATURE_MATRIX`, …) ist **außerhalb Tests nirgends aufgerufen** (totes Gerüst).
- **Existiert schon (Consumer-Seite):** die gefetchte Card wird nach mTLS+Identitäts-Check pro Peer gehalten
  (`mesh.updateAgentCard`, `mesh.ts:189`; `MeshPeer.agentCard`, `mesh.ts:20`) und ist über `mesh.getPeer`
  (`mesh.ts:258`) lesbar; Fetch ist pinned (`pinned-card-fetch.ts:35`). Parse ist tolerant
  (`as AgentCard`-Cast, `index.ts:1491,1553`) → additives Feld bricht alte Peers nicht.

Vorgeschlagenes Design (Details in ADR-046): additiver **optionaler** `protocol`-Block
(`protocol_version`/`min_compatible_version`/`features[]`) aus `version-compat.ts`; reiner **fail-closed**
Consumer-Helper (`absent/unknown ⇒ unsupported`); Seed-Feature `order-envelope-v2`. Entsperrt Slice-C-V2
(Gate evaluierbar); V1/V3 bleiben eigenen Slices.

## Warum doc-first (kein Code jetzt)
Das Feature-Vokabular + die Semver-Governance sind ein Wire-Contract-Beschluss → **CO vor Code** (CLAUDE.md).
Cross-Vendor-`pal:consensus` ist aktuell pal-PATH-blockiert. Daher ADR **Proposed** + expliziter Impl-Scope,
nicht vorgezogener Producer-Code, der das Vokabular verfrüht festnagelt.

## Umfang
`docs/architecture/ADR-046-wire-feature-version-exchange.md` (neu), `TODO.md` (neuer Prereq-Eintrag unter
TL-12), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag. **Kein** Code/Test/Schema/Deploy/Secret.
Risiko-Delta **null**.
