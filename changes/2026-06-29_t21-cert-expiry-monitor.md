# T2.1 — Live-Cert-Ablauf-Monitor + <30d-Alert (V5 Spur 2)

**Datum:** 2026-06-29
**Branch:** `claude/t21-cert-expiry-monitor`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Observability) — KEINE Cert-Rotation, KEIN Deploy
**Design-Basis:** RE-CHECK-Verdikt (PR #212, `changes/2026-06-29_cert-rotation-recheck-verdict.md`)

## Problem (im RE-CHECK belegt)

Der TLS-Node-Cert-Ablauf wurde **nur einmal beim Start** geprüft. Ein
langlebiger Daemon, der über das Ablaufdatum hinaus läuft, bekam **keinen
Alarm** — und da die Erneuerung (`loadOrCreateTlsBundle`) ohnehin nur beim
(Neu-)Start passiert, lief das Cert still ab (2026-09-02-Risiko).

## Lösung (T2.1 — alarmieren, NICHT rotieren)

Neuer **periodischer** Cert-Ablauf-Monitor:
- **`cert-expiry-monitor.ts`** (neu):
  - `classifyCertExpiry(daysLeft, {warnDays, criticalDays})` → `ok | warn | critical | unknown` (reine Funktion).
  - `runCertExpiryCheck(deps)` → klassifiziert, loggt, und alarmiert **nur bei warn/critical** über ein **signiertes Audit-Event** `CERT_EXPIRY_WARNING` + EventBus `system:cert_expiry`. Der Alert-Detail macht **explizit**, dass Reissue erst beim **Neustart** passiert (RE-CHECK-Verdikt).
  - `startCertExpiryMonitor(deps, intervalMs)` → sofortiger Check + `setInterval` (`unref()`, try/catch — Check-Fehler crasht den Daemon nie).
- **`index.ts`**: der bisherige **einmalige** Startup-Check ist durch den periodischen Monitor ersetzt; Timer wird im `shutdown()` via `clearInterval` gestoppt.
- **`audit.ts`**: neuer Event-Typ `CERT_EXPIRY_WARNING`. **`events.ts`**: `system:cert_expiry`.
- **`config.ts`**: `[cert]`-Sektion (`expiry_warn_days`=30, `expiry_critical_days`=7, `expiry_check_interval_ms`=12 h) + Env-Overrides; **Fail-fast**, wenn `warn <= critical` (sonst warn-Tier unerreichbar).

## Reissue-Verhalten (explizit, getestet)

Der Monitor **rotiert nicht**. Reissue passiert unverändert beim (Neu-)Start via
`loadOrCreateTlsBundle` (Behalten-Gate `daysLeft > 7`). Die `critical`-Schwelle (7)
ist bewusst auf dieses Gate ausgerichtet: sobald `daysLeft <= 7`, würde ein
Neustart das Cert neu ausstellen — genau das sagt der Alert dem Operator.

## Alert-Sink — Scope-Grenze (ehrlich)

T2.1 liefert den **durablen** Sink: signiertes Audit-Event + EventBus-Emit + Log.
Die **Human-Push-Zustellung** (Telegram/Hermes bzw. Dashboard-Toast) ist bewusst
**NICHT** Teil dieses Slices — das ist exakt **T2.2** („echter Alert-Sink
Hermes/Telegram") + **T2.3** („Alert verdrahten"). `system:cert_expiry` ist als
Event bereit; das Andocken an den Push-Sink erfolgt dort. (CR-MEDIUM bewusst als
Scope-Grenze gesetzt, nicht ignoriert.)

## Tests

`cert-expiry-monitor.test.ts` (neu, **17 Tests**): classify-Grenzen (null→unknown,
30→warn, 7→critical, abgelaufen→critical), runCheck-Gating (Audit/Emit nur bei
warn/critical; Detail nennt „Neustart"), periodischer Re-Check via Fake-Timer
(T2.1-Kern), Crash-Sicherheit, config-Defaults/Env/Validierung (inkl. warn<=critical
→ throw). Empirisch guard-bewiesen: critical-Grenze `<=`→`<` mutiert ⇒ 1 rot,
restauriert ⇒ grün. Volle Suite **101 Files / 1216 grün**, tsc 0, eslint 0.

## Review

Unabhängiger **Claude**-Subagent: **APPROVE-WITH-NITS**, kein High/Critical-Bug.
CR-LOW (warn>critical-Validierung) **gefixt** + getestet; CR-MEDIUM (Push-Sink) als
T2.2/T2.3-Scope-Grenze dokumentiert. (`pal`-externes `agy`-Backend im Env nicht
installiert → Claude-Subagent als echtes Review.)

## Out of scope / Folge

- **T2.2/T2.3:** `system:cert_expiry` an Telegram/Hermes + Dashboard-Toast andocken.
- In-Process-Reissue + TLS-Hot-Reload (größerer Slice, eigenes ADR).
- Totes `cert-rotation.ts` deprecaten/anschließen.
