# CO-Decision-Brief — ADR-035 A1 / TL-26: `authenticatedSeen`-Persistenz & Restart-Semantik

- **Status:** ✅ **CO abgeschlossen 2026-07-12** (`pal:consensus`, einstimmig **Option A**). Entblockt für A1-Code.
- **Datum:** 2026-07-12
- **Bezug:** ADR-035 (A1), ADR-026 (symmetrische AUTHN-only-Discovery), ADR-001 (Approval-Gates),
  PR #258 / A4b (Codex-Befund: self-asserted Card-`publicKey` ist ein AUTHN-Attributions-Risiko).
- **Ziel:** Neustart-Wellen heilen (`.55` „Unknown sender") — die AUTHN-Auflösung eines Peers muss
  einen Daemon-Restart überleben, **ohne** eine neue Vertrauensquelle „Platte" zu schaffen.

## 1. Frozen Invarianten (nicht Teil des Konsenses — Rahmen)

Diese gelten unabhängig vom gewählten Modell und dürfen durch A1 NICHT aufgeweicht werden:

- **I1 — AUTHN ≠ AUTHZ.** Der Cache betrifft ausschließlich `resolvePeerPublicKey`
  (Signaturprüfung). `isApprovedPeerSender` / Registry-Sync / Skill-Exec / Heartbeat lesen ihn
  **nie**. State bleibt konstant `authenticated_unapproved`. Approval bleibt in `paired-peers.json`
  (ADR-001), wird von A1 **nicht** angefasst.
- **I2 — Kein Trust-Upgrade durch Persistenz.** Ein geladener Eintrag ist höchstens so
  vertrauenswürdig wie ein frisch gelernter — nie mehr.
- **I3 — Datei-Härtung.** `data_dir/mesh/peer-cache.json`, atomarer Write (bestehendes
  `atomic-write.ts`), `chmod 600`. Threat-Model der Datei = lokaler Datei-Schreibzugriff.
- **I4 — Fail-closed.** Jede Unstimmigkeit (Parse-Fehler, Schema-Mismatch, abgelaufen, Cert-
  Mismatch bei Re-Verify) → Eintrag **verwerfen**, nie „best effort" durchwinken.

## 2. Ist-Zustand (code-verifiziert)

`MeshManager.authenticatedSeen: Map<peerId, AuthenticatedSeenEntry>` (mesh.ts:90).
Eintrag = `{peerId, publicKey(PEM), spiffeUri(node/<PeerID>), certFingerprint, endpoint, lastSeen,
state:'authenticated_unapproved'}`. Guardrails: `AUTH_SEEN_TTL_MS = 15 min`, `AUTH_SEEN_MAX = 256`.
Gelernt wird **nur** über eine authentifizierte, issuer-gepinnte mTLS-Inbound-Verbindung
(`inbound-peer-learner.ts`): der `certFingerprint` bindet den `publicKey` an **die Live-Verbindung**,
die die attestierte PeerID bewiesen hat. Gelesen wird **nur** von `resolvePeerPublicKey`, und dort
**nur** als Fallback bei `matches.length === 0` (kein verifizierter `peers`-Treffer), strikt:
`peerId == wantPeerId` ∧ `spiffeUri == senderUri` ∧ nicht abgelaufen.

**Kernproblem für A1:** Nach dem Restart ist genau die Live-Bindung (die mTLS-Verbindung mit dem
`certFingerprint`) weg. Rohes Zurückladen von `publicKey → PeerID` von der Platte macht die Platte
zur AUTHN-Quelle — **dieselbe Fehlerklasse, die Codex in A4b gefunden hat**, nur mit Quelle „Datei"
statt „Discovery-Host-Daten".

## 3. Konsensfragen (das eigentliche CO)

### Frage 1 (KERN) — Was wird persistiert, und darf `resolvePeerPublicKey` es direkt bedienen?

- **Option A — Locator-only-Cache (empfohlen).** Persistiere **nur** `{peerId, spiffeUri, endpoint,
  certFingerprint, lastSeen}` — **NICHT** den `publicKey`. Beim Boot füllt der Cache **nicht** die
  `authenticatedSeen`-Map, sondern nur eine *Re-Learn-Zielliste* (Adresse + attestierte PeerID +
  erwarteter `certFingerprint`). Die tatsächliche AUTHN-Bindung entsteht wieder frisch über den
  live mTLS-Fetch (A2). → Platte ist **nie** AUTHN-Quelle; `publicKey` verlässt nie den RAM.
  *Kosten:* die Auflösung ist erst nach dem Boot-Re-Learn (A2) da (Sekunden, ein Card-Fetch), nicht
  „sofort aus der Datei".
- **Option B — Voll-Persistenz + Reverify-before-serve.** Persistiere den ganzen Eintrag inkl.
  `publicKey`, lade in eine `pendingSeen`-Map, aber `resolvePeerPublicKey` bedient ihn **erst**,
  nachdem beim ersten Kontakt das live präsentierte, issuer-gepinnte Cert die PeerID re-attestiert
  **und** der `publicKey`/`certFingerprint` matcht (Mismatch → verwerfen). → sofort „warm", aber
  ein servierbarer Key liegt auf Platte (größere Angriffsfläche, Schlüssel-Rotation-Staleness).
- **Option C — Voll-Persistenz + Integritäts-Signatur.** Wie B, plus die Cache-Datei wird mit dem
  **eigenen Node-Key** signiert/HMACt; Boot verwirft bei Signatur-Mismatch. Schützt gegen Datei-
  Tampering, aber nicht gegen einen bereits vergifteten Eintrag zur Schreibzeit; mehr Komplexität.

**Empfehlung:** **A** (Locator-only). Es macht I2/I4 strukturell wahr (Platte kann keinen Key
attribuieren) und ist der kleinste Code. A1 wird damit „persistiere die *Wiederfindbarkeit*", A2
liefert die frische AUTHN-Bindung.

### Frage 2 — Restart-überlebende TTL vs. In-Memory-Hot-TTL (15 min)

Die In-Memory-`AUTH_SEEN_TTL_MS = 15 min` ist für Wochen-Neustart-Wellen **viel zu kurz**: würde
man sie 1:1 persistieren, wären fast alle Einträge nach einem längeren Downtime sofort abgelaufen →
Cache nutzlos. → Vorschlag: **getrennte, längere Persistenz-TTL** (z.B. **7 Tage**, konfigurierbar)
für die Datei, während die In-Memory-Hot-TTL 15 min bleibt. Frage an CO: 7 Tage sinnvoll? Und harter
Cap für die Datei (Vorschlag ≥ `AUTH_SEEN_MAX`, z.B. 512, LRU nach `lastSeen`)?

### Frage 3 — Re-Verify-Gate beim ersten Kontakt (nur relevant, falls B/C statt A)

Falls B/C: Muss „reverify-before-serve" hart sein (Key wird NIE vor Live-Re-Attest bedient), oder
ist ein „serve mit kurzer Gnaden-TTL, parallel reverify" akzeptabel? Empfehlung bei A: entfällt,
weil kein Key aus der Datei bedient wird.

### Frage 4 — Interaktion mit A2 (Boot-Re-Learn, TL-27)

Bei Option A ist A1 im Grunde nur der *persistente Input* für A2. Konsens-Check: A1 und A2 als **ein**
zusammenhängender Slice bauen (Cache-Datei + Boot-Re-Learn zusammen, sonst liefert A1 allein noch
keine Auflösung) oder strikt getrennt (A1 = nur Datei + Laden in Zielliste, A2 = Probing)? Empfehlung:
**getrennt bauen, aber A1 zuerst mergen** (A1 ohne A2 ist harmlos: nur Schreiben/Laden, kein Verhalten).

## 4. Kleinster Umsetzungs-Slice, falls Konsens = A (Vorschau, nicht Teil des CO)

`peer-cache.ts` (rein/injizierbar): `serializeCache(entries) → JSON`, `loadCache(raw, now, ttl) →
locator[]` (fail-closed Filter: Schema, TTL, kanonische URI). `MeshManager`: `exportSeenLocators()`
(kein publicKey) + periodischer/at-shutdown atomarer Write; beim Boot `loadCache` → Zielliste, die
A2 (TL-27) abarbeitet. Unit-Tests: Roundtrip, abgelaufen→gefiltert, Tamper/Garbage→[], kein
`publicKey` im Output. Kein Deploy, additiv, `mdns`/Approval unberührt.

## 5. Frage an den Konsens (kompakt)

> Für die Neustart-feste AUTHN-Auflösung in einem Zero-Trust-Mesh: Soll der Peer-Cache **(A)** nur
> Locator-Daten (PeerID, Endpoint, certFingerprint, ohne publicKey) persistieren und die AUTHN-
> Bindung beim Boot frisch über live mTLS neu aufbauen, oder **(B/C)** den publicKey mit-persistieren
> und vor der ersten Nutzung gegen das Live-Cert re-verifizieren? Und welche Persistenz-TTL/-Cap sind
> für Wochen-Neustart-Rhythmen angemessen, ohne den Cache nutzlos oder zur Trust-Quelle zu machen?

## 6. CO-Ergebnis (pal:consensus, 2026-07-12) — bindend

**Modelle:** `cli-claude-opus` (against/Skeptiker) + `cli-claude-sonnet` (for). **Einstimmig: Option A.**
⚠️ **Cross-Vendor-Lücke:** GPT-5/Codex + Gemini-Pro liefen diese Runde NICHT (`codex`/`agy`-Binaries
nicht im Session-PATH). CO lief auf den zwei verfügbaren Claude-CLI-Modellen als unabhängiger
adversarialer Pass. Für einen späteren stärkeren Cross-Vendor-CO müsste `pal:consensus` aus einer
Shell mit `codex`/`agy` laufen — als Follow-up notiert, kein Blocker für A1 (Entscheidung ist
strukturell und beide Modelle konvergierten mit hoher Confidence 7–8/10).

**Begründung (beide):** A4b hat gezeigt, dass ein „perfekt implementiertes Reverify-Gate" in diesem
Code keine sichere Wette beim ersten Versuch ist → riskante Daten (Key) gar nicht erst auf Platte
legen schlägt „Gate muss stimmen". A/B sind auf der **Misattributions-Achse gleichwertig** (publicKey
ist öffentlich), also entscheidet die **Fehlermodus-Asymmetrie**: A's Worst-Case bei A2-Bug = „noch
langsam"; B/C's Worst-Case bei Gate-Bug = **echte Key-Attributions-Kompromittierung**.

**Bindende Verschärfungen für die A1/A2-Umsetzung:**
1. **`certFingerprint` = HINT / log-on-change, NIE Accept-Gate beim Re-Learn.** Mit der
   Startup-only/CA-Reissue-Rotation dieses Repos (.56/.222-Clobber) würde ein Fingerprint-Mismatch
   fail-closed → Re-Learn verweigert → **selbst-verschuldeter Outage**. Einziges AUTHN-Kriterium =
   frische issuer-gepinnte PeerID-Attestierung + volle Issuer-Chain-Revalidierung.
2. **TTL 14 Tage (nicht 7)**, `lastSeen` bei **jedem** erfolgreichen Re-Learn auffrischen (aktive
   Peers altern nie aus), Cap **512 LRU** (Cap dominiert die Dateigröße → längere TTL ist gratis).
3. **mDNS-/Discovery-Endpoints mit dem Platten-Locator mergen**, damit ein vergifteter Platten-
   Endpoint zu **erholbarem DoS** degradiert, nicht zum Blackhole.
4. **Phasing:** A1 allein ist **verhaltens-inert** und behebt den Outage NICHT — A1-first-Merge ist
   nur Review-Hygiene (Präzedenz A3/#257, A4a/#258), **nicht** als „heilt Neustart-Wellen"
   labeln. **A2/TL-27 muss unmittelbar folgen (gleicher Sprint), nicht Backlog.**

**A2-Invarianten (in den TL-27-Brief VOR A2-Code — vom Konsens verlangt):**
- **INV-A2-1:** Re-Learn revalidiert IMMER die volle Issuer-Chain + SPIFFE-Grammatik; **niemals**
  Shortcut über den gecachten `certFingerprint` (sonst A4b-Klasse via Platten-Fingerprint).
- **INV-A2-2:** Re-Learn-Endpoints strikt auf das Discovery-Subnetz (`allowed_mesh_cidrs`, LAN
  `10.10.10.0/24`) beschränken + Timeout + Rate-Limit (SSRF-nah: sonst Boot-Probe auf beliebige
  Angreifer-/Loopback-Adresse).

**Bestätigt aus Code:** die `authenticatedSeen`-Fallback bedient Signaturprüfung von
`MessageEnvelope`s, die über Relay/Gossip/Async-Learn ankommen (nicht die eigene Inbound-mTLS des
Signers) → B-hard's Inbound-Reattest würde selten „unlocken" → A ist für diesen Pfad korrekt.

**Nächster Code-Slice (A1, kleinster):** `peer-cache.ts` (rein/injizierbar, kein `publicKey`), 14d-
TTL/512-LRU-Filter, atomarer `chmod 600`-Write (Shutdown + periodisch), Boot-Load in eine
**Zielliste, die A2 konsumiert** — verhaltens-inert, klar als Groundwork gelabelt. Unit-Tests +
CR + PR nach House-Workflow.
