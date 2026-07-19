# changes/2026-07-19 — docs(tl14a): Consensus-Blocker A & B code-gegroundet (vor ADR)

**Typ:** Doc-only (Discovery/Grounding). **Kein** Code/Config/Runtime-Change, **keine** Skripte, **kein**
Deploy/Secret/Cross-Host-Schritt.

## Warum
Der `pal:consensus`-Lauf (D1–D6) markierte zwei Auflagen als **blockierend** VOR der CA-Hierarchie-ADR:
**A** (Chain-Building/pathLen-Enforcement) und **B** (Intermediate-Expiry-Monitoring). Beide waren bisher
**Behauptungen aus dem Votum**. Der nächste ehrliche Schritt ist, sie am tatsächlichen Code zu **verifizieren**
— damit die ADR auf Fakten baut. Discovery/Doc only.

## Was
- **Neu `docs/architecture/TL-14a-blocker-AB-grounding.md`:** je Blocker Code-Evidenz + Verdikt + ADR-Konsequenz.
- **Blocker A — pathLen/Chain: NICHT garantiert (teils fehlend).**
  - App-Ebene `verifyPeerCert` (`tls.ts:729`) = `caCert.verify(peerCert)` + Leaf-/Issuer-Gültigkeitsfenster —
    **Ein-Aussteller-Signaturprüfung**, **kein** Chain-Building, **kein** `pathLen`/`basicConstraints` auf
    Intermediates. Repo-Falsifikation: `grep verifyCertificateChain\|createCaStore` = **0 Treffer**.
  - Dieser flache Verify trägt Trust-Entscheidungen: `isRetainableCanonicalCert` (`tls.ts:388`),
    Token-Onboard-Bundle (`tls.ts:516`), `selectTrustDistributionCa` (`tls.ts:769`).
  - Transport-mTLS (`agent-card.ts:225-231`, Node-TLS `ca`+`requestCert`+`rejectUnauthorized`) **würde**
    Chain/pathLen prüfen, ist aber an eine **einstufige** ca-Bundle-Verdrahtung gebunden und für 2 Stufen
    **ungetestet** (kein Test lehnt einen pathLen-Verstoß ab).
  - **→ D2 (`pathLen 0`) ist auf dem App-Pfad kosmetisch;** Retention/Pin brauchen Chain-Bewusstsein, sobald
    ein Intermediate zwischen Root und Leaf tritt.
- **Blocker B — Intermediate-Expiry: fehlt ganz.**
  - `startCertExpiryMonitor` bekommt `getDaysLeft: () => getCertDaysLeft(dataDir)` (`index.ts:1613`);
    `getCertDaysLeft` (`tls.ts:708-724`) liest **exakt** `tls/node.crt.pem` — nur das Node-Leaf. Die CA/das
    Intermediate wird **nie** auf Ablauf geprüft; der Monitor **rotiert nicht** (Reissue nur beim Neustart).
  - **→ B ist Vorbedingung für D3** (lange Intermediate-Laufzeit ohne Alarm = lautloser Ausstellungs-Tod).
- **`TODO.md`:** „Auflage A + B" von offen auf **gegroundet** (`[~]`) mit den Code-Befunden; die Fixes
  (chain-fähiger Verify + Charakterisierungs-Test; CA-Expiry-Quelle) als benannte Folge-Slices.

## Abgrenzung
**Kein Code geändert** — reine Bestandsaufnahme. Die vorgeschlagenen Fixes sind eigene Folge-Slices, hier
nicht umgesetzt. Kein Deploy/Secret/Cross-Host. Faktenbasis für die künftige CA-Hierarchie-ADR + D2/D3.

## Compliance
- **CO/CG/TS:** entfallen — Discovery/Doc, kein Code, kein neuer Beschluss.
- **CR:** Doc-Accuracy self — jeder Anker gegen die Quelle verifiziert (`tls.ts:729/388/516/769/708-724`,
  `agent-card.ts:225-231`, `index.ts:1613`, `cert-expiry-monitor.ts`; `grep`-Falsifikation für
  `verifyCertificateChain`/`createCaStore`).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, das Grounding-Doc.
