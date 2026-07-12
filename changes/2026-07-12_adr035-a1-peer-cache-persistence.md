# changes/2026-07-12 — feat(discovery): ADR-035 A1 Peer-Cache-Persistenz (Locator-only, TL-26)

**Typ:** Daemon-Code (`peer-cache.ts` neu, `mesh.ts`, `config.ts`, `index.ts`, `atomic-write.ts`) +
Tests + Config + Design-Doku (CO-Brief) + TODO.
**Slice:** ADR-035 A1 / TODO TL-26. Folge auf A4a (#258).
**CO:** `pal:consensus` 2026-07-12, **einstimmig Option A (Locator-only)** — s.
`docs/architecture/ADR-035-A1-peer-cache-CO-brief.md` §6.

## Warum
Root-Cause-Ebene 1 aus ADR-035: `MeshManager` hält Peer-/AUTHN-Auflösung rein In-Memory →
Restart = Amnesie → Neustart-Wellen enden stundenlang in „Unknown sender" 403. A1 persistiert die
*Wiederfindbarkeit* gelernter Peers, damit sie einen Restart überleben.

## CO-Entscheidung (bindend)
**Locator-only.** Persistiert wird NUR `{peerId, spiffeUri, endpoint, certFingerprint, lastSeen}` —
**NIEMALS der `publicKey`**. Damit kann die Platte KEINE AUTHN-Key-Attribution liefern (die
A4b-Fehlerklasse ist strukturell ausgeschlossen, nicht per Gate). Die Key-Bindung wird nach dem
Boot frisch über live mTLS neu aufgebaut (A2/TL-27). Weitere bindende Punkte: `certFingerprint` =
HINT/log-on-change (NIE Accept-Gate); TTL **14 Tage**; Cap **512 LRU**.

## Was (additiv, rückwärtskompatibel, verhaltens-inert)
- **`peer-cache.ts` (neu, rein):** `PeerCacheLocator` (kein publicKey), `serializeCache` (schreibt
  explizit nur die 5 Felder — strukturelle Locator-only-Garantie), `parseCache` (fail-closed:
  JSON-/Schema-Bruch → `[]`; verwirft abgelaufene [>14d], Zukunfts-Timestamps [>now+60s], nicht-
  kanonische URIs, peerId≠aus-URI, ungültige endpoint/fingerprint; dedupt nach peerId [neuestes
  `lastSeen`]; erzwingt LRU-Cap). `nowMs` injiziert → deterministisch.
- **`mesh.ts`:** `exportSeenLocators()` (Snapshot der AUTHN-only-Map OHNE publicKey),
  `setBootReLearnTargets()`/`getBootReLearnTargets()` (reine Zielliste für A2). `authenticatedSeen`
  bleibt AUTHN-isoliert (Architektur-Invarianten-Test um den legitimen Reader `exportSeenLocators`
  erweitert).
- **`index.ts`:** Boot-Load (`parseCache`, fail-closed) → `mesh.setBootReLearnTargets` (inert bis A2);
  periodischer Flush (5 min, unref't) + Shutdown-Flush; atomarer `chmod 600`-Write nach
  `data_dir/mesh/peer-cache.json`.
- **`atomic-write.ts`:** optionaler `{ mode }`-Param (Temp-File wird mit dem Mode erzeugt →
  window-freier `chmod 600`, kein kurzzeitig world-readable File). Rückwärtskompatibel.
- **`config.ts` + `daemon.toml`:** `discovery.peer_cache_enabled` (Default true, Env
  `TLMCP_PEER_CACHE_ENABLED=0` → aus).

## CR-Fixes (claude-Subagent, adversarial — Verdikt CHANGES-NEEDED→behoben; kein HIGH)
Alle 6 Invarianten verifiziert. Behoben:
- **MEDIUM (CO §6.3):** der Flush schrieb nur `exportSeenLocators()` (live) → geladene Boot-Ziele
  offline-Peers wurden bei jedem Flush überschrieben, 14d-Durability nichtig. Fix: neuer reiner
  `mergeLocators(live, loaded)` (Union nach peerId, Live gewinnt) im Flush; TTL/LRU pruned beim
  nächsten Load. **Damit ist genau der bindende CO-Merge-Punkt erfüllt.**
- **LOW:** Endpoint-Regex ließ `:99999` (>65535) durch (A2-Dial-Kandidat) → Port-Range 1–65535
  strikt validiert.
- LOW (dir-Mode 0o755) als akzeptabel bestätigt (Datei ist 0o600).

## Tests / Verifikation
- `peer-cache.test.ts` **+19**: Roundtrip; **SECURITY: serializeCache schreibt nie einen publicKey**;
  fail-closed (JSON/Schema/entries-kein-Array); TTL-Ablauf + Grenze; Zukunfts-Timestamp; nicht-
  kanonische URI; peerId-Mismatch; ungültige endpoint/fingerprint; **Port>65535/=0 verworfen**;
  Dedup-neuestes; LRU-Cap; **`mergeLocators`: Union/Kollision-Live-gewinnt/leere-live/Roundtrip**.
- `mesh.test.ts` **+3**: `exportSeenLocators` ohne publicKey; leere Map → []; Boot-Ziele hinterlegt
  aber **inert** (kein Auflösungspfad).
- `config-mdns-pin.test.ts` **+3**: Default true / Env 0 / Env 1.
- **1534 gesamt grün**, `tsc --noEmit` sauber, keine neuen ESLint-Errors (Produktivcode 0; Test-`!`
  vermieden).

## Abgrenzung / nächster Schritt
A1 allein behebt den Outage NICHT (nur Schreiben/Laden; kein Auflösungspfad). **A2/TL-27
(Boot-Re-Learn) muss unmittelbar folgen** (CO-Auflage), inkl. der A2-Invarianten (INV-A2-1:
Re-Learn revalidiert IMMER die volle Issuer-Chain, nie Shortcut über den gecachten fingerprint;
INV-A2-2: Re-Learn-Endpoints auf Discovery-Subnetz beschränken + Timeout/Rate-Limit). Kein Deploy.
Cross-Vendor-CO-Lücke (codex/agy nicht im PATH) im CO-Brief §6 notiert.

## Status
Offen (PR gegen main).
