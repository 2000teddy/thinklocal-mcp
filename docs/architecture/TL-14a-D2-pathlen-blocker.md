# TL-14a — BLOCKER (GELÖST): ADR-045 D2 (`Root pathLen 0`) war mit der Zweistufen-Hierarchie unvereinbar

> **✅ ENTSCHIEDEN 2026-08-26 — Option A freigegeben (Christian).** ADR-045 §D2 ist auf
> **Root `pathLen 1` + Intermediate `pathLen 0`** korrigiert; Zielhierarchie-Diagramm und §Verworfene
> Alternativen sind mitgezogen. Der **Beschluss** „exakt zwei Stufen, keine Sub-CAs" ist **unverändert** —
> nur seine Kodierung war falsch. **Der Runbook-Slice ist damit entblockt** und ab Schritt 2 fortsetzbar.
> Dieses Dokument bleibt als **Befund- und Entscheidungs-Beleg** stehen.

**Typ:** Blocker-Befund, code- und laufzeit-verifiziert. **Status: gelöst** (Owner-Freigabe Option A,
2026-08-26). **Datum:** 2026-08-26 (KW35).
**Entdeckt beim:** Schreiben des Runbook-Volltexts + der Zeremonie-Skripte (der erste Slice, den der
G1/G2-Sign-off entriegelt hat). Der Befund **stoppt genau diesen Slice** an Schritt 2 von 7.

> **Kurzfassung:** ADR-045 §D2 schreibt für die Offline-Root **`pathLen 0`** vor. Nach RFC 5280 erlaubt
> `pathlen:0` **kein einziges Intermediate** unterhalb dieser CA. Die Zielhierarchie der ADR ist aber
> **Root → Intermediate (TH01/TH02) → Node-Leafs**. Mit D2-wie-geschrieben wäre **jedes** Node-Zertifikat
> der neuen Hierarchie mesh-weit ungültig. Korrekt ist **Root `pathLen 1` + Intermediate `pathLen 0`** —
> das Schutzziel von D2 bleibt dabei vollständig erhalten.

## 1. Warum das ein echter Blocker ist (nicht Kosmetik)

Das Zeremonie-Skript muss in **Schritt 2** (Offline-Wurzel-Zeremonie) genau eine Zeile setzen:

```
basicConstraints = critical, CA:TRUE, pathlen:<N>
```

`<N>` ist der Streitpunkt. Schreibe ich `0` (= ADR-045 D2), erzeugt die Zeremonie eine Root, unter der die
gesamte geplante Hierarchie **nicht verifiziert**. Schreibe ich `1`, weiche ich von einer **gerade erst
owner-gezeichneten** ADR-Klausel ab. Beides ist ohne Entscheidung nicht vertretbar — deshalb ist der
Runbook-Slice hier gestoppt statt „irgendwie" fortgeschrieben (ADR-045 verlangt selbst, dass Skripte
**nicht** „an genau der offenen Stelle unvollständig" entstehen).

## 2. Die Norm (RFC 5280 §4.2.1.9)

> The pathLenConstraint field […] gives the maximum number of **non-self-issued intermediate certificates
> that may follow this certificate** in a valid certification path.

Entscheidend ist **„follow this certificate"** — der Constraint zählt die Zwischen-CAs **unterhalb** der CA,
die ihn trägt, **nicht** die Stufen, die sie selbst ausstellen darf.

| Zertifikat | `pathLen` | Bedeutung |
|---|---|---|
| Root | **0** | Unter der Root darf **keine** weitere CA folgen ⇒ nur direkte End-Entitäten. **Verbietet das Intermediate.** |
| Root | **1** | Genau **eine** Zwischen-CA darf folgen ⇒ exakt die gewünschte Zweistufigkeit. |
| Intermediate | **0** | Unter dem Intermediate darf **keine** weitere CA folgen ⇒ **TH01/TH02 können keine Sub-CAs ausstellen.** |

## 3. Der Denkfehler in der ADR (und warum er plausibel war)

ADR-045 §D2 formuliert das **Schutzziel korrekt**:

> „Root darf nur Intermediates ausstellen, die **keine** weiteren Sub-CAs erzeugen."

Genau das leistet aber der `pathLen` **am Intermediate**, nicht der an der Root. Die ADR verwarf `pathLen 1`
unter „Verworfene Alternativen" mit der Begründung:

> „**`pathLen 1`** (D2) — unnötige Vollmacht (TH02 könnte Sub-CAs), widerspricht ‚exakt zwei Stufen'."

Das ist eine **Fehllesung**: `pathLen 1` **an der Root** gibt TH02 keinerlei Sub-CA-Vollmacht. Ob TH02
Sub-CAs ausstellen darf, entscheidet allein TH02s **eigener** `pathLen` — und der ist `0`. „Root `pathLen 1`
+ Intermediate `pathLen 0`" ist **exakt** die Kodierung von „exakt zwei Stufen"; „Root `pathLen 0`" ist die
Kodierung von „exakt **eine** Stufe" (flach — der heutige Zustand, den TL-14 gerade ablösen soll).

## 4. Beleg — dreifach, unabhängig

### 4.1 Der eigene, grüne Testbestand widerspricht D2 bereits

`packages/daemon/src/chain-verify.test.ts` (Vorbedingung A, gemergt in #298/#311):

- **Zeile 55** — die **funktionierende** Kette wird mit **Root `pathLen 1`** gebaut:
  `const root = mintCA(null, 'thinklocal Root chain-ok', 1); // pathLen 1 → 1 Intermediate erlaubt`
  → `verifyPeerCertChain(...)` **`true`**
- **Zeilen 61-67** — D2-wie-geschrieben ist als **Ablehnung** festgenagelt:
  `it('ENFORCET pathLen: Root mit pathLen 0 lehnt eine Intermediate-Kette ab', …)` → **`false`**

Der Testbestand kodiert also seit Vorbedingung A das **Gegenteil** von D2 — es ist nur niemandem
aufgefallen, weil die Tests „pathLen wird enforced" beweisen wollten, nicht „D2 ist umsetzbar".

### 4.2 OpenSSL bestätigt es vendor-neutral (kein node-forge-Artefakt)

Reproduzierbar via `scripts/tl14-ca/tl14-pathlen-proof.sh` (Wegwerf-Material in `mktemp -d`, fasst
**keinen** Daemon-State an):

```
OpenSSL 3.0.13
Root pathlen:0 -> Intermediate(pathlen:0) -> Leaf  ==> ABGELEHNT — error 25 at 2 depth lookup: path length constraint exceeded
Root pathlen:1 -> Intermediate(pathlen:0) -> Leaf  ==> OK (Kette gültig)
```

Einziger Unterschied zwischen beiden Ketten ist der `pathLen` der Root — dasselbe Intermediate-Keypair und
dieselbe CSR werden von beiden Roots signiert.

### 4.3 Neuer End-to-End-Test schliesst die eigentliche Lücke

`tests/integration/tl14-ceremony-cert-profile.test.ts` (neu, 4 Tests, grün). **Warum er nötig war:** alle
bisherigen Ketten-Tests minten ihre Certs mit **node-forge** — also mit demselben Werkzeug, das sie prüfen.
Die Zeremonie läuft auf dem Air-Gap-Rechner mit **OpenSSL**. Ob ein **OpenSSL-erzeugtes** Profil vom Daemon
akzeptiert wird, war **ungetestet** — das wäre erst im TL-14b-Fenster aufgefallen. Der Test baut die Kette
wie das Zeremonie-Skript (echte CSR-/Signatur-Schritte, SPIFFE-SAN, 730 Tage = D3) und prüft sie mit der
**echten** `verifyPeerCertChain`:

1. Root `pathLen 1` + Intermediate `pathLen 0` ⇒ **akzeptiert**
2. Root `pathLen 0` (D2-wie-geschrieben) ⇒ **abgelehnt**
3. Sub-CA unter dem Intermediate ⇒ **abgelehnt** (D2-Schutzziel bleibt bei Root `pathLen 1` intakt)
4. `certFingerprint()` == OpenSSL-DER-SHA256 (lowercase hex) ⇒ **Pin-Kompatibilität für D4 belegt**

Punkt 3 ist der Kern der Entwarnung: **die Korrektur schwächt D2 nicht.** Punkt 4 war ein zweites,
ungetestetes Risiko — hätten die Fingerprint-Formate abgewichen, hätte der Doppel-Pin-Cutover ins Leere
gepinnt.

## 5. Die Entscheidung (Owner/CO)

| Option | Bewertung | Beschluss |
|---|---|---|
| **A — D2 korrigieren: Root `pathLen 1`, Intermediate `pathLen 0`** (empfohlen) | Erfüllt das dokumentierte Schutzziel exakt, ist RFC-konform, durch 4.1–4.3 belegt. Reine ADR-Text-Korrektur, **kein** Code-Diff. | **✅ FREIGEGEBEN (Christian, 2026-08-26)** |
| **B — D2 beibehalten (`Root pathLen 0`)** | Technisch unmöglich in Kombination mit der Zielhierarchie. Ginge nur, wenn man die Zweistufigkeit aufgibt — dann ist TL-14 als Ganzes gegenstandslos. | verworfen |
| **C — `pathLen` an der Root weglassen** | RFC-konform (unbegrenzte Tiefe), aber schwächer als A: die Root dürfte beliebig tiefe CA-Ketten erlauben. Verstösst gegen „Minimal-Vollmacht". | verworfen |

**Umgesetzt am 2026-08-26** (minimale Textkorrektur, genau drei Stellen in ADR-045):
1. **§D2** — Überschrift + Kodierungs-Tabelle (Root `1` / Intermediate `0`) + RFC-Begründung + Korrektur-Historie.
2. **§Zielhierarchie** — Root-Zeile im Diagramm: `pathLen 0` → `pathLen 1 — genau EINE Zwischenstufe erlaubt`.
3. **§Verworfene Alternativen** — die Verwerfung von „`pathLen 1`" **zurückgezogen** (Fehllesung) und durch die
   tatsächlich verworfene Alternative ersetzt (`pathLen` an der Root **weglassen**).

## 6. Was dieser Befund NICHT ändert

- **D1, D3, D4, D5, D6** unberührt. D3 = 24 Monate bleibt, der G1-Sign-off bleibt gültig.
- **C1/C2** unberührt.
- **ADR-045 bleibt `Accepted`** — die Klausel ist korrekturbedürftig, der Beschluss als Ganzes nicht hinfällig.
- **Kein Code-Diff.** `packages/daemon/**` ist unangetastet; `verifyPeerCertChain` verhält sich **korrekt**
  und braucht keine Änderung — es lehnt zu Recht ab.
- **TL-14b** bleibt ⛔ gated und setzt weiterhin C1 voraus.

## 7. Stand des Runbook-Slices

War **gestoppt an Schritt 2 von 7** (Offline-Wurzel-Zeremonie). Die Schritte 1/5/7 (Vorbedingungen/Inventar,
Chain-Verifikation, Rollback) hingen nicht am `pathLen`; die Schritte 2/3/4 (Root-Zeremonie, Intermediate
TH01, Geschwister TH02) **vollständig**. Ein Runbook, dessen Zeremonie-Schritt nicht ausführbar ist, wäre
genau die „Nebelmaschine", vor der `TL-14a-gate-status.md` §3 warnt — deshalb **Halt und Meldung**
statt Weiterschreiben.

**✅ Seit der Freigabe von Option A (2026-08-26) ist der Slice entblockt.** Das Zeremonie-Skript kann
`basicConstraints = critical, CA:TRUE, pathlen:1` für die Root und `pathlen:0` für die Intermediates setzen;
beide Werte sind durch `tests/integration/tl14-ceremony-cert-profile.test.ts` gegen den echten Daemon-Verify
abgesichert. **Der Runbook-Volltext selbst ist NICHT Teil dieses PRs** — er folgt als eigener Slice.

## Verweise

- `docs/architecture/ADR-045-ca-two-stage-hierarchy.md` §D2, §Zielhierarchie, §Verworfene Alternativen
- `packages/daemon/src/chain-verify.test.ts:55` (pathLen 1 ⇒ gültig) und `:61-67` (pathLen 0 ⇒ abgelehnt)
- `packages/daemon/src/tls.ts` `verifyPeerCertChain` (+ `enforcePathLenConstraint`)
- `scripts/tl14-ca/tl14-pathlen-proof.sh` (OpenSSL-Beleg, re-runnable)
- `tests/integration/tl14-ceremony-cert-profile.test.ts` (End-to-End-Profil-Test, neu)

## Abgrenzung

Doc + Test + Proof-Skript. **Keine** Entscheidung, **keine** ADR-Änderung, **kein** `packages/`-Diff, kein
Deploy/Secret/Cross-Host. Der C1-Slice bleibt unberührt und weiterhin nicht freigegeben.
