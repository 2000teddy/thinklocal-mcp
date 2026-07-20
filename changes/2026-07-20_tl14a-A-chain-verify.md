# changes/2026-07-20 — feat(cert): chain-fähiger Verify + pathLen-Enforcement (ADR-045 Vorbedingung A)

**Typ:** Daemon-Feature (additiv). **Kein** Deploy/Secret/Cross-Host. Der bestehende **flache**
`verifyPeerCert` + alle seine Caller bleiben **unverändert**.

## Warum
ADR-045 / `TL-14a-blocker-AB-grounding.md` **Blocker A**: `verifyPeerCert` ist ein flacher
Ein-Aussteller-Verify — er kann ein Leaf nur gegen seinen **direkten** Aussteller prüfen, baut keine Kette und
erzwingt kein `pathLenConstraint` (regressionsfest belegt in `tls-chain-characterization.test.ts`, #295). In
der zweistufigen Zielhierarchie (Root → Intermediate → Leaf, ADR-045 D2) ist der Trust-Anker die **Root**, das
Leaf aber vom **Intermediate** signiert — der flache Verify reicht dort nicht.

## Was
- **`tls.ts` — neu `verifyPeerCertChain(trustAnchorPems, chainPems)`:** baut die volle Kette (chain **leaf-
  first**: `[leafPem, intermediatePem, …]`, Root NICHT enthalten) und verifiziert sie gegen einen/mehrere
  Root-Anker via forge `verifyCertificateChain`. Fail-closed (jeder Fehler/leere Eingabe ⇒ `false`).
- **Befund während der Implementierung (Attempt 1):** forge `verifyCertificateChain` prüft Signaturen,
  Gültigkeitsfenster **und** das `cA`-Flag (ein Nicht-CA-Zwischenglied wird abgelehnt), **aber nicht**
  `pathLenConstraint` — ein Root mit `pathLen 0` akzeptierte fälschlich eine Intermediate-Kette. **Attempt 2:**
  manuelles pathLen-Enforcement (`enforcePathLenConstraint`) über den rekonstruierten root→leaf-Pfad ergänzt
  (RFC 5280 §4.2.1.9: für jede CA-Stufe mit `pathLen = L` ≤ L untergeordnete CAs). Grün.
- **`chain-verify.test.ts` (neu, +6 Tests):** gültige 2-Stufen-Kette akzeptiert; **Root mit `pathLen 0` lehnt
  Intermediate-Kette ab**; Charakterisierungs-Kontrast (flacher `verifyPeerCert(root, leaf)` = false, chain =
  true); Fremd-Anker → false; unvollständige Kette (Intermediate fehlt) → false; leere Eingaben → false.

## Abgrenzung
**Additive Primitive** — der flache `verifyPeerCert` und seine Trust-Entscheidungen
(`isRetainableCanonicalCert`/`selectTrustDistributionCa`/Token-Onboard) bleiben **byte-unverändert**; #295
bleibt gültig. Das **Umstellen** dieser Caller auf `verifyPeerCertChain` ist ein **Folge-Slice** und erst mit
einer echten 2-Tier-Hierarchie (TL-14b) nötig — heute ist die CA einstufig. Kein Deploy/Secret.

## Compliance
- **CO/CG:** entfallen — kein neuer Design-Beschluss (ADR-045 akzeptiert A), kein generierter Boilerplate.
- **TS ✅:** +6 Tests; Full-Suite **1768 grün** (131 Files), `tsc --noEmit` (strict) 0, eslint neue Datei +
  neue Funktion 0 (der eslint-Error `tls.ts:563` ist **pre-existing**, außerhalb der Edit-Region).
  Charakterisierungs-Test #295 unverändert grün (flacher Pfad nicht berührt).
- **CR:** externer Claude-Review-Subagent vor Merge (prüft: pathLen-Logik korrekt/RFC-konform, Anker-
  Rekonstruktion, fail-closed, flacher Pfad unberührt, Tests nicht tautologisch).
- **PC:** `git diff` gesichtet, Secret-Scan clean (Certs zur Laufzeit geforgt, kein Key-Material).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, `tls.ts`, `chain-verify.test.ts`.
