# changes/2026-07-19 — docs(tl11): Slice-B Integrations-Runbook (Agent-Home-Supervisor + Zwei-Peer-Wake-Proof)

**Typ:** Doc-only (Integrations-Runbook, Prep für den extern-blockierten TL-11 Slice B). **Kein** Code/
Runtime-Change, **keine** Skripte, **kein** Deploy/Secret/Cross-Host-Schritt, **keine** Supervisor-Änderung.

## Warum
TL-11s Wake-Consumer-Contract (`TL-11-wake-consumer-contract.md`) pinnt die **Protokoll-Schnittstelle**.
Was fehlte, ist die **operative** Anleitung: wie ein Integrator den (out-of-repo) Agent-Home-Supervisor
tatsächlich aufstellt und den Zwei-Peer-Live-Proof fährt, sobald ein Host-Fenster geöffnet wird. Ohne dieses
Runbook müsste der Operator den Kontrakt zur Fenster-Zeit neu erarbeiten. Der Runbook-Prep ist der **ready**
repo-only Schritt, der Slice B de-riskt — ohne selbst Deploy/Fenster/Secret zu berühren.

## Was
- **Neu `docs/RUNBOOK-TL-11-wake-supervisor.md`:** operativer Companion (Schritte statt Nacherzählung der
  Spec):
  - **§1 Verortung:** Supervisor MUSS auf dem Daemon-Host laufen + über `127.0.0.1` verbinden (agent-
    gefilterte Subscription ist loopback-only; Nicht-Loopback → Close `4003`, Spec §2).
  - **§2 Cert:** vorhandenes Mesh-Client-Cert (`node.crt.pem`/`node.key.pem` gegen `ca.crt.pem`) — **kein**
    Secret/Key-Material im Runbook.
  - **§3 Subscribe:** `wss://127.0.0.1:9440/ws?subscribe=agent:wake&agent=spiffe://…/node/<PeerID>`
    (beides Pflicht; deny-by-default).
  - **§4 Reaktion:** Payload unter **`ev.data`** (Zero-Content, `reason:'inbox'`) → `pokeCli` (out-of-repo)
    → CLI liest `GET /api/inbox`.
  - **§5 Robustheit:** Cold-Start-Sweep-Pflicht (best-effort/lossy/coalesced/fail-closed).
  - **§6 Zwei-Peer-Proof-Prozedur:** CLI reagiert auf ein reales Wake **ohne** dazwischenliegenden Poll
    (`[[dod-two-peer-mcp-proof]]`) + Negativ-Kontrolle (fremde Instanz → kein Wake).
  - **§7 Verifikations-Checkliste** (Operator-Sicht auf die bereits testgebundenen Invarianten, Spec §7/§7.1).
  - **§8 No-op-Rückfall** (ohne Supervisor bleibt der Agent funktional, nur langsamer).
  - **§9 Lane-Kontext:** TL-08/09/10-Wahrheit sichtbar gehalten (2c BLOCKED · 09c braucht Secret · 10-A hinter
    §5-CO).
- **`TODO.md`:** TL-11 Runbook-Prep-Sub als erledigt; Slice B bleibt offen/extern-blocked (jetzt „gegen
  Contract **und** Runbook baubar").

## Abgrenzung
**Entfernt den Blocker nicht.** Der letzte Hop (Supervisor → CLI, `pokeCli`) ist **out-of-repo** und der
End-to-End-Proof Host-/Deploy-gated — dieses Runbook **de-riskt** ihn nur. `pokeCli` ist **kein** Repo-Symbol
(0 Treffer im Code), sondern die vom Supervisor selbst zu treffende Weck-Aktion — im Doc entsprechend
markiert. Kein neuer Beschluss (alle Werte aus gemergtem #271/#277-Code + Spec).

## Compliance
- **CO/CG/TS:** entfallen — kein Code, kein neuer Design-Beschluss, keine Skripte (leitet aus dem gemergten
  Kontrakt + der bestehenden Spec ab).
- **CR:** Claude-Review-Subagent (Doc-Accuracy) — Anker/Zitate + `pokeCli`-Out-of-Repo-Klarstellung gegen die
  Quelle verifiziert (`index.ts:1398`, `websocket.ts` `4003`-Gate, `wake-contract.ts`, Spec §2–§8).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku, kein Key-Material).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, das Runbook.
