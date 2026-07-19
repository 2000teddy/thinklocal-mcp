# changes/2026-07-19 — docs(tl14a): CA-Zweistufen-Umzug Scoping/Discovery-Note

**Typ:** Doc-only (Design-Doku VOR Runbook/Skripten, CLAUDE.md Schritt 3). **Kein** Code/Runtime-Change,
**keine** Skripte, **kein** Deploy/Secret/Cross-Host-Schritt.

## Warum
TL-14a (CA-Zweistufen-Umzug: Offline-Wurzel → Intermediate TH01 → Geschwister-Intermediate TH02) ist ein
KW30-v5.1-Schritt, explizit „nur Papier+Skripte". Bevor der Runbook-Volltext + die Zeremonie-Skripte
entstehen — und lange bevor irgendwas umgezogen wird (TL-14b, ⛔ gated) — fehlte die Scoping-Note, die
(a) den **Ist-Zustand** code-groundet, (b) die bereits gefallenen Beschlüsse konsolidiert und (c) die **exakt
noch offenen Entscheidungen** benennt. Diese Note schließt die Lücke — **discovery/design only**, kein
Runbook-Text, keine Skripte.

## Was
- **Neu `docs/architecture/TL-14a-ca-two-stage-scoping.md`:**
  - **Ist-Zustand gegroundet:** heute ist die Mesh-CA **flach/einstufig** — `createMeshCA()` (`tls.ts:59`)
    erzeugt eine self-signed Root (`cA:true`/`keyCertSign` `tls.ts:84-85`, kein `pathLen`/Intermediate),
    `createNodeCert()` (`tls.ts:108`) signiert Leafs direkt (`tls.ts:156/174`); der Attesting-Pfad
    (`cert-issuer.ts`, ADR-022 Schritt 3) stellt kanonische `node/<PeerID>`-Leafs mit dem **Root-Key**
    aus. Root-Key liegt **online + ko-lokalisiert** (`ca.crt.pem`/`ca.key.pem`, `tls.ts:403-404`). Config
    kennt `cert.renew_before_days`/`cert.migrate_legacy_identity`, **kein** `trust_domain`/Hierarchie-Feld.
  - **Zielhierarchie:** offline Root (air-gapped) → Intermediate TH01 (Aussteller) → Geschwister-
    Intermediate TH02 (HA/Reserve).
  - **Bindende Beschlüsse konsolidiert:** ADR-022/028 (kanonische `node/<PeerID>`-SAN bleibt), ADR-024
    (Retention beim Boot), ADR-034 (opt-in Migrationsstufe), Decision-7 (Trust-Domain-Flip gebündelt),
    TL-13 (Re-Enroll-Vorlauf).
  - **Runbook-Skelett (7 Schritte)** + **§5: 6 exakt offene Entscheidungen** als Gate (Trust-Domain-
    Kopplung, `pathLenConstraint`, Intermediate-Validität, Cross-Sign vs. harter Cutover, Chain-Ausroll-
    Mechanik = TL-14b-Kern, TH02-Rolle heiß/kalt).
- **`TODO.md`:** TL-14a auf `[~]` gesetzt, Scoping-Sub als erledigt, Runbook-Volltext+Skripte als offen
  (nach §5) angelegt.

## Abgrenzung
Entscheidet **nichts Neues** über die bindenden Beschlüsse hinaus; macht den Ist-Zustand + Zielvorschlag
explizit und §5 zum Gate. **Kein** Runbook-Volltext, **keine** Skripte, kein `createMeshCA`-/Config-Code
angefasst. Die **Durchführung** ist **TL-14b** (⛔ termin- + Christian-gated, out-of-repo). Eine künftige
ADR (CA-Hierarchie/Offline-Root) hält die §5-Entscheidungen fest, bevor der Runbook-Text startet.

## Compliance
- **CO ⚠️:** bindende Beschlüsse liegen vor → Note **konsolidiert** sie; **keine** neue Design-Entscheidung
  getroffen (§5 offen für Folge-CO/ADR) → kein neuer CO-Lauf nötig.
- **CG/TS:** entfallen — kein Code, keine Skripte.
- **CR:** Doc-Accuracy self — jedes Code-Zitat per `grep`/`sed` gegen die Quelle verifiziert
  (`tls.ts:59/84-85/108/156/174/403-404`, `cert-issuer.ts:121`, `config.ts:165/169/251-252`).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die Scoping-Note.
