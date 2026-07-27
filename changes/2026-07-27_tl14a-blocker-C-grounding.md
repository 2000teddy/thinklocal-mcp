# changes/2026-07-27 — docs+test(tl14a): Auflage C (Revocation) gegroundet + `crl.ts`-Charakterisierung

**Typ:** **Grounding-Doc + Charakterisierungs-Test** (Vorbedingungs-Lane, **non-gated**). Kein Fix, keine
Verdrahtung, keine Entscheidung, kein Deploy/Secret/Host. Schwester zum gemergten A/B-Grounding
(`TL-14a-blocker-AB-grounding.md`). **Nimmt die C-Entscheidung NICHT vorweg.**

## Die Lücke
Der TL-14a-Consensus (`TL-14a-consensus-result-D1-D6.md` §C) führt **Auflage C — „Keine Revocation-Infra"**
als **blockierend** (beide Modelle). Für **A** und **B** gibt es ein code-verifiziertes Grounding + gemergte
Slices (#297/#298/#299/#311); **C war die einzige der drei blockierenden Auflagen ohne Grounding** — nur die
Notiz „gehört als offener Punkt in die ADR".

## Was
- **Neu `docs/architecture/TL-14a-blocker-C-grounding.md`** — code-verifizierter Ist-Zustand + offene
  Entscheidungen. Kernbefund: `packages/daemon/src/crl.ts` (`CertificateRevocationList`, `revoke`/`isRevoked`/
  `unrevoke`/`list`/`size`, datei-persistiert, atomarer Write) **existiert bereits** als genau die vom
  Consensus vorgeschlagene **gepinnte Fingerprint-Denylist** — ist aber **0-Aufrufer-Dead-Code** (`grep
  "from './crl"` ohne Tests = 0), obwohl der Datei-Kopf „geprüft beim Heartbeat/Agent-Card-Verifikation"
  behauptet (nicht verdrahtet). Hook-Kandidat vorhanden: Peer-Fingerprint liegt bei `agent-card.ts:311,353`
  vor. **Aufgedeckter Widerspruch:** Consensus stuft A–C blockierend ein, **ADR-045 §74 führt nur A/B**.
- **Neu `packages/daemon/src/crl.test.ts`** (+6 Tests) — **charakterisiert** das Ist-Verhalten der bislang
  ungetesteten `crl.ts`: revoke→isRevoked / unbekannt→false; size/list + idempotentes revoke je FP; unrevoke;
  Datei-Persistenz-Roundtrip (neue Instanz lädt); fail-safe Load (fehlende/korrupte Datei ⇒ leer, kein Wurf);
  atomarer Write ⇒ gültiges JSON-Array. **Keine Verdrahtung** (wie `tls-chain-characterization.test.ts` für A).

## Offen (CO/Owner — hier NICHT entschieden)
Form (Denylist vs CRL/OCSP) · `crl.ts` verdrahten vs Neubau · C-Blocking-Status vs ADR-045 (§2 der Note) ·
Distribution/Pinning der Denylist.

## Compliance
- **CO/CG:** entfallen — Grounding leitet aus gemergtem Code/Consensus ab, entscheidet nichts; `clink`/`gemini`
  nicht im PATH.
- **TS ✅:** +6 Charakterisierungs-Tests (Ist-Verhalten festgeschrieben); `tsc`/`eslint` grün, Full Suite
  **2093 grün** (148 Files; +6 ggü. 2087).
- **CR:** Self-Review — Test charakterisiert nur (keine Verhaltensänderung an `crl.ts`), Note verdrahtet
  nichts; externes `agy`-Review am PR.
- **PC:** Secret-Scan clean (Test-Fingerprints synthetisch, keine echten Zertifikate/Secrets).
- **DO ✅:** dieser Eintrag, `TL-14a-blocker-C-grounding.md`, `crl.test.ts`, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-14a **Christian-Sign-off (D3) → ADR-045 Accepted**, Runbook-Volltext, TL-14b; die
C-Entscheidung (§3 der Note). **Nicht berührt:** ADR-046 §9, msg 1453, TL-08/09/10-Gates.
