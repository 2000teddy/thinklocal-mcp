# ADR-046 — Wire-Level Feature/Version-Exchange über die Agent-Card

**Status:** Proposed (Scoping — doc-first, **kein Code** in diesem ADR; Implementierung CO-gated Folge-Slice)
**Datum:** 2026-07-21
**Kontext-Task:** Folgt direkt aus dem TL-12-Slice-C-Park (`TL-12-slice-c-scoping.md`, PR #307). Der Park nannte
als „ehrlichen nächsten Baustein" **nicht** Slice C selbst, sondern den fehlenden Mechanismus, mit dem ein
Sender „Peer ≥ Feature X" überhaupt entscheiden kann. Dieses ADR pinnt dessen Design gegen den realen Code.
**CO:** aufgeschoben auf die Implementierung. Dieses ADR trifft **keine bindende Wire-Contract-Entscheidung**,
sondern schlägt sie vor; der Feature-Vokabular-/Semver-Beschluss braucht CO vor Code (Cross-Vendor-`pal:consensus`
derzeit pal-PATH-blockiert, `[[pal-review-backend-agy-missing]]`).

## Problem
Mehrere gated Slices (allen voran TL-12 Slice C: „first-class `MessageType='ORDER'`, **sobald Peers ≥ dieser
Version**") brauchen ein **maschinen-prüfbares Signal**, ob ein bestimmter Peer eine Wire-Fähigkeit unterstützt.
Dieses Signal existiert heute **nicht**:

- **Kein Wire-Feature/Version-Austausch im Message-Pfad.** `version-compat.ts` (`PROTOCOL_VERSION='1.0.0'`,
  `MIN_COMPATIBLE_VERSION='0.20.0'`, `FEATURE_MATRIX`, `checkCompatibility`/`isFeatureAvailable`/`meetsMinVersion`)
  ist vollständig implementiert, wird aber **außerhalb von Tests nirgends aufgerufen** — totes Gerüst.
- **Die Agent-Card trägt keine Protokoll-/Feature-Ebene.** `AgentCard` (`agent-card.ts:22-111`) hat `version`
  (l.24) + `build.version` (l.27) — einen **Build-Stempel**, aber keine `protocol_version` und keine
  `features`-Liste. `capabilities` (l.36-41) meint App-Fähigkeiten (agents/skills/services/connectors), **nicht**
  Wire-Protokoll-Features.
- Folge: Ein Sender kann nicht fail-closed entscheiden „dieser Peer versteht top-level ORDER". Ein Flip wäre
  still-droppend (top-level ORDER fällt in den `default`-Drop `index.ts:932-934`).

## Ist-Stand (geerdet — was schon da ist)
Die **Konsumenten-Seite existiert bereits vollständig**, nur die annoncierte Feld-Seite fehlt:

1. **Card wird pro Peer gehalten.** `MeshPeer.agentCard: AgentCard | null` (`mesh.ts:20`); nach mTLS-Fetch +
   Identitäts-Check (`index.ts:1491-1500`: `card.spiffeUri`==discovered && `sha256(publicKey)`==certFingerprint)
   setzt `mesh.updateAgentCard(agentId, card)` (`mesh.ts:189-192`) die **volle** Card auf den Peer-Record.
2. **Getter existiert.** `mesh.getPeer(agentId)` (`mesh.ts:258`) → ein Sender könnte zur Sendezeit
   `getPeer(uri)?.agentCard?.protocol?.features` lesen.
3. **Fetch ist bereits pinned/authentisch.** `fetchAgentCardPinned` (`pinned-card-fetch.ts:35`) + der
   Identitäts-Check binden die Card-Inhalte an die **gepinnte** Peer-Identität → ein annonciertes Feature ist
   dem verifizierten SPIFFE/Cert zurechenbar (keine Spoofing-Fläche über die reine Card).

Damit ist das Groundwork **additiv und low-risk**: es fehlt genau **ein annonciertes Feld** + ein reiner
Consumer-Helper. Kein neuer Transport, kein neuer Fetch, kein State-Store.

## Entscheidung (vorgeschlagen)

### 1. Agent-Card bekommt einen additiven `protocol`-Block
```ts
// AgentCard (additiv, optional — alte Peers/Cards ohne das Feld bleiben gültig)
protocol?: {
  protocol_version: string;        // aus version-compat.PROTOCOL_VERSION
  min_compatible_version: string;  // aus version-compat.MIN_COMPATIBLE_VERSION
  features: string[];              // Wire-Feature-Flags, die DIESER Node beim Empfang beherrscht
};
```
- **Producer** (`AgentCardServer.buildCard`, agent-card.ts): füllt `protocol` aus `version-compat.ts` +
  einer **Feature-Registry** (die real vom Node unterstützten Empfangs-Features).
- **`features` ist Empfänger-Semantik**: „ich kann X entgegennehmen", nicht „ich sende X". Genau das braucht
  ein Sender für ein receiver-first-Gate.

### 2. Consumer-Helper (rein, fail-closed)
```ts
// z.B. peerSupportsFeature(uri, feature): boolean
//   liest mesh.getPeer(uri)?.agentCard?.protocol?.features
//   ABSENT / unbekannt / kein protocol-Block  ⇒  false (unsupported)
```
Fail-closed ist zwingend: ein Peer ohne `protocol`-Block (alte Version) gilt als **nicht** feature-fähig →
der Sender behält die kompatible Trägerform (heute: den ORDER-Body-Marker). **Niemals** „absent ⇒ assume yes".

### 3. Feature-Vokabular (seed, in Registry neben `FEATURE_MATRIX`)
- Erstes Flag: `order-envelope-v2` — „kann eine **top-level** `MessageType='ORDER'`-Envelope entgegennehmen".
  Genau das Signal, das TL-12 Slice C zum ehrlichen Flip braucht.
- Das Vokabular (Namen, Semver-Politik für `protocol_version`, ob Flags je additiv/nie-entfernt) ist der
  **CO-pflichtige Beschluss** vor Implementierung.

### 4. Rückwärtskompatibilität
- Additives **optionales** JSON-Feld. Der Consume-Pfad castet heute `await res.json() as AgentCard`
  (`index.ts:1491`, `:1553`) — **kein** strenger Schema-Reject → alte Peers, die das Feld nicht senden,
  werden **nicht** abgelehnt; neue Peers, die es senden, brechen alte Peers nicht (unbekanntes Feld ignoriert).
- Kein Verhaltens-Delta ohne einen zweiten, separaten Slice, der das Gate tatsächlich **liest**.

## Wie das TL-12 Slice C entsperrt (receiver-first, unverändert)
1. **Dieses Groundwork** (Producer-Feld + Consumer-Helper) fleet-weit ausrollen → ab jetzt ist „Peer ≥ Feature"
   evaluierbar (löst Slice-C-Vorbehalt **V2**).
2. **Empfänger-Handler** für top-level ORDER + Inbox-Mapping als eigene ADR (Slice-C-Vorbehalt **V3**), fleet-weit.
3. **Sender-Flip** nur, wenn `peerSupportsFeature(peer, 'order-envelope-v2')` für den adressierten Peer `true`
   ist; sonst Marker (löst **V1** — kein stiller Drop).

## Umfang / Abgrenzung
- **In der Implementierungs-Folge-Slice (nach CO):** `protocol`-Block im Producer, `version-compat`-Verdrahtung,
  Feature-Registry, reiner Consumer-Helper + Unit-Tests (Producer füllt korrekt; Helper fail-closed bei
  absent/unknown/leer; Backward-Parse alter Cards).
- **NICHT hier und NICHT in dieser Folge-Slice:** der ORDER-Empfänger-Handler, der Sender-Flip, jegliche
  Änderung am ORDER-Marker-Pfad — das bleibt TL-12 Slice C proper.
- **Kein** Deploy/Secret/gated Activation. Kein Runtime-Verhaltenswechsel, bis ein Leser-Slice das Gate nutzt.

## Konsequenzen
- **+**: aktiviert die tote `version-compat`-Maschinerie an genau dem Punkt (Card), der ohnehin authentisch
  pro Peer ausgetauscht + gehalten wird; nutzbar über Slice C hinaus (jedes künftige receiver-first-Wire-Feature).
- **+**: Feature-Advertisement ist **kein** Trust-Grant — Ausführungs-/Nachrichten-Gates (pairing, Slice-B
  allowlist) bleiben unberührt; die Card sagt nur „ich kann Form X parsen".
- **−/offen (CO):** Vokabular-/Semver-Governance; ob `protocol.features` der richtige Ort ist vs. Wiederverwendung
  von `capabilities.services`. Vorschlag: eigener `protocol`-Block, weil Wire-Semantik ≠ App-Capability.

## Beleg-Referenzen (Code, HEAD)
`agent-card.ts:22-111` (AgentCard, kein protocol/features) · `version-compat.ts` (tot außerhalb Tests) ·
`mesh.ts:20,189-192,258` (per-Peer Card + Getter) · `index.ts:1491-1502,1553` (Fetch+Identitäts-Check+Store,
`as AgentCard`-Cast) · `pinned-card-fetch.ts:35` (pinned Fetch) · `index.ts:932-934` (default-Drop) ·
`TL-12-slice-c-scoping.md` (V1–V3).
