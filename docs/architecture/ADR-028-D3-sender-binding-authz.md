# ADR-028 D3 — Sender-Binding-Authz (Cert-Principal ↔ `envelope.sender`)

**Status:** Proposed (**reines DESIGN — KEIN Code, KEIN Cert-Rollout**; fork-neutral zur laufenden D2-Review #180/#181)
**Datum:** 2026-06-17 06:56
**Parent:** ADR-028 §L3 (Authz/Binding). **Verwandt:** ADR-022 (channel-gebundene HTTPS-Authz), ADR-026 (AUTHN-only seen-map + AUTHZ-approved-Gate), ADR-028 D1 (kanonische Adressierung), ADR-028 D2/D2b-pin (Transport-/Server-Identität).
**CO:** ADR-028-Konsens (gpt-5.5 9/10 + gpt-5.3-codex 8/10) — L3 wurde vom Skeptiker als fehlende Ebene ergänzt: „Identity+Transport allein verhindern Sender-Spoofing NICHT, solange der authentifizierte Kanal-Principal nicht an die App-Identität gebunden ist."

## Problem
Selbst mit **D1** (kanonisch adressierbar) und **D2** (Server-Identität SPIFFE-validiert) kann ein **authentifizierter** Peer eine Nachricht mit einem **fremden** `envelope.sender` einschleusen, solange der empfangende Node nicht erzwingt, dass `sender` an den **kryptografisch authentifizierten Kanal-Principal** gebunden ist. D3 schließt diese Lücke: für **jeden** App-Level-Ingress, der eine Envelope mit `sender` trägt, MUSS gelten `sender ≙ Principal(Kanal)` — sonst fail-closed.

## Bestandsaufnahme (was es schon gibt — geerdet im Code)
- **`authorizeHttpsSender(senderUri, certSpiffe)`** (`peer-identity.ts`, ADR-022 Schritt 3): kanonischer `node/<PeerID>`-Sender ⇒ der (per `rejectUnauthorized` CA-validierte) **Client-Cert-SAN MUSS dieselbe PeerID** sein (`verifiedPeerId`); fehlt/Mismatch ⇒ `ok:false`. Legacy `host/<id>` ⇒ bewusster **Bypass** (`legacy:true`, Migrations-Kompat). Aufgerufen im HTTPS-Receive-Pfad (`agent-card.ts:281`).
- **`attestedPeerIdFromCert`** (issuer-pinned): belegt die PeerID-Bindung aus einem CA-attestierten `node/<PeerID>`-SAN.
- **`mesh.isApprovedPeerSender(senderUri)`** (ADR-026): **AUTHZ** (ist der Sender approved/discovered?) — **NICHT** die Principal-**Bindung**. D3 ist orthogonal dazu: D3 = AUTHN-Bindung (bist du, wer du behauptest?), ADR-026 = AUTHZ (darfst du?).

## Lücken-Inventar pro Ingress-Pfad
| Ingress | Kanal-Principal verfügbar | Bindung `sender≙Principal` heute | D3-Lücke |
|---|---|---|---|
| HTTPS Message-Receive (`agent-card.ts`) | mTLS-Cert-SAN | **ja** (`authorizeHttpsSender`) | Legacy-`host/<id>`-Bypass noch offen |
| HTTPS REGISTRY_SYNC / SKILL_ANNOUNCE | mTLS-Cert-SAN | AUTHZ via `isApprovedPeerSender`; **Bindung uneinheitlich** | `authorizeHttpsSender` auch hier erzwingen |
| libp2p-Plane (`registry-sync-libp2p-adapter.ts` → `coordinator.onMessageFromPeer(peerId, …)`) | **noise-authentifizierte Stream-PeerID** (`peerId` im Handler) | Content-Autor-Bindung hängt am Owner-Gate/Signatur, **nicht** explizit an `sender≙streamPeerId` | Stream-PeerID als Principal an `sender` binden |
| Task-Delegation / Skill-Exec-Ingress | mTLS-Cert-SAN | zu verifizieren | dieselbe Regel anwenden |

## Entscheidung — die einheitliche D3-Regel (fail-closed)
Für jede eingehende Envelope `E` auf Kanal `C` mit authentifiziertem Principal `P(C)`:
1. `P(C)` stammt **ausschließlich** aus einem kryptografisch authentifizierten Kanal — HTTPS: mTLS-Cert-SAN bei `socket.authorized===true` (`rejectUnauthorized`); libp2p: die noise-verifizierte Remote-Stream-PeerID. **Nie** aus mDNS/Agent-Card/Selbstbehauptung.
2. **Kanonischer Sender** `spiffe://thinklocal/node/<PeerID>`: erzwinge `P(C).peerId === sender.peerId`. Mismatch **oder** kein Principal ⇒ **reject** (HTTPS 403 / libp2p drop) + Audit.
3. **Legacy-Sender** `host/<id>/agent/<type>`: akzeptiere **nur** solange `require_canonical_sender=false` (Migrationsfenster); jede Annahme erzeugt **Telemetrie** (`legacy_sender_accepted`). Bei `require_canonical_sender=true` ⇒ fail-closed.
4. **Alles andere** (malformed, fremde Trust-Domain, `node/<PeerID>/suffix`) ⇒ **reject**.
5. **AUTHN-Bindung (D3) und AUTHZ-Approval (ADR-026) sind UND-verknüpft:** erst Bindung (bist du es?), dann Approval (darfst du?). Beide fail-closed.

`authorizeHttpsSender` ist die Referenz-Implementierung der Punkte 2–4 für HTTPS; D3 = sie **überall** anwenden + ein **analoger libp2p-Verifier** (`authorizeLibp2pSender(senderUri, streamPeerId)`).

## Migration / Legacy-Cutoff
- Config/Env `TLMCP_REQUIRE_CANONICAL_SENDER` (Default **false** = Migrationsfenster offen).
- **Interlock:** Cutoff (`true`) pro Node erst, wenn (a) D1 deployed (kanonische Adressierung) **und** (b) Telemetrie `legacy_sender_accepted == 0` über ein Beobachtungsfenster **und** (c) alle Peers kanonische Certs/Sender emittieren (ADR-022 Phase 3). Sonst bricht der Cutoff legitime Legacy-Peers.
- Rollout: Canary-Node → Fleet; reversibel (Flag zurück). **Merge/Deploy/Flip = Christians Gate.**

## Sicherheit / Blast-Radius
- Schließt die latente **Sender-Spoofing**-Lücke: ein authentifizierter Peer kann keine Nachricht im Namen eines anderen einschleusen.
- Keine Schwächung bestehender Pfade: HTTPS-Bindung existiert bereits; D3 erweitert Coverage + libp2p + Cutoff.
- **Negativ-Test-Pflicht je Ingress (Implementierungs-PRs):** gefälschter `sender ≠ Principal` ⇒ reject; fehlender Principal ⇒ reject; Legacy bei Cutoff=on ⇒ reject.

## Abgrenzung zu D2/D2b
- **D2/D2b** = Identität des **Servers**, den WIR dialen (outbound `checkServerIdentity`, per-Host-Pin).
- **D3** = Identität des **Absenders**, der UNS erreicht (inbound `sender≙Kanal-Principal`).
Komplementäre Richtungen; gemeinsam ergeben sie beidseitige kryptografische Identitätsbindung.

## Umsetzungs-Plan (Folge-PRs, je eigener PR mit CO/CG/TS/CR/PC/DO — KEIN Teil dieses Design-PRs)
1. **D3-a:** `authorizeLibp2pSender` (rein, getestet) + Verdrahtung im libp2p-Registry/Skill-Ingress (`sender≙streamPeerId`).
2. **D3-b:** `authorizeHttpsSender` einheitlich auf REGISTRY_SYNC/SKILL_ANNOUNCE/Task-Ingress ziehen (Coverage-Schluss).
3. **D3-c:** `TLMCP_REQUIRE_CANONICAL_SENDER` + `legacy_sender_accepted`-Telemetrie + Audit-Events.
4. **D3-d (Cutoff):** Flag-Flip pro Node nach Interlock-Bedingungen — Christians Gate.

## Definition of Done (dieses Design-PRs)
- Lücken-Inventar + einheitliche fail-closed-Regel + Migrations-/Cutoff-Interlock dokumentiert und akzeptiert.
- **Kein Code, kein Cert-Rollout, kein Flag-Flip.** Implementierung erfolgt in den D3-a…d-PRs nach Christians Freigabe.

## Offene Punkte (Christian)
1. **Legacy-Cutoff-Timing:** an D1-Fleet-Deploy + Telemetrie koppeln (empfohlen) oder fixes Datum?
2. **libp2p-Plane-Priorität:** D3-a jetzt oder deferren (libp2p = sekundär, ADR-027) bis HTTPS-Coverage (D3-b) steht?
3. **Audit-Granularität:** jeder reject als eigenes Audit-Event vs. rate-limited Sammel-Event?
