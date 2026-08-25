# TL-14a — G1-Entscheidungs-Brief für Christian (Owner-Sign-off)

**Typ:** Owner-Decision-Brief, doc-only, non-gated. **Trifft KEINE Entscheidung.** **Datum:** 2026-07-29 (KW31).
**Zweck:** die **eine** offene Owner-Entscheidung, die ADR-045 auf `Proposed` hält (Gate **G1**), an einem Ort
entscheidungsreif zusammenziehen — inkl. der bereits konsens-getragenen Punkte, die dein Sign-off mit-bestätigt.
Grounding (alles repo-lokal, nichts hier neu erfunden): `ADR-045-ca-two-stage-hierarchy.md` §D3/§130,
`TL-14a-consensus-result-D1-D6.md`, `TL-14a-decision-checklist.md`, `TL-14a-gate-status.md`.

> **Ehrlichkeit zuerst — das ist kein Fortschritt.** Dieser Brief entriegelt nichts. TL-14 bleibt **vollständig
> gated**, bis du unten unterschreibst. Und selbst **nach** deinem Sign-off bleibt die *Code*-Lane gated an **G2**
> (Revocation-Klassifikation, CO/Owner) und **G4** (TL-14b-Durchführung, ⛔ Termin). Der Brief packt die
> Entscheidung nur so, dass sie in fünf Minuten fällbar ist — er nimmt sie nicht vorweg.

---

## 1. Die Entscheidung (G1): D3 — Intermediate-CA-Laufzeit

**Frage:** Wie lange gilt ein Intermediate-CA-Zertifikat (der operative Aussteller auf TH01), bevor es über die
**Offline-Root-Zeremonie** (Air-Gap) erneuert werden muss?

**Der Korridor ist bereits eingegrenzt** — beide konsultierten Modelle **verwerfen ≥ 5 Jahre**; die Landing-Zone
ist **1–3 Jahre** (`TL-14a-consensus-result-D1-D6.md` §D3). Offen ist nur die **exakte Zahl** darin. Es ist eine
**reine Owner-Abwägung**, keine technische Frage:

| Option | Für | Gegen | Quelle |
|--------|-----|-------|--------|
| **~12 Monate** (opus) | kürzeres Kompromittierungs-Fenster bei online liegendem Intermediate-Key | häufigere Air-Gap-Zeremonie ⇒ höheres **Rushed-Ceremony-Risiko im Solo-Betrieb** (PR-#83-Lehre) | opus 8/10 |
| **~24 Monate** | Mittelweg | — | opus-Range-Oberkante |
| **3 Jahre** (sonnet) | seltene, dadurch sorgfältigere Zeremonie; Rushed-Ceremony-Risiko minimiert | längeres unentdecktes Fenster **solange keine Revocation existiert** (s. §3) | sonnet 7/10 |

**Root-CA-Laufzeit** (nicht die offene Frage, nur zur Vollständigkeit): einig **10–15 Jahre**.

**Zwei Achsen, gegeneinander:** Zeremonie-Frequenz/-Sorgfalt (spricht für **länger**) vs.
Kompromittierungs-Fenster (spricht für **kürzer**). Die zweite Achse ist **härter, solange G2/Revocation offen
ist** — ohne Denylist/CRL ist der Doppel-Pin-Cutover die *einzige* Reaktion auf einen Intermediate-Kompromiss.

> **⚠️ Nachtrag 2026-08-25 (KW35) — die Begründung oben ist korrigiert, der Korridor nicht.**
> Der G2-Consensus-Lauf (`TL-14a-consensus-result-C.md`) hat die Achsen-Abwägung geprüft und **eine der beiden
> Achsen entwertet**: eine kürzere Laufzeit ist **kein Revocation-Ersatz** (beide Modelle ausdrücklich). Sie
> deckelt nur das Worst-Case-Fenster bei **planmäßiger Rotation** und tut nichts gegen „Kompromittierung an
> Tag 2" — 12 vs. 36 Monate ist relativ zur Reaktionszeit eines Angreifers **kein qualitativer Unterschied**.
> Was die kürzere Laufzeit *tatsächlich* kauft, ist eine **erzwungene Wiederholung der Offline-Zeremonie** —
> was die D6-Auflage („mind. einmal trocken proben") faktisch von selbst erfüllt und Prozedur-Verrottung im
> Solo-Betrieb verhindert.
> **⇒ Empfehlung: 24 Monate**, begründet als **Zeremonie-Frequenz/Probe-Erzwingung**, nicht als
> Kompromittierungs-Fenster-Kompensation. Der Korridor **1–3 J bleibt unverändert**; die Zahl bleibt **deine**
> Entscheidung. Der Lauf **entscheidet nichts** und ist selbst noch **nicht owner-ratifiziert**.

> **➡️ Zu setzen:** **eine Zahl im Korridor 1–3 Jahre.** Alles andere an G1 ist Bestätigung (§2).

**Vorbedingung für eine sichere Wahl ist erfüllt:** B (Intermediate-Expiry-Monitoring) ist code-seitig
**komplett + regressionsfest** (`cert-monitor-wiring.ts`, #297/#344) — ein langes Intermediate läuft **nicht mehr
lautlos** ab. Damit ist die 3-Jahres-Option technisch abgesichert; sonnet hatte B genau dafür zur Vorbedingung
gemacht.

## 2. Mit-zu-bestätigen (kein Streit — Konsens einstimmig 5/6, tragen aber Owner-Gate-Charakter)

Diese sind **nicht offen**, aber dein Sign-off ratifiziert sie formal (ADR-045 §130 „D1/D4/D5/D6-Gates bestätigen"):

- **D1 — Trust-Domain ENTKOPPELN:** CA-Umzug bleibt auf `spiffe://thinklocal/`; der Domain-Flip auf
  `axxsys-software.de` (Decision-7) ist ein **separater, späterer** Schnitt. **Auflage:** als eigene terminierte
  Folge-CO führen.
- **D4 — Doppel-Pin-Cutover** (kein Cross-Sign): Alt+Neu-Fingerprint gepinnt; **Alt-Pin erst nach Node-N-Proof**
  entfernen, **Rollback-Kriterium vorab** definieren.
- **D5 — Token-Re-Onboard je Node** (kein `ca.crt.pem`-Chain-Swap): der verifizierte Pfad; **das ist der
  eigentliche TL-14b-Kern**, je Node ein Fenster, mit Zwei-Peer-Proof gekoppelt.
- **D6 — TH02 KALT** (versiegelte Reserve, identische Kette): **Auflage:** Reserve-Aktivierung **mind. einmal
  trocken proben**.
- **D2 — `pathLen 0`** (CO/technisch, keine Owner-Frage): Root signiert nur Intermediates ohne weitere Sub-CAs.
  Wirksam **nur** über die App-Ebene (`verifyPeerCertChain`) — Vorbedingung A ist dafür bereits komplett
  (`tls-transport-pathlen.conformance.test.ts` belegt: Node-TLS erzwingt `pathLen` **nicht**, der Trust muss
  App-seitig sitzen).

## 3. Bekannter Nachbar-Punkt, der NICHT Teil von G1 ist: Revocation (Gate G2)

Der Consensus stufte **A–C alle drei blockierend** ein; ADR-045 führt aber nur **A/B** als Vorbedingung und
behandelt **C (Revocation)** in §100 als out-of-scope/Fast-Follow — eine **bewusste, aber noch nicht
owner-ratifizierte** Abweichung. Ist-Zustand: `crl.ts` existiert als Fingerprint-Denylist, hat aber **0
Nicht-Test-Aufrufer** (Dead-Code; der Datei-Header behauptet fälschlich eine Verdrahtung). Das ist **Gate G2**
(CO/Owner: Blocker vs. Fast-Follow + Form + Distribution) und **bewusst kein Teil dieses Briefs** — es beeinflusst
G1 nur als *Argument* (längere D3-Laufzeit ⇒ größeres Risiko ohne Revocation), nicht als Blocker der Zahl selbst.

**Stand 2026-08-25 (KW35): der CO-Anteil von G2 ist gelaufen** — `TL-14a-consensus-result-C.md`. Ergebnis in
einem Satz: **C wird gesplittet.** **C1** (lokales `isRevoked`-Enforcement an `agent-card.ts:311` + `:353`,
App-Ebene, bestehende `crl.ts` verdrahten) = **blockierend vor TL-14b, aber klein**; **C2** (Mesh-Verteilung der
Denylist) = **Fast-Follow, bewusst nichts bauen**. Form: **Denylist, kein CRL/OCSP**. Der stärkste Einzelgrund:
ohne Sperrfähigkeit ist die **kalte TH02-Reserve (D6) nur halb aktivierbar** — sie stellt Verfügbarkeit wieder
her, nicht Integrität, weil das kompromittierte Intermediate gültig bleibt. **Die Owner-Hälfte von G2 steht
weiterhin aus** (Ratifizierungs-Tabelle am Ende jenes Dokuments); an G1 ändert das nur die *Begründung* der
D3-Zahl (siehe Nachtrag in §1), nicht den Korridor.

## 4. Was dein Sign-off entriegelt (und was NICHT)

- **Entriegelt:** ADR-045 `Proposed → Accepted` ⇒ **Runbook-Volltext + Zeremonie-Skripte** dürfen geschrieben
  werden (sie brauchen die konkrete D3-Zahl in der Cert-Erzeugung; **vor** G1 wären sie genau dort unvollständig).
- **Bleibt gated:** **G2** (Revocation-Klassifikation → `crl.ts`-Verdrahtung), **G3** (Cross-Vendor-Consensus-Pass
  — `codex`/`agy` nicht im PATH, optionale Zusatz-Sicht, 5/6 stehen bereits), **G4** (TL-14b-Durchführung: Token-
  Re-Onboard je Node + Zwei-Peer-Proof, ⛔ Termin + Christian).

## 5. Sign-off (auszufüllen beim Beschluss)

| Punkt | Beschluss | Datum | Entscheider |
|-------|-----------|-------|-------------|
| **D3 Intermediate-Laufzeit** (Zahl im Korridor 1–3 J) | | | Christian |
| Root-Laufzeit (10–15 J) | | | Christian |
| D1 entkoppeln — bestätigt? | | | Christian |
| D4 Doppel-Pin — bestätigt? | | | Christian |
| D5 Token-Re-Onboard — bestätigt? | | | Christian |
| D6 TH02 kalt — bestätigt? | | | Christian |
| → ADR-045 auf `Accepted` setzen | | | Christian |

Nach dem Ausfüllen: ADR-045 §Status auf `Accepted` ändern + die Zahl in §D3 eintragen; dieser Brief bleibt als
Entscheidungs-Beleg stehen.

## 6. Korrektur-Hinweis (Ehrlichkeit)

Die ältere `TL-14a-decision-checklist.md` (2026-07-19, **vor** dem Consensus) empfiehlt in §D3 noch **„≥ 5
Jahre"** — das ist durch den späteren Consensus (beide Modelle verwerfen ≥5 J, Korridor 1–3 J) **überholt**. Die
maßgebliche Fassung ist ADR-045 §D3 + dieser Brief. (Ein Supersession-Zeiger wurde in der Checkliste ergänzt.)

## Abgrenzung
Doc-only. Kein Code/Config/Skript, kein Deploy/Secret/Cross-Host, **keine Entscheidung**, kein Gate vorweggenommen.
Konsolidiert ausschließlich bereits repo-gegroundetes Material zu einem entscheidungsreifen Owner-Brief für G1.
