# changes/2026-11-03 — feat(scripts): `pop-canonicalize.ts` ins Repo (Operator-Runner, ADR-022 WS-3)

**Typ:** ein Script-Add + Doku. **Kein** Laufzeitcode-Diff (`packages/daemon/src/` unberührt), **kein** Deploy,
**kein** Secret, **kein** State, **kein** Dienst-Eingriff, **kein** Beschluss, **kein** Gate verschoben.
Die Datei lag seit **2026-11-02 20:35 UTC** untracked im Working Tree (Mode `0600`) — sie wird hier
**unverändert** versioniert und der Modus auf `0644` korrigiert.

---

## (a) Was die Datei ist

`packages/daemon/scripts/pop-canonicalize.ts` — der **fehlende Aufrufer** für den bereits vorhandenen
PoP-Cert-Flow aus ADR-022 Schritt 3 / WS-3:

| Baustein | Lag vorher im Repo | Aufrufbar |
|---|---|---|
| Client-Flow `requestNodeCert()` | ✅ `packages/daemon/src/cert-request.ts:108` | ❌ niemand rief ihn |
| Admin-Routen `/api/cert/nonce` + `/api/cert/sign` | ✅ `packages/daemon/src/cert-issuance-api.ts:42,58` | ✅ live registriert |
| Key-Loader `loadOrCreateLibp2pPrivateKey()` | ✅ `packages/daemon/src/libp2p-identity.ts:186` | ✅ |
| **Operator-Runner** | ❌ **fehlte** | — |

Das Skript schliesst genau diese Lücke: libp2p-Key laden → PeerID, Nonce über das **bestehende** mTLS-Cert
holen, frisches X.509-Keypair + CSR erzeugen, PoP-Scope mit dem Ed25519-Key signieren, Cert signieren lassen,
Altbestand nach `tls/pre-pop-<timestamp>/` sichern, Cert `0644` / Key `0600` schreiben.

## (b) Review des Skripts gegen seinen eigenen Header — 6 Befunde, dokumentiert statt gefixt

Gelesen wurden `pop-canonicalize.ts` vollständig plus `cert-request.ts` und `cert-issuance-api.ts`.
**Der Header beschreibt den Ablauf korrekt** (Schritte 1–5, Backup, „privater TLS-Key verlässt den Node nie",
„kein Token/Secret geloggt" — alle gegen den Code bestätigt). Sechs Punkte bleiben trotzdem offen — die ersten vier
aus meinem eigenen Lesen, die letzten zwei aus dem `agy`-Review (s. Abschnitt (f)):

| # | Fund | Stelle | Wirkung |
|---|---|---|---|
| 1 | **4 unbenutzte Imports**: `dirname`, `privateKeyFromProtobuf`, `peerIdFromPrivateKey`, `libp2pPeerIdString` | `:41`, `:43`, `:44`, `:47` | toter Code. Von CI **nicht** erfasst: `tsconfig.json:23` hat `include: ["src/**/*.ts"]`, `npm run lint` deckt nur `packages/*/src` — `scripts/` liegt ausserhalb beider Gates. Standalone-`tsc --noUnusedLocals` meldet sie als 4× `TS6133` (nachgestellt verifiziert). |
| 2 | **`timeoutMs` wirkt nicht** | `:114-130` vs. `cert-request.ts:119,147` | `requestNodeCert` setzt `signal: AbortSignal.timeout(15s)`, der `fetchImpl`-Adapter des Skripts gibt `method/origin/path/headers/body` an `agent.request()` weiter — **`init.signal` wird verworfen**. Ein hängender Admin blockiert den Lauf unbegrenzt statt nach 15 s abzubrechen. |
| 3 | **Header sagt „laden", Code kann *erzeugen*** | `:87` → `libp2p-identity.ts:186` | `loadOrCreateLibp2pPrivateKey` ist load-**or-create**. Auf einem Node ohne persistierten Key erzeugt der Lauf still eine **neue** PeerID und holt ein Cert für eine Identität, die der Mesh nicht kennt — statt fail-closed abzubrechen. Die Cert-/Key-/CA-Vorprüfung (`:80-84`) fängt das nicht ab. |
| 4 | **Backup-Verzeichnis ohne Mode** | `:141` | `mkdirSync(backupDir, { recursive: true })` nimmt die umask → live `0775`. Der kopierte Key erbt über `copyFileSync` die Quellrechte (`0600`, live bestätigt), das Verzeichnis selbst ist aber welt-lesbar. Zum Vergleich: der manuelle `pre-newca-20261102/`-Ordner ist `0700`. |
| 5 | **`servername: 'localhost'` hartcodiert** | `:104` | Der mTLS-Agent erzwingt den TLS-SNI/Hostname `localhost`. Das trägt nur, solange jedes Admin-Server-Cert `DNS:localhost` im SAN führt (bei TH01 live der Fall) — gegen einen Admin ohne diesen SAN schlägt der Lauf mit einem Hostname-Fehler fehl, obwohl `--admin-url` korrekt ist. Entweder aus `adminUrl` ableiten oder die Annahme im Header nennen. |
| 6 | **`dispatcher` wird übergeben und nie gelesen** | `:131` vs. `:114-130` | `requestNodeCert` bekommt `dispatcher: agent`, der eigene `fetchImpl`-Adapter nutzt aber den `agent` direkt aus dem Closure und liest `init.dispatcher` nicht. Heute wirkungsgleich, aber irreführend: wer den Adapter später austauscht, verliert das Client-Cert, ohne dass die Signatur es anzeigt. |

**Bewusst nicht gefixt.** Der Beleg dieses Slices ist, dass **genau diese Datei** am 2026-11-02 20:35 UTC real
gelaufen ist und das kanonische Cert erzeugt hat. Würde ich sie vor dem Commit anfassen, wäre das versionierte
Artefakt nicht mehr das verifizierte. Alle sechs Punkte gehören in einen eigenen Folge-Slice —
**inhaltlich** sind es 2, 3 und 5 (ein Lauf kann hängen, eine falsche Identität erzeugen oder am SNI
scheitern), **Kosmetik bzw. Härtung** 1, 4 und 6.

## (c) Modus

`chmod 0644 packages/daemon/scripts/pop-canonicalize.ts`. **Korrektur zur Auftragsbegründung:** die
Nachbarskripte sind nicht `0644`, sondern `0664` (`canonicalize-pairings.ts`, `discovery-poc.ts`,
`migrate-pairings.mjs`, `produce-genesis-blob.mjs` — alle `-rw-rw-r--`). Für Git ist das gleichwertig
(`100644`, kein Exec-Bit); gegenüber `0600` ist beides die Korrektur. Gewählt wurde das konservativere `0644`.

## (d) Live-Befund: der Crashloop ist beendet — aber anders als in B2 geplant

Alles hier gegen das laufende System geprüft, read-only (`systemctl --user show`, `journalctl`, `openssl x509`,
`ls`/`stat`, ein `GET /api/status` über mTLS):

| Fakt | Beleg |
|---|---|
| Crashloop beendet | `NRestarts=0`, `ExecMainStatus=0`, `ActiveState=active`, `ActiveEnterTimestamp=2026-11-02 21:35:45 CET` (= 20:35:45 UTC), ~8,5 h durchgehend |
| Zählerstand davor | `journalctl`: `restart counter is at 94246` um 21:00:04 CET, danach `status=1/FAILURE` im ~11-s-Takt |
| Altes Leaf = Ursache | `node.crt.legacy.pem`: `notAfter=Sep 2 18:38:56 2026 GMT`, Issuer `Mesh CA 69bc0bc908229c9f` — exakt die in B2 genannte Leaf-Expiry |
| Neue CA | `ca.crt.pem`: `CN=thinklocal Mesh CA cf00a5bab06832c1`, `notBefore=Nov 2 20:22:17 2026`, `notAfter=Nov 2 20:22:17 2027`; `ca.key.pem` **lokal vorhanden**, `0600` |
| Zwischenstand 20:22 | `pre-pop-…/node.crt.pem`: `CN=ThinkHub` (**nicht** kanonisch), Issuer `cf00a5bab06832c1` — der Bootstrap-Leaf aus dem CA-Reissue |
| Kanonisches Cert 20:35 | `node.crt.pem`: SAN `URI:spiffe://thinklocal/node/12D3KooWKZ4zvnnd9mJimkncKatN9F6fQWRHc5ZNY9SMFNBb5Ynb`, `notAfter=Jan 31 20:35:41 2027` |
| Mesh trägt | `/api/status`: `agent_id` = kanonische URI, `peers_online=4`, `peers_known=7`, `peers_offline=3`, `registry_sync` **`converged: true`** (670–683 Runden, `consecutive_timeouts: 0`) |

**Die Reparatur lief nicht über den in B2 geplanten Pfad.** B2 verlangte „Re-Enroll über `ws3-rejoin.mjs` /
`requestNodeCert()` **plus** der `.94`-Admin-Token". Tatsächlich geschah:

1. **20:22:09 UTC** — die alte CA (`69bc0bc908229c9f`) wurde manuell nach `tls/pre-newca-20261102/` (`0700`)
   beiseitegelegt. Der Daemon fand beim Start keine CA mehr und ging in den Reissue-Pfad
   (`tls.ts:549-565`): **neue lokale Mesh-CA `cf00a5bab06832c1` mit lokalem `ca.key.pem`**, dazu zwangsweise
   ein neues Node-Cert — das alte wurde nach `node.crt.legacy.pem` gesichert und durch einen
   **nicht-kanonischen** `CN=ThinkHub`-Leaf ersetzt. Das ist exakt der dokumentierte Cert-Clobber bei
   CA-Reissue (ADR-024-Retention hängt an `!needsCaReissue`).
2. **20:35:41 UTC** — `pop-canonicalize.ts` holte über diesen Bootstrap-Leaf das **kanonische**
   `node/<PeerID>`-Cert von der PoP-API des eigenen Nodes. Damit war die Identität wiederhergestellt und der
   MCP-Ingress (`extractCanonicalSender` → fail-closed bei Legacy) wieder passierbar.

**Folge für B2(b) — ehrlich formuliert:** der `.94`-Admin-Token wurde **nicht** verwendet und ist für diesen
Pfad **nicht nötig** — die PoP-Routen autorisieren rein über mTLS (`cert-issuance-api.ts:43-45`,
`59-61`: `socket.authorized === true`), kein Bearer. TH01 besitzt jetzt **seinen eigenen CA-Key**, ist also
seine eigene ausstellende CA und kann sich künftig selbst reissuen. B2(b) ist damit **gegenstandslos
geworden, nicht erfüllt**: ein Re-Enroll in die Mesh-CA `69bc0bc908229c9f` hat nicht stattgefunden.

**Was dadurch neu offen ist** (als Folgepunkt notiert, nicht als erledigt verbucht): TH01s Trust-Anchor ist
von `69bc0bc908229c9f` auf `cf00a5bab06832c1` gewechselt. Die 4 online-Peers validieren offenkundig weiter
(`registry_sync.converged=true`), für die **3 offline-Peers** ist der Zusammenhang **nicht belegt** — er wird
hier ausdrücklich als *zu prüfen* geführt und nicht behauptet. Ebenso bleibt **T2.1** (Cert-Rotation im
Betrieb) offen: das neue Leaf läuft am **2027-01-31** ab, dieselbe 90-Tage-Falle wie beim 2026-09-02.

## (e) TODO.md — B2 auf den Ist-Stand

B2 von „⛔ OFFENER BLOCKER (Christian-Gate)" auf **erledigt** umgeschrieben, mit den Live-Werten aus (d),
getrennt nach (a) Leaf-Expiry = **erledigt** und (b) `.94`-Admin-Token/CA-Key = **gegenstandslos** (nicht:
erfüllt), plus den zwei Folgepunkten (Trust-Anchor-Wechsel, T2.1/Leaf-Ende 2027-01-31).

**Gefundener Widerspruch, bewusst NICHT angefasst:** **B1** („PR #356 kann nicht gemergt werden:
Self-Approval") ist ebenfalls überholt — #356 ist seit 2026-10-26 10:09:05 UTC gemergt (`8e7f683e`, APPROVED
durch `peppiseppiullmann-ci`). Das liegt ausserhalb dieser Freigabe (die nennt B2) ⇒ **eigener Slice**, hier
nur gemeldet. Auch die Blocker-Überschrift („Stand 2026-10-21") bleibt deshalb unverändert.

## Was bewusst NICHT angefasst wurde

- **Kein** Fix der 4 Befunde aus (b) — eigener Slice, Begründung dort.
- **Kein** Unit-Test für das Skript (laut Freigabe eigener Slice); **kein** `npm run`-Alias in
  `packages/daemon/package.json`, **keine** Aufnahme von `scripts/` in `tsconfig`/`lint` — beides wäre ein
  Eingriff ins Build-/Gate-Setup.
- **Kein** Eingriff in `~/.thinklocal/` (kein Cert, kein Key, kein Token, kein State), **kein** Deploy, **kein**
  `systemctl restart/stop`. Alle Live-Fakten read-only erhoben; kein Secret ausgegeben (vom `ca.key.pem` nur
  Existenz + Mode geprüft).
- **Nicht berührt:** B1 und die Blocker-Überschrift, B3/TL-14 (**bleibt C1-gated**), T2.1, TL-08/09/10,
  ADR-046 §9, `README.md`/`CONTRIBUTING.md`/`CLAUDE.md`, `COMPLIANCE-TABLE.md`-Footer-Historie,
  `discovery-poc.ts`, der `.55`-c/k-Widerspruch, `#350`. Keine `HISTORY.md` (existiert bewusst nicht,
  `CONTRIBUTING.md:34-36`).

## (f) Code-Review (CR) — Review-of-Record

`pal:codereview` bleibt am PATH-Problem nicht aufrufbar ⇒ **`agy`** über den absoluten Pfad `~/.local/bin/agy`,
`--sandbox`, mit dem vollständigen gestageden Diff im Prompt (nie MiniMax, nie `pal:chat`).
**Ergebnis: APPROVE — 0 HIGH / 0 MEDIUM / 0 LOW, 2 NIT.** Gegen den Code bestätigt wurden alle vier eigenen
Befunde aus (b) einzeln, die Ehrlichkeit der B2-Trennung (a)/(b) — ausdrücklich gegen `tls.ts:545-565` und
`cert-issuance-api.ts:34-37,42-45,58-61` — sowie Widerspruchsfreiheit aller Zeitstempel, Zähler, CA-IDs und
Zeilenreferenzen über die vier Dateien, dazu ein cleaner Secret-Scan. Die **2 NIT sind echte Zusatzbefunde am
Skript** und stehen deshalb jetzt als Fund **5** und **6** in (b) — ebenfalls nur dokumentiert, aus demselben
Grund wie 1–4.

**Dass der Review-Agent nichts verändert hat, wurde geprüft, nicht angenommen:** `HEAD`, der Hash des
`--cached`-Diffs, `git status --porcelain` und die SHA-256-Summen aller fünf Dateien wurden vor dem Lauf
festgehalten und danach verglichen — alle identisch.

## Tests

| Prüfung | Ergebnis |
|---|---|
| `npx vitest run` (`packages/daemon`) | ✅ **150 Dateien / 2101 Tests grün**, 18,57 s — unverändert zum Vorstand |
| Eigener Unit-Test für `pop-canonicalize.ts` | ⚠️ **keiner** — Operator-Runner mit Netz-/Dateisystem-I/O; laut Freigabe eigener Slice |
| **Manuelle Verifikation statt Test** | ✅ Das Skript ist am **2026-11-02 20:35:41 UTC real gelaufen** und hat das kanonische Cert erzeugt — Beleg: SAN `node/12D3KooWKZ4…5Ynb` in `node.crt.pem` mit `notBefore=Nov 2 20:35:41 2026`, Backup-Ordner `tls/pre-pop-2026-11-02T20-35-41-184Z/` mit dem Namensmuster aus `:139-140`, danach Daemon-Start 20:35:45 UTC mit `NRestarts=0` |
| Standalone-Typecheck (informativ, nicht CI) | ⚠️ 4× `TS6133` (unbenutzte Imports, Fund 1) — CI deckt `scripts/` nicht ab |

## Precommit (manuell)

`pal:precommit` bleibt am PATH-Problem nicht aufrufbar ⇒ manuell: Diff vollständig gelesen; Secret-Scan clean
(das Skript enthält **kein** Secret, loggt keins und gibt keinen Key aus — die einzige eingebettete Konstante
ist die Default-Admin-URL `https://10.10.10.80:9440`, eine LAN-Adresse, die schon in `docs/` steht);
kein Eingriff in Build, CI, Deploy oder State; Dateien ausschliesslich
`packages/daemon/scripts/pop-canonicalize.ts`, `changes/`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`.
