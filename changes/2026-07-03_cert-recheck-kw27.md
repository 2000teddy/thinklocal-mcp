# Cert-Auto-Rotation RE-CHECK (WOCHENPLAN-KW27 §2, V5 §E.2)

**Datum:** 2026-07-03
**Branch:** `claude/cert-recheck-kw27` (base=main)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** RE-CHECK-Verdikt + reproduzierbarer Test — **repo-only, kein Deploy, kein Code-Fix**

## Auftrag

WOCHENPLAN §2 Mo (vor T2.1): reproduzierbar belegen, ob die Cert-Auto-Rotation auf einem laufenden
Daemon feuert und welcher Pairing-Store-Pfad autoritativ ist (`cert-rotation.ts` / `pairing-store.json`
vs. `PairingStore` / `pairing/paired-peers.json`). DoD: Test/Dry-Run + schriftliches Verdikt.

## Ergebnis (Verdikt)

1. **`cert-rotation.ts` existiert nicht** — der Plan-Verdacht ist stale/Phantom.
2. **Kein `pairing-store.json`-Ref** im Source; autoritativ ist `pairing/paired-peers.json` (`PairingStore`,
   `pairing.ts:81`).
3. **Auto-Rotation feuert NICHT live.** Einziger verdrahteter Pfad: `startCertExpiryMonitor` (index.ts:1420)
   — klassifiziert + alarmiert (Audit `CERT_EXPIRY_WARNING` + EventBus), **kein Rotate-Hook** in
   `CertExpiryMonitorDeps`. Reissue startup-only via `loadOrCreateTlsBundle` (Gate `daysLeft>7`). **By design.**

## Artefakte

- **Verdikt:** `docs/RECHECK-cert-rotation-2026-07-03.md` (Evidenz, Reproduce-Kommandos, Empfehlung).
- **Dry-Run-Test:** `cert-expiry-monitor.test.ts` — „abgelaufenes Cert (daysLeft=-1) → NUR Alarm, KEINE
  In-Process-Rotation" (struktureller Beweis: Deps-Key-Set ohne Rotate-Hook). `npx vitest run cert-expiry-monitor`.

## Empfehlung

T2.1 als „Pfad-Bug-Fix" **nicht gerechtfertigt** (kein Bug). Der 2026-09-02-Ablauf (~61 Tage) ist durch
den bereits vorgemerkten Neustart (Fenster 26.08.–01.09.) gemindert; der Live-Monitor macht den Ablauf
sichtbar. Echte In-Process-Auto-Rotation = optionales Feature (Christian-Entscheidung), kein RE-CHECK-Bug.

## Review

Unabhängiger Claude-Subagent: alle 4 Verdikt-Claims **VERIFIED** gegen den Code, Test nicht-tautologisch,
0 Overclaims.
