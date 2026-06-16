# ADR-028 D2 — SPIFFE-Server-Identitäts-Verifikation (Detail-Spec + Umsetzung)

**Status:** Proposed (Code hinter Default-OFF-Flag; Produktiv-Aktivierung/Cert-Rollout = Christians Wort)
**Datum:** 2026-06-16 22:18
**Parent:** ADR-028 §L2 (Transport/Auth). **Verwandt:** ADR-027 / RUNBOOK-55-A Fall C, ADR-022 (Cert-SAN-Identität), `[[th55-pathA-cert-san-blocker]]`.
**CO:** abgedeckt durch ADR-028-Konsens (gpt-5.5 for 9/10 + gpt-5.3-codex against 8/10); die Skeptiker-Härtungen (fail-closed, alle SANs, exakte Trust-Domain, expected-id NICHT aus dem Cert) sind hier umgesetzt.

## Problem
Node-Certs SANen ihre SPIFFE-URI (`node/<PeerID>`) **und** ihre LAN-IP, aber **nicht** die Tailscale-100.x-IP. Node's Default-TLS prüft Host/IP gegen die altnames → Overlay-Dial (100.x) scheitert mit `ERR_TLS_CERT_ALTNAME_INVALID`, obwohl die SPIFFE-Identität korrekt und CA-signiert ist (RUNBOOK-55-A Fall C; `curl -k` kam nur durch, weil `-k` den SAN-Check abschaltet).

## Entscheidung (D2b)
Den altname-Abgleich für ausgehende Mesh-Dials durch eine **SPIFFE-URI-SAN-Validierung** ersetzen — die Identität an die kryptografische Workload-Identität binden statt an eine variable Netz-Adresse. Damit funktioniert Overlay/Cross-Subnet **ohne per-IP-Cert-Reissue** (D2a bleibt minimal: die URI-SAN ist bereits vorhanden).

### Umsetzung (dieser PR)
- **`mesh-server-identity.ts`** (rein, getestet): `verifyMeshServerIdentity(host, cert, policy)` — Vertrag wie Node `checkServerIdentity` (`undefined`=ok, `Error`=Abbruch). Wiederverwendet `spiffeUrisFromSubjectAltName` + `normalizeAgentId` (D1, node-fähig).
- **`mesh-connect.ts`**: Flag `TLMCP_SPIFFE_SERVER_IDENTITY=1` (Default **OFF**) → setzt `checkServerIdentity` in den undici-Connector. OFF = Node-Default-altname (bisheriges Verhalten, kein Risiko).

### Sicherheits-Invarianten (fail-closed — CO-Härtungen)
1. **Chain bleibt scharf:** `rejectUnauthorized:true` unverändert; `checkServerIdentity` läuft NUR nach erfolgreicher CA-Chain-Validierung und lockert sie NIE — ersetzt ausschließlich den Adress-Abgleich.
2. **Exakte Trust-Domain + strikte Grammatik:** SAN muss via `normalizeAgentId`/`parseSpiffeUri` parsen (`spiffe://thinklocal/…`); fremde/lookalike Domain (`thinklocal-evil`) + malformed → verworfen.
3. **ALLE URI-SANs** werden geprüft (nicht nur die erste) — Übergangs-Certs tragen ggf. Legacy + kanonisch.
4. **expected-id-Bindung aus der Registry, NICHT aus dem Cert:** wenn die erwartete Peer-Identität bekannt ist, MUSS eine SAN exakt dazu normalisieren — sonst Ablehnung. Verhindert Intra-Mesh-Impersonation (jedes gültige Mesh-Cert für jeden Host).
5. **Fehlende gültige SAN / Mismatch / ungültige expected-id → `Error`** (Handshake-Abbruch).

## Offen / Folgeschritt (D2b-pin) — bewusst markiert
Die aktuelle Wiring nutzt **TOFU** (kein per-Host-Pin): `resolveExpected` ist noch nicht injiziert → bei aktiviertem Flag wird eine *gültige thinklocal-SPIFFE-SAN* verlangt, aber (noch) nicht gegen eine pro-Host gepinnte Identität gebunden. Das ist **intra-Mesh-impersonation-tolerant** und deshalb:
- **Flag Default OFF** — inert, bis bewusst aktiviert.
- **Unmittelbarer Folgeschritt:** `resolveExpected(host)` aus der Peer-Registry/dem Static-Peer-Eintrag injizieren (TOFU-Pin beim ersten validierten Card-Fetch, danach erzwungen). Der Verifier unterstützt `expectedSpiffeId` bereits (per-Host-Pin nur noch zu verdrahten). Erst nach diesem Pin sollte das Flag fleet-weit aktiviert werden.

## Aktivierungs-/Rollout-Gate (Christian)
- Kein Produktiv-Flag-Flip / Cert-Aktivierung ohne Christians Wort.
- Empfohlene Reihenfolge: (1) D2b-pin verdrahten + testen → (2) auf 1 Node (z.B. .55) aktivieren + verifizieren (.55→Peer-100.x-Dial grün, Identität SPIFFE-validiert) → (3) Fleet.

## Definition of Done
- Verifier rein + erschöpfend getestet (alle Bypass-Modi fail-closed). ✅ (dieser PR)
- Flag-Wiring Default-OFF, OFF == bisheriges Verhalten. ✅
- per-Host-Pin (resolveExpected) + .55-Overlay-Verifikation. ⏳ (D2b-pin, Folge-PR)
