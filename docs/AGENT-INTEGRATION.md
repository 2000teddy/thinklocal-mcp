# Agent-Integration — einen beliebigen CLI-Agenten ans Mesh anbinden

**Zielgruppe:** Wer ein *eigenes* thinklocal-Mesh betreibt und einen beliebigen CLI-Agenten
(Claude Code, Codex, Gemini CLI, eigene Skripte …) so anbinden will, dass er über das Mesh
**Fähigkeiten nutzt** und **Nachrichten empfängt** — ohne TH01-Insiderwissen.

> **Onboarding-Rotfaden.** Dieses Kapitel ist Schritt 3 einer durchgehenden Story:
> 1. **[README](../README.md)** — Was das Mesh ist & Architektur (Quick Start).
> 2. **[INSTALL.md](../INSTALL.md)** — Daemon installieren (Multi-OS), zweiten Rechner hinzufügen
>    (Pairing), SSH-Deployment.
> 3. **dieses Kapitel** — den *Agenten* auf einem laufenden Node an das Mesh anbinden.
>
> Voraussetzung: auf dem Rechner läuft ein Daemon (INSTALL.md) und er ist mit mindestens einem
> Peer **gepairt** (`start_pairing`, siehe INSTALL.md → „Deployment / Pairing").

---

## 1. Die drei Bausteine

Ein am Mesh teilnehmender Agent besteht aus drei Teilen — jeder ist eigenständig nutzbar:

| Baustein | Wozu | Wie |
|---|---|---|
| **MCP-Anbindung** | Der Agent bekommt die Mesh-Tools (`discover_peers`, `send_message_to_peer`, `read_inbox`, `execute_remote_skill`, `mcp_call_tool` …) | `mcp-stdio` als MCP-Server in die Agent-Config eintragen (siehe §2) |
| **Instanz-Registrierung** | Der Agent wird als **adressierbare Instanz** am lokalen Daemon bekannt, damit Nachrichten *an ihn* zustellbar sind | `POST /api/agent/register` (der `mcp-stdio`-Adapter macht das beim Start automatisch) |
| **Empfangs-Loop** | Der Agent **holt** eingehende Nachrichten ab und bekommt sie in seine Session gereicht | Supervisor/Hook pollt die Inbox (§4) — **außerhalb** des Agenten-LLM |

## 2. MCP-Anbindung (`mcp-stdio` + Env)

Der Agent spricht nicht direkt mit dem Mesh, sondern mit seinem **lokalen Daemon** über den
`mcp-stdio`-Adapter. In der MCP-Config des Agenten (z.B. `~/.mcp.json` für Claude Code, siehe
INSTALL.md → „Claude Code Integration"):

```jsonc
{
  "mcpServers": {
    "thinklocal": {
      "command": "node",
      "args": ["/pfad/zu/thinklocal-mcp/packages/daemon/dist/mcp-stdio.js"],
      "env": {
        "TLMCP_DAEMON_URL": "https://localhost:9440",
        "TLMCP_RUNTIME_MODE": "lan",
        "TLMCP_DATA_DIR": "~/.thinklocal"
      }
    }
  }
}
```

Referenz der wichtigsten `mcp-stdio`-Env-Variablen:

| Variable | Default | Bedeutung |
|---|---|---|
| `TLMCP_DAEMON_URL` | `https://localhost:9440` | Der lokale Daemon (mTLS, loopback). |
| `TLMCP_RUNTIME_MODE` | `lan` | `lan` = Mesh-Betrieb; `local` = Einzelrechner. |
| `TLMCP_DATA_DIR` | `~/.thinklocal` | TLS-Certs, Pairing, Inbox-DB des Nodes. |

## 3. Adressierung: SPIFFE-`node/`-URIs

Ziele im Mesh werden über **kanonische SPIFFE-URIs** adressiert. `discover_peers` listet die
online-Peers samt ihrer `agent_id`:

```
spiffe://thinklocal/node/12D3KooW…   ← kanonische node/<PeerID>-Identität (ADR-022)
```

Diese `agent_id` ist das Ziel für `send_message_to_peer`. Der Agent muss **kein** Zertifikat
besitzen — der lokale Daemon trägt den Dienstausweis und reicht die Nachricht mTLS-gesichert
weiter. (Historische `host/<id>`-URIs sind Legacy; das Mesh flippt Nodes auf `node/<PeerID>`.)

## 4. Empfangs-Loop (das nachbaubare Muster, ADR-004)

Der Agent bekommt eingehende Nachrichten nicht „von selbst" — ein **Supervisor/Hook** pollt die
lokale Inbox und reicht neue Nachrichten in die Session. Das Muster (drei REST-Calls gegen den
lokalen Daemon, alle loopback):

```
alle <poll-intervall>:
  GET  /api/inbox?unread=true[&for_instance=<instanz>]   → ungelesene holen
  → je Nachricht: in die Agent-Session zustellen (deliver)
  POST /api/inbox/mark-read {message_id}                 → NUR nach erfolgreicher Zustellung
```

Die Referenz-Implementierung dieses Loops liegt in `packages/daemon/src/inbox-poller.ts`
(`createAdaptiveInboxPoller` / `createDaemonInboxPoller`) — deploy-agnostisch, die eigentliche
Session-Zustellung steckt hinter dem `deliver`-Callback (Agent-Home). Eigenschaften:
**at-least-once** (mark-read erst nach erfolgreicher Zustellung → keine verlorene Nachricht;
Konsument dedupt per `message_id`), **nicht-überlappend**, fehler-gekapselt.

### 4.1 Token-Ökonomie — warum der Poll 0 LLM-Tokens kostet

Das ist die wichtigste Eigenschaft für den Dauerbetrieb: **Der Inbox-Poll läuft AUSSERHALB des
Agenten-LLM.** Es ist ein Supervisor-/Shell-Prozess, der gegen die lokale REST-API pollt
(loopback, kein Auth-Token nötig). Solange **keine** Nachricht da ist, passiert **nichts** im
LLM — kein Turn, keine Tokens. **LLM-Tokens fallen erst an, wenn tatsächlich eine Nachricht
zugestellt und vom Agenten verarbeitet wird.** Ein leerlaufender Agent pollt also beliebig oft,
ohne Kosten. Deshalb ist adaptiver Backoff (schnell bei Verkehr, langsam im Leerlauf) eine
Optimierung der *REST-Last*, nicht der Token-Kosten — die sind im Leerlauf ohnehin null.

### 4.2 Poll-Intervalle konfigurieren (Env) — und die Abgrenzung zu `TLMCP_HEARTBEAT_MS`

Die Kadenz des Empfangs-Loops ist **adaptiv** und per Env konfigurierbar
(`resolveAgentPollConfig`, `packages/daemon/src/agent-poll-config.ts`):

| Variable | Default (`lan`) | Default (`local`) | Bedeutung |
|---|---|---|---|
| `TLMCP_AGENT_POLL_INITIAL_MS` | `5000` | `2000` | Kürzestes Intervall (aktiver Zustand). Nach jedem Zyklus **mit** Verkehr wird hierauf zurückgesetzt. |
| `TLMCP_AGENT_POLL_MAX_MS` | `30000` | `15000` | Längstes Intervall (Leerlauf-Backoff-Obergrenze). Ein **leerer** Zyklus verdoppelt das Delay bis hierhin. |

Fail-safe: ungültige/`≤0`-Werte → Mode-Default; `MAX < INITIAL` wird auf `INITIAL` angehoben.

> **⚠️ Nicht verwechseln mit dem Daemon-Heartbeat.** Es gibt zwei völlig getrennte periodische Takte:
>
> | | `TLMCP_HEARTBEAT_MS` | `TLMCP_AGENT_POLL_*_MS` |
> |---|---|---|
> | **Wer** | Der **Daemon** | Der **Agent-Supervisor** (außerhalb LLM) |
> | **Was** | Daemon-zu-Daemon-Liveness im Mesh (Peer online/offline nach 3 Missed Beats) | Wie oft der Agent seine **Inbox** abfragt |
> | **Wirkt auf** | Mesh-**Topologie** | Zustell-**Latenz** an den Agenten |
> | **Default** | `10000` ms | `5000`→`30000` ms adaptiv (lan) |
>
> Ein Ändern des einen hat **keinen** Effekt auf das andere. `TLMCP_HEARTBEAT_MS` ist in
> `config.ts` (`mesh.heartbeat_interval_ms`) verankert, die Poll-Variablen in `agent-poll-config.ts`.

## 5. Minimales „eigenes Netz"-Rezept (durchgehend)

1. Daemon auf Rechner A **und** B installieren → [INSTALL.md](../INSTALL.md).
2. A und B **pairen** (`start_pairing`) → gegenseitiges Vertrauen (INSTALL.md).
3. `mcp-stdio` in die Agent-Config auf beiden Rechnern eintragen → §2. Beim Start registriert
   sich die Instanz automatisch am lokalen Daemon.
4. `discover_peers` → die `node/<PeerID>` des anderen Rechners ablesen → §3.
5. `send_message_to_peer` an diese URI. Auf der Gegenseite holt der Empfangs-Loop (§4) die
   Nachricht ab und reicht sie in die Session.

Damit steht ein 2-Node-Mesh mit einem sprechenden Agenten — ohne dass der Agent selbst je ein
Zertifikat halten oder die Mesh-Komplexität kennen muss.
