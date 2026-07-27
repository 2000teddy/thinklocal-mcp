# changes/2026-07-27 — test(tl14a): Vorbedingung A — pathLen am Transport (echter mTLS-Handshake)

**Typ:** **Test-only** (non-gated Vorbedingungs-Lane). Keine Produktionsänderung, keine Verdrahtung, keine
Entscheidung, kein Deploy/Secret/Host. **Nimmt D3/ADR-Status/TL-14b NICHT vorweg.**

## Die Lücke
ADR-045 §77 (Vorbedingung A) verlangt einen Test des `pathLen`-Verhaltens **auf der Transport-Ebene**. Die
App-Ebene war abgedeckt (`verifyPeerCertChain` + `chain-verify.test.ts`, #298/#299/#311) und die flache Lücke
charakterisiert (#295), aber der **Transport-Ebenen-Test fehlte** — `chain-verify.test.ts` treibt nur die
reine Funktion (0 TLS-Handshakes), und der einzige reale mTLS-Test (`mtls-issuer-fingerprint.test.ts`) prüft
die Issuer-Fingerprint-Invariante, **nicht** eine mehrstufige `pathLen`-Kette. ADR-045: die Transport-mTLS ist
„für zwei Stufen **ungetestet**", „D2 auf App-Pfad **kosmetisch**".

## Was
Neu `packages/daemon/src/tls-transport-pathlen.conformance.test.ts` (+4) — **echter Node-TLS-Handshake**
(`requestCert`+`rejectUnauthorized`, dieselben Flags wie der cardServer), mehrstufige node-forge-Ketten.

**Befund (empirisch, reproduzierbar):** Node-TLS **erzwingt `pathLenConstraint` in dieser mTLS-Konfiguration
NICHT**:
- `Root(pathLen 0) → Intermediate → Leaf` wird am Transport **akzeptiert** (dürfte nicht).
- sogar `Root(pathLen 2) → Intermediate(pathLen 0) → Sub-CA → Leaf` wird **akzeptiert**.
- **Positiv-Kontrolle** `Root(pathLen 1) → Intermediate → Leaf` = akzeptiert ⇒ die zweistufige Kette **baut
  real durch**, die Akzeptanz oben ist **kein** Harness-Fehler.
- **Kontrast im selben Test:** die App-Ebene `verifyPeerCertChain` **lehnt** denselben pathLen-0-Verstoß **ab**
  (und akzeptiert die pathLen-1-Form) — forge enforced pathLen, Node-TLS nicht.

**Konsequenz (der Kern von Vorbedingung A):** Zwei-Stufen-Trust-Entscheidungen dürfen sich **nicht** auf die
Transport-mTLS verlassen; die `pathLen`-Wirksamkeit (D2/D4) ruht auf der App-Ebene `verifyPeerCertChain`.
Der Test macht das **regressionsfest** und **korrigiert** die Annahme hinter ADR-045s „ein Test, der …
ablehnt" (der Transport lehnt eben NICHT ab). Damit ist Vorbedingung A code-seitig **komplett**.

## Warum jetzt (gate-frei, D3-unabhängig)
Vorbedingung A/B sind im TODO/ADR-045 ausdrücklich **„Code, repo-safe, non-gated"** — sie hängen **nicht** an
D3 (D3 legt nur die Intermediate-Laufzeit fest und blockt ADR-Status + TL-14b). **B ist bereits fertig**
(#297: `getCaCertDaysLeft` + `cert-expiry-monitor` `subject`-Klassifikation + zweiter CA-Monitor `index.ts:1689`);
**A** war bis auf genau diesen Transport-Test fertig — jetzt geschlossen.

## Compliance
- **CO/CG:** entfallen — keine Design-Entscheidung; Test gegen gemergten Code/ADR-045-Vorbedingung.
- **TS ✅:** +4 Tests (echter Handshake, gepaarte Positiv-Kontrolle + App-Ebenen-Kontrast); `tsc`/`eslint`
  grün, Full Suite **2097 grün** (149 Files; +4 ggü. 2093).
- **CR:** Self-Review — Befund per Throwaway-Probe **doppelt verifiziert** (root-pathLen **und**
  intermediate-pathLen beide akzeptiert), Positiv-Kontrolle schließt Harness-Fehler aus; **claude/codex/agy**
  am PR (NIE MiniMax/pal:chat).
- **PC:** Secret-Scan clean (synthetische Test-Zertifikate, keine echten Keys).
- **DO ✅:** dieser Eintrag, `ADR-045-ca-two-stage-hierarchy.md` §77 (Umsetzungsstand), `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-14a **Christian-Sign-off (D3) → ADR-045 Accepted**, Runbook-Volltext, TL-14b; C-Entscheidung.
**Nicht berührt:** ADR-046 §9, msg 1453, TL-08/09/10-Gates. **Kein Christian-Ping.**
