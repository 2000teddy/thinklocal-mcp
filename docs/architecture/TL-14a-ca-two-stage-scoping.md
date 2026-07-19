# TL-14a — CA-Zweistufen-Umzug: Scoping / Discovery

**KW30 · Scoping-Note (kein Runbook-Volltext, keine Skripte, kein Deploy) · Erstellt 2026-07-19 ·
Repo-Grounding gegen die heutige Self-Signed-Mesh-CA.**
Zweck: die kleinste korrekte v1 des **Zweistufen-Umzugs** (Offline-Wurzel → Intermediate TH01 →
Geschwister-Intermediate TH02) festlegen **bevor** das Runbook + die Zeremonie-Skripte (TL-14a-Volltext)
entstehen und **bevor** irgendwas umgezogen wird (TL-14b, ⛔ Termin, mit Christian). Analog zur
`TL-10-freigabe-matrix-scoping.md`-Note. **Diese Note trifft keine neue Design-Entscheidung** — sie
groundet den Ist-Zustand, konsolidiert die bereits gefallenen Beschlüsse und macht die **exakt noch offenen
Entscheidungen (§5)** zum Gate für den ersten Runbook-/Skript-Text.

## 1. Der Ist-Zustand (heute, code-gegroundet)

Die Vertrauenswurzel des Mesh ist heute **flach und einstufig**:

- **CA-Erzeugung:** `createMeshCA()` (`tls.ts:59`) erzeugt eine **self-signed Root** mit
  `basicConstraints{ cA:true, critical }` + `keyUsage{ keyCertSign, cRLSign, critical }`
  (`tls.ts:84-85`) — **kein `pathLenConstraint`, kein Intermediate-Begriff.** Kommentar im Modul:
  „einfache Self-Signed CA … Phase 1: Self-Signed CA, ein Zertifikat pro Node" (`tls.ts:5-9`).
- **Leaf-Ausstellung:** `createNodeCert()` (`tls.ts:108`) signiert die Node-Leafs direkt mit dem
  Root-Key (`basicConstraints{ cA:false }` `tls.ts:156`, `cert.sign(caKey, sha256)` `tls.ts:174`).
  → **Root signiert Leafs unmittelbar** (0 Zwischenstufen).
- **Attesting-CA-Pfad (ADR-022 Schritt 3):** parallel stellt `cert-issuer.ts`
  (`signNodeCertFromCsr` / `CertIssuer.verifyAndIssue`) auf **.94/TH01** nach Proof-of-Possession
  kanonische Leafs `spiffe://thinklocal/node/<PeerID>` aus, signiert mit dem **Mesh-CA-Key**. Die
  Trust-Anker-Auswahl läuft über `resolveAttestingCaFingerprints()` (`cert-issuer.ts:121`,
  Env `TLMCP_PEERID_ATTESTING_CA_FP`). → **TH01 spielt heute faktisch schon die „Aussteller"-Rolle**,
  aber mit dem **Root-Key selbst**, nicht mit einem abgeleiteten Intermediate.
- **Persistenz:** `ca.crt.pem` + `ca.key.pem` im tlsDir (`tls.ts:403-404`, Root-Key **liegt auf der
  ausstellenden Maschine**). Legacy-Rotation kennt bereits `ca.crt.legacy.pem` / `ca.key.legacy.pem`
  (`tls.ts:437-438`). CA-Cert wird `0o644`, Key `0o600` geschrieben (`tls.ts:548`).
- **Config-Oberfläche:** `cert.renew_before_days` (Default 30, `config.ts:165/251`),
  `cert.migrate_legacy_identity` (Default `false`, ADR-034, `config.ts:169/252`). **Kein**
  `trust_domain`-Feld, **keine** Hierarchie-/Intermediate-Konfiguration vorhanden.

**Kernbefund:** Der Root-Key ist heute **online und ko-lokalisiert** mit dem Aussteller. Der
Zweistufen-Umzug trennt genau das: Root **offline/air-gapped**, Ausstellung nur noch über ein
**Intermediate**.

## 2. Bereits gefallene Beschlüsse (bindend — nicht Gegenstand dieser Note)

- **ADR-022 / ADR-028** — kanonische Identität ist `spiffe://thinklocal/node/<PeerID>` (aus dem
  libp2p-Key). Der Umzug **erhält** diese SAN; er ändert nur den **Signierpfad**, nicht das Subjekt.
- **ADR-024** — Canonical-Cert-Retention beim Boot (Sender-Flip für CA-owner + own-CA Nodes). Der Umzug
  darf den Retain-Pfad nicht brechen (kein Doppel-Identitäts-Zustand). *Status ADR-024: Proposed/Draft.*
- **ADR-034** — Re-Pair-Migrationsstufe (`migrate_legacy_identity`, opt-in, Default AUS). Präzedenz für
  „bewusst per Fenster aktivieren, nie heimlich beim Start".
- **Decision-7 / `[[decision7-trust-domain]]`** — Trust-Domain-Flip auf `axxsys-software.de` ist mit
  **KW30/TL-14** gebündelt; die KW28-Re-Pair blieb bewusst auf `spiffe://thinklocal/`. **Kopplungsfrage**
  (flippt der Umzug zugleich die Trust-Domain?) → §5.
- **TL-13** (vorgelagert) — Re-Enroll `.56/.222/.94` → `node/<PeerID>` + Duldungs-Ende Alt-Format
  (spätestens 01.08.). Der Umzug setzt kanonische Leafs voraus.

## 3. Ziel-Hierarchie (Vorschlag — die offenen Punkte §5 gehen VOR Runbook/Skript)

```
Offline Root CA (air-gapped, Key NIE online)     ← neue Zeremonie
        │  signiert genau die Intermediates, sonst nichts
        ├── Intermediate CA @ TH01 (online Aussteller)   ← ersetzt die heutige createMeshCA-Root-Rolle
        │        │  signiert node/<PeerID>-Leafs (cert-issuer.ts-Pfad)
        │        └── Node-Leafs (.94/.55/.52/.56/.222/…)
        └── Geschwister-Intermediate CA @ TH02 (HA/Ausfall-Reserve)
                 └── (Reserve-Aussteller, gleiche Trust-Kette)
```

- **Offline-Root:** ausschließlich für das Signieren der beiden Intermediates; Root-Key verlässt nie den
  Air-Gap. `pathLenConstraint` (0? 1?) → §5.
- **Intermediate TH01:** übernimmt die operative Ausstellerrolle (heute Root-Key in `createMeshCA`/
  `cert-issuer.ts`). Trust-Anker der Nodes wird die **Root**, ausgeliefert als Chain (Root +
  Intermediate) in `ca.crt.pem` bzw. via Token-Onboard.
- **Geschwister-Intermediate TH02:** Ausfall-/HA-Reserve, damit ein TH01-Verlust nicht die
  Ausstellung tötet. Genauer Zweck (heiß/kalt, eigener Namensraum?) → §5.

## 4. Runbook-Struktur (Skelett des TL-14a-Volltexts — hier NICHT ausgeführt)

Der spätere Runbook-Text (eigener Slice nach §5) gliedert sich voraussichtlich in:

1. **Vorbedingungen** — TL-13 kanonisch abgeschlossen; Bestandsaufnahme aller aktiven CA-Fingerprints
   (`resolveAttestingCaFingerprints`), Inventar der Node-Leafs + Restlaufzeiten (`cert-expiry-monitor`).
2. **Offline-Wurzel-Zeremonie** — Air-Gap-Setup, Root-Keygen, `basicConstraints`/`pathLen`/Validität,
   Schlüssel-Verwahrung + Zeugen-/Backup-Regel. **Nur Papier + noch-zu-schreibende Skripte.**
3. **Intermediate TH01 ausstellen** — CSR auf TH01 → offline signieren → Chain zurückspielen.
4. **Geschwister-Intermediate TH02 ausstellen** — analog, Reserve.
5. **Chain-of-Trust-Verifikation** — jedes künftige Leaf verifiziert gegen Root über Intermediate
   (`verifyPeerCert`/`verifyCanonicalNodeCert` `tls.ts:371-388` müssen mit Chain umgehen — **Prüfpunkt**).
6. **Ausrollplan der neuen Kette an die Nodes** — Token-Re-Onboard vs. `ca.crt.pem`-Chain-Swap
   (`[[cert-clobber-on-ca-reissue]]` als Falle beachten) → **das ist TL-14b, gated.**
7. **Rollback** — Rückfall auf die alte Root, solange Alt-Fingerprint noch gepinnt.

## 5. Exakt offene Entscheidungen (Gate VOR Runbook-Volltext + Skripten)

1. **Trust-Domain-Kopplung:** Flippt der Umzug **zugleich** die Trust-Domain auf `axxsys-software.de`
   (Decision-7), oder bleibt die SAN-Domain `thinklocal` und die Domain-Flip ist ein **separater**
   Schnitt? (Zwei Variablen in einem Fenster = Risiko.)
2. **`pathLenConstraint` der Root:** `0` (Root darf nur Intermediates, die **keine** weiteren CAs
   ausstellen) vs. `1`. Bestimmt, ob TH02 selbst noch Sub-CAs könnte.
3. **Intermediate-Validität & Erneuerung:** Laufzeit der Intermediates (vs. `NODE_CERT_VALIDITY_DAYS=90`,
   `cert-issuer.ts`) und ob `renew_before_days`-Logik sie erfasst oder ein eigener Zyklus gilt.
4. **Cross-Sign vs. harter Schnitt:** Werden die neuen Intermediates während der Übergangszeit von der
   **alten** Root **quer-signiert** (nahtlos, aber komplexer), oder harter Cutover mit Doppel-Pin
   (Alt+Neu) im Fenster? Interagiert mit ADR-024-Retention und dem 01.08.-Duldungsende (TL-13).
5. **Ausroll-Mechanik der Chain an die Nodes:** Token-Re-Onboard (sauber, aber je Node ein Fenster) vs.
   `ca.crt.pem`-Chain-Swap (schneller, aber `[[cert-clobber-on-ca-reissue]]`- und
   `[[th02-phase3-flip-blocker]]`-Fallen). **Diese Entscheidung ist der eigentliche TL-14b-Kern.**
6. **TH02-Rolle:** Geschwister-Intermediate heiß (aktiv mit-ausstellend) oder kalt (versiegelte
   Reserve)? Eigener Aussteller-Namensraum oder identische Kette?

## 6. Abgrenzung

- **Doc/Design only.** Kein Runbook-Volltext, **keine** Zeremonie-Skripte, kein `createMeshCA`-Code
  angefasst, kein Config-Feld hinzugefügt, **kein** Deploy/Secret/Cross-Host-Schritt.
- Der **Runbook-Volltext + Skripte** sind ein Folge-Slice **nach §5-Klärung** (der eigentliche TL-14a-
  Rest). Die **Durchführung** ist **TL-14b** — ⛔ termin- und Christian-gated, außerhalb dieses Repos.
- Eine künftige **ADR** (CA-Hierarchie / Offline-Root) hält die §5-Entscheidungen fest, bevor der
  Runbook-Text geschrieben wird — analog zum ADR-nach-Scoping-Muster von TL-10.
