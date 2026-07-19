# ADR-045 — CA-Zweistufen-Hierarchie (Offline-Root → Intermediate TH01 / Geschwister TH02)

**Status:** Proposed (Draft — **kein** Deploy/Merge-in-Prod ohne Christians Wort; **eine** offene Owner-
Entscheidung, s. §D3)
**Datum:** 2026-07-19
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

### D3 — Intermediate-Validität & Erneuerung: **OFFEN (Owner-Entscheidung)** — Korridor **1–3 Jahre**
Einigkeit: die Laufzeit wird **entkoppelt** von der 30-Tage-`renew_before_days`-Leaf-Logik (jede
Intermediate-Erneuerung braucht die Offline-Root-Zeremonie). **Divergenz:** opus **12–24 Monate**, sonnet
**3 Jahre** (Rushed-Ceremony-Risiko im Solo-Betrieb vs. online-Key-Kompromittierungsfenster). **Beide
verwerfen ≥5 Jahre.** Root-Laufzeit: **10–15 Jahre**. **→ Diese ADR bleibt `Proposed`, bis Christian die
exakte Intermediate-Laufzeit im Korridor 1–3 J setzt** (Zeremonie-Frequenz vs. Kompromittierungs-Fenster).
Voraussetzung: Vorbedingung B (Monitoring).

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

### Vorbedingung B — Intermediate-Expiry-Monitoring (macht D3 sicher)
- **Befund:** der Live-Monitor liest nur `node.crt.pem` (`getCertDaysLeft`, `index.ts:1613`,
  `tls.ts:708-724`); CA/Intermediate wird **live nie** geprüft (nur Start-Reissue für **own-CA**,
  `tls.ts:426-451`; token-onboarded Nodes + ein künftiges Intermediate haben **keinen** Pfad).
- **Folge-Slice (Code, VOR dem ersten Intermediate):** `getCertDaysLeft` um eine CA/Intermediate-Quelle
  erweitern, der Monitor klassifiziert beide getrennt (eigener Audit-Sub-Typ / `subject`-Detail).

## Konsequenzen
- **Positiv:** Root-Key offline (kein online-Kompromittierungs-Hotspot mehr für die Wurzel); Standard-2-Stufen-
  PKI; Reuse bestehender Pin-/Retain-Mechanik (D4); keine neuen Chain-Swap-Fallen (D5).
- **Kosten:** je-Node-Re-Onboard-Fenster (D5, gated); Offline-Zeremonie-Disziplin (D3); zwei neue Code-Slices
  (A/B) VOR dem Umzug.
- **Offen (Owner):** exakte D3-Intermediate-Laufzeit (1–3 J). **Offen (out of scope):** Revocation-Infra —
  heute keine (CRL/OCSP); sonnet-Vorschlag: gepinnte Fingerprint-Denylist statt vollem CRL/OCSP (eigener
  Beschluss, verschärft das D3-Laufzeit-Risiko solange sie fehlt).

## Verworfene Alternativen
- **Gekoppelter Domain-Flip** (D1-Gegenoption) — zwei Variablen/Fenster, schlechte Bisektierbarkeit.
- **`pathLen 1`** (D2) — unnötige Vollmacht (TH02 könnte Sub-CAs), widerspricht „exakt zwei Stufen".
- **Cross-Sign** (D4) — neue ungetestete Chain-Verifikation im Sicherheitspfad, Nutzen bei ~10 Nodes gering.
- **`ca.crt.pem`-Chain-Swap** (D5) — repo-belegte, ungelöste Fallen.
- **Heißes TH02** (D6) — doppelte Angriffsfläche ohne HA-Bedarf.
- **Intermediate ≥5 Jahre** (D3) — von **beiden** Modellen verworfen (Kompromittierungsfenster ohne
  Revocation).

## Nächste Schritte
1. **Christian-Sign-off:** exakte D3-Laufzeit (Korridor 1–3 J) → ADR auf `Accepted`; D1/D4/D5/D6-Gates
   bestätigen.
2. **Vorbedingungs-Slices A + B** (Code, repo-safe, non-gated) — chain-fähiger Verify + Charakterisierungs-
   Test; CA/Intermediate-Expiry-Quelle.
3. **Runbook-Volltext + Zeremonie-Skripte** (Papier+Skripte, non-gated) — auf Basis dieser ADR.
4. **TL-14b** — Durchführung (⛔ termin- + Christian-gated, Token-Re-Onboard je Node + Zwei-Peer-Proof).

## Abgrenzung
Doc/Design only. **Kein** Code/Config/Skript in diesem Slice, **kein** Deploy/Secret/Cross-Host. Die ADR
**entscheidet** D1/D2/D4/D5/D6 (Konsens-getragen) und **parkt** D3 als einzige Owner-Entscheidung; die
Vorbedingungen A/B sind benannt, nicht umgesetzt.
