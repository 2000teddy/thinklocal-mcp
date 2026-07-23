# TL-10 — Freigabe-Matrix v1: Scoping / Discovery

**KW30 · Scoping-Note (kein Code) · Erstellt 2026-07-18 · Repo-Grounding gegen den TL-09b-Seam.**
Zweck: die kleinste korrekte v1 der Freigabe-Matrix (Werkzeug-Stufe → Kanal → Entscheider) festlegen
**bevor** Code entsteht (CLAUDE.md Schritt 3), inkl. der **exakt noch offenen Entscheidungen**. Analog zu
`TL-12-slice-b-execution-scoping.md`.

## 1. Der Seam (heute, code-gegroundet)
Der Freigabe-Pfad existiert seit TL-09b (ADR-037) und hat **einen** Einschub-Punkt:

- **Ingress ruft** `resolveApproval(ctx)` mit `ctx = { server, tool, tier, senderUri }`
  (`mcp-ingress.ts:105-110`, aufgerufen in `:174-181` nur für `tier === 'gate'`; `consensus` bleibt hartes 403).
- **Heute baut** `mcp-ingress-api.ts:131-160` daraus einen `ApprovalRequest` (`requestId`/`summary` ergänzt)
  und ruft **die ganze** `MeldekanalRegistry.requestApproval(req)`.
- **Die Registry wählt heute** den **ERSTEN gesunden** Kanal (terminal) und gibt dessen `ApprovalDecision`
  zurück (`meldekanal.ts:194-213`) — **kein** Routing nach `tier`/`server`/`tool`. Kein gesunder Kanal ⇒
  `denied-no-channel`.
- **Auswertung** ausschließlich über `isApproved(decision)` (`meldekanal.ts:83-85`, Allowlist: nur
  `outcome==='approved'`).

**TL-10 v1 ersetzt die „erster-gesunder-Kanal"-Auswahl durch eine matrix-getriebene Auswahl:**
`(tier, server, tool)` → passender Matrix-Eintrag → **welcher** Kanal + **welcher** Entscheider-Anspruch.
Der Rest des Seams (fail-closed, `isApproved`-Allowlist, Audit `MCP_FORWARD_GATE`) bleibt **unverändert**.

## 2. CO-Auflagen (bereits entschieden, 2026-07-15 — bindend)
Aus `TODO.md` TL-10:
1. **Feld `tier` statt `tool_class`** — `tier` ist ein **harter Prädikat-Filter** (`McpExecutionTier`), **nie**
   ein freies Label. Die Matrix matcht gegen die bereits berechnete effektive `tier` (`maxTier(...)`,
   `mcp-ingress.ts:169`), erfindet keine eigene Klassifikation.
2. **Parse-Rejects** (Matrix wird beim Laden **fail-closed** validiert, ein Verstoß ⇒ Matrix ungültig,
   kein Teil-Laden): tool-ohne-server; Duplikat-Spezifität; unbekannte Keys; non-kanonischer Server;
   unbekannte `decider`-Grammatik; `consensus` ohne `quorum:N` mit N≥2.
3. **`isRoutable()`-Guard analog `isApproved`** — genau **ein** erlaubter Auswertungspfad: nur ein Eintrag,
   der einen zustellbaren Kanal + gültigen Entscheider auflöst, ist „routable"; jeder andere Ausgang ⇒
   **nicht** routable ⇒ fail-closed (Ingress fällt auf 403, wie ohne Resolver). Aufrufer prüfen NIE selbst
   Teilbedingungen (eiserne Regel wie bei `isApproved`).

## 3. Vorschlag v1 (Diskussionsstand — die offenen Punkte in §5 gehen VOR Code)
### 3.1 Eintrags-Schema (Vorschlag)
Ein Matrix-Eintrag = Prädikat + Ziel:
```
{ tier: 'gate',            # Pflicht, harter Filter (McpExecutionTier)
  server: 'unifi',         # kanonischer Servername (Pflicht — CO: tool-ohne-server = reject)
  tool: 'block_client' | '*',   # exakt ODER Wildcard '*' (server-weit)
  channel: '<channelId>',  # muss eine registrierte Meldekanal.id sein
  decider: 'human:<id>' | 'consensus:quorum=N' }   # Entscheider-Grammatik (§3.3)
```
### 3.2 Matching + Spezifität (Vorschlag)
- Kandidaten = Einträge mit `tier`-Match **und** `server`-Match. Auswahl **spezifischster** Eintrag:
  exakter `tool` > Wildcard `tool:'*'`. **Duplikat-Spezifität** (zwei Einträge gleicher Spezifität für
  denselben `(tier,server,tool)`) ⇒ **Parse-Reject** (nie Laufzeit-Tie-Break).
- **Kein** passender Eintrag ⇒ **nicht routable** ⇒ fail-closed 403 (Default-Deny, konsistent mit
  ADR-033-Untergrenze).
### 3.3 Decider-Grammatik (Vorschlag)
- `human:<id>` — ein benannter Betreiber-Entscheider (v1: rein deklarativ, gemappt auf `channel`).
- `consensus:quorum=N` (N≥2) — mehrstimmig; **v1 NICHT ausführbar** (der `consensus`-Pfad ist im Ingress
  weiter hartes 403, `mcp-ingress.ts:172`). In der Matrix nur **parse-validiert** (N≥2), damit die Grammatik
  steht, bevor der Consensus-Executor existiert. `quorum` fehlend/<2 ⇒ Parse-Reject.

## 4. Slice-Zerlegung (analog TL-09 A→B)
- **TL-10 Slice A (rein, testbar, KEINE Verdrahtung):** neues Modul `freigabe-matrix.ts` mit
  `parseFreigabeMatrix(raw): FreigabeMatrix` (alle §2.2-Rejects), `resolveEntry(matrix, ctx): MatrixTarget | null`
  (Spezifität), `isRoutable(target): boolean` (Guard). Reine Funktionen, kein I/O, deterministisch — genau
  das Muster von `meldekanal.ts` Slice A. Voll unit-getestet (Match, jeder Parse-Reject, isRoutable-Allowlist).
  `mcp-ingress.ts`/`-api.ts` **unangetastet**.
- **TL-10 Slice B (Verdrahtung, eigener Slice):** `mcp-ingress-api.ts`-Resolver konsultiert VOR
  `registry.requestApproval` die Matrix: nicht-routable ⇒ fail-closed (kein Kanal gefragt); routable ⇒
  Kanalauswahl **auf den Matrix-Kanal beschränken** (statt „erster gesunder"). Hinter demselben
  Env-Flag-Regime wie TL-09b (Default aus ⇒ verhaltensidentisch). Braucht §5-Entscheidungen.

## 5. EXAKT noch offene Entscheidungen (VOR Slice A/B zu klären — CO/Christian)
1. **Matrix-Quelle/Serialisierung:** TOML-Sektion in `config/daemon.toml` vs. eigene Datei? (beeinflusst
   `parseFreigabeMatrix`-Eingabeform). — *offen.*
2. **Kanal-Bindung:** Wählt die Matrix einen **`channelId`** aus der bestehenden Registry (dann muss die
   Registry „nur diesen Kanal fragen" können — heute kann sie nur „erster gesunder"), oder trägt die Matrix
   selbst die Kanal-Instanz? — *offen; bestimmt, ob `MeldekanalRegistry` ein `requestApprovalOn(channelId,…)`
   braucht (kleiner Registry-Zusatz in Slice B).*
3. **`decider` v1-Semantik:** Ist `human:<id>` in v1 rein deklarativ (nur Audit/Anzeige) oder muss der
   gewählte Kanal den `<id>` erzwingen? — *offen; v1-Vorschlag: deklarativ.*
4. **Kanonischer Server — Prüfquelle:** gegen welche Liste validiert „non-kanonischer Server"? (`resolveMcp`-
   bekannte Server? Registry?) — *offen.*
5. **Leere/fehlende Matrix bei aktivem Flag:** ⇒ alles nicht-routable ⇒ 403 (Default-Deny) — *Vorschlag,
   zu bestätigen (konsistent mit TL-09b leerer Registry = 403).*

## 6. Abgrenzung
Diese Note **entscheidet nichts Neues** über die CO-Auflagen hinaus — sie groundet den Seam, macht den
v1-Vorschlag explizit und listet §5 als Gate für den ersten Code. Kein Deploy/Secret/Runtime-Change. Die
künftige ADR (nach ADR-043) hält die in §5 getroffenen Entscheidungen fest, bevor Slice A startet.

---

## 7. Umsetzungsstand (Nachtrag)

§5 ist seit dem **§5-CO vom 2026-07-20** (read-only `pal:consensus`, opus 8/10 + sonnet 8/10 einstimmig)
entschieden: **D1** eigene Datei `config/freigabe-matrix.toml`; **D2** `channelId`-Referenz + Registry-
`requestApprovalOn`; **D3** `human:<id>` v1 **deklarativ** (nur parse-validiert, Owner-Sign-off vor Slice B);
**D4** gegen die injizierte `resolveMcp`-`knownServers`-Liste; **D5** leer/kein Match ⇒ 403 Default-Deny.

Gemergt und **unverdrahtet** (je 0 Aufrufer, kein Runtime-Change):

| Baustein | Datei | PR |
|---|---|---|
| Parser / Resolver / Guard (Slice A) | `freigabe-matrix.ts` (`parseFreigabeMatrix`, `resolveEntry`, `isRoutable`) | #300 |
| Kanal-Bindung (D2-Prep) | `meldekanal.ts` `MeldekanalRegistry.requestApprovalOn(channelId, req)` | #317 |
| **Komposition (dieser Slice)** | **`approval-router.ts` `requestApprovalViaMatrix(matrix, approver, ctx, req)`** | **(dieser PR)** |

### 7.1 Der Kompositions-Vertrag (`approval-router.ts`)

Der Router verbindet die beiden Hälften — mehr nicht. Er ist damit exakt die **Aktivierungs-Vorbedingung 2**
aus SECURITY.md „Freigabe-Matrix (TL-10)" („die Kanalauswahl wird auf den Matrix-Kanal beschränkt"):

- **Nicht routable** (kein Match, leere Matrix, nicht wohlgeformtes Ziel — D5) ⇒ `denied-no-channel`, und es
  wird **niemals ein Kanal gefragt**. Routbarkeit entscheidet allein `isRoutable(resolveEntry(...))`; der
  Router prüft **keine** Teilbedingung selbst.
- **Routable** ⇒ **ausschließlich** `requestApprovalOn(target.channel, …)`. Es gibt **keinen** Fallback auf
  `requestApproval()` („erster gesunder Kanal") — genau diese Auswahl soll die Matrix ja ersetzen. Der Router
  nimmt dafür nur die schmale `ChannelBoundApprover`-Sicht entgegen, in der die Fallback-Methode **gar nicht
  existiert**: fail-closed per Typ, nicht per Disziplin.
- **Total:** Wurf oder unbekanntes Decision-Shape des Approvers ⇒ `error` (über das **exportierte**
  `normalizeDecision` der Registry — dieselbe Mechanik an EINER Stelle, kein Nachbau). Der Router wirft nie,
  und `isApproved()` bleibt der einzige Auswertungspfad.
- **`decider` bleibt deklarativ** (D3): das aufgelöste Ziel inkl. `decider` wird nur für Audit/Anzeige
  durchgereicht, **nicht** durchgesetzt. Insbesondere macht `consensus:quorum=N` einen Eintrag **nicht**
  mehrstimmig; ein Consensus-*Decider* wird hier weder erzwungen noch abgelehnt (im Ingress bleibt der
  `consensus`-*Tier* ein hartes 403). Ein Test schreibt dieses Verhalten fest, damit eine spätere
  Verschärfung eine **bewusste CO-Entscheidung** bleibt statt unbemerkt hineinzurutschen.

### 7.2 Was danach für Slice B noch fehlt (unverändert gated)

1. **TOML-Loader** für `config/freigabe-matrix.toml` (D1) — I/O, plus die kuratierte, reviewte Matrix-Datei
   selbst (ihr Inhalt ist Sicherheitspolicy).
2. **Verdrahtung** am `resolveApproval`-Seam (`mcp-ingress.ts`) inkl. **Env-Flag-Regime** wie TL-09b
   (Default AUS, lauter Startup-Warn bei „Flag an, Matrix leer/fehlt").
3. **D3-Owner-Sign-off (Christian)** — bewusste Bestätigung, dass `human:<id>` v1 nicht durchgesetzt wird.
4. **Aktivierung** (Flag-Flip in einer laufenden/Live-Instanz) — bleibt owner-gated.
