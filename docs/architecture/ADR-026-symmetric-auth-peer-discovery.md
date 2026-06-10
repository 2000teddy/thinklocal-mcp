# ADR-026: Symmetrische Discovery via authentifizierter Inbound-Peer-Registrierung

**Status:** Accepted (implementiert — Option A, AUTHN-only seen-Map + AUTHZ-Gate; Christian: „mach das so")
**Datum:** 2026-06-10
**Autor:** Claude (Entwurf+Impl.), Christian (Auftrag/Freigabe), Orchestrator .94 (Diagnose)
**Analyse/CO:** Assessment (Claude) deckt sich mit `pal:consensus` (gpt-5.5 for 9/10, gpt-5.3-codex neutral 9/10).
**CR:** `pal:codereview` gpt-5.5 (security) — 2 HIGH (AUTHN/AUTHZ-Leak in REGISTRY_SYNC/SKILL_ANNOUNCE; mehrdeutige PeerID-Override) + 1 MEDIUM (IPv6-Endpoint) + 2 LOW, **alle gefixt + Regressionstests**. Siehe §6.
**Verwandt:** ADR-001 (Approval-Gates / Pairing), ADR-022 (PeerID-rooted Identity), ADR-024 (Cert-Retention),
ADR-025 (Static-Join/mDNS-off), `th55-ehostunreach-host-routing`, `th02-phase3-flip-blocker`.

## Kontext — die Discovery-Asymmetrie

`resolvePeerPublicKey` (`mesh.ts`) löst den Sender-Signing-Key NUR über `this.peers` auf
(kanonisch: Eintrag mit `agentCard.publicKey` + `peerIdVerified` + passender `peerId`; legacy:
exakter `agentId`/`card.spiffeUri`-Treffer). `this.peers` wird **ausschließlich durch eigene
Discovery** befüllt (`addPeer` aus mDNS-`browse` oder dem static_peer-Reconciler).
`markPeerIdVerified` (`mesh.ts`) **bindet nur an EXISTIERENDE** Einträge (senderUri / byPeerId /
remoteHost+Card-Fallback) — sonst `NOOP`; es legt **keinen** neuen Eintrag an.

Folge: ein Knoten, der sich **outbound** per (authentifiziertem, issuer-gepinntem) mTLS verbindet,
ist beim Empfänger **nicht** in `this.peers` → `resolvePeerPublicKey = undefined` → **403 „Unknown
sender"** auf jeden `SKILL_ANNOUNCE`. Verschärft, weil der Envelope den Signing-Key NICHT trägt
(Option B: ECDSA-Key kommt aus der Agent-Card, nicht aus dem mTLS-Cert) → der Empfänger MUSS die
Card kennen. Betroffen: jeder Nicht-mDNS-Node (mobil / Cross-Subnet / NAT / `mdns_enabled=false`).
Heutiger Workaround: Node manuell als `static_peer` am Hub (`.94 TLMCP_STATIC_PEERS=10.10.10.55`).

## Entscheidung

Bei einer **authentifizierten, issuer-gepinnten Inbound-mTLS-Verbindung** den verbundenen Peer in
eine **ephemere `authenticated-seen`-Map** aufnehmen, die `resolvePeerPublicKey` **VOR** dem 403
konsultiert. Strikt getrennt: **AUTHN** (Signatur prüfbar machen) wird automatisch; **AUTHZ** (was
der Peer DARF) bleibt vollständig ADR-001-gated.

### 1. `authenticated-seen`-Map (AUTHN-Quelle, ephemer)

Neue Struktur in `mesh.ts`, getrennt von `this.peers` (der „approved/discovered"-Map):

```
authenticatedSeen: Map<peerId, {
  peerId: string;            // attestierte node/<PeerID> aus dem mTLS-cert-SAN
  publicKey: string;         // ECDSA-Signing-Key aus der geholten + validierten Agent-Card
  spiffeUri: string;         // kanonische URI (== peerIdToSpiffeUri(peerId), geprüft)
  certFingerprint: string;   // sha256 des Client-Leaf (Bindung an die Verbindung)
  endpoint: string;          // remoteAddress:port (Quelle der Card)
  lastSeen: number;          // TTL/LRU
  state: 'authenticated_unapproved';  // NIE 'approved_trusted' (siehe §2)
}>
```

**Befüllung — Hook nach `onPeerCertVerified`** (`agent-card.ts`, Message-Handler ~Z.297, dort wo
`attestedPeerId !== null` feststeht und `tlsSock.authorized === true`, `tlsSock.remoteAddress`,
`canonicalCertSan`, Leaf-`fingerprint256` vorliegen):
1. Wenn `resolvePeerPublicKey(sender)` bereits auflöst → nichts tun (dedup).
2. Sonst **asynchron** (Request-Pfad NICHT blocken): Agent-Card von
   `https://<remoteAddress>:<port>/.well-known/agent-card.json` via mTLS-Dispatcher holen
   (gleiche Fetch-Logik wie die static_peer-Connect-Closure in `index.ts`).
3. **Validieren:** `card.spiffeUri === peerIdToSpiffeUri(attestedPeerId)` (Card-SAN == attestierte
   PeerID) — sonst verwerfen. Card-Signatur/Selbstkonsistenz wie im bestehenden Card-Pfad.
4. In `authenticatedSeen` schreiben (`state: 'authenticated_unapproved'`).

**Konsultation — `resolvePeerPublicKey` (`mesh.ts`):** nach den bestehenden `this.peers`-Pfaden,
VOR `return undefined`, zusätzlich `authenticatedSeen` prüfen — **mit identischer Invariante**:
kanonisch nur `peerId === wantPeerId` **und** `spiffeUri == sender` **und** `state` ist gesetzt.
Der zurückgegebene Key ist NUR zur **Signaturprüfung** (AUTHN). `markPeerIdVerified` bleibt für
`this.peers` zuständig; alternativ: der Inbound-Hook ruft `addPeer`+`updateAgentCard`+
`markPeerIdVerified` für einen vollwertigen (aber als `authenticated_unapproved` markierten)
Eintrag — **Design-Entscheid offen** (separate Map vs. markiertes peers-Feld; siehe Risiken).

### 2. Strikte Trennung AUTHN (auto) vs. AUTHZ (ADR-001-gated) — INVARIANTE

Zwei Zustände:
- **`authenticated_unapproved`** — kryptografisch verifizierte Identität (mTLS+issuer-pin+Card-SAN).
  Erlaubt AUSSCHLIESSLICH: **Signaturprüfung** eingehender Nachrichten (resolvePeerPublicKey).
- **`approved_trusted`** — gepairt/approved gemäß ADR-001 (SPAKE2-Pairing / Human-Approval).

**INVARIANTE (muss im Code bewiesen + getestet sein): `authenticated_unapproved` darf NIRGENDS in
eine Autorisierungs-Entscheidung einfließen.** Konkret zu prüfen/abzusichern:
- **Registry-Sync-Akzeptanz** (`registry.ts importPeerCapabilities`, `registry-sync-*`): ein
  `authenticated_unapproved`-Peer darf keine fremden Caps schreiben. (Bestehender Owner-Gate
  `cap.agent_id === envelope.sender` bleibt; OFFENE FRAGE unten: darf er die EIGENEN Caps
  advertisen?)
- **Heartbeat** (`mesh.ts startHeartbeatLoop`): unapproved zählt nicht als „trusted online peer"
  für vertrauensbehaftete Aggregation.
- **Capability-Merge / Routing**: unapproved-Caps fließen nicht in das vertrauenswürdige
  Capability-Set / Routing-Ziele.
- **Skill-Exec** (`task-executor.ts`, `skills.ts`, `agent-api.ts`): unapproved darf KEINE
  Skill-Ausführung / Task-Delegation / Credential-Anforderung auslösen — bleibt hinter den
  ADR-001-Approval-/Vault-Gates.

**Umsetzung der Invariante:** `authenticatedSeen` wird NUR von `resolvePeerPublicKey` gelesen.
Jede AUTHZ-Stelle prüft weiterhin `approved_trusted` (Pairing/Approval), NIE „Signatur ok ⇒ darf".
**Test:** ein Peer NUR in `authenticatedSeen` (nicht gepairt/approved): (a) seine signierte
Nachricht verifiziert ✅; (b) registry-write fremder Caps abgelehnt; (c) Skill-Exec/Task/Secret
abgelehnt; (d) zählt nicht als approved im Heartbeat/Routing. Plus: `grep`-/Architektur-Test, dass
`authenticatedSeen` außerhalb `resolvePeerPublicKey` nicht referenziert wird.

### 3. Guardrails

- **Rate-Limit** pro `(certFingerprint, peerId, sourceIP)` auf das Card-Fetch+Register
  (vorhandener `RateLimiter`) — gegen Fetch-/Eintrag-Flooding.
- **TTL + LRU-Cap** auf `authenticatedSeen` (z.B. TTL 15 min nach `lastSeen`, Cap N Einträge) —
  begrenzter Speicher; abgelaufene Einträge fallen raus (Re-Learn bei nächster Verbindung).
- **Sender-Bindung:** Reject (kein Register), wenn `payload-sender (rawEnvelope.sender)` ≠
  `attestierte Transport-Identität (cert-SAN PeerID)` — verhindert Identitäts-Spoofing über die
  Verbindung.
- **Nur attestiert:** Hook feuert NUR bei `attestedPeerId !== null` (issuer-gepinnte CA) +
  `tlsSock.authorized === true`. Kein Register für legacy/unattested.
- **Card-Fetch nur gegen die verbindende IP** (kein SSRF), via mTLS (rejectUnauthorized).
- **Audit** (`audit.ts`): Event `PEER_OBSERVED` (authenticated_unapproved) getrennt von
  `PEER_APPROVED` — Observability „observed vs. approved" + Forensik.

## 4. Einfachere Alternativen — ehrliche Abwägung

| Option | Was | Reicht es? |
|--------|-----|-----------|
| **B1: resolvePeerPublicKey konsultiert zusätzlich pairing-/registry-Store** | Key aus gepairten Peers / propagierten Cards ziehen | **Nur teilweise.** Der Pairing-Store hält CA-Certs, NICHT den Agent-Signing-Key/Card. Der Registry-CRDT propagiert Caps (agent_id) — die Card/PublicKey nur, wenn IRGENDEIN Node den Peer entdeckt hat. Deckt NICHT den Zero-Discovery-Fall (niemand entdeckt den mobilen/NAT-Node). |
| **B2: 403 als softer, transienter Retry, der via registry-sync konvergiert** | Sender retryt; Empfänger löst auf, sobald die Card per Gossip ankommt | **Nur teilweise + setzt B1-Propagation voraus.** Konvergiert NUR, wenn ein anderer Node den Peer entdeckt + dessen Card in den CRDT bringt. Im Zero-Discovery-Fall konvergiert es NIE. Teilweise schon vorhanden (SKILL_ANNOUNCE-Retry). |
| **A: Inbound-Auto-Registrierung (dieser ADR)** | Authentifizierte Verbindung lernt die Card direkt | **Ja — löst auch Zero-Discovery.** Ein Card-Fetch von der verbindenden IP. |

**Fazit:** B1/B2 sind kleiner, lösen die Wurzel (Zero-Discovery: mobil/NAT/`mdns_enabled=false` ohne
Hub-static_peer) aber NICHT. **A ist der eigentliche Root-Fix.** B2 (sanfter Retry) ist als
**komplementäre, billige Robustheit** sinnvoll und teils schon da — aber kein Ersatz für A.
**Empfehlung: A umsetzen, B2-Verhalten beibehalten/leicht härten.**

## 5. mDNS-Default — offen gehalten, Pro/Contra

**Frage:** #164 (`disable_mdns_interface_pin`) + #166 (`mdns_enabled=false`) als Route-Poison-Schutz
**behalten** (Claude-Sicht) ODER mDNS wieder **default-an** + Schutz nur bei real auftretendem Poison
(Konsens-Sicht)?

| | Pro | Contra |
|---|---|---|
| **Flags behalten (opt-in static-only)** | deterministisch; bekannte Problem-Hosts (.55) sauber abschaltbar; kein Auto-Magie-Risiko | mDNS-Vorteil (zero-config) muss pro Problem-Host manuell aus |
| **mDNS default-an + Auto-Disable bei Poison** | zero-config bleibt überall | Poison **zuverlässig** zur Laufzeit zu erkennen ist fragil (transienter connectx-Zustand); Auto-Toggle = nicht-deterministisches Verhalten, schwer testbar |

**Empfehlung (mit Begründung):** **mDNS default-AN lassen** (normale Nodes profitieren von
zero-config), die **#164/#166-Flags als explizite OPT-IN** für die wenigen dual-homed-macOS-Hosts
behalten — **KEIN** laufzeit-Auto-Disable (Poison-Erkennung ist nicht robust genug,
nicht-deterministisch). **Mit ADR-026 (symmetrische Registrierung) hängt die Discoverability NICHT
mehr an mDNS** → `mdns_enabled=false` wird „first-class" (der Node wird inbound gelernt). Damit ist
der Default-Streit weitgehend entschärft: Default-an für Komfort, Opt-out deterministisch + ohne
Discoverability-Verlust. Endgültiger Default-Entscheid bleibt Christian/Orchestrator vorbehalten.

## Sicherheits-Eigenschaften (Zusammenfassung)
- Register NUR bei CA-validiert (`rejectUnauthorized`) + issuer-pin-attestiert + Card-SAN==PeerID.
- Pairing/Approval (ADR-001) NICHT umgangen: mTLS-Trust setzt bereits eine gepairte/shared CA voraus;
  `authenticated_unapproved` ist AUTHN-only und NIE AUTHZ.
- Spoofing fail-closed: falscher Key ⇒ Signaturprüfung schlägt fehl; Sender≠Transport-Identität ⇒ reject.
- DoS: Rate-Limit + TTL/LRU-Cap; Angriffsfläche auf CA-vertraute Entitäten begrenzt.

## OFFENE FRAGEN (vor Implementierung zu klären)
1. **Separate `authenticatedSeen`-Map vs. markiertes `this.peers`-Feld** (`state`)? Separate Map =
   sauberere Invariante (AUTHZ liest `this.peers`, nie die Seen-Map); markiertes Feld = weniger
   Duplikation, aber Risiko, dass AUTHZ-Pfade den Eintrag „sehen". **Empfehlung: separate Map.**
2. **Darf ein `authenticated_unapproved`-Peer seine EIGENEN Caps advertisen** (Owner-Gate erfüllt)?
   Heutiges Modell: jeder gepairte Peer kann. Wenn Approval auch für Cap-Advertisement gewünscht ist,
   braucht es einen zusätzlichen Gate — **Christian-Entscheid.**
3. **Inline-await (erster Announce sofort grün, +Latenz) vs. async-learn (erster Announce 403, vom
   Sender-Retry abgefangen)?** Empfehlung: async-learn (kein Request-Pfad-Block).

## 6. Implementierungs-Ergebnis (umgesetzt, CR gpt-5.5)

**Aufgelöste OFFENE FRAGEN:**
1. **Separate `authenticatedSeen`-Map** gewählt (saubere Invariante) — `private authenticatedSeen` in
   `mesh.ts`, gelesen NUR von `resolvePeerPublicKey`, bewiesen durch einen Architektur-/grep-Test.
2. **Darf `authenticated_unapproved` Caps advertisen? → NEIN (strikt).** Die CR (HIGH 1) zeigte, dass
   `REGISTRY_SYNC` + `SKILL_ANNOUNCE` zuvor NUR implizit über „in `this.peers` auflösbar" gegatet
   waren; die seen-Map hätte das aufgeweicht. **Fix:** neues AUTHZ-Prädikat
   `MeshManager.isApprovedPeerSender(senderUri)` — spiegelt `resolvePeerPublicKey` OHNE den
   `authenticatedSeen`-Fallback. `index.ts` gatet beide state-mutierenden Typen auf
   `senderIsPaired || mesh.isApprovedPeerSender(sender)` → ein `authenticated_unapproved`-Peer wird
   AUTHN-aufgelöst (Signatur ✅), seine Nachricht aber **vor jeder State-Mutation verworfen** (return
   null, kein 403-Storm). Das ist genau die Invariante: AUTHN ≠ AUTHZ. (`SECRET_REQUEST`/`AGENT_MESSAGE`
   waren schon `senderIsPaired`-gegatet; `SKILL_REQUEST`/`SKILL_TRANSFER`/`TASK_*` landen im `default`-
   NOOP.) Das Gate ist verhaltensneutral für die bestehende Fleet (`isApprovedPeerSender` == die
   Vor-ADR-026-Akzeptanzmenge), schließt aber die neue seen-Menge aus.
3. **async-learn** umgesetzt: `agent-card.ts` feuert auf dem 403-Pfad non-blocking
   `onAuthenticatedInbound` → `inbound-peer-learner.ts` (Card-Fetch + Doppel-Bindung
   sender==card-SAN==attestierte PeerID) → `recordAuthenticatedSeen`. Der Sender-Retry löst auf.

**Weitere CR-Fixes:** HIGH 2 — bei mehrdeutigen verifizierten PeerID-Treffern (`matches.length > 1`)
bleibt `resolvePeerPublicKey` strikt fail-closed (kein seen-Override). MEDIUM — IPv6/IPv4-mapped
`remoteAddress` wird beim Card-Fetch URL-sicher entmappt/gebracketet; leere Adresse → `fetch-failed`.
LOW — Rate-Limit-Kommentar (pro attestierter PeerID) korrigiert; abgelehnte Learn-Versuche bleiben
geloggt (Audit nur bei Erfolg `PEER_OBSERVED` + bei abgelehntem state-mutating Sender) — bewusst
schlank gehalten.

**Config:** `discovery.auto_register_authenticated_peers` (Default `true`, Env
`TLMCP_AUTO_REGISTER_AUTH_PEERS=0` → aus). **#164/#166 (Route-Poison-Schutz) bleiben unangetastet.**
