# changes/2026-07-21 — docs(arch): TL-12 Slice C Scoping/Park (first-class ORDER — Gate-Check)

**Typ:** **doc-only** Scoping/Park (Design-Discovery, **kein** Code/Test/Config-Change; kein
Christian-/Deploy-/Secret-Gate). Analog zum Präzedenz-Doc `TL-12-slice-b-execution-scoping.md`.

## Warum
KW30-Auftrag: den nächsten *freien* ungegateten Slice fahren — Kandidat war **TL-12 Slice C** (first-class
`MessageType='ORDER'`, „Marker ablösen, sobald Peers ≥ dieser Version"). Auftrag war explizit binär:
**bauen wenn low-ambiguity, sonst mit Beleg parken** (welcher Vorbehalt, welcher Prüfpfad). Dieses Doc hält den
repo-geerdeten Gate-Check fest, damit der Befund nicht zum dritten Mal re-litigiert wird und der Park **belegt
statt still** ist.

## Ergebnis: PARK (nicht ehrlich low-ambiguity baubar)
Drei blockierende, je repo-geerdete Vorbehalte (Details in `docs/architecture/TL-12-slice-c-scoping.md`):

- **V1 — Sender-Flip still-droppend inkompatibel:** kein `case MessageType.ORDER` im Dispatch; top-level ORDER
  fällt in `default` (`index.ts:932-934`) → `return null`, kein ACK/Store/Audit. Einziger Send-Pfad heute:
  `inbox-api.ts:277` (`AGENT_MESSAGE`). Heute reist ORDER nur als base64-Marker im AGENT_MESSAGE-Body
  (`signed-order.ts:63,75`).
- **V2 — „Peers ≥ Version"-Gate nicht evaluierbar:** `version-compat.ts` (`PROTOCOL_VERSION`, `FEATURE_MATRIX`,
  `checkCompatibility`/`isFeatureAvailable`/`meetsMinVersion`) wird außerhalb von Tests **nirgends** aufgerufen —
  kein per-Peer-Version-Tracking, kein Wire-Versionsaustausch. Das TODO-Gate hat keinen Mechanismus.
- **V3 — additive Empfänger-Hälfte ist ADR-pflichtig, nicht low-ambiguity:** `store(fromAgent,
  payload: AgentMessagePayload, order?)` (`agent-inbox.ts:256`) koppelt die Inbox-Zeile an message_id
  (Dedup)/subject/body/to/sent_at des AGENT_MESSAGE-Wrappers. Eine wrapper-lose ORDER-Envelope hat diese Felder
  nicht → neues Mapping (message_id-Quelle vs. Slice-B-`UNIQUE(signer_keyid,order_nonce)`-Ledger, subject/body,
  ADR-005-`to`-Tail) = Design-Entscheidung. Ohne Sender außerdem nicht gegen realen Peer testbar (Zwei-Peer-DoD).

## Prüfpfad, der Slice C freischaltet
1. Wire-Level-**Feature/Version-Exchange** über die ohnehin abgerufene Agent-Card (additiv, alte Peers ignorieren
   das Feld) — löst V2. Eigene ADR + CO.
2. Empfänger-zuerst-Handler + Inbox-Mapping als ADR fixieren; fleet-weit ausrollen + verifizieren.
3. Sender-Flip erst nach Nachweis „alle adressierten Peers ≥ Feature" — entschärft V1.

## Warum nicht stattdessen TL-11 B / TL-14a
- **TL-11 B**: host-/fenster-gated (externer Wake-Consumer-Hop, kein agentenseitig-freies Fenster).
- **TL-14a**: Owner-Sign-off-Pfad (D1–D6 + Auflagen A/B vor ADR); Cross-Vendor-Consensus-Pass optional und
  aktuell pal-PATH-blockiert (`codex`/`agy` installiert, aber pal-MCP-Server hat `~/.local/bin` nicht im PATH).

## Umfang
`docs/architecture/TL-12-slice-c-scoping.md` (neu), `TODO.md` (Slice C `[ ]`→`[~]` + Park-Notiz), `CHANGES.md`,
`COMPLIANCE-TABLE.md`, dieser Eintrag. **Kein** Code/Test/Schema/Deploy/Secret. Risiko-Delta **null**.
