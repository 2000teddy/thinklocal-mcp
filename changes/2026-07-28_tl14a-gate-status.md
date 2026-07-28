# changes/2026-07-28 — docs(tl14a): Gate-Status-Snapshot + kein-non-gated-Slice-Befund

**Typ:** **Doc-only** Status/Park-Note. Kein Laufzeitcode, kein Test-Diff, **kein Beschluss**, kein Gate
verschoben/vorweggenommen, kein Deploy/Secret/Host. Watchdog-scoped (KW31, 2026-07-28): „Gate-Stand in
Repo-Wahrheit festhalten + prüfen, ob ein non-gated Slice existiert; wenn nein, sauber parken." Kein
Christian-Escalate (Telegram-Entwurf verworfen).

## Warum
Der TL-14a-Stand lag verstreut über TODO §398–499 (`[~]`-Zeilen), ADR-045 und drei Grounding-Notes. Ein
prüfbarer **Ein-Blick-Snapshot** fehlte: Ist die agent-ausführbare Lane erschöpft, und welcher Gate
entriegelt was? Diese Note konsolidiert das — **entscheidet nichts**, spiegelt nur den code-verifizierten
Ist-Stand.

## Was
- **Neu** `docs/architecture/TL-14a-gate-status.md` — Snapshot:
  - **Agent-Lane erschöpft:** Vorbedingungen **A** (`verifyPeerCertChain` + `tls-transport-pathlen.conformance.test.ts`,
    #298/#311/#342) und **B** (`cert-monitor-wiring.ts` + Test, #297/#344) code-verifiziert **komplett** —
    im aktuellen Baum per grep/ls bestätigt, nicht nur Commit-Prosa.
  - **4 Gates benannt:** G1 (D3-Intermediate-Laufzeit 1–3 J → Christian → ADR-045 `Accepted` → Runbook),
    G2 (C-Klassifikation Blocker/Fast-Follow + Form + Distribution → CO/Owner → `crl.ts`-Verdrahtung),
    G3 (Cross-Vendor-CO infra-blockiert, `codex`/`agy` NOT in PATH), G4 (TL-14b ⛔ Termin+Christian).
  - **Befund:** **kein** non-gated Code-Slice offen — Runbook-Volltext ist per Prozess nach G1 sequenziert,
    C-Verdrahtung hängt an G2, A2-rest ist bis TL-14b deferred. Vorziehen = Nebelmaschine (PR-#83-Lehre).
  - **Kleinlast dokumentiert:** `crl.ts:5–7`-Header behauptet weiter fälschlich „beim Heartbeat/Agent-Card
    geprüft" (0 Nicht-Test-Aufrufer) — Reparatur gehört in den G2-C-Verdrahtungs-Slice (dann wird der
    Header wahr), nicht in eine Churn-Micro-PR jetzt.
- **`TODO.md`** TL-14a-Kopf: GATE-STATUS-Zeiger-Zeile mit den vier Gates ergänzt.

## Compliance
Doc-only ⇒ **CO/CG/TS entfallen** (kein Design-Diff, kein Code, kein Test; Präzedenz #345/#346/#347).
**CR:** Self-CR + Review-of-Record über claude/agy (nie MiniMax/pal:chat/Codex). **PC:** Secret-Scan clean
(nur Doku, keine Werte). **DO:** `TL-14a-gate-status.md`, `TODO.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`,
dieser Eintrag. **Nicht berührt:** ADR-046 §9, alle offenen Gates, TL-08/09/10. Kein `.ts`-Diff, Suite
unverändert **2101 grün** (kein Testlauf nötig).
