# changes/2026-07-12 — feat(discovery): ADR-035 A4b identitäts-gebundener Inbound-Fallback (TL-28b)

**Typ:** Daemon-Code (`pinned-card-fetch.ts` neu, `inbound-peer-learner.ts`, `index.ts`) + Tests.
**Slice:** ADR-035 A4b / TODO TL-28b. Reaktiviert den in #258 (Codex CHANGES-NEEDED) verschobenen
`remoteAddress`-Fallback — jetzt **identitäts-gebunden**.
**Gate:** keins — das frühere „gated" (brauchte D2b default-on) ist durch das A2-Per-Dial-Pinning
aufgehoben.

## Warum
Der ADR-026-Inbound-Learner bricht bei leerer TLS-`remoteAddress` (Cross-Subnet/NAT — keine
Source-IP) fail-closed ab → betroffene Peers bleiben unauflösbar. In #258 wurde der naive Fallback
verworfen, weil er über einen **ungepinnten** Fetch von einer Discovery-Adresse eine fremde
Identität attestieren konnte (self-asserted Card-`publicKey` → `authenticatedSeen`; A4b-Klasse).

## Lösung (identitäts-gebunden)
A2 hat das Muster geliefert: ein **per-Dial hart auf `expectedSpiffeUri` gepinnter** mTLS-Fetch
(volle CA-Chain + SPIFFE-SAN-Match, unabhängig vom global-aus D2b-Flag). A4b reaktiviert den
Fallback, aber die Fallback-Adresse (unauthentifiziert) wird **ausschließlich** über diesen
gepinnten Fetch kontaktiert → eine falsche/vergiftete Adresse kann keine fremde Identität
attestieren (Handshake bricht ab). Der **Source-IP-Pfad bleibt unverändert** (die Source-IP IST der
authentifizierte Peer → kein Pin nötig).

## Was
- **`pinned-card-fetch.ts` (neu):** `fetchAgentCardPinned(endpoint, expectedSpiffeUri, deps)` — die
  aus A2 **extrahierte, geteilte** Pin-Implementierung (dedizierter Dial, `spiffeServerIdentity:true`
  + `makeMeshCheckServerIdentity(()=>expectedSpiffeUri)`, byte-begrenzter Body, Agent im `finally`
  geschlossen). **Eine** reviewte Pin-Naht für A2 + A4b.
- **`index.ts`:** A2-Boot-Re-Learn auf `fetchAgentCardPinned` umverdrahtet (Inline-Duplikat
  entfernt, verhaltensgleich). Learner-Callsite: `resolveFallbackAddress` (= `mesh.getPeer(canon)?.host`)
  + `fetchCardPinned` (nur mit TLS-Bundle; sonst undefiniert → Fallback aus).
- **`inbound-peer-learner.ts`:** neue optionale Deps `resolveFallbackAddress` + `fetchCardPinned`.
  Leere `remoteAddress` → Fallback-Adresse **nur** via `fetchCardPinned`; fehlt Adresse ODER Dep →
  fail-closed. Rückwärtskompatibel (Deps fehlen → heutiges Verhalten).

## Tests / Verifikation
- `inbound-peer-learner.test.ts` **+7**: Fallback → **GEPINNTER** Fetch gegen Fallback-Adresse mit
  `expectedSpiffeUri` als Pin-Ziel (recorded); **SECURITY: Fallback ohne gepinnte Dep → fail-closed**
  (kein ungepinnter Fetch); Fallback undefined → fail-failed; **SECURITY: Fremd-Identitäts-Card →
  rejected-identity**; Source-IP-Pfad nutzt `fetchCard` (NICHT `fetchCardPinned`); Retry-Recovery;
  **CR-LOW-1: Fallback-Adresse außerhalb Subnetz → fail-closed**.
- `pinned-card-fetch.test.ts` **+5** (Codex-Review #261, MEDIUM — direkter Adapter-Seam-Regressionstest):
  spiegelt `buildMeshConnector` und prüft die von `fetchAgentCardPinned` übergebenen Connector-Args —
  (1) `spiffeServerIdentity` wird ERZWUNGEN, auch bei global-AUS Policy (D2b-unabhängig); (2) der
  installierte `checkServerIdentity` (REALER `verifyMeshServerIdentity`) akzeptiert nur den exakten
  `expectedSpiffeUri`-SAN und verwirft fremden/fehlenden SAN + poisoned-host. Damit ist die
  Transport-Identitäts-Bindung des Seams direkt regressions-geschützt (nicht nur via gemocktem
  `fetchCardPinned`).
- **1566 gesamt grün** (`npm test`), `tsc --noEmit` sauber, keine neuen ESLint-Errors.
- CR: claude-Subagent (adversarial, „Fallback-nur-gepinnt"-Fokus) — **APPROVE, kein HIGH/MED**;
  Fallback end-to-end pinned-only verifiziert (kein ungepinnter Pfad; poisoned-host → Handshake-Abbruch,
  kein record). **LOW-1 in-slice gefixt** (Fallback-Subnetz-Gate `isFallbackAddressAllowed` analog
  A2/INV-A2-2); LOW-2 (Retry bei Pin-Mismatch, rate-limit-begrenzt) akzeptiert/dokumentiert.
  Codex-Review #261 (MEDIUM, Test-Lücke am Adapter-Seam) → mit dem direkten `pinned-card-fetch.test.ts` behoben.

## Abgrenzung
Schließt die ADR-035-A-Reihe (A1/A2/A3/A4a/A4b). Offen: B/TL-29 (Hub-Pull, CO-gated) + der
zwei-Peer-Restart-Live-Proof (Peer-Fenster). Kein Deploy.

## Status
Offen (PR gegen main).
