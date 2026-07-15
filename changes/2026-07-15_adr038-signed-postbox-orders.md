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
  `extractOrderMarker` strikt + wirft nie; `orderKeyId` (Fingerprint).
- `agent-inbox.ts`: Schema **v3** (+ `signed_bytes`/`signer_spiffe`/`signer_keyid`/`signer_pubkey`/
  `order_nonce`/`verified_at`/`verify_verdict`/`trust_status`/`is_order` + Index `(signer_keyid,
  order_nonce)`), Migration v2→v3 **transaktional**. `store(fromAgent, payload, order?: OrderContext|null)`
  — `is_order` nur aus `verdict==='VALID'` (typsystemisch unfälschbar). `verifyStoredOrder` re-verifiziert
  gegen den **immutable** `signer_pubkey`, fail-closed, wirft nie.
- `index.ts` AGENT_MESSAGE-Handler: Marker erkennen → gegen `senderPublicKey` + `envelope.sender`
  verifizieren → `OrderContext` an `store` + Audit `ORDER_RX`/`ORDER_VERIFY_FAILED`. Plain-Pfad unverändert.
- `messages.ts`: `MessageType.ORDER` + `OrderPayload`. `audit.ts`: `ORDER_RX`/`ORDER_VERIFY_FAILED`.

## Bewusste Grenze
Keine Ausführung (Slice B, Idempotenz-Ledger auf `order_nonce`); `trust_status` immer `unknown`
(Revocation = Slice B/C); Read-Surface/`verifyStoredOrder`-Produktiveinsatz + TTL-Read-Semantik = Slice B;
first-class `type='ORDER'` = Slice C. Plain-Nachrichten + Zwei-Peer-Beweis unberührt.

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet), Design bestätigt + gehärtet. ⚠️ Cross-Vendor
  (codex/agy) nicht im PATH. Beleg: `~/hermes/reports/2026-07-15_1335_TL12a-consensus.md`.
- **CG:** n/a. **TS:** +31 Tests (signed-order 13: roundtrip/wrong-key/tampered/relay/wrong-type/
  empty-nonce/expired-TTL/garbage/marker-strikt/keyid; agent-inbox 18 inkl. VALID-Persistenz+BLOB-
  roundtrip `Buffer.compare===0`, INVALID-Audit-Signal, plain, re-verify fail-closed, **v2→v3-Migration**).
  Volle Suite **1620 grün**, tsc sauber, ESLint 0 (geänderte Dateien).
- **CR:** adversarialer Claude-Subagent (Fail-open/Krypto-Fokus) — **kein Fail-open-Pfad**, alle 7
  Invarianten verifiziert. LOW-1 (MAX_ORDER_BYTES↔Body-Limit-Inkonsistenz → 47 KiB) + Fresh-DB-
  Transaktions-Symmetrie **in-slice gefixt**; LOW-2 (TTL-Read) + LOW-3 (Read-Wiring) als Slice-B
  dokumentiert.
- **PC:** `git diff`; Secret-Scan clean. **Vorbestehend (nicht eingeführt):** `index.ts:286` non-null-
  assert (durch +2 Import-Zeilen verschoben) sowie require/`!` in `agent-inbox-adr005.test.ts` (nur zwei
  `user_version`-Assertions von v2→v3 angepasst).
- **DO:** ADR-038, `TODO.md` (TL-12 Slice A ✅ / Slice B/C offen), `CHANGES.md`, `COMPLIANCE-TABLE.md`
  (+ #265→merged Reconcile), dieser Eintrag.
