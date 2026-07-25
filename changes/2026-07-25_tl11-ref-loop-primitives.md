# changes/2026-07-25 — docs(tl11): §6-Referenz-Konsument an die getesteten Primitive angebunden

**Typ:** **Doc-only**. Kein Code/Test-Diff, keine Entscheidung, kein Deploy/Secret/Host. De-riskt den letzten
Hop weiter, ohne den Slice-B-Blocker zu entfernen.

## Die Lücke
Der §6-Referenz-Konsument (`TL-11-wake-consumer-contract.md`) zeigte die **Frame-Interpretation** als
hand-ausgeschriebenes `JSON.parse` + `ev.type === 'agent:wake'` + `ev.data?.reason`. Genau diese Stelle hatte
in einer früheren Fassung die `ev.reason`-statt-`ev.data.reason`-Fehlklasse (#282). Seit #331 gibt es dafür
einen **getesteten, mutations-verifizierten** Kern (`wake-consumer-reference.ts` — `interpretWakeFrame` /
`coldStartSweepDecision`, §6.1), aber die kopierbare Referenz in §6 nutzte ihn nicht — ein Supervisor-Autor,
der §6 kopiert, hätte die Interpretation **neu (und ggf. neu falsch)** geschrieben.

## Was
§6-Pseudocode umgestellt: die Interpretation läuft jetzt über die Primitive
(`const d = interpretWakeFrame(raw); if (d.poke) pokeCli(d.reason);` bzw. `coldStartSweepDecision()` im
`open`-Handler). Ein Import-Kommentar macht klar: der Supervisor vendored/kopiert `wake-consumer-reference.ts`
(getestet) und schreibt nur noch **Transport** (WS/mTLS/Reconnect) und `pokeCli` — die zwei
out-of-repo/gateten Teile. Damit kann die frühere §6-Fehlklasse gar nicht erst nachgebaut werden. Die
Abschlusszeile benennt Transport **und** `pokeCli` als die zwei Slice-B-Teile (vorher nur `pokeCli`).

**Keine Verhaltens-/Vertragsänderung** — dieselben §3/§4/§5-Garantien, nur an den getesteten Kern gebunden
statt hand-ausgeschrieben.

## Compliance
- **CO/CG/TS:** entfallen — Doc-only, kein Code/Test-Diff; die Suite ist durch #333 unverändert **2071 grün**
  (145 Files); `clink`/`gemini` nicht im PATH.
- **CR:** externes Review am PR (Bot-Pfad) + Self-CR (Primitive existieren + Signatur `WakeDecision.poke`/
  `.reason` gegen `wake-consumer-reference.ts` geprüft).
- **PC:** Secret-Scan clean (nur Doku).
- **DO ✅:** dieser Eintrag, `docs/architecture/TL-11-wake-consumer-contract.md` §6, `TODO.md`, `CHANGES.md`,
  `COMPLIANCE-TABLE.md`.

**Unverändert gated:** TL-11 Slice B (Transport + `pokeCli` + Zwei-Peer-Live-Proof), ADR-046 §9, msg 1453,
TL-12-Gates — **nicht** berührt.
