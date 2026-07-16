# TL-12 Slice B — Scoping/Discovery: Ausführung signierter Postfach-Aufträge

**Status:** SCOPING (doc-first, **kein Code** in diesem Slice) · KW30 · 2026-07-16
**Speist:** eine spätere `ADR-044` (bei B0-Implementierung akzeptiert) · **Vorgänger:** ADR-038 (Slice A, merged).
**CO:** `pal:consensus` 2026-07-16 (`cli-claude-opus` neutral 6/10 + `cli-claude-sonnet` against 4/10) —
Beleg unten. **Einstimmiges Votum: B1 NICHT starten, bevor dieses Doc die u.g. Korrekturen + Invarianten
festschreibt** (danach 8-9/10). Owner-Opt-in + Epoch-Grenze sind Christian-Entscheidungen.

## 0. Was Slice A liefert (Ist-Stand)
Signierter, re-verifizierbarer ORDER im Postfach **ohne** Ausführung: Inbox-Zeile mit `is_order`, verbatim
`signed_bytes`, `signer_pubkey`, `signer_keyid`, `order_nonce`, `verify_verdict` (VALID/INVALID),
`trust_status` (in Slice A **immer** `unknown`, kein Writer). Index `(signer_keyid, order_nonce)` reserviert.
`signed-order.ts`: `verifyOrderBytes` (Sig+TTL, issuer==sender-Relay-Schutz), `orderKeyId`.
`buildOrderEnvelope` defaultet **`ttl_ms=0`** (nicht ablaufend). Read-Pfad re-verifiziert live (`inbox-api.ts`).

## 1. Kern-Entscheidung (CO einstimmig): Signatur ≠ Ausführungs-Erlaubnis
Eine gültige Signatur beweist **wer** den Auftrag ausstellte, nicht **ob er hier laufen darf**. Slice-A-Ingest
gated bereits auf `senderIsPaired` — aber Pairing (SPAKE2-PIN) wurde für **Nachrichten** konsentiert, nicht für
**Ausführung**. Jeden gepairten Peer still zum Executor zu machen, ändert nachträglich, wozu der Operator „ja"
sagte. **Deshalb: drittes, lokales Consent.** Präzedenz im Code: `serve_shared=false` (ADR-032).

> **D-OWNER (Christian-Entscheidung):** `[orders] execute=false` als Default + eine **leere**
> `(signer_keyid × order_type)`-Allowlist. Ein globaler order_type-Allowlist allein genügt NICHT (er gäbe
> jedem nicht-widerrufenen Signer dieselbe Ausführungsfläche) — der Grant ist **pro `(signer_keyid,
> order_type)`**, vom Owner einmal freigegeben. Drei unabhängige Consents: **paired + Signatur VALID +
> owner-allowlisted**.

## 2. Korrigierte Sub-Slice-Zerlegung (fail-closed, Primitive zuerst)
Die ursprüngliche B1→B2→B3-Idee war richtig in der *Form*, aber B2 bündelte Billiges (TTL) mit Teurem
(Revocation, auf **falscher Prämisse**), und ein **B0** fehlte. Neue Ordnung:

| Slice | Inhalt | Ausführung? |
|-------|--------|-------------|
| **B0** | Executable-Order-Profil + Owner-Opt-in-Config + Schema + Epoch-Grenze (§3) | nein |
| **B1** | Idempotenz-/Ausführungs-Ledger `(signer_keyid, order_nonce)` (§4) | nein |
| **B2a**| TTL-**strenger** Execute-Resolver (ADR-038-Restfrage lösen, §5) | nein |
| **B2b**| **Neuer** keyid-Denylist/Revocation-Check (NICHT `crl.ts`, §6) | nein |
| **B3** | Minimale Ausführung hinter ALLEN Gates, via task-executor + Rate-Fence (§7) | ja |

## 3. B0 — Executable-Order-Profil (VOR B1, billig jetzt / Migration später)
- **`ttl_ms > 0` verpflichtend** für ausführbare Order-Typen (bounded max). `ttl_ms=0` macht das TTL-Gate
  **vakuum** — ein nicht ablaufender signierter Auftrag ist ein *Bearer-Token für immer*; der Ledger ist
  **node-lokal**, also führte derselbe Auftrag auf **jedem** Knoten einmal aus. Execute-Gate lehnt `ttl_ms=0` ab.
- **`order_type` aus `signed_bytes`** (neues signiertes Feld + abgeleitete Schema-Spalte), **niemals** aus dem
  unsignierten Body — sonst umgeht ein Relay die Allowlist durch Umetikettieren außerhalb der Signaturabdeckung.
  Ableitungsdisziplin wie `is_order` (`agent-inbox.ts:309`).
- **Kanonischer Keyid = DER-SPKI**, nicht sha256(PEM-Text): `orderKeyId` ist format-malleabel
  (Whitespace/Wrapping → anderer Keyid → andere Ledger-/Denylist-Zeile). Kanonisieren **bevor** der Keyid
  Ledger-Uniqueness **und** Revocation-Join-Key wird.
- **Execution-Epoch-Grenze (D-EPOCH, Christian-Entscheidung):** Slice A speichert `signed_bytes` bereits
  flottenweit ohne Execute-Gate. Ohne Grenze würde **jeder** vor B3 eingegangene (oder in Transit
  abgefangene) nicht-ablaufende Auftrag beim B3-Flip **rückwirkend ausführbar** (harvest-now-execute-later) —
  der Nonce-Ledger trackt „konsumiert", nicht „vor Cutover ausgestellt". Fix: Aufträge, die vor Epoch-Timestamp
  `T` signiert wurden, sind **execution-void** (nur Anzeige), ODER verpflichtende max-TTL für je ausführbare
  Typen. **Muss vor B1 stehen.**

## 4. B1 — Idempotenz-/Ausführungs-Ledger (das eine sichere Primitiv)
- Durabler Ledger, `UNIQUE (signer_keyid, order_nonce)`, mit Status-Spalte.
- **Reserve-vor-Dispatch:** die Nonce wird per `INSERT` in **einer** better-sqlite3-Transaktion **vor** der
  Ausführung beansprucht; Commit/Fail **nach** Dispatch. **At-most-once:** Crash-nach-Claim = wird **nie**
  ausgeführt — das ist die Semantik, niemand „fixt" das zu at-least-once. (`inbox`-Zeile ist NICHT die
  Idempotenz-Einheit; Dedupe lief bisher über `message_id`.)
- **Reserve/Commit-Protokoll jetzt gemeinsam mit B3s Dispatch-Kontrakt spezifizieren** (auch wenn Code
  sequentiell landet) — sonst wird B1 blind gegen B3 gebaut und muss neu geschrieben werden.
- **`replayGuard` NICHT wiederverwenden** — In-Memory-`Map`, hartkodiertes 120s-Cleanup unabhängig von
  `ttlMs` (`replay.ts:40-47`), für lange TTLs unsound und nicht durabel.

## 5. B2a — TTL-strenger Execute-Resolver (ADR-038-Restfrage lösen)
> **D-TTL:** **Ingest** honoriert TTL (bei Ankunft abgelaufen → nicht akzeptiert). **Display-Read** ist
> provenienz-only / TTL-lenient (zeigt „war ein gültiger Auftrag"). **Execute-Read** ist **TTL-streng
> fail-closed** — ein abgelaufener Auftrag wird **nie** ausgeführt. Getrennte Lese-Pfade, damit `inbox-api`
> (Anzeige) und der Execute-Pfad nicht denselben lenient-Check teilen.

## 6. B2b — Revocation: NEUES keyid-Denylist-Modul (nicht `crl.ts`)
Prämissen-Korrektur (CO, gegen Quelle verifiziert): **`crl.ts` kann das nicht beantworten** — es keyt auf
**Zertifikat-SHA-256-Fingerprints** (`crl.ts:14-23`), nicht auf `signer_keyid = sha256(PEM)`
(`signed-order.ts:83-85`). Andere Schlüsselräume, kein Join; zudem ist `crl.ts` **unverdrahtet** (0 Importeure),
ohne Mesh-Verteilung, ohne Re-Read. → **B2b ist Netto-Neubau** eines keyid-Denylists, keine Wiederverwendung.
Zu pinnen: **Frische-Bound** des Denylists (Cache + kein Frische-Limit = Race-Fenster nach Revocation),
**Authentizität** der Quelle, und **wer** einen Revocation-Eintrag autorisieren darf. Execute fail-closed bei
`revoked` **und** bei `unknown`-zur-Ausführungszeit (Trust wird **zur Execute-Zeit** aufgelöst, nicht aus der bei
Ingest eingefrorenen `trust_status`-Spalte gelesen — die hat bis heute keinen Writer).

## 7. B3 — Minimale Ausführung hinter ALLEN Gates
Ausführen nur wenn **alle** wahr: `verify_verdict=VALID` ∧ nicht-abgelaufen (TTL-streng) ∧ nicht-revoked ∧
**owner-allowlisted `(signer_keyid, order_type)`** ∧ nicht-konsumiert (Ledger) ∧ post-Epoch. Route über den
bestehenden `task-executor` (dessen Kapazitäts-Gate greift) — **plus per-signer Kapazitäts-/Rate-Fence**:
„gültige, distinct-nonce, signierte Aufträge" können den Executor genauso fluten wie der KW29-mount-Flood
(dieselbe Angriffsklasse; die Lektion wurde in diesem Repo schon einmal bezahlt).
- **Human-Approval-Gate existiert NICHT** (`MeldekanalRegistry` leer, `ApprovalGates`/`ApprovalService` toter
  Code). Sensible Order-Typen ⇒ **permanenter Deny** bis ein konkreter `Meldekanal` landet — fail-closed, aber
  als **benannte Entscheidung**, nicht als impliziter Pfad.

## 8. Invarianten, die VOR Code stehen müssen (Checkliste)
1. `ttl_ms>0` bounded für ausführbare Typen (sonst TTL-Gate vakuum). — §3
2. Kanonischer DER-SPKI-Keyid vor Ledger-/Revocation-Nutzung. — §3
3. Ledger-TOCTOU: `UNIQUE` + Reserve-vor-Dispatch, eine Txn, at-most-once. — §4
4. `order_type` nur aus `signed_bytes`. — §3
5. Trust zur **Execute-Zeit** auflösen, nicht die gespeicherte Spalte lesen. — §6
6. Execution-Epoch-Grenze gegen harvest-now-execute-later. — §3
7. Per-signer Kapazitäts-/Rate-Fence bei Ausführung. — §7
8. Denylist-Frische + Authentizität + Autorschaft definiert. — §6
9. Owner-Opt-in `(signer_keyid, order_type)`, default leer. — §1

## 9. Offene Christian-/CO-Entscheidungen (Gate vor B0-Code)
- **D-OWNER:** `[orders] execute` + Allowlist-Granularität `(signer_keyid, order_type)` bestätigen.
- **D-EPOCH:** harte Epoch-Grenze `T` **oder** verpflichtende max-TTL für ausführbare Typen?
- **Welche Order-Typen** sind überhaupt je ausführbar (Minimal-Startmenge, side-effect-arm)?
- **Revocation-Autorität:** wer darf einen `signer_keyid` widerrufen, und wie wird das im Mesh verteilt/
  authentifiziert?

## 10. Empfehlung
**B1 noch nicht coden.** Nach Christian-Sign-off auf D-OWNER/D-EPOCH + Startmenge ist **B0** der erste
Code-Slice (Profil + Config + Schema + Epoch), dann B1 (Ledger), B2a, B2b, B3 — jeweils eigener PR mit
Regression-Tests. Dieses Doc + der CO-Beleg sind die ADR-044-Grundlage.

---

### CO-Beleg (`pal:consensus`, 2026-07-16)
- **`cli-claude-opus` (neutral, 6/10):** Form richtig, aber 2 falsche Prämissen (`crl.ts`-Schlüsselraum,
  Approval-Gate existiert nicht) + 5 unbenannte Invarianten (TTL=0, PEM-Malleabilität, Ledger-TOCTOU,
  order_type-Provenienz, eingefrorener trust_status). Owner-Opt-in **verpflichtend**. B0 einfügen. → nach
  Doc-Fix 8-9.
- **`cli-claude-sonnet` (against, 4/10):** zusätzlich die **Epoch-/harvest-now-execute-later**-Attacke, das
  **Reserve/Commit-Protokoll gemeinsam mit B3** spezifizieren, per-`(signer_keyid,order_type)`-Grant,
  order_type aus `signed_bytes`, CRL-Frische/Authentizität/Autorschaft, **per-signer Rate-Fence** (KW29-Flood-
  Präzedenz). ⚠️ Cross-Vendor (codex/agy) nicht im PATH.
