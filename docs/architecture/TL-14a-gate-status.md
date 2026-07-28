# TL-14a — Gate-Status-Snapshot (Park-Note)

**Typ:** Status/Park-Note, doc-only, non-gated. **Entscheidet nichts.** **Datum:** 2026-07-28 (KW31).
**Zweck:** den aktuellen Gate-Stand in Repo-Wahrheit festhalten und belegen, dass **JETZT kein
agent-ausführbarer, non-gated Code-Slice** offen ist. Konsolidiert die verstreuten `[~]`-Zeilen im TODO
(§398–499) + ADR-045 zu einem prüfbaren Snapshot. Verwandt: `ADR-045-ca-two-stage-hierarchy.md`,
`TL-14a-decision-checklist.md`, `TL-14a-blocker-AB-grounding.md`, `TL-14a-blocker-C-grounding.md`.

## 1. Agent-ausführbare Lane = ERSCHÖPFT (code-verifiziert @ `main` 6ef6b11)

Die einzige non-gated Lane vor TL-14b waren die Vorbedingungs-Slices A + B. **Beide sind komplett** — nicht
nur laut Commit-Prosa, sondern im aktuellen Baum verifiziert:

| Vorbedingung | Beleg im Baum | Status |
|--------------|---------------|--------|
| **A** — Chain/pathLen-Enforcement | `verifyPeerCertChain` (`tls.ts`, #298) · `chain-verify.test.ts` (pathLen-0-Reject, D2-Invariante #311) · `tls-transport-pathlen.conformance.test.ts` (#342, echter mTLS-Handshake: Node-TLS erzwingt pathLen NICHT → Trust MUSS App-Ebene sein) | ✅ komplett + regressionsfest |
| **B** — Intermediate-Expiry-Monitoring | `getCaCertDaysLeft` + `buildCertExpiryMonitorSpecs` (`cert-monitor-wiring.ts`, #297/#344) · `cert-monitor-wiring.test.ts` (Node/CA getrennte Quellen bewiesen) | ✅ komplett + verdrahtungsfest |
| **C** — Revocation | `crl.ts` (Denylist, datei-persistiert) existiert, aber **0 Nicht-Test-Aufrufer** (grep-verifiziert) = totes Dead-Code · `crl.test.ts` charakterisiert Ist-Verhalten (#341) | ⚠️ nur gegroundet, **bewusst NICHT verdrahtet** (siehe Gate G2) |

## 2. Offene Gates (keiner agent-lösbar)

| Gate | Was fehlt | Entscheider | Entriegelt |
|------|-----------|-------------|-----------|
| **G1** | **D3 — exakte Intermediate-Laufzeit** im Korridor **1–3 Jahre** setzen (opus 12–24 Mon., sonnet 3 J; beide verwerfen ≥5 J). → ADR-045 `Proposed`→`Accepted`, D1/D4/D5/D6-Gates bestätigen | **Christian (Owner)** | Runbook-Volltext + Zeremonie-Skripte |
| **G2** | **C-Klassifikation**: Revocation-Lücke = **TL-14b-Blocker** (dann fehlt C in ADR-045 §74) oder **Fast-Follow** (dann widerspricht §74 dem Consensus A–C-blockierend)? + Form (Denylist vs CRL/OCSP) + Distribution/Pinning | **CO/Owner** | `crl.ts`-Verdrahtung |
| **G3** | **Cross-Vendor-Consensus-Pass**: `codex`/`agy` NOT in PATH (2026-07-21 verifiziert) → GPT/Gemini-Sicht fehlt. **Kein** Konsens-Fehlschlag (5/6 stehen), reine Infra-Blockade | Infra/Christian | optionale Zusatz-Sicht |
| **G4** | **TL-14b-Durchführung**: Token-Re-Onboard je Node + Zwei-Peer-Proof | **⛔ Termin + Christian** | out-of-repo |

## 3. Warum kein non-gated Slice vorgezogen wird (bewusst, nicht faul)

- **Runbook-Volltext + Zeremonie-Skripte** sind per Prozess *nach* G1/ADR-`Accepted` sequenziert
  (Checklist §111, ADR §130/§135 „auf Basis dieser ADR"). Die Skripte brauchen die konkrete D3-Laufzeit in
  der Cert-Erzeugung — vor G1 wären sie an genau der offenen Stelle unvollständig. Vorziehen = Nebelmaschine
  + PR-#83-Lehre (Reihenfolge nicht umgehen).
- **C-Verdrahtung** (`isRevoked` in den Connection-Setup, Kandidat `agent-card.ts:311/353`) hängt an G2
  (Form + Blocking-Status + Distribution) — Owner/CO-Entscheidungen, kein Code-Slice.
- **A2-rest** (`selectTrustDistributionCa` + Token-Onboard rewiren) ist deferred bis 2-Tier es erfordert
  (TL-14b); flacher `verifyPeerCert` ist dort der natürliche Fit. Vorziehen wäre spekulativ.

## 4. Bekannte Kleinlast (kein eigener Slice jetzt)

`crl.ts:5–7`-Header behauptet weiterhin „werden beim Heartbeat und bei der Agent-Card-Verifikation geprueft" —
das ist **nicht** verdrahtet. Bereits in `TL-14a-blocker-C-grounding.md` §1 als aspirational/tot geflaggt
(also in-repo dokumentiert, nicht still). **Reparatur gehört in den C-Verdrahtungs-Slice** (dann wird der
Header *wahr*), nicht in eine Micro-PR jetzt, die ihn auf „nicht verdrahtet" ändert und die G2-Verdrahtung
gleich zurückdreht (Churn).

## 5. Fazit

TL-14a steht an der agent-ausführbaren Grenze: **A + B fertig, Rest gated.** Nächste Entriegelung = **G1**
(eine Zahl, Christian) und unabhängig davon **G2** (CO/Owner). Bis dahin: **sauber geparkt, keine offene
Code-Arbeit.**

## Abgrenzung
Doc-only. Kein Code/Config/Skript, kein Deploy/Secret/Cross-Host, keine Entscheidung, kein Gate vorweggenommen.
Reiner prüfbarer Snapshot des Ist-Gate-Stands.
