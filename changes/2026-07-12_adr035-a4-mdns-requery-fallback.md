# changes/2026-07-12 — feat(discovery): ADR-035 A4 — periodisches mDNS-Re-Query + remoteAddress-Fallback

**Typ:** Daemon-Code (`discovery.ts`, `inbound-peer-learner.ts`, `config.ts`, `index.ts`) + Tests + Config + Design-Doku (ADR-035-Slice-Tabelle) + TODO.
**Slice:** ADR-035 A4 / TODO TL-28. Folge auf A3 (TL-25a, PR #257).
**Auftrag:** Christian (via Fable-5, 11.07. 22:05) — „Discovery überlebt Neustart-Wellen nicht" — freigegeben als nächster nicht-gate Slice (12.07. 07:17).

## Warum
Aus dem ADR-035-Root-Cause (Ebene 2): `bonjour.find()` setzt nur **einen** initialen aktiven
PTR-Query ab und lauscht danach **passiv**; es gibt keinen anwendungseigenen periodischen
Re-Query. In einer Neustart-Welle kommen Knoten zeitversetzt hoch → wer den Announce/die
Antwort des anderen verpasst, sieht ihn ohne static_peer nie wieder. Zusätzlich (Ebene 3):
der ADR-026-Async-Learn brach bei **leerer** TLS-`remoteAddress` fail-closed ab (bestimmte
Cross-Subnet/NAT-Verbindungen liefern keine Source-IP), obwohl die Adresse aus dem
mDNS-/Discovery-Wissen bekannt sein kann.

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
- **`inbound-peer-learner.ts`**: neue optionale Dep `resolveFallbackAddress?: () => string|undefined`.
  Wird **nur** konsultiert, wenn `remoteAddress` leer ist; liefert sie eine Adresse, wird die Card
  von dort geholt. Die **Identitätsprüfung bleibt unverändert scharf** (Card-SAN == attestierte
  PeerID **und** PublicKey vorhanden) → die Substitution ist **AUTHN-neutral**: eine falsche
  Fallback-Adresse führt schlimmstenfalls zu `rejected-identity`, nie zu Auflösung auf eine fremde
  Identität. Ohne Treffer bleibt es fail-closed (`fetch-failed`). Fehlende Dep → altes Verhalten.
- **`index.ts`** (Learner-Callsite): `resolveFallbackAddress: () => mesh.getPeer(peerIdToSpiffeUri(info.peerId))?.host`.
- **`config.ts`** + **`config/daemon.toml`**: neues Feld `discovery.mdns_requery_interval_ms`
  (Default 30000), Env `TLMCP_MDNS_REQUERY_MS` (non-numerisch/negativ → ignoriert, Default bleibt).

## Tests / Verifikation
- `inbound-peer-learner.test.ts` **+5**: leere remoteAddress + Fallback → Fetch gegen Fallback +
  recorded; Fallback URL-sicher gebracketet (IPv4-mapped/IPv6); Fallback undefined → fetch-failed;
  Fallback NICHT konsultiert wenn remoteAddress vorhanden; **falsche Fallback-Adresse mit
  Fremd-Card → rejected-identity (Beweis der AUTHN-Neutralität, kein Trust-Leak)**.
- `discovery.test.ts` **+6**: `resolveMdnsRequeryIntervalMs` (0/neg/undefined/NaN→0, Klemmung,
  floor); `reQuery()` nach browse() → `Browser.update()`; reQuery vor browse() no-op; reQuery bei
  `mdns_enabled=false` no-op.
- `config-mdns-pin.test.ts` **+4**: Default 30000; Env 0 → aus; Env 60000; non-numerisch/negativ ignoriert.
- **1514 gesamt grün**, `tsc --noEmit` sauber, keine neuen ESLint-Errors.
- CR: claude-Review-Subagent (adversarial, AUTHN/AUTHZ-Fokus).

## Abgrenzung
Nur A4. Die Peer-Cache-Persistenz (A1/TL-26, CO-gegatet), das aggressive Boot-Re-Learn (A2/TL-27)
und die Hub-verankerte Pull-Discovery (B/TL-29, CO-gegatet) bleiben eigene Slices. **Kein Deploy,
keine Secrets, keine Gates berührt.**

## Status
Offen (PR gegen main).
