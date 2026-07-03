# RE-CHECK-Verdikt — Cert-Auto-Rotation (WOCHENPLAN-KW27 §2, V5 §E.2)

**Datum:** 2026-07-03 · **Prüfer:** Claude (ThinkLocal-Lane) · **Status:** abgeschlossen, belegt.
**Frage (WOCHENPLAN §2 Mo):** Nutzt der scharfe Pfad `cert-rotation.ts` das falsche
`pairing-store.json` oder die korrekte `PairingStore`-Klasse (`pairing/paired-peers.json`)? **Feuert
die Auto-Rotation real?** DoD: reproduzierbarer Test/Dry-Run + schriftliches Verdikt.

## Verdikt (kurz)

1. **`cert-rotation.ts` existiert NICHT** (mehr). Der im Plan vermutete „scharfe Pfad
   `cert-rotation.ts:51` mit `pairing-store.json`" ist **stale/Phantom** — die Datei ist im Repo nicht
   vorhanden, und **kein einziges** Source-File referenziert `pairing-store.json`.
2. **Autoritativer Pairing-Store: `pairing/paired-peers.json`** über die `PairingStore`-Klasse
   (`pairing.ts:81`). Alle Leser (`local-daemon-client.ts:56/131`, `mcp-stdio.ts`, `pairing.ts`) nutzen
   ausschließlich diesen Pfad. Es gibt **keinen** konkurrierenden `pairing-store.json`-Pfad.
3. **Auto-Rotation feuert NICHT auf einem laufenden Daemon.** Der einzige live verdrahtete Cert-Pfad
   ist `startCertExpiryMonitor` (index.ts:1420). Er **klassifiziert + alarmiert** (Log + signiertes
   `CERT_EXPIRY_WARNING`-Audit + EventBus), **rotiert aber nicht** — die `CertExpiryMonitorDeps`
   exponieren *keinerlei* Rotate-/Reissue-Fähigkeit (`getDaysLeft`, `thresholds`, `log`, `audit`,
   `eventBus`). Der **Reissue passiert ausschließlich beim (Neu-)Start** via `loadOrCreateTlsBundle()`
   (Behalten-Gate `daysLeft > 7`). Das ist **bewusstes, dokumentiertes Design** (cert-expiry-monitor.ts:9-13).

**Fazit: „Rotation feuert nicht" — by design, nicht durch einen Pfad-Bug.**

## Reproduzierbarer Dry-Run

```bash
cd packages/daemon && npx vitest run cert-expiry-monitor
```

Belegende Tests (`cert-expiry-monitor.test.ts`):
- **RE-CHECK-Worst-Case (neu):** „abgelaufenes Cert (daysLeft=-1) → NUR Alarm, KEINE In-Process-Rotation".
  Prüft strukturell, dass die Monitor-Deps **keinen** Rotate-Hook haben, und dass selbst ein bereits
  **abgelaufenes** Cert nur einen Alarm (mit Neustart-Hinweis) erzeugt — kein Reissue.
- `critical (3 d)` / `warn (20 d)` / `ok (40 d)` / `unknown (null)`: Tier-Verhalten + Alarm-Semantik.
- `startCertExpiryMonitor`: sofortiger + periodischer Check (läuft live), crash-sicher.

Strukturbeleg (kein Rotate-Pfad):
```bash
test ! -f packages/daemon/src/cert-rotation.ts && echo "cert-rotation.ts: existiert nicht"
grep -rl "pairing-store.json" packages/daemon/src || echo "pairing-store.json: keine Referenz"
```

## Risiko & Empfehlung

- **Ablauf real, aber gemindert:** Node-Cert läuft **2026-09-02** ab (~61 Tage). Da der laufende Daemon
  nicht rotiert, ist die Minderung ein **geplanter Neustart im Fenster 26.08.–01.09.** (bereits als
  separater Auftrag vorgemerkt), der den Reissue über `loadOrCreateTlsBundle` auslöst. Der neue
  Live-Monitor (T2.1, PR #212) garantiert, dass der nahende Ablauf **sichtbar** wird (warn <30 d,
  critical ≤7 d) — kein stiller Tod mehr.
- **T2.1 als „Pfad-Bug-Fix" ist NICHT gerechtfertigt** — es gibt keinen Pfad-Bug (kein
  `cert-rotation.ts`, kein `pairing-store.json`). Der Live-Monitor-Teil von T2.1 ist bereits gebaut/gemerged.
- **Offene Produkt-Entscheidung (Christian, kein Bug):** Ob eine **echte In-Process-Auto-Rotation**
  gewünscht ist (statt Restart-für-Reissue), ist ein **neues Feature**, kein RE-CHECK-Bug. Empfehlung:
  für die Beta genügt der geplante Neustart + der sichtbar-machende Monitor; In-Process-Rotation kann
  später als eigener Slice folgen, falls zero-downtime-Reissue verlangt wird.
