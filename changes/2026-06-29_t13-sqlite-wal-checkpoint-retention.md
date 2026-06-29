# T1.3 — SQLite WAL-Checkpoint + Retention (V5 Spur 1)

**Datum:** 2026-06-29
**Branch:** `claude/t13-sqlite-wal-checkpoint`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Operational-Hygiene — kein Protokoll-Change, kein Deploy
**Design:** `docs/architecture/ADR-030-sqlite-wal-checkpoint-retention.md`
**V5-Bezug:** T1.3 (Spur 1, S).

## Problem

Alle SQLite-DBs des Daemons laufen im WAL-Modus, aber **keine** führt je einen
`wal_checkpoint` aus → die `-wal`-Dateien wachsen unbegrenzt. Zusätzlich haben
weder `audit.db` noch `capabilities/activation.db` Retention.

## Lösung (ADR-030)

- **WAL-Checkpoint** (`PRAGMA wal_checkpoint(TRUNCATE)`) für `audit.db` +
  `activation.db`: periodischer Maintenance-Task in `index.ts`
  (`setInterval`, `unref()`, im `shutdown()` via `clearInterval` beendet,
  1× beim Start), plus explizit in jedem `close()`.
- **Retention nur auf sicher löschbaren Daten:**
  - `peer_audit_events` nach Alter (Default 90 Tage) — re-syncbar, keine Chain.
  - `capability_activations` mit `state='revoked'` nach Alter (Default 90 Tage) — GC toter Zeilen.
- **Lokale signierte `audit_events`-Chain wird NICHT geprunt** (append-only,
  Phase-1-Konsensus). Begründung + Tamper-Evidenz-Argument in ADR-030 §3.
- **Fehlerisolierung:** Maintenance ist vollständig try/catch-gekapselt — ein
  Checkpoint-/Prune-Fehler crasht den Daemon nie. `busy`-Checkpoints werden auf
  `debug` sichtbar gemacht (kein stiller Fehler).

## Konfiguration (`config.ts`, `[retention]`)

| Feld | Default | Env |
|---|---|---|
| `checkpoint_interval_ms` | 3 600 000 (1 h) | `TLMCP_RETENTION_CHECKPOINT_MS` (>0) |
| `peer_audit_max_age_days` | 90 | `TLMCP_PEER_AUDIT_MAX_AGE_DAYS` (≥0, 0=aus) |
| `revoked_capability_max_age_days` | 90 | `TLMCP_REVOKED_CAP_MAX_AGE_DAYS` (≥0, 0=aus) |

## Dateien

- `packages/daemon/src/audit.ts`: `checkpoint()`, `prunePeerEventsOlderThan()`, Checkpoint in `close()`.
- `packages/daemon/src/capability-activation.ts`: `checkpoint()`, `pruneRevokedOlderThan()`, Checkpoint in `close()`.
- `packages/daemon/src/config.ts`: `[retention]`-Sektion + `readNonNegativeInt`-Helper.
- `packages/daemon/src/index.ts`: periodischer `runStorageMaintenance`-Task + Shutdown-Cleanup.
- `packages/daemon/src/retention.test.ts` (neu): 10 Tests.
- `docs/architecture/ADR-030-*.md` (neu): Design + Rationale.

## Tests

- **Neu:** `retention.test.ts` — 10 Tests: checkpoint (busy===0), peer-Retention (alt weg/neu bleibt),
  **lokale Chain unangetastet**, `0`=No-Op; revoked-Retention (alt weg, aktiv/neu bleibt), `0`=No-Op;
  config-Defaults + Env-Overrides (inkl. `0`) + Validierung (negativ/`0`-Intervall werfen).
- **Empirisch guard-bewiesen:** Cutoff `<` → `>` invertiert ⇒ 1 rot; restauriert ⇒ 10 grün.
- Volle Daemon-Suite **99 Files / 1195 grün**; `tsc --noEmit` 0.

## Review

- Unabhängiger **Claude**-Subagent-Review auf den Diff: **APPROVE-WITH-NITS**, kein
  Correctness-Bug. Beide Low-Nits (busy-Result verschluckt; checkpoint-Test schwach)
  direkt adressiert: `busy` wird jetzt geloggt, Tests asserten `busy===0`.
  (`pal:codereview`/`consensus` externes Backend `agy` im Env nicht installiert,
  daher Claude-Subagent als echtes Review — nur claude/codex/agy.)

## Out of scope (Folge-Slices)

Checkpoint/Retention der übrigen 9 DBs; Anchor-basierte Truncation der lokalen
Audit-Chain (braucht CO + eigenes ADR); `VACUUM`.
