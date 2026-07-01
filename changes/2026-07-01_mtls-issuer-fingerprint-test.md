# 127c — Dedizierter mTLS-Integrationstest: Issuer-Fingerprint-Invariante

**Datum:** 2026-07-01
**Branch:** `claude/mtls-issuer-fingerprint-test`
**Typ:** Pure-Test (kein Runtime-Change, kein Deploy, kein Gate) · TODO.md #127(c) · ADR-022
**V5-Bezug:** ThinkLocal-Lane Härtung (mTLS/Zero-Trust), Fortsetzung von #225 (127b).

## Ziel

TODO #127(c): den bisher nur **live bewiesenen** (aber nicht automatisiert getesteten) mTLS-Fakt
`issuerCertificate.fingerprint256 === certFingerprint(ca.crt.pem)` mit einem dedizierten
Integrationstest festnageln.

## Warum das nicht trivial ist

Die gesamte ADR-022-PeerID-Attestierung (`agent-card.ts` → `attestedPeerIdFromCert`) verlässt sich
auf die Invariante: der aus der eigenen Mesh-CA **abgeleitete** Attesting-Pin
(`resolveAttestingCaFingerprints(undefined, caCertPem)` → `certFingerprint(caCertPem)`) ist derselbe
Wert wie der im mTLS-Handshake **beobachtete** `issuerCertificate.fingerprint256` des Peers.

Node liefert `fingerprint256` als **Uppercase-Colon-Hex** (`AB:CD:…`), `certFingerprint` als
**lowercase-no-colon-hex**. Die Produktion rekonziliert beide Formate via `normalizeFingerprint`
(`peer-identity.ts` / `cert-pop.ts`). Bricht diese Rekonziliation — oder die „Single-Mesh-CA +
direkte Issuance ⇒ derived == wire"-Annahme — schlägt die PeerID-Attestierung **still** fehl
(kanonische Sender würden 403en). Die bestehenden Unit-Tests decken das nur mit **synthetischen**
Fingerprints ab; ein echter Handshake fehlte.

## Test (`packages/daemon/src/mtls-issuer-fingerprint.test.ts`, neu)

Echter mTLS-Handshake via `node:tls` (Server `requestCert+rejectUnauthorized`, Client präsentiert
Cert; Chain-Validierung scharf, nur der Hostname-Check ist als nicht-Testgegenstand deaktiviert).
Beide Seiten lesen `getPeerCertificate(true)` — exakt die Wire-Felder, die `agent-card.ts` in
Produktion nutzt. Assertions exerzieren den **Produktionspfad**, nicht nur eine Nachrechnung:

1. Beide Seiten `authorized === true` (reale Chain gegen die Mesh-CA).
2. abgeleiteter Pin == `certFingerprint(ca.crt.pem)`, `source='derived'`.
3. Wire-`issuerCertificate.fingerprint256` normalisiert == `certFingerprint(ca.crt.pem)` (beide Seiten).
4. `isAttestingIssuer(Wire-Issuer, derived-Pin) === true` (exakter Produktionsvergleich).
5. End-to-End: `attestedPeerIdFromCert(Wire-SAN, Wire-Issuer, derived-Pin)` === Client-PeerID.
6. Negativkontrolle: eine **fremde** CA attestiert den Wire-Issuer **nicht** → `isAttestingIssuer=false`
   und `attestedPeerIdFromCert=null` (Pin diskriminiert, kein vacuously-true).

Der Test liegt in `packages/daemon/src/` (nicht `tests/integration/`), weil der CI-Daemon-Job nur
`packages/daemon` testet — nur so gatet der Test die PR.

**Ergebnis:** neue Datei **6/6** grün · volle Daemon-Suite **105 Files / 1293 grün** · `tsc` 0 ·
`eslint` (neue Datei) 0 · `npm run build` grün. Keine Runtime-Datei berührt.

## Compliance (CO/CG/TS/CR/PC/DO)

| CO | CG | TS | CR | PC | DO |
|----|----|----|----|----|----|
| n/a | n/a | ✅ (der Slice IST der Test) | ✅ Claude-Test-Review | ✅ manuell (tsc/build/suite/lint/diff) | ✅ changes + CHANGES + COMPLIANCE + TODO |

Kein Deploy, kein systemd, kein Live-Gerät, kein Christian-Gate.
