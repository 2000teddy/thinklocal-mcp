# changes/2026-07-23 — feat(tl11): Reconciliation-Sweep-Kern + ADR-047 Scoping (Rev. 2 nach CR)

**Typ:** additive, **ungegatete** reine Primitive (`sweep-targets.ts`, 0 Aufrufer) + Scoping-Note
(ADR-047, **Proposed**). Kein Runtime-Change, kein Deploy/Secret/Host.

> **Revision 2 — die erste Fassung war falsch.** Sie lieferte **nur** die Scoping-Note und begründete das
> damit, alle drei Punkte seien entscheidungsgebunden. Das externe Review hat das als **HIGH** widerlegt:
> für den **Reconciliation-Sweep** existiert sehr wohl ein ungegateter reiner Kern — und die von der Note
> selbst vorgeschlagene Signatur beweist es, weil sie **keinen** Coalescer, **keine** Uhr, **keinen**
> Trigger und **kein** Flag enthält. Der Slice ist jetzt gebaut; die Blocker-Behauptung ist in ADR-047
> §3/§5 ausdrücklich zurückgezogen. Ein zweiter HIGH betraf §2 (siehe unten).

## Auftrag und ehrliches Ergebnis
Gesucht war der kleinste wirklich **ungegatete** Post-#320-Slice im TL-11-Nachlauf, konkret zu den drei
Punkten, die `TODO.md` nach Slice B als „Optional/danach" führt: **WS-Instanz-Bindung**,
**Opt-in-Broadcast-Wake**, **Reconciliation-Sweep**.

**Befund (Rev. 2):** Die **Verdrahtung** ist bei allen drei Punkten entscheidungsgebunden. Der **reine
Kern** des Reconciliation-Sweeps ist es **nicht** — er liegt jetzt als `sweep-targets.ts` vor. Die drei
Stichworte standen bisher **ohne** Code-Grounding, **ohne** benannte Entscheidungen und **ohne**
Slice-Zerlegung in der TODO; das holt ADR-047 nach.

## Der gebaute Slice — `packages/daemon/src/sweep-targets.ts`
`computeSweepTargets(live, unreadFor)` beantwortet **genau eine** Frage: *welche live registrierte,
routbare Instanz hat ungelesene Post?* Rein, deterministisch (stabil nach `instanceId` sortiert, keine
Uhr, kein Zufall), **fail-closed wie der Emitter** (ohne routbare `spiffeUri` kein Ziel; unbrauchbarer
oder **werfender** Zähler ⇒ kein Ziel; wirft nie), **0 Aufrufer** ⇒ kein Runtime-Change.

Er nimmt **keine** der offenen Entscheidungen vorweg: „ob überhaupt gesweept wird" und „wann" sind
Aufrufer-Fragen; Coalescing greift — wie beim Emitter, der es erst **nach** der Ziel-Auflösung anwendet —
danach; und ob Legacy-Zeilen (`to_agent_instance IS NULL`) mitzählen, entscheidet, wer `unreadFor`
übergibt. Präzedenz für genau diese Form: `wire-feature.ts` `supportsFeature` (#314) und
`MeldekanalRegistry.requestApprovalOn` (#317).

**+13 Tests** (`sweep-targets.test.ts`): Auswahl/Sortierstabilität/Dedupe, fail-closed gegen fehlende
SPIFFE und 9 malformte Einträge, werfender Zähler ⇒ Instanz entfällt (übrige bleiben), 9 unbrauchbare
Zählerwerte ⇒ kein Ziel, kein verstecktes „schon geweckt"-Gedächtnis, genau eine Zähler-Abfrage pro
**routbarer** Instanz. Suite **1992 grün** (141 Files).

## Was die Note aufdeckt (Rev. 2 — inkl. der CR-Korrekturen)
- **`agentFilter` hat Doppelfunktion** (`websocket.ts:87-91` gerichtetes Routing **und** `:94-100`
  `from`/`to`/`agentId`/`peer_id`-Filter nicht-gerichteter Events) — der stärkste Befund der Note.
  **Korrigiert:** die erste Fassung leitete daraus eine „unbeabsichtigte Feature-Rücknahme" für
  Beobachter-Konsumenten ab; solche gibt es im Repo **nicht** (Dashboard verbindet ohne Query, kein
  WS-Client in der CLI, jede dokumentierte `agent=`-Nutzung ist die gerichtete Wake-Form). Das Risiko ist
  **latent, nicht beobachtet** — und die daraus gezogene Vorentscheidung („müsste beschränkt werden") ist
  zurückgenommen.
- **Die Client-Identität ist im WS-Handler nicht verdrahtet** — `ClientState` kennt nur `isLoopback`.
  **Korrigiert:** „neue Verdrahtung" war zu teuer geschätzt; `extractCanonicalSender`
  (`mcp-ingress-api.ts:57`) ist exportiert, getestet und wird mit dem Fastify-Muster `request.raw.socket`
  bereits an drei Stellen benutzt (`:163-164`) → **~3 Zeilen Wiederverwendung**.
- **Neu (aus dem CR): der naheliegende Identitäts-Kandidat trifft die Bedrohung gar nicht.** Das Runbook
  schreibt das **Host**-Cert (`node.crt.pem`) und dieselbe `node/<PeerID>`-SPIFFE als Filterwert vor — eine
  cert-abgeleitete Bindung wäre auf dem heutigen Deployment **tautologisch** und schützte **nicht** gegen
  die Nachbar-Instanz. Echter Schutz braucht ein **per-Instanz**-Credential. Deshalb wird der (technisch
  ungegatete) `allowsAgentFilter`-Kern hier **nicht** gebaut: er wäre tautologisch grün und würde eine
  Schutzwirkung suggerieren, die er nicht hat.
- **Broadcast — Begründung korrigiert (zweiter HIGH).** „Strukturell nicht zustellbar" gilt nur für ein
  einzelnes unadressiertes Event, **nicht** für den beschlossenen Punkt: `ADR-043` CO-B meint die
  Emitter-Seite (`resolveWakeTargets(null, live) → live` = **N gerichtete** Wakes, heute problemlos
  routbar, **D1 bleibt zu**). Der reale Blocker ist die dort benannte **1→N-Amplifikation** — die in der
  ersten Fassung gar nicht vorkam. Ebenfalls zurückgenommen: „nur das Konsumenten-Opt-in hält D1
  geschlossen". Die Park-Empfehlung bleibt — auf richtiger Grundlage (kein Anwendungsfall + Amplifikation).
- **Sweep — Rahmen korrigiert.** Die Mechanik-Aussage hält (`unreadCount({forInstance})`
  `agent-inbox.ts:468` + Index `:187` + `agentRegistry.list()`, keine neue Speicherarbeit). Die
  Coalescer-Frage war aber als **falsches Entweder-oder** dargestellt: es gibt mindestens zwei auflösende
  Optionen (eigener `WakeCoalescer` für den Sweep-Pfad; eigener, ausdrücklich erweiterbarer `WakeReason`),
  und die Spec nennt mehrfaches Wecken in der **Idempotent**-Zeile selbst „harmlos". Ergänzt: der
  bevorzugte Trigger „WS-(Re-)Connect" hat **keinen** Hook (`registerWebSocket` gibt nichts zurück,
  `clients` ist modulprivat) und wäre damit der **teuerste**, während `agentRegistry.on(...)`
  (`agent-registry.ts:240-242`) bereits existiert; und `unreadCount({forInstance})` sieht per Default
  **keine** Legacy-Zeilen (`includeLegacy` false) — ausgerechnet die, die am ehesten liegenbleiben.

## Empfehlung (zur Entscheidung, nicht entschieden)
**§3 Reconciliation-Sweep zuerst** — der reine Kern liegt jetzt vor, offen ist nur noch die Verdrahtung →
**§1 WS-Instanz-Bindung** bewusst budgetieren, mit der Vorfrage per-Instanz-Credential ja/nein →
**§2 Opt-in-Broadcast liegen lassen**, bis Anwendungsfall und Amplifikations-Schranke geklärt sind.

## Abgrenzung (unverändert gated, ausdrücklich nicht angefasst)
TL-11 **Slice B** (letzter Hop Supervisor → CLI: out-of-repo, Deploy-/Host-/Fenster-gated),
TL-12 **B/C** (owner/CO), TL-10-Verdrahtung (D1-Loader + kuratierte Policy-Datei, D3-Sign-off).
**Kein** Loader, **kein** Flag-Flip, **kein** Host-Hop.

## Compliance
- **CO:** n/a — die Note **trifft keine** Architektur-Entscheidung, sie bereitet sie vor (Präzedenz:
  `TL-10-freigabe-matrix-scoping.md` §5, ADR-046 „Scoping"); der gebaute Kern folgt derselben Prep-Form wie
  #314/#317. Die drei Beschlüsse selbst bleiben CO-/owner-Sache.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH).
- **TS ✅:** +13 Tests, Suite **1992 grün** (141 Files), `tsc --noEmit` (strict) 0, neue Dateien eslint
  0/0, prettier clean.
- **CR ✅:** adversariales Claude-Subagent (`agy`/`codex` nicht im PATH, `[[pal-review-backend-agy-missing]]`),
  Auftrag ausdrücklich „versuche einen ungegateten Slice zu konstruieren; wenn dir das gelingt, ist das ein
  Finding" — **2 HIGH + 5 MEDIUM + 4 LOW**, beide HIGH und die MEDIUM an der Wurzel behoben:
  HIGH-1 der Sweep-Kern ist baubar ⇒ **gebaut**; HIGH-2 §2-Begründung widersprach ADR-043 CO-B ⇒ neu
  geschrieben; MEDIUM Cert-Kosten überschätzt / Beobachter-Konsument existiert nicht / Host-Cert ist
  tautologisch / WS-Connect-Hook fehlt & `agentRegistry.on` ungenannt / Coalescer-Dilemma ist ein falsches
  Entweder-oder ⇒ alle in Rev. 2 eingearbeitet. LOW: `:32`↔`:33`-Fehlanker korrigiert, `:94-100` statt
  `:94-101`, `includeLegacy`-Vorbehalt ergänzt, zwei als Vorentscheidung lesende Sätze zurückgenommen,
  und die vom Review nebenbei gefundene **Alt-Drift** in `TL-11-wake-consumer-contract.md` (`websocket.ts:66`
  → `:89-90`, `:64` → `:88`) mitgefixt.
- **PC ✅:** Secret-Scan clean.
- **DO ✅:** dieser Eintrag, `docs/architecture/ADR-047-tl11-wake-followups-scoping.md`,
  `docs/architecture/TL-11-wake-consumer-contract.md` (Alt-Drift), `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Alle Zeilenangaben gegen `a1ae1c2` verifiziert** — inkl. der beiden vom Review beanstandeten Anker.
