# changes/2026-07-19 — docs(adr): ADR-045 CA-Zweistufen-Hierarchie (Draft/Proposed)

**Typ:** Doc-only (Architektur-Entscheidung, Draft). **Kein** Code/Runtime-Change, **keine** Skripte, **kein**
Deploy/Secret/Cross-Host-Schritt.

## Warum
Die TL-14a-Kette (Scoping → Decision-Checklist → Consensus-Brief → `pal:consensus`-Ergebnis → A/B-Grounding)
hat alle Bausteine geliefert, um die CA-Zweistufen-Hierarchie **als ADR** festzuhalten — der reguläre nächste
Schritt VOR Runbook-Volltext + Zeremonie-Skripten (CLAUDE.md Schritt 3, Design-Doku vor Code).

## Was
- **Neu `docs/architecture/ADR-045-ca-two-stage-hierarchy.md`** (Status **Proposed**):
  - **Zielhierarchie:** Offline-Root (pathLen 0) → Intermediate TH01 → kalte Geschwister-Reserve TH02.
  - **Entscheidet konsens-getragen:** D1 Trust-Domain **entkoppeln**, D2 **`pathLen 0`**, D4 **Doppel-Pin-
    Cutover**, D5 **Token-Re-Onboard je Node**, D6 **TH02 kalt** — jeweils mit Auflagen (D1 terminierte
    Folge-CO, D4 Alt-Pin nach Node-Proof entfernen, D6 Reserve trocken proben).
  - **Parkt D3** (Intermediate-Laufzeit) als **einzige offene Owner-Entscheidung**: Korridor **1–3 J** (beide
    Modelle verwerfen ≥5 J; opus 12–24 Mon., sonnet 3 J) → ADR bleibt `Proposed` bis Christians Sign-off.
  - **Verankert die zwingenden Vorbedingungen** (aus dem A/B-Grounding, code-belegt): **A** Chain/pathLen-
    Enforcement (App-`verifyPeerCert` flach → D2 sonst kosmetisch) + Charakterisierungs-Test; **B**
    Intermediate-Expiry-Monitoring (fehlt → Vorbedingung für D3) — beide als **blockierende** Code-Folge-Slices.
  - **Verworfene Alternativen** (gekoppelter Domain-Flip, `pathLen 1`, Cross-Sign, Chain-Swap, heißes TH02,
    ≥5 J) + Konsequenzen + Nächste Schritte.
- **`TODO.md`:** ADR-045-Draft-Sub eingetragen; Sign-off auf „exakte D3-Laufzeit setzen → Accepted"
  präzisiert; Vorbedingungs-Slices A/B als eigene offene Code-Slices.

## Abgrenzung
Die ADR **entscheidet** D1/D2/D4/D5/D6 (konsens-getragen) und **parkt** D3 (Owner). Sie **setzt nichts um**:
Vorbedingungen A/B sind benannte Code-Folge-Slices, der Umzug bleibt **TL-14b** (⛔ termin-/Christian-gated).
**Kein** Code/Config/Skript, kein Deploy/Secret/Cross-Host.

## Compliance
- **CO ✅:** stützt sich auf den `pal:consensus`-Lauf 2026-07-19 (opus 8/10 + sonnet 7/10, `TL-14a-consensus-
  result-D1-D6.md`); keine neue Design-Frage offen außer der bewusst geparkten Owner-Entscheidung D3 → kein
  neuer CO-Lauf nötig.
- **CG/TS:** entfallen — kein Code.
- **CR:** Claude-Review-Subagent (Doc-Accuracy) vor Merge — Anker/Konsens-Treue gegen die Quell-Docs + Code.
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die ADR.
