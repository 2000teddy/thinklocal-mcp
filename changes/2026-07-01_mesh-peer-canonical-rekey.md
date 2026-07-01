# 127a — Mesh-Peer-Eintrag bei krypto-attestiertem Flip auf kanonische agentId umschlüsseln

**Datum:** 2026-07-01
**Branch:** `claude/mesh-peer-canonical-rekey`
**Typ:** Kosmetisch / Map-Bookkeeping (keine Autorisierungs-/Binding-Semantik) · TODO.md #127(a) · ADR-022
**V5-Bezug:** ThinkLocal-Lane, Fortsetzung der 127er-Follow-ups (#225/#226).

## Problem

`MeshManager.peers` ist `Map<agentId, MeshPeer>`. Nach einem **krypto-attestierten** Identity-Flip
(`markPeerIdVerified(peerId, senderUri, …)`, `senderUri` kanonisch = `node/<PeerID>`) blieb der
Ziel-Eintrag unter seiner **Legacy**-agentId (`host/<id>`) gekeyed, und `peer.agentId` trug weiter die
Legacy-URI. Die Auflösung (`resolvePeerPublicKey`) lief zwar immer schon über
`peer.libp2p.peerId === wantPeerId && peerIdVerified` — **unabhängig vom Map-Key** (daher „funktional
gelöst") —, aber Bookkeeping/Logs/`mesh_status` zeigten die veraltete Legacy-Identität.

## Lösung

Im bereits **krypto-attestierten** kanonischen-Flip-Block von `markPeerIdVerified` (nach der
Duplikat-Supersession) wird der Eintrag auf die kanonische agentId (`= senderUri`) umgeschlüsselt:
Map-Key + `peer.agentId`. Reine Key-/Darstellungs-Konsistenz — **keine** Änderung an Auflösung,
Autorisierung oder PeerID-Bindung.

**Eng gehalten (Guardrails):**
- Nur im **eindeutigen PeerID-Pfad** (Ziel via exaktem `senderUri`-Match oder `byPeerId`). Im
  schwächeren **`remoteHost`-Host-Bind-Fallback** (fragile `.56/.222`-Flip-Nodes, deren kanonische
  Identität via mDNS/Card noch nicht propagiert ist) wird **NICHT** umgeschlüsselt (`targetViaRemoteHost`-
  Flag) — deren Verhalten bleibt unverändert.
- **Defensiv:** Re-Key nur, wenn der Zielschlüssel frei oder bereits `t` ist (`occupant`-Guard) → keine
  Fremd-/Duplicate-Key-Überschreibung.
- **Transaktional:** Der `rollback()`-Hook (den `agent-card.ts` bei fehlgeschlagener Envelope-Signatur
  ruft) dreht das Re-Key vollständig zurück (kanonischer Key weg, Legacy-Key + agentId + Bindung
  restauriert) **vor** dem Restore der superseded Duplikate.

## Tests (`mesh.test.ts`)

- **127a Re-Key:** krypto-attestierter Flip (Discovery-Lag, nur Legacy-Eintrag) → Eintrag unter
  kanonischer agentId auffindbar (Key + Feld), Legacy-Key weg, **kein** Offline-Event, Auflösung
  unverändert.
- **127a Rollback:** `rollback()` stellt Legacy-Key + agentId + `peerIdVerified=false` wieder her.
- **127a keine Fremd-Key-Korruption:** ein fremder Peer bleibt beim Flip vollständig unberührt;
  genau zwei Einträge, keine Verwaisung/Dopplung.
- **Angepasst (reine Bookkeeping-Anpassung, Security-Assertion unverändert):** der „spoof-sicher:
  bereits mit ANDERER PeerID verifizierter Host-Eintrag"-Test prüft den überlebenden Eintrag jetzt
  unter der kanonischen `node/OTHER`-agentId (der OTHER-Flip re-keyt über den PeerID-Pfad); der
  Spoof-Schutz (PID-Umbindung → `ok=false`) bleibt asserted.

**Ergebnis:** `mesh.test.ts` **34/34** grün · volle Daemon-Suite **104 Files / 1290 grün** · `tsc` 0 ·
`npm run build` grün. Diff auf `mesh.ts` + `mesh.test.ts` beschränkt.

## Compliance (CO/CG/TS/CR/PC/DO)

| CO | CG | TS | CR | PC | DO |
|----|----|----|----|----|----|
| n/a | n/a | ✅ 3 Regressionstests (Re-Key/Rollback/Key-Integrität) | ✅ Claude-Review | ✅ manuell (tsc/build/suite/diff) | ✅ changes + CHANGES + COMPLIANCE + TODO |

Kein Deploy, kein systemd, kein Live-Gerät, kein Christian-Gate, keine ADR-024/.94/cert-SAN/live-flip-Arbeit.
