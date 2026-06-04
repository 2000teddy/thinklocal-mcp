# Live-Test: Observer Agent Phase 1

**Datum:** 2026-04-15, 08:30–08:50 Europe/Berlin
**PR:** #132 (gemerged)
**ADR:** ADR-018

## Ziel

Verifizieren dass der Observer-Agent:
1. Auf macOS (MacMini) und Linux (ioBroker) laeuft
2. Read-only System-Probes sauber ausfuehrt
3. Graceful degradiert wenn Ollama fehlt
4. Echte Befunde ueber das LLM extrahiert (strukturiertes JSON)

## Setup

- **MacMini** (10.10.10.94) — 16 GB RAM, macOS, Ollama lokal, Observer direkt
- **ioBroker** (10.10.10.52) — 11.7 GB RAM, Debian 12 Bookworm, **kein Ollama**,
  Probes lokal, Analyse auf MacMini-Ollama

## Test 1 — MacMini, Ollama lokal, gemma4:e4b

**Ergebnis:** Modell zu langsam (>2 min pro Prompt), Inferenz-Timeout.

Erkenntnis: `gemma4:e4b` ist auf 16 GB RAM theoretisch passend, aber auf dem
M2 mit parallel laufendem Daemon/VS-Code praktisch zu langsam fuer Cron-Betrieb.

## Test 2 — MacMini, Ollama lokal, granite3.1-moe:3b

**Ergebnis:** Lief durch, aber ebenfalls sehr langsam (>17s fuer "Say hi").
Ollama hat ein Setup-Problem auf diesem Laptop — nicht Observer-bedingt.

## Test 3 — MacMini, Ollama lokal, llama3.2:latest (3B)

**Ergebnis:** ✅ Durchlauf in ~60s, 0 Findings (MacMini ist gesund).

```json
{
  "node": "minimac-2032.local",
  "model": "llama3.2:latest",
  "checks_run": 10,
  "findings": []
}
```

## Test 4 — ioBroker Probes + MacMini-Analyse (Cross-Host)

**Schritt 1:** Probes auf ioBroker ausfuehren (Linux).
**Schritt 2:** JSON-Output vom ioBroker holen (10.8 KB).
**Schritt 3:** Analyse mit `llama3.2:latest` auf MacMini.

**Ergebnis:** ✅ 5 echte Findings!

### Befunde auf ioBroker

| # | Severity | Kategorie | Befund |
|---|----------|-----------|--------|
| 1 | warning | disk | `/` Root-Partition zu 98% voll (29G/32G frei: 875M) |
| 2 | info | memory | thinklocal-daemon (pid 1072540): 232 MB RSS |
| 3 | **error** | services | `networking.service` failed to start |
| 4 | info | logs | Core-Dump von `e3dcset` (E3DC Energiemanagement) |
| 5 | warning | cron | Cron-Job `e3dcset` laeuft taeglich 22:20 |

**Kritisch:** Die Root-Partition ist zu 98% voll. Das ist ein echtes Problem
das ohne Observer unentdeckt geblieben waere.

## Test 5 — ioBroker ohne Ollama (Graceful Degradation)

**Ergebnis:** ✅ Sauberer Error, kein Crash.

```json
{
  "node": "iobroker",
  "checks_run": 0,
  "findings": [],
  "raw_error": "Ollama not reachable or model 'qwen3.5:4b' not installed. Run: ollama pull qwen3.5:4b"
}
```

Der Observer erkennt die fehlende Ollama-Verfuegbarkeit und gibt einen
klaren Install-Hinweis. Exit-Code 0, kein Crash.

## Fix waehrend des Live-Tests

**Problem:** `apt list --upgradable` lieferte auf dem ioBroker 31 KB Output
(alte Updates-Liste). Das blaeht den LLM-Prompt auf und fuehrt zu
Inferenz-Timeouts.

**Fix (commit 9c959a4):** `apt-upgradable` zaehlt nur noch die Pakete und
zeigt die ersten 20 Zeilen. Prompt-Groesse reduziert von 37 KB auf ~8 KB.

## Probe-Performance auf ioBroker

Alle 10 Probes parallel: **< 200 ms gesamt** (auf Debian mit systemd, apt etc.).

| Probe | Bytes | Zeit |
|-------|-------|------|
| disk-usage | 635 | 38 ms |
| memory | 206 | 36 ms |
| uptime | 70 | 35 ms |
| kernel | 100 | 34 ms |
| os-release | 267 | 33 ms |
| failed-services | 361 | 32 ms |
| recent-logs | 465 | 55 ms |
| user-cron | 3168 | 31 ms |
| apt-upgradable (nach Fix) | ~1000 | ~50 ms |
| top-mem | 2007 | 35 ms |

## Erkenntnisse

### Was funktioniert hat
1. **Probe-Whitelist** — Alle 10 Probes laufen auf macOS und Linux sauber
   (auf macOS fallen Linux-spezifische wie `systemctl` in den Error-Pfad, ohne Crash)
2. **JSON-Parser** — Auch verbose/Markdown-umschlossene Modell-Antworten werden korrekt geparst
3. **Graceful Degradation** — Kein Ollama → klarer Error statt Crash
4. **Strukturierte Findings** — Das LLM liefert konsistent gueltiges JSON mit validen Severities
5. **Echte Probleme entdeckt** — Disk 98%, failed service, core dump

### Was optimiert werden muss

1. **Modell-Auswahl** — `gemma4:e4b` auf 16 GB RAM ist theoretisch passend, aber zu langsam
   fuer Cron. `llama3.2:3b` oder `qwen3:14b` waeren bessere Defaults.
2. **Prompt-Volumen** — Grosse Probe-Outputs muessen vorab getrimmt werden (siehe apt-upgradable Fix).
3. **Cross-Host-Analyse** — Die Kombination "Probes lokal, LLM remote" funktioniert gut
   und spart RAM auf kleinen Nodes. Sollte als Pattern in Phase 2 unterstuetzt werden.

## Naechste Schritte

1. **Phase 1 erweitern:**
   - Modell-Selector: "Inference-Speed" als Kriterium, nicht nur RAM
   - `OLLAMA_HOST` Remote-Fallback als erste-Klasse-Option
   - Audit-Log der Observer-Runs

2. **Phase 2:**
   - Observer-Ergebnisse via Mesh an Admin-Node schicken
   - Dashboard-UI fuer Observer-Historie
   - Korrelation: "Disk 98% auf ioBroker" + "Cron failing" → gemeinsame Ursache

3. **Phase 3 (ThinkHub):**
   - Observer-Profile als installierbare Skills
   - Community-Profile: "backup-monitor", "security-auditor"

## Referenzen

- ADR-018 — Observer Agent Architektur
- PRO_CON_THINKBIG.md — Vision + Multi-Modell-Analyse
- PR #132 — Observer Agent Phase 1 (gemerged)
- Fix: commit 9c959a4 — apt-upgradable Prompt-Groesse
