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
  - **`ctx`/`req`-Bindung (aus dem CR):** beide müssen dasselbe `(tier, server, tool)`-Tripel tragen, sonst
    ⇒ `denied-no-channel` ohne Kanal-Frage. Der Kanal wird über `ctx` gewählt, freigegeben wird `req` — zwei
    Quellen für dasselbe Tripel wären ein **Confused-Deputy-Vektor** (Kanalwahl nach dem harmlosen Werkzeug,
    Vorlage des scharfen). Unter D3-Nicht-Durchsetzung IST die Kanalwahl die einzige Kontrolle, die die
    Matrix liefert — die Übereinstimmung wird deshalb **erzwungen**, nicht nur dokumentiert.
  - **Nicht routable** (kein Match / leere Matrix / nicht wohlgeformtes Ziel — D5) ⇒ `denied-no-channel`,
    und es wird **niemals ein Kanal gefragt** (`target === null` ⇔ „niemand wurde gefragt").
    Routbarkeit entscheidet allein `isRoutable(resolveEntry(...))`; der Router prüft **keine** Teilbedingung
    selbst (die `resolved === null`-Abfrage ist reines Null-Narrowing für den Compiler, keine zweite
    Policy — beide Wege enden identisch im Default-Deny). **Auch ein Wurf der Auflösung selbst** (an
    `parseFreigabeMatrix` vorbei konstruierte Struktur) wird gefangen ⇒ Default-Deny statt Exception.
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
    ⚠️ **Tragende externe Vorbedingung (aus dem CR ergänzt):** die Sicherheit dieses Nicht-Erzwingens hängt
    daran, dass der `consensus`-**Tier** im Ingress ein hartes 403 bleibt und der Router mit
    `ctx.tier === 'consensus'` **nie erreicht** wird — diese Schutzwirkung liegt **außerhalb** dieses Moduls
    und ist hier durch nichts getestet. Würde Slice B `resolveApproval` vor oder anstelle des 403
    verdrahten, genügte **eine** Zustimmung für `quorum=3`. Steht jetzt als Pflichtpunkt in §7.2.
- **`meldekanal.ts` — `normalizeDecision` exportiert UND gehärtet (aus dem CR, MEDIUM):**
  - Export (statt modul-privat), damit die vorgelagerte Komposition dieselbe Normalisierung benutzt.
  - **Nur EIGENE Eigenschaften zählen** (`Object.hasOwn`) und **Arrays sind keine Decision**: bisher las die
    Funktion `outcome` über die **Prototypenkette** — `Object.create({ outcome: 'approved' })` oder ein via
    Prototype-Pollution gesetztes `Object.prototype.outcome` machte ein `{}` eines Kanals zu **`approved`**.
    Ausgerechnet der Fail-closed-Filter war damit fail-**open** (Fund des externen Reviews; die einzige
    Pollution-Primitive im Repo ist `config.ts` `deepMerge` über TOML-Keys, also nur für jemanden erreichbar,
    der ohnehin `daemon.toml` schreiben kann — deshalb MEDIUM, nicht HIGH).
  - **Total gemacht:** werfender `outcome`/`note`-Getter und werfendes `toString` eines unbekannten
    `outcome` ⇒ `error` statt Exception. Damit hält die Zusicherung „wirft nicht" von `requestApproval`,
    `requestApprovalOn` und dem Router tatsächlich (vorher konnte ein feindlicher Getter durch die
    Registry-Methoden nach oben durchschlagen).
- **Doku:** `docs/architecture/TL-10-freigabe-matrix-scoping.md` §7 „Umsetzungsstand" — §5-CO-Ergebnis,
  Bausteintabelle (#300 / #317 / dieser PR), der Kompositions-Vertrag und §7.2 „was für Slice B noch fehlt".

## Tests (+39; Suite **1971 grün**, 140 Files)
`approval-router.test.ts` (32), gruppiert nach Vertrag:
- **Nicht routable ⇒ niemand wird gefragt** (5): leere Matrix, anderer Server, anderes `tier`, anderes
  Werkzeug ohne Wildcard, sowie ein **an `isRoutable` vorbei konstruiertes** Ziel (leerer Kanalname) — belegt
  die Guard-Wirkung selbst, damit ein künftiger, laxerer Loader nicht unbemerkt fail-open wird.
- **Routable ⇒ exakt der Matrix-Kanal** (6): genau der aufgelöste Kanal wird adressiert; exakter Eintrag
  schlägt Wildcard; Wildcard greift ohne exakten Eintrag; Anfrage unverändert durchgereicht; **KEIN-Fallback-
  Regression** gegen eine **echte** `MeldekanalRegistry` mit gesundem *Fremd*kanal → `denied-no-channel`,
  Fremdkanal **nie** gefragt, `registry.requestApproval` **nie** aufgerufen (Spione); adressierter gesunder
  Kanal entscheidet.
- **Totalität der Approver-Antwort** (5): `rejected`/`timeout` unverändert durchgereicht; Wurf ⇒ `error` mit
  Ziel für Audit; 7 malformte Shapes ⇒ je `error`, **nie** `approved`; unbekannter Kanal gegen die echte
  Registry ⇒ `denied-no-channel` mit sprechender `note`.
- **`decider` deklarativ** (2): `human:<id>` durchgereicht aber nicht erzwungen; `consensus:quorum=N` weder
  erzwungen noch abgelehnt (dokumentierte v1-Grenze, festgeschrieben — mit der Warnung, dass das **keine**
  Billigung von „1-aus-N" ist).
- **`ctx`/`req`-Bindung** (2, neu aus dem CR): Kanalwahl nach dem harmlosen Werkzeug + Vorlage des scharfen
  ⇒ denied, niemand gefragt; abweichender `server`/`tier` ebenso.
- **Totalität der AUFLÖSUNG** (6, neu aus dem CR): `null`/`undefined`/Zahl/nicht-iterierbare `entries`/
  Eintrag ohne `decider`/werfender `channel`-Getter ⇒ je `denied-no-channel` statt Wurf, niemand gefragt.
- **Prototypenkette** (4, neu aus dem CR): `Object.create({outcome:'approved'})`, verseuchtes
  `Object.prototype` + `{}` **durch eine echte Registry**, Array mit eigener `outcome`-Eigenschaft,
  werfender `outcome`-Getter ⇒ je `error`, nie `approved`.
- **Forensik** (2, neu aus dem CR): behauptet der Approver einen **abweichenden** `channelId`, bleibt der
  gestempelte Wert der **adressierte** Matrix-Kanal, die Selbstauskunft landet aber in der `note` (sonst
  tarnte die Stempelung eine Fremd-Entscheidung); gleicher Kanal ⇒ keine Rausch-`note`.

`meldekanal.test.ts` (+7, neu aus dem CR): dieselben Prototypenketten-/Array-/Getter-Angriffe **direkt gegen
`requestApproval` UND `requestApprovalOn`**, plus geerbtes `note` wird nicht übernommen und eine wohlgeformte
eigene Decision bleibt unverändert gültig.

## Abgrenzung (bewusst außer Scope — bleibt gated)
TOML-Loader für `config/freigabe-matrix.toml` + die kuratierte Matrix-Datei (D1, Policy-Inhalt),
Verdrahtung am `resolveApproval`-Seam (`mcp-ingress.ts`), Env-Flag-Regime, **D3-Christian-Sign-off**,
Aktivierung (Flag-Flip, owner-gated).

## Compliance
- **CO/CG:** entfällt — additive Primitive einer bereits konsentierten Design-Linie (§5-CO 2026-07-20:
  D1/D2/D3/D4/D5 entschieden; die Komposition folgt daraus zwingend, keine neue Architektur-Frage).
  `clink`/`gemini` nicht im PATH.
- **TS ✅:** +39 Tests, Suite **1971 grün** (140 Files), `tsc --noEmit` (strict) 0, neue/geänderte Dateien
  eslint 0 errors / 0 warnings (die eine verbleibende Warnung in `meldekanal.test.ts:369` ist
  **vorbestehend**, per `git stash` gegengeprüft), prettier clean.
- **CR ✅:** adversariales Claude-Subagent, Security-Fokus (`agy`/`codex` nicht im PATH,
  `[[pal-review-backend-agy-missing]]`) — **kein HIGH**, 26 Angriffs-Proben gefahren. **4 MEDIUM, alle an
  der Wurzel gefixt:** (1) `resolveEntry`/`isRoutable` lagen **außerhalb** des `try` → eine geforgte Matrix
  warf statt zu verweigern, obwohl das Modul „wirft nie" zusagt; (2) `ctx`/`req` trugen dasselbe Tripel
  **ungebunden** → Confused-Deputy (Kanalwahl nach dem harmlosen Werkzeug); (3) `normalizeDecision` las
  `outcome` über die **Prototypenkette** und akzeptierte Arrays → `{}` konnte `approved` werden;
  (4) Consensus-Nicht-Erzwingung ist korrekt, aber die tragende externe Vorbedingung (Ingress-403) war
  nicht benannt → jetzt in Modul-Doc, §7.2 und Testkommentar. Zusätzlich LOW-1 (`channelId`-Stempelung
  vernichtete die Selbstauskunft des Approvers → geht jetzt in die `note`), LOW-3 (Registry-`normalizeDecision`
  außerhalb jedes `try` → durch die Härtung mit erledigt) und die Test-Zählung im Doku-Text korrigiert.
  **Bestätigt GREEN geblieben:** kein Fail-open-Pfad zu `approved` ohne aktiv zustimmenden Matrix-Kanal
  (Thenables, boxed Strings, Symbole, rejected Promises, `Object.create(null)`, …), kein Fallback-Leak,
  kein Guard-Bypass, 0 Aufrufer, Export verhaltensneutral, Doku-Zahlen real.
  **Nicht gefixt, bewusst benannt:** whitespace-only Kanalname parst (`length === 0` statt `trim()`) und
  `target.decider` aliast die geparste Policy — beide **vorbestehend aus #300**, fail-closed in der Wirkung,
  gehören in den D1-Loader-Slice.
- **PC:** Secret-Scan clean (keine Credentials, keine Hosts/IPs, keine Policy-Datei).
- **DO ✅:** dieser Eintrag, `TL-10-freigabe-matrix-scoping.md` §7, `CHANGES.md`, `COMPLIANCE-TABLE.md`,
  `TODO.md`.
