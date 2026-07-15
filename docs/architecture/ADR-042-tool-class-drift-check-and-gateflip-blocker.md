# ADR-042 — Live-Drift-Check + TL-08-Gate-Flip-Blocker (TL-08 Slice 2c, partiell)

**Status:** Accepted (Drift-Check) + **Blocked-dokumentiert** (Gate-Flip)
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-08 Slice 2c. Liefert die **live Drift-Check-Verdrahtung** (secret-sicher) und
**dokumentiert den Blocker** für den Gate-Flip (sensitive → allow-with-redaction). Folge auf ADR-039/040/041.

## Teil 1 — BLOCKER: Gate-Flip + Safe-Field-Kuratierung (nicht in diesem Slice)

Der 2b-CO (ADR-041) machte den Gate-Flip von einer **kuratierten Safe-Field-Allowlist** abhängig (ohne sie
ist die Redaction entweder nutzlos = alles redigiert, oder unsicher = geratene Safe-Felder failen open).
Die Kuratierung sollte aus **echten Output-Schemata** kommen.

**Befund (Subagent-Analyse der live `tools/list`-Fixture, 2026-07-15):** **KEINES** der 10 sensitiven
unifi-Tools (`get_wlan`/`list_wlans`/`get_network`/`list_networks`/`list_wans`/`get_voucher`/
`list_vouchers`/`list_radius_profiles`/`list_vpn_servers`/`list_vpn_tunnels`) deklariert ein
`outputSchema`. Die 33 vorhandenen Output-Schemata gehören ausschließlich Mutations-Tools und sind opak
(`{additionalProperties:true, title:'…DictOutput'}` — FastMCP-`-> dict`-Konvention, keine Feld-Namen). Die
Tool-Antworten kommen als MCP-text-content (`content[0].text` = JSON-stringifizierte Daten).

**Konsequenz — der Gate-Flip ist BLOCKED:** die Antwort-Feldnamen der sensitiven Tools sind nur zur
**Laufzeit** erfahrbar. Sie zu sampeln hieße die 10 credential-Tools **aufzurufen** → echte Secrets
(PSK/Passwort/Voucher/RADIUS/IPsec) landen in Kontext/Logs — **genau die Exposition, die TL-08 verhindert.**
Ein secret-sicherer Schema-Pfad existiert nicht.

**Unblock-Pfade (secret-sicher, in Präferenz-Reihenfolge):**
- **(c) Doku-/Quell-abgeleitete Kuratierung (empfohlen, CR-Ergänzung):** die Antwort-Feldnamen sind
  **statisch** verfügbar — aus der öffentlichen UniFi-Controller-API-Doku und der Quelle des FastMCP-unifi-
  Servers (der die zurückgegebenen Felder benennt). Ein Kurator transkribiert die Safe-Field-Allowlist
  **ohne jeden Tool-Aufruf und ohne Secret**, auditierbar. Das ist der auditierbarste Weg und braucht weder
  Sampling noch Live-Werte — aber es ist **substanzielle manuelle Kuratierung** (externe Quellen, nicht in
  diesem Repo) → eigener Slice.
- **(a) Christian stellt eine sanitisierte Safe-Field-Liste** je Tool bereit (Feld-Namen, keine Werte).
- **(b)** Christian autorisiert einen **secret-sicheren Sampling-Harness**, der die Tools EINMALIG aufruft
  und **VOR jedem Log/Kontext** über `redactByAllowlist` (deny-by-default) läuft, sodass nur die
  **Struktur/Feldnamen** (nie Werte) extrahiert werden. (Am riskantesten — nur falls (c)/(a) nicht praktikabel.)

Erst mit der kuratierten Liste ist der Gate-Flip (sensitive → self) sicher **und** nützlich — dann als
eigener Security-CR (inkl. nested-JSON-`content[].text`-Redaction + Tool-Name-Casing-Härtung, die zusammen
mit dem Flip greifen). Bis dahin bleiben die sensitiven Tools **gegatet** (fail-closed, ADR-039/040).
**In dieser Lane autonom nicht lieferbar** (externe Quellen/Christian-Input nötig).

## Teil 2 — Live-Drift-Check-Verdrahtung (in diesem Slice, secret-sicher)

ADR-040 lieferte `computeToolClassDrift` (reiner Snapshot-Lint). 2c ergänzt die **live** Verdrahtung als
testbaren Seam `checkToolClassDrift(server, fetchTools, log)`:
- `fetchTools(server)` liefert die **live** Tool-Namen (`tools/list` — **secret-sicher**: nur Namen +
  Input-Schemata, keine Werte).
- Berechnet `computeToolClassDrift(classes, live)` und **warn-loggt** `staleReadOnly`/`staleSensitive`
  (Map-Eintrag nicht mehr im Inventar) + `unclassified` (neues read-Verb-Tool, weder readOnly noch sensitive
  noch consensus → **kuratieren**). Ungoverned Server → `null`. Fetch-Fehler → `null` + warn (fail-safe,
  nie Crash).

**Verdrahtungs-Plan (Folge-Slice, nicht hier):** ein periodischer/Startup-Hook in `index.ts` ruft
`checkToolClassDrift` je governed Server gegen `mesh`/`mcp_list_tools`. In 2c bewusst **nur der getestete
Seam + Plan** (die Live-Fetch-Verdrahtung ist Laufzeit-/Mesh-abhängig; hier kein Deploy/Fenster).

## Konsequenzen
- **+** Der Drift eines governed Servers (neue/entfernte Upstream-Tools) wird sichtbar statt still —
  operatives Kurations-Signal, secret-sicher.
- **0** **Kein** Gate-Verhalten geändert; sensitive Tools bleiben gegatet.
- **−** Der eigentliche Gate-Flip bleibt **BLOCKED** bis zur Christian-gated Safe-Field-Kuratierung —
  ehrlich dokumentiert statt unsicher geraten.
