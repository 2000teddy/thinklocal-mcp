# ADR-020 Phase 1.1 — libp2p Auto-Dial nach Peer-Discovery

**Status:** Akzeptiert
**Datum:** 2026-05-19
**Autor:** claude-code (MacBook Pro)
**Konsens:** GPT-5.5 (8/10), Gemini 2.5 Pro (9/10) — siehe `pal:consensus` 5801b78c
**Vorgaenger:** ADR-020 v1+v2 (PR #134, gemerged 2026-05-18)

## Problem

Nach Merge von ADR-020 v1 (RegistrySyncCoordinator + libp2p-Adapter) konvergieren die 5 Mesh-Nodes nicht. Capability-Hashes divergieren stabil seit > 20 Min. `/api/registry/republish` reagiert mit HTTP 200, bewirkt aber nichts.

Live-Diagnose (Mac mini + MacBook Pro):
- Alle 5 Daemons laufen, alle loggen `RegistrySyncCoordinator gestartet (ADR-020 v1)`.
- Danach keinerlei Sync-Aktivitaet im `daemon.log`: kein Stream-Open auf `/thinklocal/mesh/registry/1.0.0`, kein `peer:connect`, keine Round, kein Fehler.
- `tick()` laeuft alle 45 s, aber `this.peers` ist permanent leer.
- mDNS auf OS-Ebene (`dns-sd -B _thinklocal._tcp`) zeigt alle Peers — das ist der bonjour-basierte ADR-019-Layer, separat von libp2p.
- GossipSync (HTTPS-basiert, parallel) importiert Capabilities normal — die Peers sind erreichbar.

## Root Cause

In `libp2p` v3 (genutzte Version: `libp2p@2.10.x`, `@libp2p/mdns@11.0.47`) gibt es **kein eingebautes Auto-Dial** mehr.

Beweisstellen im `node_modules`:

`libp2p/dist/src/libp2p.js:317`:
```js
#onDiscoveryPeer(evt) {
  const { detail: peer } = evt;
  if (peer.id.toString() === this.peerId.toString()) return;
  void this.components.peerStore.merge(peer.id, { multiaddrs: peer.multiaddrs }) ...;
}
```

→ Discovery fuegt Peers ausschliesslich in den `peerStore` ein. Es wird **kein** `dial()` aufgerufen.

In `packages/daemon/src/libp2p-runtime.ts:attachEventListeners()` werden ausschliesslich `peer:connect` und `peer:disconnect` registriert — nirgendwo wird auf `peer:discovery` reagiert. Damit bleibt die Pipeline `mDNS → peerStore → ??? → connection → peer:connect` an der Stelle `???` stecken.

Folge: `RegistrySyncCoordinator.onPeerConnect()` wird nie aufgerufen → `peers`-Map leer → `tick()` und `republish()` sind No-Ops → keine CRDT-Konvergenz.

## Warum die Tests den Bug nicht gefangen haben

`tests/registry-sync-integration.test.ts` simuliert peer:connect manuell auf einem Mock-Libp2p-Node. Der reale Discovery-to-Connect-Pfad wurde nie getestet.

## Entscheidung

In `libp2p-runtime.ts` einen `peer:discovery`-Listener registrieren, der `node.dial(peer.id)` aufruft. Plus defensive Massnahmen gegen Race Conditions und Lograuschen.

### Konkrete Aenderungen

1. **`attachEventListeners()` erweitern** um:
   - `peer:discovery` → Self-Filter → Already-Connected-Filter → In-Flight-Dedup → `node.dial(peer.id).catch(log.debug)`
2. **Listener vor `node.start()`** registrieren, nicht danach — damit fruehe mDNS-Events nicht verloren gehen.
3. **PeerStore-Scan nach `node.start()`** — einmalige defensive Iteration ueber `node.peerStore.all()`, dialt alle bekannten nicht-verbundenen Peers (best-effort).
4. **In-Flight-Set** (`Set<string>` der gerade laufenden Dials) verhindert duplizierte Dials bei wiederholten mDNS-Events.

### Bewusst NICHT in dieser Phase

- **Backoff bei Dial-Fehlern**: Gemini hat das fuer Phase 1.1 als optional eingestuft; libp2p kanns intern. Wenn sich Lograuschen oder Connect-Loops zeigen, folgt ein eigener Hotfix.
- **PeerStore-API-Wrapper**: Wir nutzen `node.peerStore.all()` defensive mit `try/catch`, weil die API zwischen libp2p-Versionen variiert.

## Edge Cases

| Fall | Behandlung |
|---|---|
| Self-Discovery (eigener PeerId via mDNS) | Filter: `peerId === this.state.peerId` |
| Doppelte Discovery-Events (mDNS feuert periodisch) | In-Flight-Set + libp2p-interne Dial-Deduplikation |
| Existing Connection | `getConnectedPeerIds()`-Check verhindert unnoetiges Dial-Logging |
| Multi-Interface-Peer (mehrere Multiaddrs im PeerStore) | `dial(peer.id)` ueberlaesst Addr-Auswahl libp2p — kein App-Logik noetig |
| Dial-Fehler (Peer offline / NAT) | `.catch(log.debug)` — kein App-Crash, libp2p versucht spaeter erneut wenn neues Discovery-Event |
| Race: mDNS feuert vor Listener-Registrierung | Listener vor `node.start()` + PeerStore-Scan nach Start |

## Test-Plan

Beide Modelle einstimmig: **Integration-Test ist Pflicht**.

1. **Unit-Test** (`tests/libp2p-autodial.test.ts`):
   - Mock-`Libp2pNode` mit `addEventListener`/`dial`.
   - Discovery-Event mit Peer-ID feuern → assert `dial(peerId)` aufgerufen.
   - Discovery-Event mit eigener Peer-ID → assert `dial` NICHT aufgerufen.
   - Zweimal dieselbe Peer-ID waehrend in-flight → assert nur ein `dial`.

2. **Integration-Test** (`tests/libp2p-discovery-to-connect.test.ts`):
   - Zwei echte `createLibp2p()`-Instanzen, beide mit mdns + tcp + noise + yamux + identify.
   - Beide starten ueber loopback-Listener.
   - Assert: nach < 5 s feuert `peer:connect` auf beiden Seiten.
   - Assert: die ADR-020-Coordinator-Hooks (via `wireRegistrySync`) bekommen `onPeerConnect` aufgerufen.

3. **Live-Verifikation**:
   - Daemon-Rebuild + Restart auf MacBook Pro.
   - In daemon.log nach < 30 s `peer:connect`-aequivalente Marker sehen.
   - `/api/status` → `registry_sync` zeigt Eintraege fuer alle 4 Peers.
   - Capability-Hash konvergiert auf allen 5 Nodes binnen 60-120 s.

## Compliance-Plan

| Schritt | Status |
|---|---|
| CO (pal:consensus, GPT-5.5 + Gemini 2.5 Pro) | ✅ einstimmig akzeptiert |
| CG (clink gemini) | ⏭ uebersprungen (Bug-Fix, kein Boilerplate) |
| Design-Doku (dieses ADR) | ✅ |
| Code | folgt |
| TS (Unit + Integration + Live) | folgt |
| CR (pal:codereview, GPT-5.5) | folgt |
| HIGH-Findings fixen | nach CR |
| PC (pal:precommit) | folgt |
| Commit + Push | folgt |
| DO (README/CHANGES/TESTING) | folgt |
| PR + Compliance-Table | folgt |
| Live-Test + 5-Node-Rollout | folgt |

## Referenzen

- ADR-020 v1+v2 (`ADR-020-registry-replication-recovery.md`)
- PR #134 (gemerged 2026-05-18)
- Konsens-ID `pal:consensus 5801b78c-c884-4da9-a7a4-5395751e0a65`
- `node_modules/libp2p/dist/src/libp2p.js:317-327` (#onDiscoveryPeer)
- `node_modules/@libp2p/mdns/dist/src/mdns.js:37` (peerDiscoverySymbol)
