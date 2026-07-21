# TL-12 Slice C — Scoping/Park: first-class `MessageType='ORDER'` (Marker ablösen)

**Status:** SCOPING/PARK (doc-first, **kein Code** in diesem Slice) · KW30 · 2026-07-21
**Vorgänger:** ADR-038 (Slice A, merged) · **Geschwister:** `TL-12-slice-b-execution-scoping.md` (Slice B, owner-gated).
**CO:** n/a — dieses Doc trifft **keine** verbindliche Architekturentscheidung (es *parkt* Slice C mit
repo-geerdetem Beleg). Der eigentliche Slice-C-Flip braucht später eine ADR **plus** CO; der Cross-Vendor-Pass
ist separat blockiert (`[[pal-review-backend-agy-missing]]` — Binaries installiert, aber pal-MCP-Server hat
`~/.local/bin` nicht im PATH).

## 0. Was Slice C laut TODO ist
> „**TL-12 Slice C**: first-class `MessageType='ORDER'` (Marker ablösen), **sobald Peers ≥ dieser Version**."

Heute reist ein Auftrag als **Marker im Body einer `AGENT_MESSAGE`** (Slice A): `createOrderEnvelope`
baut zwar eine `MessageType.ORDER`-Envelope (`signed-order.ts:63`), aber **nur**, um sie zu signieren und
base64-serialisiert in den `__tlorder__`-Body-Marker zu legen (`signed-order.ts:75`). Slice C will genau diese
Trägerform ablösen: die ORDER-Envelope **top-level über die Leitung** schicken statt eingebettet.

## 1. Gate-Check-Ergebnis: **nicht ehrlich low-ambiguity baubar → PARK**

Drei repo-geerdete Vorbehalte, jeder für sich blockierend:

### V1 — Der Sender-Flip ist still-droppend inkompatibel
Es gibt **keinen** `case MessageType.ORDER` im Empfangs-Dispatch. Eine top-level ORDER-Envelope fällt in den
`default`-Zweig (`index.ts:932-934`): `log.debug('Unbekannter Nachrichtentyp'); return null` → **stiller Drop,
kein ACK, kein Inbox-Store, kein Audit**. Der einzige reale Send-Pfad ist `inbox-api.ts:277`
(`MessageType.AGENT_MESSAGE`). Ein Sender, der first-class ORDER emittiert, verliert den Auftrag gegen
**jeden** noch nicht upgegradeten Peer lautlos.

### V2 — Das „Peers ≥ dieser Version"-Gate ist derzeit **nicht evaluierbar**
`version-compat.ts` (`PROTOCOL_VERSION='1.0.0'`, `FEATURE_MATRIX`, `checkCompatibility`, `isFeatureAvailable`,
`meetsMinVersion`) wird **außerhalb von Tests nirgends aufgerufen** — kein per-Peer Version-Tracking, kein
Wire-Level-Versionsaustausch im Message-Pfad. Der Sender hat also **kein Laufzeitsignal** für „unterstützt
dieser Peer top-level ORDER?". Das exakte TODO-Gate hat keinen Durchsetzungs-Mechanismus.

### V3 — Selbst die additive Empfänger-zuerst-Hälfte ist **nicht** low-ambiguity
Ein reiner `case MessageType.ORDER`-Empfangs-Handler (ohne Sender-Flip) wäre zwar verhaltensadditiv (niemand
sendet es), ist aber **kein „AGENT_MESSAGE-Case kopieren"**. Der Inbox-Persistenz-Contract ist an
`AgentMessagePayload` gekoppelt: `store(fromAgent, payload: AgentMessagePayload, order?)`
(`agent-inbox.ts:256`) zieht `message_id` (Dedup-Key), `subject`, `body`, `to`, `sent_at` **aus dem
AgentMessage-Wrapper**. Eine top-level ORDER-Envelope trägt einen Order-Payload **ohne** diese Felder →
first-class-Speicherung erzwingt Design-Entscheidungen:
- **`message_id`-Quelle?** Order hat `order_nonce`, kein message_id → neuer Dedup-Schlüssel nötig
  (kollidiert mit Slice-Bs geplantem `UNIQUE(signer_keyid, order_nonce)`-Ledger — muss abgestimmt werden).
- **`subject`/`body`?** Der Marker-Weg behielt einen menschenlesbaren AGENT_MESSAGE-Body **neben** dem Auftrag;
  wrapper-los fehlt der.
- **`to`?** `envelope.recipient` existiert, ist aber ≠ `AgentMessagePayload.to` (ADR-005-Instanz-Routing-Tail).

Das ist **ADR-Territorium** (Inbox-Schema-/Routing-Semantik), nicht ein low-ambiguity additiver Slice. Zudem
wäre der Handler ohne Sender **nicht gegen einen realen Peer testbar** → verletzt die Zwei-Peer-DoD
(`[[dod-two-peer-mcp-proof]]`: „deploy/reachability/CI-green ≠ done").

## 2. Prüfpfad, der Slice C ehrlich freischaltet (Reihenfolge)
1. **Wire-Level-Feature/Version-Exchange** (aktiviert die tote `version-compat`-Maschinerie): `PROTOCOL_VERSION`
   bzw. eine ORDER-Feature-Fähigkeit in die **bereits zwischen Peers abgerufene** Agent-Card aufnehmen
   (additiv/rückwärtskompatibel — alte Peers ignorieren das neue Feld). Erst damit wird V2 lösbar. Eigene ADR
   + CO (Rollout-Policy = Owner-nah).
2. **Empfänger-zuerst-Handler** + Inbox-Mapping-Entscheidung (V3) als ADR fixieren; ausrollen an **die ganze
   Flotte**, verifiziert.
3. **Sender-Flip** erst, wenn (1) beweist „alle adressierten Peers ≥ Feature" — dann ist V1 entschärft.

Kurz: Slice C ist ein **zweiphasiger receiver-first Wire-Format-Wechsel mit Versions-Gate**, kein additiver
Ein-PR-Slice. Der ehrliche nächste Baustein ist der Version-Exchange (Schritt 1), nicht Slice C selbst.

## 3. Warum jetzt nicht stattdessen TL-11 B oder TL-14a weiter
- **TL-11 Slice B** bleibt **host-/fenster-gated**: der Wake-Consumer ist der Out-of-Repo Agent-Home-Supervisor;
  Slice B baut den externen Hop, der ohne Host-Fenster nicht ehrlich abschließbar ist (Consumer-Contract-Spec
  `TL-11-wake-consumer-contract.md` de-riskt bewusst, **ohne** den Hop zu bauen).
- **TL-14a** bleibt **Owner-Sign-off-Pfad**: D1–D6 warten auf Christian-Sign-off (insb. D3-Laufzeit-Korridor
  1–3 J) + Auflagen A/B **vor** der ADR; der Cross-Vendor-Consensus-Pass ist nur **optional** und derzeit
  pal-PATH-blockiert. Keiner dieser Schritte ist agentenseitig-frei ausführbar.

Damit ist dieser Park **kein Idle**, sondern der wahrheitsgetreue Gate-Befund für den einzigen sonst „freien"
KW30-Slice.

## 4. Abgrenzung
Doc/Design only. **Keine** verbindliche Entscheidung, **kein** Code/Config/Schema, kein Deploy/Secret/Cross-Host.
Protokolliert den repo-geerdeten Gate-Check für Slice C als Input für eine spätere Version-Exchange-ADR.
