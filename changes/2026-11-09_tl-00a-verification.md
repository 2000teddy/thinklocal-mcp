# TL-00a — read-only Verifikation: Re-Pair-Migrationsstufe liegt in `main`

**Datum:** 2026-11-09
**Branch:** `agent/claude-code/tl-00a-verification`
**Basis:** `main` @ `5707f33` (Merge von #369)
**PR:** #370
**Auftrag:** Watchdog-Sweep 12:30 UTC (KW46) — TL-00a read-only verifizieren und „ehrlich
schließen oder neu zuschneiden"
**Art:** Doku-only. **Kein** `packages/`-Diff, kein neuer Endpunkt, kein Protokollwechsel, keine
Config-Änderung, kein Laufzeit-Effekt, kein Deploy, kein Release, kein Secret.

**Ergebnis: TL-00a wird mit `[x]` geschlossen.** Jede der drei Zusagen des Punkt-Textes ist
einzeln am Code belegt. **Drei** Dinge sind **nicht** erledigt und werden benannt statt mitverbucht
— alle drei waren schon in ADR-034 als außerhalb des Slices bzw. als beabsichtigte Grenze erklärt.
(Der Vorspann sagte zuerst „zwei", während Abschnitt 5 und die drei anderen Dateien drei führten —
CR-NIT-1.)

---

## 1. Der Punkt-Text und was er verlangt

> **TL-00a (≈3 h)** Re-Pair-Migrationsstufe: EINE Stufe mit Übergangsfenster (Legacy lesen,
> kanonisch schreiben), Lock fürs Cert-Re-Key — keine zwei parallelen Identitäten.

Drei prüfbare Zusagen: **(a)** eine Stufe, die Legacy liest und kanonisch schreibt, **(b)** ein
Lock für das Cert-Re-Key, **(c)** zu keinem Zeitpunkt zwei parallele Identitäten.

**Eine Formulierung ist zweideutig und das muss hier stehen, damit es niemand neu herleiten
muss:** „Übergangsfenster" kann (i) den Code-Pfad meinen, der den Übergang vollzieht, oder (ii)
ein Zeitfenster mit festem Enddatum für die Annahme von Legacy-Ausweisen. Der Punkt-Text definiert
es in seiner **eigenen Klammer** als „(Legacy lesen, kanonisch schreiben)" — also (i). Lesart (ii)
stammt aus der Architektur-Quelle (`03 §3.4`: „übergangsweise akzeptiert … festes Enddatum") und
ist **nicht** umgesetzt; siehe Abschnitt 5.

## 2. Zusage (a) — die Stufe existiert und ist erreichbar

| Element | Stelle | Befund |
|---|---|---|
| Migrationsfunktion | `migrateLegacyCertToCanonical` in `packages/daemon/src/tls.ts` | vorhanden |
| Eintritts-Gate | der `retention?.migrateLegacyIdentity === true`-Zweig in `loadOrCreateTlsBundle` (`tls.ts`) | verlangt zusätzlich eigene kanonische URI, `fullyValid`, `signedByCurrentCa`, `certKeyMatches`, Legacy-`host/`-SAN und dass die kanonische URI **nicht** schon im Cert steht |
| Schalter (Typ) | `cert.migrate_legacy_identity` in der `DaemonConfig`-`cert`-Sektion (`config.ts`) | `boolean` |
| Schalter (Default) | `cert`-Block der `DEFAULTS` (`config.ts`) | **`false`** — opt-in |
| Env-Override | `TLMCP_CERT_MIGRATE_LEGACY_IDENTITY` (`config.ts`) | `=== '1'` |
| Verdrahtung | `migrateLegacyIdentity: config.cert.migrate_legacy_identity` im `loadOrCreateTlsBundle`-Aufruf (`index.ts`) | Kette ist geschlossen |

Die Kette `config.ts` → `index.ts` → Migrationsstufe ist also **vollständig** — der Auftrag hatte
genau danach gefragt. Sie ist per Default **inert**: ohne den Schalter wird der Zweig nie betreten.

## 3. Zusage (b) — das Lock existiert

Advisory-Lockfile `dataDir/tls/.migrate.lock`, per `O_EXCL` erstellt, mit PID und mtime; Stale-Lock
(Default 60 s) wird gestohlen, Timeout (Default 10 s) führt zum Überspringen. Beides ist für Tests
injizierbar (`migrateLockStaleMs`, `migrateLockTimeoutMs`).

Bemerkenswert und in ADR-034 ausdrücklich so entschieden: **die Korrektheit hängt nicht am Lock.**
Die Migration ist idempotent (gleicher Key + gleiche kanonische SAN), und unter dem Lock wird
**erneut** geprüft, ob schon kanonisch — ein paralleler Gewinner führt also nicht zu einem zweiten
Re-Sign. Das Lock serialisiert, es garantiert nicht.

## 4. Zusage (c) — zwei parallele Identitäten sind strukturell ausgeschlossen

Nicht „wird vermieden", sondern **kann nicht entstehen**, und zwar aus drei unabhängigen Gründen:

1. **Key-Wiederverwendung** ⇒ der Platten-Swap ist ein **Einzeldatei**-Rename (`node.crt.pem` via
   `*.tmp` + `fsync` + `rename`, danach Dir-`fsync`); `node.key.pem` bleibt unberührt. Ein Leser
   kann daher nie ein inkonsistentes Cert/Key-Paar sehen.
2. **`createNodeCert` setzt genau eine SPIFFE-SAN** — die kanonische. Es gibt kein Cert mit beiden
   Identitäten.
3. **Das Legacy-Cert wird archiviert, nicht behalten:** `node.crt.legacy-premigrate.pem` — ein
   Name, unter dem es **nicht live** ist.

Dazu fail-closed an jeder Stelle: schlägt das Signieren, der `tmp`-Write, der Rename oder das Lock
fehl, bleibt das **Legacy-Cert unangetastet**, weil der Rename der **letzte** Schritt ist.

## 5. Was **nicht** erledigt ist — benannt, nicht mitverbucht

**(1) Kein Enddatum für die Legacy-Akzeptanz.** `git grep -niE "legacy.*(enddatum|sunset|deadline|
cutoff)|accept_legacy_until|legacy_until"` über `packages/*/src` und `config/` ⇒ **0 Treffer**; es
gibt keinen Timer und keinen Sunset-Mechanismus. Das ist **kein Versäumnis dieses Slices**: ADR-034
schließt es in den eigenen „Grenzen" aus — *„Kein Enddatum-Setzen für Legacy-Akzeptanz (das ist
§3.4-Betrieb), kein `.52`/`.55`-Live-Rollout, kein Timer."* **Offen bleibt, dass dieser
Betriebspunkt in `TODO.md` heute keinen Eintrag hat** (`grep -niE "enddatum|legacy-akzeptanz"` ⇒
0 Treffer). Ob er einen bekommt, ist ein Betriebs-/Owner-Entscheid und wird hier **nur gemeldet** —
eine neue TL-Nummer zu erfinden wäre eine Entscheidung, die der Lane nicht zusteht.

**(2) Kein Live-Einsatz.** Die Stufe ist nie gelaufen; sie ist per Default aus. Der Einsatz an
`.52`/`.55`/`.94` ist **TL-00b** — eigener Punkt, ⛔ Fenster, Christian-gated. TL-00a schuldete die
Stufe, nicht ihren Einsatz.

**(3) Token-onboardete Legacy-Nodes können sich nicht selbst migrieren.** Sie erreichen den
Codeblock über einen eigenen Early-Return nicht und müssen re-onboarden. In ADR-034 als
beabsichtigt dokumentiert und geloggt — also keine Lücke, aber eine Einschränkung, die zur
Vollständigkeit gehört.

## 6. Das zweite Artefakt (#246) — präzise, weil es nach einem Verdrahtungs-Rest aussieht

`packages/daemon/src/pairing-canonicalize.ts` (`canonicalizePairedPeer`, 9 Tests in
`pairing-canonicalize.test.ts`) hat **genau einen** Aufrufer:
`packages/daemon/scripts/canonicalize-pairings.ts`. Das ist **kein** Daemon-Laufzeitpfad.

Das sieht auf den ersten Blick wie der Befundtyp aus, den ich bei **TL-19** gemeldet habe
(`circuit-breaker.ts` existiert, hat außer seinem Test keinen Aufrufer) — ist es aber **nicht**:
das Skript ist in `packages/daemon/package.json` als npm-Script `canonicalize-pairings`
registriert, also ein **Operator-Werkzeug mit Absicht**. Es kanonisiert einen
`paired-peers.json`-Eintrag nach einem Re-Enroll und verlangt dafür **zwei** unabhängige Bindungen
(CA-Anker über die gespeicherte `caCertPem` **und** Identitäts-Bindung an eine vom Aufrufer
asserted kanonische URI) — ausdrücklich, weil der CA-Anker allein bei einer geteilten Mesh-CA jeden
Node verifiziert und damit Identitäts-Substitution erlauben würde. Ein Operator-Tool ohne
Laufzeit-Aufrufer ist hier die richtige Form, kein Rest.

## 7. Test- und Gate-Beleg

**Read-only** — es wurde nichts verändert, also ist auch keine Baseline-Verschiebung zu zeigen.
Gemessen wurde zum Nachweis, dass die Zusagen **getestet** sind:

| Lauf | Ergebnis |
|---|---|
| `npx vitest run src/tls.test.ts src/pairing-canonicalize.test.ts` | **58/58 grün** (49 + 9) — davon **9** direkt TL-00a-belegend |
| volle Suite `packages/daemon` | **152 Dateien / 2188 Tests grün** — unverändert zu `main` |
| `git diff --stat -- packages/` | **0 Dateien** |

**Die neun Tests, die TL-00a direkt belegen**, stehen in `tls.test.ts` — **sieben** unter
`describe('ADR-034 — Re-Pair-Migrationsstufe (loadOrCreateTlsBundle)')` und **zwei** unter
`describe('ADR-024 — Canonical-Cert-Retention')`. Ein erster Entwurf schrieb „acht" und führte die
beiden Retention-Tests zugleich als achten Listenpunkt, was rechnerisch zehn suggerierte
(CR-LOW-1); nachgezählt sind es 7 + 2:

1. migriert Legacy `host/` → kanonisch `node/` (Key-Reuse, atomarer Swap, Legacy archiviert) — (a)+(c)
2. idempotent: zweiter Aufruf sieht kanonisch → behalten, kein zweiter Re-Sign
3. **Regression: Schalter AUS → Legacy-Cert unverändert behalten (bitidentisch)** — der Default-Beweis
4. fail-closed: Backup-Write scheitert → Legacy unangetastet
5. Lock belegt (frisch) + kurzes Timeout → Migration übersprungen, Legacy behalten — (b)
6. Lock verwaist (alt) → gestohlen, Migration läuft — (b)
7. bereits kanonisch + Schalter AN → KEINE Migration (kein Backup, kein Re-Sign)
8. im Retention-Block: „behält Migrations-Cert: Legacy `host/`-SAN + eigene kanonische
   `node/`-SAN" — (c) von der anderen Seite
9. im Retention-Block: „verwirft überbreites Cert: eigene UND eine FREMDE kanonische `node/`-SAN"
   — schließt die Identitäts-Breite nach oben ab

## 8. Commit-Belege

| PR | Commit | Inhalt |
|---|---|---|
| #245 | `1be4c93` (2026-07-06) | `feat(tls): Re-Pair-Migrationsstufe Legacy→kanonisch (ADR-034, v0.34.69)` |
| #246 | `0faf6e9` (2026-07-07) | `feat(pairing): CA-verankerter host/→node/-Re-Key (v0.34.70)` |
| — | — | `docs/architecture/ADR-034-repair-migrationsstufe.md`, **Status: Accepted** (2026-07-06) |

## 9. Warum `[x]` und nicht „Verifikationspunkt" wie TL-01…TL-07

Der Auftrag stellte beide Möglichkeiten zur Wahl. TL-01…TL-07 tragen zu Recht die Form
„Verifikations-/Live-Wiring-Punkt", weil ihr *Fertig-wenn*-Kriterium ein **Live**-Kriterium ist
(„`query_capabilities` zeigt … auf **allen** Peers", Zwei-Rechner-Beweis) — das ist ohne Re-Pair
der Peers nicht erreichbar, der Punkt bleibt also offen.

TL-00a schuldet dagegen **die Stufe**, kein Live-Ergebnis: eine Stufe, ein Lock, keine zwei
Identitäten. Alle drei sind am Code belegt und getestet, die Verdrahtungskette ist geschlossen, und
der Live-Einsatz hat mit TL-00b bereits einen eigenen Punkt. Den Punkt als „Verifikationspunkt"
offen zu lassen, würde ihn mit TL-00b doppeln und den Rest-Filter dauerhaft verstopfen. Deshalb
`[x]` — mit den drei Einschränkungen aus Abschnitt 5 im Abschlussvermerk, damit nichts im
`[x]`-Kasten verschwindet.

## 10. Was dieser Slice **nicht** anfasst

- **Zelle #369** in `COMPLIANCE-TABLE.md` steht nach ihrem eigenen Merge weiter auf
  `(offen, base=main)` (Selbst-Reconcile-Lücke). Der Auftrag hat sie ausdrücklich als **Folge-Slice**
  ausgenommen — hier **nicht** angefasst.
- **Die `[Unreleased]`-Datumskonvention festzuschreiben** wäre ein Kanon-Beschluss und liegt bei
  Christian. Die Zeitangabe selbst ist nach der in #369 beobachteten Praxis auf den jüngsten
  Eintrag gezogen; die Konvention bleibt undokumentiert.
- Kein `packages/`-Diff, keine Config, kein Flag, keine Identity. `TL-16`, `TL-17`, `TL-19`,
  `TL-22a/b` unberührt; kein Branch-Delete der lokalen Referenzen.
