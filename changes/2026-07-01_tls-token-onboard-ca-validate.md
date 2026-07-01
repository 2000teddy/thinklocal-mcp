# 127b — Token-onboarded TLS-Bundle beim Laden gegen `ca.crt.pem` validieren

**Datum:** 2026-07-01
**Branch:** `claude/tls-token-onboard-ca-validate`
**Typ:** Security-Hardening (CR-MEDIUM, pre-existing) · repo-only, ungated
**Bezug:** TODO.md Zeile 127(b) — ADR-022-PeerID-Follow-up (nicht-blockierend); ADR-024 (Canonical-Retention)

## Problem

`loadOrCreateTlsBundle()` (`packages/daemon/src/tls.ts`) hat im **token-onboarded Zweig**
(Node besitzt `ca.crt.pem` + `node.crt.pem`/`node.key.pem` vom Admin, aber **keinen** `ca.key.pem`)
das gelieferte Bundle **ungeprüft** von Disk geladen und zurückgegeben — im Gegensatz zum
Frisch-Generierungs-/Reuse-Pfad, der voll validiert (`signedByCurrentCa`, Zeitfenster,
Cert↔Key-Match).

Folge: Ein beschädigtes, abgelaufenes, fremd-signiertes oder mit einem falschen Key gepaartes
Bundle wurde als gültig serviert. Peers lehnen ein solches Cert in der mTLS-Handshake ohnehin ab
→ **stiller Mesh-Ausfall** mit schwer diagnostizierbaren Symptomen. Ein token-onboarded Node kann
sein Cert mangels CA-Key **nicht selbst neu ausstellen**, deshalb ist Weiterreichen die schlechteste
Option.

## Fix

Die gelieferte `ca.crt.pem` **ist** der Trust-Anchor eines token-onboarded Nodes (er hat keinen
eigenen CA-Key). Analog zum **Frisch-Gen-Primärpfad** wird das Bundle beim Laden **fail-closed**
validiert (wiederverwendet die vorhandenen, getesteten Helfer):

1. **`verifyPeerCert(caCertPem, certPem)`** — `node.crt` ist von genau dieser CA signiert **und**
   Leaf **und** ausstellende CA sind zeitlich gültig (ADR-024 MEDIUM-1 fail-closed).
2. **Cert↔Key-Konsistenz** (`certKeyMatches`) — schützt gegen gemischte `node.crt`/`node.key`-Stände.

Nur wenn `certKeyMatches && signedByShippedCa` → Bundle übernehmen. Sonst **`throw`** mit klarer
Operator-Meldung ("bitte per Admin-Token neu onboarden"), statt ein ungültiges Cert durchzureichen.
Kein neuer Datei-Write, keine Verhaltensänderung für gültige Bundles.

**Kanonische Nodes (ADR-024):** Ein von einer Attesting-CA (z. B. `.94`) signiertes kanonisches
`node/<PeerID>`-Cert wird korrekt token-onboarded, indem der Admin **ebendiese Attesting-CA als
`ca.crt.pem` mitliefert** → Bedingung (1) greift, und der zurückgegebene Anchor verifiziert das Cert
(damit `index.ts` den Issuer auflösen und kanonisch flippen kann). Der own-CA-Fall (lokale CA ≠
Issuer) besitzt per Definition einen `ca.key` und erreicht diesen Zweig nie. Eine `ca.crt.pem`, die
das gelieferte `node.crt` nicht verifiziert, ist ein **inkonsistentes Bundle** und wird fail-closed
abgewiesen — kein still gemischter Anchor.

### Review-Verlauf (CR)

Erste Fassung akzeptierte zusätzlich einen `isRetainableCanonicalCert`-Fallback. Der Claude-Security-Review
fand dabei ein **MEDIUM**: auf `retainableCanonical && !signedByShippedCa` wurde ein `caCertPem`
zurückgegeben, das das Cert nicht verifiziert (→ `index.ts` kann bei peer-losem Erstboot den Issuer
nicht auflösen). Auflösung: Fallback **entfernt** — er beschrieb einen widersprüchlichen Zustand ohne
realen Onboarding-Weg. Re-Review: MEDIUM aufgelöst, kein Live-Node bricht, keine neuen HIGH/MEDIUM.

## Tests

Neuer `describe`-Block in `packages/daemon/src/tls.test.ts` (bisher war der token-onboarded Zweig
**komplett ungetestet**):

- gültiges Bundle (node.crt von gelieferter CA signiert) → **unverändert** übernommen (+ Anchor verifiziert Cert)
- `node.crt` **nicht** von gelieferter CA signiert → **fail-closed throw**
- Cert↔Key-Mismatch → **fail-closed throw**
- **abgelaufene** gelieferte CA → **fail-closed throw** (nicht still servieren)
- kanonisches Token-Onboard (Admin liefert Attesting-CA als `ca.crt.pem`) → **behalten**, CANON-SAN erhalten, `verifyPeerCert(caCertPem,certPem)===true`
- inkonsistent (`ca.crt.pem` verifiziert das kanonische `node.crt` nicht) → **fail-closed throw**

**Ergebnis:** `tls.test.ts` 38/38 grün · volle Daemon-Suite **104 Files / 1287 Tests grün** · `tsc --noEmit` sauber.
Lint: keine **neuen** Findings (Repo hat großen pre-existing Lint-Baseline, kein Merge-Gate).

## Compliance (KW27-Haus-Workflow)

| CO | CG | TS | CR | PC | DO |
|----|----|----|----|----|----|
| n/a (Bug/Hardening, kein Architektur-Neuentwurf) | n/a | ✅ 5 Regressionstests + volle Suite grün | ✅ Claude-Security-Review | ✅ manuell (tsc/test/diff) | ✅ dieser Eintrag |

Kein Deploy, kein systemd, kein Live-Gerät, kein Christian-Gate.
