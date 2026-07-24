# changes/2026-07-24 — docs(runbook): TL-11-Runbook nennt den optionalen Daemon-Sweep (`TLMCP_WAKE_SWEEP_ENABLED`)

**Typ:** **Doc-only** Runbook-Ergänzung. Kein Code, keine Entscheidung, **kein Flag-Flip**, kein
Deploy/Secret/Host. Schließt eine Lücke zwischen dem in #326 gemergten Sweep und dem operativen Runbook.

## Die Lücke
`#326` verdrahtete den Reconciliation-Sweep hinter `TLMCP_WAKE_SWEEP_ENABLED` (Default AUS). Dokumentiert
war das bisher **nur** in den Architektur-Dokumenten (`ADR-047` §3, `TL-11-wake-consumer-contract.md` §7.3).
Das **operative** Runbook (`RUNBOOK-TL-11-wake-supervisor.md`), das der Supervisor-Betreiber liest, kannte
den zusätzlichen Wake-Auslöser **nicht** — ein Betreiber hätte ein daemon-seitiges Sweep-Wake für einen Bug
halten oder es mit seiner eigenen Cold-Start-Pflicht verwechseln können.

## Was
- **Neue §5.1** direkt hinter der Robustheits-Sektion: was das Flag tut (Default AUS, Auslöser
  `agentRegistry.on('register')`, nur die registrierende Instanz, Wake-Form **identisch** zum regulären
  Wake), plus die ausdrückliche Klarstellung: **es ändert nichts an der Cold-Start-Sweep-Pflicht** des
  Supervisors (§5) — der Daemon-Sweep *ergänzt* sie, ersetzt sie nicht (der Daemon sieht keinen
  Supervisor-Neustart ohne Re-Registrierung der Instanz). Und: das Setzen ist ein **bewusster Owner-Schritt**,
  kein Teil dieses Runbooks.
- **§7-Checkliste:** die „Cold-Start-Sweep implementiert"-Zeile ist um den Hinweis ergänzt, dass sie
  **unabhängig** vom optionalen `TLMCP_WAKE_SWEEP_ENABLED` gilt.

Alle Aussagen gegen den gemergten Code verifiziert (`index.ts:1125` Flag-Gate; `sweep-wiring.ts` Auslöser +
`reason:'inbox'` + Zielgenauigkeit).

## Compliance
- **CO/CG/TS:** entfallen — Doc-only, kein Code/Test-Diff; die Suite ist durch #326 unverändert **2045 grün**.
- **CR:** externes Review am PR mit `agy`.
- **PC:** Secret-Scan clean (nur Doku, das Flag ist kein Secret).
- **DO ✅:** dieser Eintrag, `docs/RUNBOOK-TL-11-wake-supervisor.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`.

**Unverändert gated:** der Flag-Flip in einer laufenden Instanz (owner), TL-11 Slice B (Host-Hop), sowie
TL-12/TL-14a/TL-08/TL-10 (Sign-off/CO). Dieser Slice berührt **keines** davon.
