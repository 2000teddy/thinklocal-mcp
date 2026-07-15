# changes/2026-07-15 — feat(security): ADR-038 signierte, re-verifizierbare Postfach-Aufträge (TL-12 Slice A)

**Typ:** Daemon-Code (`signed-order.ts` neu, `agent-inbox.ts`, `index.ts`, `messages.ts`, `audit.ts`) +
Tests + Design-Doku (ADR-038).
**Slice:** TL-12 Slice A (nach Discovery `TL-11-12-wake-postbox-discovery.md`).

## Warum
Eine Postfach-Nachricht wurde transport-seitig verifiziert und die Signatur **verworfen** — die
gespeicherte Zeile trug keine re-verifizierbare Provenienz und keine Auftrags-Semantik. Slice A liefert
den **re-verifizierbaren Auftrag im Postfach** (ohne Ausführung = Slice B).

## Was
- `signed-order.ts` (neu, rein): ein Auftrag = signierter `messages.ts`-Envelope (`type='ORDER'`,
  `idempotency_key`=Nonce), verbatim-Bytes im AGENT_MESSAGE-Body unter Marker `__tlorder__`.
  `verifyOrderBytes` fail-closed (Sig+TTL, `type==='ORDER'`, **issuer===sender** Relay-Schutz, Nonce);
  `extractOrderMarker` **Tri-State** (`absent`/`invalid`/`bytes`, wirft nie) + `classifyInboundOrder`-Seam;
  `orderKeyId` (Fingerprint).
- `agent-inbox.ts`: Schema **v3** (+ `signed_bytes`/`signer_spiffe`/`signer_keyid`/`signer_pubkey`/
  `order_nonce`/`verified_at`/`verify_verdict`/`trust_status`/`is_order` + Index `(signer_keyid,
  order_nonce)`), Migration v2→v3 **transaktional**. `store(fromAgent, payload, order?: OrderContext|null)`
  — `is_order` nur aus `verdict==='VALID'` (typsystemisch unfälschbar). `verifyStoredOrder` re-verifiziert
  gegen den **immutable** `signer_pubkey`, fail-closed, wirft nie.
- `index.ts` AGENT_MESSAGE-Handler: `classifyInboundOrder(body, envelope.sender, senderPublicKey)` →
  `order` → `OrderContext{VALID}` + `ORDER_RX`; `invalid` (kaputter Marker/Verify-Fehler) →
  `OrderContext{INVALID}` + `ORDER_VERIFY_FAILED`; `plain` → Plain-Pfad unverändert. **Kein stiller Downgrade.**
- `inbox-api.ts` (Read-Surface, Reviewer-Befund #266 in-slice): `GET /api/inbox` ruft `verifyStoredOrder`
  **live** je Auftragszeile und liefert `is_order` + `order`-Block (`verify_verdict`/`signer_spiffe`/
  `signer_keyid`/`order_nonce`/`trust_status`). Verdikt = Live-Re-Verify, nicht das gespeicherte Flag.
- `messages.ts`: `MessageType.ORDER` + `OrderPayload`. `audit.ts`: `ORDER_RX`/`ORDER_VERIFY_FAILED`.

## Bewusste Grenze
Keine **Ausführung** (Slice B, Idempotenz-Ledger auf `order_nonce`); `trust_status` immer `unknown`
(Revocation = Slice B/C); TTL-Read-Semantik = Slice B; first-class `type='ORDER'` = Slice C.
**Read-Surface IST in Slice A** (`GET /api/inbox` re-verifiziert live, s.o.). Plain-Nachrichten +
Zwei-Peer-Beweis unberührt.

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet), Design bestätigt + gehärtet. ⚠️ Cross-Vendor
  (codex/agy) nicht im PATH. Beleg: `~/hermes/reports/2026-07-15_1335_TL12a-consensus.md`.
- **CG:** n/a. **TS:** +37 Tests: signed-order 19 (roundtrip/wrong-key/tampered/relay/wrong-type/
  empty-nonce/expired-TTL/garbage/marker-Tri-State/keyid/ttl0 + **classifyInboundOrder-Ingest-Seam:
  wrong-type/malformed-base64/oversize/relay → invalid**), agent-inbox 15 (VALID-Persistenz+BLOB-roundtrip
  `Buffer.compare===0`, INVALID-Audit, plain, re-verify fail-closed, **v2→v3-Migration**), inbox-api 3
  (Read-Surface VALID/plain/**Live-Re-Verify fängt at-rest-Korruption**). Volle Suite **1629 grün**, tsc
  sauber, ESLint 0 (geänderte Dateien).
- **CR:** adversarialer Claude-Subagent (Fail-open/Krypto) — **kein Fail-open-Pfad**, alle 7 Invarianten
  verifiziert. LOW-1 (MAX_ORDER_BYTES → 47 KiB) + Fresh-DB-Transaktions-Symmetrie **in-slice gefixt**;
  LOW-2 (TTL-Read) dokumentiert.
- **CR extern (Codex #266):** MEDIUM-1 Read-Wiring **geschlossen** (`GET /api/inbox` re-verifiziert live);
  MEDIUM-2 stiller Marker-Downgrade **geschlossen** via **Tri-State** `extractOrderMarker` +
  `classifyInboundOrder`-Seam (malformed-present → INVALID + `ORDER_VERIFY_FAILED`, nie stiller Downgrade)
  + Ingest-Seam-Regressionen; LOW Doc-Drift (64→47 KiB, Read-Wiring Slice A) korrigiert.
- **PC:** `git diff`; Secret-Scan clean. **Vorbestehend (nicht eingeführt):** `index.ts:286` non-null-
  assert (durch +2 Import-Zeilen verschoben) sowie require/`!` in `agent-inbox-adr005.test.ts` (nur zwei
  `user_version`-Assertions von v2→v3 angepasst).
- **DO:** ADR-038, `TODO.md` (TL-12 Slice A ✅ / Slice B/C offen), `CHANGES.md`, `COMPLIANCE-TABLE.md`
  (+ #265→merged Reconcile), dieser Eintrag.
