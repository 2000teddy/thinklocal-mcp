# ADR-019: Multi-Interface mDNS Discovery — Robuste Peer-Discovery auf Multi-Homed Hosts

**Status:** Proposed
**Datum:** 2026-05-17
**Autor:** Christian (Problem-Aufdeckung), Claude Opus 4.7 (Konsensus-Moderation)
**Konsensus:** GPT-5.4 (8/10), Gemini 3 Pro (9/10), Minimax übersprungen (PAL-Config veraltet), Grok übersprungen (OpenRouter-Stau)
**Verwandt:** ADR-001 (Mesh-Architektur), TODO Phase 1 Discovery

## Kontext

ThinkLocal nutzt `bonjour-service` (npm) fuer mDNS-basierte Peer-Discovery. Jeder
Daemon published `_thinklocal._tcp` auf Port 9440 und horcht parallel auf neue
Peers. In der bisherigen Implementierung wird **eine einzige `Bonjour`-Instanz**
ohne Interface-Angabe erzeugt — macOS und Linux entscheiden dann selbst, welches
Interface benutzt wird (meist das mit der Default-Route).

### Das konkrete Problem (Live-Beobachtung 2026-05-17)

Hosts haben oft **mehrere Netzwerk-Interfaces**:
- macOS-Workstations mit 2-3 NICs: USB-Ethernet (10.10.10.0/24 = Mesh),
  WLAN (eigenes Subnet), evtl. DMZ-Interface direkt an der Fritzbox
- Linux-Server mit Ethernet (10.10.10.0/24) und parallel WLAN
- Apple-Geraete (iPad, Apple Watch) sind nur ueber WLAN erreichbar — der User
  braucht beide Interfaces aktiv

**Symptom:** MacBook hat Default-Route ueber DMZ-Interface, published mDNS
dort, sieht 0 Peers im Mesh, ist effektiv isoliert. `mesh_status` zeigt
`peers_online: 0` obwohl alle anderen Peers laufen.

### Warum Workarounds nicht akzeptabel sind

- **Statische Peer-Listen** (`TLMCP_STATIC_PEERS`): Zerstoert das Auto-Discovery-
  Konzept und skaliert nicht
- **Routing manuell umkonfigurieren:** Entwickler-Workstations wechseln das
  Default-Interface haeufig (z.B. wenn 10er-Netz schlecht ist, schnell auf
  DMZ um zu surfen)
- **"Nur ein Interface aktiv lassen":** Geht nicht, weil Apple-Geraete WLAN
  brauchen und der Mesh-Traffic ueber Ethernet laufen soll

## Entscheidung

Wir implementieren einen **DiscoveryPolicyManager** mit zwei Kern-Komponenten:

1. **Subnet-CIDR-Filter (Policy)**: Nur Interfaces benutzen, deren IP in einem
   konfigurierten Mesh-CIDR liegt (z.B. `10.10.10.0/24`)
2. **Multi-Instance bonjour-service (Mechanik)**: Pro erlaubtem Interface eine
   eigene `Bonjour`-Instanz, explizit gebunden via `new Bonjour({ interface: ip })`

Ein **Reconcile-Loop** pollt alle 5 Sekunden `os.networkInterfaces()` und passt
die Instanzen an (Interface-Hotswap).

### Architektur

```
┌──────────────────────────────────────────────┐
│ DiscoveryPolicyManager                       │
│  - liest os.networkInterfaces()              │
│  - filtert nach allowed_mesh_cidrs           │
│  - excludes virtual (docker/tailscale/utun)  │
│  - reconcile-Loop alle 5s                    │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ Pro erlaubtes Interface:                     │
│   new Bonjour({ interface: ip })             │
│     .publish(_thinklocal._tcp:9440)          │
│     .find(_thinklocal._tcp)                  │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ Peer-Deduplikation per SPIFFE-URI            │
│  (NICHT per IP — wegen mDNS-Reflectors)      │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ Empfangsseitige CIDR-Validierung             │
│  Peers ablehnen deren IP NICHT in            │
│  allowed_mesh_cidrs liegt                    │
└──────────────────────────────────────────────┘
```

### Konfiguration

```toml
# config/daemon.toml
[discovery]
mdns_service_type = "_thinklocal._tcp"
allowed_mesh_cidrs = ["10.10.10.0/24", "192.168.1.0/24"]
exclude_interface_patterns = ["docker*", "tailscale*", "utun*", "veth*", "bridge*", "lo*"]
reconcile_interval_ms = 5000
hold_down_ms = 2000
ipv6_enabled = false  # Phase 1: nur IPv4 — IPv6 Link-Local Scope-Handling spaeter
```

## Verworfene Alternativen

| Option | Begruendung der Ablehnung |
|--------|---------------------------|
| **B: libp2p mDNS** (`@libp2p/mdns`) | Loest das Interface-Scoping-Problem nicht automatisch (gleiche Multicast-Mechanik). Koppelt zudem Discovery zu eng an libp2p, obwohl wir Fastify+mTLS fuer den Mesh-Transport nutzen. |
| **C: Native DNS-SD via N-API** | Praeziseste Loesung auf macOS (Interface-Index-Parameter), aber Cross-Compilation (Apple DNS-SD vs. Linux Avahi/systemd-resolved) ist ein Wartungsalbtraum. Architektonischer Bruch im JS/TS-Stack. |
| **E: mDNS + libp2p Hybrid** | Korrekte Zielarchitektur fuer spaeter, loest aber **nicht** das Initial-Discovery-Problem — libp2p-Routing kann erst greifen wenn mindestens ein Peer gefunden wurde. |
| **TLMCP_STATIC_PEERS** | Zerstoert das Zero-Config-Versprechen. Bei Entwickler-Workstations mit wechselnden Netzen unbrauchbar. |

## Konsequenzen

### Positiv
- **Zero-Config:** User muss keine Interfaces manuell waehlen
- **Cross-Subnet-Leakage verhindert:** Kein Broadcast in Hotel-WLANs oder DMZ
- **Robust gegen Interface-Aenderungen:** Reconcile-Loop reagiert auf Hotplug
- **Bestehender Stack bleibt erhalten:** Kein libp2p-Rewrite, kein N-API
- **Bewaehrt:** Syncthing und andere lokale-Mesh-Tools nutzen exakt dieses Pattern

### Negativ / Risiken
- **bonjour-service muss tatsaechlich interface-spezifisch binden** —
  dokumentiert, aber **PoC-Pflicht** auf macOS mit drei Interfaces (eines mit
  Default-Route, gewuenschtes ist NICHT das Default-Interface). Falls die
  Library nicht sauber bindet, muessen wir auf ein native Backend ausweichen.
- **Polling statt Events:** Node.js bietet keine Cross-Platform Interface-Change-
  Events. 5s-Polling ist alternativlos, aber leicht unschoen.
- **Lifecycle-Komplexitaet:** `bj.destroy()` muss verlaesslich aufgerufen werden,
  sonst `EADDRINUSE` beim Reconnect.

### Edge-Cases die zwingend behandelt werden muessen

1. **Hotplug / Sleep-Wake / WLAN-Roaming**: Hold-down-Timer (2s) gegen Flapping
2. **Docker / VPN / Tailscale Interfaces**: Exclude-Patterns standardmaessig aktiv
3. **mDNS-Reflector** (Fritzbox/Avahi): Empfangene Peers gegen `allowed_mesh_cidrs`
   pruefen — selbst wenn der Reflector aus Fremdsubnet spiegelt
4. **Duplicate Peer Sightings**: Deduplikation per SPIFFE-URI, nicht per IP
5. **Interface ohne Carrier mit IP**: Hold-down bevor `publish` startet
6. **Default-Route-Wechsel zur Laufzeit**: Reconcile-Loop faengt das ab
7. **IPv6 Link-Local** (`fe80::`): Erst Phase 2 — Scope-ID-Handling ist tricky

## Migrations-Pfad

1. **Bestehenden globalen `bonjour-service`-Aufruf** in `DiscoveryManager`-Klasse
   kapseln (Refactoring, keine Verhaltensaenderung)
2. **Policy-Engine** (CIDR-Filter, Exclude-Patterns) als separates Modul einfuehren
3. **Shadow-Mode**: 1 Release lang nur loggen welche Interfaces erkannt werden,
   aber noch nicht umstellen (Vergleich Old-vs-New)
4. **Multi-Instance aktivieren** mit Feature-Flag (`discovery.multi_interface_enabled`)
5. **Empfangsseitige CIDR-Validierung** ergaenzen
6. **Default-aktivieren** nach 2 Wochen Stabilitaet
7. **Spaeter (separates ADR):** libp2p-Routing als zusaetzliche Schicht (Option E)

## PoC-Pflicht vor Implementierung

Bevor wir das in den Daemon einbauen, muss validiert werden:

```bash
# PoC auf macOS:
# - 3 aktive Interfaces: en0 (Ethernet 10.10.10.x), en1 (WLAN 192.168.x), utun0 (VPN)
# - Default-Route via utun0 (worst case)
# - bonjour-service mit { interface: '10.10.10.x' }
# - Erwartung: publish und find funktionieren NUR auf en0, NICHT auf en1/utun0

cd packages/daemon
npx tsx scripts/discovery-poc.ts
```

Falls bonjour-service unzureichend bindet: Fallback-Plan ist eine pluggable
Backend-API mit nativer DNS-SD/Avahi-Bridge als zweite Implementierung
(Option F aus GPT-5.4-Vorschlag).

## Tests / Akzeptanz

- **Unit-Tests:** Policy-Engine (CIDR-Match, Exclude-Patterns, Reconcile-Diff)
- **Integration-Tests:** Mock `os.networkInterfaces()`, verifiziere Instanz-
  Lifecycle (start, stop, replace bei IP-Change)
- **Live-Tests:**
  - macOS: 3 Interfaces, davon eines mit Default-Route, Mesh nur via Ethernet
  - Linux (Ubuntu): Ethernet + WLAN parallel
  - Hotplug: WLAN aus/an, Kabel raus/rein, mesh muss stabil bleiben
  - Hotel-WiFi-Szenario: Daemon im fremden Subnet darf NICHT broadcasten

## Referenzen

- Multi-Modell-Konsensus 2026-05-17 (GPT-5.4 + Gemini 3 Pro)
- bonjour-service Docs: https://github.com/onlxltd/bonjour-service
- Syncthing Discovery (Vorbild): https://docs.syncthing.net/specs/localdisc-v4.html
- Live-Beispiel: MacBook 10.10.10.55 mit 3 Interfaces, `peers_online: 0`
