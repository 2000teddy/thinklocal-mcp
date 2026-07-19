# TL-14a — CA-Zweistufen-Umzug: Consensus-Ergebnis (D1–D6)

**KW30 · Ergebnis-Protokoll von `pal:consensus` über `TL-14a-consensus-brief-D1-D6.md` · 2026-07-19 ·
repo-lokal, doc-only.**
Dieses Dokument protokolliert den **tatsächlichen** `pal:consensus`-Lauf über die D1–D6-Abstimmungsvorlage.
Es **trifft keine verbindliche Entscheidung** — es hält das Modell-Votum als Input für das anschließende
Christian-Sign-off und die finale ADR (CA-Hierarchie/Offline-Root) fest.

## Lauf-Metadaten (Ehrlichkeit zuerst)
- **Roster geplant:** `gpt-5.5` (codex-CLI), `gemini-pro` (agy-CLI), `claude-opus` + `claude-sonnet`
  (claude-CLI) — je neutral.
- **Tatsächlich konsultierbar:** **`claude-opus` + `claude-sonnet`** (beide claude-CLI). `gpt-5.5` →
  Provider-Fehler *"executable 'codex' not found in PATH"*; `gemini-pro` → *"executable 'agy' not found in
  PATH"* (deckt sich mit `[[pal-review-backend-agy-missing]]`; nur die `claude`-CLI ist verfügbar).
- **Ergebnis-Charakter:** **Same-Vendor-2-Modell-Panel** — claude-opus (**8/10**) + claude-sonnet (**7/10**),
  plus eigene Vor-Analyse. **Kein Cross-Vendor-Pass** (GPT/Gemini nicht konsultiert) — für ein
  Cross-Vendor-Panel muss der Lauf wiederholt werden, sobald `codex`/`agy` im PATH sind. Beide claude-Modelle
  konvergieren stark (s.u.), die einzige echte Divergenz betrifft die **D3-Zahl**.

## Ergebnis je Entscheidung

| ID | Empfehlung (Brief) | claude-opus (8/10) | claude-sonnet (7/10) | Konsolidierte Lage (nicht bindend) |
|----|--------------------|--------------------|----------------------|------------------------------------|
| **D1** Trust-Domain entkoppeln | entkoppeln | ✅ Zustimmung (stark) | ✅ Zustimmung | Halten. Domain-Flip als eigene **terminierte** Folge-CO führen. |
| **D2** `pathLen 0` | `0` | ✅ Zustimmung | ✅ Zustimmung (Vorbehalt A) | Halten — **aber** Enforcement prüfen (Auflage A), sonst kosmetisch. |
| **D3** Intermediate-Laufzeit | ≥ 5 Jahre | ⚠️ 12–24 Monate | ⚠️ **3 Jahre**, gebunden an B | **Beide lehnen ≥5 J ab.** Landing-Zone **~1–3 Jahre**, exakte Zahl = Owner-Entscheidung; Vorbedingung: Auflage B. Root 10–15 J. |
| **D4** Doppel-Pin-Cutover | Doppel-Pin | ✅ Zustimmung | ✅ Zustimmung | Halten — Alt-Pin **nach Node-N-Proof** entfernen; Rollback-Kriterium vorab. |
| **D5** Token-Re-Onboard | Token-Re-Onboard | ✅ Zustimmung (stark) | ✅ Zustimmung (stark) | Halten — je Node mit `[[dod-two-peer-mcp-proof]]` koppeln. |
| **D6** TH02 kalt | kalt | ✅ Zustimmung | ✅ Zustimmung | Halten — Reserve-Aktivierung **mind. einmal trocken proben**. |

**Netto:** **einstimmig 5/6** bestätigt (D1/D2/D4/D5/D6). Einzige Divergenz **D3-Laufzeit**: Brief ≥5 J,
opus 12–24 Monate, sonnet 3 Jahre — **beide Modelle verwerfen ≥5 J**, Konsens-Korridor **~1–3 Jahre**, exakte
Zahl bleibt Owner-Entscheidung. Beide stufen die Auflagen A–C als **blockierend** (nicht optional) ein.

## Querschnittliche Auflagen (beide Modelle einig: **blockierend, nicht optional**)
- **A · Enforcement-Blocker (höchste Priorität, VOR der ADR):** `pathLen 0` (D2) und der Doppel-Pin-Cutover
  (D4) sind nur wirksam, wenn die Peer-Verifikation (`verifyPeerCert`, `tls.ts:729` — heute ein **flacher
  Ein-CA-Verify** ohne Chain-Building) künftig **echtes Chain-Building + pathLen-Enforcement** leistet.
  sonnet-Zusatz: der heutige **Multi-Fingerprint-Pin** matcht
  ggf. direkt gegen bekannte Fingerprints, **statt** die Kette zu validieren → dann ist D2 reine Doku ohne
  Durchsetzung. **Prüf-/ggf. Code-Slice VOR TL-14b.** Explizit-Test: Intermediate darf **keine** Sub-CA
  ausstellen.
- **B · Intermediate-Expiry-Monitoring fehlt:** `cert-expiry-monitor` erfasst heute nur Leafs → langes
  Intermediate läuft lautlos ab (Ausstellungs-Tod). sonnet macht **B zur Vorbedingung für D3s Laufzeit**
  (nicht „später nachrüsten").
- **C · Keine Revocation-Infrastruktur (CRL/OCSP):** ohne Revocation ist die einzige Reaktion auf
  Intermediate-Kompromiss der Doppel-Pin-Cutover selbst → je länger die Laufzeit, desto länger das
  unentdeckte Fenster. sonnet-Vorschlag (proportional zur ~10-Node-Größe): **kein volles CRL/OCSP**, sondern
  eine **gepinnte Denylist kompromittierter Fingerprints**, geprüft beim Connection-Setup. Gehört als
  offener Punkt in die ADR.

**Von beiden empfohlene Reihenfolge:** Auflage **A + B klären → D3-Zahl fixieren → erst dann ADR schreiben**.

## Offene Owner-Entscheidung (für Christian-Sign-off)
- **D3-Laufzeit:** Brief ≥5 J, opus 12–24 Monate, sonnet 3 Jahre — **beide Modelle verwerfen ≥5 J**,
  Korridor **~1–3 Jahre**. Zusätzliche Achse (sonnet): **Rushed-Ceremony-Risiko im Solo-Betrieb** (vgl.
  PR-#83-Lesson im CLAUDE.md) spricht gegen zu kurze Intervalle → daher der 3-Jahres-Kompromiss statt
  12 Monate. **Neue Owner-Entscheidung** (Zeremonie-Frequenz vs. Kompromittierungs-Fenster) → Sign-off,
  nicht von mir gesetzt.
- **D1/D4/D5/D6** tragen bereits Christian-Gate-Charakter (Fenster/Durchführung, TL-14b).

## Nächste Schritte
1. *(optional, wenn Infra geheilt)* `pal:consensus` mit `codex` + `agy` **erneut** für einen Cross-Vendor-Pass.
2. **Auflage A + B klären** (Enforcement-Prüfung + Intermediate-Expiry-Monitoring) — von beiden Modellen VOR
   die ADR gezogen.
3. **Christian-Sign-off** über D1–D6 — insbesondere die **D3-Laufzeit** (Korridor 1–3 J) und die
   Gate-behafteten D1/D4/D5/D6; Auflagen A–C (inkl. Denylist-Idee für C) als bekannt vermerken.
4. **ADR** (CA-Hierarchie/Offline-Root) fixiert die Beschlüsse + Auflagen A–C, **dann** Runbook-Volltext +
   Zeremonie-Skripte.

## Abgrenzung
Doc/Design only. **Keine** verbindliche Entscheidung getroffen; protokolliert ein `pal:consensus`-Ergebnis
(Same-Vendor-2-Modell-Panel; infra-bedingt kein Cross-Vendor-Pass) als Input für Sign-off + ADR. **Kein** Code/Config/Skript, kein
Deploy/Secret/Cross-Host.
