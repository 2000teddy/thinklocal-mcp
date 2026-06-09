# ADR-024: Canonical-Cert-Retention beim Boot (Sender-Flip für CA-owner + own-CA Nodes)

**Status:** Proposed (Draft-PR, wartet auf Review — KEIN Deploy/Merge ohne Christians Wort)
**Datum:** 2026-06-09
**Autor:** Claude (Implementierung), Christian (Auftrag), Orchestrator .94 (Steuerung)
**Konsensus (CO):** `pal:consensus` gpt-5.5 (8/10, neutral) — endorsed mit Krypto-Härtung; gemini-2.5-pro nicht erreichbar (429 spend-cap, Infra).
**Verwandt:** [ADR-022](ADR-022-peerid-rooted-identity.md) (PeerID-rooted Identity / Sender-Flip), `th02-phase3-flip-blocker`.

## Kontext

ADR-022 Phase 3: ein Node mit `emit_canonical_sender=true` soll eine kanonische
`node/<PeerID>`-SPIFFE-Identität emittieren. Voraussetzung (`resolveSelfIdentity`):
das Serving-Cert trägt eine kanonische `node/<PeerID>`-SAN **und** ist von einer
gepinnten attestierenden CA (.94, fp `b56aa3…`) ausgestellt.

Beim Fleet-Flip (2026-06-09) flippten nur die **token-onboarded** Nodes
(TH01/.82/.52 — `ca.crt.pem` = die geteilte .94-CA, kein eigener `ca.key`).
**Zwei Node-Klassen flippten NICHT**, weil `loadOrCreateTlsBundle` ihr frisch
re-enrolltes kanonisches Cert beim Boot **verwarf und durch ein Legacy-Cert
ersetzte**:

1. **CA-owner** (`.94`, besitzt eigenen `ca.key.pem`): der Reuse-Pfad
   (`tls.ts:323`) behält ein Cert nur bei `certSpiffeUri === spiffeUri`.
   `spiffeUri` ist zur Bundle-Zeit die **Legacy**-Identität (die libp2p-PeerID
   ist da noch unbekannt) → kanonisches Cert matcht nie → reissue zu Legacy.
2. **own-CA** (`.56`/`.222`, eigene Mesh-CA statt der .94-CA): die Keep-Bedingung
   verlangt `signedByCurrentCa = ownCaCert.verify(cert)`. Ein .94-signiertes
   kanonisches Cert kettet nicht zur eigenen CA → reissue zu Legacy.

Token-onboarded Nodes treffen einen separaten Zweig (`tls.ts:240`), der das
On-Disk-Cert **unverändert** zurückgibt → deshalb flippten sie.

`.94` kann **nicht** token-onboarded werden (es MUSS den CA-Key behalten, um über
`/api/cert/sign` Certs auszustellen). Ein Trust-Anchor-Tausch (`ca.crt.pem` der
own-CA-Nodes auf die .94-CA) wurde als zu riskant **verworfen** (Christian).

## Entscheidung

Ein **additiver Canonical-Retention-Pfad** in `loadOrCreateTlsBundle`. Zwei neue
**optionale** Eingaben (in `index.ts` VOR dem Bundle-Call aufgelöst):

- `canonicalSpiffeUri?: string` — `peerIdToSpiffeUri(libp2pPeerId)`, die EIGENE
  kanonische Identität (aus dem lokalen libp2p-Key abgeleitet).
- `trustedAttestingCaPems?: string[]` — die CA-**PEMs** (eigene `ca.crt.pem` +
  gepairte Peer-CAs), **gefiltert** auf jene, deren sha256-Fingerprint in der
  gepinnten Attesting-Menge (`TLMCP_PEERID_ATTESTING_CA_FP` / auto-derive) liegt.

**Behalte** ein vorhandenes Node-Cert (statt reissue), wenn ALLE gelten:
- `fullyValid && daysLeft > 7 && certKeyMatches` (bestehende Safety-Checks), UND
- `extractSpiffeUris(cert).includes(canonicalSpiffeUri)` (das Cert ist DIESE
  Node-eigene kanonische Identität — matcht die libp2p-PeerID), UND
- das Leaf-Cert **verifiziert kryptografisch** (`verifyPeerCert(caPem, cert)`)
  unter EINER der `trustedAttestingCaPems`.

**Krypto-Härtung (CO gpt-5.5):** Es wird die **Signatur gegen das gepinnte
CA-PEM** geprüft — NICHT der Issuer-DN/-Fingerprint aus dem Leaf abgeleitet (in
einem Multi-CA-Trust-Bundle könnte eine bösartige gepairte CA den Issuer-Namen
kopieren → Confused-Deputy). Da `trustedAttestingCaPems` bereits auf gepinnte
Fingerprints gefiltert ist, ist „verifiziert unter einem dieser PEMs" äquivalent
zu „attestiert von der gepinnten CA".

**Additiv & default-neutral:** Der Legacy-Keep-Pfad
(`certSpiffeUri === spiffeUri && signedByCurrentCa`) und der Reissue-Fallback
bleiben unverändert. Ohne Retention-Opts (oder libp2p disabled) ist der
**`loadOrCreateTlsBundle`-Pfad** unverändert (Retention-Branch inert). Der
Gesamt-Boot enthält zusätzlich die Pin-/Trust-Material-Auflösung (preliminary +
authoritative) — additiv, aber nicht „byte-identisch" über den ganzen Boot. Der
CA-Key wird NIE entfernt; kein Trust-Anchor-Tausch.

**Boot-Reihenfolge:** libp2p-Key-Load + Attesting-Pin-/CA-PEM-Auflösung wandern
VOR `loadOrCreateTlsBundle`. Non-fatal wenn libp2p deaktiviert
(`canonicalSpiffeUri` undefined → Retention-Pfad inert). Der Pin-Auto-Derive
liest die eigene `ca.crt.pem` von Disk (existiert vor dem Bundle-Call).

## Sicherheits-Eigenschaften

- Ein Node behält ein kanonisches Cert NUR, wenn es (a) seine **eigene**
  PeerID-Identität trägt (SAN == aus lokalem libp2p-Key abgeleitet) und (b) von
  einer **gepinnten** CA krypto-signiert ist. Beides zusammen ist nicht schwächer
  als die bestehende Inbound-Attestierung (`attestedPeerIdFromCert`).
- `certKeyMatches` stellt sicher, dass der Node den privaten Schlüssel zum Cert
  besitzt (kein „fremdes" Cert übernehmbar).
- Default-OFF / inert ohne Opts → keine Regression für bestehende Nodes.

## Verworfene Alternativen

| Option | Ablehnung |
|--------|-----------|
| Kanonische SPIFFE als PRIMÄRE `spiffeUri` an `loadOrCreateTlsBundle` | Würde auf own-CA-Nodes ein self-signed *kanonisches* Cert erzeugen, das die Attesting-Issuer-Bedingung NICHT erfüllt → Peers lehnen ab. |
| Issuer-Fingerprint aus dem Leaf ableiten + vergleichen | Confused-Deputy in Multi-CA-Bundles (Issuer-DN kopierbar). CO-Härtung: Signatur gegen gepinntes CA-PEM prüfen. |
| Trust-Anchor-Tausch (own-CA → .94-CA) | Zu riskant (Transport-Trust-Tausch); von Christian verworfen. |
| CA-Key von `.94` entfernen (token-onboarded machen) | Bricht die Cert-Ausstellung mesh-weit. |

## Drei zusammengehörige Korrekturen (CR gpt-5.5 HIGH)

Retention allein genügt nicht — der Flip hängt an drei Stellen, die alle die
**ausstellende** CA des Serving-Certs (statt der eigenen `ca.crt.pem`) berücksichtigen müssen:

1. **Retention** (`tls.ts`): Cert behalten (oben).
2. **Flip-Gate** (`index.ts`, `certIssuerIsAttesting`): NICHT mehr
   `certFingerprint(eigene ca.crt.pem) ∈ Pin`, sondern „Serving-Cert verifiziert
   kryptografisch unter EINER gepinnten Attesting-CA-PEM" (`verifyPeerCert`). Sonst
   würde ein own-CA-Node das .94-Cert zwar behalten, aber `resolveSelfIdentity`
   meldete `cert_issuer_not_attesting` → kein Flip (CR-HIGH-1).
3. **Trust-Distribution** (`index.ts` → `registerPairingRoutes`): gepairte Peers
   erhalten die CA, die unser Serving-Cert ausgestellt hat (`servingCertIssuerCaPem`),
   NICHT zwingend die eigene Mesh-CA — sonst könnten neu gepairte Peers ein
   behaltenes .94-signiertes Cert nicht validieren (CR-HIGH-2).

Multi-SAN-Härtung (CR-MEDIUM): ein behaltenes Cert darf KEINE fremde
`node/<PeerID>`-SAN tragen (Legacy-`host/`-SANs erlaubt; jede `node/`-SAN muss die
eigene sein).

## Konsequenzen / Rollout (Voraussetzungen — ehrlich)

Nach Deploy + Re-Enroll flippen `.56`/`.222`/`.94` **nur dann** auf
`emitCanonical:true`, wenn ALLE Voraussetzungen erfüllt sind:
- ein gültiges kanonisches `node/<PeerID>`-Serving-Cert liegt auf Disk (Re-Enroll),
- der Attesting-Pin ist gesetzt (`.56`/`.222`: env `TLMCP_PEERID_ATTESTING_CA_FP=b56aa3…`;
  `.94`/Shared-CA-Nodes: auto-derive aus eigener ca.crt.pem),
- die ausstellende .94-CA ist lokal verfügbar (own-CA-Nodes: als gepairte CA — für
  `verifyPeerCert` in Retention + Flip-Gate),
- `emit_canonical_sender=true`.
Fehlt eine Voraussetzung → Fail-safe bleibt Legacy-Emit (kein 403-Risiko).
- **Rollout ist NICHT Teil dieses Drafts** — kein Deploy/Re-Enroll/Merge ohne
  Christians ausdrückliches Wort. Der PR wartet auf Review.

## Offene Follow-ups — MERGE-/DEPLOY-BLOCKING (CR/PC gpt-5.x)

Dieser DRAFT ist review-fertig (0 CRITICAL/HIGH), aber VOR Merge/Deploy zwingend zu schließen:
1. **[MEDIUM] CA-Gültigkeit im Retention-Verify.** `verifyPeerCert` prüft die LEAF-Gültigkeit,
   aber nicht das Gültigkeitsfenster der ausstellenden CA. Vor Merge: CA-`notBefore/notAfter`
   im Retention-/Flip-Pfad fail-closed prüfen + Regressionstest (abgelaufene CA → kein Retain).
2. **[MEDIUM] Trust-Distribution-Lifecycle.** `servingCertIssuerCaPem` wird beim Boot gesetzt;
   bei einem behaltenen fremd-signierten Cert ist Pairing/Trust-Refresh/Rotation zeitlich
   entkoppelt. Vor Merge: Lifecycle-Test (retain → Pairing/Refresh) + fail-closed bei
   fehlender Issuer-CA im Distribution-Pfad.
3. **[LOW]** `filterPinnedCaPems` direkt unit-testbar exportieren; Doku-Wording.

## Status der Flotte bei Erstellung (ehrlich)

- **canonical-emit:** TH01(.80), TH02(.82), .52(iobroker).
- **legacy-emit, akzeptiert aber canonical (accept-both, 5/5, 0×403):**
  .56(influxdb), .222(ai-n8n), .94(minimac/CA). `.55` ausgeschlossen (Host-Routing).
- Mesh voll interoperabel; dieser Fix adressiert das verbleibende 100%-canonical-EMIT.
