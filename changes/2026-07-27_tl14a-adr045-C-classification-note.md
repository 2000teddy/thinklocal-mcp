# changes/2026-07-27 — docs(tl14a): ADR-045-Klassifikations-Hinweis zu Auflage C (Consensus vs. §100)

**Typ:** **Doc-only** (kein Code/Test/Design-Beschluss). Kein Deploy/Secret/Host. **Trifft keine
C-Entscheidung, nimmt kein Gate vorweg** — macht eine bestehende ADR-interne Inkonsistenz ehrlich sichtbar.

## Die Lücke (sauberer Befund, keine neue Phase)
Die #341-C-Grounding-Note deckte einen Widerspruch auf: der Consensus (`TL-14a-consensus-result-D1-D6.md` §C)
stuft **A–C alle drei blockierend** ein, aber **ADR-045** führt nur **A/B** unter §74 „Zwingende
Vorbedingungen (blockierend)" und behandelt **C** in §100 als **„Offen (out of scope)"** — eine stille
Herabstufung. Bislang stand dieser Widerspruch **nur** in der externen Grounding-Note; die ADR selbst
schwieg dazu.

## Was
Neuer **Klassifikations-Hinweis in ADR-045 §100** (unter der Revocation-`out of scope`-Zeile): benennt, dass
der Consensus C blockierend einstufte, diese ADR es als out-of-scope/Fast-Follow behandelt, und dass diese
Herabstufung eine **bewusste, aber noch nicht owner-ratifizierte** Abweichung ist. Ob C ein TL-14b-**Blocker**
oder Fast-Follow ist, ist damit der **eine offene C-Punkt** (CO/Owner) — Ist-Zustand (`crl.ts` = bereits
gebaute, aber 0-Aufrufer-Fingerprint-Denylist) gegroundet in `TL-14a-blocker-C-grounding.md` §2. **Der Hinweis
entscheidet nichts** — er macht die Abweichung in der ADR sichtbar statt still (Plan-KW31 §116: „sauberer
nächster Befund statt diffuser Restwärme").

## Warum jetzt (gate-frei, ohne Owner-Fantasie, ohne Codex)
Die gate-freie TL-14a-Vorbedingungs-Lane (A/B/C) ist code-seitig abgetragen (#341/#342/#344 + #297/#298/#299/
#311). Der einzige verbleibende gate-freie Schritt ist **Doku-Ehrlichkeit**: die ADR mit dem Consensus-Wortlaut
in Deckung bringen, **ohne** die C-Entscheidung (D3/Owner) vorwegzunehmen. WOCHENPLAN-KW31 Z. 113–120: TL-14 =
wichtigster Folgepunkt, „keine neue Phase herbeiphantasieren".

## Compliance
- **CO/CG/TS:** entfallen — Doc-only, kein Code/Test-Diff; `clink`/`gemini` nicht im PATH. Suite unverändert
  **2101 grün** (kein `.ts`-Diff).
- **CR:** Review-of-Record über **claude/agy** (nie Codex/MiniMax/pal:chat) + Self-CR.
- **PC:** Secret-Scan clean (nur Doku).
- **DO ✅:** dieser Eintrag, `ADR-045-ca-two-stage-hierarchy.md` §100, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** die C-Entscheidung selbst (Denylist-Form / `crl.ts` verdrahten / C-Blocking-Status),
D3-Sign-off/ADR-045-Status/Runbook/TL-14b. **Nicht berührt:** ADR-046 §9, msg 1453, TL-08/09/10-Gates.
