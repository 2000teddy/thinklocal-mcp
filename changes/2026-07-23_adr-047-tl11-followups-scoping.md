# changes/2026-07-23 — docs(arch): ADR-047 — TL-11 Wake-Nachlauf, Scoping der drei „Optional/danach"-Punkte

**Typ:** **Doc-only** Scoping/Discovery (Status **Proposed**). Kein Code, kein Test, kein Runtime-Change,
kein Deploy/Secret/Host. **Entscheidet nichts** — benennt die Entscheidungen.

## Auftrag und ehrliches Ergebnis
Gesucht war der kleinste wirklich **ungegatete** Post-#320-Slice im TL-11-Nachlauf, konkret zu den drei
Punkten, die `TODO.md` nach Slice B als „Optional/danach" führt: **WS-Instanz-Bindung**,
**Opt-in-Broadcast-Wake**, **Reconciliation-Sweep**.

**Befund: alle drei sind entscheidungsgebunden** — nicht weil die Mechanik fehlt, sondern weil jeder eine
**gemergte, bewusst konservative Invariante ändert**. Damit ist der kleinste ehrliche Slice die Scoping-Note
selbst (doc-only), statt einen Code-Slice zu bauen, der eine noch nicht getroffene Entscheidung vorwegnimmt.
Die drei Stichworte standen bisher **ohne** Code-Grounding, **ohne** benannte Entscheidungen und **ohne**
Slice-Zerlegung in der TODO — genau das holt ADR-047 nach.

## Was die Note an nicht-Offensichtlichem aufdeckt
- **`agentFilter` hat Doppelfunktion** (`websocket.ts:87-91` gerichtetes Routing **und** `:94-101`
  `from`/`to`/`agentId`/`peer_id`-Filter nicht-gerichteter Events). Eine naive „Filter = eigene Identität"-
  Bindung wäre damit auch eine **unbeabsichtigte Feature-Rücknahme** für Dashboard-/CLI-Beobachter.
- **Die Client-Identität existiert im WS-Handler heute gar nicht**: kein `getPeerCertificate`, keine
  SPIFFE-Extraktion; `ClientState` kennt nur `isLoopback` (aus `req.ip`). Die mTLS-Pflicht liegt im
  cardServer (`agent-card.ts:229-230`), nicht in `registerWebSocket`. Instanz-Bindung ist also **neue
  Verdrahtung**, nicht „eine schärfere Bedingung".
- **Broadcast ist strukturell nicht zustellbar**: ein Broadcast-Wake hat weder `instance_id` noch
  `spiffe_uri`, auf die `matchesSubscription` matchen könnte — er bräuchte eine eigene Form **und** eine
  Regel, die den in **#277** geschlossenen Leak **D1** geschlossen hält. Dazu fehlt bis heute ein
  **benannter Anwendungsfall**.
- **Der Sweep ist mechanisch billig, aber vertraglich teuer**: `AgentInbox.unreadCount({ forInstance })`
  (`agent-inbox.ts:468`) + Index `idx_messages_instance` (`:187`) + `agentRegistry.list()` genügen — **keine**
  neue Speicherarbeit. Die eigentliche Frage ist die **Coalescer-Interaktion**: wird der Sweep-Wake
  geschluckt, verpufft er genau im Reconnect-Fenster, das er beheben soll; umgeht er den Coalescer, ist die
  §5-Zusage „≤ 1 Wake pro Instanz pro Fenster" **nicht mehr wörtlich wahr** und die Consumer-Spec müsste
  nachgezogen werden. Außerdem verschiebt ein Daemon-Sweep eine **Konsumenten-Pflicht** (Spec §5, Runbook).

## Empfehlung (zur Entscheidung, nicht entschieden)
**§3 Reconciliation-Sweep zuerst** (kleinster Aufwand, adressiert die real erlebte Reconnect-Lücke) →
**§1 WS-Instanz-Bindung** bewusst budgetieren (echter Metadaten-Schutz auf Mehr-Agenten-Hosts, aber teuer) →
**§2 Opt-in-Broadcast liegen lassen**, bis ein Anwendungsfall existiert.

## Abgrenzung (unverändert gated, ausdrücklich nicht angefasst)
TL-11 **Slice B** (letzter Hop Supervisor → CLI: out-of-repo, Deploy-/Host-/Fenster-gated),
TL-12 **B/C** (owner/CO), TL-10-Verdrahtung (D1-Loader + kuratierte Policy-Datei, D3-Sign-off).
**Kein** Loader, **kein** Flag-Flip, **kein** Host-Hop.

## Compliance
- **CO:** n/a — die Note **trifft keine** Architektur-Entscheidung, sie bereitet sie vor (Präzedenz:
  `TL-10-freigabe-matrix-scoping.md` §5, ADR-046 „Scoping"). Die drei Beschlüsse selbst sind CO-/owner-Sache.
- **CG/TS:** entfallen — kein Code/Test-Diff.
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent,
  `[[pal-review-backend-agy-missing]]`); Fokus: sind die zitierten Code-Stellen korrekt und die
  „entscheidungsgebunden"-Einordnung ehrlich (oder wird ein baubarer Slice künstlich weggeredet)?
- **PC:** Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `docs/architecture/ADR-047-tl11-wake-followups-scoping.md`, `TODO.md`
  (TL-11-Querverweis + Kurzfassung), `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Alle Zeilenangaben in der Note sind gegen den Stand `a1ae1c2` verifiziert** (`websocket.ts:59/72/87-91/94-101`,
`wake-contract.ts:33/129-135`, `agent-inbox.ts:187/468`, `index.ts:1110-1112`).
