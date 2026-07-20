# changes/2026-07-20 — test(tls): TL-11 cardServer-mTLS-Wiring-Test (CR-M2-Follow-up)

**Typ:** **test-only**, additive Regressions-Absicherung. **Kein** Produktionscode-Change, **kein**
Christian-/Deploy-/Secret-/Host-Gate, **kein** neuer State. Schließt eine im CR von #283 ausdrücklich
offengelassene Coverage-Lücke (CR-M2).

## Warum
Der cert-fixture-Slice #283 hat die mTLS-Pflicht (`requestCert`/`rejectUnauthorized`) über einen **zweiten**
Fastify-Harness mit demselben Vertrag wie der cardServer geprüft — **nicht** gegen die reale Klasse
`AgentCardServer`. CR-M2 hielt fest: „ein Regress von `requestCert` in `agent-card.ts` wird dort bewusst
NICHT gefangen". Damit hätte ein versehentliches `requestCert: false` / Entfernen der Zeile die mTLS-Pflicht
still aufgeweicht, ohne dass ein Test rot wird — genau die Klasse Fehler, die eine Zero-Trust-Mesh-Grenze
lautlos öffnet.

## Was
- **Neu `packages/daemon/src/agent-card-mtls-wiring.test.ts` (+3 Tests):**
  - Konstruiert den **echten** `AgentCardServer` mit einem In-Memory-TLS-Bundle (`createMeshCA` +
    `createNodeCert` aus `tls.ts`; kein Secret, kein Disk-Persist, **kein Port-Listen**, kein Host-Hop).
  - Liest `requestCert`/`rejectUnauthorized` **direkt vom darunterliegenden Node-`tls.Server`**
    (`server.getServer().server`) ab — die Flags legt `tls.Server` als Instanzfelder aus den `https`-Options
    ab, sind also unmittelbar nach der Konstruktion (ohne Handshake) prüfbar.
  - **(1)** `opts.tls` gesetzt → `requestCert === true` UND `rejectUnauthorized === true` (Beweis
    agent-card.ts:229-230). **(2)** aggregiertes `trustedCaBundle` schwächt die mTLS-Pflicht **nicht** (nur
    `ca`-Trust-Erweiterung). **(3)** Negativkontrolle: ohne `opts.tls` kein aktives `requestCert` → die
    Positivassertion ist nicht trivial „immer true".
- **Mutations-verifiziert:** temporäres `requestCert: false` in `agent-card.ts` → Tests (1)+(2) **rot**,
  Negativkontrolle grün; danach sauber revertiert. Der Guard beißt nachweislich.

## Abgrenzung (bewusst außer Scope)
- **Voller Handshake-/Client-Cert-Pfad** (cert-los-Peer → TLS-Reset) ist bereits in #283 gegen den
  Vertrags-Harness abgedeckt; diese Datei ergänzt die fehlende Bindung an die **reale Klasse** über die
  Options-Ebene (deterministisch, ohne Port/Timing-Flakiness) — keine Duplikation des Handshake-Tests.
- Kein Produktionscode berührt; `agent-card.ts` unverändert.

## Compliance
- **CO/CG:** entfallen — reine Test-Coverage-Ergänzung eines bereits konsentierten, gemergten Vertrags
  (kein Design-/Boilerplate-Delegat; `clink`/`gemini` nicht im PATH).
- **TS ✅:** +3 Tests, **mutations-verifiziert**; Full-Suite **1831 grün** (135 Files), `tsc --noEmit`
  (strict) 0, neue Datei eslint 0 + prettier clean (neu angelegt → formatiert).
- **CR ✅:** code-review-Skill (medium; `agy` fehlt für `pal:codereview`) — keine Findings (test-only,
  reused `createMeshCA`/`createNodeCert`, Harness spiegelt `agent-card.test.ts`).
- **PC ✅:** Secret-Scan clean (Certs werden zur Laufzeit in-memory erzeugt, nichts committed).
- **DO ✅:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md` (CR-M2-Follow-up abgehakt).
