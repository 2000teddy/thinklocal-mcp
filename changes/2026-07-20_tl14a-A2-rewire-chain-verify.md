# changes/2026-07-20 — feat(cert): Rewire `isRetainableCanonicalCert` auf Chain-Verify + Anker-Validity-Härtung (ADR-045 A2)

**Typ:** Daemon-Feature (additiv, verhaltensäquivalent für die heutige einstufige CA). **Kein**
Deploy/Secret/Cross-Host.

## Warum
ADR-045 Vorbedingung A lieferte die Chain-Primitive `verifyPeerCertChain` (#298). Nächster Schritt: die
Trust-Entscheidungen darauf umstellen (chain-ready für die 2-Tier-Zielhierarchie), **im kleinsten Schnitt, der
die Tests grün hält**.

## Was
- **Rewire `isRetainableCanonicalCert`** (`tls.ts`): der Retention-Verify nutzt jetzt
  `verifyPeerCertChain(trustedAttestingCaPems, [certPem])` statt `some(verifyPeerCert(ca, cert))`. Für die
  heutige **einstufige** CA äquivalent (Leaf direkt von einer Attesting-CA signiert); sobald ein Intermediate
  zwischentritt, kann der Aufrufer die volle Kette übergeben.
- **Voraussetzung gehärtet (Probe-Befund):** `verifyPeerCertChain([expiredCA], [leaf])` gab **fälschlich
  `true`** — forge validiert das Gültigkeitsfenster der Kettenglieder, aber **nicht** das des caStore-**Ankers**
  (dieselbe Lücke wie bei pathLen). Ohne Fix hätte das Rewire die **ADR-024-MEDIUM-1**-Garantie regressiert
  (eine abgelaufene Attesting-CA hätte ein kanonisches Cert behalten dürfen). Fix: explizite
  `notBefore`/`notAfter`-Prüfung des gefundenen Ankers in `verifyPeerCertChain` (fail-closed).
- **Test:** +1 in `chain-verify.test.ts` (abgelaufener Trust-Anker → `false`). Der bestehende ADR-024-
  Regressionstest (`tls.test.ts`, abgelaufene-Attesting-CA-Retention) bleibt grün und beweist die
  Verhaltens-Äquivalenz des Rewires.
- **Bewusst NICHT rewired:** `selectTrustDistributionCa` (Semantik „welche CA verifiziert das Serving-Cert
  direkt" → gibt die CA zurück, nicht bool) und der Token-Onboard-Check (Single-Anchor-Direktprüfung gegen
  die **eine** gelieferte CA) — dort ist der flache `verifyPeerCert` der natürliche Fit; ein Rewire wäre
  Verrenkung ohne Nutzen bis 2-Tier (TL-14b).

## Abgrenzung
Verhaltensäquivalent für single-tier; **keine** Änderung am flachen `verifyPeerCert` selbst (#295 bleibt grün).
Kein Deploy/Secret. Das vollständige 2-Tier-Wiring (Aufrufer übergibt die Kette inkl. Intermediate) kommt mit
TL-14b.

## Compliance
- **CO/CG:** entfallen — kein neuer Design-Beschluss (ADR-045 akzeptiert A), kein Boilerplate.
- **TS ✅:** `tls.test.ts` 49/49 (inkl. ADR-024-Retention/abgelaufene-Attesting-CA), +1 chain-verify-Test;
  Full-Suite **1769 grün** (131 Files), `tsc --noEmit` (strict) 0, eslint neuer Code 0 (der Error `tls.ts:563`
  ist pre-existing, außerhalb der Edits).
- **CR:** externer Claude-Review-Subagent vor Merge (prüft: single-tier-Äquivalenz, Anker-Validity korrekt/
  fail-closed, ADR-024 MEDIUM-1 erhalten, keine anderen Caller berührt).
- **PC:** `git diff` gesichtet, Secret-Scan clean (Certs zur Laufzeit geforgt).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, `tls.ts`, `chain-verify.test.ts`.
