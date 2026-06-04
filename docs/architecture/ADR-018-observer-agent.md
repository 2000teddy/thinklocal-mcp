# ADR-018: Observer Agent — Lokale Intelligenz fuer headless Nodes

**Status:** Accepted (Phase 1)
**Datum:** 2026-04-14
**Autor:** Christian (Vision), Claude Opus 4.6 (Implementierung)
**Verwandt:** PRO_CON_THINKBIG.md, ADR-008 (Dynamic Capabilities)

## Kontext

99% der Nodes in einem Mesh sind headless — Raspberry Pis, Server, NAS-Systeme,
IoT-Gateways. Niemand loggt sich taeglich ein. Dinge brechen still und
unbemerkt:

- Backup-Cron-Jobs laufen seit Monaten fehl
- Disk-Space wird schleichend voll
- Services crashen nachts, werden automatisch restartet, niemand merkt's
- Sicherheitsupdates werden nicht eingespielt
- WLAN-Firmware-Bugs verursachen regelmaessige Ausfaelle

Der Daemon ist deterministisch (richtig so) und kann diese Muster nicht
erkennen. Eine LLM-Intelligenz **auf dem Node selbst** kann proaktiv nachschauen.

Siehe `docs/analysis/PRO_CON_THINKBIG.md` fuer die vollstaendige Pro/Contra-Analyse.

## Entscheidung

Wir bauen einen **separaten Observer-Agent-Prozess** (kein Daemon-Embed):

### Kern-Prinzipien

1. **Daemon bleibt deterministisch** — keine AI im Daemon-Prozess
2. **Agent ist optionaler Skill** — installierbar via ThinkHub oder manuell
3. **Read-only by default** — Agent meldet, fuehrt nichts aus
4. **Cron-basiert** — laeuft alle 4h, nicht dauerhaft (Energie + Ressourcen)
5. **Lokales Modell** — nutzt Ollama mit RAM-basierter Modell-Auswahl
6. **Mesh-Integration** — Ergebnisse als Inbox-Nachricht an Admin-Node

### Architektur

```
┌──────────────────────────────────────────────────────┐
│  DAEMON (port 9440)                                  │
│  - REST API, Messaging, Skills                       │
│  - Deterministisch                                   │
└──────────────────────────────────────────────────────┘
              ▲
              │ HTTP (loopback)
              │
┌─────────────┴────────────────────────────────────────┐
│  OBSERVER AGENT (separater Prozess, via cron)       │
│                                                      │
│  1. RAM pruefen → Modell auswaehlen                  │
│  2. Read-only System-Checks ausfuehren               │
│  3. Ergebnisse via Ollama analysieren                │
│  4. Auffaelligkeiten als Inbox-Nachricht senden      │
│  5. Beenden (kein Dauerlauf)                         │
└──────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────┐
│  OLLAMA (port 11434, optional)                      │
│  - Lokales LLM                                       │
│  - Wird nur bei Observer-Run aufgerufen              │
└──────────────────────────────────────────────────────┘
```

### Modell-Auswahl (nach verfuegbarem RAM)

| RAM | Modell | Groesse | Usecase |
|-----|--------|---------|---------|
| < 4 GB | (kein Agent) | — | Nur Daemon |
| 4-8 GB | qwen3.5:0.6b | ~800 MB | Basis-Checks, Log-Parsing |
| 8-16 GB | qwen3.5:4b | ~3 GB | Coding + Analyse |
| 16-32 GB | gemma4:e4b | ~5 GB | Vollwertiger Sys-Admin |
| > 32 GB | gemma4:26b | ~17 GB | Coding-Agent-Qualitaet |

### Sichere Checks (Whitelist, autonom)

```typescript
const SAFE_COMMANDS = [
  'df -h',                    // Disk-Space
  'free -m',                  // RAM
  'uptime',                   // System-Load
  'uname -a',                 // Kernel
  'lsb_release -a',           // OS-Version
  'systemctl list-units --failed', // Fehlgeschlagene Services
  'journalctl --since "24h ago" --no-pager | tail -200',
  'crontab -l',               // Cron-Jobs (aktueller User)
  'apt list --upgradable',    // Updates (nur LESEN)
  'ps aux --sort=-%mem | head -20', // Memory-Hog-Prozesse
];
```

### Unsichere Aktionen (brauchen Approval)

- `sudo apt upgrade` — meldet als Vorschlag, wartet auf Approval
- Service restart — Vorschlag, nicht automatisch
- Config-Aenderungen — niemals automatisch
- Cron-Job-Aenderungen — niemals automatisch

### Output-Format

Der Agent sendet eine Inbox-Nachricht an den Admin-Node:

```json
{
  "to": "spiffe://thinklocal/host/<admin>/agent/claude-code",
  "subject": "[observer] iobroker: 2 Befunde",
  "body": {
    "node": "iobroker",
    "timestamp": "2026-04-14T23:45:00Z",
    "model": "qwen3.5:4b",
    "checks_run": 10,
    "findings": [
      {
        "severity": "warning",
        "category": "backup",
        "message": "Cron-Job 'backup-daily' schlaegt seit 2026-02-10 fehl (47 Tage). Logs zeigen: Permission denied auf /mnt/nas.",
        "evidence": "crontab + journalctl output",
        "suggested_action": "Pruefen ob NAS-Mount aktuell ist: mount | grep nas",
        "auto_fix_available": false
      },
      {
        "severity": "info",
        "category": "updates",
        "message": "12 Sicherheitsupdates verfuegbar. Letztes 'apt upgrade': vor 89 Tagen.",
        "evidence": "apt list --upgradable",
        "suggested_action": "sudo apt update && sudo apt upgrade",
        "auto_fix_available": true,
        "auto_fix_requires_approval": true
      }
    ]
  }
}
```

## Phasen

### Phase 1 (dieser PR): Observer-Prototyp

- `packages/observer/src/observer-agent.ts` — Hauptprozess
- `packages/observer/src/system-probes.ts` — read-only Checks
- `packages/observer/src/ollama-client.ts` — Minimalclient fuer Ollama
- `packages/observer/src/model-selector.ts` — RAM-basierte Auswahl
- CLI: `thinklocal observer run` (manuell) oder per Cron
- Tests: 20+ Unit-Tests
- Live-Test auf ioBroker (4 GB RAM, qwen3.5:0.6b)

### Phase 2 (spaeter): Smart Observer

- Muster-Korrelation ueber mehrere Checks
- Natuerliche-Sprache-Interface ueber Daemon
- Mesh-weite Korrelation (Peer X hat Problem Y, Peer Z hat Problem Y)

### Phase 3 (Zukunft): ThinkHub Agent-Skills

- Agent-Profile als installierbare Skills: "sys-admin", "backup-monitor", etc.
- Versioniert, signiert, mit Attestation
- Community-Skills (z.B. "home-assistant-monitor")

## Alternativen die verworfen wurden

### A) AI direkt im Daemon einbetten
Verworfen: Verletzt Determinismus-Prinzip. Daemon ist Infrastructure.

### B) Nur Shell-Skripte
Verworfen: Kann unerwartete Muster nicht erkennen. "Rauchmelder vs Feuerwehrmann".

### C) Cloud-API-basiert
Verworfen: Abhaengig von Internet + API-Keys. Nicht fuer kritische Infrastruktur.

### D) Dauerhaft laufender Agent
Verworfen: Ressourcenverbrauch (3-5W Dauerlast). Cron-basiert ist ausreichend.

## Konsequenzen

**Positiv:**
- Headless Nodes werden "gesehen" — proaktive Wartung moeglich
- Demokratisiert Sys-Admin-Expertise (natuerliche Sprache)
- Foundation fuer ThinkHub Agent-Ecosystem
- Keine Cloud-Abhaengigkeit

**Negativ:**
- Zusaetzlicher Prozess (auch wenn nur per Cron)
- Modell-Wartung: Welches Modell, welche Version?
- Prompt-Injection-Risiko wenn Log-Daten in Prompts landen

**Mitigationen:**
- Strikte Whitelist fuer Befehle
- Read-only Default
- Modell-Auswahl versioniert in ThinkHub
- Prompt-Templates sanitized (keine rohen Log-Daten)

## Referenzen

- `docs/analysis/PRO_CON_THINKBIG.md` — Multi-Modell-Analyse
- ADR-008 — Dynamic Capabilities (Skill-Framework)
- ADR-016 — Token-Onboarding (Trust-Infrastruktur)
