# changes/2026-07-24 — feat(tl11): konsumentenseitiger Wake-Kern `interpretWakeFrame` (rein, 0 Aufrufer)

**Typ:** Code+Test-Slice (reiner Kern, **0 Aufrufer**, keine Runtime-Verdrahtung, kein Deploy/Secret/Host,
keine Entscheidung). De-riskt TL-11 Slice B über die bisher **daemon-seitige** Test-Deckung hinaus, ohne den
externen Hop zu bauen.

## Die Lücke
Die daemon-seitige Wake-Erzeugung + -Zustellung (`wake-contract.ts`, `websocket.ts`) ist end-to-end
getestet — inkl. der echten Draht-Kette `inbox:new → Emitter → agent:wake → Loopback-Socket`
(`tl11-wake-wire.conformance.test.ts`). Was der **Out-of-Repo Agent-Home-Supervisor** (Slice B) aus einem
empfangenen Frame macht, stand aber **nur als Pseudocode** in `TL-11-wake-consumer-contract.md` §6.

Dieser Pseudocode mischt zwei Dinge: den **Transport** (WS-Client, mTLS, Reconnect — host-/deploy-gebunden,
zu Recht out-of-repo) und die **Frame-Interpretation** (poke ja/nein, Payload lesen) — die **rein** ist und
keinen Host braucht. Genau dieser reine Teil war ungetestet. Belastbarer Beleg, dass das kein Kosmetik-Punkt
ist: die frühere §6-Fassung las den Grund als `ev.reason`, während die Draht-Wahrheit `ev.data.reason` ist
(Fanout sendet das ganze `MeshEvent`; Befund #282). Diese Fehlklasse hatte **konsumentenseitig keinen Test**.

## Was
Neu `packages/daemon/src/wake-consumer-reference.ts` — der reine, transportfreie Konsumenten-Kern:
- `interpretWakeFrame(raw): WakeDecision` — Frame (JSON-String **oder** Objekt) → `{poke:true, trigger,
  reason, instanceId?, spiffeUri?}` bei `agent:wake`, sonst `{poke:false, ignore, observedType?}`.
  **Wirft nie.** Liest den Payload **ausschließlich unter `.data`** (§4) — ein Top-Level-`reason` wird
  ignoriert; unbekannte `reason` poken **trotzdem** (tolerant, §4); nur `agent:wake` pokt, andere Typen
  werden ignoriert (§3 Event-Typ-Filter); Zero-Content bleibt gewahrt (nur `instance_id`/`spiffe_uri`/
  `reason` werden übernommen, nie Inhalt).
- `coldStartSweepDecision(): WakeDecision` — benennt die §5-Cold-Start-Pflicht als aufrufbaren Trigger.

**Bewusst NICHT hier:** Transport (WS/mTLS/Reconnect) und der `pokeCli`-Body — der out-of-repo/gatete Teil
von Slice B. Der Kern liefert das **Ob**, nicht das **Wie**. Form wie `sweep-targets.ts`: reiner Kern unter
einem weiterhin gateten letzten Hop, **0 Aufrufer** ⇒ kein Runtime-Delta.

Doku: `TL-11-wake-consumer-contract.md` §6.1 (neu) verweist auf den Kern und grenzt ihn ab.

## Tests
`wake-consumer-reference.test.ts` — **20 Tests**: Positivpfad (Objekt + JSON-String), Wire-Shape-Guard
(`{reason:'TOPLEVEL', data:{}}` → reason bleibt Default; fehlendes/Array-`.data`), Toleranz (unbekannter/
leerer `reason`), Zero-Content (kein `message_id`/`body` in der Decision), §3-Event-Typ-Filter
(`inbox:new`/`heartbeat`/`system:*`/type-los), Fail-safe (unparsbar/`null`/`undefined`/Zahl/Array → kein
Wurf). **Mutations-verifiziert:** liest der Kern versuchsweise Top-Level-`reason`, wird der Wire-Shape-Guard
rot (`expected 'TOPLEVEL' to be 'inbox'`). Suite **2065 grün** (144 Files; +20 gegenüber 2045).

## Compliance
- **CO/CG:** entfallen — **keine** neue Design-Entscheidung; alle Werte aus dem bereits gemergten Kontrakt
  (#271/#277) abgeleitet, dokumentiert in Consumer-Contract §6.1. `clink`/`gemini` nicht im PATH.
- **TS ✅:** +20 Tests, mutations-verifiziert, `tsc --noEmit` grün, `eslint` grün, Full Suite **2065 grün**.
- **CR:** manuelles Self-Review (agy/`pal:codereview`-Backend nicht installiert, s.
  `[[pal-review-backend-agy-missing]]`; Subagent-CR in dieser Session nicht verfügbar) — keine
  HIGH/MEDIUM-Findings: fail-safe auf nicht-String-`type`, keine `undefined`-Zuweisung unter strict optional
  types, Zero-Content strukturell über Feld-Auswahl garantiert. Externes `agy`-Review am PR nachzuziehen.
- **PC:** Secret-Scan clean — reiner Interpreter, keine Credentials, keine I/O.
- **DO ✅:** dieser Eintrag, `TL-11-wake-consumer-contract.md` §6.1, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-11 Slice B (Transport + `pokeCli` + Zwei-Peer-Live-Proof, Host-/Deploy-Hop),
der optionale Sweep-Flag-Flip (owner), TL-12/TL-14a/TL-08/TL-10 (Sign-off/CO). Dieser Slice berührt
**keines** davon.
