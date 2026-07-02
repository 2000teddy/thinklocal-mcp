# Phantom-Announce-Guard für geteilte MCP-Server (`serve_shared`, ADR-032)

**Datum:** 2026-07-02
**Branch:** `claude/mcp-phantom-announce-guard` (eigenständig gegen `origin/main`)
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Hardening / Sicherheit (Mesh/Discovery) — kein Deploy
**Bezug:** ADR-032; MEDIUM-Finding aus dem unabhängigen Review von PR #229 (T3.1/T3.2)

## Problem

`config/daemon.toml` ist ein fleet-weit ausgeliefertes Template; Shared-MCP-Deklaration ist
**default-open** und `registerSharedMcps` announced **jeden** deklarierten Eintrag als `mcp:<server>`
ins CRDT — **ohne** Provider-Prüfung. Rollout eines Templates mit aktiven `[[mcp.share]]` (pal/unifi)
auf **alle** Nodes → jeder Spoke announced **Phantom-Provider** → Auflösungs-Ambiguität; mit dem
T3.3-Live-Executor ein Live-Mis-Forward-Risiko.

## Lösung (ADR-032)

Ein Node announced seine Shared-MCPs nur als **designierter Provider**:
- Config `[mcp] serve_shared` (bool) + Env `TLMCP_MCP_SERVE_SHARED`, **Default `false`** (fail-safe).
  Der Hub setzt `true` (bzw. `TLMCP_MCP_SERVE_SHARED=1`).
- Reine `guardSharedMcpAnnounce(serveShared, buildResult)` (`mcp-registration.ts`) filtert vor der
  Registrierung: `false` → keine Capabilities announced (deklarierte wandern mit Grund nach `skipped`,
  laut geloggt); `true` → unverändert durchgereicht. Gegatet am `registerSharedMcps`-Aufruf (`index.ts`).
- `config/daemon.toml`: neue `[mcp] serve_shared = false`-Sektion mit Kommentar.

**Orthogonal zu „Discovery default-open" (ADR-028 D4):** `serve_shared` entscheidet nur, **ob** ein
Node Provider ist; ein Provider teilt weiterhin default-open. **Keine Reachability-Probe**, weil
local-exec (Q1) zurückgestellt ist (kein Serve-Prozess zu proben) — eine Liveness-Probe supersediert
den Gate, sobald das lokale Serving landet.

## Tests

- **`mcp-registration.test.ts`** (+5): `guardSharedMcpAnnounce` — `true` passthrough, `false` → leere
  Capabilities + Grund in `skipped`, leeres Ergebnis, bestehende `skipped` erhalten, End-to-End mit
  `registerSharedMcps` (registriert 0).
- **`config-mcp-share.test.ts`** (+3): `serve_shared` Default `false`, TOML `[mcp] serve_shared=true`,
  Env `TLMCP_MCP_SERVE_SHARED` (1→true, 0→false, Env schlägt TOML).
- **Live (dist):** kompiliertes `guardSharedMcpAnnounce` → off unterdrückt (0 caps, Grund), on reicht durch.
- Volle Suite **1304 grün**, tsc 0, authored-eslint 0, build 0.

## Review

Unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env). *(Ergebnis
im PR-Body / COMPLIANCE.)*

## Folge / offen

- Reachability-/Liveness-Probe des lokalen MCP-Serve-Prozesses (ersetzt/ergänzt die Designation, sobald
  local-exec landet); per-MCP-granulare Designation (node-global genügt für die Beta).
- **Reihenfolge:** dieser Guard sollte **vor** dem T3.3-Live-Executor (#230) wirksam sein — daher
  eigenständig gegen `main` (mergebar unabhängig von der T3.x-Stack-Kette). **Kein Deploy.**
