# changes/2026-07-16 — docs(TL-11): Wake-Consumer-Contract-Spec + TODO-Wahrheit (KW30)

**Typ:** Doc-only (Architektur-Companion) + TODO-Reconciliation. **Kein Code**, kein Deploy/Secret/Christian-
Gate, **kein neuer Design-Beschluss** (leitet den bereits gemergten Kontrakt aus #271/#277-Code ab).

## Warum
KW30-Fokus = proof→autonomy. Repo-Wahrheit-Check TL-11: **Slice A (ADR-043, #271) + §4 directed-wake
(#277) sind gemergt** — `agent:wake` trägt `spiffe_uri` und wird gerichtet zugestellt. Die TODO-„Backlog-
Befunde" (Leak D1 + Mis-Routing D2, TODO alt Z.118-125) waren dadurch **bereits geschlossen** — die TODO
war stale. Was fehlte: die **implementierbare Consumer-Schnittstelle**, gegen die der Out-of-Repo Agent-
Home-Supervisor (TL-11 Slice B, extern-blocked) gebaut wird. ADR-043 ist die daemon-seitige *Entscheidung*,
nicht die *Implementer-Spec* (WS-URL/Auth/Subscribe/Payload/Semantik/Referenz-Loop).

## Was
- **Neu `docs/architecture/TL-11-wake-consumer-contract.md`** — Consumer-facing Spec, komplett aus
  gemergtem Code abgeleitet:
  - §2 Endpunkt `wss://<host>:9440/ws` am **mTLS-`cardServer`** (Client-Cert-Pflicht; Bezug zum
    Phantom-ROT-Diagnose-Doc).
  - §3 Subscribe MUSS `agent:wake` **und** `agent=<spiffe|instance_id>` setzen (directed deny-by-default).
  - §4 Zero-Content-Payload-Schema `{instance_id, spiffe_uri, reason:'inbox'}`.
  - §5 Semantik-Tabelle (best-effort/lossy, idempotent, coalesced ≤1/Instanz/2000ms, directed, fail-closed)
    + Merksatz „Wake = Poll-Latenz-Optimierung, kein Transport mit Zustellgarantie".
  - §6 Referenz-Konsument (MVP-Shape, Pseudocode) inkl. Cold-Start-Sweep.
  - §7 **Test-Verankerung** — jede Garantie auf einen benannten Test in `wake-contract.test.ts`/
    `websocket.test.ts` gemappt.
  - §8 präziser Rest-Blocker (Slice B: Supervisor→CLI-Hop out-of-repo + Zwei-Peer-Proof).
- **`TODO.md`** — TL-11-Block reconciliert: §4 directed-wake (#277) + Consumer-Contract als [x] eingetragen,
  die stale Backlog-Befunde als „durch #277 geschlossen" markiert, Slice-B-Blocker präzisiert.

## Bewusste Grenze
Die Spec **entfernt** den Slice-B-Blocker nicht (der letzte Hop Supervisor→CLI bleibt out-of-repo +
Deploy/Host-gated) — sie **de-riskt** ihn: der externe Supervisor ist jetzt gegen einen fixen,
testgebundenen Kontrakt baubar. Kein neuer `reason`-Typ / kein Opt-in-Broadcast entschieden (separater
Beschluss, falls je gewünscht).

## Compliance
- **CO:** entfällt — **kein neuer Design-Beschluss**; die Spec restated den bereits CO-abgesegneten
  Kontrakt (ADR-043 CO opus+sonnet in #271, directed-wake #276/#277). Etwaige echte Lücken sind in der
  Spec als „separater Beschluss" markiert, nicht eigenmächtig entschieden.
- **CG / TS:** n/a — Doc-only, **kein** Code geändert (bestehende Suite unberührt). „Test-aware": §7 mappt
  jede Garantie auf einen existierenden, grünen Test.
- **CR:** Doc-Accuracy-Review (Claude-Subagent) gegen realen Code/Tests — **ACCURATE auf dem Kern-Kontrakt**
  (Payload-Schema, Subscribe-Semantik, mTLS-Mount, alle 10 §7-Test-Zeilen bestätigt). **1 materielle
  Auslassung gemeldet + gefixt:** agent-gefilterte Subscription ist **loopback-only** (`4003`,
  `websocket.ts:138-145`) — §2/§3 entsprechend korrigiert (Supervisor MUSS auf dem Daemon-Host/Loopback
  laufen). **Zusatz-Befund beim Fix:** der Frame-Pfad umgeht das Loopback-Gate (`websocket.ts:187-189`) →
  als OFFENER Sicherheits-Härtungs-Posten mit Beleg in §8.1 + TODO dokumentiert (eigener Slice, kein
  Live-Exploit-Druck). 1 kosmetische Zeilennr. (`WakeSignal` :18 statt :10) gefixt.
- **PC:** `git diff --cached` gesichtet (nur Docs: Spec + TODO + CHANGES + changes/); **kein Code**;
  Secret-Scan clean.
- **DO:** dieser Eintrag, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, das neue Spec-Doc.
