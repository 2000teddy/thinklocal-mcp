# T2.5 — ADR-031 Tailscale-Transport-Policy (Entscheidungsvorlage)

**Datum:** 2026-07-01
**Branch:** `claude/adr-031-tailscale-transport`
**Typ:** Doc-only (Architektur-Entscheidungsvorlage) · repo-only, ungated · V5 T2.5 (Spur 2)
**Neu:** `docs/architecture/ADR-031-tailscale-transport-policy.md`

## Was

Formalisierung/Konsolidierung der zwei bereits existierenden Admin-Decision-Prep-Drafts zu **einem**
Repo-ADR als Q4/Q5-Entscheidungsvorlage für Christian:

- `hermes/reports/2026-06-30-t25-tailscale-transport-adr.md` (Policy-Schema, Optionen, Q4/Q5-Empfehlung)
- `hermes/reports/2026-07-01_t2.5-transport-adr-draft.md` (Live-Belege TH01, Achsen A/B, Empfehlung A2+B2)

**Read-first** aus beiden Quellen konsolidiert — keine neue Herleitung/Theorie-Runde. Die zwei Drafts
sind materiell **konsistent** (pro-peer Policy, LAN bevorzugt für kolozierte Peers, Tailscale
Haupt/Fallback pro Peer, mTLS/SPIFFE bleibt Identität, kein Beta-Relay) → kein Draft-Konflikt.

## Inhalt / Zielbild

- **Optionsvorlage, keine präjudizierte Live-Entscheidung.** Status `Proposed (DRAFT)`. Q4/Q5 bleiben
  ausdrücklich Christians Entscheid; das ADR entscheidet den Transport NICHT implizit.
- **Empfehlungslinie (nicht bindend):** A2 (pro-peer Failover) + B2 (Tailscale-only DERP, kein
  Beta-`relay_service` auf TH01). mTLS/SPIFFE bleibt über allen Transporten die AuthN/AuthZ-Schicht.
- Live-Belege (TH01, 2026-07-01): Tailscale wählt auf dem gemeinsamen LAN den Direktpfad (WireGuard,
  ~2–4 ms), `fra`-DERP nur Fallback für Roaming/NAT.
- Vorschlagstaugliches Policy-Schema (`preferred`/`fallback`/`identity`/`relay`) + Beta-Defaults.
- Q4/Q5 + Tailnet-ACL + HTTPS-Fallback-Endpoint als offene Christian-Entscheide gelistet.

## Nicht Teil dieses Slices

Kein Deploy, kein Transport-Umbau, keine Config-Änderung, kein Peer umgestellt, kein Christian-Ping.
Die eigentliche Q4/Q5-ENTSCHEIDUNG bleibt gegated (Christian); Umsetzung (T3.x) erst danach.

## Compliance (CO/CG/TS/CR/PC/DO)

| CO | CG | TS | CR | PC | DO |
|----|----|----|----|----|----|
| konsolidiert (aus 2 Decision-Prep-Drafts; keine neue Konsensrunde — Guardrail; Entscheidung = Christian) | n/a | n/a (Doc-only, kein Code) | ✅ Claude-Faithfulness-Review | ✅ manuell (Quellen-Read-first, git diff) | ✅ ADR + changes + CHANGES |

Doc-only PR (kein `.ts` → Compliance-Gate-CHANGES/COMPLIANCE-Check greift nicht; Bookkeeping dennoch gepflegt).
