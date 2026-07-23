# ADR-046 — Wire-Level Feature/Version-Exchange über die Agent-Card

**Status:** Proposed (Scoping — doc-first, **kein Code** in diesem ADR; Implementierung CO-gated Folge-Slice)
**Datum:** 2026-07-21 · **Rev. 2:** 2026-07-23 — Implementierungs-Anker gegen `e994e65` verifiziert
(drei `index.ts`-Anker der Erstfassung waren verschoben), fail-closed-Grenzen, Seed-Flag-Semantik und die
CO-Grenze als eigene Sektionen §5–§8. Weiterhin **kein Code**, weiterhin **kein** Beschluss.
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

## Umsetzungsstand
- **2026-07-22 — ungegateter Consumer-Kern gelandet:** `packages/daemon/src/wire-feature.ts`
  (`supportsFeature(advertisedFeatures, feature)`) kodifiziert die non-negotiable §2-Invariante
  (**fail-closed**: absent/unknown/leer/malformed ⇒ `false`, nie „absent ⇒ assume yes") als reinen,
  getesteten Primitiv. Bewusst **platzierungs- UND vokabular-agnostisch** — nimmt die annoncierte
  Feature-**Liste** (nicht die `AgentCard`) und den Feature-**Namen** als Parameter → nimmt **keine** der
  beiden CO-offenen Fragen (Card-Platzierung; Vokabular/Semver) vorweg, seedet kein Flag, ändert kein
  Runtime-Verhalten (kein Aufrufer). Die CO-gegatete Folge-Slice ruft diesen Kern mit
  `card.<platzierung>?.features`, sobald Platzierung + Vokabular per CO entschieden sind.
- **Weiterhin CO-gated (unverändert):** der `protocol`-Block auf der Card (Platzierung, §1), das
  Feature-Vokabular + `protocol_version`-Semver (§3), die Producer-Befüllung + `version-compat`-Verdrahtung.
  Cross-Vendor-`pal:consensus` derzeit pal-PATH-blockiert (`[[pal-review-backend-agy-missing]]`).

## 5. Implementierungs-Anker (verifiziert gegen `e994e65`, 2026-07-23)

Die Anker der Erstfassung (#308) stammen von einem älteren HEAD und sind teilweise **verschoben**. Diese
Sektion ist der geprüfte Stand — sie ersetzt Suchen durch Nachschlagen, wenn die CO-Entscheidung fällt.

### 5.1 Producer-Seite (das fehlende Stück)

| Was | Anker | Zustand |
|---|---|---|
| `AgentCard`-Interface (hier käme der `protocol`-Block hin) | `agent-card.ts:22-111` | unverändert korrekt; **kein** `protocol`/`features` |
| **Producer**, der die Card baut | `agent-card.ts:480` `private async buildCard()` | in der Erstfassung nur namentlich, jetzt gepinnt |
| Quelle der Werte | `version-compat.ts` `PROTOCOL_VERSION` (`:13`), `MIN_COMPATIBLE_VERSION` (`:16`), `FEATURE_MATRIX` (`:108`) | vollständig implementiert, **außerhalb von Tests kein Aufrufer** |

### 5.2 Consumer-Seite (existiert bereits)

| Was | Anker | Zustand |
|---|---|---|
| Card pro Peer gehalten | `mesh.ts:20` (`agentCard: AgentCard \| null`) | korrekt |
| Card wird gesetzt | `mesh.ts:189` `updateAgentCard` | korrekt |
| Getter für den Sender | `mesh.ts:258` `getPeer` | korrekt |
| Pinned Fetch | `pinned-card-fetch.ts:35` `fetchAgentCardPinned` | korrekt |
| fail-closed Kern | `wire-feature.ts` `supportsFeature` (#314) | **gelandet**, 0 Aufrufer |

### 5.3 Korrigierte Anker (Drift gegenüber #308)

| Beschreibung | #308 sagte | **tatsächlich (HEAD)** |
|---|---|---|
| Fetch + Identitäts-Check + Store (Discovery-Pfad) | `index.ts:1491-1502` | **`index.ts:1530-1541`** — `as AgentCard`-Cast `:1530`, sha256-Fingerprint-Vergleich + SPIFFE-Match `:1532-1533`, `updateAgentCard` `:1541` |
| zweiter Card-Consume-Pfad | `index.ts:1553` | **`index.ts:1592`** (Cast) / **`:1603`** (`updateAgentCard`) |
| `default`-Drop im Empfangs-Dispatch (Slice-C-Vorbehalt **V1**) | `index.ts:932-934` | **`index.ts:936-938`** (`default: log.debug('Unbekannter Nachrichtentyp'); return null;`) |

Es gibt außerdem einen **dritten** Card-Pfad (`index.ts:720`, Cast; Fetch bei `:631`/`:731`) — wer den
`protocol`-Block konsumiert, muss prüfen, ob alle Pfade denselben Identitäts-Check durchlaufen, bevor die
Card als Feature-Quelle gilt.

## 6. Fail-closed-Grenzen (nicht verhandelbar, unabhängig vom CO)

Diese Zusagen hängen **nicht** an der offenen Platzierungs-/Vokabular-Frage und gelten für jede Variante:

| Situation | Ergebnis | Warum |
|---|---|---|
| Peer ohne `protocol`-Block (alte Version) | **`false`** | „absent ⇒ assume yes" wäre ein stiller Drop beim Empfänger |
| Block da, `features` fehlt / kein Array / leer | **`false`** | malformed ist kein Freibrief |
| Feature nicht in der Liste | **`false`** | exakter String-Match, keine Präfix-/Fuzzy-Logik |
| Card gar nicht abrufbar / Peer unbekannt | **`false`** | kein Signal ist kein positives Signal |
| Card vorhanden, aber Identitäts-Check nicht bestanden | **`false`** (Card wird verworfen) | `index.ts:1532-1538` lehnt bereits ab — ein Feature darf nie aus einer nicht zurechenbaren Card stammen |

Kodifiziert ist das bereits in `wire-feature.ts` `supportsFeature` (#314): der **einzige** `true`-Pfad ist
„echtes Array enthält exakt diesen String"; die Funktion wirft nie. Ein Producer-Slice **darf diese
Semantik nicht aufweichen** — insbesondere nicht „Feature-Liste fehlt ⇒ von `protocol_version` ableiten".

**Feature-Advertisement ist kein Trust-Grant.** Die Card sagt ausschließlich „ich kann Form X parsen".
Pairing, Approval-Gates und die Slice-B-Allowlist bleiben unberührt und werden **nicht** durch ein
annonciertes Feature ersetzt oder abgeschwächt.

## 7. Seed-Flag `order-envelope-v2` — was es bedeutet und was nicht

- **Bedeutung (Empfänger-Semantik):** „dieser Node nimmt eine **top-level** `MessageType='ORDER'`-Envelope
  entgegen und verarbeitet sie" — **nicht** „dieser Node sendet ORDER so".
- **Wann ein Node es setzen darf:** erst wenn sein Empfangs-Dispatch top-level ORDER wirklich behandelt,
  also **nach** dem Slice-C-Empfänger-Handler (V3). Vorher wäre das Flag eine Lüge, die beim Sender genau
  den stillen Drop auslöst (`index.ts:936-938`), den V1 beschreibt.
- **Wofür es NICHT steht:** keine Aussage über Ausführung (TL-12 Slice B), keine über Signatur-Vertrauen,
  keine über TTL/Denylist. Ein Peer mit dem Flag ist kein autorisierter Auftraggeber.
- **Reihenfolge (receiver-first, unverändert):** Producer+Consumer fleet-weit → Empfänger-Handler
  fleet-weit → **dann erst** Sender-Flip, und nur bei `true` für den adressierten Peer.

## 8. Was CO-gated bleibt (Stand HEAD)

| Punkt | Status | Warum gated |
|---|---|---|
| **Platzierung** des Feature-Felds (`protocol`-Block vs. `capabilities.services`) | **CO offen** | Wire-Semantik ≠ App-Capability; die Wahl bindet das Card-Schema |
| **Vokabular + `protocol_version`-Semver-Politik** (Namen, additiv/nie-entfernt) | **CO offen** | Einbahnstraße: Rücknahme wäre breaking |
| Producer-Befüllung + `version-compat`-Verdrahtung | folgt aus beidem | kann erst gebaut werden, wenn Platzierung und Namen feststehen |
| Empfänger-Handler für top-level ORDER, Inbox-Mapping | eigene ADR (V3) | Slice C proper |
| Sender-Flip | Slice C proper (V1) | braucht Handler + Flag fleet-weit |

**Ungegatet und bereits erledigt:** der fail-closed Consumer-Kern (`wire-feature.ts`, #314) und diese
Erdung. **Cross-Vendor-`pal:consensus` bleibt pal-PATH-blockiert** (`[[pal-review-backend-agy-missing]]`) —
der CO ist damit an einen Owner-/Infra-Schritt gebunden, nicht an weitere Repo-Arbeit.

## Beleg-Referenzen (Code, verifiziert gegen `e994e65`)
`wire-feature.ts` (ungegateter fail-closed Consumer-Kern, ADR §2, #314) ·
`agent-card.ts:22-111` (AgentCard, kein protocol/features) · `agent-card.ts:480` (`buildCard`, Producer) ·
`version-compat.ts:13,16,108` (tot außerhalb Tests) · `mesh.ts:20,189,258` (per-Peer Card + Getter) ·
`index.ts:1530-1541` und `:1592,1603` (Fetch+Identitäts-Check+Store, `as AgentCard`-Cast) ·
`index.ts:720` (dritter Card-Pfad) · `pinned-card-fetch.ts:35` (pinned Fetch) ·
`index.ts:936-938` (default-Drop, V1) · `TL-12-slice-c-scoping.md` (V1–V3).
