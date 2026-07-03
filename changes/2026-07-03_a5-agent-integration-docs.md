# A5 — Agent-Integration-Kapitel + konfigurierbare Poll-Intervalle

**Datum:** 2026-07-03
**Branch:** `claude/a5-agent-integration-docs` (base=main)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Docs + Config (Adoptions-Slice) — **repo-only, kein Deploy/Device/systemd**
**Bezug:** Christians A5-Freigabe (2026-07-03), ADR-004 (Empfangs-Loop). Meanwhile-Block, während der
Zwei-Rechner-Beweis auf ein Christian-gated Re-Pairing wartet.

## Kontext

A5 (Adoptions-Doku) war freigegeben und als ungateter Repo-Meanwhile-Block eingeplant. Ziel: einen
Außenstehenden befähigen, mit README+INSTALL+Agent-Integration ein eigenes 2-Node-Mesh mit einem
sprechenden Agenten aufzusetzen — plus zwei von Christian benannte Punkte: **Token-Ökonomie** des
Inbox-Polls explizit dokumentieren und **Poll-Intervalle per Env** konfigurierbar machen, sauber
abgegrenzt von `TLMCP_HEARTBEAT_MS`.

## Lösung

**Config (`agent-poll-config.ts`, neu, rein):** `resolveAgentPollConfig(env, mode)` →
`{initialMs, maxMs}` aus `TLMCP_AGENT_POLL_INITIAL_MS` / `TLMCP_AGENT_POLL_MAX_MS`, Mode-Defaults
(lan 5s→30s, local 2s→15s), fail-safe (ungültig/≤0 → Default), Invariante `maxMs ≥ initialMs`. Der
Modul-Header grenzt es explizit vom Daemon-Peer-Heartbeat (`TLMCP_HEARTBEAT_MS` →
`mesh.heartbeat_interval_ms`) ab.

**Poller (`inbox-poller.ts`):** neuer `createAdaptiveInboxPoller` — self-scheduling `setTimeout` mit
exponentiellem Leerlauf-Backoff (leerer Zyklus → Delay ×2 bis `maxMs`; Verkehr `total>0` → Reset auf
`initialMs`; Fetch-Fehler → Backoff, nie schneller). Nicht-überlappend (inFlight-Guard), `unref`,
`stop()`-Drain ohne Reschedule. `createDaemonInboxPoller` nutzt ihn (`intervalMs` → `poll:AgentPollConfig`).
Der alte fixe `createInboxPoller` bleibt unverändert.

**Doku:** `docs/AGENT-INTEGRATION.md` (neu) — die drei Bausteine (MCP-Anbindung via `mcp-stdio`+Env,
Instanz-Registrierung, Empfangs-Loop), `node/<PeerID>`-Adressierung, das nachbaubare Loop-Muster,
**§4.1 Token-Ökonomie** (Poll läuft außerhalb des LLM → 0 Tokens im Leerlauf; Tokens nur bei echter
Zustellung) und **§4.2** die Poll-Env-Tabelle + eine Vergleichstabelle gegen `TLMCP_HEARTBEAT_MS`.
README (Quick Start) und INSTALL.md (nach Claude-Code-Integration) verweisen als durchgehender
Onboarding-Rotfaden darauf.

## Nicht enthalten (bewusst)

Das Wiring des Pollers in einen konkreten Agent-Supervisor/Hook (Deploy-Zeit) bleibt Folge-Slice —
`createDaemonInboxPoller` ist die deploy-agnostische Primitive (kein Prod-Callsite, matcht die
Modul-Intention). Kein Deploy, kein Device.

## Tests

- `agent-poll-config.test.ts` (neu, 7): Mode-Defaults, Env-Overrides, fail-safe, Invariante, unknown-Mode.
- `inbox-poller.test.ts` (+7): Backoff/Deckel, Reset bei Verkehr, Fehler→Backoff, stop-during-inflight-Drain,
  maxMs<initialMs-Clamp.
- Full Suite **115 Files / 1435 grün**, tsc 0, eslint 0.

## Review

Claude adversarialer Reviewer (agy/pal-Backend nicht verfügbar): **APPROVE**, 0× HIGH/CRITICAL —
State-Machine korrekt (kein stop/reschedule-Race, kein inFlight-Deadlock), Backoff-Mathematik + Clamp
konsistent, Tests nicht-tautologisch, `intervalMs` sauber ersetzt. Nachgezogen: stop-during-inflight-Test.
