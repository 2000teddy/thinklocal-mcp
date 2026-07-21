# TL-14a — CA-Zweistufen-Umzug: Cross-Vendor-Consensus-Nachlauf & Decision-Handoff

**KW30 · 2026-07-21 · doc-only, repo-lokal.** Folge-Artefakt zu
`TL-14a-consensus-result-D1-D6.md` (dessen „Nächste Schritte" #1: *„(optional, wenn Infra geheilt)
`pal:consensus` mit `codex` + `agy` erneut für einen Cross-Vendor-Pass"*). Dieses Dokument protokolliert
den **tatsächlichen Re-Versuch** dieses Cross-Vendor-Passes und konsolidiert den entscheidungsreifen Stand
als Handoff für das Christian-Sign-off. **Trifft keine verbindliche Entscheidung.**

## 1. Cross-Vendor-Re-Versuch — Ergebnis (Ehrlichkeit zuerst)
- **Ausgeführt:** `pal:consensus` mit Roster `gpt-5.5` (codex-CLI) + `gemini-pro` (agy-CLI), neutral, mit
  den fünf TL-14a-Grounding-Docs als `relevant_files`.
- **Beide Modelle Provider-Fehler — identisch zum 2026-07-19-Lauf:**
  - `gpt-5.5` → *„executable 'codex' not found in PATH"*
  - `gemini-pro` → *„executable 'agy' not found in PATH"*
- **Verifiziert:** `command -v codex/agy/gemini/clink` → alle **NOT in PATH** (2026-07-21). `pal:listmodels`
  listet die Subscription-CLIs zwar als „configured ✅", aber die Binaries fehlen im PATH des pal-Server-
  Prozesses → Konsultation schlägt zur Laufzeit fehl. Deckt sich mit `[[pal-review-backend-agy-missing]]`.
- **Netto:** Der Cross-Vendor-Pass bleibt **infra-blockiert (unverändert)**. Es liegt **kein**
  Konsens-*Fehlschlag* vor — die verfügbare Evidenz (Same-Vendor-Claude-Panel) ist **konvergent (5/6)**;
  blockiert ist nur die *zusätzliche* GPT/Gemini-Perspektive, und zwar durch fehlende CLIs, nicht durch
  inhaltliche Divergenz. → **Kein Christian-Ping aus diesem Grund** (der Owner-Gate bleibt inhaltlich, s. §3).

## 2. Konsolidierter Entscheidungsstand (Evidenz, die es GIBT)
Aus `TL-14a-consensus-result-D1-D6.md` (claude-opus 8/10 + claude-sonnet 7/10) + Checkliste + Scoping:

| ID | Empfehlung | Modell-Votum (Claude-Panel) | Status |
|----|------------|-----------------------------|--------|
| **D1** Trust-Domain **entkoppeln** | (b) | ✅ einstimmig (stark) | **beschlussreif** (Owner-Gate: Fenster) |
| **D2** Root **`pathLen 0`** | (a) | ✅ einstimmig — *Vorbehalt A* | **beschlussreif**, aber Enforcement = Auflage A |
| **D3** Intermediate-Laufzeit | (b) ≥5 J | ⚠️ **Divergenz**: beide verwerfen ≥5 J (opus 12–24 Mon., sonnet 3 J) → Korridor **~1–3 J** | **OWNER-ENTSCHEIDUNG offen** |
| **D4** **Doppel-Pin-Cutover** | (b) | ✅ einstimmig | **beschlussreif** (Owner-Gate: Fenster) |
| **D5** **Token-Re-Onboard** | (a) | ✅ einstimmig (stark) | **beschlussreif** (Owner-Gate: TL-14b-Durchführung) |
| **D6** TH02 **kalt** | (b) | ✅ einstimmig | **beschlussreif** (Owner-Gate: HA-Runbook) |

**5/6 modellbestätigt.** Einzige inhaltliche Offenstelle: **D3-Zahl** — und die ist **von Natur aus eine
Owner-Entscheidung** (Zeremonie-Frequenz vs. Kompromittierungs-Fenster im Solo-Betrieb), kein durch mehr
Modelle auflösbarer Dissens.

## 3. Querschnitts-Auflagen A/B/C (Claude-Panel: **blockierend, nicht optional**)
- **A — Enforcement-Blocker (höchste Prio, VOR ADR):** `verifyPeerCert` (`tls.ts:729`) ist heute flacher
  Ein-CA-Verify + Multi-Fingerprint-Pin, **ohne** Chain-Building/`pathLen`-Durchsetzung → D2 ist ohne einen
  Code-Slice **kosmetisch**. Eigener Code-Slice + Explizit-Test „Intermediate stellt keine Sub-CA aus".
- **B — Intermediate-Expiry-Monitoring fehlt:** Monitor erfasst nur Leafs → langes Intermediate läuft
  lautlos ab. **Vorbedingung für D3s Laufzeit.** (Teil-Vorarbeit: `getCertDaysLeft`/CA-Expiry-Monitor
  aus #297–#299 gelandet; Intermediate-Pfad noch offen.)
- **C — keine Revocation:** Vorschlag = **gepinnte Denylist** kompromittierter Fingerprints beim
  Connection-Setup (proportional zu ~10 Nodes), **kein** volles CRL/OCSP. Als offener Punkt in die ADR.

## 4. Handoff — was als Nächstes tatsächlich dran ist (und wer)
1. **Owner (Christian):** D3-Laufzeit im Korridor **1–3 J** setzen (Empfehlung des Panels: 3 J wegen
   Rushed-Ceremony-Risiko im Solo-Betrieb) + die gate-behafteten D1/D4/D5/D6 freigeben; A/B/C als bekannt
   quittieren. → flippt `ADR-045` von **Proposed** auf **Accepted**. *(Owner-gated — kein Agent-Schritt.)*
2. **Code-Slices (repo, non-gated, eigene PRs):** Auflage **A** (chain-fähiger `verifyPeerCert` +
   pathLen-Enforcement + Test) und **B** (Intermediate-Expiry im Monitor). Beide sind additive Code-Slices,
   **vor** der ADR-Finalisierung fällig — die einzigen agent-ausführbaren Bausteine dieser Lane.
3. **Cross-Vendor-Pass:** bleibt **optional/deferred**, bis `codex`+`agy` im PATH des pal-Prozesses sind.
   Wiederholbar über den Consensus-Brief `TL-14a-consensus-brief-D1-D6.md`, unverändert. **Nicht** kritisch:
   die 5/6-Konvergenz steht bereits, D3 ist ohnehin Owner-Sache.
4. **Danach:** ADR-045 → **Accepted**, dann Runbook-Volltext + Zeremonie-Skripte (Papier, non-gated), dann
   TL-14b (⛔ gated).

## 5. Abgrenzung
Doc/Design only. **Keine** verbindliche Entscheidung; protokolliert einen erneut infra-blockierten
Cross-Vendor-`pal:consensus`-Versuch + konsolidiert den vorhandenen 5/6-Stand als Sign-off-Handoff.
**Kein** Code/Config/Skript, kein Deploy/Secret/Cross-Host, keine Christian-Eskalation (Owner-Gate inhaltlich
unverändert, nicht durch diesen Lauf ausgelöst).
