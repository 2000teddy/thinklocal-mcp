# ADR-038 — Signierte, re-verifizierbare Postfach-Aufträge (TL-12 Slice A)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-12 Slice A (nach Discovery `docs/architecture/TL-11-12-wake-postbox-discovery.md`).
**Bezug:** ADR-005 (Inbox/Instance-Routing), `messages.ts` (signierter CBOR-Envelope), ADR-004 (Inbox-Poll).
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — Design
bestätigt + gehärtet (Issuer==Sender-Bindung, `trust_status` getrennt von `verify_verdict`, verbatim
Bytes, fail-closed Decode, `store()` nur `OrderContext|null`). Beleg:
`~/hermes/reports/2026-07-15_1335_TL12a-consensus.md`.

## Problem
Eine Postfach-Nachricht wird heute transport-seitig signatur-verifiziert und die Signatur **verworfen**
(`index.ts` AGENT_MESSAGE-Handler → `agentInbox.store`). Die gespeicherte Zeile trägt **keine
re-verifizierbare Provenienz** und **keine Auftrags-Semantik** — der lesende Agent kann nicht prüfen,
**wer** einen Auftrag signiert hat. TL-12 verlangt „signierter Auftrag → Postfach → Abarbeitung"; Slice A
liefert den **re-verifizierbaren Auftrag im Postfach**, **ohne** Ausführung (= Slice B).

## Entscheidung

**Ein „Auftrag" ist ein signierter `messages.ts`-Envelope** (`type='ORDER'`, `idempotency_key` = Order-Nonce,
`sender` = Issuer-SPIFFE), transportiert **innerhalb** des Bodys einer normalen AGENT_MESSAGE unter einem
Marker (`body = { __tlorder__: base64(serializeSignedMessage(signed)) }`). Damit überlebt der Auftrag den
bestehenden Zustell-/Inbox-Pfad **unverändert und rückwärtskompatibel** (ein alter Empfänger sieht eine
Chat-Nachricht mit unbekanntem Feld und ignoriert es — kein neuer, nicht-abwärtskompatibler MessageType;
first-class `type='ORDER'` ist **Slice C**).

### Neues reines Modul `signed-order.ts`
- `buildOrderEnvelope` / `signOrder(env, privPem) → Uint8Array` (= verbatim `serializeSignedMessage`-Bytes).
- `extractOrderMarker(body) → Uint8Array | null` — **strikt** (Objekt mit String-`__tlorder__`, base64,
  ≤ `MAX_ORDER_BYTES` = 64 KiB), **wirft nie**; alles andere → `null` (Plain-Pfad).
- `verifyOrderBytes(bytes, expectedIssuer, pubPem) → { verdict:'VALID'|'INVALID', issuer?, orderId?, reason? }`
  — **rein, wirft nie** (CBOR-/Decode-Fehler → INVALID). VALID **nur** wenn: deserialisierbar,
  `decodeAndVerify`(Sig+TTL) ok, `type==='ORDER'`, **`envelope.sender === expectedIssuer`** (Relay-Schutz),
  `idempotency_key` nicht leer. `issuer`/`orderId` sind **Outputs** des Verify (aus den signierten Bytes),
  nie aus dem Body gelesen.
- `orderKeyId(pubPem)` = `computeFingerprint` (sha256hex der PEM — **PEM-encoding-abhängig**, als
  Revocation-Join-Key für Slice B/C, nicht für Krypto).

### Persistenz — Inbox-Schema v3 (additiv)
Neue **nullable** Spalten auf `messages`: `signed_bytes` (BLOB, **verbatim**), `signer_spiffe`,
`signer_keyid`, `signer_pubkey` (PEM, **immutable Verify-Key**), `order_nonce`, `verified_at`,
`verify_verdict` (`VALID`/`INVALID`), `trust_status` (jetzt `unknown`), `is_order` (INTEGER DEFAULT 0).
Index `idx_messages_order ON (signer_keyid, order_nonce)` (Slice-B-Dedupe). Migration v2→v3 **in EINER
Transaktion** mit dem `user_version`-Bump, gegated auf `PRAGMA user_version` (idempotent, kein bare ALTER).
Bestandszeilen: `is_order=0`, Order-Spalten NULL. **Kein Downgrade-Pfad** (v2-Logik ignoriert die
Zusatzspalten unkritisch — nur additive Reads).

`store(fromAgent, payload, order?: OrderContext | null)`:
- `OrderContext = { verdict:'VALID'; signedBytes; signerSpiffe; signerKeyid; signerPubkey; orderNonce } | { verdict:'INVALID' }`.
- VALID → `is_order=1` + alle Order-Spalten + `verify_verdict='VALID'` + `trust_status='unknown'`.
- INVALID (Marker vorhanden, Verify fehlgeschlagen) → `is_order=0`, `verify_verdict='INVALID'` (Audit-Signal
  auf der Zeile), übrige Order-Spalten NULL.
- `undefined`/`null` → Plain, unverändert.
- **`is_order` ist KEIN freier Parameter** — es wird **ausschließlich** aus `order.verdict==='VALID'`
  abgeleitet (typsystemisch bypass-sicher, kein client-gesetztes Flag).

### Re-Verify beim Lesen — produktiv am Read-Pfad
`verifyStoredOrder(row) → VerifyOrderResult` re-verifiziert `signed_bytes` gegen den **gespeicherten**
`signer_pubkey` (immutable, trust-on-first-verify) — **nie** gegen einen „aktuellen" Key (rotationsfest;
vermeidet die CA-Rotations-403-Welle). Fail-closed umhüllt: jede Exception → `INVALID`, **nie** ein Throw
in den `read_inbox`-Pfad (eine einzelne bösartige Zeile darf die Inbox nicht lahmlegen).

**Wird am realen Read-Pfad aufgerufen** (Reviewer-Befund PR #266, in-slice geschlossen): `GET /api/inbox`
(`inbox-api.ts`) ruft für jede Auftragszeile `verifyStoredOrder(m)` **live** auf und liefert dem Leser einen
`order`-Block `{ verify_verdict, signer_spiffe, signer_keyid, order_nonce, trust_status }` + `is_order`.
Das Verdikt ist das **Live-Re-Verify-Ergebnis**, nicht das gespeicherte Flag — eine at-rest manipulierte
Zeile zeigt `INVALID` (getestet). `read_inbox` (MCP-Tool) reicht diesen Block transparent durch.

### Ingest-Verdrahtung (`index.ts` AGENT_MESSAGE)
`senderPublicKey` (transport-verifiziert, bereits im `onMessage`-Handler in scope) + `envelope.sender`
werden an `extractOrderMarker`+`verifyOrderBytes` gereicht. VALID → `OrderContext` an `store` + Audit
`ORDER_RX`. Marker-vorhanden-aber-INVALID → `store` mit `{verdict:'INVALID'}` + Audit `ORDER_VERIFY_FAILED`
(beobachtbar, nicht still). Kein Marker → heutiger Plain-Pfad **byte-für-byte unverändert**.

## Bewusste Grenze
- **Keine Ausführung** (Slice B — besitzt den Idempotenz-Ledger auf `order_nonce`). Die Inbox-Zeile ist
  **NICHT** die Idempotenz-Einheit: Dedupe läuft heute über `message_id`; dieselben Order-Bytes in zwei
  Transport-Envelopes ergeben zwei Zeilen. Der Index `(signer_keyid, order_nonce)` ist für Slice B da.
- **`trust_status`** ist Slice A immer `unknown` — Revocation (via `signer_keyid`) ist Slice B/C.
  `verify_verdict` beantwortet **nur** „Signatur echt", nie „noch autorisiert".
- **First-class `type='ORDER'`-MessageType** = Slice C (Marker ist dokumentierter Übergangs-Transport).
- **TTL/Re-Verify-Semantik (CR-LOW-2):** Slice-A-Aufträge sind **nicht ablaufend** (`buildOrderEnvelope`
  defaultet `ttl_ms=0`, per Test gelockt). Der Ingest-Verify honoriert die TTL (ein bei Ankunft
  abgelaufener Auftrag wird nicht akzeptiert); der Read-Re-Verify läuft über dieselbe TTL-prüfende
  `decodeAndVerify` — daher würde ein Auftrag mit `ttl_ms>0` nach Ablauf `is_order=1` **aber** re-verify
  `INVALID` liefern (fail-closed, kein Sicherheitsleck). Die saubere Trennung „Ingest honoriert TTL /
  Read ist provenienz-only (TTL-ignorierend)" ist eine **Slice-B-Entscheidung** (mit der Ausführung).
- **Read-Wiring (CR-LOW-3 → in-slice geschlossen, Reviewer PR #266):** `GET /api/inbox` ruft
  `verifyStoredOrder` jetzt **live** auf und surfaced `is_order` + `order`-Block. Der Read-Pfad
  re-verifiziert also produktiv (nicht nur test-abgedeckt). **Weiterhin Slice B:** die *Ausführung* eines
  gelesenen Auftrags + der Idempotenz-Ledger auf `order_nonce` (dieses Slice liest+verifiziert, führt nicht aus).

## Konsequenzen
- **+** Aufträge sind ab jetzt im Postfach **re-verifizierbar** (verbatim Bytes + immutable Key), rückwärts-
  kompatibel, additiv, ohne Netz.
- **+** Fail-closed an jeder Kante: unsigniert/Relay/tampered/expired/oversize/malformed ⇒ nie Auftrag.
- **0** Plain-Nachrichten + der bestehende Zwei-Peer-Beweis unberührt.
- **−** Bis Slice B wird ein Auftrag gespeichert+angezeigt, aber **nicht** ausgeführt. Beabsichtigt.
