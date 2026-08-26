# changes/2026-08-26 — docs+test(tl14): BLOCKER — ADR-045 D2 (`Root pathLen 0`) unvereinbar mit der Zweistufen-Hierarchie

**Typ:** Blocker-Befund + Regressionsschutz. **Entscheidet nichts, ändert keinen Beschluss.** Kein
`packages/`-Diff, kein Deploy/Secret/Cross-Host. Risiko-Delta **null**.

## Auftrag und was daraus wurde
Auftrag war der durch den G1/G2-Sign-off entriegelte Slice **„Runbook-Volltext + Zeremonie-Skripte"**. Beim
Schreiben von **Schritt 2 von 7** (Offline-Wurzel-Zeremonie) — konkret der Zeile
`basicConstraints = critical, CA:TRUE, pathlen:<N>` — stellte sich heraus, dass der von ADR-045 **D2**
vorgeschriebene Wert die Zielhierarchie **unbrauchbar** macht. Der Slice ist deshalb **gestoppt und gemeldet**
statt fortgeschrieben.

## Der Befund
ADR-045 §D2: Root `pathLen 0`. RFC 5280 §4.2.1.9: `pathLenConstraint` = maximale Anzahl
nicht-selbst-ausgestellter Zwischen-CAs, die dem Zertifikat im Pfad **folgen** dürfen. ⇒ `Root pathlen:0`
erlaubt **kein einziges Intermediate**. Die Zielhierarchie ist aber Root → Intermediate (TH01/TH02) → Leafs.
**Mit D2-wie-geschrieben wäre jedes Node-Cert der neuen Hierarchie mesh-weit ungültig.**

**Das Schutzziel der ADR ist richtig, nur an der falschen Stufe kodiert.** Dass TH01/TH02 keine Sub-CAs
ausstellen dürfen, erzwingt der `pathLen 0` **am Intermediate**. Die Verwerfung von „`pathLen 1`" in
§Verworfene Alternativen („unnötige Vollmacht — TH02 könnte Sub-CAs") ist eine **Fehllesung**: der `pathLen`
der Root sagt nichts über die Vollmacht des Intermediates. **Korrekt: Root `pathLen 1` + Intermediate
`pathLen 0`.**

## Beleg — dreifach, unabhängig
1. **Der eigene grüne Testbestand widerspricht D2 bereits.** `chain-verify.test.ts:55` baut die
   **funktionierende** Kette mit **Root `pathLen 1`**; `:61-67` nagelt `Root pathLen 0` explizit als
   **Ablehnung** fest. Seit Vorbedingung A (#298/#311) im Repo — nur nie gegen D2 gehalten.
2. **OpenSSL, vendor-neutral** (kein node-forge-Artefakt): `Root pathlen:0 → Intermediate → Leaf` ⇒
   *„error 25 … path length constraint exceeded"*; `pathlen:1` ⇒ `OK`. Einziger Unterschied ist der Root-
   `pathLen` (dasselbe Intermediate-Keypair/dieselbe CSR von beiden Roots signiert).
3. **Neuer End-to-End-Profiltest.** Siehe unten.

## Was neu ist
- **`docs/architecture/TL-14a-D2-pathlen-blocker.md`** — der Befund mit Norm-Zitat, der Herleitung des
  Denkfehlers, dem dreifachen Beleg, **drei Entscheidungs-Optionen** (A korrigieren / B beibehalten /
  C weglassen) und einer klaren Empfehlung (**A**). Plus §6 „Was der Befund NICHT ändert".
- **`scripts/tl14-ca/tl14-pathlen-proof.sh`** — re-runnable OpenSSL-Beleg. Arbeitet ausschliesslich in
  `mktemp -d`, fasst **keinen** Daemon-State und **keine** echten CA-Dateien an; Exit 0 = Befund
  reproduziert, Exit 1 = Note überholt.
- **`tests/integration/tl14-ceremony-cert-profile.test.ts`** — **+4 Tests, grün.** Schliesst eine reale
  Lücke: **alle** bisherigen Ketten-Tests minten ihre Certs mit **node-forge**, also mit demselben Werkzeug,
  das sie prüfen — die Zeremonie läuft aber auf dem Air-Gap-Rechner mit **OpenSSL**. Ob ein
  OpenSSL-erzeugtes Profil vom Daemon akzeptiert wird, war **ungetestet** und wäre erst im TL-14b-Fenster
  aufgefallen. Der Test baut die Kette wie das Zeremonie-Skript (echte CSR-/Signatur-Schritte, SPIFFE-SAN,
  730 Tage = D3-Beschluss) und prüft sie mit der **echten** `verifyPeerCertChain`:
  1. Root `pathLen 1` + Intermediate `pathLen 0` ⇒ **akzeptiert**
  2. Root `pathLen 0` (D2-wie-geschrieben) ⇒ **abgelehnt**
  3. Sub-CA unter dem Intermediate ⇒ **abgelehnt** ⇒ **die Korrektur schwächt D2 nicht**
  4. `certFingerprint()` == OpenSSL-DER-SHA256 (lowercase hex) ⇒ **Pin-Kompatibilität für D4 belegt**
     (zweites ungetestetes Risiko: bei abweichenden Formaten hätte der Doppel-Pin-Cutover ins Leere gepinnt)
- **`ADR-045` §D2** — ⛔-Korrekturhinweis eingefügt, der die Abweichung **sichtbar statt still** macht.
  **Die Entscheidung selbst ist NICHT geändert** (Owner-/CO-Akt).
- **DO:** `CHANGES.md`, `COMPLIANCE-TABLE.md`, `TODO.md`, dieser `changes/`-Eintrag.

## Warum gestoppt statt weitergeschrieben
Ein Runbook, dessen Zeremonie-Schritt nicht ausführbar ist, ist genau die „Nebelmaschine", vor der
`TL-14a-gate-status.md` §3 warnt — und ADR-045 verlangt selbst, dass Skripte **nicht** „an genau der offenen
Stelle unvollständig" entstehen (dieselbe Begründung, die den Slice vor G1 gesperrt hatte). Schritte 1/5/7
(Vorbedingungen/Inventar, Chain-Verifikation, Rollback) hängen nicht am `pathLen`; **2/3/4 vollständig**.

## Compliance
- **CO:** entfällt — **kein** Design-Vorschlag, ein **Faktenbefund**. Die Korrektur-Entscheidung ist
  ausdrücklich offen gelassen.
- **CG:** entfällt — kein generierter Code/Typ.
- **TS:** ✅ **+4 Integrationstests, grün.** Daemon-Suite unverändert **2101 grün**; Gesamt-Suite
  **2226 grün** (2222 + 4). Der Proof-Skript-Lauf ist zusätzlich manuell verifiziert (Exit 0).
- **CR:** ✅ echtes Fremd-Vendor-Review über **`agy` (Gemini)** — siehe PR-Body/Kommentar.
- **PC:** Secret-Scan clean; kein `packages/`-Diff verifiziert.

## Nicht berührt
`packages/daemon/**` (insbesondere `verifyPeerCertChain` — es verhält sich **korrekt** und lehnt zu Recht
ab), D1/D3/D4/D5/D6, C1/C2, der G1-Sign-off, ADR-045-Status (`Accepted` bleibt). **C1-Slice weiterhin nicht
freigegeben.** TL-14b bleibt ⛔ gated.
