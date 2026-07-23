# changes/2026-07-23 — test(tl11): Emitter-Ende-zu-Ende-Conformance (`inbox:new` → echter Socket)

**Typ:** **test-only**, additiv. Kein Produktionscode — `wake-contract.ts`, `websocket.ts` und `index.ts`
sind **unangetastet**. Kein Deploy, kein Secret, kein Host-Hop, kein Gate. De-riskt TL-11 Slice B weiter,
**entfernt den externen Blocker aber nicht**.

## Die Lücke (warum genau dieser Slice)
Der Wake-Kontrakt hat zwei Schichten:

1. **Emitter** — `registerWakeEmitter` (`wake-contract.ts`): `inbox:new` → Auflösung (`resolveWakeTargets`)
   → Coalescing (`WakeCoalescer`) → Fail-closed-SPIFFE → `agent:wake`.
2. **Routing** — `websocket.ts`: gerichtete Zustellung an den passenden `agentFilter`-Client.

Schicht 1 war **ausschließlich** gegen reine Funktionen getestet (`wake-contract.test.ts`). Schicht 2 ist
seit #282/#283 auf dem echten Socket bewacht — aber **alle** diese Draht-Tests injizieren `agent:wake`
**direkt auf den Bus**. Damit blieb genau die **Naht** zwischen beiden ungefangen: würde der Emitter den
Coalescer umgehen, ein Wake an eine nicht-live Instanz emittieren oder die SPIFFE-Fail-closed-Regel
verlieren, blieben **alle** Pure-Function- **und alle** Draht-Tests grün — während der Supervisor aus
TL-11 Slice B, der genau auf diese §5-Zusagen baut, zu oft, zu selten oder gar nicht geweckt würde.

## Was
`tl11-wake-wire.conformance.test.ts` bekommt einen zweiten `describe`-Block, der den **echten Emitter** wie
in `index.ts:1108` auf den Harness-Bus verdrahtet und dann die **volle Kette** fährt:
`inbox:new` → Emitter → `agent:wake` → realer Loopback-`/ws`-Socket.

Uhr (`now`) und Live-Liste (`listInstances`) sind injiziert ⇒ deterministisch: **kein `sleep`, keine
Fake-Timer**. Negativfälle nutzen den vorhandenen **Same-Socket-Barrier** (`collectUntilBarrier`) — ein
Wake, das je an diesen Socket gegangen wäre, ist vor der `system:subscribed`-Antwort da.

**+8 Tests:**
- §4/§5 adressiert + live + SPIFFE ⇒ genau **1** Wake; **inhaltsfrei** (Payload-Keys exakt
  `instance_id`/`reason`/`spiffe_uri`, und die `message_id` taucht im ganzen Frame **nicht** auf).
- §5 **coalesced**: zwei rasche `inbox:new` im selben Fenster ⇒ genau **1** Frame.
- §5 das Fenster **läuft ab**: nach Ablauf weckt die nächste Nachricht wieder ⇒ **2** Frames (belegt, dass
  Coalescing ein Fenster ist und keine dauerhafte Unterdrückung).
- §3/§5 fail-closed: live Instanz **ohne** SPIFFE ⇒ **0** Frames (nicht routbar) — der Client filtert dabei
  auf die `instance_id`, bekäme also eines, wenn eines emittiert würde.
- §5 fail-closed: Ziel **nicht live** ⇒ **0** Frames.
- §5 **kein Broadcast**: unadressierte Nachricht weckt weder den gefilterten **noch** den ungefilterten
  Client.
- §5 leeres `to_agent_instance` zählt als unadressiert ⇒ **0** Frames.
- §3 directed: das **emittierte** Wake erreicht nur den passenden Client, nicht den Nachbarn.

**Mutations-verifiziert** (die Tests beißen wirklich, jeweils nach dem Lauf zurückgesetzt):

| Mutation in `wake-contract.ts` | Ergebnis |
|---|---|
| Coalescer in `computeWakes` umgangen | „zwei rasche `inbox:new` → 1 Wake" **rot** |
| SPIFFE-Fail-closed-Guard entfernt | „live Instanz OHNE SPIFFE" **rot** |
| Liveness-Filter in `resolveWakeTargets` **+** WARN-Guard entfernt | „Ziel nicht live" **rot** |
| **nur** der WARN-Guard entfernt | bleibt grün — die Liveness ist **doppelt** bewacht; der Test pinnt das **Verhalten**, nicht eine bestimmte Codezeile (ehrlich vermerkt) |

**Doku:** Consumer-Contract §7.2 (neue Ende-zu-Ende-Tabelle + Mutations-Notiz). Zusätzlich eine echte
Drift korrigiert: §7.1 führte die mTLS-Pflicht und den Nicht-Loopback-`4003`-Reject weiter als
„`it.todo`, bleibt unit-bewacht, bis die Fixtures stehen" — **#283 hat beide längst zu echten Tests
gemacht**.

## Abgrenzung (unverändert)
**TL-11 Slice B bleibt extern-blocked:** der letzte Hop (Supervisor → CLI) ist out-of-repo und
Deploy-/Host-/Fenster-gated. Dieser Slice baut ihn **nicht** und schwächt keine Invariante — er hält nur
den Kontrakt fest, gegen den er gebaut wird. Ebenfalls unberührt: WS-Instanz-Bindung und Opt-in-Broadcast
(beide würden einen **positiven Beschluss** brauchen — eine Verschärfung der heutigen strikt-loopback-only-
Filterregel bzw. eine Aufweichung des Kein-Broadcast-Vertrags).

## Compliance
- **CO/CG:** entfallen — test-only, kein Design-Diff, kein neuer Beschluss (alle Zusagen stammen aus
  gemergtem Code #271/#277 und der bestehenden Consumer-Spec). `clink`/`gemini` nicht im PATH.
- **TS ✅:** +8 Tests, Suite **1979 grün** (140 Files), `tsc --noEmit` (strict) 0, geänderte Datei eslint
  0/0, prettier clean. Zusätzlich **Mutations-Verifikation** (s.o.) statt bloßer Grün-Meldung.
- **CR:** externes Review am PR (`agy`/`codex` nicht im PATH → adversariales Claude-Subagent,
  `[[pal-review-backend-agy-missing]]`).
- **PC:** Secret-Scan clean — keine Credentials, keine echten Hosts/IPs (Fixture-SPIFFE + `127.0.0.1`).
- **DO ✅:** dieser Eintrag, `TL-11-wake-consumer-contract.md` §7.1/§7.2, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`, `TODO.md`.
