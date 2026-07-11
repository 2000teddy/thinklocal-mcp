# changes/2026-07-11 — feat(discovery): ADR-035 A3 Card-Fetch-Retry mit Backoff + Root-Cause/ADR

**Typ:** Daemon-Code (`inbound-peer-learner.ts`) + Tests + Design-Doku (ADR-035) + TODO.
**Auftrag:** Christian (via Fable-5, 11.07. 22:05) — „Discovery überlebt Neustart-Wellen nicht."
**Root-Cause-Report:** `hermes/reports/2026-07-11_2200_discovery-restart-rootcause.md`.

## Warum
Root-Cause (code-verifiziert, drei Ebenen): (1) keine Peer-Persistenz (MeshManager rein
In-Memory → Restart = Amnesie); (2) mDNS one-shot (kein Re-Announce/Re-Query); (3) Async-Learn
rein reaktiv + **einzelner** Card-Fetch → scheitert während einer Welle (Peer-HTTP noch nicht oben).
Live-Workaround war `static_peers` — skaliert nicht (1000+ Knoten) und ist eine `daemon.toml`-
Ausnahme, die es laut Christian nicht braucht.

## Was (dieser PR = ADR-035 Slice A3)
- `inbound-peer-learner.ts`: Card-Fetch mit **Retry + Backoff**. Retry NUR bei transientem Throw
  (ECONNREFUSED/Timeout während einer Welle); Default 3 Versuche, Backoff [500,1500,4000]ms.
  Ein erfolgreicher Fetch mit ungültiger Card bleibt **permanenter Reject** (kein Loop). Neue Deps
  `maxFetchAttempts`/`fetchBackoffMs`/`delay` defaulten → **kein index.ts-Change, rückwärtskompatibel**.
- `docs/architecture/ADR-035-…md` (neu): Root-Cause + Fix-Plan (A1 Persistenz, A2 Boot-Re-Learn,
  A4 mDNS-Re-Query, **B Hub-verankerte Pull-Discovery** als Ziel-Architektur) + Slice-Tabelle.
- `TODO.md`: TL-25a (erledigt) + TL-26…TL-29 (Folge-Slices; A1/B mit CO-Vorbehalt).

## Tests / Verifikation
- `inbound-peer-learner.test.ts` +4: Wellen-Recovery (Throw→Erfolg beim 2. Versuch), Retries
  erschöpft→fetch-failed, Backoff-Reihenfolge, kein-Retry-bei-SAN-Mismatch, maxAttempts=1-Altverhalten.
  (Delay injiziert → keine echten Timer.) 1499 gesamt grün, tsc + ESLint sauber.
- CR: claude-Subagent.

## Abgrenzung
Nur die Retry-Naht. Die eigentliche Restart-Amnesie-Behebung (Persistenz + Boot-Re-Learn + Hub-Pull)
ist in ADR-035 als TL-26…TL-29 spezifiziert (eigene, teils CO-gegatete Slices). Kein Deploy.

## Status
Offen (PR gegen main).
