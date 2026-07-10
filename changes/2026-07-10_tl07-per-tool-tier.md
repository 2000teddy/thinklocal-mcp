# changes/2026-07-10 — feat(mcp): TL07 pro-Tool-Ausführungsstufe (Entscheidung 2)

**Typ:** Daemon-Code (`mcp-service-registry.ts`, `mcp-ingress.ts`) + Tests. Kein Deploy.
**Auftrag:** Christians Entscheidung 2 (bestätigt A, 2026-07-10) — „lesend≠schreibend" am
selben MCP-Server durchsetzen. Prep-Blocker aus `2026-07-10_1115_TL07-nightproof-PREP.md`.

## Warum
Die Ausführungsstufe wurde bisher NUR pro Server-Capability abgeleitet
(`deriveExecutionTier` aus permissions/trust_level). unifi = `network.read` → `self` für
ALLE Tools → ein schreibendes `block_client` hätte dieselbe Stufe wie `list_clients` und
NICHT am Gate angehalten (Live-Aufruf hätte real einen Client blockiert). Damit war die
Stufen-Gegenprobe (Ablaufplan Schritt 5) weder durchführbar noch sicher.

## Was
- `mcp-service-registry.ts`: neue reine Funktion `deriveToolTier(payload)` — klassifiziert
  den `tools/call`-Toolnamen nach **führendem Verb** (Präfix, nicht Substring, damit
  `get_switch_stack` nicht wegen „switch" falsch gilt):
  - destruktiv (`delete_`/`remove_`/`reset_`/`revoke_`…) → `consensus`
  - schreibend (`create_`/`block_`/`enable_`/`disable_`/`authorize_`/`set_`…) → `gate`
  - lesend (`list_`/`get_`/`describe_`…) → `self`
  - `tools/list` & andere Metadaten-Methoden → `self`; unbekanntes Verb / ungültiger
    `tools/call` → `gate` (fail-closed, ADR-028-D4). `maxTier` wird exportiert.
- `mcp-ingress.ts`: effektive Stufe = `maxTier(Capability-Stufe, deriveToolTier(payload))`
  VOR dem Executor. Die Werkzeug-Stufe kann nur ANHEBEN, nie absenken. Einziger
  Enforcement-Ort (kein Drift); die Remote-Forward-Gegenseite re-enforced über denselben
  `handleMcpIngress`.

## Tests / Verifikation
- `mcp-service-registry.test.ts` +2 describe: `deriveToolTier` (read/write/destruktiv,
  tools/list, unbekannt→gate, Case-insensitiv) + `maxTier`.
- `mcp-ingress.test.ts` +7: `list_clients`→200, `block_client`→403 gate,
  `delete_network`→403 consensus, `get_switch_stack`→200 (Präfix), `tools/list`→200,
  unbekanntes Verb→403, ohne payload→200 (rückwärtskompatibel).
- `mcp-ingress-api.test.ts`: Passthrough-Test auf ein Read-Tool umgestellt (tools/call ohne
  `params.name` ist jetzt fail-closed gegatet).
- Voll: **1495 Tests grün**, `tsc --noEmit` + ESLint sauber.
- CR: claude-Subagent → **PASS**, keine HIGH/MED. Kein Under-Gating (alle unifi-Schreib/
  Destruktiv-Verben ≥ gate); Single-Enforcement bestätigt; fail-closed für camelCase/unknown.

## Bekannte Beta-Grenzen (CR-LOW → ADR-033 notieren)
1. Nicht-`tools/call`-Methoden erhalten `self` (keine Anhebung) — der Executor führt ohnehin
   nur `tools/list`/`tools/call` aus (sonst 400); die Capability-Stufe bleibt Backstop. Falls
   künftig eine mutierende Nicht-call-Methode dazukommt, Methoden-Allowlist statt self-Default.
2. Die Verb-Heuristik vertraut der `verb_object`-Namenskonvention (ein `get_and_reset` würde
   als self gelten). Für die unifi-Toolnamen unkritisch; Backstop = Capability-Stufe.

## Status
Offen (PR gegen main). Ermöglicht die block_client-Stufen-Gegenprobe (Ablaufplan Schritt 5)
nach Merge+Deploy.
