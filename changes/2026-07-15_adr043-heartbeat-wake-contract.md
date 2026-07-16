# changes/2026-07-15 — feat: ADR-043 Heartbeat-Weckruf-Kontrakt (TL-11 Slice A)

**Typ:** Daemon-Code (`wake-contract.ts` neu, `events.ts`, `inbox-api.ts`, `index.ts`) + Tests + Design-Doku (ADR-043).
**Slice:** TL-11 Slice A. **Kein neuer Transport, kein Out-of-Repo-Supervisor-Hop.**

## Warum
`inbox:new` wird an Dashboard/Telegram/WS gepusht, aber nicht an einen laufenden CLI-Agenten. TL-11
formalisiert daemon-seitig den **Wake-Kontrakt** + das per-Instanz-Fanout, damit der Out-of-Repo
Agent-Home-Supervisor ein wohldefiniertes Signal konsumieren kann.

## Was
- `wake-contract.ts` (neu, rein): `resolveWakeTargets` (**fail-closed** — adressierte live Instanz → `[it]`;
  unadressiert/nicht-live → `[]`; **kein Broadcast**), `WakeCoalescer` (per-Instanz-Dedup im Fenster,
  `nowMs` injiziert, prunt außerhalb des Fensters), `computeWakes` (≤ 1 inhaltsfreies `WakeSignal`),
  `registerWakeEmitter` (abonniert `inbox:new`, liest `to_agent_instance`, emittiert `agent:wake`; WARN nur
  bei präsentem null-Feld).
- `events.ts`: neuer `MeshEventType` `agent:wake`. `inbox-api.ts`: Loopback-`inbox:new` trägt jetzt
  `to_agent_instance` (additiv). `index.ts`: `WakeCoalescer` + `registerWakeEmitter` verdrahtet.

## Bewusste Grenze / extern-blocked
Transport = **Reuse des bestehenden WS-`inbox:new`-Push** (Wake ist best-effort/lossy/idempotent).
`agent:wake` → laufender CLI = **Out-of-Repo Agent-Home-Supervisor**; **Zwei-Peer-Live-Proof-DoD**
(CLI-Reaktion ohne dazwischenliegenden Poll) ist **extern-blocked**. WS-Instanz-Bindung (instanceId-Leak
an alle WS-Subscriber) = offene Abhängigkeit. Opt-in-Broadcast = additiver Folge-Slice.

## Compliance
- **CO:** `pal:consensus` 2026-07-15 (opus+sonnet) — fail-closed Fanout, WS-Reuse-Begründung, Slice
  verdrahten. ⚠️ Cross-Vendor (codex/agy) nicht im PATH. Beleg: `~/hermes/reports/2026-07-15_1833_TL11-wake-consensus.md`.
- **CG:** n/a. **TS:** +14 Tests (resolve fail-closed, Coalescer-Grenze/Independence, computeWakes,
  Emitter: adressiert→wake / unadressiert-null→WARN / Feld-fehlt→still / nicht-live→still / coalesced).
  Volle Suite **1692 grün**, tsc/ESLint 0.
- **CR:** adversarialer Claude-Subagent — **alle 6 Invarianten PASS** (kein Fanout/Amplifikation/Leak,
  Metadaten-Leak in ADR benannt). 2 LOW **in-slice gefixt** (WARN-Alert-Fatigue → nur präsentes null-Feld;
  Coalescer-Map-Pruning). Review-of-Record folgt am PR (codex/agy nicht verfügbar → Claude).
- **PC:** `git diff`; Secret-Scan clean.
- **DO:** ADR-043, `TODO.md` (TL-11 Slice A ✅), `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.
