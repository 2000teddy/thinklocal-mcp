# changes/2026-07-22 — feat(wire): ADR-046 ungegateter Consumer-Kern `supportsFeature` (fail-closed)

**Typ:** additiver, **read-only** Groundwork-Slice (Code + Tests). Der **kleinste ehrliche ungegatete**
Baustein des ADR-046-Pfads (Wire-Feature/Version-Exchange, der TL-12-Slice-C-Enabler). **Kein**
Deploy/Secret/Gate, **kein** neuer State, **kein** Runtime-Verhaltenswechsel (kein Aufrufer).

## Warum jetzt genau dieser Sliver
ADR-046 (Status **Proposed**) lässt **zwei** Fragen bewusst offen, die **vor** dem eigentlichen Groundwork
ein CO (Cross-Vendor-`pal:consensus`, derzeit pal-PATH-blockiert, `[[pal-review-backend-agy-missing]]`)
brauchen:
1. **Platzierung** der annoncierten Feature-Liste auf der Agent-Card (eigener `protocol`-Block vs.
   `capabilities.services`) — ADR-046 §Konsequenzen „−/offen (CO)".
2. **Vokabular + Semver-Politik** der Feature-Flags — ADR-046 §3.

Der Producer-`protocol`-Block, das Feature-Seed (`order-envelope-v2`) und die `version-compat`-Verdrahtung
hängen also an diesen CO-Beschlüssen. **Ungegatet** ist genau die non-negotiable §2-Invariante, wenn man
sie von beiden offenen Fragen entkoppelt.

## Was
- **`packages/daemon/src/wire-feature.ts` (neu, rein):** `supportsFeature(advertisedFeatures, feature)` →
  `boolean`. Nimmt die annoncierte Feature-**Liste** (NICHT die `AgentCard`) und den Feature-**Namen** als
  Parameter → **platzierungs- UND vokabular-agnostisch**: kein neues Card-Feld, kein geseedetes Flag, keine
  Semver-Politik. **Fail-closed / total:** `true` **nur** bei echtem Array, das den exakten String enthält;
  `undefined`/`null`/Nicht-Array/leer/feature-nicht-gelistet/non-string-Elemente/leeres-oder-non-string-
  `feature` ⇒ `false`. Wirft nie. Kodifiziert „**absent ⇒ false, NIE assume-yes**" (ADR-046 §2) an EINER
  Stelle, die die CO-Folge-Slice mit `card.<platzierung>?.features` aufruft.

## Tests (+10, Suite **1897 grün**, 138 Files)
- `wire-feature.test.ts`: positiver Pfad (single/multi), fail-closed (undefined/null/leer/nicht-gelistet/
  exakter-Match-kein-Präfix), Totalität gegen malformed (Nicht-Array String/Objekt/Zahl; non-string-Elemente
  mit gemischtem echtem Treffer; leeres/non-string `feature`).

## Abgrenzung (bewusst außer Scope — bleibt CO-gated / Slice C proper)
- Card-`protocol`-Block + Platzierung (§1), Producer-Befüllung, Feature-Registry, `version-compat`-
  Verdrahtung, Feature-Vokabular/Semver (§3).
- ORDER-Empfänger-Handler, Sender-Flip, ORDER-Marker-Pfad = TL-12 Slice C proper.

## Compliance
- **CO:** entfällt — dieser Slice implementiert **ausschließlich** den bewusst decision-unabhängigen Teil;
  die CO-pflichtigen Beschlüsse (Platzierung, Vokabular/Semver) werden **nicht** berührt (Design gepinnt in
  ADR-046). Keine neue Architektur-Frage entschieden.
- **CG:** entfällt (`clink`/`gemini` nicht im PATH; kein Boilerplate-Delegat).
- **TS ✅:** +10 Tests, Suite **1897 grün**, `tsc --noEmit` (strict) 0, eslint 0 errors / prettier clean.
- **CR ✅:** adversariales Claude-Subagent — **GREEN, keine Findings**; fail-closed-Vertrag korrekt
  (einziger `true`-Pfad hinter zwei Guards), „ungegatet"-Claim bestätigt (keine Card-/Vokabular-/Semver-
  Bindung, 0 Aufrufer), total/deterministisch.
- **PC ✅:** Secret-Scan clean.
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`,
  `docs/architecture/ADR-046-wire-feature-version-exchange.md` (§Umsetzungsstand).
