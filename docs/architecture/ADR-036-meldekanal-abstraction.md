# ADR-036 — Meldekanal-Abstraktion + Fail-safe Deny-Default (TL-09, Slice A)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-09 (P0-parallel, Sicherheits-Pflicht / Beta-Blocker) — „Meldekanal-Abstraktion (Entscheidung 10): Schnittstelle `Meldekanal` + Telegram-Adapter + **Fail-safe: kein erreichbarer Kanal = schreibender Aufruf bleibt verweigert**."
**Gate:** Architektur-Gate 2 (ENTSCHEIDUNGEN.md 02.07.), Design-Vorgabe 10.
**Verwandt:** ADR-033 (Tier-Enforcement am Hub-Ingress — nennt Design-Vorgabe 10 ausdrücklich als offenes Folge-Design), TL-10 (Freigabe-Matrix, folgt), `telegram-gateway.ts`, `approvals.ts`.
**CO:** `pal:consensus` 2026-07-15, Modelle `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — Konsens: Zerlegung annehmen, drei Interface-Nachschärfungen (siehe unten). Beleg: `~/hermes/reports/2026-07-15_1004_TL09-consensus.md`.

## Problem

Der Hub-Ingress verweigert seit ADR-033 jeden `gate`/`consensus`-Aufruf **hart mit 403**, weil „kein
Meldekanal existiert". Das ist die sichere Untergrenze, macht aber **jeden** schreibenden Remote-Aufruf
dauerhaft unmöglich — es gibt keinen Weg, eine Freigabe **einzuholen**. Design-Vorgabe 10 verlangt einen
**austauschbaren** Meldekanal (Telegram/Cockpit/CLI/…), über den ein schreibender Aufruf angehalten und
einem Betreiber zur Entscheidung vorgelegt wird — mit der **eisernen Regel**: ist kein Kanal erreichbar,
bleibt der Aufruf verweigert (Kapitel 7.4). Niemals durchwinken.

## Entscheidung

**Slice A (dieser ADR, dieser PR): die reine Abstraktion + Fail-safe-Registry. KEIN Ingress-Wiring.**

`mcp-ingress.ts` bleibt in diesem Slice **unverändert** (hartes 403). Grund (CO, beide Modelle
einstimmig): der heutige Zustand ist der sicherste, den das System je hatte — jede Ingress-Änderung kann
ihn nur verschlechtern. Ein Slice, der die Datei nicht anfasst, hat ein **beweisbares Risiko-Delta von
null** und tangiert den TL-07-Zwei-Peer-Beweis (self-Tier) nicht. Das Ingress-Wiring (hartes 403 →
`registry.requestApproval(...)`, hinter Env-Flag mit Default = heutiges Verhalten) ist **Slice B**
(TL-09b) und wird in TODO.md als Folge-Ticket geführt, damit `meldekanal.ts` nicht — wie `approvals.ts`
zuvor — als unaufgerufener toter Code liegen bleibt.

### Schnittstelle (`packages/daemon/src/meldekanal.ts`)

```ts
type ApprovalOutcome = 'approved' | 'rejected' | 'denied-no-channel' | 'timeout' | 'error';

interface Meldekanal {
  readonly id: string;
  isHealthy(signal: AbortSignal): Promise<boolean>;
  requestApproval(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}

function isApproved(d: ApprovalDecision): boolean;   // EINZIGER erlaubter Auswertungspfad
```

**`MeldekanalRegistry`** hält N Kanäle und implementiert `requestApproval(req)`:
1. Iteriert die Kanäle; nimmt den **ersten** `isHealthy()`-Kanal. Der Health-Check ist selbst
   timeout-umhüllt; wirft er oder läuft in den Timeout ⇒ Kanal gilt als **unhealthy**, weiter zum
   nächsten (ein kaputter Kanal blockiert keinen gesunden dahinter).
2. Der **erste gesunde Kanal ist terminal**: seine Entscheidung (`approved`/`rejected`/`timeout`/`error`)
   wird zurückgegeben — es wird **nicht** ein zweiter Kanal gefragt (sonst „frage so lange, bis einer Ja
   sagt" = Rechte-Eskalation).
3. Ist **kein** Kanal gesund (inkl. leerer Liste) ⇒ `{ outcome: 'denied-no-channel' }`.

**`DenyAllChannel`** (`isHealthy()===false`) ist der eingebaute Default: eine leer konstruierte Registry
injiziert ihn, sodass der Default-Pfad **beweisbar** `denied-no-channel` liefert.

### Konsens-Nachschärfungen (CO 2026-07-15, in dieser Entscheidung verankert)

- **B1 `isHealthy` ist async** (`Promise<boolean>`) — Kanal-Liveness (z.B. Telegram-Bot-API) ist ein
  Netzwerk-Fakt, kein Feldwert. Timeout-umhüllt; Fehler/Timeout ⇒ unhealthy.
- **B2 Deny-Default in der Registry** (ein einziger Audit-Punkt). Der spätere Ingress (Slice B) wertet
  **per Allowlist** aus: **nur `outcome === 'approved'` erlaubt**, alles andere — inkl. künftig neuer
  Enum-Werte — verweigert. Auswertung ausschließlich über `isApproved()`; nie `!== 'rejected'`. Slice B
  MUSS ein exhaustives `switch` mit `never`-Default nutzen (neuer Enum-Wert ohne Mapping = Compile-Fehler,
  kein stilles Allow).
- **B3 Enum statt Boolean** — `rejected` (Mensch sagt Nein) und `denied-no-channel` (niemand gefragt)
  sind verschiedene Betriebsvorfälle und müssen im Audit unterscheidbar bleiben.
- **C1 `AbortSignal` in der Signatur** — die Registry bricht bei Timeout ab; der Kanal MUSS bei `abort`
  seine Pending-Anfrage invalidieren. Das Timeout-Ergebnis ist **terminal**; eine späte Resolution des
  abgebrochenen Aufrufs wird verworfen (nie nachträglich als Entscheidung konsumiert).
- **C2 Shape-Normalisierung** — der Kanal-Rückgabewert wird `await`-et und geprüft; unbekanntes Shape
  (undefined/Non-Objekt/unbekanntes `outcome`) ⇒ `error`, nie versehentlich `approved`.

## Bewusste Grenze (Naht, Folge-Slices)

- **Kein Ingress-Wiring** (Slice B / TL-09b). `meldekanal.ts` ist bis dahin **bewusst ohne Aufrufer** —
  das ist kein toter Code, sondern die geprüfte Abstraktion vor ihrer Verdrahtung.
- **Kein Telegram-Adapter** in Slice A. Slice A liefert nur `interface` + Registry + `DenyAllChannel`.
  Der reale `TelegramMeldekanal` (Inline-Keyboard-Callback → `approvals.ts`-Store) ist Slice B-nah.
- **Kein Audit-Logging** der Entscheidungen in Slice A (kein echter Call-Kontext) — gehört an Slice B.
- **Freigabe-Matrix** (Werkzeug-Klasse → Kanal → Entscheider) = **TL-10**, schiebt sich später sauber
  zwischen Ingress und Registry.

## Konsequenzen

- **+** Die Fail-safe-Regel „kein Kanal ⇒ verweigert" ist ab jetzt **strukturell** in einer testbaren,
  wiederverwendbaren Einheit verankert (bisher als hartkodiertes 403 im Ingress verstreut).
- **+** Kein Deploy, kein Secret, kein Infra-Eingriff, keine Netz-I/O; rein unit-testbar.
- **0** Ingress-Verhalten unverändert → TL-07-Beweis und Produktions-Denials unberührt.
- **−** Bis Slice B bleibt ein schreibender MCP hart verweigert (403), nicht gequeued. Beabsichtigt.
