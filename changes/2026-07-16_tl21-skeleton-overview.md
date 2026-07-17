# changes/2026-07-16 — feat(api): TL-21 Skelett-Auskunft `GET /api/capabilities/overview` (Kap. 06)

**Typ:** additive, read-only Feature + Design-Doku + Tests. **Kein** Deploy/Secret/Christian-Gate,
**kein** neuer State, **keine** Änderung an bestehendem Endpoint-Verhalten.

## Warum
Kontext-Ökonomie (Kap. 06): Ein Agent, der „was kann dieser Knoten?" fragt, bekam entweder zu wenig
(`list_skills` → ohne Beschreibung) oder zu viel (`GET /api/capabilities` → volle `Capability`-Objekte je
Provider). TL-21 liefert eine kompakte **Skelett-Übersicht** (pro Skill: **Name + ein Satz**), Details
erst auf Abruf. Weekly-Plan KW30 (proof→autonomy); gewählt als unblocktes bounded Item, nachdem TL-12 B0
Christian-gated und TL-14a an Decision-7 + einer nicht-entschiedenen CA-Architektur entkoppelt blockiert ist.

## Was
- **Neu `capability-skeleton.ts`** (reines Modul, kein State/I/O, deterministisch):
  - `firstSentence(text)` — erster Satz bis `.`/`!`/`?`; ohne Terminator getrimmt + auf 160 Zeichen gekürzt.
  - `buildCapabilitySkeleton(caps)` — dedupliziert pro `skill_id`; `summary`/`category` vom gesund-
    bevorzugten Provider (Health-Rang, dann lexikografisch `agent_id`); `health` aggregiert (healthy, wenn
    ≥1 Provider healthy; sonst degraded; sonst offline); sortiert nach `skill_id`.
- **`dashboard-api.ts`**: neu `GET /api/capabilities/overview` → `{ skills, count }` (rate-limited wie alle
  `/api/*`). Bestehender `GET /api/capabilities?skill_id=` (Details) **unverändert** = Stufe 2.
- **Design-Doku** `docs/architecture/TL-21-skeleton-disclosure.md` (Invarianten, Slice-Abgrenzung).

## Abgrenzung / Slices
- **Slice 1 (hier):** REST-Skelett + reine Helfer. **Slice 2 (Folge):** identische Projektion als
  MCP-Tool `list_capabilities_overview` (Agent-Kontext-Ökonomie) — bewusst getrennt, damit Slice 1
  klein/testbar bleibt. Nicht in Scope: Skelett für Peers/Tools/Tasks, Paginierung, Volltextsuche.

## Compliance
- **CO:** entfällt — additiver Read-View, kompakte Projektion vorhandener Daten (Präzedenz #278); die
  Design-Entscheidung (Skelett-Einheit, „1 Satz", Health-Aggregation, Details-Pfad) ist in
  `TL-21-skeleton-disclosure.md` festgeschrieben. Kein Kap.06-Spec im Repo → Ambiguität dort **gepinnt**,
  nicht eigenmächtig über Scope hinaus erweitert.
- **CG:** n/a.
- **TS:** `capability-skeleton.test.ts` (13) + `dashboard-api.test.ts` (+2) — firstSentence-Kanten (Terminator,
  ohne-Terminator-Kürzung, leer, **CR-MEDIUM-Regression: langer Satz MIT Terminator gekappt**, **CR-LOW:
  Dezimalzahl nicht zerschnitten**), Dedupe, Sortierung, gesund-bevorzugte Wahl + Tie-Break, Health-Aggregation
  (alle 3 Stufen), leere Registry, Endpoint 200. Voller Lauf **1729 grün**, tsc(strict) 0, neue Dateien Lint 0.
- **CR:** adversarialer Claude-Subagent — **kein HIGH**. **1 MEDIUM in-slice gefixt + Regressionstest**
  (`firstSentence` kappte den Satz-mit-Terminator-Zweig NICHT → untrusted 8-KB-`description` hätte die
  Übersicht gesprengt; jetzt wird **immer** auf `SUMMARY_MAX_LEN` gekappt). **3 LOW gefixt:** Dezimal-/
  Versions-Zerschneidung (`(?=\s|$)`-Lookahead + Test), `HEALTH_RANK`-NaN bei malformed CRDT-Health
  (`healthRank`-Fallback), locale-abhängiges `localeCompare` → fixe `cmpStr`-Ordnung (Determinismus §5.3).
  Dedupe/Sortierung/Aggregation + Additivität/Read-only + keine neue Exposition unabhängig **bestätigt**.
- **PC:** `git diff --cached` gesichtet; Secret-Scan clean.
- **DO:** Design-Doku, `docs/API-REFERENCE.md`, `CHANGES.md`, `TODO.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

## Nachtrag 2026-07-17 — CR-MEDIUM (externer codex-Review) gefixt: Projektion total gegen malformed CRDT-Daten
**Befund (codex, formaler GitHub-Review auf #281):** `firstSentence(text)` nahm `(text ?? '').trim()` einen
Laufzeit-**String** an, aber `description` ist runtime-untyped: `CapabilityRegistry.importPeerCapabilities()`
owner-gated nur `agent_id`, **schema-validiert `description` nicht**, und `stripNonCrdtFields` erhält
malformed Metadaten. Ein authentifizierter/buggy Peer konnte `description: 123` / `{}` publizieren →
`GET /api/capabilities/overview` rief `firstSentence(preferred.description)` → **`trim is not a function`**
→ eine einzige geschmiedete Capability kippte die additive Read-View in einen **500** (neue Verfügbarkeits-
Regression nur auf der neuen Route; der Details-Endpoint serialisiert den Wert nur).
**Fix (total/fail-safe):**
- `asStr(v)` — deterministische String-Sicht auf untyped CRDT-Felder (non-string → `''`, wirft nie).
- `firstSentence(text: unknown)` — guarded via `asStr`; non-string/null/undefined → `''`.
- `buildCapabilitySkeleton` — `skill_id` (Grouping-/Sort-Key) non-string/leer → **Eintrag übersprungen**
  (unprojektierbar, bounded, kein garbage-Key); `agent_id` (Tie-Break) + `category` (Output) über `asStr`
  normalisiert; `health` war bereits defensiv (`healthRank ?? 3`, `some(=== 'healthy')`). Ergebnis bleibt
  **bounded + deterministisch** statt den ganzen Request zu fehlern.
- **CR-LOW Doku-Drift:** `SUMMARY_MAX_LEN=160` als **Inhalts**-Cap (vor Ellipsis) präzisiert — Ergebnis
  ≤ 160 Inhalts-Zeichen **+ optionales `…`** (max. 161); Design-Doc + Code-Doc angeglichen, kein Verhaltens-
  Change (bestehende Tests erlaubten bereits 161).
**Regression-Tests:** `capability-skeleton.test.ts` +4 (non-string `description`→`''`; non-string/leerer
`skill_id`→skip; non-string `category`/`agent_id`→normalisiert/deterministisch; gemischt malformed→wirft nie)
+ `firstSentence` non-string-Fälle; `dashboard-api.test.ts` +1 (malformed Registry → **200, kein 500**).
Voller Lauf **1735 grün** (1729 → +6), tsc(strict) 0, neue-Dateien-Lint 0 (netto keine neue Warning).
**CR/Verifikation:** Fix deckt exakt die im Review benannten Vektoren (non-string `description` **plus**
malformed identifiers in Sort/Grouping). Kein Merge (Christian-gated).
