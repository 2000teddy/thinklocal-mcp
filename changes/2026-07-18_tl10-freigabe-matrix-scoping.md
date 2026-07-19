# changes/2026-07-18 — docs(tl10): Freigabe-Matrix v1 Scoping/Discovery-Note

**Typ:** Doc-only (Design-Doku VOR Code, CLAUDE.md Schritt 3). **Kein** Code/Runtime-Change,
**kein** Deploy/Secret/Gate.

## Warum
TL-10 (Freigabe-Matrix v1: Werkzeug-Stufe → Kanal → Entscheider) ist der nächste v5.1-Schritt zwischen dem
TL-09b-Ingress und der Meldekanal-Registry. Der `resolveApproval`-Seam existiert seit TL-09b, aber es fehlte
die Design-Note, die (a) den Seam groundet, (b) die CO-Auflagen (2026-07-15) konsolidiert und (c) die **exakt
noch offenen Entscheidungen** benennt, bevor Code entsteht. Diese Note schließt die Lücke — **discovery/design
only**, kein Slice implementiert.

## Was
- **Neu `docs/architecture/TL-10-freigabe-matrix-scoping.md`:**
  - **Seam gegroundet:** `resolveApproval(ctx={server,tool,tier,senderUri})` (`mcp-ingress.ts:105-110`, nur für
    `tier==='gate'`, `:174`); heute wählt `MeldekanalRegistry.requestApproval` den **ersten gesunden** Kanal
    terminal (`meldekanal.ts:194-213`) — TL-10 ersetzt genau diese Auswahl durch matrix-getriebenes Routing.
    Auswertung bleibt `isApproved`-Allowlist (`meldekanal.ts:83-85`).
  - **CO-Auflagen gepinnt** (tier statt tool_class; Parse-Rejects; `isRoutable()`-Guard analog `isApproved`).
  - **v1-Vorschlag:** Eintrags-Schema, Matching/Spezifität, decider-Grammatik (`human:<id>` /
    `consensus:quorum=N` N≥2, letzteres nur parse-validiert — Consensus-Pfad bleibt hartes 403).
  - **Slice-Zerlegung A(rein `freigabe-matrix.ts`)→B(Verdrahtung)**, analog TL-09 A→B.
  - **§5: 5 exakt offene Entscheidungen** (Matrix-Quelle/TOML, Kanal-Bindung, decider-v1-Semantik, kanonische
    Server-Prüfquelle, leere-Matrix=403) — Gate für den ersten Code.
- **`TODO.md`:** TL-10 auf `[~]` gesetzt, Scoping-Sub als erledigt, Slice A/B als offen nach §5 angelegt.

## Abgrenzung
Entscheidet **nichts Neues** über die CO-Auflagen hinaus; macht den v1-Vorschlag explizit und §5 zum Code-Gate.
Kein Slice implementiert. Die künftige ADR (nach ADR-043) hält die §5-Entscheidungen fest, bevor Slice A startet.

## Compliance
- **CO:** CO-Auflagen liegen vor (2026-07-15); diese Note **konsolidiert** sie + listet den Rest als §5 offen
  → keine neue Design-Entscheidung getroffen (deshalb kein neuer CO-Lauf nötig).
- **CG/TS:** entfallen — kein Code.
- **CR:** Doc-Accuracy self — jedes Code-Zitat per `grep`/`sed` gegen die Quelle verifiziert
  (`mcp-ingress.ts:105-110/169/174`, `meldekanal.ts:194-213/83-85`, `mcp-ingress-api.ts:146`).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die Scoping-Note.
