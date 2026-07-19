# TL-14a — Consensus-Blocker A & B: Code-Grounding (vor der ADR)

**KW30 · Discovery/Grounding-Befund · Erstellt 2026-07-19 · repo-lokal, doc-only.**
Der `pal:consensus`-Lauf (`TL-14a-consensus-result-D1-D6.md`) markierte zwei Auflagen als **blockierend**
VOR der CA-Hierarchie-ADR: **A** (Chain-Building / pathLen-Enforcement im Verifikationspfad) und **B**
(Intermediate-Expiry-Monitoring). Dieses Dokument **verifiziert beide am tatsächlichen Code** — damit die ADR
auf Fakten statt Vermutung baut. **Kein** Code/Config geändert; reine Bestandsaufnahme.

---

## Blocker A — pathLen / Chain-Enforcement: **teils fehlend, zwei getrennte Ebenen**

Die Peer-Verifikation läuft im Repo auf **zwei** Ebenen; nur eine davon täte Chain/pathLen, und die ist für
zwei Stufen ungetestet:

### A.1 App-Ebene `verifyPeerCert` (`tls.ts:729`) — **flach, kein Chain-Building, kein pathLen**
```ts
export function verifyPeerCert(caCertPem, peerCertPem): boolean {
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const peerCert = forge.pki.certificateFromPem(peerCertPem);
  const verified = caCert.verify(peerCert);          // ← EIN-Aussteller-Signaturprüfung
  const leafValid = now in peerCert.validity;
  const caValid   = now in caCert.validity;          // ADR-024 MEDIUM-1: auch Issuer-Fenster
  return verified && leafValid && caValid;
}
```
- `caCert.verify(peerCert)` prüft **nur**, ob **dieses eine** CA-Public-Key die Signatur **dieses einen**
  Certs verifiziert — plus Gültigkeitsfenster von Leaf und Issuer. **Keine** Kettenbildung, **kein**
  `basicConstraints`-Check auf einem Intermediate, **kein** `pathLenConstraint`-Enforcement.
- **Repo-Falsifikation:** `grep -rn "verifyCertificateChain\|createCaStore" packages/daemon/src/` → **0
  Treffer**. Die forge-Chain-API wird nirgends benutzt.
- **Wer hängt daran (Trust-Entscheidungen):**
  - `isRetainableCanonicalCert` (`tls.ts:388`) — Attesting-CA-Pin/Retention (ADR-024).
  - `selectTrustDistributionCa` (`tls.ts:769`) — welche CA an Peers verteilt wird.
  - Token-Onboard-Bundle-Prüfung (`tls.ts:516`, `node.crt.pem` gegen geliefertes `ca.crt.pem`).
- **Konsequenz für D2/D4:** In einer **zweistufigen** Welt (Root→Intermediate→Leaf) ist
  `verifyPeerCert(rootPem, leafPem)` **`false`** (Leaf ist nicht direkt von der Root signiert), und
  `verifyPeerCert(intermediatePem, leafPem)` prüft nur **eine** Stufe — nie bis zur Root, nie den
  `pathLen`. **→ D2 (`pathLen 0`) ist auf diesem Pfad tatsächlich kosmetisch**, und die Retention-/Pin-Logik
  bräuchte Chain-Bewusstsein, sobald ein Intermediate zwischen Root und Leaf tritt.

### A.2 Transport-mTLS (`agent-card.ts:225-231`) — Node/OpenSSL, **würde** prüfen, aber ungetestet für 2 Stufen
```ts
serverOpts['https'] = {
  key, cert, ca: trustedCa,        // trustedCaBundle ODER opts.tls.caCertPem
  requestCert: true,               // mTLS
  rejectUnauthorized: true,        // Client-Cert gegen ca validieren
};
```
- Hier verifiziert **Node/OpenSSL** das Client-Cert gegen `ca`. OpenSSL **enforced** bei der Kettenprüfung
  standardmäßig `basicConstraints`/`pathLen`. **Aber:** `trustedCa` ist heute ein **flaches, einstufiges**
  ca-Bundle — die eigene Mesh-CA **plus** gepairte Peer-CAs (`trustedCaBundle`, `agent-card.ts:221-224`, Fallback
  einzelne `caCertPem`), **jede** via `createMeshCA` (`tls.ts:59`) self-signed, **kein Intermediate**. Ob eine
  echte zwei-stufige Kette (Peer präsentiert Leaf+Intermediate, Trust-Anker = Root) hier korrekt gebaut/enforced
  wird, ist **im Repo nicht bewiesen** — es gibt keinen Test, der einen `pathLen`-Verstoß auf dieser Ebene
  ablehnt (die mTLS-Tests `mtls-issuer-fingerprint.test.ts`/`mesh-connect.test.ts` fahren nur eine einstufige CA).

### A.3 Verdikt A
- **pathLen-Enforcement ist NICHT garantiert.** Auf der App-Ebene (`verifyPeerCert`) **fehlt** Chain/pathLen
  vollständig; auf der Transport-Ebene **existiert** es (Node-TLS), ist aber an eine **einstufige** ca-Bundle-
  Verdrahtung gebunden und für zwei Stufen **ungetestet**.
- **ADR-Konsequenz:** TL-14b muss (a) das ca-Bundle zwei-stufig verdrahten (Root als Anker, Intermediate
  ausgeliefert) **und** (b) den App-Pfad chain-fähig machen ODER dokumentieren, dass Trust-Entscheidungen
  ausschließlich über die Transport-Ebene laufen. **Empfohlener Vor-Slice:** ein Charakterisierungs-Test, der
  heute belegt, dass `verifyPeerCert(root, leaf@intermediate) === false` — macht die Lücke regressionsfest.

---

## Blocker B — Intermediate-Expiry-Monitoring: **fehlt vollständig**

### B.1 Der Monitor sieht nur das Node-Leaf
- `startCertExpiryMonitor` wird mit `getDaysLeft: () => getCertDaysLeft(config.daemon.data_dir)` verdrahtet
  (`index.ts:1613`).
- `getCertDaysLeft` (`tls.ts:708-724`) liest **exakt** `resolve(dataDir, 'tls', 'node.crt.pem')` — das
  **Node-Leaf**, sonst nichts. Die CA (`ca.crt.pem`) wird **nie** auf Ablauf geprüft.
- `classifyCertExpiry`/`runCertExpiryCheck` (`cert-expiry-monitor.ts`) klassifizieren genau diesen einen
  Wert (`ok`/`warn`/`critical`/`unknown`) → Audit `CERT_EXPIRY_WARNING` + `system:cert_expiry`.
- Modul-Doku selbst: „Live-Überwachung des TLS-**Node**-Cert-Ablaufs" und **„ROTIERT NICHT** — Reissue nur
  beim Neustart" (`cert-expiry-monitor.ts:2-15`).

### B.2 Verdikt B
- **Es gibt KEIN _Live_-Intermediate-/CA-Expiry-Monitoring.** Der laufende Monitor sieht die CA nie.
  **Nuance (fairnesshalber):** beim **Start** prüft `loadOrCreateTlsBundle` (`tls.ts:426-451`) das CA-
  Gültigkeitsfenster und reissued eine **abgelaufene eigene** CA (`!caValid → needsCaReissue`) — für einen
  **own-CA-Node** ist die CA-Expiry also beim (Wochen-)Neustart nicht ganz blind. **Echt exponiert bleiben:**
  (a) **token-onboarded Nodes**, die sich **nicht** selbst re-issuen können (die gelieferte CA ist ihr Anker);
  (b) ein **künftiges Intermediate** (D3), für das es **weder** Live-Monitoring **noch** einen Reissue-Pfad
  gibt → dort ist der „lautlose Ausstellungs-Tod" real. Zusätzlich: der Monitor **rotiert nicht**; das
  Node-Leaf wird nur beim **Neustart** neu ausgestellt (Behalten-Gate `daysLeft > renew_before_days`).
- **ADR-Konsequenz:** B ist **Vorbedingung für D3** (lange Intermediate-Laufzeit) — ohne eigenen
  Intermediate-Restlaufzeit-Alarm ist jede Laufzeit > Node-Rhythmus blind. Kleinster Fix-Vorschlag:
  `getCertDaysLeft` auf `ca.crt.pem` (bzw. Intermediate) als **zweite** Quelle erweitern und der Monitor
  klassifiziert beide getrennt (eigener Audit-Sub-Typ oder `subject`-Feld im Detail).

---

## Zusammenfassung (für die ADR)

| Blocker | Befund (code-gegroundet) | Status | ADR-Konsequenz |
|---------|--------------------------|--------|----------------|
| **A** pathLen/Chain | App-`verifyPeerCert` flach (kein Chain/pathLen; `verifyCertificateChain`=0 Treffer); Transport-mTLS würde prüfen, aber einstufig verdrahtet + für 2 Stufen ungetestet | **teils fehlend** | ca-Bundle 2-stufig + App-Pfad chain-fähig **oder** Trust nur via Transport; Charakterisierungs-Test als Vor-Slice |
| **B** Intermediate-Expiry | Live-Monitor liest nur `node.crt.pem` (`getCertDaysLeft`, `index.ts:1613`); CA/Intermediate **live nie** geprüft (nur Start-Reissue für **own-CA**, `tls.ts:426-451`); rotiert nicht | **Live-Monitoring fehlt; Intermediate hätte gar keinen Pfad** | Vorbedingung für D3; `getCertDaysLeft` um CA/Intermediate-Quelle erweitern |

## Abgrenzung
Discovery/Doc only — **kein** Code/Config/Skript geändert, kein Deploy/Secret/Cross-Host. Verifiziert die zwei
Consensus-Auflagen am realen Code als Faktenbasis für die künftige CA-Hierarchie-ADR + die D2/D3-Beschlüsse.
Die vorgeschlagenen Fixes (chain-fähiger Verify, Intermediate-Expiry-Quelle, Charakterisierungs-Test) sind
**eigene Folge-Slices**, hier nicht umgesetzt.
