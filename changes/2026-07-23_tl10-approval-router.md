# changes/2026-07-23 — feat(gate): TL-10 Slice-B-Prep — `requestApprovalViaMatrix` (Matrix → Kanal → Freigabe)

**Typ:** additive, **ungegatete** Kompositions-Primitive (Code + Tests). Der letzte agentenseitig freie
TL-10-Slice: das fehlende **Bindeglied** zwischen zwei bereits gemergten, aber unverbundenen Hälften —
**ohne** TOML-Loader, **ohne** Ingress-Verdrahtung, **ohne** Env-Flag, **ohne** D3-Sign-off, **ohne**
Christian-gatete Aktivierung. 0 Aufrufer ⇒ kein Runtime-Change.

## Beleg (warum genau dieser Slice)
Beide Hälften liegen auf `main` und sind rein/unverdrahtet:
- **Matrix-Seite:** `freigabe-matrix.ts` `resolveEntry` + `isRoutable` (Slice A, **#300**).
- **Registry-Seite:** `MeldekanalRegistry.requestApprovalOn(channelId, req)` (D2-Prep, **#317**).

`SECURITY.md` „Freigabe-Matrix (TL-10)" listet als **Aktivierungs-Vorbedingung 2** exakt: „die Kanalauswahl
wird auf den **Matrix-Kanal** beschränkt (statt „erster gesunder")". Die Registry-Methode allein erfüllt das
nicht — es fehlte die Komposition, die den Matrix-Kanal überhaupt an sie übergibt. Genau die liefert dieser
Slice, und nur die. Die verbleibenden Vorbedingungen (1 D3-Sign-off, 3 Env-Flag-Regime, 4 kuratierte
Matrix-Datei) bleiben unberührt gated.

## Was
- **Neu `approval-router.ts`:** `requestApprovalViaMatrix(matrix, approver, ctx, req)` →
  `{ decision, target }`.
  - **Nicht routable** (kein Match / leere Matrix / nicht wohlgeformtes Ziel — D5) ⇒ `denied-no-channel`,
    und es wird **niemals ein Kanal gefragt** (`target === null` ⇔ „niemand wurde gefragt").
    Routbarkeit entscheidet allein `isRoutable(resolveEntry(...))`; der Router prüft **keine** Teilbedingung
    selbst (die `resolved === null`-Abfrage ist reines Null-Narrowing für den Compiler, keine zweite
    Policy — beide Wege enden identisch im Default-Deny).
  - **Routable** ⇒ **ausschließlich** `requestApprovalOn(target.channel, req)`. **Kein** Fallback auf
    `requestApproval()` („erster gesunder Kanal") — genau die Auswahl, die die Matrix ersetzen soll.
    Erzwungen **per Typ**: der Router nimmt nur die schmale `ChannelBoundApprover`-Sicht entgegen, in der die
    Fallback-Methode **gar nicht existiert** (fail-closed per Typ, nicht per Disziplin).
  - **Total:** Wurf ⇒ `error` (Router wirft nie); unbekanntes Decision-Shape eines injizierten Approvers ⇒
    `error` über das **exportierte** `normalizeDecision` — dieselbe Fail-closed-Mechanik an EINER Stelle
    statt Nachbau. `isApproved()` bleibt der EINZIGE Auswertungspfad; der Router interpretiert kein `outcome`.
  - **`decider` bleibt deklarativ (D3, `SECURITY.md` „⚠️ Kernaussage"):** das Ziel inkl. `decider` wird nur
    für Audit/Anzeige durchgereicht, **nicht** durchgesetzt. Insbesondere macht `consensus:quorum=N` einen
    Eintrag **nicht** mehrstimmig; ein Consensus-*Decider* wird hier weder erzwungen noch abgelehnt (im
    Ingress bleibt der `consensus`-*Tier* ein hartes 403). Ein Test schreibt das fest, damit eine spätere
    Verschärfung eine **bewusste CO-Entscheidung** bleibt statt unbemerkt hineinzurutschen.
- **`meldekanal.ts`:** `normalizeDecision` von modul-privat auf **`export`** gehoben (+4/-1). Rein additiv,
  kein Verhaltens-/Signaturwechsel — nur damit die vorgelagerte Komposition dieselbe Normalisierung benutzt.
- **Doku:** `docs/architecture/TL-10-freigabe-matrix-scoping.md` §7 „Umsetzungsstand" — §5-CO-Ergebnis,
  Bausteintabelle (#300 / #317 / dieser PR), der Kompositions-Vertrag und §7.2 „was für Slice B noch fehlt".

## Tests (+18; Suite **1950 grün**, 140 Files)
`approval-router.test.ts`, gruppiert nach Vertrag:
- **Nicht routable ⇒ niemand wird gefragt** (5): leere Matrix, anderer Server, anderes `tier`, anderes
  Werkzeug ohne Wildcard, sowie ein **an `isRoutable` vorbei konstruiertes** Ziel (leerer Kanalname) — belegt
  die Guard-Wirkung selbst, damit ein künftiger, laxerer Loader nicht unbemerkt fail-open wird.
- **Routable ⇒ exakt der Matrix-Kanal** (5): genau der aufgelöste Kanal wird adressiert; exakter Eintrag
  schlägt Wildcard; Wildcard greift ohne exakten Eintrag; Anfrage unverändert durchgereicht; **KEIN-Fallback-
  Regression** gegen eine **echte** `MeldekanalRegistry` mit gesundem *Fremd*kanal → `denied-no-channel`,
  Fremdkanal **nie** gefragt, `registry.requestApproval` **nie** aufgerufen (Spione).
- **Totalität** (5): `rejected`/`timeout` unverändert durchgereicht; Wurf ⇒ `error` mit Ziel für Audit;
  7 malformte Shapes (`null`/`undefined`/Zahl/String/`{}`/unbekanntes `outcome`/non-string) ⇒ je `error`,
  **nie** `approved`; unbekannter Kanal gegen die echte Registry ⇒ `denied-no-channel` mit sprechender `note`.
- **`decider` deklarativ** (2): `human:<id>` durchgereicht aber nicht erzwungen; `consensus:quorum=N` weder
  erzwungen noch abgelehnt (dokumentierte v1-Grenze, festgeschrieben).

## Abgrenzung (bewusst außer Scope — bleibt gated)
TOML-Loader für `config/freigabe-matrix.toml` + die kuratierte Matrix-Datei (D1, Policy-Inhalt),
Verdrahtung am `resolveApproval`-Seam (`mcp-ingress.ts`), Env-Flag-Regime, **D3-Christian-Sign-off**,
Aktivierung (Flag-Flip, owner-gated).

## Compliance
- **CO/CG:** entfällt — additive Primitive einer bereits konsentierten Design-Linie (§5-CO 2026-07-20:
  D1/D2/D3/D4/D5 entschieden; die Komposition folgt daraus zwingend, keine neue Architektur-Frage).
  `clink`/`gemini` nicht im PATH.
- **TS ✅:** +18 Tests, Suite **1950 grün** (140 Files), `tsc --noEmit` (strict) 0, geänderte/neue Dateien
  eslint 0 errors / 0 warnings, prettier clean.
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent,
  `[[pal-review-backend-agy-missing]]`).
- **PC:** Secret-Scan clean (keine Credentials, keine Hosts/IPs, keine Policy-Datei).
- **DO ✅:** dieser Eintrag, `TL-10-freigabe-matrix-scoping.md` §7, `CHANGES.md`, `COMPLIANCE-TABLE.md`,
  `TODO.md`.
