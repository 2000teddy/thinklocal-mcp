# changes/2026-07-21 — docs(arch): TL-14a Cross-Vendor-Consensus-Nachlauf + Decision-Handoff

**Typ:** **Doc-only** (Design/Decision-Register) — führt exakt den in `TL-14a-consensus-result-D1-D6.md`
(„Nächste Schritte" #1) benannten **Cross-Vendor-`pal:consensus`-Re-Versuch** aus und protokolliert das
Ergebnis + einen konsolidierten Sign-off-Handoff. **Keine** verbindliche Entscheidung, **kein**
Code/Config/Skript, kein Deploy/Secret/Cross-Host, **keine** Christian-Eskalation.

## Warum
Der 2026-07-19-Consensus lief nur als Same-Vendor-Claude-Panel (opus+sonnet), weil `codex`/`agy` im PATH
fehlten. Die Checkliste/Result-Note nannte den Cross-Vendor-Pass (GPT+Gemini) als optionalen nächsten
Schritt „wenn Infra geheilt". Dieser PR versucht ihn erneut und hält das Ergebnis ehrlich fest.

## Was
- **`pal:consensus` erneut ausgeführt** — Roster `gpt-5.5`(codex) + `gemini-pro`(agy), neutral, mit den fünf
  TL-14a-Grounding-Docs. **Beide erneut Provider-Fehler:** *„executable 'codex'/'agy' not found in PATH"*
  — identisch zum 2026-07-19-Lauf. Zusätzlich `command -v` verifiziert: codex/agy/gemini/clink alle NOT in
  PATH (2026-07-21). `pal:listmodels` listet die CLIs zwar als „configured", die Binaries fehlen aber im
  pal-Prozess-PATH.
- **Neu:** `docs/architecture/TL-14a-consensus-crossvendor-followup-2026-07-21.md` — protokolliert den
  Re-Versuch, konsolidiert den 5/6-Stand (D1/D2/D4/D5/D6 modellbestätigt; D3 = inhärente Owner-Entscheidung,
  Korridor 1–3 J), die blockierenden Auflagen A/B/C und einen klaren Handoff: Owner setzt D3 + gated
  D1/D4/D5/D6 → ADR-045 Accepted; die **einzigen agent-ausführbaren** Bausteine sind die Code-Slices A
  (chain-fähiger `verifyPeerCert` + pathLen-Enforcement) und B (Intermediate-Expiry-Monitoring); der
  Cross-Vendor-Pass bleibt optional/deferred bis PATH geheilt.
- **`TODO.md`** — neue `[x]`-Zeile unter dem TL-14a-Consensus-Block, die den Re-Versuch + Blocker + Handoff
  festhält.

## Compliance
- **CO:** entfällt — dies **IST** ein (versuchter) CO-Lauf, keine eigenständige Design-Frage; das Ergebnis
  (infra-blockiert) ist protokolliert, nicht entschieden.
- **CG:** entfällt (Doc-only, keine Test-/Type-Ableitung).
- **TS:** entfällt (kein Code/Test-Diff; Doc-only-Ausnahme wie #84/#286).
- **CR:** Self-CR — jede Faktenaussage der Note gegen die Quell-Docs (`TL-14a-consensus-result-D1-D6.md`,
  `-decision-checklist.md`, `-blocker-AB-grounding.md`, `ADR-045`) und die Live-`pal`/`command -v`-Ergebnisse
  gegengeprüft; keine neue Entscheidung erfunden.
- **PC:** Secret-Scan clean (keine Tokens/Keys).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die neue Note.
