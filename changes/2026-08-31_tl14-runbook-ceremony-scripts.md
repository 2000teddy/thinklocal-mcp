# changes/2026-08-31 — docs+test(tl14): Runbook-Volltext + Zeremonie-Skripte (der entblockte Slice)

**Typ:** Papier + ausführbare Skripte + Integrationstest. **Kein `packages/`-Diff**, kein Deploy, kein
Secret, kein Cross-Host-Schritt, kein laufender Daemon angefasst. Risiko-Delta **null**.

**Auftrag:** der durch den G1/G2-Owner-Sign-off (#353) und die D2-Korrektur (#354) entblockte Slice
„Runbook-Volltext + Zeremonie-Skripte" — in `TODO.md:544` ausdrücklich als **non-gated** geführt. Dies ist
die Fortsetzung genau des Slices, der am 2026-08-26 bei **Schritt 2 von 7** gestoppt wurde.

---

## Was neu ist

### 1. `docs/runbooks/RUNBOOK-TL-14-ca-ceremony.md` — der Volltext
Alle sieben Schritte ausformuliert, mit exakten Kommandos, Protokoll-Vorlage und Rollback-Kriterium.
Schritte **1–5 und 7 sind gate-frei ausführbar** (sie erzeugen ausschliesslich neues, paralleles Material);
**Schritt 6 ist als ⛔ TL-14b markiert** und enthält nur den Plan, damit er im Fenster nicht neu erfunden
werden muss.

### 2. `scripts/tl14-ca/` — vier neue Skripte (+ gemeinsame Helfer)
| Skript | Schritt | Läuft auf |
|---|---|---|
| `tl14-ceremony-root.sh` | 2 | Air-Gap |
| `tl14-ceremony-intermediate-csr.sh` | 3a/4a | TH01 / TH02 |
| `tl14-ceremony-sign-intermediate.sh` | 3b/4b | Air-Gap |
| `tl14-verify-chain.sh` | 5 | beliebig |

Alle fail-closed: sie überschreiben **niemals** vorhandenes Schlüsselmaterial (ein zweiter Root-Lauf würde
die ganze Hierarchie darunter entwerten) und brechen bei Abweichung vom ADR-045-Profil oder von den
Laufzeit-Korridoren ab (Root 10–15 J, Intermediate 24 Mon. / Korridor 1–3 J) — eine Abweichung ist keine
Tippfehler-Frage, sondern eine Abweichung vom gezeichneten Beschluss.

### 3. `tests/integration/tl14-ceremony-scripts.test.ts` — **+19 Tests**
Ruft die **echten Skripte** auf und prüft das Ergebnis mit der **echten** Daemon-Funktion
`verifyPeerCertChain`. Schliesst die Lücke, die #354 offen liess: dort war bewiesen, dass *ein*
OpenSSL-D2-Profil akzeptiert wird — nicht, dass die **ausgelieferten Skripte** dieses Profil erzeugen.

---

## Die sieben Befunde — der eigentliche Ertrag

Beim Ausformulieren fielen sieben code-verifizierte Fallen auf, die **erst im TL-14b-Fenster** aufgefallen
wären. Sie stehen als §1 im Runbook. Die drei wichtigsten:

**F1 — Eine Chain in `ca.crt.pem` schaltet den Attesting-Pin STILL AB.**
`resolveAttestingCaFingerprints` (`cert-issuer.ts:132-133`) leitet nur ab, wenn `ca.crt.pem` **genau ein**
Zertifikat enthält. Legt man dort die Kette (Root + Intermediate) ab — was intuitiv richtig wirkt —, ist der
Pin leer, `isAttestingIssuer` liefert fail-closed `false`, und **jeder** kanonische Sender bekommt 403
(`agent-card.ts:319-322`). Dieselbe Fehlerklasse wie der TH02-Phase-3-Unknown-sender-Deadlock.
⇒ `TLMCP_PEERID_ATTESTING_CA_FP` **muss vor dem Cutover explizit gesetzt sein**; Auto-Derive ist im
Zweistufen-Betrieb kein tragfähiger Pfad mehr.

**F2/F4 — Gepinnt gehört das INTERMEDIATE, nicht die Root — und das ist die Variante, die OHNE
Codeänderung funktioniert.**
`agent-card.ts:311` liest den **direkten** Aussteller (`issuerCertificate.fingerprint256`); ein reiner
Root-Pin lehnt jeden Node ab. Zugleich übergibt `verifyCanonicalNodeCert` eine **einelementige** Kette
(`tls.ts:392`) — mit dem Intermediate als Anker verifiziert die korrekt, mit der Root als Anker nicht.
**Beide Richtungen sind jetzt als Test festgenagelt** (nicht nur behauptet).

**F5 — Im Onboarding-Bundle gehört das Intermediate als `ca.crt.pem`.**
Der Token-Onboard-Pfad prüft mit dem **flachen** `verifyPeerCert` (`tls.ts:520`, `:754-775`). Die Root als
`ca.crt.pem` ⇒ Bundle wird fail-closed abgewiesen (`:540-544`).

F3 (Fingerprint-Format passt bereits — schliesst den in #352 offen geführten Format-Vorbehalt), F6
(Cert/Key-Paar-Prüfung vor dem Neustart, sonst reisst der Daemon eine frische selbstsignierte Root aus) und
F7 (ein Kommentar in `cert-issuer.ts:118-119` wird durch den Umzug unwahr — **Doku-Schuld für den
TL-14b-Slice**, hier bewusst nicht angefasst) stehen vollständig im Runbook.

---

## Zwei Defekte, die der eigene Test gefunden hat

Beide in den Skripten dieses PRs, beide vor dem ersten Commit gefixt und mit Regression-Test versehen:

1. **`openssl req -noout -verify` liefert Exit 0 auch bei gebrochener Selbstsignatur** (verifiziert an
   OpenSSL 3.0.13) — der Fehlschlag steht **nur im Text**. Der ursprünglich als Exit-Code-Prüfung gebaute
   CSR-Guard war damit **wirkungslos**: eine CSR ohne gültige Selbstsignatur wäre signiert worden, und die
   Root hätte einen fremden Public-Key beglaubigt. Jetzt wird auf das positive Verdikt `verify OK` geprüft.
   Der Test korrumpiert dafür ein Byte **im DER** (Signaturbereich) — ein gekipptes Base64-Zeichen reicht
   nachweislich **nicht**, und ein Guard, der an einem zu schwachen Angriff getestet wird, ist kein Guard.
2. **`openssl … 2>/dev/null` liess das Skript unter `set -e` mit Exit 1 und OHNE jede Ausgabe enden** — in
   einer Zeremonie die schlechteste Fehlerform, weil der Operator nur sieht, dass nichts passiert ist. Alle
   openssl-Aufrufe laufen jetzt über `tl14_openssl`, das den Fehlertext mitgibt.

---

## Code-Review (agy / Gemini, echtes Fremd-Vendor-Review) — 6 Findings, alle behoben

`codex`/`agy` liegen in `~/.local/bin` und sind über den absoluten Pfad aufrufbar (das PAL-Problem ist ein
PATH-Problem). Das Review lief über den Volltext aller fünf Skripte. **Jedes Finding hat einen
Regression-Test** (`+7` Tests, Suite damit `+19` statt `+12`):

| Schwere | Finding | Behebung |
|---|---|---|
| **CRITICAL** | Root-Key mit `-nodes` im **Klartext** auf der Platte — ein entwendeter Air-Gap-Stick kompromittiert die gesamte PKI ohne Rechenschritt | Root-Key jetzt **immer AES-256-verschlüsselt** (`--passphrase-file` oder interaktiver Prompt) + Nachprüfung, dass der Key wirklich `ENCRYPTED` ist |
| **CRITICAL** | Profil-Check `*pathlen:1*` matcht auch **`pathlen:10`/`:100`** — ein fundamentaler Profil-Fehler wäre still als grün gemeldet worden | exakter Vergleich `= "CA:TRUE,pathlen:1"`; Test mit einer echten `pathlen:10`-Root |
| **HIGH** | `bc_of` stirbt unter `pipefail`+`set -e` **kommentarlos**, wenn ein Cert gar keine basicConstraints hat — ausgerechnet in dem Fall, den der Guard zeigen soll | `|| true` in der Pipeline; Test mit einem Cert ohne die Extension |
| **MEDIUM** | Root-Restlaufzeit-Check fiel auf BSD/macOS (kein GNU `date -d`) auf **Warnung** zurück und signierte trotzdem — Widerspruch zum eigenen Fail-closed-Prinzip | ersetzt durch portables `openssl x509 -checkend` ⇒ **fail-closed ohne Ausnahmezweig** |
| **LOW** | `--cn` mit `/` zerlegt OpenSSL in DN-Felder ⇒ stillschweigend kaputter Subject-Name | `tl14_check_cn` lehnt `/` und `=` ab |
| **NIT** | `--days 0800` ⇒ Bash rechnet oktal, Abbruch mit kryptischem *"value too great for base"* | führende Null wird sauber abgelehnt |

**Ein Finding wurde präzisiert statt 1:1 übernommen.** Das CRITICAL zur Key-Verschlüsselung verlangte
Verschlüsselung für **beide** Intermediate-Keys. Für **TH01 ist das nachweislich falsch**: der Daemon liest
`ca.key.pem` mit `forge.pki.privateKeyFromPem` (`tls.ts:465`, `:116`) und hat **an keiner Stelle**
Passphrase-Unterstützung — ein verschlüsselter Key parst dort nicht, `caPairMatches` wird `false`, und der
Daemon generiert eine **frische selbstsignierte Root** (`tls.ts:472-477` → `:549-554`), die das
Zeremonie-Material überschreibt (= F6). Umgesetzt wurde deshalb die belegbare Variante: **Root immer
verschlüsselt** (wird nie von einem Daemon geladen), **TH02 per `--encrypt-key`** (kalte Reserve, wird nie
geladen), **TH01 bewusst im Klartext** mit der Code-Begründung im Skript und im Runbook.

---

## Abgrenzung — was dieser PR ausdrücklich NICHT tut

- **Kein Schritt 6.** Das Ausrollen ist TL-14b: termin-/Christian-gated **und** zusätzlich durch
  Vorbedingung **C1** blockiert, deren Codier-Freigabe aussteht.
- **Keine C1-Umsetzung.** `crl.ts` bleibt unangetastet.
- **Keine Zeremonie durchgeführt.** Es existiert kein Root-Key; die Skripte sind ausschliesslich gegen
  Wegwerf-Material in Temp-Verzeichnissen gelaufen.
- **Kein Beschluss geändert.** ADR-045 ist nicht angefasst; das Runbook setzt D1–D6 um, es entscheidet nichts.
- **Kein `packages/`-Diff.** F7 (der unwahr gewordene Kommentar) ist als Doku-Schuld notiert, nicht gefixt —
  Code-Churn gehört nicht in einen Papier-Slice.

## Tests
`tests/integration/tl14-ceremony-scripts.test.ts` **+19 grün** (12 aus dem Slice + 7 CR-Regressionen): End-to-End-Kette gegen `verifyPeerCertChain`,
D2-Profil (Root `pathlen:1` / Intermediate `pathlen:0`), F4-Positiv **und** F2-Negativ, Fingerprint ==
`certFingerprint` (Pin-Verwendbarkeit), `tl14-verify-chain.sh` Exit 0 **plus Negativ-Kontrolle** (ohne die
sähe ein immer-Exit-0-Skript grün aus), sowie fünf Guards: Überschreibschutz (Key nachweislich unverändert),
beide Laufzeit-Korridore, gebrochene CSR, und „kein stummer Abbruch".
