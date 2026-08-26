# TL-14a — Auflage C (Revocation): Consensus-Ergebnis (Gate G2, CO-Anteil)

**KW35 · Ergebnis-Protokoll von `pal:consensus` über die C-Klassifikationsfrage · 2026-08-25 · repo-lokal,
doc-only.**
Dieses Dokument protokolliert den **tatsächlichen** `pal:consensus`-Lauf über den in
`TL-14a-blocker-C-grounding.md` §2 aufgedeckten Widerspruch (Consensus stuft A–C blockierend, ADR-045 §74 führt
nur A/B). Es liefert den **CO-Anteil von Gate G2** und **trifft keine verbindliche Entscheidung** — die
**Owner-Ratifizierung steht aus** (G2 ist laut `TL-14a-gate-status.md` §2 ein **CO/Owner**-Gate).

> **Ehrlichkeit zuerst.** Dieses Protokoll **entriegelt nichts**. Es verdrahtet kein Byte, ändert ADR-045 nicht im
> Status und nimmt weder G1 noch G4 vorweg. Es ersetzt lediglich den bisher **offenen** C-Punkt durch eine
> begründete, angreifbar gemachte Empfehlung, über die Christian entscheiden kann.

## Lauf-Metadaten

- **Roster geplant (Runde 1):** `cli-codex-gpt` (Stance *for* = C blockierend), `cli-agy-gemini-pro` (Stance
  *against* = C Fast-Follow), `cli-claude-opus` (neutral).
- **Tatsächlich konsultierbar:** **nur `cli-claude-opus`.** `cli-codex-gpt` → Provider-Fehler *"executable
  'codex' not found in PATH"*; `cli-agy-gemini-pro` → *"executable 'agy' not found in PATH"*. **Gate G3 damit am
  2026-08-25 erneut laufzeit-verifiziert offen** — PAL *listet* beide Backends als konfiguriert, sie schlagen aber
  beim Aufruf fehl (deckt sich mit `TL-14a-consensus-crossvendor-followup-2026-07-21.md`).
- **Runde 2 (adversarial, nachgezogen):** weil Runde 1 nur **eine** Stimme lieferte — was kein Konsens ist,
  sondern eine Einzelmeinung — wurde die Kernthese in einer zweiten Runde gezielt **angegriffen**:
  `cli-claude-sonnet` mit Stance *for* (C ist harter Blocker) gegen `cli-claude-opus` mit Stance *against*
  (C ist Fast-Follow). Vorlage war die aus Runde 1 destillierte Fast-Follow-These im Volltext.
- **Ergebnis-Charakter:** **Same-Vendor-2-Modell-Panel** (claude-opus 8/10, claude-sonnet 7/10) mit
  **echter Gegenpositions-Besetzung**. **Kein Cross-Vendor-Pass.** Für ein Cross-Vendor-Panel muss der Lauf
  wiederholt werden, sobald `codex`/`agy` im PATH sind (G3).
- **Grounding im Prompt:** `crl.ts` (Volltext), `ADR-045-ca-two-stage-hierarchy.md`,
  `TL-14a-blocker-C-grounding.md` — inkl. der code-verifizierten Anker `agent-card.ts:311` (Issuer-Fingerprint)
  und `:353` (Leaf-Fingerprint) sowie des A-Vorbefunds (Node-TLS erzwingt `pathLen` **nicht**).

## Das Ergebnis: ein dritter Weg — **C wird gesplittet**

Beide Modelle landen — **von entgegengesetzten Stances aus** — auf derselben operativen Antwort. Der
Blocker-vs-Fast-Follow-Streit ist eine **Taxonomie-Frage über ein falsch geschnittenes Objekt**: „C" bündelt
zwei Dinge mit völlig unterschiedlichem Kosten-/Nutzen-Profil.

| Anteil von C | Klassifikation | Umfang |
|---|---|---|
| **C1 — lokales Enforcement** (`isRevoked` am Verify-Punkt) | **blockierend vor TL-14b** | klein: 2 Call-Sites + App-Verify, Code existiert bereits |
| **C2 — Mesh-Verteilung der Denylist** | **Fast-Follow — bewusst NICHTS bauen** | null: bleibt lokale, owner-gepflegte Datei |

Damit versöhnen sich Consensus-Wortlaut und ADR-Herabstufung: **der ursprüngliche Consensus meinte die
Enforcement-Lücke (C1), die ADR meinte die Infrastruktur (C2).** Beide hatten für ihren jeweiligen Anteil recht.

## Ergebnis je Teilfrage

| # | Frage | claude-opus (8/10) | claude-sonnet (7/10) | Konsolidierte Lage (nicht bindend) |
|---|---|---|---|---|
| **1** | Blocking-Status | Fast-Follow — **aber** C1 blockierend | **Blocker**, „aber ein kleiner" (Umfang = genau C1) | **Konvergenz auf C1 blockierend / C2 nicht.** Der Label-Streit löst sich im Split auf. |
| **2** | Form: Denylist vs CRL/OCSP | **Denylist** | **Denylist** | **Einig.** Kein CRL/OCSP. |
| **3** | Umsetzungsweg | bestehende `crl.ts` verdrahten, **App-Ebene**, Leaf **und** Issuer | bestehende `crl.ts` verdrahten, **App-Ebene**, `:311` + `:353` | **Einig, wortgleich.** Kein Neubau. |
| **4** | Distribution | lokal, owner-gepflegt, **nichts bauen** | manuell/im selben Re-Onboard-Sweep | **Einig.** Keine Mesh-Propagierung in v1. |
| **5** | D3-Laufzeit als Kompensation | „schwach, fast Augenwischerei" | „als Ersatz Augenwischerei" | **Einig: taugt NICHT als Revocation-Ersatz.** Siehe §Rückwirkung auf G1. |

### Zu 1 — warum der Split und nicht „Blocker" oder „Fast-Follow"

**Das Fast-Follow-Argument (opus):** Das Risiko-Delta zeigt in die richtige Richtung. Heute ist der Root-Key
**online und ko-lokalisiert** mit dem Aussteller (`tls.ts:403-404`), ohne Revocation, faktisch unbegrenzt; ein
Root-Kompromiss ist heute **nur** durch komplettes Re-Onboarding aller ~10 Nodes heilbar. Nach der Migration ist
die Wurzel air-gapped. Ein Blocker müsste die Lage **verschlechtern** — das tut C nicht.

**Der Gegenangriff (sonnet), der traf:** Der Vergleich ist am falschen Objekt gezogen. Nicht „Root vorher vs. Root
nachher", sondern **„heißer Signierschlüssel vorher vs. heißer Signierschlüssel nachher"** — und dort ist der
**Blast Radius unverändert**: beliebige `node/<PeerID>`-Leafs mintbar, mesh-weit vertraut, weil
`verifyPeerCertChain` nur die Ketten-Struktur prüft, nicht Revocation. Zweiter Treffer, code-gegroundet:
**D5 lehnt den `ca.crt.pem`-Chain-Swap explizit ab** (ungelöste Fallen: `cert-clobber-on-ca-reissue`,
Phase-3-Flip-Deadlock) ⇒ die **einzige** Recovery bei Intermediate-Kompromittierung ist derselbe mehrtägige,
Christian-gated Token-Re-Onboard-Sweep wie die Migration selbst — und **während** dieses Sweeps bleibt der
kompromittierte Fingerprint auf allen noch nicht nachgezogenen Nodes voll vertraut.

**Was die Fast-Follow-Seite daraufhin einräumte (der entscheidende Punkt):** Ja, das Intermediate **ist** ein neues
revozierbedürftiges Artefakt. Vorher gab es genau ein CA-Objekt (Root — per Definition *nicht* per Denylist
sperrbar, weil Trust-Anker; eine unter diesem Anker verteilte Liste kann ihn nicht sperren). Nachher gibt es ein
zweites, heißes, on-disk auf TH01. Daraus folgt aber **nicht** „Blocker", sondern: **TL-14b macht Revocation
erstmals überhaupt wirksam** — ein Argument *für* zügige Verdrahtung.

### Der stärkste Einzelgrund für C1 (von beiden Seiten getragen)

**Die kalte TH02-Reserve (D6) ist ohne Sperrfähigkeit nur zur Hälfte aktivierbar.** Der Aktivierungsfall der
Reserve ist per Definition „TH01-Intermediate kompromittiert/verloren". Ohne Denylist wird das neue Intermediate
zwar gepinnt, **das alte bleibt aber gültig** bis zu seinem Ablaufdatum — Leafs des kompromittierten
Intermediates werden von `verifyPeerCertChain` weiter akzeptiert. Die Reserve stellt damit **Verfügbarkeit** wieder
her, **nicht Integrität**. Das ist ein realer Defekt der D6-Auflage: aus „ungeprobte Reserve = keine Reserve"
(ADR-045 §68-72) wird hier **„unsperrbare Reserve = halbe Reserve"**.

### Zu 2 — warum Denylist und nicht CRL/OCSP

CRL/OCSP löst Probleme, die hier nicht existieren (Skalierung auf unbekannte Relying Parties, Freshness ohne
Out-of-Band-Kanal, Delegation an Nicht-Owner). Beide Modelle nennen dieselben zwei K.-o.-Gründe:

- **OCSP** führt einen Online-Responder als neue Verfügbarkeits- **und** Angriffsabhängigkeit in den Trust-Pfad
  ein: soft-fail = wirkungslos, hard-fail = mesh-weiter SPOF.
- **Eine echte CRL** bräuchte für **jede** Revocation eine CA-Signatur — also genau den **Offline-Root-Key**, den
  D3 bewusst air-gapped hält. Jede Sperrung würde eine Zeremonie erzwingen.

Das ist der Punkt, an dem die „richtige" PKI-Lösung schlechter ist als die einfache.

### Zu 3 — Enforcement-Punkt: App-Ebene, Leaf **und** Issuer

Der Enforcement-Punkt ist **nicht Präferenz, sondern empirisch erzwungen**: `tls-transport-pathlen.conformance.test.ts`
(#342) belegt, dass Node-TLS in dieser mTLS-Konfiguration `pathLen` **nicht** durchsetzt; Trust-Entscheidungen
liegen deshalb ohnehin App-seitig bei `verifyPeerCertChain` (ADR-045 §90-94). Revocation dort anzusiedeln hält
**einen** Trust-Entscheidungspunkt statt zwei divergierender.

**Beide Fingerprints, nicht nur der Leaf.** Nur `:353` (Leaf) zu prüfen wäre ein halber Fix — der Sinn der
Denylist in einer Zwei-Stufen-Welt ist gerade, ein **kompromittiertes Intermediate** killen zu können (siehe
D6-Punkt oben). Also auch `:311` (Issuer).

**Kein Neubau:** `crl.ts` deckt die Denylist-Semantik vollständig ab (`isRevoked` `crl.ts:51`, Persistenz
`:88-98` atomarer `tmp→rename`, fail-safe `load` `:75-86`) und ist seit #341 charakterisierungs-getestet.

### Zu 4 — Distribution: die richtige Antwort ist, nichts zu bauen

Eine **fernverteilte, unsignierte** Denylist ist ein **DoS-Primitiv**: wer Einträge einschleusen kann, wirft
beliebige Nodes aus dem Mesh. Eine **signierte** bräuchte Owner-Signierschlüssel + Verifikation + Replay-/
Rollback-Schutz (monoton steigende Version, sonst spielt ein Angreifer eine alte Liste zurück) — **mehr neue
Angriffsfläche als das gelöste Problem**, bei ~10 Nodes und einem Owner.

**Empfehlung:** `crl.json` bleibt eine **rein lokale, owner-gepflegte Datei pro Node**, nur über den
Dateisystem-/SSH-Zugang des Owners beschreibbar. Kein Netzwerk-Endpunkt zum Schreiben, kein Gossip. Der
Revocation-Rollout läuft über **denselben Owner-Pfad wie das D5-Token-Re-Onboard** — die Vertrauensbasis ist damit
exakt dieselbe wie für die Cert-Ausstellung selbst. **Null neue Kryptografie.**
**Dokumentierter Trigger für später:** > 25 Nodes **oder** Nicht-Owner-Betreiber ⇒ dann signierte Verteilung neu
bewerten. Jetzt nicht bauen.

## Rückwirkung auf G1 (D3-Laufzeit) — bitte VOR dem Sign-off lesen

Der G1-Brief führt die D3-Abwägung als „Zeremonie-Frequenz vs. Kompromittierungs-Fenster" und nennt das
Kompromittierungs-Fenster die härtere Achse, **solange G2 offen ist**. Dieser Lauf **korrigiert die Begründung**,
nicht den Korridor:

- **Eine kürzere Laufzeit ist KEIN Revocation-Ersatz** (beide Modelle, ausdrücklich). Sie deckelt nur das
  Worst-Case-Fenster bei **planmäßiger Rotation** und tut nichts gegen „Kompromittierung an Tag 2" — der
  Angreifer wartet nicht auf Expiry. 12 vs. 36 Monate ist relativ zur Reaktionszeit eines Angreifers **kein
  qualitativer Unterschied**.
- **Was die kürzere Laufzeit tatsächlich kauft** und was sie wert ist: eine **erzwungene Wiederholung der
  Offline-Zeremonie**. Das erfüllt die D6-Auflage („mind. einmal trocken proben") faktisch von selbst und
  verhindert Prozedur-Verrottung im Solo-Betrieb.
- **Empfehlung an G1: 24 Monate** — begründet als **Zeremonie-Frequenz/Probe-Erzwingung**, nicht als
  Revocation-Kompensation. Der Korridor 1–3 J bleibt unverändert; die **Zahl bleibt Christians Entscheidung**.

## Auflagen, falls C1 umgesetzt wird (Umsetzungs-Slice, noch nicht freigegeben)

1. **Regression-Tests, Pflicht:** (a) revozierter **Leaf** wird abgelehnt; (b) revoziertes **Intermediate** ⇒
   **ganze Kette** abgelehnt.
2. **Kollisions-Test, ausdrücklich benannt:** **„Alt-Pin aktiv (D4-Doppel-Pin) + Alt-Intermediate revoziert"** —
   ohne diesen Test sperrt die Denylist den D4-Cutover **selbst aus**. Interaktion mit
   `resolveAttestingCaFingerprints` prüfen.
3. **Audit-Event:** Der Ablehnungspfad braucht einen **eigenen Event-Typ**. Sonst greift eine Revocation
   operativ unsichtbar — dieselbe Fehlerklasse wie die Phantom-ROT-Befunde (#272/#278).
4. **Header-Wahrheit:** `crl.ts:5-7` behauptet heute eine Prüfung „beim Heartbeat und bei der
   Agent-Card-Verifikation", die nicht existiert. Im selben Slice **wahr machen** (nicht separat abschwächen —
   das wäre Churn, siehe `TL-14a-gate-status.md` §4).
5. **Format-Vorbehalt (nicht verifiziert):** Ob die Fingerprints an `:311`/`:353` im selben Format vorliegen, das
   `crl.ts` erwartet (Doppelpunkt-Trennung, Groß/Klein, `sha256:`-Präfix), ist **offen** — ggf. kommt
   Normalisierung dazu. Die Aufwandsschätzung („~1 Tag") ist **nicht** code-verifiziert.

## Was dieser Lauf NICHT tut

Keine Verdrahtung, kein `.ts`-Diff, keine ADR-045-Statusänderung, **keine Owner-Entscheidung**. G1, G3 und G4
bleiben unberührt. Der C1-Umsetzungs-Slice ist **nicht** freigegeben — er wartet auf die Owner-Ratifizierung
unten.

## ✅ Owner-Ratifizierung (G2, zweite Hälfte) — gezeichnet 2026-08-26

| Punkt | Beschluss | Datum | Entscheider |
|-------|-----------|-------|-------------|
| **C1 (lokales `isRevoked`-Enforcement) = blockierend vor TL-14b?** | **✅ ja — blockierend** | 2026-08-26 | Christian |
| **C2 (Mesh-Verteilung) = Fast-Follow, jetzt nichts bauen?** | **✅ ja — Fast-Follow, nichts bauen** | 2026-08-26 | Christian |
| Form = Fingerprint-Denylist (kein CRL/OCSP)? | **✅ ja — Denylist** | 2026-08-26 | Christian |
| ADR-045 §74 um **C1** ergänzen + §100-Hinweis auflösen? | **✅ ja — nachgezogen** | 2026-08-26 | Christian |
| C1-Umsetzungs-Slice freigeben? | **⛔ NICHT Teil dieses Sign-offs — weiterhin offen** | — | Christian |

**✅ Gate G2 ist damit inhaltlich geschlossen.** ADR-045 führt **C1** jetzt unter „Zwingende Vorbedingungen
(blockierend)" mit Enforcement-Punkt, Pflicht-Tests und Auflagen; **C2** steht in den Konsequenzen als
bewusst nicht gebaut, inkl. Re-Evaluierungs-Trigger (>25 Nodes / Nicht-Owner-Betreiber). Der
Klassifikations-Hinweis vom 2026-07-27 ist **aufgelöst**.

**⛔ Was weiterhin offen ist:** die **Freigabe des C1-Umsetzungs-Slices** (Codier-Start). Die Klassifikation
ist ratifiziert, der Code ist damit **nicht** freigegeben — das bleibt ein eigener Owner-Akt. Bis dahin wird
`crl.ts` **nicht** verdrahtet.

**Rückwirkung auf G1, umgesetzt:** D3 = **24 Monate**, begründet als Zeremonie-Probe-Erzwingung (D6), nicht
als Revocation-Kompensation. ADR-045 ist seit 2026-08-26 `Accepted`.

## Verweise

- `docs/architecture/TL-14a-blocker-C-grounding.md` §2/§3 (der Widerspruch + die vier offenen Punkte, die dieser Lauf beantwortet)
- `docs/architecture/ADR-045-ca-two-stage-hierarchy.md` §74 (nur A/B), §100 (Klassifikations-Hinweis), §68-72 (D6)
- `docs/architecture/TL-14a-consensus-result-D1-D6.md` §C (die „A–C blockierend"-Einstufung)
- `docs/architecture/TL-14a-G1-decision-brief.md` §1/§3 (D3-Abwägung — Begründung durch diesen Lauf korrigiert)
- `docs/architecture/TL-14a-gate-status.md` §2 (Gate-Definitionen G1–G4)
- Code: `packages/daemon/src/crl.ts`, Hook-Kandidaten `agent-card.ts:311` + `:353`, `verifyPeerCertChain`

## Abgrenzung

Doc-only. Kein Code/Config/Skript, kein Deploy/Secret/Cross-Host, **keine Entscheidung**, kein Gate vorweggenommen.
Protokolliert einen tatsächlich gelaufenen `pal:consensus`-Doppellauf als CO-Anteil von G2; die Owner-Hälfte
bleibt offen.
