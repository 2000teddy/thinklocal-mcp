# changes/2026-08-26 — docs(tl14a): Owner-Sign-off G1 + G2 eingetragen (D3 = 24 Monate, C1/C2 ratifiziert)

**Typ:** Doc-only Beschluss-Eintragung. **Trägt eine Owner-Entscheidung ein — trifft selbst keine.** Kein
Code/Test/Config-Diff, kein Deploy/Secret/Cross-Host. Risiko-Delta **null** (kein Laufzeitverhalten berührt).

## Der Beschluss (Christian, 2026-08-26)
- **G1 — D3 = 24 Monate.** Intermediate-CA-Laufzeit gesetzt; D1/D4/D5/D6 mit-bestätigt (D2 = CO/technisch, bereits per Consensus entschieden, nicht Teil der Sign-off-Tabelle).
- **G2 — Auflage C ratifiziert:** **C1** blockierend, **C2** Fast-Follow.

## Was eingetragen wurde
- **`ADR-045-ca-two-stage-hierarchy.md`** — die eigentliche Statusänderung:
  - **§Status: `Proposed` → `Accepted`** (2026-08-26).
  - **§D3:** von „OFFEN (Owner-Entscheidung)" auf **beschlossen: 24 Monate**. Die Begründung ist bewusst
    **Zeremonie-Probe-Erzwingung (D6)** und **nicht** Kompromittierungs-Fenster-Kompensation — der
    G2-Consensus hatte gezeigt, dass eine kürzere Laufzeit **kein Revocation-Ersatz** ist (sie deckelt nur
    planmäßige Rotation, nicht „Kompromittierung an Tag 2"; dafür ist C1 zuständig). Root-Laufzeit: Korridor
    10–15 J bestätigt, exakte Zahl bei der Zeremonie im Runbook.
  - **§Zwingende Vorbedingungen: neue Vorbedingung C1** (blockierend) — Befund (`crl.ts` = fertige, aber
    0-Aufrufer-Denylist), tragender Grund (**D6-Reserve ohne Sperrfähigkeit = halbe Reserve**: Verfügbarkeit
    ja, Integrität nein; verschärft durch D5, das den Chain-Swap ablehnt), Form (**Denylist**, kein CRL/OCSP),
    Enforcement-Punkt (**App-Ebene**, empirisch erzwungen durch #342: Node-TLS setzt `pathLen` nicht durch),
    **beide** Fingerprints (`:311` Issuer + `:353` Leaf), 3 Pflicht-Tests inkl. **„Alt-Pin aktiv (D4) +
    Alt-Intermediate revoziert"**, Audit-Event, Header-Korrektur, plus der offene Format-Vorbehalt.
  - **§Konsequenzen:** **C2** als bewusst **nicht gebaut** dokumentiert (lokale owner-gepflegte `crl.json`;
    unsignierte Fernverteilung = DoS-Primitiv, signierte = mehr Angriffsfläche als Nutzen) **inkl.
    Re-Evaluierungs-Trigger** (>25 Nodes / Nicht-Owner-Betreiber). Der **Klassifikations-Hinweis vom
    2026-07-27 ist aufgelöst**: *der Consensus meinte C1, die ADR meinte C2.*
  - **§Nächste Schritte:** 1+2 abgehakt, **C1 als Schritt 3** eingezogen, Runbook als **entriegelt** markiert,
    TL-14b setzt jetzt zusätzlich C1 voraus.
- **`TL-14a-G1-decision-brief.md` §5** — Sign-off-Tabelle **ausgefüllt** (alle 7 Zeilen), Gate G1 als
  geschlossen markiert; explizit festgehalten, was der Sign-off **nicht** umfasst.
- **`TL-14a-consensus-result-C.md`** — Ratifizierungs-Tabelle **ausgefüllt** (4 × ja); die fünfte Zeile
  (**C1-Slice freigeben**) bleibt bewusst **offen** und ist als solche markiert.
- **`TL-14a-gate-status.md`** — G1 + G2 auf **GESCHLOSSEN**; neuer Nachtrag: Runbook ist **entriegelt und
  agent-ausführbar**, C1 ist **definiert aber nicht freigegeben**, G3/G4 bleiben gated.
- **`TL-14a-decision-checklist.md`** — alle sechs D-Zeilen ⬜/🟨 → **✅ beschlossen**; Register als
  **historisch** gekennzeichnet (maßgeblich ist ADR-045).
- **DO:** `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, dieser `changes/`-Eintrag.

## Interpretations-Grenze (bewusst eng gehalten)
Christians Wortlaut war „D3 = 24 Monate, C1/C2 ratifiziert — trag es ein". Daraus **abgeleitet** (weil der
G1-Brief den Sign-off genau so definiert): D1/D4/D5/D6-Mit-Bestätigung und der Statuswechsel auf
`Accepted`. **Nicht** abgeleitet und deshalb **offen gelassen**:
1. die **Freigabe des C1-Umsetzungs-Slices** (Codier-Start) — Klassifikation ≠ Code-Freigabe, das bleibt ein
   eigener Owner-Akt;
2. die **exakte Root-CA-Laufzeit** — nie genannt, im Brief ohnehin als Korridor geführt; Festlegung bei der
   Zeremonie.
Beides ist in den Dokumenten sichtbar als offen markiert, nicht still gefüllt.

## Compliance
- **CO:** entfällt — **kein neuer Beschluss**; trägt einen bereits gefallenen Owner-Beschluss ein, dessen
  inhaltliche Grundlage der CO-Lauf vom 2026-08-25 (`TL-14a-consensus-result-C.md`, PR #352) ist.
- **CG:** entfällt — kein Code/Test/Type-Ableitung; `clink`/`gemini` nicht im PATH.
- **TS:** kein `.ts`-Diff. **Daemon-Suite 2101 grün** (unverändert).
- **CR:** ✅ **ECHTES Fremd-Vendor-Review über `agy` (Gemini)** — kein Self-CR. **Verdikt: APPROVE** mit
  **1 MEDIUM** + 1 NIT. **MEDIUM behoben:** der PR schrieb „D1/**D2**/D4/D5/D6 mit-bestätigt" und ordnete
  damit **D2** dem Owner-Sign-off zu — D2 (`pathLen 0`) ist aber eine **CO/technische** Entscheidung und
  stand **nicht** in der Sign-off-Tabelle des G1-Briefs. Korrigiert in ADR-045, `gate-status`,
  `decision-checklist` (D2-Zeile jetzt „per Consensus 2026-07-19, kein Owner-Sign-off nötig"), `TODO`,
  `CHANGES`, `COMPLIANCE` und diesem Eintrag. **NIT bewusst nicht geändert:** der überholte KW31-Block in
  `TODO.md` bleibt mit Überholt-Markierung stehen (Repo-Konvention: Historie sichtbar lassen statt löschen);
  agy stufte ihn ausdrücklich als „kein echter fachlicher Widerspruch" ein. Faktentreue (24 Monate,
  `agent-card.ts:311`/`:353`, #342, #352-Reconcile) und Ehrlichkeit (offengelegte Nicht-Entscheidungen)
  wurden von agy als PASS bewertet.
- **⚠️ G3-KORREKTUR (Befund dieses Laufs):** `codex` **und** `agy` sind **vorhanden** — in `~/.local/bin/`
  (agy als Binary, codex als Symlink nach `~/.codex/…`), nur **nicht im `PATH`**. Deshalb scheitert
  `pal:consensus`/`pal:codereview` mit *"executable not found in PATH"*, während ein **direkter Aufruf über
  den absoluten Pfad funktioniert** (so entstand dieses Review). G3 ist damit **kein Verfügbarkeits-, sondern
  ein reines PATH-Problem** — und für Reviews **ab sofort umgehbar**.
- **PC:** Secret-Scan clean (nur Doku).

## Nicht berührt
Kein Code, keine Config, kein Deploy/Secret/State. **G3** (Cross-Vendor-CO) und **G4** (TL-14b, ⛔ Termin)
bleiben unverändert offen; ADR-046 §9, msg 1453, TL-08/09/10 unberührt.
