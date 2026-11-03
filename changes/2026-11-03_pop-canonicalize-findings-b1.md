# changes/2026-11-03 — fix(scripts): 6 Review-Befunde in `pop-canonicalize.ts` + `TODO.md` B1 auf Ist-Stand

**Typ:** Bug-Fix an einem Operator-Skript **mit** Regression-Tests, plus eine Doku-Drift.
Freigegeben als Folge-Slice zu **#362** („B1 und die 6 Skript-Befunde"). **Kein** `packages/daemon/src/`-Diff,
**kein** Deploy, **kein** Secret, **kein** State, **kein** Dienst-Eingriff, **kein** Beschluss, **kein** Gate
verschoben. Risiko-Delta für den laufenden Dienst **null** — das Skript wird von keinem laufenden Prozess
geladen, es ist ein manuell aufgerufener Runner.

---

## (a) Die 6 Befunde — jeder gefixt, jeder mit Test

Herkunft: 1–4 aus meinem eigenen Lesen in #362, 5–6 aus dem `agy`-Review dort. Alle waren dort **belegt und
bewusst nicht gefixt**, weil #362 die Datei byte-identisch zum real gelaufenen Artefakt versionieren sollte.
Diese Begründung ist mit dem Merge von #362 verbraucht — die Datei ist jetzt versioniert, der Fix liegt
sichtbar als Diff darüber.

| # | Fund | Fix | Regression-Test |
|---|---|---|---|
| 1 | 4 unbenutzte Imports (`dirname`, `privateKeyFromProtobuf`, `peerIdFromPrivateKey`, `libp2pPeerIdString`) | entfernt; `LIBP2P_KEY_FILENAME` neu importiert (wird jetzt gebraucht), `writeFileSync`/`chmodSync`/`hostname` aus dem Inline-`await import()` in den Kopf gezogen | „hat keine unbenutzten Imports" — prüft jeden Import-Namen gegen den Rest der Datei |
| 2 | `init.signal` im `fetchImpl`-Adapter verworfen ⇒ `timeoutMs: 15_000` wirkungslos, hängender Admin blockiert unbegrenzt | `createMtlsFetch()` leitet `signal` an `dispatcher.request()` durch | „leitet das AbortSignal durch" — Fake-Dispatcher, `expect(calls[0].signal).toBe(signal)` |
| 3 | `loadOrCreateLibp2pPrivateKey()` ist load-**or-create**: ohne persistierten Key still eine **neue** PeerID statt Abbruch | neue `assertOnboarded()` prüft die Key-Datei als Voraussetzung mit, fail-closed vor jedem Seiteneffekt | „bricht ab, wenn NUR der libp2p-Key fehlt" |
| 4 | `mkdirSync` ohne `mode` ⇒ Backup-Ordner welt-lesbar (`0775`), obwohl ein privater Key darin liegt | `backupExistingTls()` legt ihn mit `BACKUP_DIR_MODE = 0o700` an | „legt das Verzeichnis mit 0700 an" + Key-Modus bleibt `0600` |
| 5 | `servername: 'localhost'` hartcodiert | bleibt **Default** (`DEFAULT_SERVERNAME`) — jedes von `tls.ts` ausgestellte Node-Cert führt `DNS:localhost` im SAN, das ist mesh-weit der portabelste Name — ist aber über **`--servername <name>`** überschreibbar und im Header begründet | „erlaubt --servername zu überschreiben" + Default-Test |
| 6 | `dispatcher` an `requestNodeCert` übergeben, im eigenen Adapter nie gelesen | Adapter nutzt `init.dispatcher ?? fallback` | „benutzt den übergebenen dispatcher statt des Fallbacks" + Fallback-Test |

**Zu Fund 5 bewusst *nicht* das Naheliegende getan:** den SNI aus `--admin-url` abzuleiten wäre der
schlechtere Fix. `localhost` steht per `tls.ts` in **jedem** Node-Cert; eine aus der URL abgeleitete IP oder
ein Hostname stehen nur dann im SAN, wenn der Admin genau so ausgestellt wurde. Der Default hätte also
Verbindungen kaputt gemacht, die vorher gingen. Gefixt ist damit das echte Problem — die Annahme war
unsichtbar und nicht übersteuerbar —, nicht der Default.

## (b) Nebeneffekt: das Skript ist jetzt überhaupt testbar

Voraussetzung für (a) war eine Form-Änderung, kein Umbau der Logik:

- `parseArgs(raw)` nimmt das Argument-Array als Parameter statt `process.argv` zu lesen.
- Die vier prüfbaren Einheiten sind exportiert: `parseArgs`, `assertOnboarded`, `createMtlsFetch`,
  `backupExistingTls` (+ die Konstanten `DEFAULT_SERVERNAME`, `BACKUP_DIR_MODE`).
- `main()` läuft nur noch hinter einem **Direktaufruf-Guard** (`process.argv[1]` ↔ `import.meta.url`) —
  ohne ihn hätte schon der Import im Test einen echten Cert-Request abgefeuert.

Der Ablauf selbst (Reihenfolge der 5 Schritte, Backup vor Überschreiben, Key `0600`, Cert `0644`, kein
Secret im Log) ist **unverändert**; `requestNodeCert` wird mit denselben Feldern aufgerufen.

## (c) Wo der Test liegt — und warum das die einzige Absicherung ist

`packages/daemon/scripts/pop-canonicalize.test.ts`. Vitest sammelt die Datei (kein `include`-Override in
`vitest.config.ts`, Default-Pattern greift) — **tsc und eslint nicht**: `tsconfig.json:23` hat
`include: ["src/**/*.ts"]`, `npm run lint` deckt nur `packages/*/src`. Dieser Test ist damit das einzige Gate,
das einen Rückfall bemerkt. Deshalb ist auch Fund 1 getestet und nicht bloss behoben.

**Die Gate-Lücke selbst wurde NICHT geschlossen** (`scripts/` in `tsconfig`/`lint` aufnehmen): das würde die
drei Nachbarskripte mitziehen, die nie unter diesen Regeln standen — unkalkulierbarer Diff, eigener Slice.
Beide Dateien sind trotzdem gegen die Repo-Regeln geprüft: `tsc --strict --noUnusedLocals --noUnusedParameters`
**0 Fehler in `scripts/`**, `npx eslint` auf beide Dateien **0 Fehler / 0 Warnungen**.

## (d) `TODO.md` B1 — auf den Ist-Stand

B1 („PR #356 kann nicht gemergt werden: Self-Approval") war überholt: #356 ist seit **2026-10-26T10:09:05Z**
gemergt (`8e7f683e`, `APPROVED` durch `peppiseppiullmann-ci`, Autor `2000teddy` — alles per `gh` nachgezählt).
Neu formuliert mit der Unterscheidung, die damals in #357 als Protokoll-Korrektur festgehalten wurde:
**die Diagnose war richtig, die Einordnung zu stark — eine Self-Approval-Sperre ist kein Christian-Gate**,
der zweite Collaborator mit `push` konnte den Review jederzeit liefern (Bot-Pfad, inzwischen Standard, zuletzt
#362). Die 3 LOW sind abgearbeitet oder gegenstandslos; der `CHANGES.md`-Suffix `, #356)` kam in **#357**
(`grep -c ', #356)' CHANGES.md` ⇒ **3**).

**Was aus B1 ausdrücklich offen bleibt** (je eigener Slice, hier nur geschärft):
`packages/daemon/scripts/discovery-poc.ts:28` trägt weiter `~/Entwicklung_local/thinklocal-mcp` — live
geprüft **genau ein** Treffer und die einzige `.ts`/`.sh`/`.mjs`-Datei im Repo mit diesem String. Der Grund
fürs Liegenlassen ist jetzt präziser als „es wäre ein `.ts`-Diff": die Zeile lautet
`ssh chris@10.10.10.55 'cd ~/Entwicklung_local/…'` und beschreibt das Arbeitsverzeichnis **auf `.55`** — genau
die aus diesem Repo **nicht** entscheidbare Frage. Sie zu „korrigieren" wäre eine Behauptung über einen
fremden Host. Dazu unverändert der **`.55`-c/k-Pfad-Widerspruch**.

**Blocker-Kopfzeile mitgezogen** — bewusste Entscheidung, eine Zeile über dem Scope: `Stand 2026-10-21` →
`Stand 2026-11-03` plus zwei Zeilen, dass von den drei Einträgen nur noch **B3** ein echter Christian-Gate
ist. Ohne das stünde über zwei erledigten Punkten weiter „OFFENE BLOCKER" mit einem Datum von vor 13 Tagen —
also genau die Drift, die dieser Slice schliessen soll.

## (e) Code-Review (CR) — Review-of-Record, alle 4 Findings umgesetzt

`pal:codereview` bleibt am PATH-Problem nicht aufrufbar ⇒ **`agy`** über den absoluten Pfad `~/.local/bin/agy`,
`--sandbox`, mit dem vollständigen gestageden Diff im Prompt (nie MiniMax, nie `pal:chat`).
**Ergebnis: APPROVE — 0 HIGH / 0 MEDIUM / 2 LOW / 2 NIT.** Gegen den Code bestätigt: alle 6 Fixes einzeln als
echt — für Fund 5 ausdrücklich gegen `tls.ts:148` **und** `cert-issuer.ts:197`, die beide `DNS:localhost`
**immer** ins SAN schreiben, die Begründung für den unveränderten Default trägt also und es ist kein
Scheinfix — dazu Verhaltensgleichheit von Ablauf, Schritt-Reihenfolge, Backup-vor-Überschreiben, Dateimodi
und `agent.close()` im `finally`, kein tautologischer Test, und die Fixtures verlassen `os.tmpdir()` nicht.

| CR-Finding | Problem | Umsetzung |
|---|---|---|
| **LOW 1** | Fund 5 war nur auf `parseArgs`-Ebene getestet. Hätte an der **Senke** wieder `'localhost'` statt `args.servername` gestanden, wäre die Suite grün geblieben. | `buildConnectOptions()` als exportierte Einheit ausgelagert, `main()` nutzt sie; 3 Tests dazu, Rückdrehprobe an der Senke ⇒ rot. |
| **LOW 2** | Der Import-Test konnte falsch-**negativ** werden (Name im Kommentar zählte als Benutzung) und übersah `import def, { … }`. | Regex-Heuristik durch einen **Zustandsautomaten** ersetzt (`stripCommentsAndStrings`), plus Selbsttest an synthetischem Quelltext. |
| **NIT 1** | Guard ohne `realpathSync` ⇒ Aufruf über einen Symlink startet `main()` nicht. | `resolvedRealPath()` auf **beiden** Seiten; dazu ein End-to-End-Test, der das Skript über einen echten Symlink per `tsx` startet. |
| **NIT 2** | `--servername --dry-run` konsumierte `--dry-run` als Wert. | `optionValue()` akzeptiert kein `--…` als Wert — gilt jetzt für alle drei Wert-Flags. |

**LOW 2 war mehr als Kosmetik — die Heuristik fiel beim Nachbauen zweimal selbst durch.** Erst frass ein
naiver `//[^\n]*`-Strip das `//` in `spiffe://…` **innerhalb eines Template-Literals** und zerlegte alles
danach: der Test meldete 8 benutzte Imports als unbenutzt. Dann lief der Automat, aber ein nur in `${…}`
benutzter Import galt als unbenutzt — also **Fehlalarm**-Risiko, sichtbar nur, weil der Selbsttest genau das
prüft. Korrekt ist erst die Fassung, die Interpolationen als Code behandelt. Beide Zwischenstände stehen
hier, weil die Lehre an der Heuristik hängt und nicht am Endstand.

**NIT 1 ist getestet, nicht behauptet:** der Symlink-Test startet `npx tsx <symlink> --dry-run` gegen ein
Fixture-`dataDir` und prüft, dass `main()` wirklich anläuft (Kopfzeilen + durchgereichter `servername`). Dass
der Lauf danach am Fixture-Key scheitert, ist erwartet und für den Nachweis des Guards ausreichend.

**Zweite Runde über den nachgebesserten Stand: APPROVE — 0 HIGH / 0 MEDIUM / 0 LOW / 0 NIT.** Geprüft wurden
gezielt die vier Nachbesserungen: Verhaltensgleichheit von `buildConnectOptions()` (Reihenfolge der
`readFileSync`-Aufrufe, `ca` als 1-Element-Array, `rejectUnauthorized`), Determinismus des Symlink-Tests
(`node_modules/.bin` liegt unter Vitest im `PATH` ⇒ kein Netz nötig; falsch-grün unmöglich, weil beide
geprüften Zeilen nur aus `main()` stammen und `probe.lan` dynamisch durchläuft), `optionValue()` als
Nicht-Regression (kein legitimer Wert der drei Flags beginnt mit `--`) und die Zahlen gegen den Diff
(22 Tests einzeln nachgezählt: 5+3+3+4+3+4).

**Ein substanzieller Hinweis aus Runde 2 ist nachträglich dokumentiert**, nicht nur zur Kenntnis genommen:
der Zustandsautomat hat **keinen Zustand für Regex-Literale**. Beim heutigen Inhalt von
`pop-canonicalize.ts` (nur `/[:.]/g`) ist das folgenlos; ein später ergänztes `/'/`, `/https?:\/\//` oder
`/[/*]/` würde ihn in den String- bzw. Kommentar-Zustand kippen. Die Fehlerrichtung ist dabei
**falsch-positiv** — der Test wird rot und meldet benutzte Imports als unbenutzt, statt still durchzulassen.
Das steht jetzt als „BEKANNTE GRENZE" im Doc-Comment des Helpers. Es ist die einzige Änderung nach dem
zweiten Review und betrifft ausschliesslich einen Kommentar.

**Dass der Review-Agent nichts verändert hat, wurde in beiden Runden geprüft, nicht angenommen:** `HEAD`, der
Hash des `--cached`-Diffs und `git status --porcelain` wurden vor jedem Lauf festgehalten und danach
verglichen — alle identisch.

## Was bewusst NICHT angefasst wurde

- **`scripts/` in `tsconfig`/`lint`** aufnehmen und ein `npm run`-Alias für das Skript ⇒ eigene Slices (s. (c)).
- **`discovery-poc.ts:28`** und der **`.55`-c/k-Widerspruch** ⇒ s. (d), nur geschärft, nicht geändert.
- **B3/TL-14 bleibt C1-gated**, **T2.1** (Cert-Rotation, Leaf-Ende 2027-01-31) und der in #362 notierte
  **Trust-Anchor-Wechsel** (`69bc0bc908229c9f` → `cf00a5bab06832c1`, 3 offline-Peers, Zusammenhang **nicht**
  belegt) bleiben offen — dieser Slice berührt keinen davon.
- **Kein** Eingriff in `~/.thinklocal/` (kein Cert, kein Key, kein Token, kein State), **kein** Deploy, **kein**
  `systemctl restart/stop`, **kein** Re-Lauf des Skripts gegen den Live-Node.
- **Nicht berührt:** `packages/daemon/src/`, ADR-046 §9, `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`,
  `COMPLIANCE-TABLE.md`-Footer-Historie, `#350`. Keine `HISTORY.md` (existiert bewusst nicht,
  `CONTRIBUTING.md:34-36`).

## Tests

| Prüfung | Ergebnis |
|---|---|
| `npx vitest run` (`packages/daemon`) | ✅ **151 Dateien / 2123 Tests grün** (vorher 150 / 2101 ⇒ **+1 Datei / +22 Tests**), 19,32 s |
| Neue Datei einzeln | ✅ `scripts/pop-canonicalize.test.ts` — **22 Tests**, 1,0 s (der Symlink-Test startet einen echten `tsx`-Prozess) |
| **Fix-für-Fix-Rückdrehprobe** | ✅ jeder Fix einzeln zurückgedreht ⇒ **genau der zugehörige Test wird rot — 9/9** (die 6 Befunde plus die 3 testbaren CR-Punkte); Datei nach jeder Probe per SHA-256 als unverändert bestätigt |
| `tsc --strict --noUnusedLocals --noUnusedParameters` auf Skript + Test | ✅ **0 Fehler in `scripts/`** (vorher 4× `TS6133`) |
| `npx eslint` auf Skript + Test | ✅ **0 Fehler / 0 Warnungen** |
| Live-Verhalten | ⚠️ **nicht** erneut gegen den Node ausgeführt — der Daemon läuft stabil (`NRestarts=0`), ein Re-Lauf würde ein neues Cert ziehen und das Backup-Verzeichnis erneut beschreiben. Das ist ein Eingriff und war nicht freigegeben; die Tests deckeln die geänderten Pfade. |

Die Rückdrehprobe im Detail: `signal`-Durchleitung entfernt → „leitet das AbortSignal durch" rot;
`init.dispatcher ?? fallback` → `fallback` → „benutzt den übergebenen dispatcher" rot; `mode` am `mkdirSync`
entfernt → „legt das Verzeichnis mit 0700 an" rot; Key-Prüfung aus `assertOnboarded` entfernt → „bricht ab,
wenn NUR der libp2p-Key fehlt" rot; `--servername` aus `parseArgs` entfernt → Überschreib-Test rot;
`servername: args.servername` → `DEFAULT_SERVERNAME` an der **Senke** → `buildConnectOptions`-Test rot;
toter Import eingefügt → Import-Test rot; `optionValue()` → `raw[i + 1]` → Folge-Flag-Test rot;
`realpathSync` aus dem Guard entfernt → Symlink-Test rot.

## Precommit (manuell)

`pal:precommit` bleibt am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen; Secret-Scan clean
(kein Key, kein Token, kein Hostname-Secret; einzige Konstante weiter die LAN-Default-URL
`https://10.10.10.80:9440`, die bereits in `docs/` steht); die Test-Fixtures schreiben ausschliesslich in ein
`mkdtempSync`-Verzeichnis unter `os.tmpdir()` und räumen es im `afterEach` ab — **kein** Zugriff auf
`~/.thinklocal/`; kein Eingriff in Build, CI, Deploy oder State.
