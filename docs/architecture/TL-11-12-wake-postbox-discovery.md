# Discovery & Slice-Proposal — TL-11 (Heartbeat-Weckruf) + TL-12 (signierte Postfach-Zustellung)

**Status:** Discovery / Vorschlag (KEIN akzeptiertes ADR — die Implementierungs-ADRs folgen je Scheibe).
**Datum:** 2026-07-15 · **Lane:** Claude-ThinkHub-ThinkLocal-MCP
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against) — beide
einstimmig: **Reorder TL-12 → TL-11**, TL-11 **edge-driven** statt Zweit-Poll, plus die u.g.
Sicherheits-Auflagen. Beleg: `~/hermes/reports/2026-07-15_1303_TL11-12-discovery-consensus.md`.
**Bezug:** ADR-004 (Cron-Heartbeat), ADR-005 (Inbox/Instance-Routing), ADR-035 (Restart-Resilienz).

## Zweck
Doc-first-Scoping von TL-11 + TL-12 **vor** dem Code: Ist-Zustand (belegt), kleinste sichere erste
Scheibe je Feature, empfohlene Reihenfolge, Sicherheits-Invarianten, offene Entscheidungen. Keine
Laufzeit-Änderung in diesem PR.

## Ist-Zustand (belegt, file:line)

**Vorhanden (beide Features ~90% Infrastruktur):**
- Adaptive Poll-Mathematik `heartbeat/interval.ts:57-103`; client-seitige Pull-Schleife
  `inbox-poller.ts:65-91,177-232`; Kadenz-Config `agent-poll-config.ts:33-61`.
- `AgentRegistry` (Liveness + Lifecycle-Hook `on('register'|'unregister'|'stale')`)
  `agent-registry.ts:143-283` — **aber kein** `notify(instanceId)`.
- `inbox:new`-EventBus-Signal wird bei Zustellung emittiert `index.ts:884` — aber nur von
  Dashboard/Telegram/WebSocket konsumiert, **nie** an eine CLI gepusht.
- Signierter CBOR-Envelope + Verify `messages.ts:275-316` (ECDSA P-256, `identity.ts:246-262`);
  mTLS-Peer-Transport + ACK-Verify `inbox-api.ts:249-321`; Pairing-ACL; Inbox-SQLite mit Dedupe +
  at-least-once `agent-inbox.ts:164-358`.

**Fehlend:**
- **TL-11:** ein Daemon→Agent-**Wake-Kanal**. Der Poll ist reiner Client-Pull, getrieben von einem
  **Out-of-Repo** Agent-Home-Supervisor (der `deliver`-Callback lebt außerhalb des Repos,
  `inbox-poller.ts:38-39`).
- **TL-12:** die Inbox-Zeile hat **keine** Signatur-Spalte — die Envelope-Signatur wird transport-seitig
  verifiziert-und-verworfen (`index.ts:825-901`). Eine gespeicherte Nachricht trägt **keine
  re-verifizierbare Provenienz** und **keine Auftrags-Semantik** (`agent-inbox.ts:42-60`).

## Empfohlene Reihenfolge: **TL-12 → TL-11** (CO-einstimmig)
TL-12 Slice A ist additiv (nullable Spalten, reiner Reuse des Signatur-Stacks, unit-testbar ohne Netz)
und **eigenständig wertvoll** (re-verifizierbare Aufträge, wenn auch mit Poll-Latenz). TL-11 verlangt
das *Erfinden* eines neuen Wake-Transports mit Out-of-Repo-Consumer → höheres Risiko. Zudem stabilisiert
TL-12 die **diskriminierte Nachrichtenform**, die TL-11s Wake-Logik lesen muss (wecken auf *Aufträge*,
nicht auf Chat) — TL-11 zuerst erzwänge Rework. Beide sind funktional entkoppelt (der bestehende
Poll-Loop holt einen signierten Auftrag auch ohne Wake ab), die Reihenfolge ist reine Risiko-/Wert-Optimierung.

---

## TL-12 Slice A — signierter Auftrag im Postfach (nächste Scheibe)

**Ziel:** ein signierter „Auftrag" landet **mit intakter Signatur** im Postfach und ist beim `read_inbox`
**re-verifizierbar** — **vor** jeglicher Ausführungs-Verdrahtung.

**Umfang (additiv, rückwärtskompatibel):**
- Neue **nullable** Spalten auf `messages` (`agent-inbox.ts`): `signed_bytes` (BLOB — **verbatim**
  empfangene Envelope-Bytes), `signer_spiffe`, `signer_keyid` (Pubkey-Fingerprint bei Sign-Zeit),
  `verified_at`, `verify_verdict`. Bestehende Zeilen = NULL → lesen als Nicht-Auftrag.
- `store()` persistiert die Signatur/Provenienz; `read_inbox` reicht dem Agenten einen re-verifizierbaren
  Auftrag + Verdikt.
- Kein Touch an `task-router.ts`/Ausführung; Ausführungs-Idempotenz = **Slice B** (explizit markiert).

**Sicherheits-Invarianten (in das Implementierungs-ADR, CO-Auflagen):**
1. **Verbatim signierte Bytes speichern**, nicht dekodierte Felder re-enkodieren — CBOR-Kanonisierungs-
   Drift bricht sonst die Verifikation. Dekodierte Felder = abgeleiteter Cache.
2. **Key-Rotation:** `signer_spiffe` allein reicht nicht (pinnt keine Key-Version). `signer_keyid`
   (Fingerprint) bei Sign-Zeit erfassen; beim Lesen gegen **genau diesen** Key (keyid-indizierte
   History / trust-on-first-verify + persistiertes Verdikt) re-verifizieren, **nie** gegen „aktuellen"
   Pubkey (sonst: alte gültige Aufträge werden unverifizierbar — oder ein rotierter Key wird still getraut).
3. **Diskriminator fail-closed + signiert:** die „ist Auftrag"-Eigenschaft ist ein **signiertes Feld**
   *innerhalb* der Bytes; der Daemon markiert eine Zeile **nur nach erfolgreicher Verifikation** als
   Auftrag und traut **nie** einem client-gesetzten Flag. Unsigniert/unverifizierbar ⇒ nie Auftrag.
4. **Order-Nonce jetzt** in die signierten Bytes (auch wenn Ausführung deferred) — sonst erzwingt ein
   späteres Nachrüsten einen Envelope-Version-Bump. Ausführungs-Idempotenz-Ledger = Slice B.

**Fertig wenn:** eine signierte Auftragszeile wird gespeichert + beim Lesen gegen den `signer_keyid`
re-verifiziert; Tests für gültig/rotiert/unsigniert-nie-Auftrag/malformed-fail-closed; volle Suite grün.

---

## TL-11 Slice A — Heartbeat-Weckruf (danach)

**Ziel:** der Daemon weckt einen registrierten Agenten, sobald **für ihn** etwas vorliegt — der geweckte
Agent prüft sein Postfach. **Edge-driven**, kein neuer Zweit-Poll.

**Umfang:**
- Wake-Logik abonniert das **bestehende** `inbox:new` (`index.ts:884`) und fächert über `AgentRegistry`
  an die adressierte Instanz auf. **Kein** per-Tick `unreadCount`-Scan (das wäre ein zweiter, level-
  getriggerter Poll). Ein **begrenzter Reconciliation-Sweep** bleibt nur für Rand­fälle (Instanz
  registriert während bereits Nachrichten anstehen; fehlgeschlagene Zustellung; Restart-Drain).
- **Offene Entscheidung (im TL-11-ADR zu treffen, nicht papern):** welcher Transport trägt den Wake —
  (a) WebSocket-Multiplex-Erweiterung, (b) neuer mTLS-Push-Endpoint zum Agenten, (c) Poll-Reset-Signal.
  „Reuse pull-seam" ersetzt diese Entscheidung **nicht**.

**Sicherheits-Invarianten:**
- Wake trägt **keinen Inhalt** (nicht mal einen Count) — nur „du hast etwas".
- Ziel-Auflösung strikt über `AgentRegistry`-**Instanz-ID** (nicht Host/Typ); vor `notify` per Pairing-ACL
  prüfen, dass die lebende Verbindung wirklich der adressierten Instanz gehört (kein Redirect/Leak über
  stale/reused instanceId).
- **Coalesce/Rate-Limit pro Instanz** (N Nachrichten → 1 Wake): ein Remote-Peer kann durch Senden lokale
  Wakes auslösen → echte Amplification-Kontrolle, nicht Hygiene. Reconciliation-Sweep **gedeckelt**
  (Restart-Wellen, vgl. ADR-035).
- **Cross-Repo-Abhängigkeit:** `deliver` lebt im Out-of-Repo Agent-Home-Supervisor. Slice A kann die Naht
  definieren+testen, aber den Wake **nicht** end-to-end beweisen ohne koordinierte Supervisor-Änderung.
  **DoD = Zwei-Peer-Live-Beweis** (Deploy/CI-grün ≠ done) — im ADR vorab benennen.

---

## Nebenbefund (in einer registrierungs-nahen Scheibe mitnehmen)
`index.ts:1097` meldet dem Client `inboxSchemaVersion: 1`, die Inbox-DB steht aber auf
`CURRENT_SCHEMA_VERSION = 2` (`agent-inbox.ts:40`). Nicht blockierend, aber falsch — bei der TL-12-Migration
(neue Spalten) ohnehin anzufassen.

## Nächste Schritte (Normal-Workflow)
1. **TL-12 Slice A** — Implementierungs-ADR (ADR-038) mit den 4 Invarianten oben → Code → Tests → CR → PR.
2. **TL-11 Slice A** — Implementierungs-ADR (ADR-039) inkl. **expliziter Transport-Entscheidung** → Code
   → Tests → CR → Zwei-Peer-Live-Beweis → PR.
Beide ADRs bekommen ihren eigenen CO (die Transport-Entscheidung von TL-11 ist eine echte Architektur-Frage).
