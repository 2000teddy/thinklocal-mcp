# ADR-027: Overlay-Transport (Tailscale) für flaky-LAN / NAT / Cross-Subnet Nodes

**Status:** Proposed (DESIGN-ENTWURF — KEINE Umsetzung ohne Christians ausdrückliches Go)
**Datum:** 2026-06-14 14:44 (aktualisiert 2026-06-14 20:15 C1/C2-Split)
**Autor:** Claude (TH01, Design + Code-Verifikation), Orchestrator .94 (korrigierte Diagnose), Christian (Auftrag/Freigabe offen)
**CO:** `pal:consensus` — gpt-5.5 (for, 8/10) + gpt-5.3-codex (against, 9/10). gemini-3 429-capped.
**Verwandt:** ADR-019 (Multi-Interface-Discovery), ADR-025 (Static-Peer-Join), `th55-ehostunreach-host-routing`.

## Kontext — KORRIGIERTE Root-Cause (widerlegt die ADR-019-Daemon-These)

Frühere These „Daemon-Dial-Bindung an en10 / Code-Fix" ist **widerlegt**. Verifizierter Test (Orchestrator, 14.06.): bei **komplett gestopptem .55-Daemon** scheitert `node net.connect` zu den Mesh-Peers **trotzdem** mit `EHOSTUNREACH` → es ist **NICHT** der Daemon/Code.

Gemessen auf .55 (macOS, en10 über WD-D50-Thunderbolt-Dock, 100baseTX degradiert/flapping):
- ICMP ping zu LAN-Peers OK; TCP zu Gateway:443 + Internet OK; **TCP zu 10.10.10.{52,56,80,82,94,222}:{9440,9540,22} = EHOSTUNREACH** (destination- UND tcp-spezifisch).
- pf disabled, WiFi aus, `route flush`/`arp -d` helfen nicht — IFSCOPE'd cloned host-routes (`UHLWIi`) klonen sofort zurück.
- **Root-Cause = festgefahrene macOS-Netzstack-/Interface-Korruption, sehr wahrscheinlich Dock-HW.** Direkter Fix = Reboot/Dock-Power-Cycle = **physisch (FileVault), rekurriert ~12h.**
- **Tailscale funktioniert:** .55 = `100.88.169.84`; .94↔.55 über `100.x` TCP bestätigt OK.

Konsequenz: **Kein Daemon-Code-Fix behebt .55s LAN-Outbound.** Jede mesh-seitige Lösung muss .55s Traffic über einen funktionierenden Transport routen — der einzige verifizierte ist Tailscale.

## Zwei-Ebenen-Architektur (verifiziert im Code)

- **HTTP-Plane (Fastify mTLS, :9440) = CORE.** static_peers, agent-card-fetch, SKILL_ANNOUNCE, REGISTRY_SYNC, `/health`-Heartbeat → treibt `peers_online`/count/gossip. Bindet auf `0.0.0.0` (hört bereits auf der Tailscale-IF).
- **libp2p-Plane (:9540) = sekundär.** registry-sync-coordinator-Streams. Discovery ist **`@libp2p/mdns`-only** (LAN-Multicast) — **kein** libp2p-Bootstrap / explicit-multiaddr-dial / card→libp2p-Bridge im Code; trägt zudem den vorbestehenden `multiaddrs[0].getPeerId`-Bug.

Config-Knöpfe (existieren, kein Code): `discovery.allowed_mesh_cidrs` (gatet eigene Mesh-IP-Wahl + akzeptierte Peer-IPs, fail-closed), `discovery.static_peers`, `libp2p.announce_multiaddrs`, `libp2p.relay_{transport,service}_enabled`. **Caveat:** `DEFAULT_EXCLUDE_PATTERNS` schließt `tailscale*`/`utun*` aus (discovery-policy.ts:65-68) — betrifft NUR die EIGENE Mesh-IP-Wahl (.55-self-advertise über Tailscale), NICHT das Dialen von Peers.

## Optionen

| Opt | Was | Bewertung |
|-----|-----|-----------|
| **A** | Tailscale als Overlay-Transport (config-first): `.55` allowed_mesh_cidrs += `100.64.0.0/10`, static_peers → Peers' `100.x:9440` | **HTTP-Plane config-only erreichbar** (verifiziert). libp2p-Plane bräuchte Code (Bootstrap/static-dial) — sekundär/buggy → deferred. Voraussetzung: Tailscale auf jedem Peer, den .55 erreichen muss. |
| **B** | Circuit-Relay-Node (relay_service auf stabilem Knoten) | **Untauglich hier:** .55 erreicht KEINEN LAN-Peer (auch keinen Relay); Relay nur libp2p, nicht HTTP-Core; über Tailscale redundant. |
| **C2** | **Netzkonfig-Reset + Reboot** (von Christian angeregt, durch Interface-Audit gestützt) | **.55-Netzstack ist ein Müllhaufen** (vs sauberes .94): 6 Geister-USB-LAN-Adapter en1-en6 (inactive), Surfshark-WireGuard-Dienst (eingetragen, läuft nicht), 7 utun-Tunnel utun0-6 — aktive Routing-Schicht ist NUR en10 + utun4(Tailscale), Geister/Surfshark/Tailscale also NICHT die bewiesene aktive Ursache, ABER der Cruft + die sofort re-klonenden IFSCOPE'd host-routes deuten auf wedged netstack/stale service-order. **Cleanup (Geister-Services + Surfshark entfernen, stale utuns/Routen prunen) + Reboot** = direkter Angriff auf die wedged-netstack-Hypothese, **ohne HW-Kosten**, restauriert LAN-native (beste steady-state). Physisch/Konsole (FileVault), mit Christian. **Günstigster durable Local-Fix — zuerst versuchen.** Risiko: falls die Wurzel die Dock-HW (100baseTX-Flapping) ist, hält C2 nicht → eskaliere zu C1. |
| **C1** | HW: WD-D50-Dock ersetzen / .55 auf stabile NIC | **Eskalation falls C2 nicht hält** (Dock-HW genuin defekt). Physisch, restauriert LAN-native dauerhaft. |

## Entscheidung (Konsens beider Modelle, trotz Gegen-Stances)

**Einig (beide):** (1) **Option A scoped** als sofortiger HTTP-Plane-Unblock, **entkoppelt** von der Strategie. (2) **Option C** als parallele HW-Behebung. (3) **B ablehnen.** (4) **libp2p-over-Tailscale-Code deferred.** (5) Healthy 6-Node-Core **unangetastet**, keine Fleet-weite Config-Churn.

**Strittig (Christians Entscheid):** Ist Tailscale-Transport eine **strategische Default-Capability** (gpt-5.5: ja — LAN-when-healthy, Tailscale-when-broken, für künftige flaky/NAT/cross-subnet-Nodes) ODER ein **time-boxed Exception-Pfad mit Rollback nach HW-Fix** (gpt-5.3-codex: HW-Incident behandeln, Overlay als Ausnahme, Cross-Subnet später als bewusstes Feature)? Beide: **deliberate design, nicht emergency-driven.**

**Empfehlung (synthetisiert, mit Interface-Audit aktualisiert):**
1. **Primärer durable Local-Fix — ZUERST: Option C2** (Netzkonfig-Reset + Reboot, mit Christian an der Konsole). Günstig, keine HW-Kosten, greift die wedged-netstack-Wurzel direkt an, restauriert LAN-native (sauberster steady-state, keine zweite Trust-Domain). Christians eigene Spur.
2. **Falls C2 nicht hält** (rekurriert → Dock-HW): **C1** (Dock/NIC tauschen).
3. **Sofort-Unblock NUR falls .55 vor dem Konsolen-/Reboot-Fenster ins Mesh muss: Option A** (config-only, scoped, durable via plist-Env — siehe Recipe). Stellt .55s HTTP-Plane her, ohne den Core zu berühren. Sonst nicht nötig, wenn C2 zeitnah möglich ist.
4. **Strategisch (Christians Entscheid):** Tailscale (A) als **dokumentierte Resilienz-/Fallback-Capability** für künftige flaky/NAT/cross-subnet-Nodes behalten (LAN-primary, Overlay-when-broken) ODER als reine Ausnahme. Beide CO-Modelle: deliberate, nicht emergency-driven.
5. **Deferred:** B + libp2p-over-Tailscale-Code; nur falls Cross-Subnet/NAT explizit Produktanforderung wird → eigenes Feature (Config-Profile + libp2p-Bootstrap + getPeerId-Bugfix).

**Entscheidungslogik:** C2 zuerst (billigster sauberer LAN-native-Fix) → hält? fertig, A optional als Fallback-Doku. Hält nicht? C1 (HW). .55 muss vor dem Reboot-Fenster ins Mesh? A als config-only-Brücke. A-als-Strategie = Christians Weiche.

## Config-Recipe (Option A, .55) — config-vs-code-Grenze

```
# .55 — durable (plist-Env, NICHT bare daemon.toml; sonst beim git pull weg):
TLMCP_ALLOWED_MESH_CIDRS = "10.10.10.0/24,100.64.0.0/10"
TLMCP_STATIC_PEERS       = "<peer>.100.x:9440, ..."   # je Peer den .55 erreichen muss, dessen Tailscale-IP
# .55 behält eigene Mesh-IP = 10.10.10.55/en10 (utun excluded) → Peers erreichen .55 weiter LAN-inbound (funktioniert).
```
- **.55→Peers (peers_online-Unblock): PURE CONFIG**, kein Code, Interface-Exclude irrelevant (betrifft nur self-advertise).
- **Voraussetzung:** Tailscale auf jedem Peer, den .55 erreichen soll (mind. .94 als Anker; ideal alle 6 für volle bidirektionale Sicht).
- **peers→.55-über-Tailscale:** aktuell NICHT nötig (LAN-inbound zu .55 funktioniert). Falls künftig nötig → kleine discovery-policy-Änderung („explizit erlaubtes CIDR überstimmt den Default-Exclude") ODER `advertise_http_host` — **separater Code-Task, deferred.**

## Sicherheit / Blast-Radius
- mTLS/SPIFFE-Identität **unverändert** — Tailscale ist nur Transport/Reachability, NICHT App-Identität. Zweite Trust-Domain (Tailscale-ACLs/Key-Lifecycle) bewusst dokumentieren.
- 6-Node-Core unverändert. Nur .55 + die Peers, die .55 erreichen muss, ändern Config.
- Config-Durability: **plist-Env / committed Defaults**, NIE bare daemon.toml-Edits (revert beim pull — gleiche Klasse wie das emit-Flag, das #170 gelöst hat).

## Offene Punkte (Christian)
1. **Strategischer Entscheid:** Tailscale-Default-Capability vs Exception-Pfad (s.o.).
2. **HW:** Dock-Tausch / NIC-Wechsel auf .55.
3. **.55-Reboot/Config:** NUR mit Christian (FileVault-Lockout 2× passiert). Umsetzung erst auf ausdrückliches Go.
4. ADR-019-Folge (separat): warum klonen die IFSCOPE'd host-routes nach Stunden — braucht Konsolenzugriff.
