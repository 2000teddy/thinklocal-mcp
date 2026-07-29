# changes/2026-07-29 — docs(tl14a): G1-Entscheidungs-Brief für Christian

**Typ:** Doc-only Owner-Decision-Brief. **Kein Beschluss, kein Gate verschoben, kein Code/Test/Config-Diff.**
Kein Deploy/Secret/Cross-Host. Risiko-Delta **null**.

## Was
- **Neu:** `docs/architecture/TL-14a-G1-decision-brief.md` — konsolidiert die einzige offene Owner-Entscheidung
  (Gate **G1**), die ADR-045 auf `Proposed` hält, an einem entscheidungsreifen Ort:
  - **D3 Intermediate-CA-Laufzeit** — exakte Zahl im Konsens-Korridor **1–3 Jahre** setzen (opus ~12–24 Mon.,
    sonnet 3 J; beide verwerfen ≥5 J). Zwei Achsen: Zeremonie-Frequenz/-Sorgfalt vs. Kompromittierungs-Fenster.
  - **Mit-zu-bestätigen** (Konsens einstimmig 5/6, Owner-Gate-Charakter): D1 (Trust-Domain entkoppeln),
    D4 (Doppel-Pin-Cutover), D5 (Token-Re-Onboard), D6 (TH02 kalt); D2 (`pathLen 0`) = CO/technisch.
  - **Fill-in-Sign-off-Block** + Hinweis: nach Ausfüllen ADR-045 §Status → `Accepted`.
- **Hygiene:** `docs/architecture/TL-14a-decision-checklist.md` — die veraltete D3-Empfehlung „≥ 5 Jahre"
  (2026-07-19, vor dem Consensus) als **überholt** markiert + Supersession-Hinweis; D3-Status ⬜→🟨.
- **DO:** `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser `changes/`-Eintrag, `TODO.md` (G1-Brief-Zeiger).

## Warum gate-frei / kein Fortschritt
Der Brief **entscheidet nichts** — er packt eine bereits repo-gegroundete Owner-Entscheidung so, dass sie fällbar
ist. TL-14 bleibt vollständig gated bis zum Christian-Sign-off; selbst danach bleibt die Code-Lane an **G2**
(Revocation-Klassifikation → `crl.ts`-Verdrahtung) und **G4** (TL-14b-Durchführung, ⛔) gated. Präzedenz doc-only:
#345/#346/#347/#349 (Decision-Register/Gate-Status derselben Familie).

## Grounding (alles repo-lokal, nichts neu erfunden)
`ADR-045-ca-two-stage-hierarchy.md` §D3/§130, `TL-14a-consensus-result-D1-D6.md` §D3, `TL-14a-decision-checklist.md`,
`TL-14a-gate-status.md`.

## Compliance
- **CO:** entfällt — **kein** neuer Beschluss/Architektur-Entwurf (konsolidiert bestehenden Consensus für den
  Owner); `codex`/`agy` nicht im PATH (kein Cross-Vendor-Pass möglich, s. G3).
- **CG:** entfällt — kein Code/Test/Type-Ableitung; `clink`/`gemini` nicht im PATH.
- **TS:** kein `.ts`-Diff, Suite unverändert **2101 grün**.
- **CR:** Review-of-Record über **claude** (Self-CR; `agy`/`codex` nicht im PATH) — Faktentreue gegen ADR-045 +
  Consensus-Protokoll geprüft, Gating explizit, keine Entscheidung getroffen.
- **PC:** Secret-Scan clean (nur Doku).

## Nicht berührt
ADR-046 §9, msg 1453, alle offenen Gates (TL-08/09/10, G2/C, G3, G4/TL-14b). Kein Deploy/Secret/State.
