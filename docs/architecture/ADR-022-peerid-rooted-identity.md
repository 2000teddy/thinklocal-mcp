# ADR-022: PeerID-gewurzelte Knoten-Identität — eine kryptografische Identitätsquelle

**Status:** Accepted (Entscheidung 2026-06-03; Implementierung ausstehend — Umsetzungs-Prompt folgt separat)
**Datum:** 2026-06-03
**Autor:** Christian (Entscheidung), Claude Code / TH01 (Konsens-Moderation, Doku)
**Konsensus:** Zwei unabhängige `pal:consensus`-Läufe, beide konvergent (Details unten)
**Verwandt:** ADR-001 (Mesh-Architektur), ADR-019 (mDNS-Discovery), ADR-020 (Registry-Replikation), PR #74 (stable-node-id), PR #139 (Legacy-Hostname-URI-Migration)

## Kontext

`thinklocal-mcp` hatte bis 2026-06-03 **drei parallele Knoten-Identifier**, die nicht aneinander gebunden waren:

1. **Hostname-abgeleitete SPIFFE-ID im mTLS-Cert-SAN** — beim Token-Join erzeugt, z.B. `spiffe://thinklocal/host/ThinkHub/agent/claude-code`.
2. **„stable node id"** aus gehashter Hardware (MACs + CPU + Plattform), z.B. `cf00a5bab06832c1`, woraus die Runtime-Identität `spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code` abgeleitet wurde.
3. **libp2p Ed25519 PeerID** — bereits erzeugt und persistiert, aber als dritter, an nichts gebundener Identifier.

### Auslösender Live-Bug (TH01, 2026-06-03)

Node TH01 (Host „ThinkHub", 10.10.10.80) joint das Mesh. Sein Cert-SAN sagt `host/ThinkHub`, die laufende Runtime-Identität sagt `host/cf00a5bab06832c1`. Folge: Peers **akzeptieren** die Agent-Card (Inbound), aber TH01s **ausgehender `SKILL_ANNOUNCE`** wird von allen Peers mit **HTTP 403** abgelehnt — Identitäts-Split-Brain zwischen Cert-SAN und Runtime-SPIFFE-ID.

### Warum OS-Quellen als Identität untauglich sind

Deployment-Matrix Windows/Linux/macOS/VM/Pi. Hostname, mDNS-Name, IP und MAC sind **alle volatil**; macOS 26 hängt persistente Zähl-Suffixe an (`Minimac-3763.local`); Hardware-UUIDs existieren nicht uniform (VM/Container/Pi). Jede Identität, die aus diesen Quellen abgeleitet wird, driftet.

## Entscheidung

**Die kanonische, einzige Quelle der Knoten-Identität ist die libp2p-PeerID (persistierter Ed25519-Key).**

- **Ein Key → eine PeerID → ein Cert-SAN.** Der Drift verschwindet konstruktiv, weil es nur noch eine Identitätswurzel gibt.
- **mTLS-Cert = reines Transport-Credential**, NICHT die Identitätswurzel. Der SAN lautet:
  ```
  spiffe://thinklocal/node/<PeerID>
  ```
  Trust-Domain `thinklocal` (von Christian gewählt), Pfad `/node/<PeerID>`.
- **Die Mesh-CA bleibt erlaubt**, signiert aber **ausschließlich PeerID-abgeleitete SANs** (Transport-Trust, nicht Identitätswurzel). Das passt zum bestehenden CA-Owner-Modell (Admin .94).
- **OS-Quellen (Hostname, MAC, IP, mDNS-Name, Hardware-UUID) werden NIE für Identität oder Authorization verwendet.**
- **mDNS/Bonjour wird zu reiner Discovery/Adressauflösung degradiert** — darf volatile Namen/IPs/Multiaddrs liefern; der Identitäts-Abgleich läuft IMMER gegen die PeerID. Damit ist die macOS-26-mDNS-Drift für die Identität irrelevant (verifiziert 2026-06-03: `LocalHostName=Minimac` sauber, Drift nur intermittierend).

### mTLS-Validierungs-Invariante

Validierung prüft, dass **Cert-PeerID == libp2p-Transport-Handshake-PeerID == authz-Identität**. Eine **Startup-Assertion muss LAUT fehlschlagen**, wenn PeerID / Cert-SAN / authz-Identität divergieren (verhindert die Wiederkehr der ADR-022-Bug-Klasse).

## Konsens

Zwei unabhängige `pal:consensus`-Läufe, beide konvergent auf diese Entscheidung:

**Lauf A (TH01-Panel, 4 Modelle, allgemeines Proposal):**
- gpt-5.5 (against) — support-with-conditions, **8/10**
- gemini-2.5-pro (for) — support, **9/10**
- gemini-3.1-pro-preview (neutral) — support-with-conditions, **8/10**
- MiniMax-M2.7 (neutral) — support-with-conditions, **7/10**

**Lauf B (Orchestrator-Panel, 3 Modelle, Option 1 vs Option 2; `continuation_id f5715d3c-6cea-456f-8c93-4829b7497d69`):**
- gpt-5.5 (neutral) — Option 1, **9/10**
- gemini-3.1-pro (for) — Option 1, **9/10**
- MiniMax-M2.7 (als Anwalt FÜR Option 2 beauftragt) — **kippte selbst auf Option 1**, **8/10**

**Einstimmig.** Vorbild: Tailscale, IPFS/Filecoin (libp2p), WireGuard (Public-Key = Identität), Syncthing (Device-ID aus Keypair), SPIFFE-SVID (kurzlebiges Credential bindet Key an Workload-Identität).

## Korrektur einer Konsens-Annahme (maßgebliche Root-Cause-Fassung)

Die ursprüngliche Konsens-Hypothese „der 403 stammt vom einseitigen Trust-Bundle" (gpt-5.5 + MiniMax in
Lauf A, sowie Christians Erst-Annahme) ist durch die TH01-Code-Analyse **widerlegt**. **Beweis:** es ist
ein **HTTP-403, kein TLS-Fehler** → der mTLS-Handshake lief durch → fehlendes CA-Trust war NICHT die
Ursache. Der 403 ist **App-Layer**: `agent-card.ts:210-212` „Unknown sender" (Peer kann
`getPeerPublicKey(envelope.sender)` nicht auflösen). Das ist die maßgebliche Root-Cause-Fassung; die
Trust-Bundle-Vermutung ist für diesen 403 erledigt. (Das ist genau die Art Korrektur, für die der
Code-Zugriff da ist — am Code gesehen statt vermutet.)

## Zwei getrennte Baustellen (Option 1 löst sie NICHT allein)

1. **Der 403 ist `'Unknown sender'` (Peer-Public-Key-Resolution), NICHT Trust-Bundle — am Code bestätigt 2026-06-03.** Quelle: `agent-card.ts:210-212` — der empfangende Peer löst über `getPeerPublicKey(envelope.sender)` den ECDSA-Signatur-Key des Absenders auf; findet er keinen → 403. **Beweis es ist KEINE CA-Sache:** der 403 ist eine HTTP-Antwort, d.h. der mTLS-Handshake war erfolgreich (fehlendes CA-Trust ergäbe einen TLS-Fehler, keinen 403) → die Peers trusten TH01s Cert auf Transport-Ebene bereits. Der Lookup schlägt fehl wegen (a) **Identitäts-Drift** (TH01 signiert mit `host/cf00a5…`, registriert ist evtl. eine andere URI / noch keine) und (b) **Timing** (Announce ~ms nach Discovery, evtl. bevor der Peer TH01s Agent-Card-Key registriert hat). **Konsequenz:** Option 1 entfernt (a); zusätzlich nötig ist, dass `getPeerPublicKey` aus verifizierten Agent-Cards **auf die kanonische PeerID gekeyed** gespeist wird und `SKILL_ANNOUNCE` bei `Unknown sender` einmal retryt. Geänderte `.94`-Gegenprobe: prüfen, ob auf einem Peer `getPeerPublicKey('spiffe://thinklocal/host/cf00a5bab06832c1/agent/claude-code')` einen Key liefert (Erwartung: nein) — nicht „ist TH01s CA getrustet?". *(Damit lagen gpt-5.5/MiniMax mit „separate Baustelle" richtig, aber in der falschen Schicht — Peer-Key-Store statt CA-Bundle; gemini lag richtig, dass CA-Trust nicht der Blocker ist.)*
2. **Revocation:** Kein zentrales CRL in einem P2P-Mesh → **libp2p-Connection-Gating + leichtgewichtige Denylist** (über den bestehenden Gossip-Kanal verteilt).

## Top-Risiko

**Key-Lifecycle = Identity-Lifecycle.** Wenn der Key die Identität IST:
- **Backup** des Keys ist Backup der Identität.
- **Duplikat-Erkennung Pflicht:** VM/Pi-Golden-Image-Cloning dupliziert den Key → zwei Nodes mit identischer PeerID → libp2p-Routing-Thrash + Automerge-Konflikte. Mitigation: First-Boot-Sentinel / `machine-id`-Baseline neben dem Key → Key neu generieren, wenn Sentinel fehlt oder Umgebung wechselte. **Launch-Blocker, kein Nice-to-have.**
- **Rotation = neue PeerID = aus Mesh-Sicht eine NEUE Node.** Für stateless Agenten akzeptabel; eine logische `NodeID`-Schicht (Key-Historie, Rotation ≠ neuer Node) erst nötig, wenn Nodes langlebigen CRDT-State/Reputation akkumulieren. **Registry-/SPIFFE-Pfad-Schema offenhalten**, damit eine NodeID später ohne Bruch dazukommen kann.

## Verworfene Alternativen

| Option | Begründung der Ablehnung |
|--------|--------------------------|
| **Hostname-/Hardware-abgeleitete Identität (Status quo)** | Volatil über die gesamte Deployment-Matrix; Ursache des ADR-022-Bugs. |
| **Volles SPIFFE/SPIRE mit Node-Attestation** | Over-engineered für ein LAN-Mesh; SPIRE-Server + Node-Agent pro Host + OIDC-Föderation lösen das Kernproblem (drei parallele Identifier) nicht. |
| **Hardware-rooted Identität (TPM/Secure Enclave) als Baseline** | Nicht uniform verfügbar (Pi-Modelle ohne TPM, VMs brauchen vTPM-Passthrough). Sinnvoll nur als optionale Verbesserung auf unterstützter Hardware. |
| **Hybrid mit logischer NodeID SOFORT** | Mehraufwand ohne aktuellen Nutzen, solange Agenten stateless sind. Wird zur Option, sobald langlebiger CRDT-State entsteht — Schema wird dafür offengehalten. |

## Migrations-Pfad (~1 Tag, sobald die CA-Seite steht)

1. Ed25519-Key (existiert bereits persistiert) → **CSR mit PeerID-SAN** (`spiffe://thinklocal/node/<PeerID>`).
2. **Mesh-CA signiert** den CSR → Cert ersetzen.
3. **Alle authz-Checks auf PeerID umstellen** (weg von hostname/stable-node-id).
4. **Startup-Assertion** einbauen, die LAUT fehlschlägt, wenn PeerID / Cert-SAN / authz-Identität divergieren.
5. **Dual-Accept-Fenster** beim Cutover: Peers akzeptieren während der Migration **beide** SAN-Formen (alt: `host/<id>`, neu: `node/<PeerID>`), damit das laufende 5-Node-Mesh nicht bricht.

*Umsetzungs-Prompt folgt separat. Diese ADR ist die Design-Doku VOR dem Code (CLAUDE.md-Reihenfolge).*

## Offene Punkte

- [x] **Voraussetzung #0 — libp2p-Key-Persistenz** — ✅ ERLEDIGT (Commit `8718f0b`, `libp2p-identity.ts`): Ed25519-Key persistiert, PeerID über Neustarts STABIL (Akzeptanztest). Die Identitätswurzel ist damit verfügbar.
- [ ] **403-Root-Cause empirisch bestätigen** via `.94`-Gegenprobe (Trust-Bundle vs. Drift).
- [ ] Bidirektionale Trust-Bundle-Propagation als eigener Schritt (Baustelle 1).
- [ ] SAN-Detailfrage: behält der Pfad einen `/agent/<type>`-Suffix, oder reicht `/node/<PeerID>` (PeerID ist per-Daemon eindeutig)? Im Umsetzungs-Prompt klären.
- [ ] Clone-Detection-Mechanik (Sentinel vs. machine-id-Baseline) festlegen.
- [ ] Denylist-Format + Gossip-Verteilung für Revocation spezifizieren.

## Referenzen

- `pal:consensus` Lauf A (4 Modelle, TH01) + Lauf B (3 Modelle, Orchestrator, `f5715d3c-6cea-456f-8c93-4829b7497d69`), beide 2026-06-03.
- Vorbilder: Tailscale (node key), IPFS/Filecoin (libp2p PeerID), WireGuard, Syncthing, SPIFFE-SVID.
- Auslöser: TH01 SKILL_ANNOUNCE 403 (Live-Befund 2026-06-03 beim TH01-Mesh-Join).
