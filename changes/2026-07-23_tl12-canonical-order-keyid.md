# changes/2026-07-23 — fix(tl12): `canonicalOrderKeyId` — format-stabiler Keyid (DER-SPKI) + #322-Reconcile

**Typ:** additive, **ungegatete** reine Primitive (Code + Tests, **0 Aufrufer**) + eingefalteter
Post-Merge-Reconcile für #322. Kein Runtime-Change, kein Deploy/Secret/Host, **kein** Gate-Flip.

## Abgrenzung vorweg: das ist **nicht** Slice B/B0
TL-12 **Slice B** bleibt vollständig gated, und dieser Slice rührt keine der vier Christian-Entscheidungen
aus dem Scoping §9 an (`[orders] execute`-Opt-in, Epoch-Grenze `T`, ausführbare Startmenge,
Revocation-Autorität). Es entsteht **kein** Executable-Profil, **keine** Config, **kein** Schema, **kein**
Ledger, **keine** Denylist, **kein** Execute-Pfad. Gebaut wird **eine** Funktion, die einen **bereits
vorhandenen Defekt** in einer **bereits gemergten** Funktion neutralisiert — mit 0 Aufrufern.

## Der Defekt (reproduziert, nicht vermutet)
`signed-order.ts` `orderKeyId(publicKeyPem)` hasht die **PEM-Textdarstellung**:
```ts
createHash('sha256').update(publicKeyPem).digest('hex')
```
Damit ist der Keyid eine Eigenschaft der **Serialisierung**, nicht des Schlüsselmaterials. Dasselbe
Schlüsselpaar, nur mit CRLF statt LF und zwei zusätzlichen Leerzeilen, ergibt einen **anderen** Keyid —
die DER-SPKI-Bytes sind dabei **byte-identisch**. Nachgewiesen und als Test festgeschrieben.

**Warum das zählt (Slice-B-Scoping §3):** solange der Keyid nur Anzeige/Audit ist, ist die Malleabilität
folgenlos — heute stempelt ihn `index.ts:875` auf gespeicherte Zeilen. Sobald er aber der
`UNIQUE(signer_keyid, order_nonce)`-Schlüssel des Idempotenz-Ledgers (B1) **oder** der Join-Key der
Revocation-Denylist (B2b) wird, ist er ein **Umgehungspfad**: ein Relay könnte denselben Auftrag durch
bloßes **Umformatieren** des mitgelieferten PEM erneut ausführbar machen (neue Ledger-Zeile) bzw. eine
Sperre umgehen (andere Denylist-Zeile) — **ohne** die Signatur zu berühren, die über die verbatim Bytes
läuft. Genau deshalb verlangt das Scoping die Kanonisierung **bevor** der Keyid diese Rolle bekommt.

## Was
- **Neu `canonicalOrderKeyId(publicKeyPem): string | null`** — sha256hex über die **DER-SPKI-Bytes**.
  Gleichwertige PEM-Kodierungen desselben Schlüssels ⇒ **derselbe** Keyid; verschiedene Schlüssel bleiben
  unterscheidbar; algorithmus-agnostisch (P-256 **und** Ed25519 geprüft).
  **Fail-closed:** nicht parsebar ⇒ `null` — **kein** Ersatz-Keyid und **kein** Fallback auf den PEM-Hash
  (ein geratener Keyid wäre genau die Kollision, die die Funktion verhindern soll). Wirft nie.
  **Privates Schlüsselmaterial wird ausdrücklich abgelehnt:** `createPublicKey()` leitet aus einem privaten
  PEM klaglos den öffentlichen Schlüssel ab — ein Aufrufer, der versehentlich den Signier- statt den
  Verify-Schlüssel übergibt, bekäme sonst einen *gültig aussehenden* Keyid, und Geheimmaterial liefe durch
  die Funktion. Beides ⇒ `null` (beim Testen aufgefallen, nicht nachträglich behauptet).
- **`orderKeyId` bleibt unverändert** — es stempelt bereits gespeicherte Zeilen; ein Wechsel wäre eine
  **Datenmigration** und gehört in den gateten B0-Slice. Sein Doc-Kommentar benennt die Malleabilität jetzt
  explizit und verweist auf die kanonische Variante.
- **0 Aufrufer** (per grep belegt) ⇒ kein Runtime-Change.
- **Doku:** `TL-12-slice-b-execution-scoping.md` §3 „Umsetzungsstand" — dieser eine B0-Baustein ist
  vorbereitet, die übrigen (Owner-Opt-in-Config, Schema, `order_type`-Provenienz, **Epoch-Grenze**) bleiben
  an §9 gegated.

## Tests (+8; Suite **2000 grün**, 141 Files)
`signed-order.test.ts`: **Defekt-Beleg** (`orderKeyId` ändert sich beim Umformatieren) · kanonischer Keyid
gegen dieselbe Umformatierung **stabil** · verschiedene Schlüssel bleiben verschieden · Ed25519 zusätzlich
zu P-256 · fail-closed über 8 unbrauchbare Eingaben (leer/Whitespace/kein PEM/kaputtes Base64/`null`/
`undefined`/Zahl/Objekt) · **privater Schlüssel ⇒ `null`** · wirft nie · **`orderKeyId` unverändert**
(Regressionsanker gegen einen stillen Semantikwechsel gespeicherter Zeilen).

## Eingefaltet: #322-Reconcile
`#322` ist seit `mergedAt=2026-07-23T11:45:36Z` gemergt (mergeCommit `17937b3`). Nachgezogen:
COMPLIANCE-Erst-Spalte → `#322` + `(base=main, gemergt)`, CHANGES-Überschrift `, #322)`, TODO-Eintrag
annotiert. Zuordnung `gh`-verifiziert, Timestamp-Anker eindeutig, 1:1 in-place.

## Compliance
- **CO/CG:** entfallen — kein Design-Diff und **keine** offene Entscheidung berührt; die Kanonisierung ist
  im Scoping §3 bereits als Anforderung festgehalten, hier wird sie nur als reine Primitive erfüllt
  (Prep-Form wie #314/#317/#322). `clink`/`gemini` nicht im PATH.
- **TS ✅:** +8 Tests, Suite **2000 grün** (141 Files), `tsc --noEmit` (strict) 0, geänderte Dateien
  eslint 0/0, prettier clean.
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent,
  `[[pal-review-backend-agy-missing]]`).
- **PC:** Secret-Scan clean — Tests erzeugen Schlüssel in-memory, kein Material im Repo.
- **DO ✅:** dieser Eintrag, `docs/architecture/TL-12-slice-b-execution-scoping.md` §3, `TODO.md`,
  `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-12 Slice B (alle vier §9-Entscheidungen) und Slice C (V1–V3), ADR-046-Producer
(CO), TL-11 Slice B (Host-Hop), TL-10-Verdrahtung (D1-Loader/D3).
