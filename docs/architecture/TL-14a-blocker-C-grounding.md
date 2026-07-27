# TL-14a — Auflage C (Revocation) gegroundet

**Status:** Grounding/Discovery (code-verifiziert; **entscheidet nichts** — die C-Entscheidung bleibt CO/Owner).
**Datum:** 2026-07-27 · **Typ:** Vorbedingungs-Grounding, non-gated (Schwester von `TL-14a-blocker-AB-grounding.md`).

## 0. Warum diese Note
Der Consensus-Lauf (`TL-14a-consensus-result-D1-D6.md` §C, beide Modelle **blockierend**) führt **Auflage C —
„Keine Revocation-Infrastruktur (CRL/OCSP)"**. Für **A** und **B** gibt es ein code-verifiziertes Grounding
(`TL-14a-blocker-AB-grounding.md`) + gemergte Vorbedingungs-Slices (#297/#298/#299/#311). **C hatte als
einzige der drei blockierenden Auflagen KEIN Grounding** — nur die Notiz „gehört als offener Punkt in die
ADR". Diese Note holt das nach: Ist-Zustand + die exakten offenen Entscheidungen, damit der C-Schritt
**belegbar** statt geraten ist. Sie **verdrahtet nichts** und **entscheidet nichts**.

## 1. Ist-Zustand (code-verifiziert @ `main` 53dfa2f)

**Es existiert bereits eine Fingerprint-Denylist — aber sie ist totes, ungetestetes Dead-Code.**
- `packages/daemon/src/crl.ts` `CertificateRevocationList`: `revoke(fp, reason, agentId?)` · `isRevoked(fp)`
  · `unrevoke(fp)` · `list()` · `size` — In-Memory `Map` **+ datei-persistiert** (`<dataDir>/certs/crl.json`,
  atomarer `tmp→rename`-Write, fail-safe `load`). Das **ist** strukturell genau die vom Consensus für C
  vorgeschlagene **„gepinnte Denylist kompromittierter Fingerprints"**.
- **Aber: 0 Nicht-Test-Aufrufer.** `grep "from './crl"` über `packages/daemon/src/*.ts` (ohne Tests) = **0
  Treffer**. Der Datei-Kopf behauptet „Revozierte Fingerprints werden **beim Heartbeat und bei der
  Agent-Card-Verifikation geprüft**" — das ist **NICHT verdrahtet** (aspirational/tot).
- **Der natürliche Hook wäre vorhanden:** die Peer-Zertifikats-Fingerprints liegen beim Connection-Setup
  bereits vor — `agent-card.ts:311` (`issuerCertificate.fingerprint256`) und `:353`
  (`peerCert.fingerprint256`, als `certFingerprint` ins Audit). Dort läuft **keine** `isRevoked`-Prüfung.
- **Kein Test:** vor diesem Slice existierte **kein** `crl.test.ts` — die Denylist war unbewacht.

**Neu mit diesem Slice:** `crl.test.ts` **charakterisiert** das Ist-Verhalten (revoke/isRevoked/unrevoke/
size/list, Datei-Persistenz-Roundtrip, fail-safe Load bei fehlender/korrupter Datei, atomarer Write) — **ohne
Verdrahtung**, damit eine spätere Wiring-Entscheidung auf bewachtem Boden steht (dieselbe Mechanik wie das
A-Grounding mit `tls-chain-characterization.test.ts`).

## 2. Ein zu klärender Widerspruch (nicht hier entschieden)
Der Consensus stuft **A–C alle drei als blockierend** ein (`consensus-result` §C: „beide Modelle:
blockierend"). **ADR-045** (`ADR-045-ca-two-stage-hierarchy.md` §74 „Zwingende Vorbedingungen (blockierend —
VOR TL-14b)") führt aber **nur A und B**, nicht C. ⇒ Offen: **Ist C eine TL-14b-blockierende Vorbedingung
(dann fehlt sie in ADR-045) oder ein Fast-Follow (dann widerspricht ADR-045 dem Consensus-Wording)?** Das ist
eine CO-/Owner-Klärung, kein Code.

## 3. Offene Entscheidungen (VOR Code/Verdrahtung — CO/Owner)
1. **Form:** gepinnte Fingerprint-Denylist (Consensus-Empfehlung, proportional zur ~10-Node-Größe) **vs.**
   volles CRL/OCSP. Beide Modelle: Denylist genügt.
2. **Bestehende `crl.ts` verdrahten vs. Neubau:** die vorhandene `CertificateRevocationList` deckt die
   Denylist-Semantik bereits ab ⇒ „C umsetzen" ≈ **`isRevoked` beim Connection-Setup einhängen** (Kandidat:
   `agent-card.ts` mTLS-Pfad, wo der Fingerprint schon vorliegt), nicht neue Infra bauen.
3. **Blocking-Status (siehe §2):** blockiert C TL-14b oder nicht? ADR-045 mit dem Consensus abgleichen.
4. **Distribution/Pinning der Denylist:** wie werden kompromittierte Fingerprints ins Mesh verteilt und
   gepinnt (Owner-signiert? Bootstrap-Datei?) — Sicherheits-/Betriebsentscheidung, Owner.

## 4. Was hier NICHT passiert
Keine Verdrahtung von `crl.ts`, keine Connection-Setup-Prüfung, keine ADR-045-Änderung, keine
C-Blocking-Entscheidung. Rein Grounding + Charakterisierung. **Owner/CO-gated:** §2 + alle §3-Punkte.

## 5. Verweise
- `docs/architecture/TL-14a-blocker-AB-grounding.md` (Schwester-Grounding A/B)
- `docs/architecture/TL-14a-consensus-result-D1-D6.md` §C
- `docs/architecture/ADR-045-ca-two-stage-hierarchy.md` §74 (nur A/B als Vorbedingung — siehe §2)
- Code: `packages/daemon/src/crl.ts` (+ neu `crl.test.ts`), Hook-Kandidat `agent-card.ts:311,353`.
