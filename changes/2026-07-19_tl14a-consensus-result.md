# changes/2026-07-19 — docs(tl14a): CA-Zweistufen-Umzug `pal:consensus`-Ergebnis D1–D6

**Typ:** Doc-only (Ergebnis-Protokoll eines `pal:consensus`-Laufs). **Kein** Code/Runtime-Change, **keine**
Skripte, **kein** Deploy/Secret/Cross-Host-Schritt.

## Warum
Der Consensus-Brief (#290) bereitete D1–D6 für die formale Abstimmung vor. Der benannte nächste Schritt war,
`pal:consensus` tatsächlich laufen zu lassen und das Ergebnis als Input für Christian-Sign-off + ADR
festzuhalten — repo-lokal, ohne verbindliche Entscheidung.

## Was
- **Lauf durchgeführt** (`pal:consensus`, mit Scoping-Note + Checkliste + Brief als Kontext).
- **Infra-Befund:** `gpt-5.5` (codex-CLI) und `gemini-pro` (agy-CLI) → Provider-Fehler *"executable not found
  in PATH"*; konsultierbar waren die beiden claude-CLI-Modelle → **Same-Vendor-2-Modell-Panel**
  (claude-opus 8/10 + claude-sonnet 7/10). Kein Cross-Vendor-Pass; Re-Run mit codex/agy vermerkt.
- **Neu `docs/architecture/TL-14a-consensus-result-D1-D6.md`:** Lauf-Metadaten, Ergebnis je D1–D6 (Tabelle mit
  beiden Voten), querschnittliche Auflagen A–C, offene Owner-Entscheidung (D3-Laufzeit), nächste Schritte.
- **Inhaltliches Ergebnis:** **einstimmig 5/6** bestätigt (D1/D2/D4/D5/D6). Einzige Divergenz **D3-Laufzeit**:
  **beide verwerfen ≥5 J** (opus 12–24 Monate, sonnet 3 Jahre → Korridor ~1–3 J; online/ko-lokalisierter
  Intermediate-Key = Kompromittierungs-Hotspot; sonnet warnt zugleich vor Rushed-Ceremony bei zu kurzen
  Intervallen). Auflagen (beide: **blockierend**): **A** Chain-Building/pathLen-Enforcement in
  `verifyPeerCert` (`tls.ts:729`, heute flacher Ein-CA-Verify ohne Chain-Building) — sonst D2/D4 nur Papier (Fingerprint-Pin
  validiert ggf. nicht die Kette); **B** Intermediate-Expiry-Monitoring fehlt (`cert-expiry-monitor` nur
  Leafs), Vorbedingung für D3; **C** keine Revocation-Infra — sonnet: gepinnte Fingerprint-Denylist statt
  CRL/OCSP. Reihenfolge: A+B → D3-Zahl → ADR.
- **`TODO.md`:** Consensus-Brief `[x]`, `pal:consensus`-Lauf `[~]` (2-Modell-Panel), Auflage-A+B-Klärung +
  Christian-Sign-off als nächste offene Schritte präzisiert.

## Abgrenzung
**Trifft keine verbindliche Entscheidung.** Protokolliert das (same-vendor) Consensus-Votum als
Entscheidungs-Input. Die D3-Laufzeit ist eine **neue Owner-Entscheidung** und bleibt Christian vorbehalten.
**Kein** Runbook-Volltext, **keine** Skripte, kein Code/Config, kein Deploy/Secret/Cross-Host.

## Compliance
- **CO ✅ (durchgeführt, Infra-eingeschränkt):** `pal:consensus` lief als Same-Vendor-2-Modell-Panel
  (opus+sonnet); codex/agy fehlen → kein Cross-Vendor-Pass, Re-Run empfohlen. Kein Christian-Ping ausgelöst
  (Lauf lieferte ein Ergebnis; die neue Owner-Frage — D3-Laufzeit — ist als Sign-off-Punkt geparkt, nicht
  gesetzt).
- **CG/TS:** entfallen — kein Code, keine Skripte.
- **CR:** Claude-Review-Subagent (Doc-Accuracy) — 3 Anker-/Konsistenz-Defekte gefunden + gefixt (erfundener
  `verifyCanonicalNodeCert` entfernt, Anker `verifyPeerCert` auf `tls.ts:729` korrigiert, „Ein-Modell"-Rest
  auf 2-Modell vereinheitlicht); Zitate gegen die Quelle verifiziert (`tls.ts:729/534-537`,
  `cert-issuer.ts`, `cert-expiry-monitor`).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, die Ergebnis-Note.
