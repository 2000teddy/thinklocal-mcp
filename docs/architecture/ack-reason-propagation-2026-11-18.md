# Design-Entscheidung: ACK-Grund auf die Sendeseite durchreichen (`ack_reason`)

Erstellt: 18.11.2026, 07:15 Uhr MEZ · Claude Code (Lane `Claude-ThinkHub-ThinkLocal-MCP`)
Status: **Angenommen** · Umfang: rein additiv · Keine neue TL-Nummer (bewusst — Nummernvergabe ist Christians Entscheidung)
Auslöser: `hermes/reports/thinklocal-kommunikation-2026-11-18.md` §3.2 / `…-matrix-2026-11-18.md` K3
Freigabe: Christian, 18.11.2026 (bedingte Freigabe „nach grünen Tests/Review kompatible Verbesserung übernehmen"), übermittelt durch den KW47-Watchdog 07:50 MEZ

## 1. Problem (gemessen, nicht vermutet)

Am 18.11.2026 wurden zwei Läufe (06:54:35 und 06:55:39) über alle bekannten Peers gefahren. Die Zustellung an
ThinkHub02 (10.10.10.82) scheiterte beide Male **zeichengleich**:

```json
{"status":"sent","delivery":"remote","message_id":"d68c5259-a663-4c28-b773-d910afb2aaed",
 "peer_status":200,"ack_verified":true,"ack_status":"rejected"}
```

Der Grund stand ausschließlich im Log des **Empfängers**:

```
{"level":40,"from":"spiffe://thinklocal/node/12D3KooWKZ4…Ynb","message_id":"7833d626-…",
 "msg":"AGENT_MESSAGE von nicht-gepairtem Sender abgelehnt"}
```

Der Empfänger setzt in genau diesem Zweig (`index.ts:904-919`) ein ACK mit
`reason: 'sender not in pairing store'`; der Zweig davor (`index.ts:897`) setzt
`reason: 'recipient mismatch'`. Beide Gründe sind im Typ vorgesehen
(`messages.ts:72-78`, `reason?: string`) und kommen signaturverifiziert beim Sender an —
aber `inbox-api.ts:312-323` übernimmt nur `ackPayload.status`:

```ts
ackStatus = ackPayload.status;
log?.info({ to: body.to, message_id: messageId, ack_verified: true, ack_status: ackPayload.status }, …);
…
return { …, ack_verified: ackVerified, ack_status: ackStatus };
```

**Folge:** Der Sender sieht „rejected" ohne Ursache. Die Diagnose der TH02-Strecke war erst
nach einem SSH-Login auf dem Empfänger möglich. Für eine automatische (stündliche) Prüfung ist
das der Unterschied zwischen „rot, Ursache steht da" und „rot, bitte manuell nachsehen".

## 2. Entscheidung

`ackPayload.reason` wird **zusätzlich** übernommen:

1. in die bestehende Log-Zeile `'AGENT_MESSAGE + ACK verifiziert'` als Feld `ack_reason`,
2. in die HTTP-Antwort von `POST /api/inbox/send` als Feld `ack_reason`.

**Nicht** Teil dieser Änderung: Transportverhalten, Retry, Pairing/ACL, Identitäten, Discovery,
`index.ts:904-919`, der Loopback-Zweig, bestehende Feldnamen und Statuswerte.

### 2.1 Warum kein Eingriff in `mcp-stdio.ts`

Beim Schreiben der Notiz verifiziert: `send_message_to_peer` (`mcp-stdio.ts:160-180`) gibt die
Antwort des Daemons unverändert weiter (`JSON.stringify(data, null, 2)`). Das neue Feld erscheint
dort also **ohne Codeänderung**. Der in der Vorlage genannte Punkt „zusätzlich im MCP-Werkzeug
durchreichen" ist damit konstruktionsbedingt erfüllt; eine zusätzliche Zeile wäre toter Code.

### 2.2 `reason` ist Fremdtext — und wird entschärft

Der Wert stammt vom **entfernten Peer** und landet in Log und API-Antwort. Nach
`architecture-v5/10-sicherheit.md` §10.3 gilt: „Fremdtext ist Rohstoff, nie Befehl. Er wird
entschärft angezeigt." Deshalb wird der Wert vor der Übernahme begrenzt:

- nur `string` wird übernommen (alles andere → Feld fehlt),
- Steuerzeichen (`U+0000–U+001F`, `U+007F`) werden entfernt — sonst kann ein Peer per `\n`
  gefälschte Logzeilen oder per ANSI-Sequenzen Terminalausgaben einschleusen,
- Länge auf 200 Zeichen begrenzt (gleiche Grenze wie `subject`, `mcp-stdio.ts:166`),
- ein nach dem Entschärfen leerer Wert → Feld fehlt.

Das ist Teil dieser Änderung und nicht optional: ohne die Entschärfung würde der Patch eine
Log-Injection-Fläche eröffnen, die es heute nicht gibt.

## 3. Rückwärtskompatibilität (bindend)

Im Mesh laufen heute ältere Builds: `e3acc1a` (10.07.2026, auf .56/.82/.222), `cec4f96` (08.07.),
`842cd7b` (13.07.), `a16b475` (31.08.) gegen TH01 `bda3ff6`. Ein ACK **ohne** `reason` ist der
Normalfall und muss es bleiben:

- `reason` fehlt ⇒ `ack_reason` fehlt in der Antwort (nicht `null`, nicht `""`), kein Fehler,
  kein geändertes Verhalten,
- `status: 'delivered'` ⇒ Antwortobjekt unverändert wie bisher,
- der Loopback-Zweig (`delivery: 'loopback'`) bleibt unberührt.

`ack_reason` ist damit ein **optionales, additives** Feld. Bestehende Aufrufer (Dashboard,
`mcp-stdio`, Skripte) brechen nicht.

## 4. Invarianten

| # | Invariante |
|---|---|
| I1 | `ack_status` behält genau die bisherigen Werte (`'delivered'` \| `'rejected'` \| `undefined`) |
| I2 | `ack_reason` erscheint **nur** wenn der Peer einen nicht-leeren String geliefert hat **und** das ACK signaturverifiziert war |
| I3 | `ack_reason` enthält keine Steuerzeichen und ist ≤ 200 Zeichen |
| I4 | Kein Pfad, der heute 200 liefert, liefert danach einen Fehler — und umgekehrt |
| I5 | Loopback-Antwort byte-gleich zu vorher |

## 5. Testplan

Neue fokussierte Datei `src/inbox-api-ack-reason.test.ts` (eine Datei `inbox-api.test.ts` existiert
nicht; vorhanden ist nur `inbox-api-adr005.test.ts`, die ausschließlich Loopback prüft). Der
Remote-Pfad wird mit gemocktem `undici.fetch` und einem **echt signierten** ACK-Envelope gefahren
(EC P-256, `createSign('SHA256')` wie `identity.ts:246`).

| Fall | Erwartung |
|---|---|
| T1 | ACK `rejected` + `reason: 'sender not in pairing store'` ⇒ `ack_status: 'rejected'`, `ack_reason: 'sender not in pairing store'` |
| T2 | ACK `rejected` **ohne** `reason` ⇒ `ack_status: 'rejected'`, **kein** `ack_reason`, HTTP 200 |
| T3 | ACK `delivered` ⇒ Antwortobjekt unverändert, kein `ack_reason` |
| T4 | Loopback (`to === ownAgentId`) ⇒ `delivery: 'loopback'`, unverändert |
| T5 | `reason` mit Steuerzeichen/ANSI und Überlänge ⇒ entschärft, ≤ 200 Zeichen, keine Steuerzeichen (I3) |

Baseline, gegen die gemessen wird: `src/agent-inbox.test.ts` 19/19 grün (real gelaufen 18.11. 06:57).

## 6. Verworfene Alternativen

| Alternative | Warum nicht |
|---|---|
| Grund nur ins Log, nicht in die Antwort | Der Wächter und `mcp-stdio` lesen die Antwort, nicht das Daemon-Log eines anderen Rechners. Das war genau die Lücke |
| `reason` ungefiltert übernehmen | Fremdtext in Log und API-Antwort, §10.3-Verstoß, Log-Injection |
| ACK-Payload-Typ erweitern | Nicht nötig, `reason?: string` existiert bereits (`messages.ts:77`) |
| Zusätzlich Retry bei `rejected` | Außerhalb des Umfangs; `rejected` ist eine Policy-Entscheidung des Empfängers, kein transienter Fehler |

## 7. CO-Vorbehalt (unverändert)

`pal:consensus` bleibt gesperrt: beide Fremd-Backends liegen unter `~/.local/bin`, das der
`pal`-Serverprozess nicht erbt (PATH-Vorbehalt, unverändert seit #364). Ersatz wie bisher:
diese schriftliche Design-Entscheidung **vor** dem Code plus externes Code-Review über
`~/.local/bin/agy --sandbox`. Kein Umgehungsversuch.
