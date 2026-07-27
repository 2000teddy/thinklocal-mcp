# TL-12 B1 — Reihenfolge-Pflicht: Keyid-Backfill VOR der `UNIQUE`-Bedingung

**Zeitstempel:** 2026-07-27 07:50
**Autor:** Claude (Opus 4.8), Administrator TH01 — im Auftrag Christian Ullmann
**Art:** Reine TODO-Notiz (Befund-Verankerung aus dem #323-Review). **Kein** Schema-Eingriff,
**keine** Migration, **kein** Code/Test. Doc-only.
**Betroffene Datei:** `TODO.md` (neuer Unterpunkt im TL-12-Block, direkt nach der B1-Vorarbeit #324) ·
`CHANGES.md` · `COMPLIANCE-TABLE.md` · dieser Eintrag.

## Auslöser

Beim externen Review zu **#323** (`canonicalOrderKeyId`, DER-SPKI-Keyid) fiel ein Befund für **B1** an,
der in der Eingabezeile hängenblieb und nie eingetragen wurde (Supervisor-Nachtrag 2026-07-27). Er wird
hier verbindlich verankert, bevor B1 gebaut wird.

## Der Befund

B1 will den kanonischen DER-SPKI-Keyid auf die Ledger-Bedingung `UNIQUE(signer_keyid, order_nonce)` legen.
Die Spalte `signer_keyid` wird aber **heute schon befüllt** — und zwar mit dem **format-malleablen
PEM-Hash** aus dem unveränderten `orderKeyId`:

- Schreibende Stelle: `packages/daemon/src/index.ts:876` → `signerKeyid: orderKeyId(senderPublicKey)`
- Persistiert: `packages/daemon/src/agent-inbox.ts:315/336` (`signer_keyid` in `messages`)
- Bereits indiziert (nicht-unique): `agent-inbox.ts:188/219`
  `CREATE INDEX idx_messages_order ON messages (signer_keyid, order_nonce)`

## Warum die Reihenfolge zählt

Stellt B1 die Spaltensemantik auf „kanonisch" um und setzt die `UNIQUE`-Bedingung, **ohne** die Altzeilen
vorher zu backfillen, dann kollidiert ein wiedereingespielter **Alt**-Auftrag nicht mit seiner neuen
kanonischen Zeile — die Altzeile trägt den PEM-Hash, die neue den DER-Hash. Der Replay-Schutz startet mit
einem **Übergangsloch für Alt-Aufträge**, ausgerechnet in dem Slice, der ihn einführt.

## Warum der Backfill möglich ist (ohne neu zu sammeln)

`signer_pubkey` liegt **unveränderlich** in derselben Zeile (`agent-inbox.ts:73`, trust-on-first-verify,
rotationsfest; vgl. `verifyStoredOrder`, `agent-inbox.ts:374ff.`). Der kanonische Keyid ist damit für jede
Altzeile aus `signer_pubkey` nachrechenbar (`canonicalOrderKeyId`). Liefert die Funktion `null` (nicht
parsebar), wird die Zeile **ehrlich als nicht-backfillbar markiert** — **nicht** stillschweigend der
PEM-Hash weitergeschleppt.

## Reihenfolge-Bedingung (das Eigentliche)

> **Backfill `signer_keyid` (kanonisch aus `signer_pubkey`) VOR dem Umstellen der Spaltensemantik und dem
> Setzen der `UNIQUE(signer_keyid, order_nonce)`-Bedingung.**

Umsetzung (Schema-Migration + Backfill-Lauf) gehört in den gateten **B0/B1**-Slice; dieser Eintrag ist
reine Reihenfolge-Notiz und ändert nichts am Bestand.

## Abgrenzung

Kein `.ts`-Diff, keine Migration, keine der vier §9-Entscheidungen berührt. Slice B bleibt vollständig
gated.
