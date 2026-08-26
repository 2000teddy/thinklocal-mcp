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
| ~~**G1**~~ ✅ **GESCHLOSSEN 2026-08-26** | **D3 = 24 Monate** gesetzt (Owner-Sign-off Christian), D1/D2/D4/D5/D6 mit-bestätigt, **ADR-045 `Proposed`→`Accepted`**. Begründung der Zahl: **Zeremonie-Probe-Erzwingung (D6)**, nicht Kompromittierungs-Fenster-Kompensation. Beleg: `TL-14a-G1-decision-brief.md` §5 | ~~Christian~~ **erledigt** | ✅ **Runbook-Volltext + Zeremonie-Skripte entriegelt** |
| ~~**G2**~~ ✅ **GESCHLOSSEN 2026-08-26** | C **gesplittet + owner-ratifiziert**: **C1** (lokales `isRevoked`-Enforcement, App-Ebene, `agent-card.ts:311`+`:353`) = **blockierende Vorbedingung** (jetzt in ADR-045 §Vorbedingung C1); **C2** (Mesh-Verteilung) = **Fast-Follow, bewusst nichts bauen** (ADR-045 §Konsequenzen, Trigger >25 Nodes / Nicht-Owner). Form: **Denylist**, kein CRL/OCSP. Belege: `TL-14a-consensus-result-C.md` (CO + Ratifizierungs-Tabelle) | ~~CO/Owner~~ **erledigt** | C1-Slice **inhaltlich definiert** — ⛔ **Codier-Freigabe steht noch aus** |
| **G3** | **Cross-Vendor-Consensus-Pass**: `codex`/`agy` NOT in PATH (**2026-08-25 erneut laufzeit-verifiziert**: PAL listet beide als konfiguriert, beide scheitern beim Aufruf) → GPT/Gemini-Sicht fehlt. **Kein** Konsens-Fehlschlag, reine Infra-Blockade | Infra/Christian | optionale Zusatz-Sicht |
| **G4** | **TL-14b-Durchführung**: Token-Re-Onboard je Node + Zwei-Peer-Proof | **⛔ Termin + Christian** | out-of-repo |

## 3. Warum kein non-gated Slice vorgezogen wird (bewusst, nicht faul)

- **Runbook-Volltext + Zeremonie-Skripte** sind per Prozess *nach* G1/ADR-`Accepted` sequenziert
  (Checklist §111, ADR §130/§135 „auf Basis dieser ADR"). Die Skripte brauchen die konkrete D3-Laufzeit in
  der Cert-Erzeugung — vor G1 wären sie an genau der offenen Stelle unvollständig. Vorziehen = Nebelmaschine
  + PR-#83-Lehre (Reihenfolge nicht umgehen).
- **C-Verdrahtung** (`isRevoked` in den Connection-Setup, Kandidat `agent-card.ts:311/353`) hängt an G2
  (Form + Blocking-Status + Distribution) — Owner/CO-Entscheidungen, kein Code-Slice.
  **Update 2026-08-25:** Form + Blocking-Status + Distribution sind durch den CO-Lauf **beantwortet**
  (`TL-14a-consensus-result-C.md`: C1 blockierend/klein, C2 Fast-Follow, Denylist, App-Ebene, beide
  Fingerprints). Der C1-Slice ist damit **inhaltlich definiert**, aber **weiterhin nicht freigegeben** — er
  wartet auf die **Owner-Ratifizierung**. Kein Vorgriff.
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

**Nachtrag 2026-08-25 (KW35):** Der **CO-Anteil von G2 ist erledigt** (`TL-14a-consensus-result-C.md`) — damit
sind **beide** verbleibenden Entriegelungen jetzt **reine Owner-Entscheidungen**: **G1** (die D3-Zahl) und
**G2-Owner** (C1/C2-Ratifizierung + Freigabe des C1-Slices). Die agent-ausführbare Lane bleibt **erschöpft**;
der inhaltlich definierte C1-Slice wird **nicht** vorgezogen.

**Nachtrag 2026-08-26 — G1 UND G2 gezeichnet, die Lane ist wieder offen.** Christian hat **D3 = 24 Monate**
gesetzt und **C1/C2 ratifiziert**; ADR-045 ist `Accepted`. Damit ändert sich der Befund dieses Dokuments
grundlegend:
- **Entriegelt und agent-ausführbar:** **Runbook-Volltext + Zeremonie-Skripte** (Papier+Skripte, non-gated) —
  die D3-Zahl steht jetzt in der Cert-Erzeugung fest, die Sequenzierungs-Begründung aus §3 ist damit erfüllt.
- **Definiert, aber ⛔ nicht freigegeben:** der **C1-Slice** (`crl.ts`-Verdrahtung). Die *Klassifikation* ist
  ratifiziert, der *Codier-Start* ist ein **eigener Owner-Akt** und steht aus.
- **Weiter gated:** **G3** (Cross-Vendor-CO, Infra) und **G4** (TL-14b, ⛔ Termin) — Letzteres setzt jetzt
  zusätzlich **C1** voraus.

## Abgrenzung
Doc-only. Kein Code/Config/Skript, kein Deploy/Secret/Cross-Host, keine Entscheidung, kein Gate vorweggenommen.
Reiner prüfbarer Snapshot des Ist-Gate-Stands.
