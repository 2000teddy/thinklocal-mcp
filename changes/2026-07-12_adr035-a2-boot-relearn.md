# changes/2026-07-12 — feat(discovery): ADR-035 A2 proaktives Boot-Re-Learn (TL-27)

**Typ:** Daemon-Code (`boot-relearn.ts` neu, `index.ts`) + Tests.
**Slice:** ADR-035 A2 / TODO TL-27. Folge auf A1 (#259) — konsumiert dessen Boot-Ziele.
**CO:** kein neuer CO — die Attestierungs-Primitive (`verifyMeshServerIdentity` mit hartem
`expectedSpiffeId`) ist bereits CO-blessed (ADR-028 D2b, „CO 2026-06-16, beide Modelle, fail-closed");
A2 wendet sie **maximal strikt** an (kein TOFU — die kanonische PeerID kommt aus dem A1-Cache). Die
A2-Invarianten stammen aus dem A1-CO.

## Warum
A1 persistiert die Boot-Ziele, ist aber verhaltens-inert — behebt den Outage noch nicht. A2 stellt
die AUTHN-Auflösung nach einem Restart **selbst** wieder her: für jedes geladene Cache-Ziel wird
proaktiv (statt auf einen Inbound zu warten) die Agent-Card geholt und — nach kryptografischer
Attestierung — in die AUTHN-only-seen-Map geschrieben. Das behebt „.55 Unknown sender" nach
Neustart-Wellen ohne static_peers/mDNS-Glück.

## Sicherheits-Design (CO-Invarianten — der Kern)
**Root-Cause-Gefahr:** ein OUTBOUND-Fetch hat keinen client-cert-attestierten Anker wie der
ADR-026-Inbound-Learner. Ohne Server-Identity-Pinning könnte ein vergifteter Platten-Endpoint eine
Card `{spiffeUri: OPFER, publicKey: ANGREIFER}` servieren → A4b-Fehlerklasse. Der globale D2b-
Pin (`spiffeServerIdentity`) ist **default-AUS/Christian-gated**, der Standard-`tlsDispatcher` pinnt
also NICHT.

**Lösung:**
- **INV-A2-1 (Attestierung):** `fetchCardPinned` baut einen **dedizierten** mTLS-Dial, der
  `spiffeServerIdentity:true` **für genau diesen Dial** erzwingt (unabhängig vom globalen Flag) und
  `makeMeshCheckServerIdentity(() => expectedSpiffeUri)` injiziert → volle CA-Chain
  (`rejectUnauthorized`) PLUS harter SPIFFE-SAN-Match auf die erwartete kanonische PeerID. Ein
  Endpoint, der nicht das Cert der erwarteten PeerID hält, bricht im Handshake ab (fail-closed).
  `certFingerprint` bleibt HINT (nie Accept-Gate → keine CA-Reissue-Selbst-DoS). Zweite Achse:
  `card.spiffeUri == expectedSpiffeUri` + PublicKey vorhanden, sonst `rejected-identity`.
- **INV-A2-2 (Endpoint-Restriktion):** `isReLearnHostAllowed` gated JEDEN Dial VOR Netzwerk-Kontakt:
  nur IP-Literale, Loopback/Link-local/unspezifiziert/öffentlich verworfen, mit `allowed_mesh_cidrs`
  erzwungen, ohne Policy nur RFC1918/ULA. Plus 5s-Timeout + Rate-Limit (`adr035-relearn:<peerId>`).

## Was
- **`boot-relearn.ts` (neu, rein/injizierbar):** `relearnPeer(deps)` (Dedup → Endpoint-Gate →
  Rate-Limit → gepinnter Fetch mit A3-Retry/Backoff → Card-Validierung → record; jeder Pfad
  fail-closed) + `isReLearnHostAllowed(host, cidrs)` (SSRF-Gate, rein).
- **`index.ts`:** nach dem A1-Boot-Load ein fire-and-forget `runBootReLearn()` (nur mit TLS-Bundle):
  iteriert `mesh.getBootReLearnTargets()`, baut je Ziel den hart-gepinnten Dial (per-Target-Agent im
  `finally` geschlossen → kein Socket-Leak), recorded via `mesh.recordAuthenticatedSeen`, Audit
  `PEER_OBSERVED`. Blockiert den Start nicht; Fehler gefangen.

## CR (claude-Subagent, adversarial, Pin-Enforcement-Fokus) — APPROVE, kein HIGH
Pin end-to-end verifiziert: `rejectUnauthorized:true` (volle Chain) + harter SPIFFE-SAN-Match auf
`expectedSpiffeUri`, kein Skip über `disablePinning` (orthogonal), `spiffeServerIdentity:true` erzwingt
den Verifier (throw statt TOFU). **A4b NICHT reintroduced.** Behoben in-slice:
- **MED:** unbounded `res.json()`-Body → neuer reiner `readCappedText`-Helper (Byte-Limit
  `MAX_CARD_BODY_BYTES = 256 KiB`, Stream-Abbruch bei Überschreitung; Timeout begrenzt nur Zeit).
LOW deferred (dokumentiert, kein Identity-Defekt): sequenzieller Loop ohne globales Throttle (unref't,
gefangen — Robustheit); `certFingerprint` leer für re-learnte Einträge (nicht sicherheitsrelevant,
Audit-Wert); no-policy-SSRF-Fläche = ganzes RFC1918 (daemon.toml empfiehlt `allowed_mesh_cidrs`).

## Tests / Verifikation
- `boot-relearn.test.ts` **+20**: recorded; **INV-A2-1: fetch bekommt expectedSpiffeUri**;
  **Card-SAN≠expected → rejected-identity**; kein publicKey → rejected; **INV-A2-2 endpoint-blocked
  (kein Fetch)**; skipped-resolvable; rate-limited; Wellen-Recovery (Throw→2. Versuch); Retries
  erschöpft; Backoff-Reihenfolge; `isReLearnHostAllowed` (privat/öffentlich/loopback/link-local/
  hostname/CIDR/IPv4-mapped); **`readCappedText` (unter/über Limit/leer/Grenze)**.
- **1554 gesamt grün**, `tsc --noEmit` sauber, keine neuen ESLint-Errors.

## Abgrenzung
A2 schließt die A1+A2-Kette (Restart-Amnesie geheilt). Offen: A4b/TL-28b (identitäts-gebundener
Inbound-Fallback, gated), B/TL-29 (Hub-Pull, CO-gated). **Kein Deploy** — Live-Verifikation
(zwei-Peer-Restart-Proof) im Peer-Fenster.

## Status
Offen (PR gegen main).
