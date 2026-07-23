# changes/2026-07-23 — docs(arch): TL-12 Zustellpfad end-to-end (signierter Auftrag → Postfach → Abarbeitung)

**Typ:** **Doc-only** Referenz. Kein Code, **keine Entscheidung**, **kein Gate verschoben**, kein
Deploy/Secret/Host. Enthält den eingefalteten Post-Merge-Reconcile für **#326**.

## Warum
Die TL-12-Dokumentation liegt in vier Dateien und ist jeweils **slice-zentriert** (Slice A in ADR-038,
Ausführung im Slice-B-Scoping, Slice C im eigenen Park-Dokument, der Wire-Prereq in ADR-046). Was fehlte,
ist die **durchgehende** Sicht: welche Station existiert heute wirklich, was garantiert sie, wo hört der
gebaute Pfad auf — und **an welcher Station genau** die offenen Gates aus TL-08/09/10 greifen. Ohne das
liest sich „TL-12 Slice A ist gemergt" leicht als „Aufträge werden abgearbeitet".

## Was
Neu `docs/architecture/TL-12-delivery-path.md`, Station für Station mit Code-Ankern:

| Station | Status | Kern-Garantie |
|---|---|---|
| **S1** signieren | gebaut | verbatim signierte Bytes; reist als **Body-Marker**, nicht als eigener `MessageType` — das *ist* Vorbehalt **V1** |
| **S2** Transport | gebaut (unverändert) | bestehender mTLS-Mesh-Pfad; TL-12 fügt **keinen** Transport hinzu |
| **S3** Ingest | gebaut | Verify gegen den **Transport**-Pubkey + `issuer === envelope.sender` ⇒ **Relay-Schutz**; **Tri-State** ⇒ nie stiller Downgrade zu Plain, sondern `INVALID` + `ORDER_VERIFY_FAILED`-Audit |
| **S4** Postfach | gebaut | `store()` nimmt nur `OrderContext \| null` ⇒ `is_order` **typsystemisch unfälschbar**; `signed_bytes` verbatim + `signer_pubkey` immutable ⇒ später **re-verifizierbar** |
| **S5** Read-Surface | gebaut | re-verifiziert **live** je Zeile; fail-closed und wirft nie ⇒ eine bösartige Zeile legt die Liste nicht lahm |
| **S6** Abarbeitung | ⛔ **nicht gebaut** | kein Executor, kein Ledger, keine Denylist, kein Rate-Fence — „**Signatur ≠ Ausführungs-Erlaubnis**" (CO einstimmig) |

## TL-08/09/10 — verortet statt weggelassen
Eine eigene Tabelle sagt, **an welcher Station** jedes offene Gate greift: die vier §9-Owner-Entscheidungen
**vor** S6 · TL-09b `resolveApproval` und TL-10 (Freigabe-Matrix; D1-Loader + **D3-Sign-off** offen) am
schreibenden MCP-Aufruf · TL-08 (Gate-Flip sensitive → Redaction) am Werkzeug selbst.

Mit der ausdrücklichen Konsequenz: **selbst bei entschiedenem Slice B** liefe ein ausgeführter Auftrag
**zusätzlich** durch TL-09b/TL-10 und TL-08. Der Auftrag ist ein **Antrag, kein Freibrief** — und
**keines** dieser Gates wird durch die Auftrags-Signatur ersetzt oder abgeschwächt.

## Ende des Pfades, belegt
**V1** top-level ORDER fiele in den `default`-Drop (`index.ts:936-938`) · **V2** „Peer ≥ Version" ist nicht
evaluierbar (`version-compat.ts` ohne Aufrufer) · **V3** `store()` ist an `AgentMessagePayload` gekoppelt.
Daraus: der ehrliche nächste Baustein ist **ADR-046**, nicht Slice C. Für S6 sind die reinen Kerne bereits
gebaut und benannt: `canonicalOrderKeyId` (**#323**) und `order-ledger-protocol.ts` (**#324**), beide
0 Aufrufer.

## Verifikation
**Alle zehn Code-Anker einzeln gegen `c4b5261` geprüft** (skriptgestützter Abgleich Zeile ↔ Symbol, nicht
aus dem Gedächtnis zitiert): `signed-order.ts:57,69,117` · `agent-inbox.ts:96,256,379` ·
`index.ts:870,884` · `inbox-api.ts:399` · `mcp-ingress.ts:174`. Kein `.ts`-Diff; Suite unverändert
**2045 grün** (143 Files).

## Eingefaltet: #326-Reconcile
`gh`-verifiziert `mergedAt=2026-07-23T14:36:19Z` / `c4b5261` — COMPLIANCE-Nummer, CHANGES-Überschrift,
TODO-Eintrag nachgezogen, 1:1 in-place.

## Compliance
- **CO:** n/a — das Dokument **beschreibt** den Ist-Stand und trifft keine Entscheidung.
- **CG/TS:** entfallen — kein Code/Test-Diff.
- **CR:** externes Review am PR mit **`agy`**.
- **PC:** Secret-Scan clean (nur Doku).
- **DO ✅:** dieser Eintrag, `TL-12-delivery-path.md`, `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** Slice B (§9), Slice C (V1–V3), ADR-046-Implementierung (CO), TL-10-Verdrahtung
(D1-Loader/D3), TL-08-Gate-Flip, TL-11 Slice B (Host-Hop).
