# TL-14a — CA-Zweistufen-Umzug: Entscheidungs-Checkliste (Change-Order)

**KW30 · Change-Order / Decision-Register · Erstellt 2026-07-19 · Folge-Artefakt zu
`TL-14a-ca-two-stage-scoping.md` §5.**
Zweck: die **6 offenen Entscheidungen** aus dem Scoping-§5 in ein **aktionierbares** Register überführen —
je Entscheidung: Frage, Optionen, **nicht-bindende** Empfehlung (Entscheidungshilfe), Abhängigkeit,
Entscheider, was sie blockiert, Status. **Dieses Artefakt trifft keine Entscheidung** — es macht sie
abstimmbar. Der Beschluss fällt per Folge-CO (`pal:consensus`) und/oder Christian-Sign-off und wird in einer
künftigen ADR (CA-Hierarchie/Offline-Root) festgehalten, **bevor** Runbook-Volltext + Zeremonie-Skripte
entstehen und **lange bevor** TL-14b (⛔ gated) läuft.

## Übersicht

| ID | Entscheidung | Empfehlung (nicht bindend) | Entscheider | Blockiert | Status |
|----|--------------|----------------------------|-------------|-----------|--------|
| **D1** | Trust-Domain-Kopplung | **Entkoppeln** — Domain-Flip separat NACH CA-Umzug | Christian (+CO) | Runbook-Rahmen, D4 | ⬜ offen |
| **D2** | `pathLenConstraint` der Root | **`0`** (Intermediates dürfen keine Sub-CAs) | CO | Zeremonie-Skript, D6 | ⬜ offen |
| **D3** | Intermediate-Validität & Erneuerung | **≥ 5 Jahre**, eigener Zyklus, nicht `renew_before_days` | CO | cert-issuer-Erweiterung | ⬜ offen |
| **D4** | Cross-Sign vs. harter Cutover | **Doppel-Pin-Cutover** (Alt+Neu im Fenster) | Christian (+CO) | TL-14b-Sequenz, D1/D5 | ⬜ offen |
| **D5** | Chain-Ausroll-Mechanik | **Token-Re-Onboard** je Node | Christian | TL-14b-Kern | ⬜ offen |
| **D6** | TH02-Geschwister-Rolle | **Kalt** (versiegelte Reserve, identische Kette) | Christian (+CO) | HA-Runbook-Zweig | ⬜ offen |

Legende Status: ⬜ offen · 🟨 in CO · ✅ beschlossen (→ ADR-Zeile eintragen).

---

## D1 — Trust-Domain-Kopplung
**Frage:** Flippt der CA-Umzug **zugleich** die Trust-Domain auf `axxsys-software.de` (Decision-7), oder
bleibt die SAN-Domain `spiffe://thinklocal/` und der Domain-Flip ist ein **separater** Schnitt?
**Optionen:**
- **(a) Gekoppelt** — ein Fenster, weniger Re-Enroll-Wellen; aber **zwei Variablen gleichzeitig**
  (Signierpfad **und** Namensraum) → schwerer zu bisektieren bei Fehlern.
- **(b) Entkoppelt** — CA-Umzug erhält `thinklocal`, Domain-Flip als eigener, späterer Schnitt.
**Empfehlung (nicht bindend):** **(b) Entkoppeln.** Der Umzug ändert bereits den Signierpfad (Root→
Intermediate); die kanonische SAN blieb bewusst schon bei der KW28-Re-Pair auf `thinklocal`
(`[[decision7-trust-domain]]`). Ein Namensraum-Flip obendrauf multipliziert das Risiko im selben Fenster.
**Abhängigkeit:** Decision-7; wirkt auf den Runbook-Rahmen und D4 (Doppel-Pin müsste sonst auch die Domain
doppeln). **Entscheider:** Christian (+ CO). **Blockiert:** Runbook-Rahmen, D4.

## D2 — `pathLenConstraint` der Root
**Frage:** `pathLen 0` (Root darf nur Blatt-Intermediates, die **keine** weiteren CAs ausstellen) vs. `1`.
**Optionen:**
- **(a) `pathLen 0`** — striktes zweistufiges Modell (Root → Intermediate → Leaf), TH02 kann **keine**
  Sub-CAs; kleinste Angriffsfläche, passt exakt zum „Zweistufen"-Auftrag.
- **(b) `pathLen 1`** — erlaubt eine weitere CA-Ebene unter den Intermediates (Zukunfts-Flexibilität,
  aber unnötige Vollmacht heute).
**Empfehlung (nicht bindend):** **(a) `pathLen 0`.** Heute existiert **kein** Intermediate-Begriff
(`createMeshCA` `tls.ts:59`, `basicConstraints{cA:true}` ohne `pathLen` `tls.ts:84`); genau zwei Stufen sind
gefordert. Minimal-Vollmacht. **Abhängigkeit:** interagiert mit D6 (kalte Reserve braucht keine Sub-CA-
Vollmacht). **Entscheider:** CO (technisch). **Blockiert:** Zeremonie-Skript (Root-Keygen-Extensions), D6.

## D3 — Intermediate-Validität & Erneuerung
**Frage:** Laufzeit der Intermediates und ob die bestehende `renew_before_days`-Logik sie erfasst oder ein
eigener Zyklus gilt.
**Optionen:**
- **(a) Kurz + `renew_before_days`-getrieben** — behandelt Intermediates wie Leafs (`NODE_CERT_VALIDITY_DAYS
  =90`, `cert-issuer.ts`; `renew_before_days=30`, `config.ts:165/251`) → häufige Offline-Root-Zeremonien
  (teuer, Air-Gap!).
- **(b) Lang + eigener Zyklus** — Intermediates ≥ 5 Jahre, manuelle/geplante Erneuerung außerhalb der
  Leaf-Renew-Logik; die Root länger (z. B. 10–20 Jahre).
**Empfehlung (nicht bindend):** **(b).** Jede Intermediate-Erneuerung erfordert die **Offline-Root**
(Air-Gap-Zeremonie) — das darf **nicht** an den 30-Tage-Leaf-Rhythmus gekoppelt sein. Eigener, seltener
Zyklus. Konkrete Zahlen (Root 15 J / Intermediate 5 J?) → in der ADR fixieren. **Abhängigkeit:**
`cert-issuer.ts`/`cert-expiry-monitor.ts` müssten Intermediate-Restlaufzeit separat überwachen (späterer
Code-Slice). **Entscheider:** CO. **Blockiert:** cert-issuer/monitor-Erweiterung.

## D4 — Cross-Sign vs. harter Cutover
**Frage:** Werden die neuen Intermediates in der Übergangszeit von der **alten** Root **quer-signiert**
(nahtlos) oder harter Cutover mit **Doppel-Pin** (Alt+Neu) im Fenster?
**Optionen:**
- **(a) Cross-Sign** — alte Root signiert die neuen Intermediates → Alt-Trust-Anker akzeptiert die neue
  Kette ohne Node-Änderung; nahtlos, aber Ketten-/Bundle-Logik komplexer, längere Doppel-Vertrauens-Phase.
- **(b) Doppel-Pin-Cutover** — beide Fingerprints gepinnt (`resolveAttestingCaFingerprints`
  `cert-issuer.ts:121`, `TLMCP_PEERID_ATTESTING_CA_FP`), harter Schnitt am Stichtag, Alt-Pin danach entfernt.
**Empfehlung (nicht bindend):** **(b) Doppel-Pin-Cutover.** Das Repo hat **bereits** Multi-Fingerprint-Pin
+ Legacy-Retain-Mechanik (`ca.crt.legacy.pem` `tls.ts:437`), passt zum bestehenden ADR-024-Retention und dem
01.08.-Duldungsende (TL-13); Cross-Sign führte eine neue, ungetestete Ketten-Verifikation ein. **Abhängigkeit:**
ADR-024, TL-13-Duldungsende, D1 (bei Kopplung müsste auch die Domain doppelt gepinnt werden). **Entscheider:**
Christian (+ CO). **Blockiert:** TL-14b-Sequenz.

## D5 — Chain-Ausroll-Mechanik an die Nodes
**Frage:** Wie erhalten die Nodes die neue Kette — **Token-Re-Onboard** je Node oder **`ca.crt.pem`-Chain-
Swap**? *(Der eigentliche TL-14b-Kern.)*
**Optionen:**
- **(a) Token-Re-Onboard** — sauberer, verifizierter Pfad (`node.crt.pem` verifiziert gegen geliefertes
  `ca.crt.pem`, `tls.ts:534-537`); je Node **ein** Fenster (deploy-/host-gated).
- **(b) `ca.crt.pem`-Chain-Swap** — schneller, aber trifft die bekannten Fallen `[[cert-clobber-on-ca-
  reissue]]` (lokale CA-Reissue überschreibt hub-signiertes Cert) und `[[th02-phase3-flip-blocker]]`
  (Nachbarn re-fetchen die geflippte Karte nicht → Unknown-sender-Deadlock).
**Empfehlung (nicht bindend):** **(a) Token-Re-Onboard.** Die Chain-Swap-Fallen sind im Repo dokumentiert und
**ungelöst**; der Token-Pfad hat eine harte Verifikationsklausel. Kosten: je Node ein Christian-/Deploy-
Fenster — **das** ist der ⛔-Anteil von TL-14b. **Abhängigkeit:** `[[cert-clobber-on-ca-reissue]]`,
`[[th02-phase3-flip-blocker]]`, `[[dod-two-peer-mcp-proof]]` (Live-Proof je Node). **Entscheider:** Christian.
**Blockiert:** TL-14b-Durchführung (out-of-repo, gated).

## D6 — TH02-Geschwister-Rolle
**Frage:** Geschwister-Intermediate **heiß** (aktiv mit-ausstellend) oder **kalt** (versiegelte Reserve)?
Eigener Aussteller-Namensraum oder identische Kette?
**Optionen:**
- **(a) Heiß** — TH02 stellt parallel aus (HA/Lastverteilung); zwei Live-Signierschlüssel = doppelte
  Angriffsfläche + Ausstell-Divergenz-Risiko.
- **(b) Kalt** — TH02-Intermediate versiegelt hinterlegt, wird nur bei TH01-Verlust aktiviert; identische
  Kette unter derselben Root.
**Empfehlung (nicht bindend):** **(b) Kalt, identische Kette.** Der Auftrag nennt TH02 als
„Geschwister-Reserve"; eine kalte Reserve deckt den TH01-Verlust ab, ohne einen zweiten heißen Signierpfad
zu betreiben. **Abhängigkeit:** D2 (`pathLen 0` genügt für kalte Reserve). **Entscheider:** Christian (+ CO).
**Blockiert:** HA-Zweig des Runbooks.

---

## Nächster Schritt (nach diesem Register)
1. **Folge-CO** (`pal:consensus`, 2–3 Modelle) über D1–D6 mit diesen Empfehlungen als Vorlage.
2. **Christian-Sign-off** für die gated-behafteten (D1, D4, D5, D6).
3. **ADR** (CA-Hierarchie/Offline-Root) hält die Beschlüsse fest.
4. Erst dann: **Runbook-Volltext + Zeremonie-Skripte** (Papier+Skripte, non-gated), danach **TL-14b** (⛔).

## Sign-off (auszufüllen beim Beschluss)
| ID | Beschluss | Datum | Entscheider | ADR-Ref |
|----|-----------|-------|-------------|---------|
| D1 | | | | |
| D2 | | | | |
| D3 | | | | |
| D4 | | | | |
| D5 | | | | |
| D6 | | | | |

## Abgrenzung
Doc/Design only. **Keine** Entscheidung getroffen, **kein** Code/Config/Skript, kein Deploy/Secret/Cross-Host.
Ausschließlich die §5-Punkte der Scoping-Note in ein abstimmbares Register überführt.
