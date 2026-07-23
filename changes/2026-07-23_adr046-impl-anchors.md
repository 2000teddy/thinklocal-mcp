# changes/2026-07-23 — docs(arch): ADR-046 Rev. 2 — Implementierungs-Anker, fail-closed-Grenzen, Seed-Flag

**Typ:** **Doc-only** Erdung des TL-12-Prereq-Pfads. **Kein Code**, **kein Beschluss**, **kein**
`protocol`-Block auf der Card, **kein** ORDER-Flip, kein Deploy/Secret/Host. Enthält den eingefalteten
Post-Merge-Reconcile für **#324**.

## Auftrag und Abgrenzung
Der nächste ehrliche Schritt am ADR-046-Pfad ist **nicht** die Implementierung — Platzierung und
Vokabular/Semver bleiben CO-pflichtig, und der Cross-Vendor-`pal:consensus` ist weiterhin PATH-blockiert.
Was ohne CO geht: den Pfad so erden, dass die Folge-Slice **nachschlagen statt suchen** muss, und die
Grenzen festhalten, die **unabhängig** von der CO-Entscheidung gelten.

## Der konkrete Befund: drei Anker der Erstfassung waren verschoben
Die Anker in §„Beleg-Referenzen" stammten von #308 (2026-07-21) und wurden seither durch mehrere Merges
verschoben. Gegen `e994e65` nachgeprüft:

| Beschreibung | #308 sagte | **tatsächlich** |
|---|---|---|
| Card-Fetch + Identitäts-Check + Store (Discovery-Pfad) | `index.ts:1491-1502` | **`index.ts:1530-1541`** |
| zweiter Card-Consume-Pfad | `index.ts:1553` | **`index.ts:1592`** / **`:1603`** |
| `default`-Drop im Empfangs-Dispatch (Slice-C-Vorbehalt **V1**) | `index.ts:932-934` | **`index.ts:936-938`** |

Der dritte ist der relevanteste: **V1** („top-level ORDER fällt still in den `default`-Drop") ist das
Argument, mit dem Slice C geparkt wurde — ein falscher Anker dafür entwertet die Beleglage.

**Bestätigt korrekt geblieben:** `agent-card.ts:22-111` (AgentCard, weiterhin ohne `protocol`/`features`),
`mesh.ts:20`/`:189`/`:258`, `pinned-card-fetch.ts:35`, `version-compat.ts` (außerhalb von Tests weiterhin
ohne Aufrufer).

**Neu gepinnt:** der **Producer** war nur namentlich genannt — jetzt `agent-card.ts:480` `buildCard()`.
**Neu benannt:** ein **dritter** Card-Consume-Pfad (`index.ts:720`, Fetch bei `:631`/`:731`), den die
Erstfassung nicht erwähnte. Wer den `protocol`-Block liest, muss prüfen, ob **alle** Pfade denselben
Identitäts-Check durchlaufen, bevor eine Card als Feature-Quelle gilt.

## Neue Sektionen
- **§5 Implementierungs-Anker** — Tabellen für Producer-Seite (was fehlt), Consumer-Seite (was existiert)
  und die korrigierte Drift.
- **§6 Fail-closed-Grenzen** — gelten **unabhängig** von der offenen Platzierungs-/Vokabular-Frage:
  Peer ohne `protocol`-Block · `features` fehlt/kein Array/leer · Feature nicht gelistet · Card nicht
  abrufbar · Card mit **nicht bestandenem Identitäts-Check** ⇒ je **`false`**. Kodifiziert ist das bereits
  in `wire-feature.ts` (#314); ein Producer-Slice **darf die Semantik nicht aufweichen**, insbesondere
  nicht „Feature-Liste fehlt ⇒ aus `protocol_version` ableiten". Dazu explizit:
  **Feature-Advertisement ist kein Trust-Grant** — Pairing, Approval-Gates und die Slice-B-Allowlist
  bleiben unberührt.
- **§7 Seed-Flag `order-envelope-v2`** — Empfänger-Semantik („ich kann X entgegennehmen", nicht „ich sende
  X"); ein Node darf es **erst** setzen, wenn sein Dispatch top-level ORDER wirklich behandelt, sonst ist
  das Flag eine **Lüge**, die beim Sender genau den stillen Drop auslöst, den V1 beschreibt. Es sagt
  **nichts** über Ausführung (Slice B), Signatur-Vertrauen, TTL oder Denylist.
- **§8 Was CO-gated bleibt** — Platzierung, Vokabular/Semver, Producer-Befüllung, Empfänger-Handler,
  Sender-Flip; mit dem Hinweis, dass der CO an einen Owner-/Infra-Schritt gebunden ist (PATH-Blocker),
  nicht an weitere Repo-Arbeit.

## Eingefaltet: #324-Reconcile
`#324` ist seit `mergedAt=2026-07-23T13:18:44Z` gemergt (`e994e65`). COMPLIANCE-Erst-Spalte, CHANGES-
Überschrift und TODO-Eintrag nachgezogen — `gh`-verifiziert, 1:1 in-place.

## Compliance
- **CO:** n/a — dieses Update **trifft keine** der offenen Entscheidungen; es verifiziert Anker und hält
  Grenzen fest, die ohnehin gelten. Der CO-pflichtige Beschluss bleibt unberührt offen.
- **CG/TS:** entfallen — kein Code/Test-Diff. Suite unverändert **2027 grün** (142 Files).
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent).
- **PC:** Secret-Scan clean (nur Doku).
- **DO ✅:** dieser Eintrag, `ADR-046-wire-feature-version-exchange.md` (Rev.-2-Kopf + §5–§8 + aktualisierte
  Beleg-Referenzen), `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** ADR-046-Implementierung (Platzierung + Vokabular/Semver, CO), TL-12 Slice C
(V1–V3), Slice B (§9), TL-11 Slice B (Host-Hop), TL-10-Verdrahtung (D1-Loader/D3).
