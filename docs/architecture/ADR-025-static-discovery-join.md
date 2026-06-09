# ADR-025: Robuster Static-Peer-Join + abschaltbares mDNS + Interface-Präferenz (.55)

**Status:** Proposed (Draft-PR, wartet auf Review — KEIN Deploy/Merge ohne Christians Wort)
**Datum:** 2026-06-09
**Autor:** Claude (Implementierung), Christian (Auftrag), Orchestrator .94 (Diagnose + Steuerung)
**Analyse (CO):** `pal:analyze` gpt-5.5 — endorsed alle 3 Optionen (1+2 must-have für .55, 3 should-have für /16).
**Verwandt:** [ADR-019](ADR-019-multi-interface-discovery.md) (mDNS Multi-Interface), `th55-ehostunreach-host-routing`.

## Kontext / Diagnose (auf .55 verifiziert)

`.55` = MacBook, dual-homed: **en10** (WD50-Dock, 10.10.10.55) + **en0** (WiFi, 10.10.25.90).
Mesh-Nodes liegen alle auf 10.10.10.x. Trotz sauberer Config (mDNS-Pin aus, CIDR /24,
6 static_peers, gültiges Cert) joint `.55` nicht:

- Daemon-Start vergiftet macOS `connectx`-Routing **transient** (~Sekunden) — bekanntes
  Phänomen (siehe ADR-019-Nachtrag / th55-Memory).
- Die static_peer-Verbindung war ein **einmaliger Start-Burst** (~100ms nach libp2p-Start,
  `Promise.allSettled` ohne Retry, `index.ts`). Er trifft genau das Poison-Fenster →
  alle 6 Connects `EHOSTUNREACH` → **0 Peers**, nie wieder versucht.
- Gegenprobe: frischer `node net.connect` NACH Daemon-Kill = OK; ping/nc/route grün → das
  Poison ist transient + vom Daemon-Start selbst verursacht.
- `discovery.ts` erzeugte IMMER `new Bonjour()` (der mDNS-Pin de-pinnt nur, schaltet mDNS
  nicht ab) → der mDNS-Stack blieb als Poison-Quelle aktiv, obwohl `.55` nur static_peers nutzt.
- meshIp-Wahl unter /16: `getMeshIp` sortierte nach Interface-Name (`localeCompare`) → `en0`
  (WiFi) vor `en10` (wired) → falsche Mesh-IP. Deshalb musste /24 statt /16 gesetzt werden.

## Entscheidung (3 additive, config-gegatete Fixes — Default unverändert)

**1. Static-only Discovery (`discovery.mdns_enabled`, Default true).** Bei `false` erzeugt
`MdnsDiscovery` **keine** Bonjour-Instanz (früher Return im Ctor, VOR `getMeshIp` und dem
`allowed_mesh_cidrs`-Fail-closed-Check); `publish/browse/unpublish/stop` sind no-op. Entfernt
die mDNS-Poison-Quelle auf static-only Nodes sauber. Env: `TLMCP_MDNS_ENABLED=0`.

**2. Static-Peer-Reconciler (statt Einmal-Burst).** Neues Modul `static-peer-reconciler.ts`:
versucht nicht-verbundene static_peers **sofort**, dann alle **15s für 5min**; bei static-only
(`mdns_enabled=false`) danach langsam weiter (**60s**). Non-blocking (erster Versuch als
0ms-Timer), idempotent (`mesh.addPeer` dedupt über `agentId`), sauber stopbar im Graceful
Shutdown. Reine Orchestrierung — der Connect (`connectOnce`) ist injiziert → ohne Netzwerk/
Timer-Globals unit-testbar. **Robust für ALLE Nodes** (übersteht transientes Start-Poison +
später startende Peers).

**3. Interface-Präferenz (`discovery.preferred_interfaces`, geordnete Namensliste).** Reine
`orderMeshInterfaces`-Hilfsfunktion: bei mehreren CIDR-Treffern gewinnen die zuerst gelisteten
(`["en10","en0"]` → wired vor WiFi), sonst `localeCompare` (bisheriges Verhalten). **Config-
getrieben, KEINE Wired/WiFi-Heuristik** (`os.networkInterfaces()` liefert keine Medium-Info →
Auto-Detect wäre fragil). Erlaubt `/16` (beide Subnetze) ohne en0-Fehlwahl. Env:
`TLMCP_PREFERRED_INTERFACES="en10,en0"`.

## Verworfene Alternativen

| Option | Ablehnung |
|--------|-----------|
| Wired/WiFi-**Heuristik** für Interface-Wahl | `os.networkInterfaces()` hat keine Medium-Info → nicht deterministisch/testbar. Config-Liste stattdessen. |
| `setInterval`-Retry | Überlappende async-Ticks. Self-rescheduling `setTimeout` nach Abschluss des Batches vermeidet Overlap. |
| mDNS-Gating in `index.ts` (statt im Ctor) | Würde viele `discovery?.`-Optionalpfade erzeugen; Kapselung in `MdnsDiscovery` ist kleiner + testbarer. |

## Konsequenzen

- **`.55`-Join-Fix:** `mdns_enabled=false` + Reconciler → static_peers verbinden auch durch das
  transiente Poison-Fenster. Empfohlene `.55`-Config: `mdns_enabled=false`, static_peers gesetzt.
- **Allgemein robuster:** der Reconciler hilft jedem Node bei kurzem Peer-Ausfall / Startreihenfolge.
- **/16 wieder möglich:** mit `preferred_interfaces=["en10","en0"]` (für mDNS-aktive dual-homed Nodes).
- Default (keine neuen Flags) = exakt bisheriges Verhalten (mDNS an, Einmal-Connect ersetzt durch
  Reconciler mit sofortigem ersten Versuch — funktional gleich beim Erfolg, nur robuster bei Fehler).
- **Rollout NICHT Teil dieses Drafts** — kein Deploy/Merge/Branch-Protection ohne Christians Wort;
  Test auf `.55` macht der Orchestrator.

## Gewählter Scope
**Alle drei** (1+2+3) in einem PR. 1+2 lösen den `.55`-Join robust; 3 erlaubt `/16` zurück.
