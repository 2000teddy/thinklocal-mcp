# ADR-031 — Tailscale als Mesh-Transport (Per-Peer-Policy) — Entscheidungsvorlage T2.5

**Status:** Proposed (ENTSCHEIDUNGSVORLAGE / DRAFT — Q4/Q5 offen, KEINE Umsetzung und KEINE Transport-Umstellung ohne Christians ausdrückliches Go)
**Datum:** 2026-07-01
**Kontext-Task:** V5 T2.5 (Spur 2) — „Tailscale-Transport-ADR", Vorlage für die Christian-Entscheide **Q4** (Failover-Politik) + **Q5** (Relay-Strategie).
**Owner:** A (Admin) · Review C (Christian entscheidet Q4/Q5)
**Konsolidiert aus** (read-first, keine neue Herleitung): Admin-Decision-Prep-Drafts
`hermes/reports/2026-06-30-t25-tailscale-transport-adr.md` + `hermes/reports/2026-07-01_t2.5-transport-adr-draft.md`.
**Verwandt:** ADR-027 (Overlay-Transport für flaky-LAN/NAT-Nodes), ADR-019 (Multi-Interface-Discovery), ADR-025 (Static-Peer-Join). V5-WORKING K1 (Tailscale „optional, pro Peer auch Hauptverbindung, unter mTLS/SPIFFE").

> **Charakter dieses Dokuments:** reine Optionsvorlage. Es präjudiziert **keine** Live-Entscheidung,
> ändert **keine** Konfiguration, stellt **keinen** Peer um und deployt nichts. Die eigentliche
> Transport-Entscheidung (Q4/Q5) trifft Christian; erst danach folgt die Umsetzung als eigener Slice.

## 1. Problem

Das Mesh braucht einen belastbaren Transport zwischen Peers, die teils **LAN-koloziert**
(TH01/TH02/iobroker/influx), teils **roaming** sind (MacBook, iPad — aktuell offline). Reines
LAN-TCP erreicht Roaming-Peers nicht; ein reiner externer Relay verschenkt LAN-Latenz und macht
das Heimnetz von Fremd-Infra abhängig. Zu klären ist, **ob und wie** Tailscale als Haupt- und/oder
Fallback-Transport eingebunden wird — **ohne** die Identitäts-/AuthZ-Schicht (mTLS/SPIFFE)
aufzuweichen. V5 fordert dazu ein zentrales ADR, das den bisherigen Widerspruch auflöst (Tailscale
optional **unter** mTLS, Fallback **und** erlaubte Hauptverbindung, Entscheidung **pro Peer**).

## 2. Live-Belege (TH01, read-only, 2026-07-01)

| Fakt | Wert |
|---|---|
| tailscale | **1.98.4**, Self `ThinkHub` 100.103.115.126, DERP-Home **`fra`** (Frankfurt), MagicDNS `tail4a96c9.ts.net` |
| Peers | 4: `thinkhub02` (online), `minimac` (online), `macbook-pro` (offline 14 h), `ipad157` (offline 13 d) |
| Pfad TH01→TH02 über TS | `pong … via 10.10.10.82:41641 in 2ms` → **direkter LAN-Pfad**, NICHT über DERP |
| Pfad TH01→minimac über TS | `pong … via 10.10.10.94:41641 in 4ms` → **direkter LAN-Pfad** |
| Roh-LAN TH01→TH02 (ohne TS) | `rtt avg 0.20 ms` |

**Kernbefund:** Auf dem gemeinsamen LAN wählt Tailscale automatisch den **Direktpfad** über die
10.10.10.0/24-IPs (WireGuard, ~2–4 ms); der `fra`-DERP ist reiner Fallback für Peers ohne
Direktpfad (Roaming/NAT). Tailscale liefert also verschlüsselten Transport **ohne** LAN-Latenz zu
verwerfen — und einen funktionierenden Pfad, sobald ein Peer das LAN verlässt.

## 3. Annahmen

- mTLS/SPIFFE bleibt **die** Identitäts-/AuthZ-Schicht; Tailscale ist **nur Transport**
  (Defense-in-Depth — Tailscale-ACLs ersetzen keine Tool-Gates). Server-Pinning bleibt.
- 1 Nutzer, ≤ 6 aktive Knoten, Heimnetz. Kein Enterprise-Bedarf (Anti-Scope).
- LAN-TCP bleibt schnellster Pfad für kolozierte Peers; Roaming-Peers brauchen einen routbaren
  Pfad, den nur ein Overlay (Tailscale) verlässlich liefert.
- Tailnet ist bereits ausgerollt und funktionsfähig (Live-Belege §2).

## 4. Optionen

### Achse A — Failover-Granularität (→ Q4)

| | A1: Global Auto-Failover | **A2: Pro-Peer (empfohlen)** |
|---|---|---|
| Prinzip | eine mesh-weite Kaskade `LAN→TS→HTTPS` für alle Peers gleich | jeder Peer definiert Haupt- + Fallback-Transport individuell |
| Pro | einfachste Config, ein Regelsatz | koloziert=LAN-TCP schnell, roaming=TS-Haupt; matcht K1; Fehlerbilder bleiben sichtbar/debugbar |
| Contra | zwingt Roaming-Peers in denselben Pfad wie LAN-Peers; versteckt Netzrealität hinter Magie; implizite Pfadwechsel erschweren Fehlersuche | etwas mehr Config/Denkarbeit pro Peer |

### Achse B — Relay-Architektur (→ Q5)

| | B1: TH01 `relay_service` (self-hosted DERP) | **B2: Tailscale-only DERP / kein Beta-Relay (empfohlen)** |
|---|---|---|
| Prinzip | TH01 betreibt eigenen Relay für Fallback | Tailscale-eigene DERP-Infra (`fra`) als Fallback; `relay=disabled` |
| Pro | keine Fremd-Infra im Fallback-Pfad, volle Kontrolle | null Betriebslast; funktioniert live bereits; kleinster Beta-Umfang, kein zusätzlicher SPOF |
| Contra | **vergrößert Hub-SPOF** (TH01 trägt schon CA/Vault/MCPs); Betriebs-/Update-Last | Fallback-Pfad hängt an Tailscale-Koordination/DERP (extern) |

## 5. Empfehlung (nicht bindend — Q4/Q5 bleiben Christians Entscheid)

**A2 (pro-peer) + B2 (Tailscale-only DERP, kein Beta-Relay)**, Kaskade pro Peer:

1. **Kolozierte Peers** (TH02, iobroker, influx): `preferred=lan` **Haupt** → `tailscale` Fallback.
2. **Roaming-Peers** (MacBook, iPad, ggf. Minimac auswärts): `preferred=tailscale` **Haupt**
   (Direktpfad im LAN, DERP außerhalb) → HTTPS-Fallback als letzte Stufe (dessen Notwendigkeit ist
   offen — siehe §7 Punkt 4).
3. **mTLS/SPIFFE unverändert** über allen Transporten; Tailscale nie als AuthZ genutzt.
4. **Kein self-hosted Relay auf TH01** für die Beta (`relay=disabled`) — vermeidet zusätzliche
   SPOF-Last; falls später Fremd-DERP-Unabhängigkeit gewünscht, als eigenes M-Ticket nachziehen.

Begründung: matcht K1 wörtlich, nutzt die Live-Realität (TS geht auf LAN ohnehin direkt), hält TH01
schlank (Anti-Scope) und liefert Roaming-Fähigkeit ohne Extra-Betrieb. Identität bleibt bei
mTLS/SPIFFE, der Transport darf pragmatisch sein.

### Vorschlagstaugliche Policy-Formulierung (aus dem 06-30-Draft, für die spätere Umsetzung)

```text
transport_policy per peer:
- preferred: lan | tailscale
- fallback:  none | tailscale | lan
- identity:  mtls/spiffe (mandatory)
- relay:     disabled by default
```

**Beta-Defaults:**
- gleiche L2/L3-Sicht + stabile Direktverbindung → `preferred=lan`, `fallback=tailscale`
- schwieriger / nur via Tailnet sauber erreichbarer Peer → `preferred=tailscale`, `fallback=none`
- `relay=disabled`

## 6. Risiken & Gegenmaßnahmen

- **Fremd-Abhängigkeit im Fallback** (Tailscale-Koordination/DERP down) → LAN-Direktpfad ist
  DERP-unabhängig; optionaler HTTPS-Fallback als dritte Stufe bleibt möglich.
- **Transport-Vertrauens-Illusion** („Tailscale fühlt sich sicher an") → mTLS/SPIFFE + Tool-Gates
  bleiben Pflicht; Tailscale-ACL nur als grobe Netzgrenze (Defense-in-Depth), nie als AuthZ.
- **Split-Brain der Pfadwahl** (Peer nimmt langsamen DERP trotz LAN) → `tailscale ping` bestätigt
  Direktpfad; Monitoring-Probe je Peer (Haupt-Pfad-Verlust an den T2.2-Alert-Sink melden).
- **Roaming-Peer offline** (iPad 13 d) → kein Transport-Problem, sondern Präsenz; Registry-Health
  deckt das ab. TH02/Failover-Backup bleibt separates Thema (T1.4/M12) — Tailscale erfindet keine Backups.

## 7. Offene Christian-Entscheide (Q4/Q5) — NICHT im Repo/ADR präjudiziert

1. **Q4 — Failover-Politik:** Tailscale als Haupt-Transport **pro Peer** freigeben?
   (Empfehlung: ja für Roaming-Peers; für kolozierte Peers nur Fallback; LAN bleibt bevorzugt.)
   → pro Peer-Klasse bestätigen/ablehnen.
2. **Q5 — Relay-Strategie:** Tailscale-only DERP / `relay=disabled` (empfohlen) **oder** self-hosted
   `relay_service` auf TH01? → bei self-hosted zusätzlich klären: wer betreibt/updated ihn,
   akzeptierter SPOF-Zuwachs?
3. **Tailnet-ACL-Politik:** grobe Tailscale-ACL (nur Mesh-Peers dürfen 9440/8444) zusätzlich zu
   mTLS setzen? (Empfehlung: ja, default-deny.)
4. **HTTPS-Fallback-Endpoint:** über welchen Hostnamen/Port läuft die dritte Stufe, wenn weder LAN
   noch Tailscale steht? (Evtl. nicht nötig, wenn TS-Verfügbarkeit akzeptiert wird.)

## 8. Konsequenz / nächster Schritt

- **Positiv:** Sicherheitsgrenze bleibt klar (AuthN/AuthZ nicht an Tailscale koppeln); Betriebsmodell
  bleibt klein; Q4/Q5 werden entscheidbar, ohne ThinkWAN vorwegzunehmen.
- **Offen:** Per-Peer-Policy braucht später eine sichtbare Konfigurationsstelle; die Relay-Frage wird
  vertagt, nicht endgültig gelöst.
- **Reihenfolge:** (1) Christian zurrt Q4/Q5 fest → (2) Policy-Felder in der ThinkLocal-Config
  verankern → (3) erst danach den Modell-B-Transportpfad (T3.x) gegen diese Entscheidung umsetzen.

---
*Reine Entscheidungsvorlage. Keine Konfig verändert, keine Peers umgestellt, kein Deploy, kein
Christian-Ping. Status bleibt Proposed bis Q4/Q5 entschieden sind.*
