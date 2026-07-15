# ADR-041 — Owner-seitige Feld-Redaction für sensitive Reads (TL-08 Slice 2b)

**Status:** Accepted
**Datum:** 2026-07-15
**Kontext-Task:** TODO TL-08 Slice 2b (Folge auf ADR-040). Baut die **fail-closed Redaction-Mechanik**
für die in ADR-039/040 als `sensitive` markierten credential-/PII-Reads. **Kein Gate-Flip** (= Slice 2c).
**CO:** `pal:consensus` 2026-07-15, `cli-claude-opus` (neutral) + `cli-claude-sonnet` (against). Beleg:
`~/hermes/reports/2026-07-15_1705_TL08-slice2b-consensus.md`.

## Policy R (bindend, CO): Secrets verlassen den Owner NIE
Der 2a-CO ergab: `mcp-ingress.ts` gatet `gate` nur, solange **kein** `resolveApproval` verdrahtet ist —
mit einem Freigabekanal (ADR-037) fällt ein **approved** gate-Call zum Executor durch. Ein Redactor, der
Approval respektiert, würde also ein vom Menschen freigegebenes Secret durchlassen. **Entscheidung: die
owner-seitige Redaction ist UNCONDITIONAL** — Approval regelt den Zugriff auf den **Aufruf**, nie auf das
**Secret**. Redaction hängt an keinem Trust-Flag über der Naht.

## Entscheidung

Neues reines Modul `redact-mcp-response.ts` + Verdrahtung im **Owner-Local-Exec** (`mcp-mcporter-exec.ts`,
nach `JSON.parse(stdout)`, VOR der Rückgabe). Das Secret verlässt den Owner-Daemon nie unredigiert.

### Mechanismus: **Deny-by-default Feld-Allowlist** (kein Secret-Denylist)
Eine Secret-**Denylist** („redigiere bekannte Secret-Keys") failt **open** auf Unknown-unknowns (neues
UniFi-Feld `x_new_secret`, Casing-Drift, Secret in einem Array-Element). Stattdessen **Deny-by-default
Projektion**: `SERVER_SAFE_FIELDS[server]` listet die **known-safe** Keys; beim Tiefen-Walk überlebt nur
ein safe-gelisteter Key (rekursiv), **jeder andere Key → `[REDACTED]`**. Unknown-unknown = sichtbare
Lücke (over-redaction), **kein Leak**. Bounded: Tiefe ≤ 32, Node-Cap; Überschreitung → **fail-closed**
(nie truncate-and-pass). Rein (keine Mutation) → idempotent.

**CR-Härtung (in-slice):** (HIGH) ein Skalar überlebt NUR im erlaubten Kontext (Wert eines safe-Keys) —
ein skalares **Array-Element** (das keinen Key hat) auf Top-Ebene/in nicht-erlaubtem Kontext wird
redigiert (`list_vouchers → ["CODE1",…]` leakt sonst). (MEDIUM) auch die **Fehler-Pfade** des
Owner-Exec (`detail: stdout/stderr`) redigieren bei einem sensitiven Tool. (LOW) Tool-Name wird **exakt**
gematcht (kein lowercase) — konsistent zur Klassen-Map; MCP-Toolnamen sind case-sensitiv + gegatet, ein
Casing-Bypass läuft heute in 502/gate; Notiz für 2c.

`redactSensitiveResult(server, tool, result) → { outcome, result, reason }`:
- Tool **∉** `sensitive(server)` → `passthrough` (unverändert).
- Tool **∈** `sensitive` + `result` ist Objekt/Array + im Rahmen → `redacted` (projiziert).
- Tool **∈** `sensitive` + `result` ist Skalar ODER Rahmen überschritten → `fail-closed`.

**fail-closed / redacted-Rückgabe = 200** (kein 5xx — das hieße „Owner kaputt" + Retry): `result` wird
durch eine **selbstbeschreibende, secret-freie Notiz** ersetzt: `{ thinklocalRedaction, server, tool }`.
fail-closed wird zusätzlich `deps.log.warn`-geloggt.

### 2b-Grenze: `SERVER_SAFE_FIELDS['unifi']` ist **leer** (maximale Redaction)
2b liefert die **Mechanik**, nicht die vollständige Feld-Kuratierung. Mit leerer Safe-Liste redigiert die
Projektion **alle** Datenfelder eines sensitiven Tools (fail-closed-Extrem, beweisbar kein Leak). Bewusste
**Limitierungen** (→ Slice 2c, unter Security-CR mit echten Output-Schemata):
1. **Secrets in JSON-String-Werten** (mcporter-`content[].text` trägt oft JSON-stringifizierte Daten) werden
   in 2b **nicht** aufgelöst — die leere Safe-Liste redigiert den ganzen Wert ohnehin, aber eine spätere
   nicht-leere Safe-Liste MUSS nested-JSON behandeln.
2. **Vollständigkeit** der Safe-Liste ist erst mit Output-Schemata pro Tool beweisbar. `redacted` bedeutet
   in 2b **nicht** „vollständig geprüft".

### Kein Gate-Flip (2c)
Die sensitiven Tools bleiben am Ingress **gegatet** (ADR-039/040). Die Redaction-Verdrahtung ist im
**Live-Traffic-Pfad tot** (sensitive Reads erreichen den Owner-Exec nicht), aber **am Exec-Seam getestet**
(fake Runner). Ein **Regressionstest** sichert: alle 10 sensitiven Tools werden weiterhin gegatet
(`deriveToolTierForServer → gate`) — „wired ≠ exposed". Der **Gate-Flip** (sensitive → allow-with-redaction)
+ die Safe-Field-Kuratierung + nested-JSON = **Slice 2c, eigener Security-fokussierter CR**; die grünen
2b-Tests sind **keine** Vorabfreigabe dafür.

## Konsequenzen
- **+** Owner-seitige, **unconditional** fail-closed Redaction-Mechanik (deny-by-default) steht + ist am
  Seam getestet; correct-by-construction für den späteren Gate-Flip.
- **+** Null Live-Verhaltensänderung (sensitive Tools gegatet → Redactor unerreichbar; Gate-still-blocks-Test).
- **−** Ohne kuratierte Safe-Liste redigiert 2b ein sensitives Tool praktisch vollständig (kein
  Feld-Durchlass) — das ist der fail-closed-Default; Feld-Durchlass = 2c.
