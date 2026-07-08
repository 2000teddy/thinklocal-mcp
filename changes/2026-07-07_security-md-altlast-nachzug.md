# changes/2026-07-07 — docs(security): SECURITY.md auf v0.34.70 nachziehen (Doku-Pflege-Altlast)

**Typ:** Doc-only (SECURITY.md). Kein Code, kein Verhalten geändert.
**Lane:** Claude-ThinkHub-ThinkLocal-MCP. **Auftrag:** Christian/Hermes MD-Pflege-Audit
(`~/hermes/reference/2026-07-07_MD-Pflege-Audit-und-Durchsetzungssystem.md`), Altlast §2 „SECURITY.md seit
05.06. trotz 4 Härtungs-PRs".

## Warum
Das Audit stufte thinklocal-mcp als 🟡 ein — pristine `changes/`/`CHANGES.md`/COMPLIANCE/ADRs, aber
`SECURITY.md` hinkte hinterher: Version-Marker „Stand v0.24", Identitäts-Abschnitt beschrieb noch
`host/<stableNodeId>` als aktuell, und die Härtungen seit v0.31 fehlten. „Stand v0.24" + „(v0.31)" waren
faktisch veraltet gegenüber main (v0.34.70).

## Was
- **Neuer Abschnitt** „Kanonische PeerID-Identität & Härtungen seit v0.31 (Stand v0.34.70)" mit 8 Punkten:
  ADR-022 PeerID-Identität, ADR-026 symmetrische Auth-Discovery, ADR-024 Cert-Retention + CA-Gültigkeit
  fail-closed (#165/#191), token-onboarded Bundle fail-closed (#225/127b), mTLS-Issuer-Fingerprint (#226/127c),
  Re-Pair Migrationsstufe + CA-verankerter Re-Key (ADR-034 #245/#246), Ingress-Stufen-Durchsetzung
  (ADR-033 #239), Toter-Code-Entfernung PolicyEngine/Cert-Rotation (#221–#224).
- **Superseded-Hinweis** am „(v0.31)"-Abschnittskopf → verweist auf den neuen Abschnitt; Historie bleibt.
- **Stale-Korrektur:** „Policy Engine (OPA/Rego)" als geplante Mitigation ist hinfällig (Modul entfernt);
  real verdrahtet = mTLS/Trust + `isApprovedPeerSender` + Vault-Approval + Ingress-Stufen.
- **Version-Marker:** „Bekannte Limitierungen (Stand v0.24)" → „(Stand v0.34.70)".
- **Security-Reviews-Tabelle:** +2 Zeilen (adversariale Claude-Reviews #245, #246).

## Tests / Verifikation
Doc-only → keine Unit-Tests. Verifikation: Claude-Subagent-Gap-Analyse (read-only) als Quelle; ADR-/PR-/
Versionsnummern gegen `git log`/`CHANGES.md`/`COMPLIANCE-TABLE.md` gegengeprüft; adversariales Claude-Review
des Diffs auf Überclaims/Fehlaussagen (Ergebnis in COMPLIANCE-Zeile).

## Status
Offen (PR gegen main). Kein Deploy, kein Verhalten. Teil des KW28/29-Doku-Durchsetzungs-Sweeps
(Altlasten zuerst; warnendes CI-Gate + Rollen/Phasen-Schalter folgen als getrennte PRs).
