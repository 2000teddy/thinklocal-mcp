# RUNBOOK TL-14 — Offline-Wurzel-Zeremonie und CA-Zweistufen-Umzug

**Status:** Volltext, ausführungsbereit für Schritte 1–5 + 7. **Schritt 6 (Ausrollen) ist TL-14b und ⛔ gated.**
**Grundlage:** `docs/architecture/ADR-045-ca-two-stage-hierarchy.md` (**Accepted**, Owner-Sign-off 2026-08-26)
**Erstellt:** 2026-08-31 · **Skripte:** `scripts/tl14-ca/` · **Test:** `tests/integration/tl14-ceremony-scripts.test.ts`

---

## 0. Was dieses Runbook ist — und was nicht

Es beschreibt den Umzug von der heutigen **flachen, selbstsignierten Mesh-CA** (`createMeshCA`,
`packages/daemon/src/tls.ts:59`, Root-Key online und ko-lokalisiert mit dem Aussteller) auf die
**zweistufige Hierarchie** aus ADR-045:

```
Offline Root CA (air-gapped, pathLen 1, 10–15 Jahre)
        ├── Intermediate CA @ TH01 (operativer Aussteller, pathLen 0, 24 Monate)
        │        └── node/<PeerID>-Leafs (90 Tage)
        └── Geschwister-Intermediate CA @ TH02 (KALTE, versiegelte Reserve)
```

**Ausführbar ohne weiteres Gate:** Schritte 1–5 und 7 erzeugen ausschliesslich **neues, paralleles**
Material und fassen keinen laufenden Daemon an. Sie können jederzeit trocken geprobt werden.

**Nicht ausführbar:** **Schritt 6** (die neue Kette an die Nodes bringen) ist **TL-14b** — termin- und
Christian-gated, und setzt zusätzlich **Vorbedingung C1** (`crl.ts` verdrahten) voraus, deren
**Codier-Freigabe noch aussteht**. Wer Schritt 6 ohne diese beiden Freigaben ausführt, produziert genau
den Zustand, den `docs/architecture/TL-14a-consensus-result-C.md` als „unsperrbare Reserve" beschreibt.

---

## 1. Die sieben Befunde, an denen dieser Umzug scheitert (VOR Schritt 1 lesen)

Diese Punkte sind am Code verifiziert, nicht abgeleitet. Sie sind der eigentliche Wert dieses Runbooks:
jeder einzelne ist eine Falle, die erst **im Wartungsfenster** aufgefallen wäre.

### F1 — Eine Chain in `ca.crt.pem` schaltet den Attesting-Pin STILL AB
`resolveAttestingCaFingerprints` (`packages/daemon/src/cert-issuer.ts:121-141`) leitet den Pin nur ab,
wenn `ca.crt.pem` **genau ein** Zertifikat enthält (`certCount !== 1` → `{fingerprints: [], source: 'no-ca'}`,
`:132-133`). Legt man dort die **Kette** (Root + Intermediate) ab — was intuitiv richtig wirkt —, ist der
Pin **leer**. Folge: `isAttestingIssuer` liefert `false` (fail-closed, `peer-identity.ts:274`), jeder
kanonische Sender bekommt **403 „Canonical sender requires a PeerID-attesting certificate issuer"**
(`agent-card.ts:319-322`). Das ist dieselbe Fehlerklasse wie der Unknown-sender-Deadlock aus dem
TH02-Phase-3-Flip.
**Konsequenz:** `TLMCP_PEERID_ATTESTING_CA_FP` **muss vor dem Cutover explizit gesetzt sein.**
Auto-Derive ist im Zweistufen-Betrieb kein tragfähiger Pfad mehr.

### F2 — Gepinnt wird das INTERMEDIATE, nicht die Root
`agent-card.ts:311` liest `peerCert?.issuerCertificate?.fingerprint256` — den **direkten** Aussteller des
Leafs. In der Zweistufigkeit ist das das **Intermediate**. Ein Pin, der nur den Root-Fingerprint enthält,
lehnt **jeden** Node ab.

### F3 — Das Fingerprint-Format passt bereits (Format-Vorbehalt aus #352 ist damit erledigt)
`normalizeFingerprint` (`peer-identity.ts:260-262`) entfernt `:` und uppercased vor dem Vergleich. Damit
sind **beide** gängigen Schreibweisen gültige Pin-Werte: OpenSSLs `AA:BB:CC…` und die kleingeschriebene
Form ohne Trenner, die `certFingerprint()` (`cert-issuer.ts:94-98`) und `tl14_fingerprint` liefern. Dass
`certFingerprint()` bitgleich mit dem OpenSSL-DER-SHA256 ist, hält
`tests/integration/tl14-ceremony-cert-profile.test.ts` (letzter Fall) fest.

### F4 — Der Intermediate-Pin hält den bestehenden Verify-Code UNVERÄNDERT korrekt
`verifyCanonicalNodeCert` übergibt eine **einelementige** Kette: `verifyPeerCertChain(trustedAttestingCaPems,
[certPem])` (`tls.ts:392`). Ist das **Intermediate** gepinnt, ist es der Trust-Anker, und die einelementige
Kette verifiziert korrekt — **ohne Codeänderung**. Wäre die **Root** der Anker, fehlte das Intermediate in
der Kette und der Verify schlüge fehl; dann müsste der Aufrufer die volle Kette durchreichen (Codearbeit,
im Kommentar `tls.ts:389-391` bereits als künftiger Fall vorgemerkt). **F2 ist also nicht nur bequem,
sondern die Variante, die ohne Codeänderung funktioniert.**

### F5 — Im Onboarding-Bundle gehört das Intermediate als `ca.crt.pem`
Der Token-Onboard-Pfad (`tls.ts:490-544`) prüft das gelieferte Bundle mit `verifyPeerCert(caCertPem, certPem)`
(`:520`) — einem **flachen Ein-Aussteller-Verify** (`tls.ts:754-775`), der keine Kette baut. Liefert man die
**Root** als `ca.crt.pem`, verifiziert das vom Intermediate signierte Node-Cert **nicht**, und der Daemon
wirft fail-closed: *„Token-onboarded TLS-Bundle ungültig … bitte den Node per Admin-Token neu onboarden"*
(`:540-544`). Also: **`ca.crt.pem` = Intermediate.**

### F6 — Der Daemon reisst die CA neu aus, wenn Cert und Key nicht zusammenpassen
`loadOrCreateNodeCert` setzt `needsCaReissue = true`, wenn `ca.crt.pem`/`ca.key.pem` **kein Paar** sind
(`tls.ts:472-477`) oder die CA **abgelaufen** ist (`:447-455`) — und generiert dann eine **frische
selbstsignierte Root** (`:549-554`), die das Zeremonie-Material überschreibt. Genau diese Fehlerklasse hat
schon einmal Identitäten gekostet.
**Konsequenz:** Nach dem Einbau muss auf TH01 gelten: `ca.crt.pem` = Intermediate-**Cert**, `ca.key.pem` =
Intermediate-**Key**, und die beiden müssen zueinander passen. Vor dem Neustart verifizieren (Schritt 6.3).

### F7 — Ein Kommentar im Code wird durch diesen Umzug unwahr
`cert-issuer.ts:118-119` führt „Single-Mesh-CA + **DIREKTE** Issuance (kein Intermediate) ist invariant in
diesem Codebase" als Begründung für das Auto-Derive. Das Verhalten bleibt unter F2 korrekt, die **Begründung**
gilt nach dem Umzug nicht mehr. **Doku-Schuld, im TL-14b-Slice mitkorrigieren** — hier bewusst nicht
angefasst (kein Code-Churn in einem Papier-Slice).

---

## 2. Rollenverteilung der Maschinen

| Rolle | Maschine | Was dort liegt |
|---|---|---|
| **Air-Gap** | dedizierter Rechner ohne Netz, nur für die Zeremonie hochgefahren | `root.key.pem` (**verlässt ihn nie**), `root.crt.pem` |
| **TH01** | operativer Aussteller | eigener `intermediate.key.pem` + signiertes Cert → wird `tls/ca.key.pem` + `tls/ca.crt.pem` |
| **TH02** | kalte Reserve (D6) | eigener `intermediate.key.pem` + signiertes Cert, **versiegelt verwahrt**, nicht eingebaut |
| **Transport** | USB-Stick | trägt **nur** CSRs (hin) und signierte Certs (zurück) — beides öffentlich |

**Über den Air-Gap wandert niemals ein privater Schlüssel.** Weder Root-Key hinaus noch Intermediate-Key
hinein. Wenn ein Schritt das zu verlangen scheint, ist der Schritt falsch verstanden.

---

## Schritt 1 — Vorbedingungen und Bestandsaufnahme

**Wo:** TH01 (bzw. der Admin-Host). **Gate:** keins.

1. **Vor-Zeremonie-Check des OpenSSL der Zeremonie-Maschine:**
   ```bash
   bash scripts/tl14-ca/tl14-pathlen-proof.sh
   ```
   Exit 0 = dieses OpenSSL setzt `pathLenConstraint` wie erwartet durch. Bei Exit 1 **nicht fortfahren**
   (`docs/architecture/TL-14a-D2-pathlen-blocker.md`).

2. **Aktive CA-Fingerprints inventarisieren** — der **alte** Wert wird für den Doppel-Pin (D4) gebraucht:
   ```bash
   openssl x509 -in ~/.thinklocal/tls/ca.crt.pem -outform DER | openssl dgst -sha256 -hex
   echo "${TLMCP_PEERID_ATTESTING_CA_FP:-<nicht gesetzt — dann gilt Auto-Derive, siehe F1>}"
   ```

3. **Node-Leafs + Restlaufzeiten** erfassen (welche Nodes im Fenster ohnehin erneuert werden müssten):
   ```bash
   openssl x509 -in ~/.thinklocal/tls/node.crt.pem -noout -subject -enddate
   ```
   Für die Flotte: der laufende Daemon meldet beides über die Cert-Expiry-Monitore
   (`packages/daemon/src/cert-monitor-wiring.ts`, Quellen Node und CA getrennt).

4. **TL-13 kanonisch abgeschlossen?** Alle Ziel-Nodes müssen bereits kanonische `node/<PeerID>`-Identität
   tragen. Ein Node, der noch Legacy ist, überlebt den Umzug nicht ohne separates Fenster.

**Protokollzeile:** Datum · alter CA-Fingerprint · Liste der Nodes mit Restlaufzeit.

---

## Schritt 2 — Offline-Wurzel-Zeremonie

**Wo:** Air-Gap-Rechner. **Gate:** keins (Probelauf jederzeit möglich).

```bash
bash scripts/tl14-ca/tl14-ceremony-root.sh --out /media/airgap/tl14-root --days 4383
```
OpenSSL fragt die **Passphrase** interaktiv ab (zweimal). Das Skript prüft anschliessend nach, dass der Key
tatsächlich verschlüsselt auf der Platte liegt, und bricht sonst ab.

- **Profil (erzwungen):** `basicConstraints=critical,CA:TRUE,pathlen:1`, `keyUsage=critical,keyCertSign,cRLSign`,
  RSA-4096, SHA-256.
- **Key-Verschlüsselung (erzwungen, AES-256):** Dateirechte schützen gegen den Nachbar-Account, nicht gegen
  **Medienverlust** — ein entwendeter Air-Gap-Stick mit Klartext-Root-Key kompromittiert die gesamte PKI ohne
  einen einzigen Rechenschritt. Der Root-Key wird alle 24 Monate genau **einmal** gebraucht; die Passphrase
  kostet also praktisch nichts.
  **Die Passphrase gehört NICHT auf dasselbe Medium wie der Key** — sonst ist die Verschlüsselung wirkungslos.
  Getrennt verwahren (Passwortmanager/Papier im Safe). Ohne sie ist in 24 Monaten **keine
  Intermediate-Erneuerung mehr möglich** — das ist der Verlustfall, der die kalte TH02-Reserve nicht rettet.
- **Laufzeit:** ADR-045 D3 führt den Korridor **10–15 Jahre**; die exakte Zahl ist bewusst **kein**
  ADR-Gegenstand und wird **hier** festgelegt. Default 4383 Tage (12 Jahre). Das Skript **verweigert**
  Werte ausserhalb 3650–5478 Tagen — eine Abweichung wäre eine Beschluss-Abweichung, kein Tippfehler.
- **Überschreibschutz:** Das Skript bricht ab, wenn `root.key.pem` bereits existiert. Ein versehentlich
  neu erzeugter Root-Key macht die gesamte Hierarchie darunter wertlos.

**Schlüssel-Verwahrung (Solo-Betrieb, keine Zeugen-Regel erzwingbar):**
- Key bleibt auf dem Air-Gap-Medium, Modus `600`.
- **Zwei** Kopien auf getrennten Offline-Medien, räumlich getrennt gelagert.
- Der Fingerprint wird **ausserhalb** der Medien protokolliert (Papier/Passwortmanager), sonst ist ein
  vertauschtes Medium nicht erkennbar.
- Wiedervorlage: **24 Monate** (D3) — die erzwungene Intermediate-Erneuerung **ist** die Zeremonie-Probe,
  die D6 verlangt. Als Kalendereintrag anlegen, sonst verrottet die Prozedur.

**Protokollzeile:** Datum · Root-Fingerprint · Laufzeit · Lagerorte der beiden Kopien.

---

## Schritt 3 — Intermediate TH01 ausstellen

**Gate:** keins.

**3a — auf TH01** (der Key entsteht dort, wo er arbeiten wird):
```bash
bash scripts/tl14-ca/tl14-ceremony-intermediate-csr.sh \
  --out ~/tl14-int-th01 --cn "ThinkLocal Intermediate CA TH01"
```
**Nur** `intermediate.csr.pem` auf den USB-Stick. Den Key nicht kopieren — auch nicht „zum Backup".

> **Der TH01-Key bleibt bewusst im Klartext — `--encrypt-key` hier NICHT setzen.**
> Er wird zu `tls/ca.key.pem`, und der Daemon liest ihn mit `forge.pki.privateKeyFromPem`
> (`tls.ts:465`, `:116`) — **ohne jede Passphrase-Unterstützung**. Ein verschlüsselter Key parst dort nicht,
> `caPairMatches` wird `false`, und der Daemon generiert daraufhin eine **frische selbstsignierte Root**
> (`tls.ts:472-477` → `:549-554`), die das gesamte Zeremonie-Material überschreibt (F6). Der Schutz läuft
> hier über Dateirechte (600) und den Host. **Für TH02 gilt das Gegenteil — siehe Schritt 4.**

**3b — auf dem Air-Gap-Rechner:**
```bash
bash scripts/tl14-ca/tl14-ceremony-sign-intermediate.sh \
  --root-dir /media/airgap/tl14-root \
  --csr /media/usb/intermediate.csr.pem \
  --out /media/usb/intermediate-th01.crt.pem
```
Das Skript prüft **vor** dem Signieren die CSR-Selbstsignatur (`openssl req -verify`) — eine CSR ohne
gültige Selbstsignatur belegt keinen Schlüsselbesitz, und die Root würde einen fremden Public-Key
beglaubigen. Ebenso wird abgebrochen, wenn das Intermediate die Root überleben würde (die Kette bräche
sonst mitten in der Intermediate-Laufzeit; `verifyPeerCert` prüft das CA-Fenster fail-closed, `tls.ts:769`).

- **Profil (erzwungen):** `pathlen:0` — hier hängt das Schutzziel „keine Sub-CAs".
- **Laufzeit:** 730 Tage (D3). Korridor 365–1095, sonst Abbruch.

**3c —** signiertes Cert zurück auf TH01. **Noch nicht einbauen** (das ist Schritt 6).

**Protokollzeile:** Datum · Intermediate-TH01-Fingerprint (= künftiger Pin-Wert) · Laufzeit.

---

## Schritt 4 — Geschwister-Intermediate TH02 ausstellen (kalte Reserve)

**Gate:** keins. Wie Schritt 3, aber mit `--cn "ThinkLocal Intermediate CA TH02"`, eigenem `--out` und
**`--encrypt-key`**:
```bash
bash scripts/tl14-ca/tl14-ceremony-intermediate-csr.sh \
  --out ~/tl14-int-th02 --cn "ThinkLocal Intermediate CA TH02" --encrypt-key
```
**Warum hier verschlüsselt und bei TH01 nicht:** Der TH02-Key wird **nie von einem Daemon geladen**, sondern
versiegelt verwahrt. Damit entfällt die Parser-Beschränkung aus Schritt 3a, und Dateirechte schützen nicht
gegen Medienverlust — die Passphrase **ist** hier der eigentliche Schutz. Sie gehört getrennt vom Medium
verwahrt und wird bei der Reserve-Aktivierung gebraucht: **bei der D6-Trockenprobe mit prüfen**, sonst fällt
eine verlorene Passphrase erst im Ernstfall auf.

> Wird der TH02-Key später doch in einen laufenden Daemon eingebaut (Aktivierungsfall), muss er **vorher
> entschlüsselt** werden (`openssl rsa -in intermediate.key.pem -out ca.key.pem`) — sonst greift F6.

**Der Unterschied liegt danach:** Das TH02-Intermediate wird **nicht** in einen laufenden Daemon eingebaut
(D6: kalt, nicht heiss mit-ausstellend — zwei heisse Signierschlüssel wären doppelte Angriffsfläche ohne
HA-Bedarf bei dieser Flottengrösse). Key und Cert werden **versiegelt verwahrt**, der Fingerprint wird
protokolliert.

**Aktivierungsfall (nur bei TH01-Verlust/-Kompromittierung):** TH02-Key entsiegeln, `TLMCP_PEERID_ATTESTING_CA_FP`
auf den TH02-Fingerprint umstellen, Nodes gegen TH02 neu onboarden.
**Wichtig — und der tragende Grund für Vorbedingung C1:** Ohne Sperrfähigkeit bleibt das kompromittierte
TH01-Intermediate **gültig**. Die Reserve stellt dann **Verfügbarkeit** wieder her, **nicht Integrität**.
Deshalb ist C1 blockierend vor TL-14b.

**D6-Auflage:** Die Reserve-Aktivierung **mindestens einmal trocken proben** — ungeprobte Reserve ist keine
Reserve. Der Probelauf ist gate-frei: Schritte 2–5 mit Wegwerf-Material in einem Temp-Verzeichnis.

**Protokollzeile:** Datum · Intermediate-TH02-Fingerprint · Siegel-/Lagerort · Datum der letzten Trockenprobe.

---

## Schritt 5 — Chain-of-Trust-Verifikation

**Gate:** keins. **Dieser Schritt ist die Abnahme vor dem gated Schritt 6.**

Ein Test-Leaf vom TH01-Intermediate signieren lassen und die Kette prüfen:
```bash
bash scripts/tl14-ca/tl14-verify-chain.sh \
  --root  /media/airgap/tl14-root/root.crt.pem \
  --intermediate ~/tl14-int-th01/intermediate.crt.pem \
  --leaf  /tmp/test-node.crt.pem
```

Das Skript prüft vier Dinge und liefert Exit != 0, sobald eines fehlschlägt:
1. **Kette** Root → Intermediate → Leaf (`openssl verify`, vendor-neutral).
2. **Profil D2** — Root `pathlen:1`, Intermediate `pathlen:0`.
3. **Flacher Pfad** — Leaf direkt gegen das Intermediate. Das ist es, was der Token-Onboard-Pfad tut
   (F5); ohne diesen Check fällt der Fehler erst beim Onboarding auf.
4. **Pin-Wert** — der Fingerprint des direkten Ausstellers.

**Zusätzlich gegen den echten Daemon-Code** (nicht nur gegen OpenSSL):
```bash
npx vitest run --root . tests/integration/tl14-ceremony-scripts.test.ts
```
Dieser Test lässt die **echten Zeremonie-Skripte** laufen und prüft das Ergebnis mit
`verifyPeerCertChain` aus dem Daemon — er schliesst die Lücke „OpenSSL erzeugt, node-forge prüft".

**Die Pin-Zeile für Schritt 6 (D4-Doppel-Pin):**
```
TLMCP_PEERID_ATTESTING_CA_FP=<alter-ca-fingerprint>,<intermediate-th01-fingerprint>
```
Beide Werte gleichzeitig, **alter zuerst**. Entfernt wird der alte **nach dem Node-N-Proof**, nicht an
einem Kalenderstichtag (D4-Auflage).

**Protokollzeile:** Datum · Ergebnis aller vier Prüfungen · die vollständige Pin-Zeile.

---

## Schritt 6 — Ausrollen an die Nodes ⛔ **TL-14b — NICHT AUSFÜHREN**

**Zwei Gates, beide offen:**
1. **Vorbedingung C1** (`crl.ts` verdrahten) — inhaltlich definiert, **Codier-Freigabe steht aus**.
2. **TL-14b-Termin** — Christian, mit Fenster.

Hier steht **nur der Plan**, damit er im Fenster nicht neu erfunden werden muss:

- **Mechanik: Token-Re-Onboard je Node** (D5, einstimmig). **Kein** `ca.crt.pem`-Chain-Swap — dessen Fallen
  sind repo-belegt und ungelöst (Cert-Clobber bei CA-Reissue, Unknown-sender-Deadlock beim Flip).
- **6.1** Pin **zuerst** setzen (Doppel-Pin, beide Werte) und Daemon neu starten — **bevor** ein Node
  umgestellt wird. Grund: F1/F2. Ein Node mit neuer Kette und altem Pin ist sofort tot.
- **6.2** Je Node ein Fenster: Bundle mit `ca.crt.pem` = **Intermediate** (F5), `node.crt.pem` +
  `node.key.pem` neu ausgestellt. Nach jedem Node der Zwei-Peer-Proof (echter Tool-Call mit
  Ergebnis-Auszug) — Deploy-Erreichbarkeit allein ist **kein** Nachweis.
- **6.3** Auf TH01 **vor** dem Neustart prüfen, dass `ca.crt.pem` und `ca.key.pem` ein Paar sind (F6):
  ```bash
  openssl x509 -in ~/.thinklocal/tls/ca.crt.pem -noout -pubkey | openssl sha256
  openssl rsa  -in ~/.thinklocal/tls/ca.key.pem -pubout      | openssl sha256
  ```
  Die beiden Hashes **müssen** gleich sein, sonst generiert der Daemon beim Start eine frische
  selbstsignierte Root und macht die Zeremonie zunichte.
- **6.4** Alt-Pin entfernen **erst** nach dem Proof des letzten Nodes.
- **Rollback-Kriterium vorab festlegen** (D4-Auflage) — siehe Schritt 7.

---

## Schritt 7 — Rollback

**Gate:** keins (Vorbereitung). Gilt für das TL-14b-Fenster.

**Das Rollback-Fenster ist exakt so lang, wie der Alt-Fingerprint noch gepinnt ist.** Solange der
Doppel-Pin steht, akzeptiert das Mesh **beide** Ketten — das ist der ganze Zweck von D4.

**Rollback-Kriterium (vor dem Fenster festschreiben, nicht im Fenster erfinden):**
> Rollback, wenn nach Umstellung von Node *k* der Zwei-Peer-Proof scheitert und die Ursache nicht
> innerhalb von 30 Minuten auf eine Node-lokale Fehlkonfiguration eingegrenzt ist.

**Rollback-Prozedur:**
1. Auf dem betroffenen Node das vorherige Bundle zurückspielen (vor jeder Umstellung sichern:
   `tls/ca.crt.pem`, `tls/node.crt.pem`, `tls/node.key.pem`).
2. Pin **unverändert** lassen — der Doppel-Pin deckt beide Ketten ab. **Nicht** „aufräumen".
3. Zwei-Peer-Proof gegen einen noch nicht umgestellten Node wiederholen.
4. Wenn TH01 bereits auf das Intermediate umgestellt ist: alte `ca.crt.pem`/`ca.key.pem` zurückspielen und
   die Paar-Prüfung aus 6.3 wiederholen — sonst greift F6.

**Was ein Rollback NICHT repariert:** bereits neu ausgestellte Node-Leafs bleiben vom Intermediate
signiert. Sie sind gültig, solange der Neu-Pin steht. Der Alt-Pin allein reicht ihnen nicht.

---

## Anhang A — Zeremonie-Protokoll (Vorlage)

```
TL-14 Zeremonie-Protokoll
Datum/Uhrzeit:            ____________________
Durchgeführt von:         ____________________
Air-Gap-Maschine:         ____________________
OpenSSL-Version:          ____________________
Vor-Check (pathlen-proof): [ ] Exit 0

Root
  Fingerprint:            ____________________
  Laufzeit (Tage):        ____________________
  Key verschlüsselt:      [ ] ja (Skript bricht sonst ab)
  Passphrase verwahrt in: ____________________  (NICHT auf dem Key-Medium)
  Kopie 1 Lagerort:       ____________________
  Kopie 2 Lagerort:       ____________________
  Wiedervorlage (24 Mon.):____________________

Intermediate TH01
  Fingerprint (= Pin):    ____________________
  Laufzeit (Tage):        ____________________
  Key im Klartext:        [ ] ja (zwingend — Daemon-Parser, siehe F6)

Intermediate TH02 (kalt)
  Fingerprint:            ____________________
  Key verschlüsselt:      [ ] ja (--encrypt-key)
  Passphrase verwahrt in: ____________________
  Siegel-/Lagerort:       ____________________
  Letzte Trockenprobe:    ____________________  (inkl. Passphrase-Probe)

Verifikation (Schritt 5)
  tl14-verify-chain.sh:   [ ] Exit 0 (4/4 Prüfungen)
  Daemon-Integrationstest:[ ] grün
  Pin-Zeile (D4-Doppel):  TLMCP_PEERID_ATTESTING_CA_FP=____________________

Alter CA-Fingerprint (für Doppel-Pin): ____________________
```

## Anhang B — Skript-Übersicht

| Skript | Schritt | Läuft auf | Erzeugt |
|---|---|---|---|
| `tl14-pathlen-proof.sh` | 1 (Vor-Check) | beliebig | nichts (Wegwerf in `mktemp -d`) |
| `tl14-ceremony-root.sh` | 2 | **Air-Gap** | `root.key.pem`, `root.crt.pem` |
| `tl14-ceremony-intermediate-csr.sh` | 3a/4a | **TH01 / TH02** | `intermediate.key.pem`, `intermediate.csr.pem` |
| `tl14-ceremony-sign-intermediate.sh` | 3b/4b | **Air-Gap** | `intermediate.crt.pem` |
| `tl14-verify-chain.sh` | 5 | beliebig | nichts (nur Prüfung) |

Alle Skripte sind fail-closed: sie überschreiben **niemals** vorhandenes Schlüssel-/Cert-Material und
brechen bei Profil- oder Korridor-Abweichung ab, statt stillschweigend etwas anderes zu erzeugen.

**Zwei OpenSSL-Eigenheiten, die beim Schreiben der Skripte auffielen** (an OpenSSL 3.0.13 verifiziert,
beide durch Tests festgenagelt):

1. **`openssl req -noout -verify` liefert Exit 0 auch bei gebrochener Selbstsignatur.** Der Fehlschlag
   steht ausschliesslich im Text (*„Certificate request self-signature verify failure"*). Eine
   Exit-Code-Prüfung wäre also ein **wirkungsloser** Guard gewesen — `tl14-ceremony-sign-intermediate.sh`
   prüft deshalb auf das positive Verdikt `verify OK` und bricht sonst ab.
2. **`openssl … 2>/dev/null` macht Fehlschläge unsichtbar.** Unter `set -e` endete das Skript dann mit
   Exit 1 und *ohne jede Ausgabe* — in einer Zeremonie die schlechteste Fehlerform. Alle
   openssl-Aufrufe laufen jetzt über `tl14_openssl`, das den Fehlertext mit ausgibt.
