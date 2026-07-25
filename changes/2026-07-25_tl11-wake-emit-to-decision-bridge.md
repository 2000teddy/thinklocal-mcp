# changes/2026-07-25 — test(tl11): Emit→Decision-Brücke (echter Emitter → Draht-Bytes → `interpretWakeFrame`)

**Typ:** **Test-only**. Keine Produktionsdatei berührt, keine Entscheidung, kein Deploy/Secret/Host. De-riskt
den letzten Hop (Supervisor → CLI) weiter, ohne den Slice-B-Blocker zu entfernen.

## Die Lücke
Es gab drei TL-11-Wake-Test-Ebenen — aber keine verband die **beiden Enden**:
1. `wake-contract.test.ts` — Emitter (reine Funktionen).
2. `tl11-wake-wire.conformance.test.ts` — Emitter über einen **echten `/ws`-Socket** (Draht-Shape).
3. `wake-consumer-reference.test.ts` (#331) — der Kern `interpretWakeFrame` gegen **hand-gebaute** Frames.

Niemand bewies: entscheidet der Kern korrekt über den Frame, den der Daemon **tatsächlich emittiert und
serialisiert**? Ein Drift **genau dazwischen** — Emitter legt den Payload flach statt unter `.data`, die
`MeshEventBus`-Hülle ändert sich, ein Inhaltsfeld leckt — wäre in allen drei Ebenen grün geblieben, während
der Out-of-Repo-Supervisor (Slice B) falsch/gar nicht entscheidet.

## Was
Neu `packages/daemon/src/tl11-wake-emit-to-decision.test.ts` (+6 Tests) — fährt **socket-frei** die volle
Kette: `inbox:new` → echter `registerWakeEmitter` → echter `MeshEventBus` (`{type,timestamp,data}`-Hülle) →
**dieselbe Serialisierung wie der Draht** (`websocket.ts:266` `JSON.stringify(event)` aus dem `onAny`-Kanal,
`websocket.ts:265`) → `interpretWakeFrame`. Uhr + Live-Liste injiziert (deterministisch, kein `sleep`).

Deckt: adressiert+live+SPIFFE → genau 1 Draht-Frame poket den Konsumenten korrekt (instance_id/spiffe_uri/
reason aus `.data`) · `{type,timestamp,data}`-Hülle mit Payload unter `.data` (Weld-Anker) · **Zero-Content**
durch die ganze Kette (weder `message_id` noch `body` reisen mit — auf dem Draht **und** in der Decision) ·
**coalesced** (2 rasche `inbox:new` → 1 Frame → 1 Poke) · fail-closed ohne SPIFFE / Ziel nicht live → 0 Frames.

**Abgrenzung:** der Transport (Socket, mTLS, Loopback-Gate, gerichtetes Routing) ist NICHT Gegenstand — den
deckt `tl11-wake-wire.conformance.test.ts`. Hier geht es allein um die Konsistenz **Emit-Bytes ↔
Konsumenten-Entscheidung**.

## Tests
`npx vitest run` grün. **Mutations-verifiziert:** liest `interpretWakeFrame` versuchsweise den Payload flach
(Top-Level statt `.data`), wird der Weld-Test „adressiert+live+SPIFFE → poket korrekt" rot (instance_id/
spiffe_uri kommen dann `undefined` aus den echten Bytes). `tsc --noEmit` grün, `eslint` grün. Full Suite
**2071 grün** (145 Files; +6 ggü. 2065).

## Compliance
- **CO/CG:** entfallen — keine Design-Entscheidung; Test-only gegen bereits gemergten Code (#271/#277/#331).
- **TS ✅:** +6 Tests, mutations-verifiziert, Suite 2071 grün.
- **CR:** Self-Review — Test fährt echte Produktionspfade (Emitter + Bus + Draht-Serialisierung), keine
  Tautologie (Mutation beißt); externes `agy`-Review am PR nachzuziehen.
- **PC:** Secret-Scan clean (Test-Konstanten, keine echten Keys — `body: 'top-secret-payload'` ist ein
  Negativ-Marker, der beweist, dass **nichts** mitreist).
- **DO ✅:** dieser Eintrag, Consumer-Contract §6.1, `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-11 Slice B (Transport + `pokeCli` + Zwei-Peer-Live-Proof), ADR-046 §9, msg 1453,
TL-12-Gates — **nicht** berührt.
