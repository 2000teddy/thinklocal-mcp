# changes/2026-07-23 — feat(tl11): Reconciliation-Sweep verdrahtet (Default AUS)

**Typ:** additive Daemon-Verdrahtung hinter **Env-Flag mit Default AUS** (Regime wie TL-09b) + Tests.
Ohne Flag **kein Verhaltens-Delta**. Kein Deploy/Secret/Host, kein Gate-Flip.
Enthält den eingefalteten Post-Merge-Reconcile für **#325**.

## Vorbemerkung zur Einordnung
Der TL-11-„MVP" im engeren Sinn (registrierte Agenten, Weckruf-Ereignis, dokumentierter Pfad zum
Mesh-Postfach) ist **bereits gemergt**: Slice A/ADR-043 (#271), gerichteter Wake (#277),
Consumer-Contract + Runbook, Draht-Conformance (#282/#283), Emitter-Ende-zu-Ende (#320), Sweep-Kern
(#322). Dieser Slice schließt die **verbliebene echte Lücke**, statt Vorhandenes zu wiederholen.

## Die Lücke
`agent:wake` ist erklärtermaßen **best-effort/lossy** (ADR-043 §3): es wird genau dann emittiert, wenn
eine Nachricht eintrifft. War der Supervisor einer Instanz in **genau diesem Moment** weg (Neustart,
Reconnect-Lücke, Crash), ist das Wake **verloren** — die Post liegt still im Postfach, und niemand erfährt
davon, bis der Konsument von sich aus pollt. Der Sweep beantwortet die Frage nachträglich: *welche live
registrierte Instanz hat ungelesene Post?*

## Was
**Neu `sweep-wiring.ts`** — `runReconciliationSweep` (ein Lauf, wirft nie) + `registerReconciliationSweep`
(Hook + Abmelde-Funktion). Verdrahtet in `index.ts` (**+20/-0**, additiv) hinter
`TLMCP_WAKE_SWEEP_ENABLED=1`, im Shutdown abgemeldet.

Die vier in ADR-047 §3 offenen Punkte sind **innerhalb der dort aufgeführten Optionen** entschieden —
keine davon neu erfunden:

| Punkt | Entscheidung | Warum |
|---|---|---|
| verschiebt oder ergänzt | **ergänzt** | die Konsumenten-Cold-Start-Pflicht bleibt; der Daemon sieht nicht jeden Supervisor-Neustart |
| Auslöser | **`agentRegistry.on('register')`** | Hook **existiert bereits**, feuert genau wenn eine Instanz (neu/nach Neustart) da ist; kein neuer Timer, **kein** Eingriff in die sicherheitsgehärtete WS-Datei (der WS-Connect-Hook wäre laut §3 die *teuerste* Variante, weil es ihn nicht gibt) |
| Rate-Semantik | **eigener `WakeCoalescer`** (§3 Option 1) | rate-begrenzt **und** nicht vom Inbox-Verkehr geschluckt — sonst verpuffte der Sweep genau im Fenster, das er beheben soll |
| Opt-in | **Flag, Default AUS** | ohne Flag wird die Verdrahtung gar nicht aufgerufen |

**Nur `register` löst aus** — `unregister`/`stale` heißt, die Instanz ist weg; sie zu wecken wäre sinnlos
und im `stale`-Fall ein Wake an einen toten Konsumenten.

**Bewusst offen gelassen:** die **Legacy-Politik**. `unreadCount({forInstance})` zählt per Default keine
`to_agent_instance IS NULL`-Zeilen; der Sweep erbt diesen Default, statt ihn still zu verschieben — das
wäre eine Vertragsfrage. Im Modul-Doc und in ADR-047 §3 benannt.

**Fail-safe (der Sweep ist Nachbesserung, kein kritischer Pfad):** werfende Registry ⇒ Sweep übersprungen ·
werfender Bus ⇒ die übrigen Instanzen bekommen ihr Wake trotzdem · werfender Zähler ⇒ diese Instanz
entfällt (#322) · der Listener läuft **synchron** im Registry-Pfad, deshalb dort zusätzlich gekapselt.
**Fail-closed:** ohne routbare SPIFFE kein Wake.

## Tests (+13; Suite **2040 grün**, 143 Files)
Instanz mit Post ⇒ genau ein gerichtetes Wake mit SPIFFE · niemand hat Post ⇒ kein Wake · ohne SPIFFE
kein Wake · **Wake ist inhaltsfrei** (die Anzahl ungelesener Nachrichten reist **nicht** mit — das wäre
ein Metadaten-Leak) · zwei Sweeps im Fenster ⇒ ein Wake · nach Fensterablauf wieder · **Sweep-Coalescer
ist vom Emitter-Coalescer getrennt** · drei Fail-safe-Fälle · nur `register` löst aus (nicht
`unregister`/`stale`) · Abmelde-Funktion · **Integration gegen die echte `AgentRegistry`**: eine echte
`register()`-Registrierung löst das Wake aus.

## Doku
- `ADR-047` §3: Umsetzungsstand-Tabelle (welche Option je Punkt und **warum**), §4-Tabelle auf „erledigt".
- `TL-11-wake-consumer-contract.md` **§7.3 (neu)**: für den Konsumenten ändert sich **nichts** — gleiche
  Wake-Form, gleiche gerichtete Zustellung, ein Sweep-Wake ist von einem Inbox-Wake nicht unterscheidbar
  und muss es nicht sein; die **Cold-Start-Pflicht bleibt bestehen**, der Daemon-Sweep ergänzt sie nur.

## Abgrenzung
**TL-11 Slice B** (letzter Hop Supervisor → CLI) bleibt out-of-repo/host-gated. Owner-gated bleibt der
**Flag-Flip** in einer laufenden Instanz. WS-Instanz-Bindung und Opt-in-Broadcast bleiben unberührt.

## Eingefaltet: #325-Reconcile
`gh`-verifiziert `mergedAt=2026-07-23T13:43:54Z` / `bd2fe98` — COMPLIANCE-Nummer, CHANGES-Überschrift,
TODO-Eintrag nachgezogen, 1:1 in-place.

## Compliance
- **CO/CG:** entfallen — alle Entscheidungen liegen **innerhalb** der in ADR-047 §3 dokumentierten
  Optionen; keine neue Architektur-Frage. `clink`/`gemini` nicht im PATH.
- **TS ✅:** +13 Tests, Suite **2040 grün** (143 Files), `tsc --noEmit` (strict) 0, neue Dateien
  eslint 0/0, prettier clean. `index.ts` **nicht** ganz-reformatiert (+20/-0).
- **CR:** externes Review am PR mit **`agy`** (direkt aus `~/.local/bin` — s. #325).
- **PC:** Secret-Scan clean.
- **DO ✅:** dieser Eintrag, `ADR-047` §3/§4, `TL-11-wake-consumer-contract.md` §7.3, `TODO.md`,
  `CHANGES.md`, `COMPLIANCE-TABLE.md`.
