# ADR-033 — Durchsetzung der Ausführungsstufen am Hub-Ingress (Beta fail-closed)

**Status:** Accepted
**Datum:** 2026-07-03
**Kontext-Task:** v5 Spur 3 (Modell B), Kapitel 07 Arbeitsliste 7.8 **Punkt 6** — „Lese-/Schreib-Stufen am Hub-Eingang durchsetzen (Werkzeug-Name → Stufe → frei/Gate)".
**Gate:** Architektur-Gate **2** (ENTSCHEIDUNGEN.md, 02.07.): Lese-/Schreib-Stufen je Werkzeug sind **Beta-Pflicht**.
**Verwandt:** ADR-028 D4 (`execution_tier` self/gate/consensus, `deriveExecutionTier`), ADR-032 (Phantom-Announce-Guard). Design-Vorgabe **10** (austauschbarer Meldekanal + Freigabe-Matrix) = Folge-Design, hier **nicht** umgesetzt.

## Problem

Die Ausführungsstufe `execution_tier` (`self | gate | consensus`) wird seit ADR-028 D4 aus
`permissions`/`trust_level` abgeleitet (`deriveExecutionTier`, `mcp-service-registry.ts`) und fließt
durch die **gesamte** Forward-Kette: `resolveMcp` → `planMcpRoute` → `buildMcpForwardSpec` →
`buildMcpForwardDispatch` → Executor. Der Executor **auditiert** die Stufe sogar
(`MCP_FORWARD_TX … tier=<tier>`).

Aber: **nirgends wird die Stufe durchgesetzt.** `handleMcpIngress` (`mcp-ingress.ts`) prüft
Sender-Auth (D3), Servername und Routbarkeit — und reicht danach **jeden** routbaren Dispatch an den
Executor weiter, **unabhängig von der Stufe**. Die Stufe ist heute rein **dekorativ**.

Solange der Executor ein 501-Stub war, war der Blast-Radius null. Mit dem Live-Forward-Executor
(T3.3, PR #237) bedeutet die fehlende Durchsetzung: ein als `gate`/`consensus` eingestufter
(schreibender/kritischer) MCP-Aufruf würde **ohne jede Freigabe live an den Owner weitergereicht**.
Das verletzt Gate 2 (Beta-Pflicht) und die eiserne Regel aus Kapitel 07 (7.4): *„Ist kein Kanal
erreichbar, bleibt ein schreibender Aufruf verweigert — niemals durchwinken."*

## Entscheidung

`handleMcpIngress` setzt die Stufe **vor** dem Executor-Aufruf durch (fail-closed):

| Stufe | Bedeutung | Verhalten am Hub-Ingress (Beta) |
|---|---|---|
| `self` | lesend | **frei** → an den Executor weiterreichen |
| `gate` | schreibend | **403 verweigert** — Freigabe nötig, aber der Meldekanal (Design-Vorgabe 10 / 7.8 Punkt 6a) ist **noch nicht gebaut** → kein Kanal ⇒ verweigert |
| `consensus` | kritisch | **403 verweigert** — Einzel-Freigabe genügt nicht; zentral in der Beta nicht erlaubt |

Umsetzung: reine, exportierte Funktion `enforceExecutionTier(tier, server)` → `null` (erlaubt) oder
`{ status: 403, body }` (verweigert). Aufgerufen in `handleMcpIngress` **nach** der Dispatch-Planung
(die Stufe steht dann fest) und **vor** `deps.execute`. Die Stufe wird aus dem Dispatch gelesen
(`local.execution_tier` bzw. `remote.request.execution_tier`) — dieselbe Quelle, die der Executor
auditiert, keine zweite, driftende Ableitung.

Das ingress-seitige Audit (`mcp-ingress-api.ts`) verbucht jeden 403 als `MCP_FORWARD_REJECT`
(beidseitiges Audit bleibt gewahrt). Damit eine **Tier-Verweigerung** nicht mit einer
**Sender-Auth-Ablehnung** verwechselt wird (beide 403), trägt das REJECT-Detail bei Tier-Denials ein
`tier=<gate|consensus>`-Suffix (aus dem Antwort-Body abgeleitet) — Auth-Ablehnungen haben keins.

## Warum fail-closed statt Telegram-Gate jetzt

Der **eigentliche** Schreib-Fluss (Aufruf anhalten → Betreiber über einen Meldekanal fragen →
entscheiden) hängt an Design-Vorgabe 10: der Meldekanal ist eine **austauschbare Schnittstelle**
(Telegram/Cockpit/CLI/E-Mail/…) plus **Freigabe-Matrix**. Dieses Design ist noch **offen** (Kapitel
10/13). Bis es steht, ist die einzig zulässige Beta-Semantik die eiserne Regel: **kein Kanal ⇒ Schreiben
verweigert.** Damit ist dieser Slice die **sichere Untergrenze** von Punkt 6 und blockiert nicht auf
dem noch offenen Kanal-Design.

## Bewusste Grenze (Naht, Folge-Slices)

- **Stufe ist derzeit pro-Server**, nicht pro einzelnem Werkzeug. `deriveExecutionTier` klassifiziert
  die `permissions` der Steckbrief-Deklaration, nicht den konkret aufgerufenen Tool-Namen aus dem
  JSON-RPC-Payload. Für die Beta-Fähigkeiten (pal: `permissions=["query"]` → self; unifi:
  `["network.read"]` → self) ist das **deckungsgleich** mit „alle angebotenen Tools sind lesend".
  Echte pro-Tool-Granularität (ein Server mit gemischt lesenden/schreibenden Tools) verlangt ein
  **strukturiertes pro-Tool-Stufenfeld im Steckbrief** (heute faltet die CRDT-`Capability` die Tools
  nur in die `description`) — eigener Folge-Slice, hier ausdrücklich **nicht** enthalten.
- **Meldekanal + Freigabe-Matrix** (Design-Vorgabe 10) = eigener Design-Slice. Erst danach wird aus
  „`gate` → 403" ein „`gate` → Freigabe-Anfrage".

## Konsequenzen

- **+** Gate 2 am kritischen Pfad erfüllt: schreibende/kritische Aufrufe können in der Beta **nicht**
  ungefragt über die Vermittlung ausgeführt werden — die wichtigste Sicherheitsbremse (7.4) greift.
- **+** Kein Deploy, kein Secret, kein Infra-Eingriff; reine Daemon-Logik, unit-testbar ohne TLS-Server.
- **0** Der Zwei-Rechner-Beweis (7.8 Punkt 5, `list_clients` → `self`) bleibt **unberührt** — self läuft durch.
- **−** Ein künftiger schreibender MCP wird bis zum Kanal-Design hart verweigert (403), nicht gequeued.
  Das ist beabsichtigt (fail-closed) und dokumentiert.
- **Audit-Hinweis (CR-M1):** Da die Tier-Verweigerung **vor** dem Executor greift, erzeugt ein
  abgelehnter Schreib-Aufruf **nur** ein RX-seitiges `MCP_FORWARD_REJECT … tier=<..>` und **kein**
  `MCP_FORWARD_TX` (es wurde nichts weitergereicht). Das ist korrekt — das Fehlen eines TX-Eintrags ist
  hier kein Audit-Loch, sondern der Beweis, dass die Bremse vor dem Forward gegriffen hat.
