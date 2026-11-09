# TL-15 — Uhr-Abweichungs-Erkennung zwischen Partnern

**Status:** umgesetzt (2026-11-09, PR #368; Klassifikation nach CR-Runde 1 auf drei Zustände korrigiert)
**Auftrag:** `TODO.md` TL-15 (≈3 h) — „Uhr-Abweichungs-Erkennung zwischen Partnern
(Skew-Messung im Handshake/Heartbeat, Alarm ab Schwelle; Kap. 3.5/3)"
**Vorlage:** TL-18-Muster (reines Messmodul + Monitor, drei Alarmwege, drei Sinks)

---

## 1. Warum das überhaupt nötig ist

Mehrere Pfade im Daemon treffen Entscheidungen anhand **absoluter** Zeit, und zwar mit
Werten, die von einem **anderen** Rechner kommen:

| Pfad | Stelle | Was eine schiefe Uhr anrichtet |
|---|---|---|
| TLS-Gültigkeitsfenster | `tls.ts:595` | „not yet valid" / „expired" obwohl das Cert gültig ist |
| Peer-Cache | `peer-cache.ts:132` | Zukunfts-Timestamps werden verworfen — ein vorlaufender Peer fällt aus dem Cache |
| Signierter Auftrag (TL-12) | `ttl_ms`-Auswertung | ein TTL-Fenster, das auf der Gegenseite nie oder immer offen ist |
| Cert-Ablauf-Monitor | `cert-expiry-monitor.ts` | Warn-/Critical-Tier auf falscher Restlaufzeit |

Diese Stellen behandeln die Folge (defensiv wegwerfen, fail-closed). **Keine** von ihnen
nennt die Ursache, und es gab repo-weit **keine** Messung: `git grep -niE
"skew|clock_offset|clockDrift|time_drift"` über `packages/*/src` liefert genau zwei
Treffer, beide reine Kommentare an den oben genannten Stellen, und `docs/` **null**.
Ein Operator sieht also die Symptome, nie den Grund.

## 2. Die Messstelle existiert bereits — kein Protokoll-Eingriff

Der Heartbeat holt ohnehin alle `mesh.heartbeat_interval_ms` (Default 10 s) bei jedem
nicht-offline Peer `GET ${peer.endpoint}/health` (`checkPeers` in `mesh.ts`; vor diesem Slice Zeile 604). Diese Antwort trägt
**schon heute** die Partner-Uhrzeit:

```ts
// agent-card.ts:256
return { status: 'ok', timestamp: new Date().toISOString() };
```

`checkPeers` **verwarf den Body** — es prüfte nur `response.ok` (vor diesem Slice `mesh.ts:599-619`; die Messung sitzt jetzt direkt hinter `recordHeartbeat`).

Daraus folgt der Zuschnitt: TL-15 braucht **keinen** neuen Endpunkt, **keine**
Wire-Format-Änderung, **keine** Peer-Versions-Abhängigkeit und **keinen** zusätzlichen
Netzverkehr. Es liest ein Feld, das bereits auf dem Draht liegt und bereits geholt wird.
Damit entfällt auch die Frage „Handshake **oder** Heartbeat" aus dem TODO-Text: der
Heartbeat ist der Ort, an dem die Messung gratis ist, und er wiederholt sich — ein
Handshake-Wert wäre eine Einmalmessung beim Verbindungsaufbau.

## 3. Wie gemessen wird: Offset statt Differenz

Die naive Rechnung `localNow - peerTimestamp` ist **falsch**, weil sie die halbe
Laufzeit der Antwort als Uhrenabweichung ausgibt. Stattdessen die NTP-übliche
Offset-Schätzung über das lokale Sende-/Empfangsfenster:

```
t0   = lokale Zeit unmittelbar VOR dem fetch
t1   = lokale Zeit NACH dem Lesen des Bodys
tp   = `timestamp` aus der Antwort
rtt        = t1 - t0
skewMs     = tp - (t0 + t1) / 2        // > 0 ⇒ Peer läuft vor
uncertainty = rtt / 2
```

**Klassifikation konservativ in beide Richtungen.** Der wahre Offset liegt im
Intervall `[|skew| - u, |skew| + u]`; entschieden wird nur, was dieses Intervall
hergibt:

- `skewed`, wenn die **untere** Schranke die Schwelle überschreitet,
- `ok`, wenn die **obere** Schranke sie einhält,
- `unknown` dazwischen — die RTT war zu hoch für eine belastbare Aussage, und
  `unknown` ist für die Hysterese neutral.

Netzlaufzeit allein kann damit weder alarmieren noch eine Erholung vortäuschen. Die
erste Fassung prüfte **nur** die untere Schranke und gab alles andere als `ok` aus;
das ist auf dem Hinweg konservativ, auf dem **Rückweg** aber das Gegenteil (CR-Runde 1,
MEDIUM-2): ein Peer mit konstant 6 s Vorlauf hätte bei einer RTT-Spitze von 3 s als
„ok" gezählt und die in sich widersprüchliche Meldung „behoben: läuft jetzt 6.0 s vor
(Schwelle 5.0 s)" erzeugt. Die bewusste Richtung bleibt: ein verpasster Skew-Alarm
kostet Diagnosezeit, ein falscher kostet Vertrauen in den Kanal.

## 4. Flap-Dämpfung ist Teil des Slices, nicht sein Rest

TL-18 hat die Dämpfung offengelassen und das als Rest benannt. Hier **nicht**: ein
Peer, dessen Uhr an der Schwelle wackelt, würde sonst alle 10 s eine Telegram-Nachricht
erzeugen. Übernommen wird die Hysterese-Mechanik des `SkillHealthMonitor`
(`applyResult` in `skill-health-monitor.ts`): pro Peer ein Zustand `ok | skewed`, und der kippt
erst nach `clock_skew_debounce` **aufeinanderfolgenden** gleichgerichteten Messungen.
Alarmiert wird **ausschließlich der Zustandswechsel** (`ok→skewed` und `skewed→ok`),
nicht die Messung. Bei Default-Debounce 3 und 10-s-Heartbeat heißt das: ein Flip
braucht ~30 s Bestätigung, und ein dauerhaft schiefer Peer erzeugt **eine** Nachricht,
nicht 8640 pro Tag.

Nicht klassifizierbare Messungen (Body unlesbar, `timestamp` fehlt/unparsbar) sind
**neutral**: sie zählen weder für noch gegen einen Flip und lassen den Zustand stehen.
Sonst würde ein Peer mit altem Daemon ohne `timestamp`-Feld als „wieder gut" gelten.

## 5. Default: aus. Begründet.

`mesh.clock_skew_threshold_ms` hat Default **0 = aus**, nach dem Vorbild von
`placement.refuse_cpu_percent` / `refuse_agent_count` (`config.ts`), **nicht** nach dem
von `refuse_ram_percent: 90`.

Grund: ein Default-an würde am laufenden Dienst sofort Alarme erzeugen. In dieser Flotte
sind mehrere Peers schlafende macOS-Rechner (`.55`, `.52`, `.44`, `.158`) — genau die
Klasse, die nach dem Aufwachen Uhrensprünge zeigt. Ein Slice, der ohne Zutun des
Operators eine Telegram-Flut auslösen kann, ist kein inerter Slice. Die Messung und
alle drei Alarmwege sind fertig und getestet; **die Aktivierung ist eine
Betriebsentscheidung**, kein Code-Default.

Solange die Schwelle 0 ist, wird der Health-Body auch **nicht gelesen** — das Verhalten
des Heartbeats ist dann byte-für-byte das bisherige.

## 6. Schnitt der Module

```
clock-skew.ts            rein, ohne I/O:
  parsePeerTimestamp()     ISO-8601-String mit Zone → ms | null
  estimateClockSkew()      {sentAt,receivedAt,peerTimestamp} → {skewMs,rttMs,uncertaintyMs} | null
  classifyClockSkew()      Schätzung + Schwelle → 'ok' | 'skewed' | 'unknown'
  ClockSkewMonitor         Hysterese pro Peer; observe() → Transition | null; forget()
  observeHeartbeatSkew()   fail-open-Klammer um Body-Lesen + Messen + observe()

mesh.ts                  nur die zwei Zeilen Zeitnahme + ein Aufruf; inert ohne Monitor
events.ts                + 'system:clock_skew'
audit.ts                 + 'CLOCK_SKEW_WARNING'   (Vorbild CERT_EXPIRY_WARNING)
config.ts                + mesh.clock_skew_threshold_ms / clock_skew_debounce (+ Env, + Range)
index.ts                 Monitor bauen (nur wenn Schwelle > 0) + die drei Alarmwege
telegram-gateway.ts      + case 'system:clock_skew'
Toasts.tsx / EventFeed.tsx   parallele Sinks (die TL-18-Lektion)
```

`observeHeartbeatSkew` existiert als eigene Funktion, damit die **fail-open-Klammer**
(Body unlesbar, kein JSON, falscher Typ, werfender Reader) unit-testbar ist, ohne
`undici` zu mocken — dafür gibt es im Repo keinen Präzedenzfall. `mesh.ts` behält
dadurch nur Zeitnahme und Weitergabe.

## 7. Grenzen

- **Ein Alarmkanal.** Wie bei TL-18 geht der Alarm an Telegram, Dashboard und Audit —
  nicht an eine Zeitquelle. TL-15 **korrigiert keine Uhr** und synchronisiert nichts;
  das wäre NTP und gehört nicht in den Daemon.
- **Die Gegenseite muss `timestamp` liefern.** Alle Nodes dieses Repos tun das
  (`agent-card.ts:256`, unverändert seit Phase 1), ein fremder/alter `/health` ohne das
  Feld ist `unknown` und damit neutral.
- **Kein Live-Beleg.** Dass eine Nachricht bei einem echten schiefen Peer ankommt,
  bräuchte einen Peer mit verstellter Uhr — das ist ein Betriebsschritt, kein
  Agent-Schritt.
