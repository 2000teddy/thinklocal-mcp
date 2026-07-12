# changes/2026-07-12 — feat(discovery): ADR-035 A4a — periodisches mDNS-Re-Query

**Typ:** Daemon-Code (`discovery.ts`, `config.ts`, `index.ts`) + Tests + Config + Design-Doku (ADR-035-Slice-Tabelle) + TODO.
**Slice:** ADR-035 A4a / TODO TL-28. Folge auf A3 (TL-25a, PR #257).
**Auftrag:** Christian (via Fable-5, 11.07. 22:05) — „Discovery überlebt Neustart-Wellen nicht" — freigegeben als nächster nicht-gate Slice (12.07. 07:17).

## Warum
Aus dem ADR-035-Root-Cause (Ebene 2): `bonjour.find()` setzt nur **einen** initialen aktiven
PTR-Query ab und lauscht danach **passiv**; es gibt keinen anwendungseigenen periodischen
Re-Query. In einer Neustart-Welle kommen Knoten zeitversetzt hoch → wer den Announce/die
Antwort des anderen verpasst, sieht ihn ohne static_peer nie wieder.

## Was (additiv, rückwärtskompatibel)
- **`discovery.ts`**:
  - `reQuery()` — setzt den aktiven PTR-Query erneut ab (`Browser.update()`); der passive
    Response-Listener aus `browse()` bleibt installiert. No-op bei `mdns_enabled=false` (ADR-025)
    oder vor `browse()`.
  - `resolveMdnsRequeryIntervalMs(configured)` (rein, exportiert): `0`/negativ/NaN/undefined → `0`
    (deaktiviert); jeder positive Wert wird auf `MIN_MDNS_REQUERY_MS = 5000` hochgeklemmt (Anti-Flut).
- **`index.ts`**: nach `browse()` ein `setInterval(() => discovery.reQuery(), ms)` (unref't →
  kein Shutdown-Stau, im `shutdown()` via `clearInterval` gestoppt), nur wenn
  `mdns_enabled && ms>0`.
- **`config.ts`** + **`config/daemon.toml`**: neues Feld `discovery.mdns_requery_interval_ms`
  (Default 30000), Env `TLMCP_MDNS_REQUERY_MS` (non-numerisch/negativ → ignoriert, Default bleibt).

## Verschoben: A4b `remoteAddress`-Fallback (TL-28b, gated)
Der in der ersten PR-#258-Fassung mitgelieferte `remoteAddress`-Fallback im ADR-026-Learner ist
**aus diesem PR entfernt** (Codex-Review CHANGES-NEEDED, 12.07.): ein naiver Fallback ist **nicht**
AUTHN-neutral. Die `record()`-Gate prüft nur `card.spiffeUri == expectedSpiffeUri` + PublicKey-
Präsenz (self-asserted JSON, nicht ans Transport-Cert gebunden). Ein Angreifer, der den Discovery-
Eintrag des Opfers bereits vergiftet hat, könnte an der Substitut-Adresse `{spiffeUri: OPFER,
publicKey: ANGREIFER}` servieren → `{Opfer → Angreifer-Key}` landet in der AUTHN-only-Map (neuer
Pfad von Discovery-Host-Daten zur AUTHN-Key-Attribution). Nachziehen erst identitäts-gebunden:
Learner-Fetch auf `expectedSpiffeUri` pinnen (D2b `spiffeServerIdentity`, Christian-Gate) +
Adversarial-Regressionstest. Spezifiziert als ADR-035 **A4b / TODO TL-28b**.

## Tests / Verifikation
- `discovery.test.ts` **+6**: `resolveMdnsRequeryIntervalMs` (0/neg/undefined/NaN→0, Klemmung,
  floor); `reQuery()` nach browse() → `Browser.update()`; reQuery vor browse() no-op; reQuery bei
  `mdns_enabled=false` no-op.
- `config-mdns-pin.test.ts` **+4**: Default 30000; Env 0 → aus; Env 60000; non-numerisch/negativ ignoriert.
- `inbound-peer-learner.ts`/`.test.ts`: **unverändert gegenüber main** (der Fallback wurde vollständig
  zurückgenommen; das bestehende „leere remoteAddress → fetch-failed" bleibt fail-closed).
- **1509 gesamt grün**, `tsc --noEmit` sauber, keine neuen ESLint-Errors.
- CR: claude-Review-Subagent (PASS) + Codex-Review auf PR (CHANGES-NEEDED → Fallback entfernt).

## Abgrenzung
Nur A4a (Re-Query). A1 (Peer-Cache, TL-26, CO-gated), A2 (Boot-Re-Learn, TL-27), A4b (identitäts-
gebundener Fallback, TL-28b, gated) und B (Hub-Pull, TL-29, CO-gated) bleiben eigene Slices.
**Kein Deploy, keine Secrets, keine Gates berührt.**

## Status
Offen (PR #258 gegen main).
