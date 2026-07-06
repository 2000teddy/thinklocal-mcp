# Konfig-Doku: #242 renew_before_days (KW28 §2 B, doc-only)

**Datum:** 2026-07-06 · **Branch:** `claude/kw28-renew-before-days-doc` (base=main) · **Typ:** Doc-only.

## Kontext

`cert.renew_before_days` (TOML) + `TLMCP_CERT_RENEW_BEFORE_DAYS` (Env) sind seit v0.34.68 / PR #242 in
main, waren aber in der Anwender-Doku nicht auffindbar. KW28 §2 (B) zieht das nach.

## Änderung (`docs/USER-GUIDE.md`, §4 Konfiguration)

- `[cert] renew_before_days = 30` im `daemon.toml`-Beispiel ergänzt.
- Env-Tabelle: Zeile `TLMCP_CERT_RENEW_BEFORE_DAYS` (Default 30, `[1, 89]`).
- Neue Sektion „Zertifikats-Erneuerung (`[cert]`)": Key/Env/Default/Range/Bedeutung + **Erklärung, warum
  der Wertebereich streng ist** (0/negativ = fail-open bei Ablauf; ≥ 90 = Reissue-Schleife bei jedem
  Start), Verweis auf Wochen-Neustart-Rhythmus (Kap. 13.4), ADR-024, CHANGES v0.34.68; Hinweis auf
  Ausnahme token-onboardeter Nodes.

**Keine Code-Änderung** an `config.ts`/`tls.ts` — der Validator wird nur *erklärt*, nicht geändert.
