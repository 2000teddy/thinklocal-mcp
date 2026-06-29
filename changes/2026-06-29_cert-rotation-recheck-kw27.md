# 2026-06-29 — Cert-Rotation Re-Check (KW27)

## Verdict

**RE-CHECK abgeschlossen, kein Runtime-Fix in diesem Slice.**

Der aktuelle Daemon-Startpfad nutzt **nicht** `cert-rotation.ts` fuer eine
periodische/aktive Rotation. Beim Start wird das TLS-Bundle ueber
`loadOrCreateTlsBundle()` geladen; dort wird ein bestehendes Leaf-Cert nur
behalten, wenn es noch mehr als 7 Tage gueltig ist und die Safety-Checks
besteht. Ein bald ablaufendes Cert wird also **beim naechsten TLS-Bundle-Load**
regeneriert.

`cert-rotation.ts` und `recovery.ts` enthalten dagegen weiterhin alte
Legacy-Pfade:

- `packages/daemon/src/cert-rotation.ts:48-50` loescht
  `dataDir/certs/node.crt` und `dataDir/certs/node.key`.
- `packages/daemon/src/cert-rotation.ts:79-80` loescht
  `dataDir/pairing-store.json`.
- `packages/daemon/src/recovery.ts:67-69` loescht ebenfalls
  `dataDir/certs/node.crt` und `dataDir/certs/node.key`.

Die aktuellen Runtime-Pfade sind:

- TLS: `dataDir/tls/node.crt.pem` und `dataDir/tls/node.key.pem`
  (`packages/daemon/src/tls.ts:406-407`, `getCertDaysLeft()` liest
  `tls/node.crt.pem` bei `packages/daemon/src/tls.ts:417-423`).
- Pairing: `dataDir/pairing/paired-peers.json`
  (`packages/daemon/src/pairing.ts:79-82`).

## Runtime-Verdrahtung

`rg`-Beleg:

```text
packages/daemon/src/index.ts:7 imports loadOrCreateTlsBundle/getCertDaysLeft from ./tls.js
packages/daemon/src/index.ts:28 imports PairingStore from ./pairing.js
packages/daemon/src/index.ts:120 const pairingStore = new PairingStore(...)
packages/daemon/src/index.ts:153 tlsBundle = loadOrCreateTlsBundle(...)
packages/daemon/src/index.ts:1268 const certDaysLeft = getCertDaysLeft(...)
packages/daemon/src/cert-rotation.ts exports needsRotation/rotateCert/trustReset/auditCerts
```

Es gibt keinen Import von `cert-rotation.ts` im Daemon-Startpfad. Die
Startwarnung nutzt nur `getCertDaysLeft()`; sie rotiert nicht selbst.

## Reproduzierbarer Dry-Run

Arbeitsverzeichnis: `/opt/thinklocal-mcp/packages/daemon`.

Kurzfassung des ausgefuehrten Dry-Runs:

1. Temp-`dataDir` angelegt.
2. `loadOrCreateTlsBundle()` erzeugt aktuelle Dateien unter `tls/`.
3. `PairingStore` schreibt `pairing/paired-peers.json`.
4. Das aktuelle `tls/node.crt.pem` wurde durch ein 3-Tage-Cert ersetzt.
5. `needsRotation(dataDir, 7)`, `rotateCert(dataDir)`, `trustReset(dataDir)`
   wurden ausgefuehrt.
6. Danach wurde `loadOrCreateTlsBundle()` erneut ausgefuehrt.

Auszug:

```text
CURRENT_TLS_CERT_EXISTS true
CURRENT_TLS_KEY_EXISTS true
CURRENT_PAIRING_EXISTS true
LEGACY_CERT_PATH_EXISTS false
LEGACY_PAIRING_STORE_EXISTS false
DAYS_LEFT_BEFORE 2
NEEDS_ROTATION_MODULE true
ROTATE_CERT_RESULT true
TLS_CERT_EXISTS_AFTER_ROTATECERT true
PAIRING_EXISTS_AFTER_ROTATECERT true
TRUST_RESET_RESULT {"certsRemoved":0,"pairingReset":false}
PAIRING_EXISTS_AFTER_TRUSTRESET true
STARTUP_TLS_REGENERATED true
DAYS_LEFT_AFTER_STARTUP_LOAD 89
STARTUP_CERT_SPIFFE spiffe://thinklocal/host/dryrun/agent/daemon
STARTUP_CERT_VERIFIES_WITH_CA true
```

Interpretation:

- `needsRotation()` ist durch `getCertDaysLeft()` auf den aktuellen
  `tls/node.crt.pem`-Pfad korrekt sensitiv.
- `rotateCert()` meldet `true`, loescht aber keine aktuellen TLS-Dateien,
  weil es nur Legacy-`certs/node.crt`/`certs/node.key` trifft.
- `trustReset()` meldet `certsRemoved:0,pairingReset:false` und laesst
  `pairing/paired-peers.json` bestehen, weil es nur `pairing-store.json` sucht.
- Die echte Cert-Erneuerung passiert beim erneuten `loadOrCreateTlsBundle()`;
  das 3-Tage-Cert wurde durch ein neues ca. 90-Tage-Cert ersetzt.

## Kleinster naechster Slice

**Fix-Slice:** `cert-rotation.ts` und `recovery.ts` entweder:

1. auf die aktuellen Pfade `tls/node.crt.pem`, `tls/node.key.pem` und
   `pairing/paired-peers.json` migrieren, inklusive Tests fuer `rotateCert()`,
   `trustReset()` und `runRecoveryChecks()`, oder
2. als tote/irrefuehrende Recovery-Pfade entfernen/deprecaten, wenn Rotation
   offiziell ausschliesslich beim Startup ueber `loadOrCreateTlsBundle()`
   passieren soll.

Empfehlung: Option 1 nur dann, wenn wirklich ein operator- oder
runtime-ausloesbarer Reset/Rotation-Pfad gebraucht wird. Andernfalls Option 2,
damit kein scheinbar erfolgreicher `rotateCert()`-Aufruf alte Pfade trifft und
einen falschen Sicherheitszustand suggeriert.

## Tests/Checks in diesem Slice

- `rg -n "cert-rotation|needsRotation|rotateCert|trustReset|PairingStore|paired-peers|pairing-store|loadOrCreateTlsBundle|getCertDaysLeft" ...`
- `npx tsx --eval "<dry-run script>"` aus `packages/daemon`
- geplante Repo-Verifikation: `npm run build` und `npm test` in
  `packages/daemon`
