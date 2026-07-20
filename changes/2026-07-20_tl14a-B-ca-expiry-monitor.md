# changes/2026-07-20 — feat(cert): CA/Intermediate-Expiry-Monitoring (ADR-045 Vorbedingung B)

**Typ:** Daemon-Feature (additiv). **Kein** Deploy/Secret/Cross-Host, **keine** Änderung an
`verifyPeerCert`/der Trust-/Chain-Semantik.

## Warum
ADR-045 / `TL-14a-blocker-AB-grounding.md` **Blocker B**: der Live-Ablauf-Monitor
(`cert-expiry-monitor.ts`) sah bisher **nur** das Node-Leaf (`getCertDaysLeft` → `tls/node.crt.pem`,
`index.ts`). Eine ablaufende **CA / ein Intermediate** lief lautlos ab → Ausstellungs-Tod. B ist die
Vorbedingung für D3 (lange Intermediate-Laufzeit ohne Alarm = blind). Dies ist die kleinere, additive,
security-neutrale der beiden A/B-Slices (A würde die security-kritische `verifyPeerCert`-Semantik + den
frischen Charakterisierungs-Test #295 umwerfen).

## Was
- **`tls.ts`:** neuer privater Helper `certDaysLeftAtPath(certPath)` (rein: fehlend/unlesbar/unparsebar →
  `null`); `getCertDaysLeft` unverändert (delegiert nun an den Helper, Node-Leaf); **neu**
  `getCaCertDaysLeft(dataDir)` liest `tls/ca.crt.pem`.
- **`cert-expiry-monitor.ts`:** optionales `subject` in `CertExpiryMonitorDeps` (Default `'Node'`) → Log-
  Meldungen (`${subject}-Cert …`) + Audit-Detail (`{ subject, daysLeft, tier, action }`) attributierbar. Der
  Default `'Node'` hält die Log-**Meldungen byte-identisch**; das Audit-Detail-JSON ist eine **additive
  Obermenge** (neues `subject`-Feld) → die bestehenden 21 Monitor-Tests (Substring-Assertions) bleiben grün.
- **`index.ts`:** zweiter `startCertExpiryMonitor` für die CA (`getDaysLeft: getCaCertDaysLeft`, subject
  `'CA'`, gleiche Schwellen/Intervall); Timer `unref()`'d + im Shutdown via `clearInterval` geräumt.
- **`ca-cert-expiry.test.ts` (neu, +6 Tests):** `getCaCertDaysLeft` (Restlaufzeit ~365 d, null-Fälle,
  **getrennte** CA-/Node-Quelle) + `subject`-Label (CA→Audit-Detail `"subject":"CA"`, Default→`"Node"`,
  ok/unknown kein Audit).

## Abgrenzung
Rein **additiv** — `getCertDaysLeft`-Signatur + alle Trust-/Verify-Pfade unverändert. Reissue bleibt
**Start-gebunden** (own-CA, `loadOrCreateTlsBundle`); token-onboarded Nodes / ein künftiges Intermediate
haben weiterhin **keinen** Selbst-Reissue-Pfad (bewusst dokumentiert, eigener Folge-Slice). Kein Deploy/Secret.

## Compliance
- **CO/CG:** entfallen — kein neuer Design-Beschluss (ADR-045 akzeptiert die Vorbedingung), kein generierter
  Boilerplate.
- **TS ✅:** +6 Tests; Full-Suite **1762 grün** (130 Files), `tsc --noEmit` (strict) 0, eslint neue Datei 0.
  (2 pre-existing eslint-Errors in `tls.ts:563`/`index.ts` liegen **außerhalb** der Edit-Regionen und sind
  nicht CI-gated — CI-Check = TypeScript + Tests.)
- **CR:** externer Claude-Review-Subagent vor Merge (prüft: additiv, Node-Pfad byte-identisch, Shutdown-
  Cleanup, kein Trust-Semantik-Leak).
- **PC:** `git diff` gesichtet, Secret-Scan clean (Certs zur Laufzeit geforgt, kein Key-Material).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die vier Quell-/Testdateien.
