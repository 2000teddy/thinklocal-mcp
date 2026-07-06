# ADR-034 — Re-Pair-Migrationsstufe (Legacy `host/` → kanonisch `node/<PeerID>`)

**Status:** Accepted
**Datum:** 2026-07-06
**Kontext-Task:** WOCHENPLAN-KW28 §2 (Mo), Hermes-Risiko 1. Architektur: `architecture-v5.1/03 §3.4`
(Legacy-Ausweise „während der Umstellung übergangsweise akzeptiert … festes Enddatum").
**Verwandt:** ADR-024 (Canonical-Cert-Retention), ADR-022 (Identity-Flip), ADR-028 (kanonische
`node/<PeerID>`-SPIFFE-Identität), PR #242 (`renew_before_days`).

## Problem

Drei Nodes (`.52`, `.55`, + einer) tragen noch Legacy-Ausweise mit einer
`spiffe://thinklocal/host/<id>/agent/…`-SAN. Der Zielzustand ist **genau eine** kanonische Identität
`spiffe://thinklocal/node/<PeerID>` (aus dem libp2p-Key). Heute behält ein Own-CA-Legacy-Node sein
Legacy-Cert beim Start unverändert (`loadOrCreateTlsBundle`, legacy-current-ca-Retain-Gate) — es gibt
**keinen** Selbst-Umstieg. Der Umstieg passiert bisher nur extern (Attesting-CA-Re-Enroll, ADR-024).

Für das `.52`-Re-Enroll-Fenster (KW28 Di, Christian-gated) braucht es eine **kontrollierte
Übergangsstufe**, die beim Start ein Legacy-Cert **einmal** liest und **kanonisch** neu ausstellt —
ohne jemals einen Zustand zu erzeugen, in dem **zwei parallele Identitäten** (Legacy + Kanonisch)
gleichzeitig auf der Platte oder gar live nutzbar sind (Hermes-Risiko 1).

## Entscheidung

Eine **opt-in** Migrationsstufe in `loadOrCreateTlsBundle` (kein zweites Cert-Modul — baut auf dem
bestehenden Canonical-Pfad auf).

### 1. Auslöser (opt-in, Default AUS)

Neues Feld **`cert.migrate_legacy_identity`** (bool, Default **`false`**) + Env-Override
**`TLMCP_CERT_MIGRATE_LEGACY_IDENTITY`**. Grund für Default-AUS: der Umstieg soll **bewusst** durch
Christians `.52`/`.55`-Fenster aktiviert werden, nicht heimlich beim nächsten Daemon-Start zufallen.
Ist der Schalter aus → die Migrationsstufe wird nie betreten → Verhalten **bitidentisch** zu heute.

### 2. Erkennung Legacy vs. Kanonisch (vor dem Behalten-Gate)

Migrationsfall genau dann, wenn **alle** gelten (sonst: bestehendes Verhalten, unverändert):
- Schalter an **und** eine eigene kanonische URI (`canonicalSpiffeUri`, aus libp2p-Key) verfügbar;
- das On-Disk-Node-Cert trägt eine **Legacy-`host/`-SAN** und **nicht bereits** die eigene
  `canonicalSpiffeUri` (schon-kanonisch → kein Migrationsfall, normale Retention greift);
- das Legacy-Cert ist ein **gültiger eigener** Ausweis: `fullyValid`, `signedByCurrentCa`,
  `certKeyMatches` (sonst → normaler Reissue-Pfad, der Invalidität ohnehin behandelt).

Token-onboardete Legacy-Nodes (ohne eigenen CA-Key) erreichen diesen Codeblock **nicht** (eigener
Early-Return-Zweig) → sie können sich **nicht** selbst migrieren und müssen **re-onboarden**. Das ist
beabsichtigt und wird geloggt (fail-safe: Legacy bleibt unangetastet).

### 3. Aktion: Key WIEDERVERWENDEN, Cert kanonisch neu signieren (die zentrale Design-Wahl)

Die Migration signiert ein neues Node-Cert mit **SAN = `canonicalSpiffeUri`**, **unter Wiederverwendung
des vorhandenen Node-Keypairs** (`createNodeCert(..., existingKeyPem)`), signiert von der **eigenen CA**.

**Warum Key-Wiederverwendung statt frischem Key (Re-Key):** Der Zweck der Stufe ist die
**Identitäts-Kanonisierung** (`host/` → `node/`), nicht Key-Rotation. Der Node-Key ist zum Re-Pair-
Zeitpunkt nicht kompromittiert. Die Wiederverwendung macht den Platten-Swap zu einem **atomaren
Einzeldatei-Rename** (nur `node.crt.pem`; `node.key.pem` bleibt unberührt) — dadurch kann **kein**
Beobachter je ein inkonsistentes Cert/Key-Paar oder ein „halbes File" sehen. Das ist die **stärkste**
mögliche Absicherung gegen Hermes-Risiko 1 und deutlich robuster als ein Zwei-Datei-Swap mit frischem
Key. Key-Rotation ist ein **separates** Anliegen (bewusst NICHT in dieser Stufe); der bestehende
Reissue-Pfad rotiert den Key ohnehin, wenn ein Cert ungültig wird.

**Exakt eine Identität:** `createNodeCert` setzt **genau eine** SPIFFE-SAN (die kanonische). Das
Legacy-Cert wird nach `node.crt.legacy-premigrate.pem` **gesichert** (Archiv, KEIN live nutzbares
Cert — es steht nicht unter `node.crt.pem`). Ergebnis: ein Keypair, ein live Cert (kanonisch).

### 4. Lock + Atomarität

- **Atomarität (primär):** neues `node.crt.pem` via `*.tmp` + `fsync` + `rename` (POSIX-atomar).
  Da `node.key.pem` unverändert bleibt, ist der Paar-Zustand **immer** konsistent.
- **Lock (Serialisierung):** advisory O_EXCL-Lockfile `dataDir/tls/.migrate.lock` (mit PID + mtime).
  Verhindert, dass zwei gleichzeitige Startversuche parallel signieren/sichern (Doppel-Arbeit,
  Backup-Race). **Korrektheit hängt NICHT vom Lock ab** (die Migration ist idempotent: gleicher Key +
  gleiche kanonische SAN → gleichwertiges Cert). Unter dem Lock wird **erneut** geprüft, ob bereits
  kanonisch (Gewinner-hat-migriert) → dann nur behalten, kein zweiter Re-Sign. Stale-Lock (mtime älter
  als `staleMs`, Default 60 s → angenommen: Halter gecrasht) wird gestohlen. Timeout/Steal sind für
  Tests injizierbar.

### 5. Fail-Safety (fail-closed)

Jeder Fehler (CA signiert nicht, `tmp`-Write/`rename` scheitert, Lock nicht erreichbar) → das
**Legacy-Cert bleibt unangetastet** (es wird erst durch den atomaren Rename ersetzt, der als LETZTER
Schritt kommt; davor liegt nur ein `.tmp`), das Lock wird freigegeben, und eine strukturierte Diagnose
wird geloggt (`migration failed …`), sodass der Neustart-Wächter es sieht. Der Daemon fällt in diesem
Fall auf das (unveränderte) Legacy-Cert zurück — kein Boot-Crash, kein halber Zustand.

### 6. Logging (strukturiertes JSON)

`legacy cert detected — migration mode active`, `migrating identity` (SPIFFE before/after),
`migration lock acquired/released`, `canonical cert installed (atomic rename)`, `legacy cert archived`.

## Review-Nachträge (CR, 2026-07-06)

- **LOW-1:** Nach dem `rename` wird das **Verzeichnis** ge-`fsync`t (Crash-Durabilität des Dir-Entrys);
  fehlender Dir-fsync wäre fail-safe (Rückfall auf Legacy-Cert, passt zum unveränderten Key), aber wir
  wollen den Rename halten. „Atomar" gilt für **Leser** (kein Torn-Read); die Durabilität sichert der
  Dir-fsync.
- **LOW-2:** Ein **nicht-EEXIST**-Fehler beim Lock-Open (EACCES/ENOSPC/ENOTDIR …) gibt jetzt `null`
  zurück (= Lock nicht erlangbar → fail-closed, Legacy bleibt) statt zu werfen — sonst liefe ein Throw
  in den äußeren „unlesbar → reissue"-Pfad und würde fälschlich **re-keyen** statt behalten.
- **NIT-2:** Die Migration frischt als Nebeneffekt die **Restlaufzeit** auf (neues `notAfter` aus
  `createNodeCert`) — beabsichtigt/nützlich; die Stufe ignoriert `renewBeforeDays` (Identitäts-Flip
  hat Vorrang vor der reinen Ablauf-Schwelle).

## Konsequenzen

- **+** `.52`/`.55` können im Re-Enroll-Fenster **kontrolliert** auf die kanonische Identität wechseln,
  ohne externen Attesting-CA-Schritt, ohne je zwei parallele Identitäten.
- **+** Torn-Pair-/„halbes File"-Race **strukturell ausgeschlossen** (Key-Reuse → Einzeldatei-Swap).
- **+** Default-AUS → kein Quiet-Break für `.52`/`.55` im Jetzt (Regression bitidentisch).
- **0** Kein Timer, kein Roll-out, keine Live-Aktion in diesem Slice — nur Code + Tests + Doku.
- **−** Key-Rotation ist NICHT Teil dieser Stufe (bewusst; eigenes Anliegen). Token-onboardete
  Legacy-Nodes müssen re-onboarden (können sich nicht selbst migrieren) — dokumentiert + geloggt.

## Grenzen (nicht in diesem Slice)

Kein Enddatum-Setzen für Legacy-Akzeptanz (das ist §3.4-Betrieb), kein `.52`/`.55`-Live-Rollout, kein
Timer. Nur die Stufe + Tests + ADR/Doku.
