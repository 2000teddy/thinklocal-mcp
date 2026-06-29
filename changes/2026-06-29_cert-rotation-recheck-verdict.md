# RE-CHECK Cert/Rotation — Verdikt (KW27, WOCHENPLAN Z62-66)

**Datum:** 2026-06-29
**Branch:** `claude/cert-rotation-recheck`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Evidence/Verdikt — Test-only, KEINE Produktionscode-Änderung, KEIN Deploy
**Beleg:** `packages/daemon/src/cert-rotation-recheck.test.ts` (4 Tests, reproduzierbar)

## Frage (Dispatch)

Nutzt der scharfe Laufzeitpfad `cert-rotation.ts:51` (`pairing-store.json`) oder die
`PairingStore`/`pairing/paired-peers.json`? Und **feuert die Auto-Rotation real?**

## Verdikt (empirisch, durch Tests festgenagelt)

### 1. Die Dispatch-Prämisse ist seit PR #209 veraltet
`cert-rotation.ts` zeigt **nicht mehr** auf `pairing-store.json`/`certs/node.*`.
PR #209 hat es auf kanonische Pfade migriert (`tls/node.crt.pem`,
`tls/node.key.pem`, `pairing/paired-peers.json`). Die Frage „pairing-store.json
vs paired-peers.json" ist damit gegenstandslos.

### 2. `cert-rotation.ts` ist totes Modul — NICHT der scharfe Pfad
Repo-weit importiert **kein** Produktionscode (daemon/cli) `cert-rotation.ts`.
`rotateCert()` / `needsRotation()` / `auditCerts()` haben **null** Aufrufer außer
ihrem eigenen Test. → Test **RE-CHECK B** (`cert-rotation-recheck.test.ts`) scannt
`packages/daemon/src` + `packages/cli/src` und beweist: 0 Importeure.

### 3. Die reale Cert-Erneuerung = `loadOrCreateTlsBundle()` (tls.ts), beim START
Der einzige reale Renewal-Pfad ist `loadOrCreateTlsBundle()`. Beim Daemon-Start:
- Node-Cert wird **behalten**, wenn `fullyValid && daysLeft > 7 &&
  certSpiffeUri === spiffeUri && signedByCurrentCa && certKeyMatches`
  (tls.ts:360) — oder über den ADR-024-Canonical-Attested-Pfad (tls.ts:375).
- **Sonst → REISSUE** (frisches Cert, ~90 Tage).

→ Test **RE-CHECK A** beweist beide Äste deterministisch:
- 30-Tage-Cert → behalten (kein vorzeitiges Rotieren).
- 3-Tage-Cert (≤7) → **Reissue beim Load** (Rotation feuert). Empirisch
  guard-bewiesen: Gate `daysLeft > 7` → `> 0` mutiert ⇒ Test rot; restauriert ⇒ grün.

### 4. KEINE Auto-Rotation auf einem laufenden Daemon
Es gibt **keinen** Timer/Scheduler, der ein Cert im laufenden Prozess erneuert
(code-seitig verifiziert: der einzige `setInterval` im Daemon ist der SQLite-
Maintenance-Task; `loadOrCreateTlsBundle` wird genau **einmal** in `index.ts main()`
aufgerufen, nicht periodisch). Erneuerung passiert **ausschließlich beim (Neu-)Start**.
`getCertDaysLeft()` beim Start ist nur eine einmalige Warnung, kein Renewal.
Zusatzbefund (verstärkt das Verdikt): `recovery.ts::checkCertExpiry` ist ebenfalls
**unverdrahtet** und stellt ohnehin **nichts neu aus** — es liefert nur einen Status.

## Konsequenz / Empfehlung

**Der Cert-Ablauf (z.B. 2026-09-02) IST ein reales Risiko** für jeden Daemon, der
über das Ablaufdatum hinaus **durchläuft, ohne neu zu starten**: das Node-Cert
läuft ab, Peers lehnen den Handshake ab — und nichts erneuert es im Prozess.

→ **T2.1 ist gerechtfertigt** (Bug bestätigt im Sinne der Wochenplan-Verzweigung
„Wenn Mo-RE-CHECK den Bug bestätigt → T2.1"). Kleinster nächster Slice:
1. Periodischer Check im Daemon-Main-Loop: `getCertDaysLeft()` gegen Schwellwert.
2. Bei `< 30 Tage`: **Alert** (Telegram/Hermes, vgl. T2.3-Sink) — kein stiller Ablauf.
3. Bei `≤ 7 Tage`: kontrollierter Reissue **+ TLS-Kontext-Hot-Reload** ODER
   getriggerter, dokumentierter Neustart (Hot-Reload ist der größere Teil → eigenes ADR).
4. Optional: totes `cert-rotation.ts` entweder an diesen Pfad anschließen oder
   als Legacy deprecaten/entfernen (separater Aufräum-Slice).

## Was dieser Slice NICHT tut

Keine Produktionscode-Änderung, kein Deploy. Nur das Verdikt + ein reproduzierbarer
Test, der den Ist-Zustand (Rotation feuert nur beim Start; `cert-rotation.ts`
ungenutzt) gegen Regression festnagelt. Der Fix ist T2.1.
