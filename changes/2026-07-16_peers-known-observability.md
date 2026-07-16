# changes/2026-07-16 — feat(status): `peers_known`/`peers_offline` — Phantom-ROT von unten sichtbar (KW29 Bug-Pfad 1)

**Typ:** additive Observability-Erweiterung + Diagnose-Doku. **Kein** Deploy/Secret/Christian-Gate,
**kein** geändertes Peer-/Heartbeat-Verhalten, **keine** brechende Contract-Änderung (nur additive Felder).
Folge-Slice zum Evidence-Pack #272 (dort: Konsumenten→Knoten-Transport-Phantom-ROT).

## Warum
`/api/status` exponierte nur `peers_online = getOnlinePeers().length` (`status==='online'`). Der Online-
Status wird ausschließlich vom HTTP-Heartbeat gehalten (`mesh.ts checkPeers` → `fetch(.../health,
{dispatcher: tlsDispatcher})`, `rejectUnauthorized:true`). Schlägt der **ausgehende** Heartbeat fehl
(CA-Rotation / fehlender IP-SAN / EHOSTUNREACH — die bekannten Fleet-Blocker), fallen Peers nach
`heartbeat_timeout_missed=3` auf `status='offline'`, **bleiben aber im `peers`-Map**. Ergebnis:
`peers_online` sinkt (bis auf 0), obwohl der Knoten die Peers weiter kennt → ein naives Board liest ROT.
Ein externer Konsument konnte **„0 bekannt (echt allein)"** nicht von **„N bekannt, 0 Heartbeat-online"**
unterscheiden — beide sahen als `peers_online:0` identisch aus.

**Live-Beleg (TH01, 2026-07-16, cert-auth):** `/api/status.peers_online=3`, agent-card
`mesh.peers_connected=6`, `libp2p.connected_peers=4`, Audit `PEER_JOIN=958 / PEER_LEAVE=834` (Flapping).
→ 6 Peers bekannt, nur 3 online, 3 bekannte-aber-offline. Siehe `docs/DIAGNOSE-api-status-phantom-rot.md` §9.

## Was
- **`mesh.ts`** — neu `MeshManager.getPeerCounts(): { known, online, offline }` aus **einem** Map-Snapshot
  (`known` = `peers.size`, `online` = `status==='online'`, `offline` = Rest inkl. `'unknown'`;
  Invariante `known === online + offline`).
- **`dashboard-api.ts` `/api/status`** — ein `getPeerCounts()`-Snapshot; `peers_online` unverändert in der
  Semantik (jetzt `peerCounts.online`), zusätzlich `peers_known` + `peers_offline`.
- **`mcp-server.ts` `mesh_status`** — dieselben drei Felder aus einem Snapshot.
- **`mesh-client.ts` / `dashboard-ui/src/api.ts`** — Interface-Felder `peers_known?`/`peers_offline?`
  (optional → nicht-brechend für bestehende Konsumenten).

## Bewusste Grenze
Reine **Sichtbarmachung** der Klasse — das eigentliche Cert-/CA-/SAN-Heilen bleibt die bekannten
Christian-gated Fleet-Blocker (`[[mesh-ca-rotation-repair-all]]`, `[[th55-pathA-cert-san-blocker]]`,
`[[th55-ehostunreach-host-routing]]`), **out of scope**. `peers_offline` fasst `offline`+`unknown`
zusammen (dokumentiert) — die feinere Aufschlüsselung ist nicht nötig für den Diskriminator
`known>0 && online==0`.

## Compliance
- **CO:** entfällt — additive Observability, eine kleine Design-Entscheidung (atomarer Snapshot,
  `offline` inkl. `unknown`) ist in `mesh.ts`-JSDoc + Diagnose-Doku §9 begründet.
- **CG:** n/a.
- **TS:** `mesh.test.ts` — **5 Unit-Tests** für `getPeerCounts` (leer, alle online, bekannte-aber-offline
  Kern-Invariante, worst-case known>0/online==0, `known===online+offline`); `dashboard-api.test.ts` — **1
  Test** dass `/api/status` `peers_known`/`peers_offline` aus `getPeerCounts` exponiert + Mock ergänzt.
  Voller daemon-Lauf **1706 grün**, tsc(strict) 0, geänderte Source-Dateien 0-neue-Lint (getPeerCounts-
  Region lint-clean; Baseline-Violations in mesh.ts unverändert).
- **CR:** adversarialer Claude-Subagent — **APPROVE, keine HIGH/MEDIUM**. Unabhängig verifiziert:
  Invariante `known===online+offline` by-construction; `peerCounts.online===getOnlinePeers().length`
  (Umstellung ändert keinen beobachtbaren Wert); additive Felder brechen keinen Konsumenten; **kein neuer
  Leak** (`peers_known`===`mesh.peerCount`, bereits via agent-card `peers_connected` exponiert; nur Integer);
  Snapshot **atomar** (synchroner Loop, kein `await`). 1 LOW (kein MCP-`mesh_status`-Feld-Test — trivialer
  Passthrough) **bewusst nicht gefixt** (Reviewer: „not worth a finding"). Reviewer lief Tests (53 grün) + tsc(0).
- **PC:** `git diff --cached` gesichtet; Secret-Scan clean.
- **DO:** `docs/DIAGNOSE-api-status-phantom-rot.md` §9, `docs/API-REFERENCE.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`, `TODO.md`, dieser Eintrag.
