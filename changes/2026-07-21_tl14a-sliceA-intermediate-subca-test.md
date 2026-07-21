# changes/2026-07-21 — test(tls): TL-14a Slice A — D2-Invariante „Intermediate darf keine Sub-CA ausstellen"

**Typ:** **Test-only** Coverage-Ergänzung (kein Produktionscode). Schließt die eine noch offene, distinkte
Lücke in TL-14a Slice A (ADR-045 Vorbedingung A). **Kein** Deploy/Secret/Cross-Host, `tls.ts` unverändert.

## Kontext — was schon da war (nicht neu implementiert)
Der chain-fähige Verify **mit** `pathLenConstraint`-Enforcement ist bereits gelandet:
`verifyPeerCertChain` + `enforcePathLenConstraint` in `tls.ts` (**#298**), Retention darauf umgestellt
(**#299**), abgedeckt von `chain-verify.test.ts`. Es gab **nichts zu re-implementieren.** Der bestehende
pathLen-Test setzte den Constraint aber am **Root** (`Root(pathLen 0)` lehnt ein Intermediate ab).

## Die reale Delta — der fehlende Negativtest
Die **D2-Kern-Sicherheitseigenschaft** — ein **Intermediate** mit `pathLen 0` darf **keine Sub-CA**
ausstellen — war **nicht direkt** getestet. Neuer fokussierter Test in `chain-verify.test.ts`:

- **Aufbau:** `Root(pathLen 2)` → `Intermediate(pathLen 0)` → `Sub-CA` → `Leaf`. Der Root ist mit
  `pathLen 2` bewusst großzügig (nicht die Ursache), sodass **ausschließlich** die `pathLen 0` des
  Intermediates die vom Intermediate ausgestellte Sub-CA verbietet.
- **Assertion:** `verifyPeerCertChain([root], [leaf, subCa, inter]) === false` (fail-closed über beide
  Ebenen: forge-In-Chain-Check **und** `enforcePathLenConstraint`).
- **Gepaarte Gegenprobe:** dieselbe Hierarchie **ohne** die Sub-CA (Leaf direkt vom Intermediate) ist
  `=== true` → beweist, dass die Ablehnung an der Sub-CA hängt und nicht an einem anderen Kettendefekt
  (schützt gegen einen degenerierten „immer false"-Verifier).

## Tests
- `chain-verify.test.ts`: **+1** (jetzt 8). Relevante TLS-Suiten (`tls.test.ts`,
  `tls-chain-characterization.test.ts`, `chain-verify.test.ts`, `mtls-issuer-fingerprint.test.ts`) **67 grün**.
  Full-Suite **1857 grün** (136 Files), `tsc --noEmit` (strict) 0, eslint 0 / prettier clean.

## Compliance
- **CO/CG:** entfällt — test-only, keine Design-/Architektur-Frage (das Design steht in ADR-045; der
  Consensus lief bereits, `TL-14a-consensus-result-D1-D6.md`).
- **TS ✅:** dieser PR **IST** der Test; +1 fokussierter Negativtest, Suite 1857 grün.
- **CR:** Self-CR — Test isoliert nachweislich die Intermediate-`pathLen`-0-Eigenschaft (Root großzügig +
  gepaarte positive Gegenprobe); kein Produktionscode berührt.
- **PC:** Secret-Scan clean (Certs zur Laufzeit in-memory via `forge`, nichts committed).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
