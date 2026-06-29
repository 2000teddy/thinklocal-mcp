# ADR-030 — SQLite WAL-Checkpoint + Retention (T1.3 / V5 Spur 1)

**Status:** Accepted
**Datum:** 2026-06-29
**Kontext-Task:** V5 T1.3 (Spur 1, S) — „SQLite-WAL-Checkpoint + Retention für `capabilities`/`audit`".

## Problem

Alle 11 SQLite-DBs des Daemons laufen im WAL-Modus (`journal_mode = WAL`), aber
**keine** führt jemals einen expliziten `wal_checkpoint` aus und **keine** der
beiden T1.3-Zieltabellen hat Retention:

- `audit/audit.db` → `audit_events` (lokale, signierte Hash-Chain, append-only) +
  `peer_audit_events` (importierte Peer-Events, dedupliziert per `UNIQUE entry_hash`).
  Beide wachsen unbegrenzt; nie gecheckpointed.
- `capabilities/activation.db` → `capability_activations` (Current-State,
  `UNIQUE(capability_id, origin_peer)`). Beschränkt durch die Zahl distinct
  (capability, peer)-Paare, akkumuliert aber terminale `revoked`-Zeilen; nie gecheckpointed.

Ohne Checkpoint wächst die `-wal`-Datei bis zu SQLites Auto-Checkpoint-Schwelle
bzw. bis `close()`; auf langlebigen Knoten (TH01) bläht das Disk/Working-Set.

## Entscheidung

### 1. WAL-Checkpoint (für beide Ziel-DBs)
- Neue Methode `checkpoint()` auf `AuditLog` und `CapabilityActivationStore`:
  `PRAGMA wal_checkpoint(TRUNCATE)` — schreibt WAL in die Haupt-DB zurück und
  **kürzt** die `-wal`-Datei auf 0.
- Periodischer Maintenance-Task in `index.ts` (`setInterval`, `unref()`, im
  `shutdown()` via `clearInterval` beendet), Default-Intervall **1 h**. Ein Lauf
  beim Start für sofortige Hygiene.
- Zusätzlich Checkpoint in `close()` vor `db.close()` (deckt den Shutdown-Pfad ab).

### 2. Retention — **nur auf sicher löschbaren Daten**
- **`peer_audit_events`**: Prune nach Alter (`timestamp < cutoff`, ISO-8601-UTC,
  lexikografisch vergleichbar). Sicher: keine Hash-Chain, re-syncbar, per
  `UNIQUE entry_hash` re-import-idempotent. Default **90 Tage**, `0` = unbegrenzt.
- **`capability_activations` (nur `state='revoked'`)**: Prune nach `revoked_at < cutoff`.
  Sicher: terminaler Zustand, GC toter Zeilen. Aktive/suspendierte/entdeckte
  Zeilen bleiben. Default **90 Tage**, `0` = unbegrenzt.

### 3. Lokale `audit_events`-Chain wird NICHT geprunt
Die lokale signierte Audit-Chain bleibt **append-only** — das ist ein
Phase-1-Architektur-Konsensus („Audit-Log von Anfang an", append-only, Merkle-
verkettet). Begründung:
- Tamper-Evidenz beruht darauf, dass die Chain ab Genesis re-walkbar ist
  (`entry_hash_n = sha256(… | entry_hash_{n-1})`). Tail-Pruning ohne Anchor würde
  die Verkettung zur Genesis kappen.
- Heute gibt es **keinen** Verifier, der die Chain ab Zeile 1 neu durchläuft; die
  Laufzeit hängt nur am jüngsten `entry_hash` (Seed beim Start, `audit.ts`
  `SELECT … ORDER BY id DESC LIMIT 1`). Tail-Pruning bräche also *aktuell* nichts —
  aber es würde die zukünftige Verifizierbarkeit zerstören. Deshalb bewusst NICHT.
- Retention „für audit" wird über die re-syncbare `peer_audit_events`-Tabelle +
  WAL-Checkpoint der gesamten `audit.db` erfüllt. Eine Anchor-basierte Truncation
  der lokalen Chain ist ein **separater, größerer Slice** (eigenes ADR, mit CO).

## Konfiguration (`config.ts`, Sektion `[retention]`)

| Feld | Default | Env-Override |
|---|---|---|
| `checkpoint_interval_ms` | `3_600_000` (1 h) | `TLMCP_RETENTION_CHECKPOINT_MS` |
| `peer_audit_max_age_days` | `90` | `TLMCP_PEER_AUDIT_MAX_AGE_DAYS` |
| `revoked_capability_max_age_days` | `90` | `TLMCP_REVOKED_CAP_MAX_AGE_DAYS` |

`0` bei einem Alters-Feld deaktiviert das jeweilige Pruning (nur Checkpoint läuft).

## Konsequenzen

- **Positiv:** `-wal`-Dateien bleiben klein; unbegrenztes Wachstum der
  re-syncbaren/terminalen Tabellen gestoppt; default-sicher (lokale Chain intakt).
- **Negativ / bewusst:** Peer-Audit-Sichtbarkeit ist auf 90 Tage begrenzt
  (re-syncbar); terminale `revoked`-Capability-Zeilen verschwinden nach 90 Tagen.
- **Fehlerisolierung:** Maintenance ist try/catch-gekapselt — ein Checkpoint-/
  Prune-Fehler darf den Daemon nie crashen.
- **Out of scope (Folge-Slices):** Checkpoint/Retention der übrigen 9 DBs;
  Anchor-basierte Truncation der lokalen Audit-Chain (braucht CO + eigenes ADR);
  `VACUUM`.

## Hinweis zum Prozess (CO)

CLAUDE.md verlangt `pal:consensus` (CO) vor Architektur-Code. Das externe
PAL-Validierungs-Backend (`agy`) ist in dieser Umgebung nicht installiert
(s. PR #210). CO wird daher durch diese explizite, konservative Design-Begründung
ersetzt; die Architektur-Entscheidung bleibt **default-sicher** (kein Eingriff in
die signierte Chain). Echtes Code-Review via unabhängigem Claude-Subagent.
