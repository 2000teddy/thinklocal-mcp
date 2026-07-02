# T1.1 — RSS/CPU-Live-Messung `tsx` → `node dist/` (V5 Spur 1, DoD-Abschluss)

**Datum:** 2026-07-02
**Branch:** `claude/t11-rss-cpu-live-measure`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Evidence/Messung — Doku-only, KEINE Produktionscode-Änderung, KEIN Deploy
**Bezug:** `docs/operations/T1.1-rss-cpu-measurement.md` (Runbook); Startumstellung gemergt
(PR #217), Mess-Primitive gemergt (PR #235: `rss-cpu-stats.ts` + `measure-daemon-rss-cpu.mjs`).

## Ziel

Den offenen DoD-Teil von T1.1 — „RSS/CPU vorher/nachher **gemessen**" — mit realen,
reproduzierbaren Zahlen schließen. Die Code-Umstellung (`start`/`daemon:start`/systemd
`ExecStart` → `node dist/index.js`, `start:tsx` als Dev-Fallback) ist bereits live; offen
war nur der Zahlen-Nachweis, der einen Live-Lauf braucht.

## Methodik (identisch für beide Läufe)

- Host: TH01/ThinkHub. **Isolierte** Mess-Instanz, um den Produktiv-Daemon (Port 9440)
  und den LAN-Mesh nicht zu stören:
  `TLMCP_RUNTIME_MODE=local` (loopback-bind, Security-Invariante), `TLMCP_LIBP2P_ENABLED=0`,
  `TLMCP_MDNS_ENABLED=0`, `TLMCP_PORT=9460`, `TLMCP_DATA_DIR=/tmp/t11-measure` (temporär).
- Gleicher `TLMCP_DATA_DIR` für beide Läufe → dieselbe Identität/Cert (kein Reissue-Bias).
- 20 s Warmup, dann **n = 60** Samples @ 1 s. Prozessbaum-Sampling (root + Nachfahren):
  - **tsx (vorher):** root = node-`tsx`-Runtime; Baum = tsx-node + Daemon-Kind (+ esbuild).
  - **node dist (nachher):** root = Daemon-Prozess (Einzelprozess).
- Teardown rein numerisch per PGID (kein `pkill -f`-Pattern, das die Mess-Shell selbst
  matchen würde).

### Reproduktion

```bash
cd packages/daemon && npx tsc                       # dist bauen
export TLMCP_RUNTIME_MODE=local TLMCP_LIBP2P_ENABLED=0 TLMCP_MDNS_ENABLED=0 \
       TLMCP_PORT=9460 TLMCP_DATA_DIR=/tmp/t11-measure
# vorher:
setsid npx tsx src/index.ts >/tmp/t11-tsx.log 2>&1 & ; sleep 20
DPID=$(ss -ltnp | grep ':9460 ' | grep -oP 'pid=\K[0-9]+' | head -1); ROOT=$(ps -o ppid= -p $DPID)
node ../../scripts/measure-daemon-rss-cpu.mjs --pid $ROOT --samples 60 --interval-ms 1000 >before-tsx.json
kill -TERM -$(ps -o pgid= -p $DPID | tr -d ' ')
# nachher (node dist): root = Listener-PID selbst; sonst identisch
node ../../scripts/measure-daemon-rss-cpu.mjs --compare before-tsx.json after-node.json
```

## Ergebnis (n = 60 je Modus)

| Metrik | tsx (vorher) | node dist (nachher) | Δ |
|---|---|---|---|
| RSS mean (MiB) | 215.8 | 129.1 | **-40.2%** |
| RSS p95 (MiB)  | 216.6 | 129.8 | **-40.1%** |
| RSS max (MiB)  | 216.6 | 129.8 | **-40.1%** |
| CPU mean (%)   | 4.82  | 2.63  | **-45.5%** |
| CPU p95 (%)    | 9.00  | 4.90  | **-45.6%** |

**Verdikt:** `node dist/` spart **~40 % RSS** (≈ 87 MiB) und **~46 % CPU-Grundlast** vs.
`tsx` — kein esbuild-Transform-Prozess, keine In-Memory-Source-Transformation zur Laufzeit.
Runbook-Erwartung **empirisch bestätigt**. Extrem stabile Verteilung (RSS-Spread <1 %,
p50≈p95≈max) → n=60 statistisch tragfähig.

**Caveat:** Absolutwerte einer isolierten Instanz (local-Modus, ohne libp2p/mDNS) liegen
unter einem voll vermaschten Produktions-Daemon. Das **Δ (tsx→node)** ist bei identischer
Konfiguration beider Läufe das belastbare DoD-Signal (tsx-Loader-Overhead ist weitgehend
last-unabhängig additiv).

## Roh-JSONs (Sampler-Output, unverändert)

**`before-tsx.json`:**
```json
{
  "rss": { "count": 60, "mean": 226312192, "p50": 226185216, "p95": 227094528, "min": 225595392, "max": 227094528 },
  "cpu": { "count": 60, "mean": 4.816666666666666, "p50": 4.1, "p95": 9, "min": 2.5, "max": 10.5 }
}
```

**`after-node.json`:**
```json
{
  "rss": { "count": 60, "mean": 135397239.46666667, "p50": 135143424, "p95": 136065024, "min": 134586368, "max": 136065024 },
  "cpu": { "count": 60, "mean": 2.626666666666667, "p50": 2.2, "p95": 4.9, "min": 1.4, "max": 5.6 }
}
```

## Was dieser Slice NICHT tut

Keine Produktionscode-Änderung, kein Deploy, keine Konfig-Änderung. Nur der Live-Zahlen-
Nachweis + Ablage in `docs/operations/T1.1-rss-cpu-measurement.md` (Ergebnis-Sektion). Damit
ist der DoD-Mess-Teil von T1.1 geschlossen.
