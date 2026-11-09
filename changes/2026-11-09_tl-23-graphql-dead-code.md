# changes/2026-11-09 — refactor(daemon): TL-23 — tote GraphQL-Schnittstelle entfernen

**Typ:** Dead-Code-Entfernung (`packages/daemon/src/`-Diff, reversibel über Revert) plus die Doku und die
zwei npm-Abhängigkeiten, die nur diese Datei getragen haben. **Kein** Verhaltens-Delta am laufenden Dienst,
**kein** Deploy, **kein** Secret, **kein** State, **kein** Dienst-Eingriff, **kein** Beschluss. Freigegeben
als TL-23 aus dem `TODO.md`-Abschnitt „P2 — Ausbau" (Befund vom 2026-07-04).

Der Auftrag verlangte ausdrücklich, die Verwaistheit **selbst noch einmal** zu belegen und bei einem echten
Aufrufer **abzubrechen**. Das ist unten der Abschnitt (a) — sechs unabhängige Belege, einer davon eine
Negativprobe gegen den laufenden Testlauf.

---

## (a) Verwaistheit — belegt, nicht aus dem TODO übernommen

| # | Prüfung | Ergebnis |
|---|---|---|
| 1 | `git grep -n "graphql-api\|registerGraphQL\|GraphQLApi"` über `packages/`, `tests/`, `scripts/` | **ein** Treffer außerhalb der Datei selbst: `version-compat.ts:114` — nur der Feature-Matrix-**Eintrag** `'graphql-api': '0.25.0'`, kein Import |
| 2 | `grep -ni "graphql\|mercurius" packages/daemon/src/index.ts` | **0 Treffer** — die Datei wird nirgends registriert, die Route `/graphql` existiert zur Laufzeit nicht |
| 3 | Dynamische Importe über `packages/`, `tests/`, `scripts/`: `git grep -nE` mit den Alternativen `await import\(`, `import\(` plus Quote und `require\(`, getrennt durch ein **unescaptes** `\|` — mit `\|` liefert `-E` 0 Treffer, das wäre ein Scheinbeleg (CR-Runde 1, NIT) | **46** Treffer, **keiner** auf `graphql-api`; kein Barrel-/Re-Export (`export * `) in `packages/daemon/src/` |
| 4 | **Gebautes Artefakt** (der Weg, den mein Grep über den Quellbaum nicht erfasst): `grep -c graphql packages/daemon/dist/index.js` ⇒ **0**; `grep -rln "graphql-api.js" packages/daemon/dist/` ⇒ **kein Treffer** | `dist/graphql-api.js` lag als **verwaistes** Build-Artefakt da — nichts im kompilierten Baum lädt es |
| 5 | **Endpunkt-Ebene** statt Bezeichner-Ebene (CR-Runde 1, LOW 1 — die Prüfungen 1–3 hätten einen HTTP-/WS-Client, der nur den Pfad kennt, nicht gefunden): `git grep -n "graphiql\|/graphql"` repo-weit, abzüglich Historie und dieses Slices | **0** Treffer; zusätzlich `grep -rni "graphql\|graphiql" packages/dashboard-ui/src packages/cli/src` ⇒ 0 und `config/` plus `config.ts` ⇒ 0 (kein konfig-gesteuertes Laden) |
| 6 | **Negativprobe:** `node_modules/graphql`, `node_modules/mercurius` und `node_modules/graphql-jit` vor dem Lauf unauflösbar gemacht (umbenannt), dann `tsc --noEmit` + voller Testlauf | `tsc` **0 Fehler**, Suite **151 Dateien / 2123 Tests grün** — hätte irgendein Modul die Pakete gebraucht, wäre die Auflösung gebrochen |

**Kein Aufrufer gefunden ⇒ kein Abbruch.** Ein Testfile zu `graphql-api.ts` existierte nicht
(`git ls-files | grep -iE "graphql.*test"` ⇒ leer), es war also auch kein Test mitzunehmen.

**Nebenbefund zur Einordnung, nicht zur Entschuldigung:** `registerGraphQL` holte seine Daten über
unauthentifizierte `fetch(`${daemonUrl}/api/status`)`-Aufrufe und schaltete GraphiQL bei
`NODE_ENV=development` frei. Genau diese Fläche ist historisch schon einmal als HIGH aufgelaufen
(`COMPLIANCE-TABLE.md:299`, „GraphQL GraphiQL in Produktion offen", gefixt in #94). Toter Code mit
Auth-Fläche ist der Grund, warum TL-23 kein Kosmetik-Punkt ist.

---

## (b) Was entfernt wurde

| Datei | Art | Begründung |
|---|---|---|
| `packages/daemon/src/graphql-api.ts` | gelöscht (189 Zeilen) | einziger Export `registerGraphQL`, kein Aufrufer (a) |
| `packages/daemon/src/version-compat.ts` | eine Zeile | `'graphql-api': '0.25.0'` kündigte ein Feature an, das es nicht gibt |
| `docs/GRAPHQL-SCHEMA.md` | gelöscht (164 Zeilen) | dokumentierte ausschließlich diese Schnittstelle |
| `docs/DEVELOPER-GUIDE.md` | drei Zeilen | zwei Endpunkt-Zeilen (`/graphql`, `/graphiql`) aus der Routen-Tabelle und `graphql-api.ts` aus dem Verzeichnisbaum |
| `packages/daemon/package.json` | zwei Zeilen | `graphql ^16.13.2` **und** `mercurius ^16.9.0` — beide hatten `graphql-api.ts` als einzigen Importer (`mercurius` stand nicht im Auftrag, fällt aber aus demselben Grund) |
| `packages/daemon/package-lock.json` | regeneriert | **Pflicht**, nicht Kosmetik: die CI fährt `npm ci` (`ci.yml:25`), das bricht bei Lock↔`package.json`-Drift ab |

**Zur `graphql`-Abhängigkeit wie im Auftrag verlangt geprüft:** `git grep -n "from 'graphql'\|require('graphql')"`
repo-weit ⇒ nur `graphql-api.ts`; `graphql`/`mercurius` stehen in **keiner** anderen `package.json`
(Root, `packages/cli`, `packages/dashboard-ui` führen sie nicht). Also entfernt, nicht begründet behalten.

**Lock-Diff gegen `main`: 1 Einfügung / 492 Löschungen**, geprüft statt angenommen — die 40 verschwundenen
`node_modules/*`-Knoten sind ausnahmslos `graphql`/`mercurius` und deren Transitive (`graphql-jit`,
`@graphql-typed-document-node/core`, `mqemitter`, `qlobber`, `single-user-cache`, `tiny-lru`,
`@fastify/static`, …). Die **einzige** Einfügung ist `"dev": true` an `lodash.merge`: das Paket war bisher
sowohl Produktions-Transitive (über `mercurius`) als auch Dev-Transitive (über eslint) und ist jetzt
nur noch Letzteres. **Keine** Versionsänderung an einem fremden Paket.
`npm ci --dry-run` ⇒ **Exit 0** — das ist der Beleg, auf den es ankommt: der Lock ist mit `package.json`
konsistent, die CI bricht also nicht ab. Die **Paketzahlen** derselben Ausgabe sind dagegen kein stabiler
Beleg, sondern eine Differenz zum momentanen `node_modules/`: mein Lauf meldete „removed 40", ein späterer
Lauf des Reviewers „removed 29" — weil ich die drei Pakete für die Negativprobe (a) 6 zwischenzeitlich aus
dem Arbeitsbaum entfernt hatte (CR-Runde 1, LOW 3). Belastbar über den Lock ist deshalb der Diff selbst,
nicht der Dry-Run-Zähler.

---

## (c) Was bewusst **nicht** angefasst wurde

Nach der Entfernung nennen noch drei Dateien GraphQL: `CHANGES.md` (drei Stellen im Abschnitt zum
2026-04-05), `COMPLIANCE-TABLE.md` (die PR-Zeilen #48/#68/#75 und der HIGH-Eintrag #93) und `TODO.md`
(sechs Zeilen im Erledigt-Archiv desselben Datums). Zeilennummern nenne ich hier absichtlich **nicht** —
sie verschieben sich durch diesen PR selbst (CR-Runde 1, NIT). Das sind **Historien- und
Prozess-Nachweise** — nach
`CONTRIBUTING.md:15-21` ist `CHANGES.md` die technische Historie und `COMPLIANCE-TABLE.md` der
Prozess-Nachweis je PR. Dort steht korrekt, was am 2026-04-05 gebaut wurde; das rückwirkend zu
löschen wäre Geschichtsfälschung, nicht Aufräumen. Die `TODO.md`-Treffer liegen im Erledigt-Archiv
desselben Datums. **Kein lebendes Dokument** verlinkt noch auf `docs/GRAPHQL-SCHEMA.md`:
`docs/openapi.yaml` nennt GraphQL nicht (geprüft), `README.md`/`INSTALL.md`/`SECURITY.md` ebenfalls nicht.

Ebenfalls nicht angefasst: `FEATURE_MATRIX` als Ganzes. Sie hat **überhaupt keinen** Aufrufer — auch
keinen Test (eine `version-compat.test.ts` existiert nicht, `semver.test.ts` testet `semver.ts`). Die in
`changes/2026-07-21_adr-046-wire-feature-exchange-scoping.md:15` gewählte Formulierung „außerhalb Tests
nirgends aufgerufen" hatte ich zunächst übernommen; sie ist zu schwach, nachgemessen (CR-Runde 1, LOW 2).
Weil die Matrix nirgends gelesen wird, ist das Entfernen des einen Eintrags **garantiert** kein Wire- oder
Protokoll-Bruch gegenüber älteren Peers. Stehen bleibt sie trotzdem, denn **ADR-046** (Status *Proposed*)
baut genau auf ihr auf — sie zu entfernen wäre ein Beschluss gegen einen offenen ADR, nicht ein
Dead-Code-Slice. Entfernt wurde nur der eine Eintrag, dessen Feature es nicht mehr gibt.

---

## (d) `TODO.md` nachgezogen — und wo ich es **nicht** getan habe

Der Auftrag bat, die Nachbarpunkte TL-16/17/18/19 mitzuprüfen, **aber nur zu ziehen, was belegt ist**.
**Bei TL-18 habe ich genau daran zuerst vorbeigegriffen:** erste Fassung dieses Slices zog ihn auf `[x]`,
weil Ablehnung **und** drei Alarm-Wege im Code stehen. Die externe CR-Runde 1 hat dagegen gehalten, dass
ein emittiertes Event ohne Consumer kein Alarm ist — im Code gegengeprüft, **bestätigt**, Punkt wieder
auf `[ ]` gesetzt. Die Zeile im `TODO.md` nennt jetzt den Teilstand und den Restaufwand.

| Punkt | Befund | Folge |
|---|---|---|
| **TL-23** | dieser PR | **`[x]`** mit Abschlussvermerk |
| **TL-18** (place-or-refuse, >90 % RAM ⇒ Ablehnung **+ Alarm**) | **halb — Ablehnung ja, Alarm nein.** Ablehnung fertig und getestet: Default `refuse_ram_percent: 90` (`config.ts:255`, Bereich 1..100 validiert `:480`), verdrahtet `index.ts:956-957`, Entscheidung `task-executor.ts:147-149`, 21 Tests `place-or-refuse.test.ts`. Alarm **nicht**: `task:refused` (`task-executor.ts:155`) hat repo-weit **keinen Consumer** — nur in der Typ-Union (`events.ts:28`), und der Telegram-Sink verwirft es im `default`-Zweig (`telegram-gateway.ts:96-99`), während `task:failed`/`system:cert_expiry`/`system:skill_health` zugestellt werden; die Tests prüfen keinen der drei Wege | **bleibt `[ ]`**, mit gemessenem Teilstand |
| **TL-16** (Passphrase off-disk, systemd-credentials) | `git grep -l "systemd-credentials\|LoadCredential\|CREDENTIALS_DIRECTORY"` ⇒ **nur `TODO.md`** | bleibt offen |
| **TL-17** (Fremdtext-Entschärfung) | kein Modul im Repo (`git ls-files \| grep -iE "sanitiz\|defang\|untrusted-text"` ⇒ leer) | bleibt offen |
| **TL-19** (Pooling + Sicherungsschalter je Owner-Peer, `resolveMcp` meidet kranke Anbieter) | **halb** — `circuit-breaker.ts` existiert, hat aber **außer seinem Test keinen Aufrufer**; `resolveMcp` kennt ihn nicht; Pooling/keepAlive gibt es nur im `local-daemon-client.ts` (lokaler Socket, nicht je Owner-Peer) | bleibt offen |

**TL-19 ist damit der nächste Dead-Code-Kandidat derselben Klasse** (`circuit-breaker.ts` ohne Aufrufer) —
aber mit dem Unterschied, dass TL-19 ihn **noch braucht**. Das ist deshalb **kein** Löschkandidat, sondern
ein Verdrahtungs-Rest. **Nur gemeldet, nicht angefasst, nicht freigegeben.**

---

## (e) Build-, Test- und Lint-Bilanz

Gegen die **Baseline auf `main`**, vor dem ersten Eingriff gemessen — sonst wäre „grün" nicht belastbar:

| Lauf (CI-äquivalent, `working-directory: packages/daemon`) | `main` | dieser Branch |
|---|---|---|
| `npx tsc --noEmit` | 0 | **0** |
| `npx tsc --noEmit -p tsconfig.scripts.json` | 0 | **0** |
| `npm run lint:scripts` (`--max-warnings 0`) | 0 | **0** |
| `npx vitest run` (`NODE_ENV=test`) | 151 Dateien / **2123** Tests grün | 151 Dateien / **2123** Tests grün |
| `npx tsc` (Emit) | Exit 0 | Exit 0 |

Zusätzlich vom Repo-Wurzelverzeichnis:

- `npx vitest run` (zieht `tests/integration/` mit): **2267 Tests grün**, dazu **unverändert** die eine
  vorbestehende Sammel-Fehlmeldung `scripts/check-native-modules.test.cjs` („No test suite found") — das ist
  eine `node --test`-CJS-Datei, die der Wurzel-Glob von vitest fälschlich einsammelt; sie läuft korrekt über
  `npm run test:scripts` und ist **nicht** CI-gated. Vor und nach diesem Diff identisch.
- `npm run lint`: **464 → 462 Probleme** (246 → 245 Fehler, 218 → 217 Warnungen). Die zwei verschwundenen
  Befunde sind die aus `graphql-api.ts`. Der Lauf ist auf `main` seit Langem rot (Altbestand in `src/`,
  so auch in `ci.yml:38-39` dokumentiert) und deshalb kein Gate — die Richtung ist hier trotzdem korrekt.

**Testzahl absichtlich unverändert:** es wurde nichts hinzugefügt, dessen Verhalten man testen könnte, und
es ist kein Test entfallen (es gab keinen). Der Beleg für diesen Slice ist nicht ein neuer Test, sondern die
Negativprobe (a) 6 — der Testlauf blieb grün, **obwohl** die drei npm-Pakete unauflösbar waren.

---

## (f) Code-Review

`pal:codereview` ist weiter unbrauchbar — beide Fremd-Backends brechen mit
`executable not found in PATH` ab (dokumentiert in #364/#365). Review-of-Record deshalb über
**`~/.local/bin/agy --sandbox`** (Gemini, **nicht** das implementierende Modell), wie in den letzten
vier PRs; nie MiniMax, nie `pal:chat`. Ergebnis siehe `COMPLIANCE-TABLE.md`-Zeile zu diesem PR.

---

## (g) Grenzen dieses Slices

- **Kein** Merge — der wird nur bei grünem CI-**Beleg** und grünem Review gezogen, und nicht von mir.
- **Kein** Eingriff in `/opt/thinkhub`, **kein** Reboot, **kein** Dienst-/Container-Neustart, **kein**
  Deploy-Key, **kein** Secret, **kein** Push auf `main`, **kein** Force-Push, **kein** Branch-Delete.
- **Kein** Eingriff an CO-07 / Mesh / Tailscale.
- Der **laufende** TH01-Daemon ist nicht angefasst. Er fährt den Stand vor diesem Diff; da er
  `graphql-api.js` ohnehin nie geladen hat (a) 4, ist das Verhaltens-Delta beim nächsten Neustart **null**
  — relevant bleibt dafür allein das in `TODO.md` B2 datierte Renew-Fenster ab **2026-12-31**, das dieser
  PR **nicht** berührt.
