# ADR-039 — Gepflegte Read-only-Werkzeugklasse je Server am Hub-Ingress (TL-08 Slice 1)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-08 („Werkzeugname → lesend/schreibend/kritisch → frei/Gate/verweigert; unifi
READ_ONLY/WRITE_OP/DESTRUCTIVE übernehmen"). Folge auf ADR-033 (Tier-Enforcement, Verb-Heuristik als Stopgap).
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — Design
bestätigt + gehärtet (tools/list-Blocker, Kanonisierung, Credential-Reads, Fixture-Test). Beleg:
`~/hermes/reports/2026-07-15_1603_TL08a-consensus.md`.

## Problem
Die Werkzeug-Stufe am Ingress (`deriveToolTier`, `mcp-service-registry.ts`) ist eine **generische
Verb-Präfix-Heuristik** (`list`/`get`→self, `create`/`block`→gate, `delete`→consensus). ADR-033 markierte
sie ausdrücklich als Stopgap: ein Server-Tool mit ungewöhnlichem Verb (oder ein `get_`-benanntes Tool, das
mutiert) wird geraten, nicht gewusst. TL-08 verlangt eine **gepflegte, autoritative Klassen-Map je Server**.

## Entscheidung

**Slice 1: eine gepflegte Read-only-Allowlist je *governed* Server, beginnend mit unifi (echtes
Live-`tools/list`-Inventar, Snapshot 2026-07-15, 67 Tools).**

`SERVER_TOOL_CLASSES: Record<server, { readOnly: ReadonlySet<tool>; consensus?: ReadonlySet<tool> }>`
(Shape schon eskalationsfähig — `consensus?` für spätere Fälle wie `restart_device`, Slice 1 ungenutzt).

`deriveToolTierForServer(server, payload)` (rein, wirft nie):
- **Server kanonisiert** (`canonicalizeServerName` — sonst wäre `/api/mcp/UNIFI` ein Bypass zurück auf die Heuristik).
- **Ungoverned** (kein Map-Eintrag) → `deriveToolTier(payload)` (heutiges Verhalten, **unverändert**).
- **Governed, aber Methode ≠ `tools/call`** (z.B. `tools/list`) → `deriveToolTier(payload)` (→ `self`).
  **Kritisch (CO-Blocker):** ohne diese Delegation würde `tools/list` (Toolname `''`, nicht in `readOnly`)
  zu `gate`→403 und Discovery genau am governed Server brechen.
- **Governed, `tools/call`:** Toolname **exakt** matchen (nur `trim`, kein lowercase — `Get_Device` →
  unlisted → gate ist die fail-closed-Seite):
  - Tool in `readOnly` → `self`.
  - Tool in `consensus` (falls gesetzt) → `consensus`.
  - sonst → `maxTier('gate', deriveToolTier({method:'tools/call', params:{name}}))` — Verb auf dem
    **getrimmten** Namen klassifiziert (CR-MEDIUM: sonst entkäme `" delete_network "` als gate statt
    consensus). **Mindestens gate**, aber `consensus` bei destruktivem Verb. **Nie ein Downgrade**
    (`delete_network` bleibt consensus), und ein unlisted Read (mis-verbtes/neues Tool) geht **nie** als `self` durch.

Der Ingress ruft `deriveToolTierForServer(input.server, input.payload)` statt `deriveToolTier`; die
effektive Stufe bleibt `maxTier(capabilityTier, toolTier)` (Defense-in-Depth: Capability-Stufe hebt weiter an).

### unifi-Klassifikation (Snapshot 2026-07-15, 67 Tools)
- **`readOnly` (24):** `get_*`/`list_*` **außer** den credential-/secret-/PII-tragenden Reads.
- **Bewusst NICHT in `readOnly` (gegatet trotz Nicht-Mutation, CO-B + CR-Codex):** `get_wlan`,
  `list_wlans` (PSK/`x_passphrase`), `get_voucher`, `list_vouchers` (Gast-Zugangscodes),
  `list_radius_profiles` (RADIUS-Shared-Secrets), `list_vpn_servers`, `list_vpn_tunnels` (VPN-Keys),
  **`list_wans`** (PPPoE-`x_pppoe_username/password`), **`get_network`, `list_networks`** (VPN-Netze mit
  `x_ipsec_pre_shared_key`) — 10 Reads. Sie exfiltrieren Credentials/PII an einen fremden Agenten —
  **nicht-mutierend ≠ auto-ausführbar**. Kein Funktionsverlust (sie werden gegated). Die zweite Dimension
  **„mutation ≠ sensitivity"** (mit Feld-Redaktion, damit safe Felder wieder als self durchgehen) = **Slice 2**.
- **Nicht read-only (fallen in `maxTier(gate, Heuristik)`):** `create_*`/`update_*`/`enable/disable_*`/
  `authorize_guest`/`block_client`/`unblock_client`/`reorder_*`/`restart_device`/`restart_port` → `gate`;
  `delete_*` (8) → `consensus`.
- **Worked example „naming lied" (CO-B):** `locate_device` lässt eine Geräte-LED blinken (physische
  Aktuation), liest sich aber wie ein harmloses „locate"-Verb — korrekt **nicht** in `readOnly`; die
  Heuristik gibt dort `unknown → gate`, der Map-Eintrag macht das explizit statt zufällig.

## Drift-Schutz
- **Fixture-Subset-Test:** das echte 67-Tool-Inventar liegt als Fixture
  (`fixtures/unifi-tools-2026-07-15.json`); ein Test prüft `readOnly ⊆ Fixture` → fängt Tippfehler
  (ein vertippter Allowlist-Eintrag gated einen Read sonst **still** für immer).
- Snapshot-Datum + Quelle (live `tools/list`) + Zähler (24 readOnly / 67 total) hier dokumentiert.
- **Folge-Slices (nicht Slice 1):** (a) Startup-Drift-Check gegen live `tools/list` (neue Upstream-Tools
  sichtbar machen statt still gegatet); (b) Audit-Signal „gated weil unlisted-on-governed" (vs. „weil
  write/destructive") als Kurations-Trigger; (c) Prefix-Seeding ist nur Startpunkt — pro Tool ein
  Verhaltens-/Side-Effect-Review (unifi kann GET-Endpunkte mit Nebenwirkung haben).

## Konsequenzen
- **+** Governed Server verlassen sich nicht mehr auf die Verb-Heuristik; unlisted/neue Tools sind
  fail-closed gegatet, nicht geraten-`self`.
- **+** Strikte Verschärfung, **kein Downgrade** (readOnly-Treffer = heutige Heuristik-Ausgabe;
  unlisted wird strenger). Ungoverned Server + Plain unverändert.
- **0** `list_clients`/`get_device`→self (durch), `block_client`→gate, `delete_network`→consensus,
  `tools/list`→self (Discovery unberührt).
- **−** Credential-nahe Reads (wlan/voucher/radius/vpn) sind bis Slice 2 gegatet. Beabsichtigt (fail-closed).
