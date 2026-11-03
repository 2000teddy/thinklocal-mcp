# 2026-11-03 — `TODO.md` B2: Trust-Anchor-Stand belegt + T2.1 datiert (Doku-Slice)

**Typ:** Doku-Slice. **Kein** `packages/`-Diff, kein Code, kein Testlauf, kein Deploy, kein Release, kein
Secret, kein Schreibzugriff auf `~/.thinklocal/`, kein Peer-Write, kein Dienst-Eingriff. Grundlage ist die
read-only-Ermittlung vom 2026-11-03 14:40–16:03 UTC; Hermes hat die Kernzahlen unabhängig am Artefakt
nachgemessen und bestätigt.

## Was sich in `TODO.md` ändert

Der B2-Absatz, der den Trust-Anchor-Wechsel bisher als *„für die 3 offline-Peers ist ein Zusammenhang nicht
belegt … nur als zu prüfen geführt"* führte, ist **überholt** und wird durch den belegten Stand ersetzt. Der
T2.1-Absatz wird von „das neue Leaf endet am 2027-01-31" auf eine **datierte** Aussage mit Rechenweg gehoben
— und im **Mechanismus korrigiert** (ein Neustart allein renewt die kanonische Identität nicht, siehe unten).
Die Kopfzeile des Blocker-Blocks nennt die beiden datierten Termine plus den undatierbaren dritten.

## Der Befund: die Vermutung war falsch gerahmt, nicht einfach falsch

B2 vermutete einen Zusammenhang „Anker-Wechsel ⇒ 3 offline-Peers". Der Zusammenhang **existiert**, aber nur
als **einmaliges Fenster** am 2026-11-02 — nicht als fortbestehender Trust-Defekt. Heute kennen **alle**
prüfbaren Peers den neuen Anker, und die drei als offline geführten Peers sind nicht ausgefallen: `.56`,
`.222` und `.104` antworten alle auf Port 9440.

| Peer | TH01-Status | Trust-Anker | Belegquelle (2026-11-03 UTC) |
|---|---|---|---|
| `.52` iobroker | online | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 16:03 |
| `.56` influxdb | offline (Buchhaltung) | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 14:49 |
| `.222` ai-n8n-local | offline (Buchhaltung) | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 14:49 |
| `.82` ThinkHub02 | online | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 16:03 |
| `.158` MacBook-Pro-2 | online | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 16:03 |
| `.44` macminim6 | online | `cf00a5bab06832c1` | `GET /api/status` mit TH01-Client-Cert ⇒ **HTTP 200**, 16:03 |
| `.104` raspberrypi4 | offline (**korrekt**) | **eigene CA `39a4d76c84a72d02`** | `CN=raspberrypi4`, `notBefore 2026-09-17 13:44:42`, `notAfter 2026-12-16 14:44:42`; Handshake ⇒ `verify error:num=19` |
| `.94` „admin" | nicht in der Daemon-Map | Record noch `69bc0bc908229c9f` | `paired-peers.json`; Host unerreichbar ⇒ **nicht prüfbar** |
| `.55` | nicht in der Daemon-Map | unbekannt | Host unerreichbar ⇒ **nicht prüfbar** |

**`peers_known=7`** ist die flüchtige Daemon-Map (die sechs belegten plus `.104`). `.94` und `.55` sind dort
nicht enthalten — insgesamt sind **9** Identitäten bekannt. Die Tabelle nennt deshalb 9 Zeilen, der Satz
„6 von 7" bezieht sich auf die Map.

**Warum HTTP 200 ein Beleg ist und keine Vermutung:** das Agent-Card-Socket der Peers fährt
`requestCert: true, rejectUnauthorized: true` (`packages/daemon/src/agent-card.ts:229-230`), und
Anwendungsdaten fließen erst nach erfolgreichem mTLS. Ein 200 auf einem mTLS-gegateten Pfad ist nur möglich,
wenn der Peer TH01s `cf00a5…`-signiertes Client-Cert gegen seinen **eigenen** Trust-Store validiert hat. Die
Richtung ist damit die, die die Frage stellt: nicht „TH01 traut dem Peer", sondern „der Peer kennt den neuen
Anker".

**Was hier ausdrücklich NICHT als Beleg zählt** (Korrektur aus dem Review): ein
`openssl s_client`-`Verify return code: 0` bewertet nur TH01s Prüfung des **Server**-Certs, und unter
TLS 1.3 prüft der Server das Client-Cert erst nach seinem `Finished` — eine Ablehnung käme als späterer
Alert. `.52` war zunächst nur so geprüft; statt die Aussage abzuschwächen wurde **nachgemessen**
(`GET /api/status` ⇒ 200). Dasselbe gilt für `.82`, `.158`, `.44`, die zuerst nur als „aus dem Leaf-Issuer
abgeleitet" geführt waren. Ergebnis: alle sechs sind **belegt**, kein Peer bleibt auf der Ableitung.

**Registerstand ist kein Beweis — aber auch nicht bedeutungslos:** `paired-peers.json` hat 12 Einträge,
**6 mit der alten und 6 mit der neuen CA**. 5 der 6 Alt-Einträge sind überholte Duplikate inzwischen
migrierter Peers; der 6. (`.94`, Hostname `admin`) ist der **einzige** Eintrag eines nicht migrierten Peers
und damit der Hinweis, dass `.94` noch auf `69bc0bc908229c9f` steht. Ein Alt-Eintrag belegt also keinen
aktuellen Handshake-Fehler, aber `.94`s Eintrag ist mehr als Historie.

## `.104` ist der einzige belegte Ausreißer — aus einem anderen Grund als vermutet

`.104` kennt den neuen Anker nicht und fährt eine selbst erzeugte CA `39a4d76c84a72d02` (identisch mit dem
Host-Hash in seiner Legacy-URI `host/39a4d76c84a72d02`). **Beleg dafür, dass er in keiner Mesh-CA war, ist
diese Own-CA — nicht** der fehlende `paired-peers.json`-Eintrag (Korrektur aus dem Review: ein per Token
onboardeter Node unter einer gemeinsamen Mesh-CA bräuchte dort keinen Eintrag). Belegt ist das für den
Zeitraum **seit `notBefore 2026-09-17 13:44:42 UTC`**; über die Zeit davor sagt keines von beidem etwas.
Seine Frist ist sein **eigenes** Leaf: `notAfter 2026-12-16 14:44:42 UTC`. Danach ist sein Serving-Cert
abgelaufen, der Handshake scheitert in **beiden** Richtungen, und ein Enrollment über das Netz ist nicht mehr
möglich — es bräuchte Host-Zugriff auf den Raspberry. Für `.104` ist der TH01-Status „offline" **korrekt**,
nicht falsche Buchhaltung.

## Nebenbefund mit Ursache: der Offline-Status ist terminal

Die Kette ist im Log vollständig datiert: **2026-11-02 20:22:09 UTC** Anker-Wechsel, **20:35:45 UTC**
Daemon-Start, **20:35:47 UTC** scheitern genau drei Card-Fetches mit `self-signed certificate in certificate
chain` (`.56`, `.222`, `.104`) — die ersten beiden, weil sie zu dem Zeitpunkt noch alte Certs führten.
**20:36:17 UTC** werden sie offline markiert. **20:50–20:52 UTC** werden `.56`/`.222` neu enrollt (neue Leafs
`notBefore 20:52:16` / `20:52:40`). **20:54:21 / 20:54:30 UTC** holt TH01 ihre Agent-Cards erfolgreich und
kanonisiert per `ADR-022 Flip`. Der Status bleibt trotzdem `offline`, weil `checkPeers()` auf
`p.status !== 'offline'` filtert (`packages/daemon/src/mesh.ts:600`): ein einmal offline markierter Peer wird
**nie wieder** angepingt. Der Flip schreibt den Map-Key um, nicht den Status. `.158` kam nur zurück, weil es
ein **statischer** Peer ist (Reconciler, `count: 1`); reine mDNS-Peers nicht.

Das trennt die beiden Ursachen sauber: der **Anker-Wechsel** erklärt das Fenster vom 2026-11-02 20:35–20:52,
der **Filter** erklärt den Status von heute. Das ist die bekannte ADR-035-Klasse, hier erstmals mit
durchgehender Zeitstempel-Kette. **Code-Slice-Kandidat, ausdrücklich nicht freigegeben und nicht
implementiert** — dieser Slice ändert nur Doku.

## T2.1-Datierung, gerechnet statt angenommen

Rechenweg aus den gelesenen Zertifikaten (Stichzeit 2026-11-03 14:40 UTC):

```
2026-12-16 14:44:42Z  T- 43d  .104 Leaf (eigene CA)        <- naechste harte Frist
2027-01-31 20:35:41Z  T- 89d  TH01 .80 Leaf   (cf00a5)     <- fruehestes Mesh-Leaf
2027-01-31 20:36:10Z  T- 89d  .158 / 20:38:40 .82 / 20:38:45 .52
2027-01-31 20:42:33Z  T- 89d  .44  / 20:52:16 .56 / 20:52:40 .222
2027-04-07 18:59:27Z  T-155d  alte Mesh-CA 69bc0bc908229c9f (noch gueltig)
2027-11-02 20:22:17Z  T-364d  neue Mesh-CA cf00a5bab06832c1
Leaf-Laufzeit TH01 = 2026-11-02 20:35:41 -> 2027-01-31 20:35:41 = 90 Tage exakt
```

**Das Fenster öffnet 2026-12-31, nicht 2027-01-01** (Korrektur aus dem Review): `daysLeft` ist
`Math.floor((notAfter - now) / 86_400_000)` (`packages/daemon/src/tls.ts:590-592`), und das Behalten-Gate
prüft `daysLeft > renewBeforeDays` (`tls.ts:655` sowie die ADR-024-Retention auf `tls.ts:671-673`), Default
**30** aus `packages/daemon/src/config.ts:251`. `daysLeft <= 30` greift damit bereits bei unter 31 **vollen**
Tagen Restlaufzeit, also ab **2026-12-31 20:35:42 UTC** für TH01 bzw. 2026-12-31 20:52:41 UTC für das
späteste Leaf (`.222`).

**Und ein Neustart allein genügt nicht — er ist sogar gefährlich** (Korrektur aus dem Review, im Code
nachgeprüft):

1. **Own-CA-Nodes — belegt nur für TH01** (`~/.thinklocal/tls/ca.key.pem` existiert lokal, `0600`): fallen
   bei `daysLeft <= 30` durch **beide** Behalten-Gates, womit
   `createNodeCert(ca, hostname, spiffeUri, localIps)` (`tls.ts:700`) greift. Das `spiffeUri`-Argument ist
   `identity.spiffeUri` (`packages/daemon/src/index.ts:175`), also die **Legacy**-URI
   `spiffe://thinklocal/host/<nodeId>` — die kanonische `node/<PeerID>`-Identität wird **überschrieben**.
   Genau dieser Cert-Clobber ist am 2026-11-02 passiert und wurde erst von `pop-canonicalize.ts` repariert.
   **`cert.migrate_legacy_identity` verhindert diesen Clobber nicht** (Befund aus Review-Runde 2): das Flag
   steht auf dem Default **false** (`config.ts:252`, im systemd-Unit nicht gesetzt), und selbst aktiviert
   greift der Migrationszweig nur bei `certSpiffeUri.startsWith('spiffe://thinklocal/host/')`
   (`tls.ts:632-633`) — auf einem bereits kanonischen Cert also gar nicht; er würde den Clobber erst bei
   einem **zweiten** Neustart rückgängig machen. Die zuvor hier stehende Begründung „greift ohnehin nur bei
   `fullyValid`" war **falsch**: `fullyValid` prüft nur `now >= notBefore && now <= notAfter`
   (`tls.ts:596`) und ist im gesamten Renew-Fenster `true`.
2. **Token-onboardete Nodes ohne lokalen `ca.key.pem`:** für sie gilt `renewBeforeDays` **ausdrücklich
   nicht** (`tls.ts:522-531` — „ein token-onboardeter Node hat keinen CA-Key und kann sich nicht selbst neu
   ausstellen"). Sie behalten ihr Cert bis zum harten Ablauf am 2027-01-31 und brauchen ein
   **Re-Onboarding**, keinen Neustart.

T2.1 ist damit **kein Neustart-Termin**, sondern ein **Zwei-Wege-Problem**: **TH01-Seite** ⇒ Neustart plus
kanonische Reparatur danach (`pop-canonicalize.ts`) oder die echte In-Process-Rotation; **Peer-Seite** ⇒
**Re-Onboarding**. Welcher Peer in welchen Zweig fällt, ist von TH01 aus **nicht feststellbar** — ob
`.56`/`.222` einen lokalen `ca.key.pem` besitzen, lässt sich von hier nicht lesen und `/api/status`
exponiert es nicht. Das bleibt pro Peer offen. Beides vor dem **2027-01-31**; sonst wiederholt sich der
Ausfall vom **2026-09-02** (`node.crt.legacy.pem`, `notAfter Sep 2 18:38:56 2026 GMT`). Die CAs selbst sind
unkritisch: `cf00a5…` bis 2027-11-02, `69bc…` bis 2027-04-07.

## Zwei datierte Termine, plus ein undatierbarer

1. **`.104`-Enrollment bis 2026-12-16** — braucht Host-Zugriff auf `.104` (Onboarding-Token + Peer-Write),
   von TH01 aus nicht machbar. Nach dem 16.12. ist der Handshake in beiden Richtungen tot.
2. **T2.1-Fenster ab 2026-12-31** — Neustart **plus** kanonische Reparatur bzw. Re-Onboarding, alle sieben
   `cf00a5…`-Leafs laufen am 2027-01-31 ab.
3. **`.94`/`.55` — undatierbar**, weil nicht prüfbar: beide sind von TH01 aus weder per ICMP noch auf
   9440/22 erreichbar. Bei `.94` steht der Trust-Record zusätzlich noch auf der alten CA; ob der Host den
   neuen Anker kennt, ist von hier aus nicht entscheidbar. Wird einer der beiden wieder erreichbar, kann
   daraus ein **dritter** Termin entstehen — das ist offen, nicht erledigt und nicht behauptet.

## CR — externes Review (Gemini über `agy`, nicht das implementierende Modell)

`pal:codereview` war erneut nicht nutzbar (beide Fremd-Backends brechen mit `executable not found in PATH`
ab — bekannter Zustand, siehe #362/#363/#364). Fallback: dasselbe Fremdmodell direkt über
`~/.local/bin/agy --sandbox`, als Abweichung gemeldet. Das Review lief gegen den vollständigen Doku-Diff und
lieferte **9 Befunde (3 HIGH, 4 MEDIUM, 1 LOW, 1 NIT)**. Alle 9 sind eingearbeitet:

| # | Sev | Befund | Auflösung |
|---|---|---|---|
| 1 | HIGH | „Zusammenhang widerlegt" / „offline ist nur Buchhaltung" widerspricht der eigenen Kausalkette und gilt für `.104` gar nicht | Umformuliert: Anker-Wechsel = **einmaliges Fenster** 20:35–20:52, Filter = heutiger Status; für `.104` ist „offline" **korrekt** |
| 2 | HIGH | `.52` nur per `s_client`/`Verify return code 0` geprüft — unter TLS 1.3 kein Beweis für Client-Cert-Akzeptanz | **Nachgemessen** statt abgeschwächt: `.52`, `.82`, `.158`, `.44` ⇒ `GET /api/status` **HTTP 200**; die Beweis-Grenze von `s_client` steht jetzt explizit im Text |
| 3 | HIGH | „Renew-Fenster ⇒ Daemon-Neustart erneuert die 7 Leafs" ist falsch (Token-Nodes renewen nicht; Own-CA-Nodes bekommen ein Legacy-Cert) | Im Code nachgeprüft (`tls.ts:522-531`, `:655`, `:671-673`, `:700`, `index.ts:175`, `config.ts:252`) und **bestätigt**; T2.1-Absatz auf „Neustart + kanonische Reparatur bzw. Re-Onboarding" korrigiert |
| 4 | MEDIUM | „einziger Ausreißer" / „zwei Termine" trotz nicht prüfbarer `.94`/`.55` | „einziger **belegter** Ausreißer"; `.94`/`.55` als möglicher **dritter** Termin geführt |
| 5 | MEDIUM | „6 von 7" vs. 9 aufgezählte Peers unerklärt | `peers_known=7` als flüchtige Daemon-Map erklärt, 9 Identitäten benannt |
| 6 | MEDIUM | 6 Alt-Einträge pauschal zu „bloßem Registerstand" erklärt, obwohl `.94`s Eintrag als Beleg dient | Verteilung ausgerechnet: 5 überholte Duplikate, `.94` = einziger Eintrag eines nicht migrierten Peers |
| 7 | MEDIUM | „kein Eintrag ⇒ nie unter der alten CA" ist ein Fehlschluss | Beleg auf die **Own-CA** umgestellt, Zeitraum auf „seit `notBefore 2026-09-17`" begrenzt |
| 8 | LOW | Fenster-Start durch `Math.floor` einen Tag früher | Auf **2026-12-31 20:35:42 UTC** korrigiert, inkl. Kopfzeile |
| 9 | NIT | `loadOrCreateTlsBundle`/Gate liegen in `tls.ts`, nicht `config.ts:251`; `COMPLIANCE-TABLE.md` als Teil behauptet, aber nicht im Diff | Quellen getrennt zitiert; `COMPLIANCE-TABLE.md` ist jetzt tatsächlich Teil des Slices |

### Runde 2 — auf den korrigierten Diff

Runde 2 lief gegen denselben Reviewer und fand **keinen HIGH**, aber **1 MEDIUM, 1 LOW, 2 NIT** — der MEDIUM
traf genau den Satz, der für die Zwei-Wege-Rahmung **neu** eingefügt worden war. Alle vier sind eingearbeitet:

| # | Sev | Befund | Auflösung |
|---|---|---|---|
| 10 | MEDIUM | „`migrate_legacy_identity` vor dem Neustart aktivieren" ist nicht gedeckt: der Migrationszweig verlangt `certSpiffeUri.startsWith('spiffe://thinklocal/host/')` (`tls.ts:632-633`) und greift auf einem bereits kanonischen Cert gar nicht; die Begründung „nur bei `fullyValid`" war zudem falsch (`tls.ts:596` ist im ganzen Fenster `true`) | Im Code nachgeprüft und **bestätigt**. Der Text sagt jetzt: das Flag **verhindert** den Clobber nicht und würde ihn erst bei einem **zweiten** Neustart rückgängig machen; die falsche `fullyValid`-Begründung ist ersetzt |
| 11 | LOW | `.56`/`.222` als „Own-CA-Nodes" klassifiziert, obwohl von TH01 aus nicht feststellbar, ob sie einen lokalen `ca.key.pem` haben | Own-CA ist jetzt **nur für TH01** belegt (`ca.key.pem` lokal, `0600`); für die Peers steht ausdrücklich, dass der Zweig von hier **nicht entscheidbar** ist und pro Peer offen bleibt |
| 12 | NIT | Wortlaut-Diskrepanz „prüfbarer" vs. „belegter" Ausreißer | Auf „belegter" angeglichen |
| 13 | NIT | Prüfnotiz nannte vier Referenzen, darunter die inzwischen entfallene `cert-expiry-monitor.ts:84` | Liste auf die 13 tatsächlich zitierten Stellen umgestellt, Entfall erklärt |

**Alle Code-Referenzen im Text wurden einzeln gegen die Dateien geprüft** und treffen wörtlich zu:
`agent-card.ts:229-230`, `mesh.ts:600`, `config.ts:251`, `config.ts:252`, `tls.ts:395`, `tls.ts:522-531`,
`tls.ts:590-592`, `tls.ts:596`, `tls.ts:632-633`, `tls.ts:655`, `tls.ts:671-673`, `tls.ts:700`,
`index.ts:175`. (`cert-expiry-monitor.ts:84` war in der ersten Fassung zitiert und ist nach der
HIGH-3-Korrektur entfallen — die Aussage steht jetzt an der Quelle in `tls.ts`.)

## Grenzen dieses Slices

- Nur Doku. `TODO.md` ist die inhaltliche Änderung; `CHANGES.md`, `COMPLIANCE-TABLE.md` und diese Datei sind
  der Haus-Kanon (`CLAUDE.md:29`, `CONTRIBUTING.md` → Doku-Kanon). Der Auftrag wollte „nur `TODO.md`"; die
  Abweichung ist bewusst und gemeldet, Präzedenz sind die docs-only-PRs **#360** und **#361**.
- `~/.thinklocal/tls/` wurde ausschließlich **gelesen**; die Mtimes sind nach der Ermittlung unverändert
  (02.11. 21:22 / 21:35 CET).
- Die sechs `GET /api/status` sind **lesende** Requests gegen laufende Peers — kein Write, kein Re-Enroll,
  kein CA-Key-Einsatz, kein `pop-canonicalize.ts`-Lauf, kein Dienst-Eingriff, kein Merge.
- Kein Key-Material und keine PEM-Inhalte in der Doku — nur Subject, Issuer, `notBefore`/`notAfter`.
