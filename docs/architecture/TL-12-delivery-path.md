# TL-12 — Der Zustellpfad: signierter Auftrag → Postfach → Abarbeitung

**Status:** Referenz (beschreibt den **Ist-Stand**; trifft **keine** Entscheidung)
**Datum:** 2026-07-23 · **Anker verifiziert gegen** `c4b5261`
**Bezug:** ADR-038 (Slice A, gemergt) · `TL-12-slice-b-execution-scoping.md` (Ausführung) ·
`TL-12-slice-c-scoping.md` (V1–V3) · `ADR-046` (Wire-Feature) · `ADR-047` (TL-11-Nachlauf)

## 0. Wozu dieses Dokument

Die TL-12-Dokumentation ist über vier Dateien verteilt und jeweils **slice-zentriert**. Was fehlte, ist
die **durchgehende Sicht**: welche Station gibt es heute wirklich, was garantiert sie, wo hört der
gebaute Pfad auf — und **an welcher Station genau** die offenen Gates aus TL-08/09/10 sitzen. Genau das
steht hier, mit Code-Ankern statt Prosa.

**Dieses Dokument entscheidet nichts** und verschiebt kein Gate. Es macht sichtbar, was ist.

## 1. Der Pfad in einer Zeile

```
[Absender] signiert  →  Envelope über mTLS-Mesh  →  Ingest klassifiziert + verifiziert
        →  Postfach speichert verbatim (unfälschbar)  →  Read-Surface re-verifiziert live
        →  ⛔ Abarbeitung/Ausführung (NICHT gebaut, owner-gated)
```

## 2. Station für Station (Ist-Stand, mit Ankern)

### S1 — Auftrag bauen und signieren · **gebaut**
`signed-order.ts` `buildOrderEnvelope` (`:57`) + `signOrder` (`:69`); der Auftrag reist als
**Body-Marker** (`wrapOrderInBody`), nicht als eigener `MessageType` — das ist der Kern von
Slice-C-Vorbehalt **V1** (s. §4).

**Garantie:** die signierten Bytes sind **verbatim** das, was der Empfänger prüft.

### S2 — Transport · **gebaut (unverändert)**
Der Auftrag nutzt den **bestehenden** Mesh-Nachrichtenpfad (mTLS, gepaarte Peers). TL-12 fügt hier
**keinen** Transport hinzu.

### S3 — Ingest: klassifizieren + verifizieren · **gebaut**
`index.ts:870` `classifyInboundOrder(msg.body, envelope.sender, senderPublicKey)`.

**Garantien:**
- verifiziert gegen den **Transport**-Pubkey und erzwingt `issuer === envelope.sender` ⇒ **Relay-Schutz**
  (ein Weiterleiter kann einen fremden Auftrag nicht als eigenen ausgeben);
- **Tri-State** (CR-Codex #266): *kein Marker* ⇒ Plain-Pfad byte-für-byte wie bisher · *Marker vorhanden
  aber unbrauchbar* **oder** *Verify fehlgeschlagen* ⇒ `INVALID` auf der Zeile **plus**
  `ORDER_VERIFY_FAILED`-Audit (`index.ts:882`) — **nie** ein stiller Downgrade zu „normale Nachricht".

### S4 — Postfach: verbatim + unfälschbar speichern · **gebaut**
`agent-inbox.ts` `store(fromAgent, payload, order?)` (`:256`) nimmt einen `OrderContext | null` (`:96`);
`index.ts:884` übergibt ihn. Erfolgreiche Verifikation ⇒ `ORDER_RX`-Audit mit Nonce + Keyid
(`index.ts:905-909`).

**Garantien:**
- `signed_bytes` liegen **verbatim** in der Zeile, `signer_pubkey` ist **immutable** — eine gespeicherte
  Order ist später **re-verifizierbar**, nicht bloß „war mal gültig";
- `is_order` ist **typsystemisch unfälschbar**: `store()` akzeptiert nur `OrderContext | null`, es gibt
  keinen Pfad, auf dem eine Plain-Nachricht sich zur Order erklären könnte.

### S5 — Read-Surface: **live** re-verifizieren · **gebaut**
`inbox-api.ts:399` ruft je gelisteter Zeile `inbox.verifyStoredOrder(m)` (`agent-inbox.ts:379`) auf und
liefert `is_order` + `verify_verdict` mit aus.

**Garantien:** die Anzeige sagt **jetzt**, ob die Signatur **jetzt** noch trägt (nicht „beim Empfang war
sie gültig"). `verifyStoredOrder` ist **fail-closed und wirft nie** — eine bösartige Zeile legt die Liste
nicht lahm (`inbox-api.ts:382`).

### S6 — Abarbeitung / Ausführung · **⛔ NICHT gebaut**
Ein gelesener Auftrag wird **nicht ausgeführt**. Es gibt keinen Executor, kein Ledger, keine Denylist,
keinen Rate-Fence. Das ist **Slice B**, und es ist bewusst so: **Signatur ≠ Ausführungs-Erlaubnis**
(CO einstimmig, Slice-B-Scoping §1).

**Was für S6 schon vorbereitet ist (rein, 0 Aufrufer):**
- `signed-order.ts` `canonicalOrderKeyId` — format-stabiler Keyid über DER-SPKI (**#323**), damit ein
  künftiger Ledger-/Denylist-Schlüssel nicht durch PEM-Umformatieren umgehbar ist;
- `order-ledger-protocol.ts` — der **at-most-once** Reserve-vor-Dispatch/Commit-Vertrag (**#324**),
  inklusive der Pflichten, die B1 (Persistenz) und B3 (Dispatch) einhalten müssen.

## 3. Wo die Gates sitzen — TL-08/09/10 ausdrücklich

Diese Gates gehören **nicht** zu TL-12, greifen aber **auf demselben Weg**, sobald ein Auftrag etwas
*bewirken* soll. Sie werden hier benannt, damit „Zustellpfad gebaut" nicht mit „Auftrag wird ausgeführt"
verwechselt wird.

| Gate | Wo im Pfad | Status |
|---|---|---|
| **TL-12 §9** — `[orders] execute`-Opt-in, Epoch-Grenze `T`, ausführbare Startmenge, Revocation-Autorität | **vor** S6 | ⛔ **Christian/Owner offen** — ohne diese vier gibt es kein B1/B3 |
| **TL-09b** — Meldekanal-Freigabe am `gate`-Tier (`mcp-ingress.ts:174` `resolveApproval`) | am schreibenden MCP-Aufruf, den ein Auftrag auslösen würde | hinter Env-Flag, Default aus |
| **TL-10** — Freigabe-Matrix „Werkzeug-Klasse → Kanal" | ersetzt die „erster gesunder Kanal"-Auswahl an derselben Stelle | ⛔ D1-Loader + **D3-Sign-off** offen; Kern gebaut (#300/#317/#319) |
| **TL-08** — Tool-Klassen/Redaction | am MCP-Werkzeug selbst | Gate-Flip (sensitive → allow-with-redaction) ⛔ Christian-gated |

**Konsequenz:** selbst wenn Slice B morgen entschieden wäre, liefe ein ausgeführter Auftrag **zusätzlich**
durch TL-09b/TL-10 (Freigabe) und TL-08 (Werkzeug-Klasse). Der Auftrag ist ein *Antrag*, kein Freibrief —
und **keines** dieser Gates wird durch die Auftrags-Signatur ersetzt oder abgeschwächt.

## 4. Wo der Pfad heute endet — und warum das so bleibt

| Vorbehalt | Was er bedeutet | Beleg |
|---|---|---|
| **V1** | Ein top-level `MessageType='ORDER'` fiele in den `default`-Drop des Empfangs-Dispatch (`index.ts:936-938`) — gegen jeden nicht upgegradeten Peer **still verworfen**. Deshalb reist der Auftrag heute als **Body-Marker** (S1) | `TL-12-slice-c-scoping.md` |
| **V2** | „Peer ≥ Version" ist **nicht evaluierbar**: `version-compat.ts` hat außerhalb von Tests keinen Aufrufer, es gibt keinen Wire-Versionsaustausch | `ADR-046` §Problem |
| **V3** | Selbst ein additiver Empfänger-Handler ist ADR-pflichtig, weil `store()` an `AgentMessagePayload` gekoppelt ist ⇒ wrapper-lose ORDER erzwingt ein neues Feld-Mapping | `agent-inbox.ts:256` |

Der **ehrliche nächste Baustein** ist deshalb nicht Slice C, sondern der Wire-Feature/Version-Exchange
(**ADR-046**) — dessen ungegateter Consumer-Kern liegt (#314), die Anker sind geerdet (#325), und die
**CO-pflichtigen** Fragen (Platzierung; Vokabular/Semver) sind unverändert offen.

## 5. Was daraus folgt (keine Entscheidung, nur die Konsequenz)

1. **Zustellung ist fertig, Abarbeitung nicht.** S1–S5 tragen; S6 existiert nicht und ist owner-gated.
   Wer „TL-12" sagt, muss dazusagen, welche Hälfte gemeint ist.
2. **Die Reihenfolge liegt fest und ist nicht abkürzbar:** ADR-046-CO → Slice-C-Empfänger-Handler →
   Sender-Flip (V1–V3) auf der **Form**-Achse; §9-Entscheidungen → B0 → B1 → B2a → B2b → B3 auf der
   **Ausführungs**-Achse. Beide Achsen sind unabhängig; keine ersetzt die andere.
3. **Was ohne jede Entscheidung noch geht**, ist inzwischen sehr wenig — die reinen Kerne #314/#323/#324
   sind gebaut. Weitere Repo-Arbeit an TL-12 braucht eine der offenen Antworten.

## 6. Beleg-Referenzen (verifiziert gegen `c4b5261`)
`signed-order.ts:57,69` (bauen/signieren), `:117` (`canonicalOrderKeyId`, #323) ·
`index.ts:870` (`classifyInboundOrder`), `:882` (`ORDER_VERIFY_FAILED`), `:884` (`store`),
`:905-909` (`ORDER_RX`), `:936-938` (default-Drop, V1) ·
`agent-inbox.ts:96` (`OrderContext`), `:256` (`store`), `:379` (`verifyStoredOrder`) ·
`inbox-api.ts:382,399` (Read-Surface re-verifiziert) ·
`order-ledger-protocol.ts` (at-most-once-Vertrag, #324) ·
`mcp-ingress.ts:174` (`resolveApproval`, TL-09b/TL-10-Seam) ·
`audit.ts:58-59` (`ORDER_RX`/`ORDER_VERIFY_FAILED`).
