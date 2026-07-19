# changes/2026-07-19 — docs(tl14a): CA-Zweistufen-Umzug Entscheidungs-Checkliste (Change-Order)

**Typ:** Doc-only (Folge-Artefakt zu `TL-14a-ca-two-stage-scoping.md` §5). **Kein** Code/Runtime-Change,
**keine** Skripte, **kein** Deploy/Secret/Cross-Host-Schritt.

## Warum
Die Scoping-Note (PR #288) endet mit **§5: 6 exakt offenen Entscheidungen** als Gate vor Runbook-Volltext +
Zeremonie-Skripten. Diese Liste war beschreibend, aber noch **nicht abstimmbar**: keine Optionen-Gegenüber-
stellung, keine Empfehlung, kein Entscheider/Abhängigkeits-/Blockiert-Feld, kein Sign-off-Anker. Der nächste
natürliche TL-14a-Schritt (repo-lokal, non-gated) ist, §5 in ein **aktionierbares Change-Order-Register** zu
gießen, das eine Folge-CO/ADR direkt abarbeiten kann.

## Was
- **Neu `docs/architecture/TL-14a-decision-checklist.md`:**
  - **Kopf-Übersichtstabelle** (D1–D6 → Empfehlung → Entscheider → blockiert → Status).
  - **Je Entscheidung ein Block:** Frage, Optionen (a/b …), **nicht-bindende** Empfehlung mit Repo-Grounding,
    Abhängigkeit, Entscheider, was sie blockiert.
    - **D1** Trust-Domain-Kopplung → Empf. **entkoppeln** (`[[decision7-trust-domain]]`).
    - **D2** `pathLenConstraint` der Root → Empf. **`0`** (heute kein Intermediate-Begriff, `createMeshCA`
      `tls.ts:59/84`).
    - **D3** Intermediate-Validität → Empf. **langer, eigener Zyklus** (nicht `renew_before_days`
      `config.ts:165/251`; Air-Gap-Zeremonie darf nicht am 30-Tage-Leaf-Rhythmus hängen).
    - **D4** Cross-Sign vs. Cutover → Empf. **Doppel-Pin-Cutover** (`resolveAttestingCaFingerprints`
      `cert-issuer.ts:121`, `ca.crt.legacy.pem` `tls.ts:437`, ADR-024/TL-13).
    - **D5** Chain-Ausroll → Empf. **Token-Re-Onboard** (Chain-Swap-Fallen `[[cert-clobber-on-ca-reissue]]`/
      `[[th02-phase3-flip-blocker]]` ungelöst; `tls.ts:534-537` Verifikationsklausel). **= TL-14b-Kern.**
    - **D6** TH02-Rolle → Empf. **kalt, identische Kette**.
  - **Leere Sign-off-Tabelle** (Beschluss/Datum/Entscheider/ADR-Ref) + Nächster-Schritt-Liste (Folge-CO →
    Sign-off → ADR → Runbook-Volltext → TL-14b).
- **`TODO.md`:** Checklisten-Sub als erledigt; Folge-CO + Runbook-Volltext als offene Slices präzisiert.

## Abgrenzung
Das Artefakt **trifft keine Entscheidung** — es überführt §5 in ein abstimmbares Register mit
Entscheidungshilfe. Beschluss fällt per Folge-CO (`pal:consensus`) + Christian-Sign-off (D1/D4/D5/D6) und
wird in einer künftigen ADR fixiert. **Kein** Runbook-Volltext, **keine** Skripte, kein Code/Config, kein
Deploy/Secret/Cross-Host. Durchführung bleibt **TL-14b** (⛔ gated).

## Compliance
- **CO ⚠️:** konsolidierend/vorbereitend — keine neue Design-Entscheidung getroffen (Empfehlungen explizit
  nicht bindend) → kein neuer CO-Lauf jetzt; der CO über D1–D6 ist der benannte nächste Schritt.
- **CG/TS:** entfallen — kein Code, keine Skripte.
- **CR:** Doc-Accuracy self — jedes Code-Zitat/Anker per `grep`/`sed` gegen die Quelle verifiziert
  (`tls.ts:59/84/108/174/437/534-537`, `cert-issuer.ts:121`, `config.ts:165/251`).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die Checkliste.
