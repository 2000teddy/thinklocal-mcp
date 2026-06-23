# Diagnose: Capability-Count-Drift + registry_sync `getPeerId`-Bug (READ-ONLY Befund)

**Erstellt:** 2026-06-15 16:46 (TH01, read-only Diagnose, kein Code-Fix/Produktiv)
**Scope:** Befund + Empfehlung. KEINE Umsetzung — Fix = eigener Sprint-Brocken, Christians Gate.

## TL;DR
Die Capability-Registry **konvergiert NICHT** fleet-weit: gemessene Counts **5 / 18 / 19 / 24 / 24 / 26** auf 6 Nodes (sollten identisch sein, CRDT-Union). **Root-Cause:** `LibP2pRuntime.dialProtocol(peerId: string, …)` (`libp2p-runtime.ts:497`) übergibt einen **String** an `node.dialProtocol()`, aber libp2p v2 erwartet ein **`PeerId`-Objekt** (oder `Multiaddr`). libp2p versucht den String als Multiaddr zu parsen und ruft intern `multiaddrs[0].getPeerId()` → **`multiaddrs[0].getPeerId is not a function`**. Damit scheitert der **Automerge-Sync-Dial** des `RegistrySyncCoordinator` → die CRDT-Sync läuft nur über bereits bestehende (mDNS/inbound) Verbindungen, nicht über den expliziten Coordinator-Dial → **unvollständige Konvergenz = Count-Drift.**

## Belege (live, read-only, 2026-06-15 16:46)
Capability-Count + Owner-Breakdown via `/api/capabilities`:

| Node | Count | Owner-Sicht |
|------|------:|-------------|
| .94  | **5** | nur 2 von 7 Ownern (eigene + .55) — **5 LAN-Peers fehlen ganz** |
| TH01 | 18 | alle 7 Owner, aber **2 Caps/Owner** (≠ .222) |
| .56  | 19 | (teilkonvergiert) |
| TH02 | 24 | alle 7 Owner |
| .52  | 24 | alle 7 Owner |
| .222 | **26** | alle 7 Owner, **4 Caps/Owner** (voll) |

→ Zwei Drift-Ebenen: **(1) fehlende Owner** (.94 hat 5 Peers gar nicht) und **(2) unterschiedliche Cap-Versionen pro Owner** (TH01 2/Owner vs .222 4/Owner) — beides Symptome eines unvollständigen Automerge-Merges. Alle Owner sind **canonical `node/<PeerID>`** — **keine** Legacy-`host/813bdd`-Caps → Identitäts-Dubletten sind NICHT die Ursache.

## Konvergenz-Mechanismus (verifiziert im Code)
- Caps konvergieren via **Automerge-Sync-Protokoll** (`registry-sync-coordinator.ts`: `generateSyncMessage`/`receiveSyncMessage`, Bloom-Filter) über das libp2p-Protokoll `/thinklocal/mesh/registry/1.0.0` (`registry-sync-libp2p-adapter.ts` → `rt.dialProtocol(peerId, REGISTRY)`).
- `rt.dialProtocol` = `LibP2pRuntime.dialProtocol(peerId: string, …)` → `this.node.dialProtocol(peerId, protocol)` mit **String-`peerId`**.
- **libp2p v2 (`^2.10.0`) Signatur:** `dialProtocol(peer: PeerId | Multiaddr | Multiaddr[], …)`. Ein blanker String ist KEIN PeerId → libp2p behandelt ihn als Multiaddr-artig → `multiaddrs[0].getPeerId()` auf einem Nicht-Multiaddr → TypeError.

## Warum „converged:true" für einige Peers trotzdem
Peers mit einer **bereits etablierten** libp2p-Verbindung (mDNS-Auto-Dial / inbound) syncen über den **Protocol-Handler** der bestehenden Connection (kein expliziter `dialProtocol`-by-String nötig) → konvergieren. Peers, die nur über den **expliziten Coordinator-Dial** erreichbar wären, scheitern am `getPeerId` → keine Sync → Drift. Konvergenz hängt damit an der zufälligen Verbindungs-Topologie (z.B. `.94` nach Restart: nur 2 Owner), nicht an einem verlässlichen Sync.

## Empfehlung (Fix — NICHT jetzt umgesetzt)
1. **Fix-Punkt:** in `libp2p-runtime.ts` `dialProtocol` den String in ein PeerId-Objekt wandeln: `peerIdFromString(peerId)` (aus `@libp2p/peer-id`, bereits Dep `^5.1.9`) vor `this.node.dialProtocol(…)`. Alternativ per Multiaddr `multiaddr('/p2p/' + peerId)`. (`hangUpPeer` prüfen — gleiche String→PeerId-Frage.)
2. **Regression-Test:** `dialProtocol` ruft `node.dialProtocol` mit einem **PeerId-Objekt** (nicht String) auf (Mock-node, Typ-Assertion).
3. **Verifizieren:** libp2p-v2-`dialProtocol`-Signatur gegen die installierte Version; nach Fix fleet-weit `/api/capabilities`-Count + `/api/status`-`converged` re-prüfen → identische Counts erwartet.
4. **Sprint-Einordnung:** kleiner Code-PR (CO entfällt — Bug-Fix; TS+CR+PC+DO), Christians Merge-Gate. Sinnvoll VOR/MIT ADR-028 (NIC/Tailscale), da beide den libp2p-Dial-Pfad betreffen.

## Impact / Severity
- **Latente Korrektheit:** Skill-/Capability-Discovery + Routing sehen pro Node eine **unvollständige** Cap-Sicht (z.B. `.94` kennt 5 von 7 Nodes nicht). Gossip/`SKILL_ANNOUNCE` (HTTP-Plane) maskiert es teilweise (propagiert einzelne Caps owner-gegatet), ersetzt aber den vollen Automerge-Merge NICHT.
- **Pre-existing & fleet-weit** (auch auf 92e6058), unabhängig von ADR-026/0.34.9/0.34.10.
- **Kein Daten-/Sicherheits-Leck** — Owner-Gate (`importPeerCapabilities`) bleibt intakt; es ist ein **Vollständigkeits-/Konvergenz**-Problem, kein Integritätsproblem.

## Re-Diagnose 2026-06-23 (B7, read-only von TH01) — Fix gemergt, aber NICHT deployt

**Kernbefund:** Der Code-Fix ist **gemergt** (PR #175 / `4b55f69`, `libp2p-runtime.ts` `toPeerId`/
`peerIdFromString` in `dialProtocol`+`hangUp`), **aber die laufenden Daemons sind älter als der Fix**
→ der Bug ist **im laufenden Prozess weiterhin aktiv**, daher persistiert die Count-Drift.

Belege (live, read-only, 2026-06-23 ~11:33 CEST):
- **TH01-Daemon `ExecMainStartTimestamp = 2026-06-11 10:13:48`**; #175 mergte **2026-06-15 22:58** →
  der laufende TH01-Prozess enthält den Fix **nicht** (4 Tage zu alt).
- **Fleet-Cap-Counts:** `.94=2`, TH01=18 (7 Owner, aber 4/4/2/2/2/2/2 — uneven), `.82=24`, `.52=24`
  → **dieselbe Drift-Signatur** wie am 15.06. (`5/18/19/24/24/26`).
- **TH01-`registry_sync`:** mit 4 direkt-verbundenen Peers `converged:true`, rounds≈23107, 0 Timeouts,
  `last_round` aktuell. Konsistent mit der ursprünglichen Diagnose: über **bestehende** (mDNS/inbound)
  Verbindungen wird gesynct; nur der **explizite Coordinator-Dial-by-String** scheitert weiter am
  `getPeerId` → Peers ohne bestehende Connection (z.B. `.94` → starved auf 2 Caps) konvergieren nicht.
- Canonical `.55` (`node/12D3KooWJSg…`) erscheint registry-seitig (`status:online`) aber `endpoint:null`/
  `peer_id_verified:null` → kein Direkt-Sync-Verhältnis.

**Schlussfolgerung:** B7 ist **kein offener Code-Bug** mehr, sondern ein **Deployment-Gap**. Remedy =
**Daemon-Restart/Redeploy auf #175-Stand** (pro Node), danach `/api/status registry_sync` +
`/api/capabilities`-Count fleet-weit re-prüfen → erwartet identische Counts. Restart/Deploy =
**Christians Gate** (kein autonomer Eingriff). Offene Verifikation NACH Deploy: ob nach #175 ein
**zweiter** Konvergenz-Resteffekt bleibt (Hypothese: nein — die uneven Counts sind durch den
ungefixten Dial vollständig erklärt).

## Nicht die Ursache (ausgeschlossen)
- Identitäts-Dubletten (.55 legacy `host/813bdd` vs canonical) — Breakdown zeigt nur canonical Owner.
- Availability-Side-Map (ADR-020 v2.2, direct-only) — betrifft `availability`, nicht die Cap-Menge.
- mTLS/Trust — die libp2p-Sync nutzt Noise, nicht das HTTP-mTLS-Bundle; der Fehler ist ein Typ-Bug im Dial, kein Trust-Problem.
