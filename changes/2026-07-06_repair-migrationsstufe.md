# Re-Pair-Migrationsstufe Legacy→kanonisch (KW28 §2 A / TL-00a, ADR-034)

**Datum:** 2026-07-06 · **Branch:** `claude/kw28-repair-migrationsstufe` (base=main) · **Typ:** Daemon-Code (opt-in).
**Quelle:** WOCHENPLAN-KW28 §2 (Mo), Hermes-Risiko 1; Architektur `architecture-v5.1/03 §3.4`.

## Auftrag (A)

Eine kontrollierte Übergangsfenster-Stufe, die ein Legacy-`host/`-Cert beim Daemon-Start einmal
kanonisch (`node/<PeerID>`) neu signiert — **keine zwei parallelen Identitäten**, kein Torn-Pair, kein
halbes File. Für das `.52`-Re-Enroll (Di) und `.55` (Do). **Kein** Timer/Roll-out/Live-Aktion.

## Lösung

- **`tls.ts`:** opt-in Migrationszweig in `loadOrCreateTlsBundle` (vor den Retain-Gates). Erkennung
  Legacy-`host/`-SAN eines gültigen Own-CA-Certs; re-signiert mit `canonicalSpiffeUri` unter
  **Wiederverwendung des Keypairs** (`createNodeCert(..., existingKeyPem)`) → nur `node.crt.pem` ändert
  sich → **atomarer Einzeldatei-Swap** (tmp+fsync+rename+Dir-fsync); `node.key.pem` unberührt → Paar
  stets konsistent, kein Torn-Read. Advisory O_EXCL-**Lock** (`.migrate.lock`) serialisiert (Stale-Steal,
  idempotenter Re-Check unter Lock). **Fail-closed:** jeder Fehler / Lock nicht erlangbar → Legacy
  unangetastet (nur der finale Rename mutiert `node.crt.pem`); Legacy nach `node.crt.legacy-premigrate.pem`
  archiviert (kein live Cert).
- **`config.ts`:** `cert.migrate_legacy_identity` (**Default `false`**) + Env `TLMCP_CERT_MIGRATE_LEGACY_IDENTITY`.
- **`index.ts`:** Schalter in die ADR-024-Retention-Opts durchgereicht.
- **Design:** `docs/architecture/ADR-034-repair-migrationsstufe.md` (VOR dem Code). Zentrale Wahl:
  **Key-Reuse statt Re-Key** → macht den Swap zum atomaren Einzeldatei-Rename (stärkste Absicherung
  gegen Hermes-Risiko 1). Key-Rotation ist bewusst NICHT Teil der Stufe.

## Tests (`tls.test.ts` +7)

Migration+Key-Reuse+Archiv, Idempotenz (2. Start behält kanonisch), **Regression Schalter-AUS
bitidentisch**, fail-closed bei Backup-Write-Fehler, Lock-busy→skip (fail-closed), Lock-stale→steal→migrate,
bereits-kanonisch→no-op. Full Suite **1450 grün**, tsc 0; eslint keine neuen Probleme.

## Review

Claude adversarial (Fokus „keine zwei Identitäten"/Torn-Pair/Race): **APPROVE**, 0× HIGH/CRITICAL.
Gefixt: LOW-2 (non-EEXIST-Lock-Fehler → fail-closed statt re-key), LOW-1 (Dir-fsync), NIT-1 (tmp-Cleanup)
→ Re-Review **APPROVE**.

## Grenzen

Kein Enddatum-Setzen für Legacy-Akzeptanz, kein `.52`/`.55`-Live-Rollout, kein Timer. Nur Code+Tests+ADR.
Der Schalter wird bewusst erst in Christians Re-Enroll-Fenster aktiviert.
