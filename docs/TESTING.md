# Testing — thinklocal-mcp

**Status:** Normative (ab 2026-04-08)
**Compliance-Spalte:** TS in `COMPLIANCE-TABLE.md`

## Warum dieses Dokument existiert

Tests wurden im Projekt bisher als "selbstverstaendlicher Bestandteil von Code" behandelt. Es gab zwar eine wachsende Test-Suite (Stand 2026-04-08: 243/243 Tests im daemon), aber keine explizite Regel, kein Gate, keine Spalte in der Compliance-Tabelle. Tests lebten von Gewohnheit.

**Das ist bei LLM-Agenten ein Anti-Pattern.** Agenten "vergessen" was nicht explizit als Pflicht dokumentiert ist — dieselbe Dynamik die bei den `pal:codereview`-Aussetzern am 2026-04-07/08 zu 5+ Stunden Re-Work gefuehrt hat, wuerde auch bei Tests passieren. Sobald ein Agent unter Zeitdruck "erst mal Code, Tests spaeter" denkt, faellt das Pattern in sich zusammen.

Christians Einwand am 2026-04-08 21:40 macht es explizit: *"wir nehmen das Testen fuer selbstverstaendlich — es ist jedoch ein sehr wichtiger Bestandteil des Workflows, welcher integriert und dokumentiert gehoert."*

Dieses Dokument macht die Erwartungen normativ.

## Minimalanforderungen pro PR

Jeder Code-PR muss **alle** drei Arten liefern, ausser explizit abweichend im PR-Body begruendet:

### 1. Unit-Tests (Vitest)

- **Wo:** `packages/daemon/src/<modul>.test.ts` direkt neben der Implementierung
- **Wann:** parallel zum Code, **nicht** nachgelagert
- **Was:**
  - Jede exportierte Funktion hat mindestens einen Happy-Path-Test
  - Jede Edge-Case-Bedingung die im Code als `if` auftaucht hat einen Test
  - Jeder `throw`/`return reply.code(4xx)` Pfad hat einen Test
  - Mocks nur wo unvermeidlich (I/O, Netzwerk, Zeit)
- **Wie gross:** kein formales Coverage-Minimum, aber Daumenregel:
  - **Kritische Pfade** (Auth, Crypto, Trust, Vault, Inbox, Sandbox): **100%**
  - **Standard-Module:** ≥80%
  - **Helper/Utils:** ≥60% reicht, aber dann Integration-Tests
- **Tool:** Vitest mit `npx vitest run` fuer CI, `npx vitest` fuer Watch

### 2. Integration-Tests

- **Wo:** `tests/integration/*.test.ts`
- **Wann:** wenn ein PR einen End-to-End-Flow beruehrt (z.B. Agent-Card → Peer → Message → ACK)
- **Was:**
  - Zwei-Node-Szenarien ueber echte HTTPS/mTLS
  - Ephemere tmp-Dirs fuer Daemon-State
  - Cleanup nach jedem Test
- **Beispiel:** `tests/integration/two-nodes.test.ts`

### 3. Regression-Tests (Pflicht bei Bug-Fixes)

- **Wo:** im existierenden `*.test.ts` des betroffenen Moduls
- **Wann:** jeder HIGH/CRITICAL-Finding aus einem `pal:codereview` oder Live-Bug
- **Was:**
  - **Erst den Test schreiben der den Bug reproduziert** (und failed)
  - **Dann den Fix schreiben** (Test wird gruen)
  - Commit message: `fix: <bug> (+ regression test)`
- **Warum:** Garantiert dass der Bug nicht wieder auftaucht. Historisches Beispiel: der CA-Subject-Collision-Bug (PR #77) haette einen Regression-Test verdient, der "zwei Nodes mit gleichen CA-Subject-DNs verursacht signature failure" abdeckt.

### 4. Live-Tests (manuell, dokumentiert)

- **Wo:** im PR-Body unter "Test plan"
- **Wann:** wenn der PR Netzwerk-Verhalten, Peer-Pairing, Cron-Heartbeat oder andere Laufzeit-Interaktionen veraendert
- **Was:** konkrete Kommandos + erwartetes Ergebnis
- **Format:**
  ```
  - [x] Daemon restart: curl health check liefert 200
  - [x] Peer discovery: 3 peers sichtbar nach 5s
  - [ ] Pending: SSH-Pair mit 10.10.10.99 (haben wir nicht in dieser Session)
  ```

## Testing-Patterns

### Pattern A: Ephemere Daten-Verzeichnisse

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MyModule', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'thinklocal-mymodule-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should ...', () => {
    const thing = new MyModule(tmpDir);
    // test ...
  });
});
```

**Warum:** Keine Kreuz-Kontamination zwischen Tests, keine Abhaengigkeit von `~/.thinklocal`, CI-safe.

### Pattern B: Echte Certs in Tests

Seit PR #83 mussten die Trust-Store-Tests auf echte CAs umgestellt werden (statt FAKE-Strings), weil die X509Certificate-Validation fehlschlug. Das ist **richtig so**:

```typescript
import { createMeshCA } from './tls.js';

let FAKE_OWN_CA: string;

beforeAll(() => {
  FAKE_OWN_CA = createMeshCA('thinklocal', 'testownca00000000').caCertPem;
});
```

**Nicht:**
```typescript
const FAKE_OWN_CA = `-----BEGIN CERTIFICATE-----\nnotavalidcert\n-----END CERTIFICATE-----`;
```

Tests die crypto-validierte Daten brauchen muessen sie auch generieren.

### Pattern C: Zeit-abhaengige Tests

Bei Deadlines, Timeouts, Heartbeats:
- Unit-Test: `vi.useFakeTimers()` und `vi.advanceTimersByTime(5000)`
- Integration-Test: `setTimeout(() => {...}, 100)` mit Promise-Wrap, aber sparsam

### Pattern D: Sender/Receiver-Paare fuer Mesh-Tests

```typescript
describe('two-node message exchange', () => {
  let daemonA: AgentCardServer;
  let daemonB: AgentCardServer;

  beforeAll(async () => {
    daemonA = await startDaemon({ tmpDir: 'A' });
    daemonB = await startDaemon({ tmpDir: 'B' });
    await pairPeers(daemonA, daemonB);
  });

  afterAll(async () => {
    await daemonA.stop();
    await daemonB.stop();
  });

  // tests ...
});
```

### Pattern E: Regression-Tests aus CR-Findings

Wenn `pal:codereview` einen HIGH-Finding meldet wie "Path-Traversal via isPathAllowed", schreibe:

```typescript
it('blockiert Verzeichnisse mit gleichem Prefix ausserhalb (PR #XX regression)', () => {
  // This was a HIGH finding in codereview round YYYY-MM-DD.
  // Previous implementation used startsWith() which let /skills-evil/ slip through.
  expect(isPathAllowed('/home/user/skills-evil/index.js', '/home/user/skills')).toBe(false);
});
```

Der Kommentar verweist auf den Bug-Kontext. Wenn in 6 Monaten jemand das wieder "vereinfacht", sagt ihm der Test warum das eine schlechte Idee ist.

## Was NICHT getestet werden muss

- **UI-Pixelkram** im Dashboard (visuelle Regressions sind manuell)
- **Third-Party-Libraries** (vitest, better-sqlite3, undici haben eigene Tests)
- **Type-Definitionen** (tsc --noEmit ist der Test)
- **Pure Dokumentation** (`.md`-Dateien — aber Code-Beispiele in Dokus dann doch, siehe "runnable docs")

## Wie der Cron-Heartbeat Tests prueft (ab Phase 1 von ADR-004)

Der `compliance-heartbeat` Cron-Job (alle 5 Minuten) laeuft:

```bash
cd $(git rev-parse --show-toplevel)/packages/daemon
npx vitest run 2>&1 | tail -5
```

Wenn die letzte Zeile nicht "passed" zeigt, schreibt der Cron eine Loopback-Nachricht in die eigene Inbox:

> Subject: "Tests sind rot auf branch <current-branch>"
> Body: "X failed / Y passed. Fix bevor der naechste Commit kommt."

Das ist die ehrliche Version des Sprichworts "Tests sind Pflicht, nicht Option": der Scheduler prueft es fuer mich und zeigt mir den Zustand.

## Historische Notiz

Die Compliance-Rate fuer Tests war bis 2026-04-08 **implizit ~94%** — die meisten PRs hatten Tests, aber ohne explizite Spalte in der Tabelle war nicht sichtbar welche keine hatten. Die Batch-Review von PR #83 hat retro-spektiv bemerkt dass z.B. ssh-bootstrap-trust.sh (PR #78) keinen einzigen Unit-Test hat, weil es ein Bash-Script ist und "wir Bash nicht testen". Das war bequem, nicht richtig. Bash-Scripts lassen sich mit `bats` oder `shellcheck` testen. PR #85+ wird das nachholen.

## Normative Formulierung

> Ein PR gilt als **fertig** wenn:
> - die volle Test-Suite gruen ist (`npx vitest run` im daemon-Paket)
> - neue Funktionen haben Unit-Tests
> - gefixte Bugs haben Regression-Tests
> - neue Endpoints haben Integration-Tests
> - Live-Tests sind im PR-Body dokumentiert
>
> Ein PR der diese Kriterien nicht erfuellt darf **nicht** als ✅ in der TS-Spalte der COMPLIANCE-TABLE.md eingetragen werden und darf **nicht** gemerged werden, auch nicht mit --admin.

## Verwandte Dokumente

- `COMPLIANCE-TABLE.md` — die Spalte **TS** und die Regel-Reihenfolge
- `CLAUDE.md` — UNVERHANDELBARE REIHENFOLGE Schritt 5 (TS)
- `docs/architecture/ADR-004-cron-heartbeat.md` — automatisches Test-Gate im Cron
- `CONTRIBUTING.md` — allgemeine PR-Guidelines
