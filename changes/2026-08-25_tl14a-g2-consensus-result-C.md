# changes/2026-08-25 — docs(tl14a): G2-Consensus-Ergebnis zu Auflage C (Revocation)

**Typ:** Doc-only Consensus-Protokoll (CO-Anteil von Gate **G2**). **Keine Owner-Entscheidung, kein Gate
entriegelt, kein Code/Test/Config-Diff.** Kein Deploy/Secret/Cross-Host. Risiko-Delta **null**.

## Was
- **Neu:** `docs/architecture/TL-14a-consensus-result-C.md` — protokolliert einen tatsächlich gelaufenen
  `pal:consensus`-**Doppellauf** über die C-Klassifikationsfrage aus `TL-14a-blocker-C-grounding.md` §2
  (Consensus stuft A–C blockierend, ADR-045 §74 führt nur A/B).
  - **Ergebnis: C wird gesplittet** statt „Blocker" **oder** „Fast-Follow" — der Streit lag an einem falsch
    geschnittenen Objekt. **C1** (lokales `isRevoked`-Enforcement, App-Ebene, `agent-card.ts:311` Issuer **+**
    `:353` Leaf, bestehende `crl.ts` verdrahten) = **blockierend vor TL-14b, aber klein**. **C2**
    (Mesh-Verteilung der Denylist) = **Fast-Follow, bewusst nichts bauen**. ⇒ **Der Consensus meinte C1, die
    ADR meinte C2** — beide hatten für ihren Anteil recht.
  - **Form:** Fingerprint-**Denylist**, **kein** CRL/OCSP (OCSP = SPOF im Trust-Pfad; eine echte CRL bräuchte
    für **jede** Sperrung den Offline-Root-Key und widerspräche D3).
  - **Distribution:** `crl.json` bleibt **lokal + owner-gepflegt**; eine fernverteilte unsignierte Denylist wäre
    ein **DoS-Primitiv**, eine signierte kostet mehr Angriffsfläche als sie löst. Trigger für später
    dokumentiert (>25 Nodes / Nicht-Owner-Betreiber).
  - **Stärkster Einzelgrund für C1** (von der Fast-Follow-Seite eingeräumt): die kalte **TH02-Reserve (D6)** ist
    ohne Sperrfähigkeit nur **halb** aktivierbar — sie stellt Verfügbarkeit wieder her, **nicht Integrität**,
    weil das kompromittierte Intermediate gültig bleibt („unsperrbare Reserve = halbe Reserve").
  - **Auflagen für den späteren C1-Slice** benannt, u.a. der Kollisions-Test **„Alt-Pin aktiv (D4-Doppel-Pin) +
    Alt-Intermediate revoziert"** — ohne ihn sperrt die Denylist den Cutover **selbst aus**; plus eigener
    Audit-Event für Ablehnungen und Korrektur des falschen `crl.ts:5-7`-Headers **im selben Slice**.
  - **Fill-in-Ratifizierungs-Tabelle** für die offene **Owner-Hälfte** von G2.
- **Nachgezogen (Konsistenz, keine Beschlüsse):**
  - `TL-14a-G1-decision-brief.md` §1 **Nachtrag** + §3 Stand-Update — der Lauf **korrigiert die D3-Begründung**:
    eine kürzere Laufzeit ist **kein Revocation-Ersatz** (deckelt nur planmäßige Rotation, nicht
    „Kompromittierung an Tag 2"). Empfehlung **24 Monate**, begründet als **Zeremonie-Probe-Erzwingung** (D6).
    **Korridor 1–3 J unverändert, die Zahl bleibt Christians Entscheidung.**
  - `ADR-045-ca-two-stage-hierarchy.md` §100 — Zeiger auf das Ergebnis; **Status/§74 bewusst NICHT geändert**
    (das folgt erst der Owner-Ratifizierung).
  - `TL-14a-gate-status.md` §2/§3/§5 — G2-Zeile auf „CO erledigt, Owner offen"; **G3 am 2026-08-25 erneut
    laufzeit-verifiziert offen**; Fazit: beide verbleibenden Entriegelungen sind jetzt **reine
    Owner-Entscheidungen**.
- **DO:** `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser `changes/`-Eintrag, `TODO.md`.

## Lauf-Ehrlichkeit (wichtig)
- **Runde 1** war **kein Konsens**: `cli-codex-gpt` und `cli-agy-gemini-pro` fielen **beide** mit
  *"executable not found in PATH"* aus — es blieb **eine** Stimme. PAL *listet* beide Backends als konfiguriert,
  sie scheitern aber beim Aufruf. **G3 damit erneut verifiziert offen.**
- **Runde 2** wurde deshalb **adversarial nachgezogen**: `cli-claude-sonnet` (Stance *for* = C blockierend)
  gegen `cli-claude-opus` (Stance *against* = Fast-Follow), mit der Fast-Follow-These im Volltext als Angriffs-
  ziel. Der Gegenangriff **traf** (Blast-Radius am falschen Objekt verglichen; D5-Recovery-Zirkelschluss) und
  führte zur Korrektur der Begründung — nicht des Ergebnisses.
- **Ergebnis-Charakter: Same-Vendor-2-Modell-Panel** (opus 8/10, sonnet 7/10). **Kein Cross-Vendor-Pass** — im
  Dokument ausdrücklich so gekennzeichnet.
- **Nicht code-verifiziert** und im Dokument als Vorbehalt geführt: die Aufwandsschätzung („~1 Tag") und das
  Fingerprint-**Format** an `:311`/`:353` gegenüber dem, was `crl.ts` erwartet (ggf. Normalisierung nötig).

## Warum gate-frei / kein Fortschritt
Das Protokoll **verdrahtet nichts** und **entscheidet nichts**. Es ersetzt den bisher *offenen* C-Punkt durch
eine begründete, angegriffene Empfehlung — die **Owner-Hälfte von G2 bleibt offen**, der C1-Slice ist **nicht
freigegeben**. G1/G3/G4 unberührt. Präzedenz doc-only: #345/#346/#347/#349/#351 (Consensus-Protokoll/Gate-Status
derselben Familie); Muster: `TL-14a-consensus-result-D1-D6.md`.

## Grounding (alles repo-lokal)
`packages/daemon/src/crl.ts` (Volltext im Prompt), `ADR-045-ca-two-stage-hierarchy.md` §68-72/§74/§90-94/§100,
`TL-14a-blocker-C-grounding.md` §2/§3, `TL-14a-consensus-result-D1-D6.md` §C, `TL-14a-gate-status.md`,
`TL-14a-G1-decision-brief.md`.

## Compliance
- **CO:** ✅ **das ist der CO-Schritt selbst** — `pal:consensus`, zwei Runden, adversariale Stance-Besetzung
  (protokolliert inkl. der Ausfälle). Cross-Vendor blockiert (G3).
- **CG:** entfällt — kein Code/Test/Type-Ableitung; `clink`/`gemini` nicht im PATH.
- **TS:** kein `.ts`-Diff. **Daemon-Suite `2101` grün** (`npx vitest run --root packages/daemon`, unverändert).
  Root-`npm test`: **2222 Tests grün**, 1 Test-**File** meldet `failed` —
  `scripts/check-native-modules.test.cjs` („No test suite found"), **gegenüber `main` unverändert** (per
  `git diff main` belegt) ⇒ **vorbestehendes Vitest-Sammel-Artefakt, nicht durch diesen PR verursacht.**
- **CR:** Review-of-Record über **claude** (Self-CR; `agy`/`codex` nicht im PATH) — Faktentreue der Zitate gegen
  `crl.ts`, ADR-045 und die C-Grounding-Note geprüft; Gating-Sprache explizit; keine Entscheidung getroffen.
- **PC:** Secret-Scan clean (nur Doku).

## Nicht berührt
ADR-045 §Status/§74 (Owner-ratifizierungspflichtig), ADR-046 §9, msg 1453, alle offenen Gates (TL-08/09/10,
**G1**, **G2-Owner**, G3, G4/TL-14b). Kein Code, kein Deploy/Secret/State.
