# T2.4-Folge — Peer-Resource-basierte least-loaded-Routing-Auswahl

**Datum:** 2026-06-30
**Branch:** `claude/t24-least-loaded-routing`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Routing/Lastverteilung) — kein Deploy, repo-intern
**V5-Bezug:** T2.4-Folge (Spur-2-Daemon), benannt in `changes/2026-06-30_t24-cpu-agentcount-mesh-resource.md`

## Problem

Seit #218 exponieren Peers ihre place-or-refuse-Resource-Attribute (`ram_used_percent`,
`cpu_load`, `agent_count`) in der Agent-Card — aber für die **Routing-Auswahl** wurden sie
nicht genutzt. Bot mehr als ein fähiger Peer denselben Skill an, wählte
`execute_remote_skill` schlicht `candidates[0]` (erster gesunder), lastunabhängig.

## Lösung

Der Anfrager wählt unter mehreren fähigen Peers den **am wenigsten ausgelasteten**.
**Fail-open:** liegen keine Resource-Daten vor, bleibt das Verhalten unverändert
(erster Kandidat).

- **`peer-selection.ts`** (neu, rein/testbar):
  - `compareLoad(a,b)` — lexikografisch **RAM → CPU → agent_count** (weniger = besser).
  - `pickLeastLoaded(candidateIds, loadByAgent)` — Min-Last unter Kandidaten **mit** Daten;
    bei Gleichstand bleibt der frühere (deterministisch, back-compat zu `candidates[0]`);
    ohne jegliche Daten → `candidateIds[0]` (fail-open).
  - `buildLoadMap(peers)` — extrahiert die Last aus den Peer-Cards **defensiv** (Zero-Trust-LAN,
    CR-MEDIUM): ein Block zählt nur, wenn **alle drei Felder endliche Zahlen** sind; NaN/null/
    string/fehlend → Peer gilt als „keine Daten" (übersprungen statt Vergleichs-Gift).
- **`dashboard-api.ts`**: `/api/peers` liefert jetzt `agent_card.resources` (aus der
  gespeicherten Peer-Card; `null`, solange kein Snapshot vorliegt).
- **`mcp-stdio.ts`** `execute_remote_skill`: holt `/api/peers` vorab, baut via `buildLoadMap`
  die Last-Map und wählt (ohne explizites `target_agent`) per `pickLeastLoaded` statt
  `candidates[0]`. Lokaler-Skill-Fallback + expliziter `target_agent`-Pfad unverändert.

## Scope-Grenze

- Der **lokale** Knoten steht nicht in `/api/peers` → seine Last fließt (noch) nicht ein;
  das passt zum remote-orientierten `execute_remote_skill`. **Self-Last einbeziehen** (über die
  lokale Card) = benannter Folge-Slice.
- Die Auswahl-Frische hängt am Peer-Card-Refresh (Reconciler/Heartbeat); ausreichend fürs
  Routing, fail-open bei veralteten/fehlenden Daten.

## Tests

- **`peer-selection.test.ts`** (neu, 13): `compareLoad`-Ordnung; `pickLeastLoaded`
  (Min-Last, Gleichstand→früher, fail-open ohne Daten, partielle Daten, Einzel-Kandidat,
  leere Liste→wirft); **`buildLoadMap`** (valide übernommen; fehlend/null ausgelassen;
  **NaN/string/fehlendes Feld ausgelassen**; Integration: garbage-Peer übersprungen, valider gewinnt).
- **`dashboard-api.test.ts`** (+2): `/api/peers` liefert `resources`; `null` ohne Snapshot.

Volle Suite **106 Files / 1285 grün**, tsc 0, authored-files eslint 0. Empirisch guard-bewiesen:
`compareLoad`/Auswahl invertiert ⇒ 3 Auswahl-Tests rot, restauriert ⇒ grün.

## Review

Unabhängiger **Claude**-Subagent: **APPROVE**, 0× HIGH/CRITICAL. CR-MEDIUM (peer-gelieferte
`resources`-Zahlen ungeprüft → NaN-Vergleichs-Gift, Zero-Trust-LAN) **gefixt** (`buildLoadMap`
finite-Validierung + Regression-Test). LOW/NIT (volle Card-Shape exponiert, self-Last-Grenze)
als bewusste/dokumentierte Trade-offs. (`agy`-Backend im Env nicht installiert → Claude-Subagent
als echtes Review — kein MiniMax/pal:chat.)

## Folge / offen

- Self-Last in die Auswahl einbeziehen (lokale Card) — lokal vs. remote fair vergleichen.
- Live-Zwei-Peer-Routing-Beweis (DoD) ist **deploy-gegated** (Christian) — daher hier
  reproduzierbare Unit-Belege der reinen Auswahllogik + `/api/peers`-Exposition.
- Kein Deploy.
