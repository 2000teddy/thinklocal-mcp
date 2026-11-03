# changes/2026-11-03 — build(gates): `packages/daemon/scripts/` in tsc und eslint aufnehmen

**Typ:** Build-/CI-Verdrahtung (additiv, reversibel) + die Altbefunde, die die neu geöffneten Gates in
`discovery-poc.ts` aufgedeckt haben. **Kein** `packages/daemon/src/`-Diff, **kein** Deploy, **kein** Secret,
**kein** State, **kein** Dienst-Eingriff, **kein** Beschluss. Der **Build-Pfad bleibt unverändert** — unten
belegt, nicht behauptet. Freigegeben als Folge-Slice zu #363, wo die Lücke als bewusst offen vermerkt wurde.

---

## (a) Drei Befunde, die den Zuschnitt bestimmt haben

**1. Welche eslint-Config für `scripts/` gilt, war keine offene Frage — sie ist vom Werkzeug entschieden.**
Für alles unter `packages/daemon/` greift `packages/daemon/eslint.config.js` (`tseslint.configs.strict`),
nicht die laxere Root-Config. Belegt per `--print-config` **vom Repo-Wurzelverzeichnis aus**:

| Datei | `@typescript-eslint/no-explicit-any` | ⇒ wirksame Config |
|---|---|---|
| `packages/daemon/scripts/pop-canonicalize.ts` | `[2]` = error | **daemon** (strict) |
| `packages/daemon/src/tls.ts` | `[2]` = error | **daemon** (strict) |
| `packages/cli/src/thinklocal.ts` | `[1]` = warn | root |

**Präzisierung aus dem Review (CR-LOW 1):** das Ergebnis ist in beiden Aufrufwegen gleich, der *Mechanismus*
aber nicht — und meine erste Fassung hat das zu grob formuliert. Die beiden Pakete führen **verschiedene
eslint-Hauptversionen**, nachgemessen:

| Aufruf | Binary | Version | Auflösung |
|---|---|---|---|
| `npm run lint` (Repo-Wurzel) | `./node_modules/.bin/eslint` | **v10.2.0** (`devDep ^10.2.0`) | **pro Datei** |
| `npm run lint:scripts` / CI (`working-directory: packages/daemon`) | `packages/daemon/node_modules/.bin/eslint` | **v9.39.4** (`devDep ^9.17.0`) | über das **cwd** |

Beide landen bei derselben Config, also gibt es **keine stille Divergenz** zwischen Root-Lauf und CI-Lauf.
Die Versionsspreizung selbst ist ein Altbestand und bleibt ausserhalb dieser Freigabe.

Die aktiv getroffene Entscheidung ist deshalb nicht „welche Config", sondern **die Auflösung zu akzeptieren
statt sie zu überstimmen**: die strengere Daemon-Config gilt, ohne `--no-config-lookup` und ohne eine
`scripts/`-Sonderregel. Jede Alternative hätte eine Ausnahme eingeführt, die niemand mehr sieht.

**2. `npm run lint` ist auf `main` bereits rot — Lint ist heute gar kein Gate.**
Gemessen auf `main` @ `0641f5e`, **vor** jeder Änderung dieses Slices:
`✖ 464 problems (246 errors, 218 warnings)`, Exit-Code **1**, sämtlich aus den `src`-Pfaden. Daraus folgt:
`scripts/` einfach an `npm run lint` anzuhängen hätte die Lücke **nicht** geschlossen, sondern nur 0 neue
Befunde zu 464 bestehenden addiert — in einem Befehl, den niemand grün bekommt. Die 464 Altbefunde sind
**nicht** Teil dieser Freigabe (sie wären ein `src/`-Diff in dreistelliger Zahl).

**3. Die CI führte überhaupt kein eslint aus.** `.github/workflows/ci.yml`, Job `daemon`, hatte genau zwei
Prüfschritte: `npx tsc --noEmit` und `npx vitest run`. Ohne einen neuen CI-Schritt wäre „Gate geschlossen"
eine Behauptung über einen Befehl, den die CI nie aufruft.

**Konsequenz:** statt den roten repoweiten Lint-Lauf zum Gate zu erklären, bekommt `scripts/` einen **eng
gefassten, grünen und deshalb blockierenden** eigenen Lauf — plus den tsc-Lauf. Beide hängen in der CI.

## (b) tsc-Gate — Weg (a) aus dem Auftrag, mit Begründung

Neu: **`packages/daemon/tsconfig.scripts.json`** — `extends` auf die Basis-Config,
`include: ["scripts/**/*.ts"]`, `noEmit: true`, `rootDir: "."`, `declaration`/`declarationMap`/`sourceMap` aus.

Weg (a) statt (b), weil die Basis-Config **der Build** ist (`rootDir: "src"`, `outDir: "dist"`,
`declaration: true`). `scripts/` dort ins `include` zu nehmen hätte `rootDir` auf `"."` zwingen müssen — und
damit **jeden** Emit-Pfad von `npm run daemon:build` verschoben und die Operator-Skripte nach `dist/`
mitgenommen. Eine Repo-weite `tsconfig.check.json` (Weg b) hätte zusätzlich `packages/observer` und
`packages/cli` eingefangen, die hier nicht zur Debatte stehen.

`rootDir: "."` ist dabei **nicht Kosmetik, sondern notwendig**: die Skripte importieren über `../src/*.js` in
`packages/daemon/src/`, liegen also ausserhalb von `rootDir: "src"` — geerbt würde `tsc` mit `TS6059`
abbrechen. `"."` wird relativ zum Verzeichnis **der erbenden Datei** aufgelöst, also `packages/daemon`.

**Der Build-Pfad ist nachweislich unberührt** — die Dateimenge beider Programme direkt verglichen:

```bash
npx tsc --noEmit --listFilesOnly -p tsconfig.json         | grep -c '/scripts/'   # ⇒ 0
npx tsc --noEmit --listFilesOnly -p tsconfig.scripts.json | grep  '/scripts/'     # ⇒ 4 Dateien
```

Die Basis-Config referenziert `tsconfig.scripts.json` nicht; `npm run daemon:build` liest ausschliesslich
`tsconfig.json`. Das Gate erfasst **vier** Dateien: `canonicalize-pairings.ts`, `discovery-poc.ts`,
`pop-canonicalize.ts` und `pop-canonicalize.test.ts` (die transitiv importierten `src/`-Module laufen als
Abhängigkeiten mit durch den Typcheck, werden aber nicht emittiert). Die Testdatei ist bewusst dabei: das
`exclude` der Basis (`**/*.test.ts`) wird hier überschrieben, weil es dort nur den **Build** vor Testcode
schützt — für ein reines `--noEmit`-Gate gibt es keinen Grund, den Test ungeprüft zu lassen. Da `include` eng
auf `scripts/**/*.ts` steht, hat das überschriebene `exclude` keine Wirkung auf `src/**/*.test.ts`.

## (c) Lint-Gate — Glob statt Verzeichnis, und warum

Neu: **`lint:scripts`** = `eslint "scripts/**/*.ts" --max-warnings 0` (in `packages/daemon`),
**`typecheck:scripts`** = `tsc --noEmit -p tsconfig.scripts.json`, dazu Root-Aliase.
`packages/daemon/scripts/**/*.ts` ist ausserdem an das bestehende Root-`lint`/`lint:fix` angehängt.

Zwei bewusste Details:

- **Glob statt Verzeichnis.** Der Auftrag hält fest, dass `.mjs` draussen bleiben soll — das ist für die
  **Root**-Config richtig (`ignores: ['**/*.js','**/*.mjs']`), gilt aber **nicht** für die Daemon-Config, die
  hier wirklich greift (ihre `ignores` sind nur `['dist/','node_modules/','*.config.js']`). Ein
  Verzeichnis-Argument hätte `migrate-pairings.mjs` und `produce-genesis-blob.mjs` also stillschweigend
  mit eingezogen und **32 `no-undef`-Fehler + 6 Warnungen** produziert. Mit dem Glob steht die Ausnahme
  **im Befehl** statt versteckt in einer Config — sichtbar und in einer Zeile umkehrbar.
- **`--max-warnings 0`.** Ohne das beendet sich eslint bei reinen Warnungen mit **0**. Die
  `explicit-function-return-type`-Befunde (Severity `warn` in der Daemon-Config) wären damit „gefixt", aber
  **nicht abgesichert** — die Rückdrehproben 3–5 in (e) wären grün geblieben. Erst dadurch ist das Gate eines.
  Dass der Root-`lint` dieses Flag **nicht** trägt, ist bewusst: dort stehen 218 Altwarnungen aus `src/`.
  Solange `lint:scripts` das CI-Gate ist, divergiert nichts; wer später die 464 Altbefunde aufräumt, sollte
  entweder `explicit-function-return-type` auf `error` heben oder `--max-warnings 0` vereinheitlichen.

## (d) Was die Gates aufgedeckt haben — alle Befunde, alle in `discovery-poc.ts`

Keine Regression: die Datei ist inhaltlich unverändert seit 2026-07-06, die Befunde waren nur unsichtbar.
`canonicalize-pairings.ts`, `pop-canonicalize.ts` und `pop-canonicalize.test.ts` sind **ohne jeden Befund**
durch beide Gates gegangen. Zeilennummern **gemessen**, nicht gerechnet (`main`-Stand per
`git show main:…`, neuer Stand per `grep -n`).

| Gate | Fundstelle (`main`) | Befund | Fix (neue Zeile) |
|---|---|---|---|
| tsc | `:168` | `TS7006` — Parameter `a` implizit `any` in `addresses.filter(a => …)`, weil der `'up'`-Callback-Parameter untypisiert war (`Browser` erbt `EventEmitter` ohne Event-Map) | Parameter typisieren: `browser.on('up', (svc: Service) => …)`; `svc.addresses` ist in `bonjour-service` als `string[] \| undefined` deklariert, damit entfällt jede Zusicherung (`:164`, Import `:36`) |
| eslint | `:118`, `:119`, `:121` | 3× `no-explicit-any` im `records()`-Monkey-Patch (`(service as any).records`, `(r: any)`) | `service.records.bind(service)` direkt, Rückgabetyp aus der Deklaration abgeleitet: `function (): ReturnType<typeof service.records>` (`:121-122`) |
| eslint | `:119` | fehlender Rückgabetyp der Patch-Funktion | derselbe `ReturnType<…>` (`:122`) |
| eslint | `:198` → `analyzeResults` | fehlender Rückgabetyp | `: void` (`:201`; die Funktion hat genau ein nacktes `return;`) |
| eslint | `:242` → `main` | fehlender Rückgabetyp | `: Promise<void>` (`:245`) |

**Der Fix ist in der Review-Runde kleiner geworden, nicht größer** (s. (f)): die erste Fassung baute zwei
lokale Interfaces (`MdnsRecord`, `RecordProducingService`) und einen `as unknown as`-Doppelcast, weil ich
annahm, `bonjour-service` typisiere `records()` nicht öffentlich. **Das war falsch** —
`node_modules/bonjour-service/dist/lib/service.d.ts:47` deklariert `records(): Array<ServiceRecord>`.
Beides ist deshalb wieder raus. **Zahl präzisiert (CR-Runde 2, NIT):** gegen `main` sind es
**10 Einfügungen / 7 Löschungen** (288 → 291 Zeilen; 7 Codezeilen raus, 7 rein, plus 3 Kommentarzeilen).
Die zuerst genannten „8 / 19" waren das Delta **von Runde 1 zu Runde 2** — die Nachbesserung hat den Fix also
um 11 Zeilen verkleinert, aber nicht die Datei gegenüber `main`.

**Verhalten unverändert.** Die Filterlogik (`A` nur bei `data === meshIp`, `AAAA` raus, Rest durch), die
Bindung an `service` und alle Ausgaben sind identisch; die Änderungen sind rein statisch. **An
`pop-canonicalize.ts` wurde nichts geändert** — die Datei hat beide Gates ohne Befund passiert.

## (e) Rückdrehprobe — 7/7, und zwei davon prüfen die Abdeckung selbst

Jeder Fix einzeln zurückgedreht; jedes Mal muss das zuständige Gate rot werden:

| # | Rückdrehung | Gate | Ergebnis |
|---|---|---|---|
| 1 | Parametertyp `(svc: Service)` entfernt | `typecheck:scripts` | **rot** |
| 2 | `records` wieder über `(service as any)` | `lint:scripts` | **rot** |
| 3 | Rückgabetyp `analyzeResults` entfernt | `lint:scripts` | **rot** (nur dank `--max-warnings 0`) |
| 4 | Rückgabetyp `main` entfernt | `lint:scripts` | **rot** (dito) |
| 5 | Rückgabetyp des `records`-Patches entfernt | `lint:scripts` | **rot** (dito) |
| 6 | **toter Import in `canonicalize-pairings.ts`** eingefügt | `typecheck:scripts` | **rot** |
| 7 | **`any` in `pop-canonicalize.ts`** eingefügt | `lint:scripts` | **rot** |

6 und 7 greifen absichtlich **fremde** Dateien an: sie belegen, dass das Gate das ganze Verzeichnis deckt und
nicht nur die eine Datei, die ich angefasst habe. Nach jeder Probe wurden alle vier `.ts`-Dateien per
`sha256sum -c` als unverändert bestätigt.

## (f) Code-Review — `pal:codereview` nicht lauffähig, Ersatzweg und 5 Befunde

**Der im Auftrag genannte Weg hat nicht funktioniert, und das ist keine Auslassung, sondern ein Befund:**
`pal:codereview` lief als Workflow durch, brach aber in der externen Validierung bei **beiden** Fremdmodellen
ab — `cli-codex-gpt` ⇒ `executable 'codex' not found in PATH`, `cli-agy-gemini-pro` ⇒
`executable 'agy' not found in PATH`. Beide Binaries liegen in `~/.local/bin` und funktionieren über den
absoluten Pfad; der `pal`-Serverprozess erbt dieses Verzeichnis nicht. Das ist dasselbe PATH-Problem, das
`pal:precommit` seit Wochen blockiert.

Ersatzweg, ausdrücklich benannt: **`agy` direkt** über `~/.local/bin/agy --sandbox`, also dasselbe
Fremdmodell (Gemini 3 Pro) wie `cli-agy-gemini-pro`, nur ohne `pal` davor — **nie** `pal:chat`, **nie**
MiniMax. Die inhaltliche Anforderung „anderes Modell als das implementierende" ist damit erfüllt, der
vorgeschriebene Aufrufweg nicht.

**Ergebnis: APPROVE — 0 HIGH / 0 MEDIUM / 3 LOW / 2 NIT. Alle fünf umgesetzt:**

| CR-Finding | Inhalt | Umsetzung |
|---|---|---|
| **LOW 1** | Die Begründung „ESLint v10.2.0 löst pro Datei auf" gilt nur für den Root-Lauf; die CI läuft unter dem daemon-lokalen **v9.39.4** (Auflösung über `cwd`). | Nachgemessen (`v10.2.0` vs. `v9.39.4`) und in (a).1 als Tabelle präzisiert, samt der Feststellung, dass beide Wege bei derselben Config landen. |
| **LOW 2** | Mein Kommentar behauptete, `bonjour-service` typisiere `records()` nicht öffentlich — **falsch** (`service.d.ts:47`). Die zwei lokalen Interfaces und der Doppelcast waren unnötig. | Gegen die `.d.ts` geprüft, beides entfernt, Rückgabetyp über `ReturnType<typeof service.records>`. Diff dadurch **netto kleiner**. |
| **LOW 3** | Der Compliance-Check in `ci.yml` erzwang eine COMPLIANCE-Zeile nur bei `packages/daemon/src/.*\.ts`, nicht bei `scripts/`. | Regex auf `packages/daemon/(src\|scripts)/.*\.ts` erweitert — eine reine `scripts/`-Änderung kann jetzt nicht mehr ohne COMPLIANCE-Zeile durchlaufen. |
| **NIT 1** | `(svc.addresses ?? []) as string[]` ist eine Zusicherung, wo eine Parameter-Typisierung genügt. | `browser.on('up', (svc: Service) => …)`, Zusicherung entfällt. |
| **NIT 2** | `"lint": "eslint src/ --ext .ts"` — `--ext` ist unter Flat-Config in v9 veraltet und in v10 ein CLI-Fehler; eine Landmine, sobald `packages/daemon` auf v10 gehoben wird. | **Erst gemessen, dann entfernt**: `eslint src/` und `eslint src/ --ext .ts` liefern byte-identische Ausgabe, das Flag ist bereits wirkungslos. |

**Zweite Runde über den nachgebesserten Stand: APPROVE — 0 HIGH / 0 MEDIUM / 0 LOW / 1 NIT.** Gegen die
`.d.ts` und den emittierten Code geprüft wurden: Typkorrektheit und Nicht-Zirkularität von
`ReturnType<typeof service.records>` (Zuweisung an eine Methoden-Property ist erlaubt, Laufzeit-JS identisch
zur `as any`-Fassung), die Richtigkeit von `(svc: Service)` gegen `BrowserOnUp` **und** gegen das Plain-Object,
das `Browser.buildServicesFor` zur Laufzeit tatsächlich baut, die Nebenwirkungsfreiheit der ci.yml-Regex,
sowie — strenger als meine eigene Messung — das Entfernen von `--ext`: „byte-identische Ausgabe" allein wäre
kein ausreichender Beleg gewesen, die Gegenprobe über die **Dateimenge** (je **297** gelintete `.ts`-Dateien
mit und ohne Flag) ist es.

**Das eine NIT war berechtigt und ist korrigiert:** meine Diff-Angabe „8 Einfügungen / 19 Löschungen" war das
Delta **zwischen den Review-Runden**, nicht der Diff gegen `main` — dort sind es **10 / 7**. In allen drei
Dokumenten nachgemessen und richtiggestellt.

Dass der Review-Agent nichts verändert hat, wurde in beiden Runden über `HEAD`, den Hash des
`--cached`-Diffs und `git status --porcelain` vor/nach dem Lauf geprüft.

## (g) Was bewusst AUSSERHALB des Gates bleibt

| Datei / Gruppe | Warum |
|---|---|
| `scripts/migrate-pairings.mjs`, `scripts/produce-genesis-blob.mjs` | `.mjs` bleiben laut Freigabe draussen. Zur Transparenz der Preis eines Einschlusses: **32 `no-undef`-Fehler** (`console`, `process`, `Buffer` — die Daemon-Config setzt keine Node-Globals) **+ 6 Warnungen**. Das tsc-Gate könnte sie ohnehin nicht prüfen (kein TypeScript). Ein Einschluss bräuchte `languageOptions.globals` ⇒ eigener Slice. |
| `vitest.config.ts` (Root, daemon, observer), `packages/dashboard-ui/vite.config.ts` | Die einzigen weiteren `.ts` ausserhalb von `src/`/`tests/`. Werkzeug-Konfigurationen, die ihre Typen von ihrem eigenen Tool bekommen; sie zu prüfen hieße, je Paket eine weitere Check-Config zu bauen und `packages/observer` neu anzufassen. |
| `scripts/` im Repo-Wurzelverzeichnis | Enthält **kein** TypeScript (`.cjs`/`.sh`, u. a. `check-native-modules.cjs`, `deploy-remote.sh`, `tl14-ca/*.sh`) — hier gibt es nichts zu schliessen. |
| die **464** bestehenden `npm run lint`-Befunde in `src/` | Ausserhalb dieser Freigabe, dreistelliger `src/`-Diff. Der repoweite Lint-Lauf bleibt rot; dieser Slice behauptet nicht, daran etwas zu ändern. |
| die **eslint-Versionsspreizung** Root `^10.2.0` ↔ daemon `^9.17.0` | Altbestand, aus (a).1. Folgenlos für dieses Gate (beide Wege greifen dieselbe Config), aber ein eigener Aufräum-Slice. |
| `Doc-Compliance-Gate` steht weiter auf `ENFORCE_BLOCKING: "false"` | Das Flip-Datum (2026-07-21) ist längst verstrichen; der Schalter ist ein eigener, bekannter Punkt und **nicht** Teil dieser Freigabe. Der in LOW 3 erweiterte Check liegt im `ci.yml`-Job `compliance` und blockiert dort sehr wohl. |

## (h) Zwei Abweichungen vom Auftrag — gemeldet statt eigenmächtig aufgelöst

**1. Keine `HISTORY.md`.** Der Auftrag nennt „`HISTORY.md` fortschreiben". Diese Datei existiert in
thinklocal-mcp **bewusst nicht**: `CONTRIBUTING.md:34-36` hält fest, dass die Erzählung hier in
**ADRs + `changes/`** geführt wird und eine separate `HISTORY.md` erst „bei Bedarf zum nächsten Meilenstein"
eingeführt wird. Eine anzulegen wäre ein Kanon-Beschluss, keine Doku-Pflicht — **also nicht getan.**

**2. Die Gate-Lücke stand nicht in `TODO.md`.** Geprüft: sie lebte nur im `changes/`-Eintrag, in `CHANGES.md`
und in der COMPLIANCE-Zeile von #363. „Aus dem Offen-Block streichen" ging deshalb nicht wörtlich;
stattdessen ein `[x]`-Eintrag unter **„CI/CD & Build"**, neben der ESLint-Einführung von 2026-04-05 — damit
der Backlog den Stand abbildet, statt eine Lücke zu entfernen, die dort nie war.

## Tests

| Prüfung | Ergebnis |
|---|---|
| `npx vitest run` (`packages/daemon`) | ✅ **151 Dateien / 2123 Tests grün** — unverändert; Vitest sammelt `scripts/**/*.test.ts` weiterhin ohne `include`-Override |
| `npm run typecheck:scripts` (neu) | ✅ **0 Fehler** über 4 Dateien (vorher: 1× `TS7006`, ungeprüft) |
| `npm run lint:scripts` (neu, `--max-warnings 0`) | ✅ **0 Probleme** (vorher: 3 Fehler + 3 Warnungen, ungeprüft) |
| `npx tsc --noEmit` (Basis-Config) | ✅ grün, Dateimenge unverändert — `grep -c '/scripts/'` ⇒ **0** gegen **4** beim Gate-Programm |
| `npm run lint` (Root, jetzt inkl. `scripts/`) | ⚠️ weiterhin **464 problems (246 errors)** — identische Zahl wie vor dem Slice, `scripts/` steuert **0** bei |
| Rückdrehprobe | ✅ **7/7 rot**, davon 2 an fremden Dateien; danach alle vier `.ts` per SHA-256 unverändert |
| `eslint src/` vs. `eslint src/ --ext .ts` (NIT 2) | ✅ byte-identische Ausgabe ⇒ Flag war wirkungslos, Entfernen belegt folgenlos |

## Precommit (manuell)

`pal:precommit` bleibt am PATH-Problem nicht aufrufbar (dieselbe Ursache wie bei `pal:codereview`, s. (f))
⇒ manuell: Diff vollständig gelesen; Secret-Scan clean (keine Keys, Tokens oder Passwörter; die einzige
Adresse im Diff ist die unveränderte LAN-Default-URL in `pop-canonicalize.ts`, die gar nicht angefasst
wurde); kein Eingriff in Deploy, Release oder State; die zwei neuen CI-Schritte laufen im bestehenden
`daemon`-Job und nutzen nur Werkzeuge, die `packages/daemon/package.json` bereits als devDependencies führt
(`eslint`, `typescript`, `typescript-eslint`, `@eslint/js` — in `package-lock.json` und `node_modules`
verifiziert).
