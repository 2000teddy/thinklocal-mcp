# Cert-Reissue-Schwelle 30 Tage + konfigurierbar (Wochen-Neustart-Rhythmus)

**Datum:** 2026-07-04
**Branch:** `claude/cert-renew-threshold-config` (base=main)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Daemon-Code (TLS) — **Deploy/Timer folgt getrennt (Admin/Orchestrator-Lane)**
**Quelle:** `~/hermes/reference/2026-07-04_Auftrag-Wochen-Neustart-Rhythmus.md` (Christian-Freigabe 04.07. „1 ja"),
Design Kap. 13.4 / 3.8-Punkt 7.

## Auftrag (nur Punkt 1, Daemon-Code)

Zertifikats-Neuausstellung beim Daemon-Start schon bei **≤ 30 Tagen** Restlaufzeit (statt ≤ 7), und die
Schwelle als **Konfiguration** statt hart im Code. Tests Pflicht. **Kein** Timer-/Betriebs-/Deploy-Bau.

## Änderung

- **`tls.ts`:** neue Konstante `DEFAULT_CERT_RENEW_BEFORE_DAYS = 30`; `loadOrCreateTlsBundle` erhält
  `renewBeforeDays`; beide Behalten-Gates (legacy-current-ca + canonical-attested/ADR-024) nutzen
  `daysLeft > renewBeforeDays` statt hart `> 7`. `NODE_CERT_VALIDITY_DAYS` exportiert (für die Config-
  Validierung). Token-onboardete Nodes (kein CA-Key → kein Self-Reissue) sind bewusst ausgenommen — Kommentar.
- **`config.ts`:** `cert.renew_before_days` (Default 30), Env `TLMCP_CERT_RENEW_BEFORE_DAYS`.
  **Post-Merge-Validierung** (auch TOML): Ganzzahl in `[1, NODE_CERT_VALIDITY_DAYS-1]` — 0/negativ =
  fail-open (Behalten bei Ablauf), `≥ 90` = Reissue-Schleife bei jedem Start.
- **`index.ts`:** reicht `config.cert.renew_before_days` durch.
- **`cert-expiry-monitor.ts`:** Reissue-Hinweistexte auf die konfigurierbare Schwelle (Default 30) angeglichen.

## Config-Keys

| Key | Default | Env | Bedeutung |
|---|---|---|---|
| `cert.renew_before_days` | `30` | `TLMCP_CERT_RENEW_BEFORE_DAYS` | Reissue beim Start bei `daysLeft <= N`; gültig `[1, 89]`. |

## Tests

- `tls.test.ts` (+4): ≤30 → Reissue, >30 → Behalten, Non-Regression (`renewBeforeDays=7` behält 20-d-Cert),
  exakte `daysLeft == renewBeforeDays`-Grenze (via +12h-Mint, echt `10 > 10`).
- `cert-expiry-monitor.test.ts`: Default 30, Env-Override, Reject 0/≥90, **echtes TOML-0-Reject**.
- `cert-rotation-recheck.test.ts`: Retain-Fixtures 30→60 d + Schwelle-Referenzen an Default 30 angepasst.
- Full Suite **1443 grün**, tsc 0.

## Review

Claude adversarial: Erst-Review **REQUEST-CHANGES** (MED: TOML-fail-open + Boundary-false-green; LOW:
Upper-Bound-Loop + token-onboarded-Doc) → **alle gefixt + Tests** → Re-Review **APPROVE**, nicht-tautologisch.

## Getrennt / nicht in diesem Slice

Rollierender Nacht-Neustart, systemd/macOS-Timer, Ankündigung, Neustart-Wächter, Deploy — **Admin/
Orchestrator-Lane** (Auftrag Punkte 2–4). Erwartetes Nebenergebnis: Certs erneuern sich beim ohnehin
wöchentlichen Neustart Anfang August selbst → Sonderfenster 26.08.–01.09. entfällt dann.
