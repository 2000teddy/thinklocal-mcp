# ADR-045 — CA-Zweistufen-Hierarchie (Offline-Root → Intermediate TH01 / Geschwister TH02)

**Status:** **Accepted** (2026-08-26, Owner-Sign-off Christian — G1 + G2 beide gezeichnet; D3 = **24 Monate**,
Auflage **C1 blockierend** / **C2 Fast-Follow**. **Kein** Deploy ohne Christians Wort: die *Durchführung*
bleibt **TL-14b**, ⛔ termin- + Christian-gated.)
**Datum:** 2026-07-19 · **Angenommen:** 2026-08-26
**Kontext-Task:** TODO **TL-14a** (CA-Zweistufen-Umzug, „nur Papier+Skripte"). Durchführung = **TL-14b**
(⛔ termin- + Christian-gated). Verwandt: ADR-022 (PeerID-verwurzelte Identität), ADR-024 (Canonical-Cert-
Retention), ADR-034 (Re-Pair-Migrationsstufe), Decision-7 (Trust-Domain-Flip).
**CO:** `pal:consensus` 2026-07-19 — Same-Vendor-2-Modell-Panel `cli-claude-opus` (8/10) + `cli-claude-sonnet`
(7/10); `codex`/`agy` nicht im PATH → kein Cross-Vendor-Pass (Re-Run vermerkt). Ergebnis-Protokoll:
`TL-14a-consensus-result-D1-D6.md`. **Grounding der Blocker:** `TL-14a-blocker-AB-grounding.md`.
**Vorstufen:** `TL-14a-ca-two-stage-scoping.md` (Ist-Zustand + §5), `TL-14a-decision-checklist.md` (D1–D6),
`TL-14a-consensus-brief-D1-D6.md`.

## Problem
Die Mesh-Vertrauenswurzel ist heute **flach/einstufig**: `createMeshCA` (`tls.ts:59`) erzeugt eine
self-signed Root (`basicConstraints{cA:true}` ohne `pathLen`, `tls.ts:84`), `createNodeCert` (`tls.ts:108`)
signiert Leafs **direkt**; der Attesting-Pfad (`cert-issuer.ts`) stellt kanonische `node/<PeerID>`-Leafs mit
**demselben** Root-Key aus. **Der Root-Key liegt online + ko-lokalisiert** mit dem Aussteller
(`ca.crt.pem`/`ca.key.pem`, `tls.ts:403-404`). Zielzustand: eine **offline** Root, die ausschließlich
Intermediates signiert; die operative Ausstellung läuft über ein **Intermediate auf TH01** (+ eine
Geschwister-Reserve auf TH02). Diese ADR fixiert die Hierarchie-Entscheidungen (D1–D6) und die zwingenden
Vorbedingungen (A/B), **bevor** Runbook-Volltext + Zeremonie-Skripte entstehen und **lange bevor** der Umzug
(TL-14b) läuft.

## Zielhierarchie
```
Offline Root CA (air-gapped, Key NIE online, pathLen 0)
        │  signiert NUR die beiden Intermediates
        ├── Intermediate CA @ TH01 (operativer Aussteller — ersetzt die heutige createMeshCA-Root-Rolle)
        │        └── node/<PeerID>-Leafs (.94/.55/.52/.56/.222/…)
        └── Geschwister-Intermediate CA @ TH02 (KALTE, versiegelte Reserve, identische Kette)
```

## Entscheidung (D1–D6)

### D1 — Trust-Domain: **ENTKOPPELN** (einstimmig)
Der CA-Umzug behält `spiffe://thinklocal/`. Der Trust-Domain-Flip auf `axxsys-software.de` (Decision-7) ist
ein **separater, späterer** Schnitt. Grund: Signierpfad **und** Namensraum in einem Fenster machen jede
TLS-Fehldiagnose (Chain-Build vs. SAN-Mismatch) mehrdeutig. **Auflage:** Domain-Flip als eigene, **terminierte**
Folge-CO führen, sonst versandet er.

### D2 — `pathLenConstraint` der Root: **0** (einstimmig)
Root darf nur Intermediates ausstellen, die **keine** weiteren Sub-CAs erzeugen. Minimal-Vollmacht, exakt zwei
Stufen. **Bindet an Vorbedingung A** (s.u.): heute ist `pathLen` auf dem App-Verify-Pfad wirkungslos — ohne
A-Fix ist D2 dort kosmetisch.

### D3 — Intermediate-Validität & Erneuerung: **ENTSCHIEDEN — 24 Monate** (Owner-Sign-off 2026-08-26)
**Beschluss (Christian, G1):** Die Intermediate-CA-Laufzeit beträgt **24 Monate**.

**Begründung — bewusst NICHT das Kompromittierungs-Fenster.** Der G2-Consensus
(`TL-14a-consensus-result-C.md`) hat die ursprüngliche Abwägung korrigiert: eine kürzere Laufzeit ist **kein
Revocation-Ersatz**. Sie deckelt nur das Worst-Case-Fenster bei **planmäßiger Rotation** und wirkt nicht gegen
„Kompromittierung an Tag 2" — dafür ist **C1** (Denylist-Enforcement) zuständig, nicht die Laufzeit. Was die
24 Monate **tatsächlich** kaufen: eine **erzwungene Wiederholung der Offline-Zeremonie**, die die
**D6-Auflage** („Reserve mind. einmal trocken proben") faktisch von selbst erfüllt und Prozedur-Verrottung im
Solo-Betrieb verhindert. Die Zahl ist damit eine **Betriebs-Hygiene-Entscheidung**, keine Risiko-Kompensation.

Einigkeit im Übrigen: die Laufzeit ist **entkoppelt** von der 30-Tage-`renew_before_days`-Leaf-Logik (jede
Intermediate-Erneuerung braucht die Offline-Root-Zeremonie). Ausgangslage des Consensus: opus **12–24 Monate**,
sonnet **3 Jahre**; **beide verwerfen ≥5 Jahre** — 24 Monate liegt in beiden Korridoren.
**Root-Laufzeit:** **10–15 Jahre** (Korridor konsens-bestätigt und mit-gezeichnet; die **exakte** Root-Zahl ist
kein ADR-Gegenstand und wird **bei der Offline-Zeremonie** im Runbook festgelegt).
**Voraussetzung erfüllt:** Vorbedingung B (Intermediate-Expiry-Monitoring, `cert-monitor-wiring.ts`, #297/#344)
ist code-seitig komplett — ein 24-Monats-Intermediate läuft **nicht lautlos** ab.

### D4 — Cross-Sign vs. Cutover: **Doppel-Pin-Cutover** (einstimmig)
Kein Cross-Sign. Alt- **und** Neu-Fingerprint gepinnt (`resolveAttestingCaFingerprints`, `cert-issuer.ts:121`,
`TLMCP_PEERID_ATTESTING_CA_FP`; Legacy-Retain `ca.crt.legacy.pem`, `tls.ts:437` existiert). **Auflage:**
Alt-Pin **nach Node-N-Proof** entfernen (nicht am Kalenderstichtag); **Rollback-Kriterium vorab** definieren.
Cross-Sign führte eine neue, ungetestete Chain-Verifikation in einen sicherheitskritischen Pfad ein.

### D5 — Chain-Ausroll-Mechanik: **Token-Re-Onboard je Node** (einstimmig, stark)
Kein `ca.crt.pem`-Chain-Swap — dessen Fallen sind repo-belegt **und ungelöst**
(`[[cert-clobber-on-ca-reissue]]`, `[[th02-phase3-flip-blocker]]`/Unknown-sender-Deadlock). Der Token-Pfad hat
die harte Verifikationsklausel (`tls.ts:534-537`). Kosten (1 Fenster/Node bei ~10 Nodes) tragbar; je Node mit
`[[dod-two-peer-mcp-proof]]` koppeln. **Dies ist der eigentliche TL-14b-Kern.**

### D6 — TH02-Geschwister-Rolle: **KALT** (einstimmig)
Versiegelte Reserve, identische Kette unter derselben Root — **nicht** heiß mit-ausstellend (zwei heiße
Signierschlüssel = doppelte Angriffsfläche + Ausstell-Divergenz, ohne HA-Bedarf bei dieser Größe). **Auflage:**
die Reserve-Aktivierung (Key-Zugriff + Fingerprint-Pin-Update) **mind. einmal trocken proben** — ungeprobte
Reserve = keine Reserve.

## Zwingende Vorbedingungen (blockierend — VOR TL-14b, code-gegroundet)
Aus `TL-14a-blocker-AB-grounding.md`; beide Modelle stuften sie als **blockierend** ein.
**Ergänzt 2026-08-26 (Owner-Sign-off G2): auch `C1` ist blockierend** — siehe Vorbedingung C1 unten. Die
frühere Formulierung, die C vollständig als out-of-scope/Fast-Follow führte, ist damit **aufgelöst**: der
blockierende Anteil (**C1**, lokales Enforcement) steht jetzt hier; der nicht-blockierende Anteil (**C2**,
Mesh-Verteilung) bleibt bewusst draußen.

### Vorbedingung A — Chain/pathLen-Enforcement (macht D2/D4 wirksam)
- **Befund:** App-`verifyPeerCert` (`tls.ts:729`) ist ein **flacher Ein-Aussteller-Verify** (kein
  Chain-Building, kein `pathLen`; `verifyCertificateChain`/`createCaStore` = 0 Treffer in
  `packages/daemon/src/`), trägt aber Trust-Entscheidungen (`tls.ts:388/516/769`). Transport-mTLS
  (`agent-card.ts:225-231`) **würde** via Node-TLS prüfen, ist aber ein **flaches einstufiges** ca-Bundle
  (eigene + Peer-CAs) und für zwei Stufen **ungetestet**.
- **Folge-Slice (Code, vor/mit TL-14b):** App-Verify chain-fähig machen **oder** dokumentierte Beschränkung
  aller Trust-Entscheidungen auf die Transport-Ebene; **Charakterisierungs-Test**, der `verifyPeerCert(root,
  leaf@intermediate) === false` belegt (macht die Lücke regressionsfest) + ein Test, der einen `pathLen`-
  Verstoß auf der Transport-Ebene ablehnt.
- **Umsetzungsstand (2026-07-27, code-verifiziert — ändert keinen Beschluss/Status):** App-Ebene
  `verifyPeerCertChain` + `pathLen`-Enforcement gebaut (#298/#299/#311); Charakterisierung der flachen Lücke
  vorhanden (#295). **Neu:** der Transport-Ebenen-Test (`tls-transport-pathlen.conformance.test.ts`, echter
  mTLS-Handshake) **korrigiert die Annahme** hinter „ein Test, der … ablehnt": Node-TLS **erzwingt `pathLen`
  in dieser mTLS-Konfiguration NICHT** — `Root(pathLen 0)→Intermediate→Leaf` (und `Root(p2)→Inter(p0)→Sub-CA→Leaf`)
  werden am Transport **akzeptiert** (Positiv-Kontrolle pathLen 1 = kein Harness-Fehler), während die App-Ebene
  `verifyPeerCertChain` denselben Verstoß **ablehnt** (Kontrast im selben Test). ⇒ **Konsequenz:**
  Zwei-Stufen-Trust MUSS über die App-Ebene laufen; die Transport-mTLS ist **nicht** der pathLen-Enforcement-Punkt.
  Damit ist Vorbedingung A code-seitig **komplett + regressionsfest**. (D3/ADR-Status/TL-14b bleiben unberührt.)

### Vorbedingung B — Intermediate-Expiry-Monitoring (macht D3 sicher)
- **Befund:** der Live-Monitor liest nur `node.crt.pem` (`getCertDaysLeft`, `index.ts:1613`,
  `tls.ts:708-724`); CA/Intermediate wird **live nie** geprüft (nur Start-Reissue für **own-CA**,
  `tls.ts:426-451`; token-onboarded Nodes + ein künftiges Intermediate haben **keinen** Pfad).
- **Folge-Slice (Code, VOR dem ersten Intermediate):** `getCertDaysLeft` um eine CA/Intermediate-Quelle
  erweitern, der Monitor klassifiziert beide getrennt (eigener Audit-Sub-Typ / `subject`-Detail).

### Vorbedingung C1 — Revocation-Enforcement lokal verdrahten (macht D6 wirksam)
**Owner-ratifiziert 2026-08-26** auf Basis von `TL-14a-consensus-result-C.md`. Auflage **C** wurde dabei
**gesplittet**: **C1 = blockierend** (hier), **C2 = Fast-Follow** (siehe Konsequenzen).

- **Befund:** `packages/daemon/src/crl.ts` (`CertificateRevocationList`) **ist bereits** die vom Consensus
  vorgeschlagene gepinnte Fingerprint-Denylist (`isRevoked` `crl.ts:51`, atomare Persistenz `:88-98`,
  fail-safe `load` `:75-86`, charakterisierungs-getestet seit #341) — aber **0 Nicht-Test-Aufrufer**, also
  totes Dead-Code. Der Datei-Kopf (`crl.ts:5-7`) behauptet eine Prüfung „beim Heartbeat und bei der
  Agent-Card-Verifikation", die **nicht existiert**.
- **Warum blockierend (der tragende Grund):** Der Aktivierungsfall der **kalten TH02-Reserve (D6)** ist per
  Definition „TH01-Intermediate kompromittiert/verloren". Ohne Sperrfähigkeit wird das neue Intermediate zwar
  gepinnt, **das alte bleibt aber gültig** — Leafs des kompromittierten Intermediates werden weiter
  akzeptiert. Die Reserve stellt dann **Verfügbarkeit** wieder her, **nicht Integrität**. Aus „ungeprobte
  Reserve = keine Reserve" (D6) wird sonst **„unsperrbare Reserve = halbe Reserve"**. Verschärfend: **D5**
  lehnt den `ca.crt.pem`-Chain-Swap ab, d.h. die einzige Alternativ-Recovery ist derselbe mehrtägige,
  gated Token-Re-Onboard-Sweep — währenddessen bleibt der kompromittierte Fingerprint mesh-weit vertraut.
- **Form:** gepinnte **Fingerprint-Denylist**, **kein** CRL/OCSP. OCSP wäre ein SPOF im Trust-Pfad (soft-fail
  wirkungslos, hard-fail mesh-weiter Ausfall); eine echte CRL bräuchte für **jede** Sperrung den
  **Offline-Root-Key** und widerspräche damit D3 direkt.
- **Folge-Slice (Code, VOR TL-14b) — Verdrahten, nicht neu bauen:** `isRevoked` an den **App-Ebenen**-Verify
  hängen (`verifyPeerCertChain`) und an die beiden Stellen, an denen die Fingerprints beim Connection-Setup
  bereits vorliegen: `agent-card.ts:311` (**Issuer**) **und** `:353` (**Leaf**). Beide, nicht nur der Leaf —
  sonst ist genau der D6-Fall (kompromittiertes *Intermediate*) nicht abgedeckt.
  **App-Ebene ist empirisch erzwungen**, keine Präferenz: `tls-transport-pathlen.conformance.test.ts` (#342)
  belegt, dass Node-TLS `pathLen` in dieser mTLS-Konfiguration **nicht** durchsetzt (s. Vorbedingung A) —
  Trust-Entscheidungen sitzen ohnehin App-seitig; Revocation gehört an denselben Punkt (**ein**
  Entscheidungspunkt statt zwei divergierender).
- **Pflicht-Tests des Slices:**
  1. revozierter **Leaf** wird abgelehnt;
  2. revoziertes **Intermediate** ⇒ **ganze Kette** abgelehnt;
  3. **Kollisions-Test „Alt-Pin aktiv (D4-Doppel-Pin) + Alt-Intermediate revoziert"** — ohne ihn sperrt die
     Denylist den **D4-Cutover selbst aus** (Interaktion mit `resolveAttestingCaFingerprints` prüfen).
- **Weitere Auflagen im selben Slice:** eigener **Audit-Event-Typ** für Ablehnungen (sonst greift eine
  Revocation operativ unsichtbar — Fehlerklasse #272/#278); der falsche `crl.ts:5-7`-Header wird **wahr
  gemacht**, nicht abgeschwächt.
- **Offener Vorbehalt (nicht code-verifiziert):** ob die Fingerprints an `:311`/`:353` im selben Format
  vorliegen, das `crl.ts` erwartet (Doppelpunkt-Trennung, Groß/Klein, `sha256:`-Präfix) — ggf. kommt
  Normalisierung dazu. Die Aufwandsschätzung („~1 Tag") ist **nicht** verifiziert.

## Konsequenzen
- **Positiv:** Root-Key offline (kein online-Kompromittierungs-Hotspot mehr für die Wurzel); Standard-2-Stufen-
  PKI; Reuse bestehender Pin-/Retain-Mechanik (D4); keine neuen Chain-Swap-Fallen (D5).
- **Kosten:** je-Node-Re-Onboard-Fenster (D5, gated); Offline-Zeremonie-Disziplin (D3, alle **24 Monate**);
  **drei** neue Code-Slices (**A/B/C1**) VOR dem Umzug — A und B sind erledigt, **C1 steht aus**.
- **C2 — Mesh-Verteilung der Denylist: bewusst NICHT gebaut** (Fast-Follow, owner-ratifiziert 2026-08-26).
  `<dataDir>/certs/crl.json` bleibt eine **rein lokale, owner-gepflegte Datei pro Node**, nur über den
  Dateisystem-/SSH-Zugang des Owners beschreibbar: **kein** Netzwerk-Endpunkt zum Schreiben, **kein** Gossip,
  **keine** Mesh-Propagierung. Begründung: eine fernverteilte **unsignierte** Denylist wäre ein
  **DoS-Primitiv** (wer Einträge einschleust, wirft beliebige Nodes aus dem Mesh); eine **signierte** bräuchte
  Owner-Signierschlüssel + Verifikation + Replay-/Rollback-Schutz (monoton steigende Version) und kostet damit
  **mehr neue Angriffsfläche als das gelöste Problem**. Der Revocation-Rollout läuft über **denselben
  Owner-Pfad wie das D5-Token-Re-Onboard** — die Vertrauensbasis ist exakt dieselbe wie für die
  Cert-Ausstellung selbst; **null neue Kryptografie**.
  **Dokumentierter Re-Evaluierungs-Trigger:** > 25 Nodes **oder** Nicht-Owner-Betreiber ⇒ signierte
  Verteilung neu bewerten. Bis dahin: nicht bauen.
- **Owner-Entscheidungen abgeschlossen (2026-08-26):** D3 = **24 Monate** (G1) · Auflage C **gesplittet**,
  **C1 blockierend** (§Vorbedingung C1) / **C2 Fast-Follow** (oben) (G2). Der frühere „Klassifikations-Hinweis"
  vom 2026-07-27 — der Consensus stufte A–C blockierend ein, diese ADR führte nur A/B — ist damit **aufgelöst**:
  **der Consensus meinte C1, diese ADR meinte C2**, beide hatten für ihren Anteil recht. Herleitung im
  Ergebnis-Protokoll `TL-14a-consensus-result-C.md` (adversarialer Doppellauf, Same-Vendor-Panel; **kein**
  Cross-Vendor-Pass — `codex`/`agy` nicht aufrufbar, s. dortige Lauf-Metadaten).
- **Weiterhin offen (nicht Teil dieses Sign-offs):** die **Freigabe des C1-Umsetzungs-Slices** (Codier-Start)
  und **TL-14b** selbst (⛔ Termin + Christian).

## Verworfene Alternativen
- **Gekoppelter Domain-Flip** (D1-Gegenoption) — zwei Variablen/Fenster, schlechte Bisektierbarkeit.
- **`pathLen 1`** (D2) — unnötige Vollmacht (TH02 könnte Sub-CAs), widerspricht „exakt zwei Stufen".
- **Cross-Sign** (D4) — neue ungetestete Chain-Verifikation im Sicherheitspfad, Nutzen bei ~10 Nodes gering.
- **`ca.crt.pem`-Chain-Swap** (D5) — repo-belegte, ungelöste Fallen.
- **Heißes TH02** (D6) — doppelte Angriffsfläche ohne HA-Bedarf.
- **Intermediate ≥5 Jahre** (D3) — von **beiden** Modellen verworfen (Kompromittierungsfenster ohne
  Revocation).

## Nächste Schritte
1. ~~**Christian-Sign-off:** exakte D3-Laufzeit → ADR auf `Accepted`; D1/D4/D5/D6-Gates bestätigen.~~
   ✅ **erledigt 2026-08-26** — D3 = **24 Monate**, D1/D2/D4/D5/D6 mit-bestätigt, Status `Accepted`.
   Gleichzeitig **G2** gezeichnet: C1 blockierend / C2 Fast-Follow.
2. ~~**Vorbedingungs-Slices A + B**~~ ✅ **erledigt** — A (`verifyPeerCertChain` + `pathLen`, #298/#299/#311,
   Transport-Konformitätstest #342) und B (`cert-monitor-wiring.ts`, #297/#344) sind code-komplett +
   regressionsfest.
3. **Vorbedingungs-Slice C1** (Code, VOR TL-14b) — `isRevoked`-Verdrahtung an App-Verify +
   `agent-card.ts:311`/`:353`, 3 Pflicht-Tests inkl. Alt-Pin-Kollision, Audit-Event, Header-Korrektur.
   **⛔ Freigabe des Slices steht noch aus** (nicht Teil des Sign-offs vom 2026-08-26).
4. **Runbook-Volltext + Zeremonie-Skripte** (Papier+Skripte, non-gated) — jetzt **entriegelt**: die
   D3-Zahl (**24 Monate**) steht in der Cert-Erzeugung fest.
5. **TL-14b** — Durchführung (⛔ termin- + Christian-gated, Token-Re-Onboard je Node + Zwei-Peer-Proof).
   **Setzt C1 voraus.**

## Abgrenzung
Doc/Design only. **Kein** Code/Config/Skript in diesem Slice, **kein** Deploy/Secret/Cross-Host. Die ADR
**entscheidet** D1/D2/D4/D5/D6 (Konsens-getragen) und **parkt** D3 als einzige Owner-Entscheidung; die
Vorbedingungen A/B sind benannt, nicht umgesetzt.
