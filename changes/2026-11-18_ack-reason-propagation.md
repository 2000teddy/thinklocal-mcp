# `ack_reason` — den Ablehnungsgrund des Empfängers auf die Sendeseite durchreichen

**Datum:** 2026-11-18
**Branch:** `agent/claude-code/ack-reason-propagation`
**Basis:** `main` @ `bda3ff6` (Merge von #372)
**PR:** #373 — https://github.com/2000teddy/thinklocal-mcp/pull/373
**Design-Doku (vor dem Code):** `docs/architecture/ack-reason-propagation-2026-11-18.md` (Commit `0d334b3`, **vor** dem Code-Commit)
**Auftrag:** Christians bedingte Freigabe vom 18.11.2026 („nach grünen Tests/Review kompatible Verbesserung übernehmen"), übermittelt durch den KW47-Watchdog 07:50 MEZ; Befund aus `hermes/reports/thinklocal-kommunikation-2026-11-18.md` §3.2 und `…-matrix-2026-11-18.md` K3
**Art:** rein additives Antwort-/Log-Feld. **Kein** Deploy, **kein** Release, **kein** Secret, **kein** State, **kein** Dienst-Eingriff, **keine** Protokoll-Änderung, **keine** neue TL-Nummer.

---

## 1. Der Befund stammt aus einer Messung, nicht aus einer Vermutung

Am 18.11.2026 wurden zwei Läufe (06:54:35 und 06:55:39 MEZ) über alle sieben bekannten Peers
gefahren. Die Zustellung an ThinkHub02 (10.10.10.82) scheiterte beide Male **zeichengleich**:

```json
{"status":"sent","delivery":"remote","message_id":"d68c5259-a663-4c28-b773-d910afb2aaed",
 "peer_status":200,"ack_verified":true,"ack_status":"rejected"}
```

Der Grund stand ausschließlich im Log des **Empfängers** (`AGENT_MESSAGE von nicht-gepairtem
Sender abgelehnt`). Der Empfänger setzt in diesem Zweig (`index.ts:904-919`) ein ACK mit
`reason: 'sender not in pairing store'`; der Zweig davor (`:897`) setzt `'recipient mismatch'`.
Beide Gründe sind im Typ vorgesehen (`messages.ts:72-78`, `reason?: string`) und kommen
**signaturverifiziert** beim Sender an — `inbox-api.ts` übernahm aber nur `status`.

Praktische Folge, selbst erlebt: Die Ursachenklärung der TH02-Strecke brauchte einen SSH-Login
auf dem Empfänger. Für eine automatische (stündliche) Prüfung ist das der Unterschied zwischen
„rot, Ursache steht da" und „rot, bitte manuell nachsehen".

## 2. Was geändert wurde

`packages/daemon/src/inbox-api.ts`, **65 Einfügungen / 2 Löschungen**. Davon sind
**ca. 11 Zeilen Logik**, der Rest Kommentar und die Umformatierung des bisher einzeiligen
Antwortobjekts in ein mehrzeiliges:

1. `sanitizeAckReason(reason: unknown): string | undefined` — neue reine Funktion.
2. `ackReason` wird im ACK-Zweig gesetzt und erscheint im Log-Feld `ack_reason` sowie als
   Antwortfeld `ack_reason` von `POST /api/inbox/send`.
3. Beide Stellen nutzen einen Conditional Spread, damit ohne `reason` **kein** Key entsteht.

**Nicht angefasst:** Transport, Retry, Pairing/ACL, Identitäten, Discovery, `index.ts:904-919`,
der Loopback-Zweig, bestehende Feldnamen und Statuswerte.

### 2.1 Kein Eingriff in `mcp-stdio.ts` — und warum das kein Versäumnis ist

Die Auftragsvorlage nannte „zusätzlich im MCP-Werkzeug `send_message_to_peer` durchreichen".
Beim Schreiben der Design-Notiz verifiziert: `mcp-stdio.ts:160-180` gibt die Daemon-Antwort
unverändert weiter (`JSON.stringify(data, null, 2)`). Das neue Feld erscheint dort also **ohne**
Codeänderung; eine zusätzliche Zeile wäre toter Code.

### 2.2 `reason` ist Fremdtext — er wird entschärft

Der Wert kommt vom entfernten Peer und landet in Log und API-Antwort. Nach
`architecture-v5/10-sicherheit.md` §10.3 („Fremdtext ist Rohstoff, nie Befehl. Er wird entschärft
angezeigt") wird er vor der Übernahme behandelt:

| Schritt | Warum |
|---|---|
| `\r \n \t`, NEL (U+0085), U+2028/U+2029 → **ein Leerzeichen** | Zeilentrenner erlauben gefälschte Logzeilen. Ersatzloses Löschen würde mehrzeilige Fremdmeldungen zu einem Wort verschmelzen (CR MEDIUM-1.3) |
| Entfernen: C0, DEL, **C1** (U+0080–U+009F), BiDi-Overrides/Isolate (U+202A–U+202E, U+2066–U+2069) | U+009B ist 8-Bit-CSI und wirkt in manchen Terminals wie `ESC [`; BiDi-Overrides erlauben optisches Log-Spoofing (CR MEDIUM-1.1/1.2) |
| **ZWNJ/ZWJ (U+200C/U+200D) bleiben** | Sie sind in persischen, arabischen und indischen Schriften sowie in Emoji-ZWJ-Sequenzen echter Text — ein breiterer Filter verstümmelt sie |
| Kürzen auf **200 Codepoints** via `Array.from` | `slice()` auf UTF-16-Code-Units kann ein Surrogatpaar zerschneiden; das Modul würde dann selbst ungültiges UTF-16 erzeugen (CR MEDIUM-1.3) |
| leeres Ergebnis oder Nicht-String ⇒ Feld **fehlt** | kein `null`, kein `""` — ältere Peers bleiben byte-gleich zu vorher |

## 3. Rückwärtskompatibilität — der eigentliche Risikopunkt

Im Mesh laufen heute **ältere** Builds als TH01 (`bda3ff6`): `e3acc1a` (10.07.2026, auf
.56/.82/.222), `cec4f96` (08.07.), `842cd7b` (13.07.), `a16b475` (31.08.). Deren ACK enthält
kein `reason`. Für sie gilt: `ack_reason` fehlt in der Antwort, kein Fehler, kein geändertes
Verhalten (T2/T3). Das ist durch eigene Tests abgesichert, die **auch ohne** den Patch grün sind
— sie prüfen Abwesenheit, nicht Anwesenheit.

## 4. Tests — real gemessen, nicht geschätzt

Neue Datei `packages/daemon/src/inbox-api-ack-reason.test.ts`, **10 Fälle**. Eine Datei
`inbox-api.test.ts` existiert nicht; vorhanden war nur `inbox-api-adr005.test.ts`, die
ausschließlich den Loopback-Pfad abdeckt. Der Remote-Pfad läuft hier mit gemocktem
`undici.fetch` und einem **echt signierten** ACK-Envelope (EC P-256, `createSign('SHA256')`).

| Fall | Prüft |
|---|---|
| T1 | `rejected` + `reason` ⇒ `ack_reason` in Antwort **und** Log-Objekt |
| T2 | `rejected` **ohne** `reason` ⇒ kein Key, HTTP 200 (Alt-Peers) |
| T3 | `delivered` ⇒ Antwort- **und** Log-Schlüsselmenge exakt wie vorher |
| T4 | Loopback unverändert, `fetch` nicht aufgerufen |
| T5 | Überlänge + Steuerzeichen ⇒ genau 200 Codepoints, keine Steuerzeichen |
| T5b | Nicht-String / nur Whitespace ⇒ Feld fehlt |
| T6 | ACK mit **fremdem** Schlüssel signiert ⇒ `ack_verified: false`, **kein** `ack_reason` |
| T7 | C1, NEL, U+2028, BiDi-Overrides ⇒ entfernt bzw. zu Leerzeichen |
| T8 | ZWNJ/ZWJ bleiben erhalten (persisch + Emoji-ZWJ) |
| T9 | Kürzen an einer Nicht-BMP-Grenze ⇒ `isWellFormed() === true` |

**Gemessene Ergebnisse:**

| Messung | Ergebnis |
|---|---|
| neue Datei mit Patch | **10/10 grün** |
| **Rückdrehprobe** (`git stash` nur auf `inbox-api.ts`) | **5 rot / 5 grün** — rot: T1, T5, T7, T8, T9; grün: T2, T3, T4, T5b, T6 (sie prüfen Altverhalten) |
| Baseline **vor** dem Patch (die von der Vorlage benannte) | `src/agent-inbox.test.ts` **19/19 grün** (18.11. 06:57, 536 ms) |
| volle Daemon-Suite, Patch + 6 Fälle (07:14) | 153 Dateien, **2198/2198 grün**, Exit 0 |
| volle Daemon-Suite, Patch + CR-Nacharbeit + 10 Fälle (07:19) | 153 Dateien, **2202/2202 grün**, Exit 0, 20,38 s |
| `tsc --noEmit -p packages/daemon` | **0 Fehler** |
| `eslint` auf beide geänderten Dateien | **0 Fehler, 0 Warnungen** |

## 5. Code-Review (CR) — extern, anderer Anbieter als der Implementierer

`~/.local/bin/agy --sandbox`. **Erster Versuch schlug fehl** und wird hier offengelegt statt
übergangen: `jetski: no output produced — a tool required the "read_file" permission that
headless mode cannot prompt for`. Der zweite Lauf mit der Vorgabe „benutze keine Werkzeuge, alles
steht im Prompt" lieferte das Review. `--dangerously-skip-permissions` wurde **nicht** verwendet.

Ergebnis: **kein CRITICAL, kein HIGH**, 2 MEDIUM + 2 LOW. **Alle vier wurden umgesetzt:**

| Finding | Umsetzung |
|---|---|
| MEDIUM-1 Sanitizer zu schmal (C1, U+0085, U+2028/29, BiDi, Wortverschmelzung, Surrogat-Schnitt) | Sanitizer umgebaut (§2.2), neue Tests T7/T8/T9 |
| MEDIUM-2 Das neue **Log**-Feld war ungetestet (`log` war `undefined`, `log?.info` lief nie) | Logger-Spy in `buildServer`, Prüfung in T1/T2/T3 |
| LOW-3 Log-Objekt enthielt `ack_reason: undefined` als Key | Conditional Spread auch im Log-Objekt |
| LOW-4 Fehlende Fälle: unverifiziertes ACK, weiche Längen-Assertion | T6 ergänzt, T5 auf exakt 200 Codepoints verschärft |

Eine **eigene Korrektur** dazu, ebenfalls offengelegt: Meine erste Erwartung in T7 war falsch
(ich hatte angenommen, auch U+202E werde zu einem Leerzeichen). Richtig ist: U+202E wird
ersatzlos entfernt, die Nachbarzeichen stoßen zusammen. Korrigiert wurde die **Erwartung**, nicht
der Code.

## 6. Zwei Fehler im Testgeschirr, die der Patch nicht verursacht hat

1. `serializeSignedMessage` liefert einen Node-`Buffer`. Dessen `.buffer` ist der **gepoolte**
   ArrayBuffer, und `Buffer.prototype.slice` gibt einen View darauf zurück, keine Kopie — mein
   erster `arrayBuffer()`-Stub lieferte deshalb Fremdbytes und das CBOR-Decode scheiterte mit
   „Data read, but end of buffer not reached". Behoben mit `new Uint8Array(bytes)`.
2. In den Regex-Literalen landeten die Escape-Folgen zunächst als **echte** Zeichen U+2028/U+202E
   im Quelltext; ein rohes U+2028 beendet in JavaScript die Zeile (`Unterminated regular
   expression`). Beide Dateien sind jetzt per Prüfung frei von rohen Sonderzeichen.

Beides ist dokumentiert, weil es sonst als „Patch war kaputt" missverstanden wird.

## 7. Grenzen

- **Kein Merge, kein Release, kein Deploy** durch diese Lane.
- Der gemessene TH02-Fehler wird **nicht behoben** — das wäre ein Pairing-Eintrag auf TH02 und
  damit eine Trust-Änderung, die Christians ausdrückliche Freigabe braucht. Dieser PR macht die
  Ursache nur **sichtbar**.
- Patch B (Stundenwächter) und Patch C (macOS-PATH) sind **nicht** Teil dieses PRs.
- Kein Live-Test gegen das laufende Mesh: der TH01-Daemon läuft auf `bda3ff6` und wurde **nicht**
  neu gestartet. Der Nachweis am echten Peer-ACK folgt erst nach einem Deploy, der nicht
  freigegeben ist.
