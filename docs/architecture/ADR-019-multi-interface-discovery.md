# ADR-019: Multi-Interface mDNS Discovery — Robuste Peer-Discovery auf Multi-Homed Hosts

**Status:** Accepted (Phase 1.1 — Bind-Regression-Hotfix)
**Datum:** 2026-05-17 (Proposed) / 2026-05-18 (Phase 1 Implementiert + Phase 1.1 Hotfix)
**Autor:** Christian (Problem-Aufdeckung), Claude Opus 4.7 (Konsensus-Moderation, Implementierung)
**Konsensus:** GPT-5.4 (8/10), Gemini 3 Pro (9/10), Minimax übersprungen (PAL-Config veraltet), Grok übersprungen (OpenRouter-Stau)
**Code-Review:** GPT-5.4 — 1 HIGH + 2 MEDIUM + 4 LOW gefunden und alle gefixt mit Regression-Tests
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

**Symptom (zwei Auspraegungen, beide live beobachtet 2026-05-17):**

1. **MacBook initial isoliert:** Vor dem Reconnect zeigte der Daemon
   `peers_online: 0` — das mDNS-Discovery hatte noch keine Peers gefunden,
   vermutlich weil mDNS-Multicast auf einem Interface ohne Mesh-Reachability
   loslief.

2. **Falscher Host im Agent Card / mDNS-TXT (Live-Beweis):** MacBook hat
   drei aktive Interfaces — en10 (10.10.10.55 = Mesh, mit Default-Route),
   en8 (10.0.0.20 = DMZ), en0 (10.10.100.150). Der Daemon-Socket bindet
   korrekt auf `*:9440` und etabliert mTLS-Verbindungen aus dem Mesh-Interface
   heraus. ABER: `discover_peers` listet den MacBook als
   `host: "10.0.0.20"` (DMZ-IP), `agent_card: null`. Andere Peers koennen ihn
   ueber diese IP nicht erreichen, weil 10.0.0.20 aus dem 10.10.10.0/24-Mesh
   nicht routbar ist und die Mesh-CA nicht fuer die DMZ-IP gilt.

   **Ursache:** `bonjour-service` ohne Interface-Pinning ermittelt alle lokalen
   IPs und nimmt die erste — das ist nicht garantiert die Mesh-IP. Der published
   mDNS-A-Record zeigt damit ins falsche Subnet, selbst wenn der TCP-Socket auf
   allen Interfaces lauscht.

Beide Auspraegungen haben dieselbe Wurzel: die Discovery-Schicht waehlt
Interfaces nicht policy-gesteuert.

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

## Phase 1 Implementierung (2026-05-18)

**Was eingebaut wurde:**
- `discovery-policy.ts` — CIDR-Filter, Interface-Selektion, `restrictServiceToIp()`
- `discovery.ts` erweitert: Konstruktor pinned auf Mesh-IP, publish() patcht
  `Service.records()`, browse() filtert empfangene Peers via CIDR
- `config.ts` erweitert: `allowed_mesh_cidrs`, `exclude_interface_patterns` + Env-Vars
- 37 Unit-Tests + 9 Integration-Tests (alle gruen, keine Regression)

**WICHTIGE Erkenntnis aus PoC (per tcpdump bewiesen):**
`{ interface }` Option von `bonjour-service` steuert nur den Multicast-Socket,
nicht die A-Records — die werden weiterhin aus ALLEN `os.networkInterfaces()`
generiert. Loesung: zusaetzlich `Service.records()` monkey-patchen.

**Phase-2-Limitationen (bewusst verschoben):**
- **Kein Reconcile-Loop:** `meshIp` wird nur beim Daemon-Start berechnet. Wenn
  das Mesh-Interface zur Laufzeit verschwindet (Kabel raus, Sleep-Wake), zeigt
  der Service weiter auf die tote IP. Erst Daemon-Restart heilt das.
- **Kein Multi-Instance:** Bei mehreren erlaubten Mesh-CIDRs wird nur das
  alphabetisch erste Interface gewaehlt. Multi-Subnet-Publishing folgt spaeter.
- **IPv6:** Komplett deaktiviert (`disableIPv6: true` im publish). Phase 2.

**Code-Review-Findings (alle gefixt vor Merge):**
- HIGH (CR-1): `exclude_interface_patterns: []` aktivierte die Defaults nicht
  (gefixt: leeres Array faellt auf `DEFAULT_EXCLUDE_PATTERNS` zurueck)
- HIGH (CR-2, Precommit): `allowed_mesh_cidrs` set + kein Match = silent
  fallback zu unrestricted Publishing (gefixt: fail-closed, Konstruktor wirft)
- MEDIUM (CR-1): `parseInt('10abc.10.10.55')` akzeptierte gespoofte IPs
  (gefixt: strikte Regex-Validierung in `ipInCidr` und `ipv4ToNum`)
- MEDIUM (CR-2, Precommit): User-Excludes ersetzten Defaults statt zu mergen
  (gefixt: `Set([...DEFAULTS, ...userExcludes])`)
- MEDIUM: Reconcile-Loop fehlt (dokumentiert als Phase-2-Limitation)
- LOW: `restrictServiceToIp` nicht idempotent (gefixt: Marker-Variable)
- LOW: Stiller Fehler wenn Mesh-IP nicht in records (gefixt: Return-Wert + warn)
- LOW: CIDR-Validierung in `loadConfig` (gefixt: fail-fast bei Typos)
- LOW: IPv6-only Peer + CIDR-Policy = Hostname-Fallback (gefixt: rejecten)
- LOW (Precommit): discovery.test.ts testete nur Helper (gefixt: 3 echte
  MdnsDiscovery-Wiring-Tests inkl. fail-closed Regression)

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

---

## Phase 1.1 Hotfix — Bind-Regression (2026-05-18)

### Symptom

Nach Deployment des ADR-019 Phase-1-Codes auf dem Mac mini (`10.10.10.94`, zwei
NICs: `en0=10.10.10.94`, `en1=10.10.25.115`) zeigte sich asymmetrische Sicht:

- **Andere Peers** sahen den Mac mini im `dns-sd`-Browse normal (Outbound ok).
- **Mac mini selbst** hatte `peers_online: 0` und 0 "Peer entdeckt"-Eintraege
  im Log seit Restart — obwohl OS-`dns-sd -B _thinklocal._tcp local.` alle
  vier LAN-Peers sah.
- Reproduzierbar mit und ohne `TLMCP_ALLOWED_MESH_CIDRS`.

### Root Cause

`new Bonjour({ interface: meshIp })` reicht `opts.interface` an `multicast-dns`
weiter, das in `node_modules/multicast-dns/index.js` Zeile 65 macht:

```js
socket.bind(port, opts.bind || opts.interface, function () { ... })
```

Mit `opts.bind` undefiniert wird der UDP-Socket auf die **unicast-IP**
`10.10.10.94:5353` gebunden — statt auf `0.0.0.0:5353`. Der Kernel liefert
an einen so gebundenen Socket nur Unicast-Pakete; **Multicast-Datagramme
an `224.0.0.251:5353` werden verworfen**. Outbound funktioniert weiter, weil
`socket.send()` direkt eine Multicast-Adresse adressiert. Receive ist tot.

### Multi-Modell-Konsens (2026-05-18)

Befragt: GPT-5.4 (8/10), GPT-5.1-Codex (8/10), Gemini-3-Pro (9/10).
**Einstimmiger Befund:** Diagnose korrekt. Einstimmige Empfehlung: **Option 3**.

- Option 1 (conditional pinning) — **abgelehnt**: hebt ADR-019 fuer
  Auto-Pick-Hosts auf; auf explicit-CIDR-Hosts bleibt der Bug.
- Option 2 (`socket.setMulticastInterface()` via private internals) —
  **abgelehnt**: fragil bei Library-Upgrades.
- **Option 3 (gewaehlt):** `new Bonjour({ interface: meshIp, bind: '0.0.0.0' })`.

### Fix

`bonjour-service/dist/lib/mdns-server.js` Zeile 13: `this.mdns = multicast_dns(opts)`
— die Optionen werden 1:1 weitergereicht. Damit:

- `bind: '0.0.0.0'` → Receive auf Wildcard, Multicast wird wieder empfangen.
- `interface: meshIp` → `multicast-dns` Zeile 153
  `socket.setMulticastInterface(opts.interface)` — Outbound bleibt auf
  Mesh-NIC gepinnt.
- `restrictServiceToIp()`-Patch bleibt unveraendert — A-Records sauber.

Code: `packages/daemon/src/discovery.ts` Konstruktor. Eine Zeile geaendert.

### Regression-Tests (Vitest)

`packages/daemon/src/discovery.test.ts` "ADR-019 Hotfix: Bind-Regression"
(5 deterministische Tests via gestubbtem `networkInterfacesSource`):

1. `bind:"0.0.0.0"` + `interface:"10.10.10.94"` werden zusammen uebergeben
2. **Positiver CIDR-Policy-Pfad**: matching Interface → beide Optionen gesetzt
3. Ohne Mesh-IP wird Bonjour mit `{}` aufgerufen (Backward-Compat)
4. **Regression-Invariante:** `bind !== interface` (das war der Bug)
5. **Shutdown-Ordering:** `stop()` ruft `browser.stop` + `unpublishAll` + `destroy`

Code-Review (GPT-5.4): 0 HIGH/CRITICAL, 1 MEDIUM (conditional guard) + 2 LOW —
alle gefixt mit Regression-Tests vor dem Commit. Suite: **690/690 gruen**, 0 Regressionen.

### .55 connectx-Vergiftung — Interface-Pin abschaltbar (v0.34.5, 2026-06-08)

**Problem.** Auf dem dual-homed macOS-Node 10.10.10.55 (en10 = Mesh-NIC +
zweite Default-Route-NIC) brach die **blosse Anwesenheit** des laufenden
Daemons das macOS-`connectx`-scoped-routing **prozessweit**: die
10.10.10/24-Route kippte in **REJECT**, jeder ausgehende Connect — auch ein
nacktes `node net.connect` ausserhalb des Daemons — bekam `EHOSTUNREACH`.
Route heilte bei gestopptem Daemon, brach beim Neustart sofort wieder.

**Ursache.** Der Daemon ruft **kein** `route`/`IP_BOUND_IF` auf. Die
**einzige** Interface-Scoping-Operation im gesamten Daemon ist der oben
beschriebene mDNS-Socket-Interface-Pin: `bonjour-service` mit
`{ interface: meshIp }` → `multicast-dns` ruft `setMulticastInterface(meshIp)`
auf dem UDP-Socket. Auf dieser dual-homed-macOS-Konstellation vergiftet genau
das den connectx-scoped-routing-Zustand. (Die #162-Escape-Hatch — Outbound-
Connect-Pinning — half **nicht**, weil das Problem im mDNS-Socket sitzt.)

**Entscheidung.** Den Socket-Interface-Pin **entkoppeln** von der
A-Record-Hygiene über ein Opt-out-Flag `disable_mdns_interface_pin`
(Default **false** → alle bestehenden Nodes pinnen unveraendert):

- Pin an (Default): `resolveBonjourOptions` → `{ interface, bind:'0.0.0.0' }`.
- Pin aus (`TLMCP_DISABLE_MDNS_INTERFACE_PIN=1` /
  `[discovery] disable_mdns_interface_pin = true`): `{ bind:'0.0.0.0' }` —
  **kein** `setMulticastInterface` → Routing bleibt heil. Outbound-mDNS über
  Default-IF, Mesh-Konnektivität via `static_peer`.

**Was NICHT verloren geht:** `restrictServiceToIp()` (A-Record-Hygiene) und der
Fail-Closed-Pfad (`allowed_mesh_cidrs` ohne Match → Ctor wirft) haengen an
`this.meshIp`, **nicht** am Pin — beide bleiben unter Pin-Disable voll aktiv.

**Restschaden + Empfehlung.** Ohne Pin kann das OS mDNS-Pakete (Mesh-Hostname +
Mesh-IP im A-Record) auf dem Default-IF emittieren. Das ist Paket-Sichtbarkeit
auf dem fremden Segment, **keine** routbare Exposition (annonciert wird nur die
10.10.10/24-IP, fremde Peers werden im browse-Pfad weiter abgewiesen). Deshalb:
**Pin-Disable nur zusammen mit `allowed_mesh_cidrs` einsetzen.** Scope: genau
die betroffenen dual-homed-macOS-Nodes; Standard-Nodes bleiben beim Pin.

**Tests** (`discovery.test.ts` Block „mDNS-Interface-Pin-Disable", plus
`config-mdns-pin.test.ts`): `resolveBonjourOptions` rein (Pin an/aus/ohne
meshIp), Ctor-Wiring, **publish()-Pfad** (A-Record-Filter bleibt unter
Pin-Disable), **Fail-Closed unter Pin-Disable**, Config-/Env-Default + Override.
CR gpt-5.5 (security): 0 HIGH/CRITICAL.

**Zweite Vergiftungsquelle: libp2p-mDNS (Nachtrag v0.34.5, Live .55).**
Der Bonjour-Pin-Fix oben beseitigt nur die **Startup**-Vergiftung. Live auf .55
zeigte sich ~27s nach Start eine erneute REJECT-Route. Ursache: `@libp2p/mdns`
(`libp2p-runtime.ts`, `interval: 20_000`) ist eine **zweite, unabhängige
multicast-dns-Instanz** (eigener UDP-Socket, 20s-Query-Loop), die der
Bonjour-Pin nicht erfasst. `multicast-dns` ruft intern `update()` beim Bind
**und alle 5s** auf — `addMembership` je Interface (inkl. Mesh-NIC en10) +
`setMulticastInterface(opts.interface || defaultInterface())`. Auf .55 liefert
`defaultInterface()` zwar en0/10.10.25.90 (nicht die Mesh-IP) — die Re-Vergiftung
kommt also nicht von einem Mesh-gepinnten `setMulticastInterface`, sondern von
der periodischen interface-gescopten Multicast-Aktivität / mDNS-getriggerten
Peer-Dials dieser zweiten Instanz auf dem Mesh-NIC.

**Entscheidung:** derselbe Flag `disable_mdns_interface_pin` lässt auf
dual-homed macOS auch den `@libp2p/mdns`-Service weg (`resolveLibp2pMdnsEnabled()`,
reine Predicate; gleiche `...(cond ? {svc} : {})`-Mechanik wie autoNAT). libp2p
startet weiter (identify/ping/Transports bleiben) — nur die mDNS-Peer-Discovery
entfällt. Auf diesen Hosts ist libp2p ohnehin EHOSTUNREACH; das Mesh läuft über
`static_peer`/HTTPS. Default (Flag aus): libp2p-mDNS bleibt aktiv.

**Restschaden / offen:** ein bereits gesetzter `!`-REJECT auf `10.10.10/24`
heilt nicht von selbst — einmaliger `sudo route`-Heal durch den Operator nötig;
danach Re-Test, ob der flag-Daemon dauerhaft ohne Re-Vergiftung connectet.
(Hypothese, falls dann noch Re-Vergiftung: connectx-Negative-Route-Cache aus
fehlschlagenden gescopten Dials — wäre dann eine dritte, host-seitige Quelle.)

### Verbleibend (Phase 2)

- Reconcile-Loop (Hot-Plug NIC handling) — bereits in Phase 1 als TODO markiert
- IPv6 support — `disableIPv6: true` aktiv, AAAA bleibt gefiltert
- Pluggable Native-Backend (Avahi/DNS-SD) — Option F aus Konsens-2026-05-17
