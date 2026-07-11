# ADR-035 — Discovery-Resilienz: Peer-Persistenz, aggressives Re-Learn, Hub-verankerte Pull-Discovery

- **Status:** Proposed (2026-07-11)
- **Auftrag:** Christian (via Fable-5, 11.07. 22:05) — „Discovery überlebt Neustart-Wellen nicht."
- **Kontext-Report:** `hermes/reports/2026-07-11_2200_discovery-restart-rootcause.md`
- **TODO:** `[v5.1] TL-25a` (dieser PR) + `TL-26…TL-29` (Folge-Slices)
- **Bezug:** ADR-019 (mDNS-Interface-Pin), ADR-025 (mDNS abschaltbar/static-only),
  ADR-026 (symmetrische Async-Discovery), ADR-032 (Phantom-Announce-Guard).

## Problem (verifiziert)

Nach Daemon-Neustart-Wellen (Wochen-Rhythmus, 10./11.07.) fanden sich Knoten stundenlang
nicht wieder: mDNS-Discovery kam nicht zurück, „Unknown sender" 403 blieb bestehen, der
ADR-026-Async-Learn löste NICHT auf (u.a. „leere remoteAddress — kein Card-Fetch"). Live-
Workaround: `static_peers` in `daemon.toml` (Marker `static-peers-heal-0711`).

Christian wörtlich: *„Es kann nicht sein, dass die Daemons Ausnahmesituationen wie einen
Eintrag in der daemon.toml brauchen."* Und: eine statische Liste skaliert bei 1000+ Knoten nicht.

## Root-Cause (drei Ebenen)

1. **Keine Peer-Persistenz.** `MeshManager` (`mesh.ts`) hält `peers` und `authenticatedSeen`
   in In-Memory-`Map`s — **keinerlei Persistenz**. Ein Restart = **totale Amnesie**; das
   gesamte Peer-/Auflösungs-Wissen muss neu aufgebaut werden.
2. **mDNS ist one-shot + fragil.** `MdnsDiscovery.publish()`/`browse()` laufen je EINMAL beim
   Start; **kein periodisches Re-Announce/Re-Query**. In einer Neustart-Welle kommen Knoten
   zeitversetzt hoch → wer die Query/den Announce des anderen verpasst, sieht ihn nicht wieder.
   Auf dual-homed macOS zusätzlich die bekannten mDNS-Pathologien (ADR-019/025).
3. **Der Async-Learn-Fallback (ADR-026) ist rein reaktiv + spröde.** Er triggert nur bei einem
   authentifizierten Inbound-SKILL_ANNOUNCE, macht **einen einzigen** Card-Fetch-Versuch und
   scheitert fail-closed bei leerer `remoteAddress` (`inbound-peer-learner.ts:68`). Während einer
   Welle (Peer-HTTP-Server noch nicht oben) schlägt der eine Versuch fehl → Peer bleibt unbekannt.

Netto: „online" (Daemon antwortet im Discovery) ≠ „auflösbar/gepaart". Nur eine Strecke
(TH01↔.52) funktionierte zuverlässig; der Rest hing an mDNS-Glück oder `static_peers`.

## Entscheidung

Zwei Stoßrichtungen, gestaffelt:

### A) Resilienz-Fix für das bestehende Discovery-Modell (kurzfristig, mehrere Slices)

- **A1 — Peer-Cache-Persistenz:** Verifizierte/attestierte Peer-Auflösungen (kanonische
  `node/<PeerID>` → publicKey/endpoint/certFingerprint) + die AUTHN-only-seen-Map atomar nach
  `data_dir/mesh/peer-cache.json` schreiben (WAL-artig, `chmod 600`) und beim Boot **validierend**
  laden. **Sicherheit:** der Cache ist nur ein *Auflösungs-Cache* (AUTHN), NIE Autorisierung —
  ein geladener Eintrag wird beim ersten Kontakt gegen das live präsentierte, issuer-gepinnte
  Cert re-verifiziert (fail-closed: Mismatch → Eintrag verwerfen). Kein Trust-Upgrade durch den
  Cache. Approval/Pairing bleibt separat (`paired-peers.json`, ADR-001-Gates).
- **A2 — Aggressives Re-Learn nach eigenem Start:** Beim Boot proaktiv die persistierten Peers
  (+ `paired-peers.json`-Peers) anpingen/Card-fetchen (mit Backoff), statt auf einen Inbound zu
  warten. Damit ist die Auflösung nach ≤ wenige Sekunden wiederhergestellt, ohne mDNS-Glück.
- **A3 — Card-Fetch-Retry mit Backoff** (⟵ **dieser PR, Slice 1**): der Async-Learn und das
  Re-Learn wiederholen den Card-Fetch bei transienten Fehlern (ECONNREFUSED während einer Welle)
  mit exponentiellem Backoff statt nach einem Versuch aufzugeben. Reine, injizierbare Retry-Logik.
- **A4 — Periodisches mDNS-Re-Query + robustere `remoteAddress`:** Browser periodisch neu
  abfragen (bonjour `update()`); leere `remoteAddress` aus der mDNS-/Cache-bekannten Adresse des
  Peers substituieren statt fail-closed abzubrechen.

### B) Ziel-Architektur: Hub-verankerte Pull-Discovery (strategisch, ADR-Kern)

Vollvermaschtes mDNS-Broadcast skaliert nicht (O(n²) Announce-Last, LAN-only, Wellen-fragil).
**Neues Standardmodell:** jeder Node kennt **einen Hub** (statisch, 1 Eintrag statt N), meldet
sich beim Hub an (mTLS, issuer-gepinnt) und **pullt** periodisch die Peer-Liste vom Hub
(„Node kennt Hub, Hub kennt alle"). mDNS wird zum **LAN-Bonus** (Zero-Config im selben Segment),
nicht zur Grundlage.

- **Skaliert:** O(n) statt O(n²); der Hub ist die einzige „muss-bekannt"-Adresse.
- **Wellen-fest:** nach Restart pullt der Node die Liste vom Hub — kein Broadcast-Glück nötig.
- **Sicherheit:** der Hub verteilt nur *attestierte* Identitäten (issuer-gepinnt); die
  Auflösung bleibt AUTHN, Autorisierung bleibt bei den ADR-001-Gates. Hub-Ausfall → Nodes fallen
  auf Cache (A1) + mDNS-Bonus + `static_peers` zurück (Redundanz, kein Single Point of Failure für
  bereits gecachte Peers).
- **Kompatibel:** baut auf der bestehenden Agent-Card + `discover_peers` + Registry-Sync auf; der
  Hub exponiert die schon vorhandene Peer-Liste als Pull-Endpoint (`/api/mesh/peers`, mTLS).

## Konsequenzen

- **Positiv:** Neustart-Wellen heilen selbst (Cache + Boot-Re-Learn + Hub-Pull); `static_peers`
  wird optionaler Fallback statt Pflicht; skaliert auf 1000+ Knoten; „online" ⇒ bald „auflösbar".
- **Kosten:** Persistenz-Format + Migrations-/Validierungspfad; ein Hub-Pull-Endpoint + Client;
  Hub wird prominenter (aber kein SPOF dank Cache/mDNS/static-Fallback).
- **Sicherheit:** strikt AUTHN-only im Cache/Pull; Re-Verifikation gegen live-Cert beim ersten
  Kontakt; keine persistierte Autorisierung. Fail-closed bei jedem Mismatch.

## Umsetzung (Slices)

| Slice | Inhalt | TODO | Status |
|-------|--------|------|--------|
| **A3** | Card-Fetch-Retry mit Backoff (Learner) | TL-25a | **dieser PR** |
| A1 | Peer-Cache-Persistenz (atomar, validierend, AUTHN-only) | TL-26 | offen (CO) |
| A2 | Aggressives Boot-Re-Learn aus Cache + paired-peers | TL-27 | offen |
| A4 | Periodisches mDNS-Re-Query + remoteAddress-Fallback | TL-28 | offen |
| B  | Hub-Pull-Endpoint `/api/mesh/peers` + Client + Fallback-Kette | TL-29 | offen (CO) |

Jeder Slice: eigener PR, Tests, CR, PC, DO (COMPLIANCE-Pflicht). A1/B berühren Trust-nahe Pfade
→ CO (Konsens) vor dem Code empfohlen.
