# T2.4-Folge — Self-Last in der least-loaded-Routing-Auswahl

**Datum:** 2026-06-30
**Branch:** `claude/t24-selfload-routing`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Feature (Routing/Lastverteilung) — kein Deploy, repo-intern
**V5-Bezug:** T2.4-Folge (Spur-2-Daemon), direkte Fortsetzung von #219

## Problem

#219 wählt bei mehreren fähigen Peers den least-loaded **Remote**-Knoten anhand der
Resource-Attribute aus `/api/peers`. Der **lokale** Knoten steht aber nicht in
`/api/peers` → seine Last floss nicht ein. Folge: ein lokal ausführbarer Skill konnte
an einen Remote-Peer geroutet werden, obwohl der lokale Knoten idle war (unnötiger Hop).

## Lösung

Der lokale Knoten konkurriert jetzt **fair** mit:

- **`dashboard-api.ts`**: `/api/status` liefert `resources` =
  `registry.getNodeResources(ownAgentId)` (Self-Side-Map). `ownAgentId == selfIdentityUri`
  — exakt der Key, unter dem `setNodeResources` schreibt **und** unter dem der lokale
  Skill als Kandidat in `/api/capabilities` erscheint (verifiziert, Drei-Wege-Key-Match).
- **`peer-selection.ts`**: neue reine `chooseTargetAgent(candidateIds, peers, self, explicitTarget?)`
  kapselt die **gesamte** Auswahl-Entscheidung von `execute_remote_skill`:
  - explizites `target` → dieses (sofern Kandidat), sonst `null`;
  - sonst `buildLoadMap([...peers, self])` → `pickLeastLoaded`. Der Self-Eintrag (aus
    `/api/status`) konkurriert über denselben **defensiven** Pfad (finite-Validierung).
- **`mcp-stdio.ts`** `execute_remote_skill`: holt (ohne explizites Ziel) zusätzlich
  `/api/status`, baut den synthetischen Self-`PeerEntry` und delegiert an `chooseTargetAgent`.
  Wählt least-loaded **lokal**, wenn lokal am wenigsten ausgelastet → spart den Hop
  (Self gewählt → kein Peer in `/api/peers` → bestehender Lokal-Exec-Pfad).

**Fail-open** (mehrstufig): `/api/status`-Fetch in try/catch (Fehler → Peers-only =
bisheriges Verhalten); fehlende/NaN Self-`resources` → `buildLoadMap` verwirft sie →
Self konkurriert nicht (kein Vergleichs-Gift); keine Daten überhaupt → erster Kandidat.

## Tests

- **`peer-selection.test.ts`** (+6, jetzt 20): `chooseTargetAgent` — explizit (gefunden/
  nicht-Kandidat→null), self gewinnt bei geringster Last, ausgelasteter self → remote gewinnt,
  fail-open ohne Daten → erster Kandidat, self mit NaN-resources → ausgeschlossen.
- **`dashboard-api.test.ts`** (+2): `/api/status` liefert `resources` (+ Assertion, dass mit
  dem self-Key abgefragt wird = Key-Match-Schutz); `null` ohne Snapshot.

Volle Suite **106 Files / 1294 grün**, tsc 0, authored-files eslint 0. Empirisch
guard-bewiesen: Self-Merge in `chooseTargetAgent` entfernt ⇒ „self gewinnt"-Test rot,
restauriert ⇒ grün.

## Review

Unabhängiger **Claude**-Subagent: **korrekt & merge-fähig**, 0× HIGH/CRITICAL. Drei-Wege-
Key-Match (write/read/candidate alle = `selfIdentityUri`) verifiziert. CR-MEDIUM (Wiring-
Entscheidung von `execute_remote_skill` war untestbar) **gefixt**: gesamte Logik in die reine
`chooseTargetAgent` extrahiert + 6 Tests (inkl. self-NaN-Ausschluss + fail-open). (`agy`-Backend
im Env nicht installiert → Claude-Subagent als echtes Review — kein MiniMax/pal:chat.)

## Folge / offen

- Live-Zwei-Peer-Routing-Beweis (DoD) bleibt **deploy-gegated** (Christian) → hier
  reproduzierbare Unit-Belege der reinen Entscheidung + `/api/status`/`/api/peers`-Exposition.
- Kein Deploy.
