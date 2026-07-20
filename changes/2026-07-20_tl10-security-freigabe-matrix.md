# changes/2026-07-20 — docs(security): TL-10 Freigabe-Matrix — Guardrails + „deklarativ ≠ enforced" (D3)

**Typ:** Doc-only (SECURITY.md). **Kein** Code/Runtime-Change (der Slice-A-Resolver bleibt unverdrahtet),
kein Deploy/Secret/Cross-Host, **keine** Aktivierung.

## Warum
Der §5-CO (opus+sonnet einstimmig, 2026-07-20) machte **D3** zur Vorbedingung für Slice B: der sichtbare
SECURITY.md-Hinweis, dass `decider: human:<id>` in v1 **rein deklarativ** ist (Audit/Anzeige), **nicht**
durchgesetzt — ein `human:<id>`-Feld sieht wie Zugriffskontrolle aus, ist es aber (noch) nicht. Dieser
Anteil ist ungated (reine Doku) und hält die Lane repo-seitig am Laufen, während Wiring/Aktivierung hinter
Christians Sign-off geparkt bleibt.

## Was
- **`SECURITY.md` — neue Sektion „Freigabe-Matrix (TL-10) — Freigabe-/Runtime-Entscheidung & Guardrails":**
  - **⚠️ Kernaussage:** `decider: human:<id>` v1 **REIN DEKLARATIV, NICHT durchgesetzt**; Betreiber dürfen
    sich nicht als Zugriffskontrolle darauf verlassen. `consensus:quorum=N` nur parse-validiert (Consensus-
    Pfad = hartes 403).
  - **Guardrails (fail-closed, in Slice A verankert):** Parse-Reject ⇒ ganze Matrix ungültig; Default-Deny
    403 bei kein-Match/leerer Matrix (kein Fail-open); einziger Auswertungspfad `isRoutable(resolveEntry(...))`;
    Server-Validierung gegen `resolveMcp`.
  - **4 Vorbedingungen VOR Aktivierung/Sign-off:** (1) D3-Owner-Sign-off, (2) D2-Registry-Bindung
    (`requestApprovalOn(channelId)`), (3) Env-Flag Default-AUS + Startup-Warn, (4) reviewte
    `config/freigabe-matrix.toml`.
  - **Owner-gated bleibt:** Aktivierungs-Flag-Flip, D3-Enforcement-Design, produktive Policy-Änderungen.
- **`TODO.md`:** SECURITY.md-Anteil als erledigt; Slice B bleibt D2/D3-gated (Sign-off + Flag-Flip owner-gated).

## Abgrenzung
Reine Doku — **kein** Runtime-Wiring, **keine** Aktivierung, kein Christian-Ping. Slice B (Verdrahtung) bleibt
sauber hinter dem Sign-off geparkt.

## Compliance
- **CO/CG/TS:** entfallen — Doc-only, kein Code; der D3-Doc-Anteil war selbst §5-CO-gefordert.
- **CR:** externer Claude-Review-Subagent vor Merge (prüft: die „deklarativ ≠ enforced"-Aussage ist korrekt
  gegen Slice-A-Code, Guardrails stimmen mit `freigabe-matrix.ts` überein, keine Überstellung von Garantien).
- **PC:** `git diff` gesichtet, Secret-Scan clean (nur Doku).
- **DO:** dieser Eintrag, `SECURITY.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
