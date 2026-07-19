# changes/2026-07-19 — test(tl14a): Blocker-A Charakterisierungs-Test (verifyPeerCert baut keine Kette)

**Typ:** Test-only (Charakterisierung, **kein** Fix, **kein** Verhaltens-Change). Kein Deploy/Secret/Cross-Host.

## Warum
ADR-045 + `TL-14a-blocker-AB-grounding.md` stellen fest: `verifyPeerCert` ist ein flacher Ein-Aussteller-
Verify ohne Chain-Building/pathLen → in einer zweistufigen Hierarchie kann die Root ein Intermediate-Leaf
nicht verifizieren. Diese Aussage war bisher **nur dokumentiert**. Der erste, klar ungated + repo-sichere
Vorbedingungs-A-Schritt ist, sie **testgebunden** zu machen, bevor TL-14b die CA-Hierarchie berührt.

## Was
- **Neu `packages/daemon/src/tls-chain-characterization.test.ts`:**
  - Helfer `mintIntermediateCA(root, cn)` — forgt ein Intermediate-Cert (`cA:true`, keyUsage
    `keyCertSign`/`cRLSign`), **von der Root signiert**, in `CaBundle`-Form (damit `createNodeCert` es als
    Aussteller eines Leafs benutzt → Reuse des echten Leaf-Signierpfads).
  - Echter Aufbau **Root → Intermediate → Leaf** und 4 Assertions:
    - `verifyPeerCert(root, intermediate)` → **true** (direktes Kind).
    - `verifyPeerCert(intermediate, leaf)` → **true** (direktes Kind).
    - **`verifyPeerCert(root, leaf@intermediate)` → `false`** (die Charakterisierung: zwei Hops, kein
      Chain-Building).
    - Invariante für D2: der Root-Anker allein reicht **nicht**, nur der direkte Aussteller macht das Leaf
      gültig.
- **`TODO.md`:** Vorbedingung-A-Charakterisierungs-Test als erledigt (`[x]`); der eigentliche A-Fix
  (chain-fähiger Verify) + B bleiben offen.

## Abgrenzung
**Kein Fix, kein Verhaltens-Change** — `verifyPeerCert` bleibt unverändert. Der Test **dokumentiert** die
Lücke regressionsfest: wird er eines Tages rot (Root verifiziert das Leaf), ist `verifyPeerCert` chain-fähig
geworden und der Test bewusst zu aktualisieren. Keine anderen Slices berührt.

## Compliance
- **CO/CG:** entfallen — kein Design-Beschluss, kein generierter Boilerplate.
- **TS ✅:** +4 Tests; Full-Suite **1756 grün** (129 Files), `tsc --noEmit` (strict) 0, eslint (neue Datei) 0.
- **CR:** externer Claude-Review-Subagent vor Merge (prüft, dass der Test die Lücke echt belegt und nicht
  tautologisch grün ist).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Test, kein Key-Material — Certs zur Laufzeit geforgt).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die Testdatei.
