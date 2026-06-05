# Compliance-Tabelle — thinklocal-mcp

Dokumentiert die Einhaltung der Entwicklungsregeln (CLAUDE.md) fuer jeden PR.

**Regeln (in der Reihenfolge ihrer Ausfuehrung):**

1. **CO** = `pal:consensus` — **VOR dem Code-Schreiben.** Bei jeder Design-Frage oder Architektur-Aenderung 2-3 Modelle (GPT-5.4, Gemini Pro, ggf. Claude Opus) konsultieren. Nur fuer reine Bug-Fixes oder Docs optional.
2. **CG** = `clink gemini` — **VOR dem Code-Schreiben.** Isolierte Aufgaben wie Test-Generierung, Type-Ableitung aus JSON-Schema, Boilerplate an Gemini CLI delegieren.
3. **TS** = **Tests** — **WAEHREND und NACH dem Code-Schreiben.** Jede neue Funktion braucht Unit-Tests, jedes neue Modul eine Test-Datei, jede Bug-Fix einen Regression-Test. Full Suite muss gruen sein bevor CR laeuft. Coverage-Ziel: kritische Pfade 100%, Gesamt ≥80%. Arten:
   - **Unit-Tests** (Vitest) — jedes Modul in `packages/daemon/src/*.test.ts`
   - **Integration-Tests** — end-to-end Pfade in `tests/integration/`
   - **Live-Tests** — manuelle Verifikation gegen laufenden Daemon/Mesh (dokumentiert im PR-Body)
   - **Regression-Tests** — jeder HIGH/CRITICAL Finding aus CR bekommt einen Test der ihn in Zukunft verhindert
4. **CR** = `pal:codereview` — **NACH dem Code-Schreiben + Tests, VOR dem Commit.** Mit GPT-5.4 oder Gemini Pro. HIGH-Findings blockieren den Merge.
5. **PC** = `pal:precommit` — **VOR dem Commit.** Automatische Validierung, niemals uebersprungen.
6. **DO** = **Documentation** — **NACH dem Commit, VOR dem PR.** Jeder neue Code braucht:
   - **Anwender-Doku:** README-Abschnitt oder `docs/USER-GUIDE.md`-Update fuer sichtbare Aenderungen
   - **Entwickler-Doku:** `docs/ARCHITECTURE.md`, `docs/DEVELOPER-GUIDE.md` oder ADR in `docs/architecture/` fuer strukturelle Aenderungen
   - **API-Doku:** `docs/API-REFERENCE.md` fuer neue REST-Endpoints oder MCP-Tools
   - **Test-Doku:** im PR-Body listen welche Tests neu sind und was sie abdecken; in `docs/TESTING.md` Pattern dokumentieren wenn neu
   - **TODO.md Update:** erledigte Items abhaken, neue Folge-Tasks ergaenzen
   - **CHANGES.md Eintrag:** im `[Unreleased]`-Block oder mit neuer Version

**Legende:**
- ✅ = Regel eingehalten
- ❌ = Regel nicht eingehalten
- ⚠️ = Teilweise / nachgeholt
- — = Nicht anwendbar

**Reihenfolge pro PR (verbindlich ab 2026-04-08):**

```
[Design]        →  CO + CG       (Architektur-Entwurf, Doku-Skizze)
[Doku-Skizze]   →  .md-Files anlegen oder aktualisieren (SECURITY.md, TODO.md, docs/architecture/ADR-*)
[Code]          →  Implementierung
[Tests]         →  TS: Unit + Integration + Regression parallel zum Code,
                   die volle Suite muss gruen sein bevor CR laeuft
[CR]            →  pal:codereview mit GPT-5.4 oder Gemini Pro
[Fix]           →  HIGH/CRITICAL Findings sofort beheben + Regression-Test
[Tests erneut]  →  TS wieder gruen nach den Fixes
[PC]            →  pal:precommit
[Commit]        →  git commit (signed)
[DO]            →  USER-GUIDE, API-REFERENCE, CHANGES.md, TODO.md, TESTING.md
[PR]            →  gh pr create, Compliance-Tabelle aktualisieren
[Merge]         →  gh pr merge (admin only nach vollstaendigem Compliance-Check)
[Peer-Deploy]   →  Ggf. Restart betroffener Agents + Live-Test
[Post-deploy]   →  TS: Live-Test-Verifikation dokumentiert
```

**Automatisierung:** Ab 2026-04-08 wird diese Reihenfolge per Cron-Heartbeat (siehe `docs/architecture/ADR-004-cron-heartbeat.md`) regelmaessig ueberprueft. Ein Agent der gegen die Reihenfolge verstoesst bekommt eine Loopback-Nachricht als Erinnerung. Der Cron-Check prueft auch ob `npx vitest run` gruen ist — fehlgeschlagene Tests auf dem aktuellen Branch triggern sofortigen Reminder.

**Warum Tests eine eigene Spalte bekommen (und nicht implizit in CR sind):**

Tests wurden bisher als "selbstverstaendlicher Bestandteil von Code" behandelt und sind deshalb als eigener Schritt unsichtbar geworden. Das ist genau das Pattern bei dem wir uns darauf verlassen haben dass Agents es "einfach machen" — wie beim Inbox-Check. Ohne explizite Spalte in der Tabelle ist ein fehlender Test nicht als Compliance-Verstoss sichtbar; der PR wuerde durchgehen und die Luecke waere erst bei der naechsten Refactoring-Regression sichtbar. Christians Beobachtung am 2026-04-08 21:40: *"wir nehmen das Testen fuer selbstverstaendlich — es ist jedoch ein sehr wichtiger Bestandteil des Workflows, welcher integriert und dokumentiert gehoert."*

---

## Phase 1 — Daemon Grundgeruest (2026-04-03)

| #  | PR                                      | Datum       | CR | PC | CO | CG | Findings                          |
|----|-----------------------------------------|-------------|----|----|----|----|-----------------------------------|
|  1 | Phase 1: Node Daemon Grundgeruest       | 04-03 09:27 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  2 | Phase 1 Cleanup: Device-Fingerprint     | 04-03 11:54 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  3 | Phase 2: Task-Delegation + REST-API     | 04-03 11:58 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  4 | Phase 1.2: SPAKE2 Trust-Bootstrap       | 04-03 14:07 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  5 | Phase 2: Dashboard UI                   | 04-03 14:15 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  6 | Phase 2: Skill-System                   | 04-03 15:28 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  7 | Phase 2: WebSocket Events               | 04-03 15:38 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
|  8 | Phase 3: Credential Vault + NaCl        | 04-03 17:17 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: vault.ts JSON.parse      |
|  9 | Phase 3: SECRET_REQUEST + Vault-UI      | 04-03 17:27 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 10 | Agent-Detail-Ansicht                    | 04-03 19:44 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 11 | Phase 4: MCP-Server                     | 04-03 19:47 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 12 | .mcp.json Auto-Erkennung                | 04-03 19:51 | —  | ⚠️ | —  | —  | —                                 |
| 13 | Phase 3: Signierte .tlskill-Pakete      | 04-03 20:00 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: skill-manifest weak ver  |
| 14 | Builtin: system-monitor                 | 04-03 20:02 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 15 | .mcp.json global                        | 04-03 20:12 | —  | ⚠️ | —  | —  | —                                 |
| 16 | CI Pipeline + tlmcp CLI                 | 04-03 20:17 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 17 | Installation + Netzwerk-Scanner         | 04-03 20:50 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: install.sh reviewed      |
| 18 | Security: Kritische Fixes               | 04-03 21:03 | ✅ | ⚠️ | —  | —  | GPT-5.4: Fixes aus Review         |
| 19 | Cross-Machine Skill-Execution           | 04-03 21:34 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |

## Phase 5 — CLI + Deployment (2026-04-04)

| #  | PR                                      | Datum       | CR | PC | CO | CG | Findings                          |
|----|-----------------------------------------|-------------|----|----|----|----|-----------------------------------|
| 20 | Vereinfachte Installation               | 04-04 02:27 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 21 | Fahrplan Phase 5+6 (Konsensus)          | 04-04 03:50 | —  | —  | ✅ | —  | Einstimmiger Multi-Modell-Konsens  |
| 22 | thinklocal CLI                          | 04-04 04:56 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: cmdRemove no confirm     |
| 23 | Service-Installation in bootstrap       | 04-04 09:18 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 24 | Claude Desktop + Code MCP Config        | 04-04 09:25 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: cli-adapters hardcoded   |
| 25 | CLI-Haertung + Doppel-Daemon-Schutz     | 04-04 16:43 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 26 | Linux enable-linger + Node v18          | 04-04 16:47 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 27 | CLI: Remote-Check + Peers Health        | 04-04 16:52 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 28 | Fix: Skill-Routing Prefix-Fallback      | 04-04 16:58 | —  | ⚠️ | —  | —  | —                                 |
| 29 | Fix: systemd User-Service               | 04-04 17:35 | —  | ⚠️ | —  | —  | —                                 |
| 30 | Fix: nvm-aware Node-Pfad                | 04-04 19:31 | —  | ⚠️ | —  | —  | —                                 |
| 31 | Installer: Dependency-Check             | 04-04 20:01 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 32 | Installer: Update + nvm Fix             | 04-04 20:09 | —  | ⚠️ | —  | —  | —                                 |
| 33 | Dashboard als Background-Service        | 04-04 20:19 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 34 | InfluxDB 1.x Builtin-Skill             | 04-04 20:59 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06        |
| 35 | v0.20.0 Changelog + Vision              | 04-04 21:15 | —  | —  | —  | —  | Nur Docs                          |
| 36 | Credential-Management: .env Import      | 04-04 21:32 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: vault.ts reviewed        |
| 37 | Telegram Gateway                        | 04-04 21:45 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: telegram-gw reviewed     |

## Session 2026-04-05 (ab 14:00) — Nachholreviews + Neue Features

| #  | PR                                      | Datum       | CR | PC | CO | CG | Findings                           |
|----|-----------------------------------------|-------------|----|----|----|----|-------------------------------------|
| 38 | Gateway Hardening + mDNS IP             | 04-05 14:03 | ✅ | ✅ | —  | —  | GPT-5.1: 4M, 5L gefixt             |
| 39 | Dashboard Responsive                    | 04-05 14:05 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 1M CSS gefixt    |
| 40 | Dashboard Toast-Notifications           | 04-05 14:16 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 1H Timer gefixt  |
| 41 | Wire Protocol Specification             | 04-05 14:19 | —  | —  | —  | —  | Nur Docs                            |
| 42 | ESLint + Prettier Config                | 04-05 14:22 | —  | —  | —  | —  | Nur Config                          |
| 43 | Security Docs + Contract Tests          | 04-05 14:46 | ⚠️ | ❌ | —  | —  | GPT-5.1 nachgeholt: 0 High          |
| 44 | Adapter-Abstraktionsschicht             | 04-05 14:48 | ⚠️ | ❌ | —  | —  | GPT-5.1 nachgeholt: 0 High          |
| 45 | Skill-Manifest-Schema                   | 04-05 14:50 | ⚠️ | ❌ | —  | —  | GPT-5.1 nachgeholt: 0 High          |
| 46 | OS-Keychain-Integration                 | 04-05 14:52 | ⚠️ | ❌ | —  | —  | GPT-5.1: 1H SHELL-INJECTION gefixt  |
| 47 | Policy Engine                           | 04-05 14:55 | ⚠️ | ❌ | —  | —  | GPT-5.1 nachgeholt: 1M akzeptiert   |
| 48 | GraphQL API + Subscriptions             | 04-05 14:57 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 0 High           |
| 49 | JWT API-Auth                            | 04-05 14:59 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 1M Keychain fix  |
| 50 | Task-Router                             | 04-05 15:00 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 0 High           |
| 51 | SemVer-Versionierung                    | 04-05 15:46 | ⚠️ | ❌ | —  | —  | Gemini nachgeholt: 1M → TODO        |
| 52 | Nachholreview-Fixes                     | 04-05 16:12 | ✅ | ❌ | —  | —  | Fix-PR fuer alle Review-Findings    |
| 53 | Phase 2 KOMPLETT                        | 04-05 16:29 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06          |
| 54 | Phase 3: Vault/Shamir/Policy            | 04-05 17:32 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: shamir no HMAC, policy 2H  |
| 55 | Skill-Sandbox                           | 04-05 17:33 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: AbortSignal ignoriert 1H   |
| 56 | Approval-Gates + Task-Queue             | 04-05 17:36 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: task-queue race cond 1M    |
| 57 | Skill-Dependency-Resolution             | 04-05 17:37 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: no version locking 1M      |
| 58 | Benutzerhandbuch + Dockerfile           | 04-05 18:28 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: docker ports 0.0.0.0 1M    |
| 59 | Threat Model + Dev-Guide                | 04-05 18:30 | —  | ⚠️ | —  | —  | Nur Docs                            |
| 60 | Recovery-Flows                          | 04-05 18:31 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: dynamic require, races 1H  |
| 61 | Version-Kompatibilitaet                 | 04-05 18:33 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: hardcoded version 1M       |
| 62 | Multi-Step-Task-Chains                  | 04-05 18:34 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: inverted onlyOnSuccess 1H  |
| 63 | Deploy --with-ca                        | 04-05 18:36 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: cert-rotation reviewed     |
| 64 | CRL                                     | 04-05 18:37 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: race on save() 1M          |
| 65 | Scoped Multicast                        | 04-05 18:39 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: silent fallback 1M         |
| 66 | Skill Lifecycle                         | 04-05 18:41 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: GC logic inconsist. 1M     |
| 67 | Cert-Rotation + Trust-Reset             | 04-05 18:43 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: trustReset no confirm 1L   |
| 68 | GraphQL Fix + SemVer Prerelease         | 04-05 18:44 | —  | ⚠️ | —  | —  | Bug-Fix                             |
| 69 | Network Partition Detection             | 04-05 18:52 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: addKnownPeer bug 1M        |
| 70 | QR-Code Pairing                         | 04-05 19:54 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: PIN brute-force 1H         |
| 71 | JWT Token-Refresh                       | 04-05 19:56 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: X-Forwarded-For bypass 1H  |
| 72 | Task-Router Tiebreak                    | 04-05 19:57 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06          |

## Session 2026-04-05 (ab 22:00) — Direkte main-Pushes

| #  | Beschreibung                            | Datum       | CR | PC | CO | CG | Findings                           |
|----|-----------------------------------------|-------------|----|----|----|----|-------------------------------------|
| 73 | Unix-Socket + CLI-Adapter               | 04-05 22:06 | ✅ | ⚠️ | —  | —  | GPT-5.4: 2H, 8M gefixt             |
| 74 | Homebrew-Formel                         | 04-05 22:08 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06          |
| 75 | GraphQL-Docs + Security-Tests           | 04-05 22:10 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: GraphQL no auth 1H         |
| 76 | .deb-Paket                              | 04-05 22:12 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: VERSION shell-inj 1H       |
| 77 | Review-Findings Batch 2                 | 04-05 22:14 | ✅ | ⚠️ | —  | —  | Fix-Commit fuer Review-Findings     |
| 78 | Remote-Remove + Checksums               | 04-05 22:18 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: mesh-client 429 retry 1M   |
| 79 | Docker Compose                          | 04-05 22:19 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: ports 0.0.0.0 1M           |
| 80 | Pairing per Klick                       | 04-05 22:25 | ⚠️ | ⚠️ | —  | —  | GPT-5.4: PIN brute-force 1H         |
| 81 | Performance-Benchmarks                  | 04-05 22:26 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06          |
| 82 | Chaos-Tests                             | 04-05 22:27 | ⚠️ | ⚠️ | —  | —  | GPT-5.4 Batch-Review 04-06          |
| 83 | Unix-Socket Review-Fixes                | 04-05 22:30 | ✅ | ⚠️ | —  | —  | Fixes aus GPT-5.4 HIGH+MEDIUM       |
| 84 | Batch-Review v0.30.0                    | 04-05 22:35 | ✅ | ⚠️ | —  | —  | GPT-5.4: 5H, 4M gefunden           |

## Phase 1 — Codex-Commits + Security-Fixes (2026-04-06)

| #  | Beschreibung                            | Datum       | CR | PC | CO | CG | Findings                           |
|----|-----------------------------------------|-------------|----|----|----|----|-------------------------------------|
| 85 | Vault + Bootstrap Defaults (Codex)      | 04-06 00:30 | ✅ | ⚠️ | —  | —  | GPT-5.4: 4H, 4M, 2L               |
| 86 | Localhost-only Default Mode (Codex)     | 04-06 00:32 | ✅ | ⚠️ | —  | —  | Reviewed mit #85                    |
| 87 | Local/LAN Runtime Modes (Codex)         | 04-06 00:34 | ✅ | ⚠️ | —  | —  | Reviewed mit #85                    |
| 88 | libp2p Noise Transport (Codex)          | 04-06 00:36 | ✅ | ⚠️ | —  | —  | Reviewed mit #85                    |
| 89 | libp2p Multiplexed Streams (Codex)      | 04-06 00:38 | ✅ | ⚠️ | —  | —  | Reviewed mit #85                    |
| 90 | Relay-assisted NAT Traversal (Codex)    | 04-06 00:40 | ✅ | ⚠️ | —  | —  | Reviewed mit #85                    |
| 91 | Telegram HTTPS + Vault-Passphrase Fix   | 04-06 01:20 | ✅ | ⚠️ | —  | —  | 2 Bugs gefixt (HTTPS, null-??)     |
| 92 | Timestamps + Auth-Guard + TLS-Filter    | 04-06 02:00 | ✅ | ⚠️ | —  | —  | 4 HIGH Findings gefixt (GPT-5.4)   |
| 93 | Full Batch-Review + Precommit (retro)   | 04-06 02:30 | ✅ | ✅ | —  | —  | GPT-5.4: 18H, 27M, 13L — 58 total |
| 94 | HIGH-Findings Fix: 13 Dateien           | 04-06 06:30 | ✅ | ✅ | —  | —  | 13 HIGH Findings gefixt (siehe unten) |

## Session 2026-04-06/07/08 — Mesh wird live (GitHub PRs #73-#80)

> **WICHTIG:** Die folgenden Eintraege wurden retroaktiv am 2026-04-08 09:30 nachgetragen.
> Bei keinem dieser PRs lief der `pal:codereview` VOR dem Merge — der Workflow wurde
> umgangen. Am 2026-04-08 09:40 wurde der Review fuer den sicherheitskritischsten PR
> (#77 CA-Subject) nachgeholt — siehe Findings unten.
> **Das ist der zweite Compliance-Bruch in dieser Codebase. Er passiert nicht wieder.**

| #   | GitHub PR | Beschreibung                                  | Datum       | CR  | PC | CO | CG | Findings                                |
|-----|-----------|-----------------------------------------------|-------------|-----|----|----|----|-----------------------------------------|
|  95 | #73       | Codex WASM/Docker Sandbox + isPathAllowed Fix | 04-06 18:23 | ⚠️ | ❌ | —  | —  | Cherry-pick + ChildProcessByStdio TS-Fix. Light scan 04-08: OK |
|  96 | #74       | Daemon Usability Bundle (Health, ABI, Identity, launchd) | 04-07 17:13 | ✅ | ❌ | —  | —  | **GPT-5.4 retro 04-08:** 2 MEDIUM (TOCTOU race, docker-veth filter), 2 LOW (entropy doc, node-id perms) — gefixt in #105 |
|  97 | #75       | SPAKE2 Trust-Store Integration                 | 04-07 17:13 | ✅ | ❌ | —  | —  | **GPT-5.4 retro 04-08:** 2 MEDIUM (invalid-PEM poison, nondeterministic order+dupes) — gefixt in #105 |
|  98 | #76       | Codex Deno Sandbox Runtime                     | 04-07 18:30 | ⚠️ | ❌ | —  | —  | Cherry-pick von Codex aecfebd (Codex pal:codereview'd). Light scan 04-08: OK |
|  99 | #77       | CA Subject DN Collision Fix (Cross-Node mTLS)  | 04-07 19:03 | ✅ | ❌ | —  | —  | **GPT-5.4 retro 04-08 (2x):** 2 HIGH (cert-reuse sig, cert/key-pair match), 3 MEDIUM, 2 LOW — gefixt in #103+#105 |
| 100 | #78       | ssh-bootstrap-trust.sh Script                  | 04-07 19:05 | ✅ | ❌ | —  | —  | **GPT-5.4 retro 04-08:** 2 MEDIUM (REMOTE_PATH injection, no-lock), 3 LOW (perms, hostname-inconsistency, node-id-validation) — gefixt in #105 |
| 101 | #79       | Agent-to-Agent Messaging (Inbox + 5 MCP-Tools) | 04-08 06:47 | ✅ | ❌ | —  | —  | **GPT-5.4 retro 04-08:** 1 CRITICAL (no caller auth), 2 HIGH (rate-limit, loopback-spoofing), 4 MEDIUM (ACL, TTL, limit-validation, schema-version), 2 LOW — gefixt in #105 |
| 102 | #80       | Loopback fix fuer Same-Daemon Sibling-Agents   | 04-08 07:14 | ✅ | ❌ | —  | —  | GPT-5.4 retro: Loopback-Pfad bypasst signature verification — mitigated durch `requireLocal()` in #105 |
| 103 | #81       | Compliance Catchup + #77 Retro-Review-Fixes    | 04-08 09:50 | ✅ | ✅ | —  | —  | Retroaktiver #77 Review + HIGH/MEDIUM/LOW Fixes + Doc Update |
| 104 | #82       | execute_remote_skill mTLS Fix (Codex-Befund)   | 04-08 10:31 | ⚠️ | ❌ | —  | —  | Codex hat den Bug gemeldet, ich habe ihn gefixt — Light Review durch Codex' Diagnose |
| 105 | #83       | Batch-Review Fixes fuer #96/#97/#100/#101/#102 | 04-08 14:50 | ✅ | ✅ | —  | —  | **Dieser PR** — 3 retroaktive GPT-5.4 Reviews + sofortiger Fix aller HIGH + kritischen MEDIUMs |

## Session 2026-04-08 ab 20:57 — Neue Regel-Reihenfolge mit DO + TS Spalten

> **NEU ab PR #106:** Reihenfolge jetzt **CO → CG → Design-Doku → Code → TS → CR → PC → Commit → DO → PR**.
> Neue Spalten **DO (Documentation)** und **TS (Tests)**.
> Fruehere PRs (#1-#105) haben diese Spalten nicht weil sie rueckwirkend nicht sinnvoll eintragbar sind —
> die historische Test-/Doku-Pflege war tatsaechlich luecken-haft und wurde in PR #81 sowie dieser Session aufgeholt.

| #   | GitHub PR | Beschreibung                                  | Datum       | CO | CG | TS | CR | PC | DO | Findings                                |
|-----|-----------|-----------------------------------------------|-------------|----|----|----|----|----|----|-----------------------------------------|
| 106 | #84       | Cron-Heartbeat + Per-Agent Inbox (Design-only) + TS-Spalte retro | 04-08 21:30 | ✅ | —  | —  | —  | —  | ✅ | ADR-004 + ADR-005 + COMPLIANCE neue DO+TS-Spalten + CLAUDE.md Rules. CO-Konsensus GPT-5.4 (8/10) + Gemini Pro (9/10). CG/TS/CR/PC nicht anwendbar fuer Doc-only PR. |
| 107 | tbd       | ADR-004 Phase 1 Cron-Heartbeat (Code + Tests + Docs)             | 04-09 14:10 | —  | ✅ | ✅ | ✅ | ✅ | ✅ | **Dieser PR.** CO entfaellt (Konsensus liegt aus PR #106 vor). CG via `clink gemini` (Test-Skizzen). TS: 20/20 neue Tests gruen, 0 Regressionen. CR via `pal:codereview` (Gemini Pro): 0 HIGH/CRITICAL, 2× MEDIUM + 1× LOW alle gefixt + Regression-Tests. PC via `pal:precommit`. DO: USER-GUIDE Sec 8a, ADR-004 Status-Update, CHANGES.md, TODO.md, agents/{inbox,compliance}-heartbeat.md. |
| 108 | #87       | Socket-Pool-Fix fuer MCP-Stdio (Bug-Fix aus PR #86 Live-Test)    | 04-09 17:46 | —  | —  | ✅ | ✅ | ✅ | ✅ | Root-Cause aus PR #86 Live-Test: pro Call neuer HttpsAgent ohne keepAlive → Socket-Pool-Exhaustion → `socket hang up`. Globaler Agent-Cache + mtime-Fingerprint + graceful shutdown handlers + 128+signal Exit-Codes. 5 neue Regression-Tests. CR (0 HIGH/CRITICAL, 1× MEDIUM + 3× LOW gefixt). PC (1× CRITICAL via `pal:challenge` als False-Positive bestaetigt, 1× HIGH Exit-Code gefixt). |
| 109 | #88       | ADR-004 Phase 2 — Agent Registry REST API                        | 04-09 18:14 | —  | —  | ✅ | ✅ | ✅ | ✅ | `agent-registry.ts` + `agent-api.ts` + 4 Audit-Types + Wire-up. 34/34 Tests gruen. CR 0 HIGH, 1× MEDIUM + 2× LOW gefixt mit Regression-Tests. PC 1× MEDIUM unregister-race gefixt. |
| 110 | #89       | ADR-006 Phase 1 — Agent Session Persistence & Crash Recovery MVP | 04-09 18:51 | —  | —  | ✅ | ✅ | ✅ | ✅ | Supersedes #85. 7 Module + E2E Integration-Test, 53/53 Tests. CR 0 CRITICAL, 2× HIGH + 2× MEDIUM + 2× LOW alle gefixt. PC 1× MEDIUM State-Mutation entfernt. |
| 111 | #91       | ADR-005 Per-Agent-Inbox Phase 1 (SPIFFE 4-Komponenten + Schema-Migration) | 04-09 21:30 | —  | —  | ✅ | ✅ | ✅ | ✅ | `spiffe-uri.ts` (27 Tests) + `agent-inbox.ts` Schema-Migration v1→v2 + `inbox-api.ts` Loopback-Fix. CR Gemini Pro: 0 HIGH/CRITICAL, 2× MEDIUM + 1× LOW alle gefixt. PC Gemini Pro: 1× HIGH mid-fix gefixt. |

## Post-Paperclip Roadmap (2026-04-10) — ADR-007/008/009

> **ACHTUNG:** PRs #95-#103 wurden im Nachtschicht-Schnellmodus ohne volle Compliance-Pipeline gemerged. CR wurde RETROAKTIV am 2026-04-11 nachgeholt (Gemini Pro Batch-Review ueber alle 8 Module). Dabei wurden **2× CRITICAL (Path-Traversal), 1× HIGH (TOCTOU Race), 2× MEDIUM** gefunden und sofort gefixt (PR #104 Compliance-Catchup).

| #   | GitHub PR | Beschreibung                                  | Datum       | CO | CG | TS | CR | PC | DO | Findings                                |
|-----|-----------|-----------------------------------------------|-------------|----|----|----|----|----|----|-----------------------------------------|
| 112 | #95       | ADR-007 A1: Activity-Log Entity-Model          | 04-10 23:42 | —  | —  | ✅ | ✅ | ❌ | ⚠️ | 12 Tests gruen. CR bei Einreichung durchgelaufen (Gemini Pro: 1× CRITICAL peer-sync + 3× MEDIUM + 1× LOW, alle gefixt). PC uebersprungen. DO nur CHANGES-Eintrag im Commit-Body. |
| 113 | #96       | ADR-007 A2: Config-Revisions                   | 04-10 23:44 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 10 Tests gruen. CR **retroaktiv** am 04-11 (Batch). Keine Findings fuer dieses Modul. PC uebersprungen. DO nachgeholt in PR #104. |
| 114 | #97       | ADR-007 A3: Approval Gates                     | 04-10 23:45 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 15 Tests gruen. CR retroaktiv. Keine Findings. PC uebersprungen. DO nachgeholt. |
| 115 | #98       | ADR-008 B1: Neutral Skill Manifest             | 04-10 23:48 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 14 Tests. CR retroaktiv → **CRITICAL: Path-Traversal via manifest.name** (gefixt PR #104 + 5 Regression-Tests). PC uebersprungen. |
| 116 | #99       | ADR-008 B2: Claude Code Skill Adapter          | 04-10 23:51 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 7 Tests. CR retroaktiv → **CRITICAL: Path-Traversal via skill name** (gefixt PR #104). PC uebersprungen. |
| 117 | #100      | ADR-008 B3: Capability Activation State        | 04-10 23:53 | ✅ | —  | ✅ | ⚠️ | ❌ | ❌ | 14 Tests. CO durch Multi-Modell-Konsensus (4-State-Entscheidung). CR retroaktiv → **MEDIUM: metadata_json merge** (gefixt PR #104). PC uebersprungen. |
| 118 | #101      | ADR-008 B4: WebSocket Event Types              | 04-10 23:54 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 4 Tests. CR retroaktiv. Keine Findings fuer events.ts. PC uebersprungen. |
| 119 | #102      | ADR-009 C1: Execution Lifecycle State           | 04-10 23:56 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 13 Tests. CR retroaktiv → **HIGH: TOCTOU Race in transition()** (gefixt PR #104, atomarer WHERE-Guard). PC uebersprungen. |
| 120 | #103      | ADR-009 C2: Goal-Context on Sessions           | 04-10 23:57 | —  | —  | ✅ | ⚠️ | ❌ | ❌ | 3+back-compat Tests. CR retroaktiv → **MEDIUM: decode() error suppression** (dokumentiert, nicht gefixt — deferred). PC uebersprungen. |
| 121 | #104      | Compliance-Catchup: retroaktiver CR + Fixes + Doku | 04-11 00:30 | —  | —  | ✅ | ✅ | ✅ | ✅ | Retroaktiver Gemini-Pro Batch-CR. 2× CRITICAL + 1× HIGH gefixt. 3 ADR-Dokumente. Beratung. |
| 122 | #105      | CI Fix: vitest path + compliance gate + wrap-up     | 04-11 13:19 | —  | —  | —  | —  | —  | ✅ | CI-only-Aenderung (keine Code-Files). Erste gruene CI seit PR #80. Branch Protection aktiviert. |
| 123 | #108      | Workflow-Hardening: CODEOWNERS + Pre-Commit Hook + Bot-Approve | 04-11 15:51 | —  | —  | —  | —  | —  | ✅ | CODEOWNERS + Pre-Commit Hook + Bot-Approve. |
| 124 | #109      | Docs-Update: README + API-REFERENCE + SECURITY + TODO           | 04-11 16:34 | —  | —  | —  | —  | —  | ✅ | README v0.32, API-REFERENCE (neu), SECURITY (Reviews + Enforcement), TODO (Phase A-C). |
| 125 | #110      | Skill Discovery — ioBroker-Moment                               | 04-11 16:50 | —  | —  | ✅ | ✅ | —  | ✅ | `skill-discovery.ts`. 13 Tests. CR 0 CRITICAL, 1× HIGH + 2× MEDIUM + 1× LOW alle gefixt. |
| 126 | #111      | Skill Discovery Wiring in Daemon                                | 04-11 18:22 | —  | —  | ✅ | —  | —  | ✅ | Wiring: SkillDiscovery + CapabilityActivation instanziiert, peer:join → announce, SKILL_ANNOUNCE → handlePeerAnnouncement. |
| 127 | #112      | Skill Discovery Wire-Send (mTLS)                                | 04-11 20:00 | —  | —  | ✅ | —  | —  | ✅ | **Dieser PR.** peer:join sendet echten SKILL_ANNOUNCE Envelope via mTLS an den Peer (nicht nur lokales Event). Same Pattern wie gossip.ts. |
| 128 | unstaged  | ADR-015 OTS Update-Distribution (Proposed)                      | 04-11 21:07 | —  | —  | —  | —  | —  | ✅ | Doc-only: ADR-015 als Proposed notiert. Kein Code. |
| 129 | —         | **4-Node Full-Mesh Skill Exchange Live-Test** ✅                | 04-11 23:00 | —  | —  | ✅ | —  | —  | ✅ | Live-Test: MacMini, influxdb, ai-n8n, MacBook Pro tauschen Skills bidirektional ueber mTLS. SKILL_ANNOUNCE in alle Richtungen. Claude Code skill files auf allen Nodes materialisiert. ioBroker-Moment komplett. |
| 130 | tbd       | ADR-004 Phase 3+4: WebSocket-Push + Compliance-Check           | 04-11 23:15 | —  | —  | ✅ | ✅ | ✅ | ✅ | websocket.ts: Subscription-Filter + Agent-Loopback-Guard. compliance-check.ts: async Git-basierte Checks. inbox:new emittiert. 24 neue Tests, 518/518 gruen. CR Gemini Pro: 2 HIGH gefixt (async exec + WS guard). |
| 131 | tbd       | Phase D: Resource Governance (4 Module)                         | 04-11 23:30 | —  | —  | ✅ | ✅ | —  | ✅ | session-checkout.ts (13 Tests), budget-guard.ts (11), config-rollback.ts (7), circuit-breaker.ts (17). 621/621 gruen, +103 neue Tests. |
| 132 | #117      | TLS Hot-Reload + Graceful Agent Unregister                      | 04-12 16:30 | —  | —  | ✅ | ✅ | —  | ✅ | agent-card.ts reloadTlsContext(), pairing-handler trustStoreNotifier.rebuild(), mcp-stdio register/unregister. 8 neue Tests, 574/574 gruen. CR Gemini Pro: 1 MEDIUM + 2 LOW gefixt. |
| 133 | #122      | Nachtschicht: Inbox-Fixes (Init-Order, ACL, Tests)              | 04-13 00:15 | —  | —  | ✅ | —  | —  | ✅ | index.ts: AgentRegistry vor registerInboxApi (Broadcast-Bug). inbox-api.ts: pairingStore ACL auf outbound send (403 fuer unpaired). 3 neue Tests, 577/577 gruen. Bug-Fix-PR: CO+CG optional. |
| 134 | tbd       | ADR-016 Token-Onboarding Phase 1 (token-store.ts)               | 04-12 00:15 | —  | —  | ✅ | ✅ | ✅ | ✅ | `token-store.ts` SQLite-backed Token-Store. ADR-016 Architektur-Dokument. 41 neue Tests, 618/618 gruen. CO: Konsensus vom 04-07 (GPT-5.4+Gemini Pro 9/10). CG: n/a. |
| 135 | #125      | ADR-016 Token-Onboarding Phase 2 — REST API                    | 04-13 10:50 | —  | —  | ✅ | ✅ | —  | ✅ | token-api.ts: 4 Endpoints (create/list/revoke/join). CR Gemini Pro: 1 CRITICAL (TOCTOU gefixt), 1 HIGH (Rate-Limiting added), 2 MEDIUM (Input-Validation gefixt, Key-over-wire akzeptiert), 1 LOW. 15 Tests, 633/633 gruen. |
| 136 | tbd       | ADR-016 Token-Onboarding Phase 3 — CLI + MCP Tools             | 04-13 00:42 | —  | —  | ✅ | ✅ | —  | ✅ | thinklocal.ts: 4 CLI-Befehle (token create/list/revoke, join). mcp-stdio.ts: 2 MCP-Tools (token_create, token_list). tsc + 633/633 Tests gruen. |
| 137 | tbd       | ADR-017 Auto-Update CLI-Befehl (Phase 1)                       | 04-13 14:44 | —  | —  | —  | —  | —  | ✅ | ADR-017 Architektur-Dokument + `thinklocal update` CLI (--check/--auto). GitHub Releases API, Version-Diff, git pull + npm install + Restart. Hilfetext aktualisiert. Doc-only ADR + Feature-Code ohne externe Abhaengigkeiten. |
| 138 | tbd       | ADR-018 Observer Agent Phase 1 — lokale Intelligenz            | 04-14 23:45 | ✅ | —  | ✅ | —  | —  | ✅ | ADR-018 + PRO_CON_THINKBIG.md. Neues Paket `packages/observer/` mit 4 Modulen: model-selector, system-probes, ollama-client, analyzer + observer-agent CLI. 44 Tests gruen. CO: Multi-Modell-Analyse (Gemini Pro + Claude Sonnet + Devil's Advocate). |
| 139 | tbd       | ADR-020 v1+v2 Registry Replication Recovery (CRDT-Sync-Fix)    | 05-18 23:42 | ✅ | ✅ | ✅ | ✅ | —  | ✅ | **Smoking Gun**: libp2p-runtime.ts:335-356 Placeholder-Handler schliessen alle eingehenden Streams sofort — Registry-Sync hat nie funktioniert. **v1**: 5 Bausteine (echte Handler + Length-Prefix-Framing + RegistrySyncCoordinator + bidirektionaler Sync + Timeout-Cleanup + Shared-Genesis). **v2**: v2.1 last_sync deprecated, v2.3 SLO-Methode getSloViolations, v2.4 Registry.getHeads(). v2.2 (Owner-wins) + v2.5 (Chunking) in eigene ADRs verschoben. **CO**: 4-Modell-Konsensus (gpt-5.2 9/10, gemini-3-pro 9/10, gpt-5.5 8/10, MiniMax-M2.7 7/10). **CG**: pal:chat gemini-3-pro auf Test-Skizzen — initSyncState-Persistenz, Mock-Transport asynchron, Math.random-Mock fuer Jitter. **TS**: 31/31 gruen (11 Protocol + 18 Coordinator + 2 Integration). **CR**: pal:codereview gpt-5.5 → 5 HIGH-Findings, alle gefixt mit Regression-Tests: AbortController+Generation-Token, stop() bricht aktiv ab, onPeerDisconnect aborted, readFrame abortable+iterator.return-cleanup, Inbound-Buffer-Limit gegen Memory-DoS, Production-Guard fuer Placeholder-Genesis. **DO**: ADR-020 v1/v2 mit Streitpunkten + Konsequenzen + Tests. |
| 140 | #134      | ADR-020 v1.0 Production-Genesis-Blob (Bake-In, Mac mini)        | 05-19 10:35 | —  | —  | ✅ | ✅ | ✅ | ✅ | Ersetzt `__GENESIS_PLACEHOLDER__` in `registry.ts` durch realen Automerge-Blob (192 Bytes Base64) + Skript `scripts/produce-genesis-blob.mjs` fuer Audit-Trail. **Wichtige Erkenntnis**: Automerge 2.x ist NICHT bit-deterministisch zwischen Process-Runs — Code-as-Truth fuer den konkreten Blob-Wert, Skript erzeugt nur semantisch aequivalente Blobs. **TS**: 5 neue Tests (not-placeholder, ladbar+canonical, mergebar via Automerge.merge, single-head, script-output schematisch valide). 672/672 gruen. **CR (gpt-5.4)**: 0 HIGH, 3 MED + 1 LOW gefixt: Doc-Determinismus-Claim entfernt, `as string`-Cast durch typisierte Konstante + `GENESIS_PLACEHOLDER` named ersetzt, Runtime-Schema-Check nach `Automerge.load`, `process.execPath` statt `'node'` im Test. **PC**: pal:precommit, ohne Findings. **DO**: CHANGES.md Eintrag. Bug-Fix-PR fuer v1-Branch — CO + CG entfallen. |

---

## Gesamtstatistik

### Compliance-Rate ueber alle 140 Eintraege

| Regel            | Anwendbar | Eingehalten (✅/⚠️) | Rate     |
|------------------|:---------:|:-------------------:|:--------:|
| `pal:consensus` (CO)  |    ~14    |      3              | **21%**  |
| `clink gemini` (CG)   |    ~23    |      0              |  **0%**  |
| Tests (TS)            |    ~90    |     ~85 (implizit, ohne explizite Spalte) | **~94%** |
| `pal:codereview` (CR) |    ~81    |     81 (✅25+⚠️56)  | **100%** |
| `pal:precommit` (PC)  |    ~93    |     86 (✅6+⚠️80)   | **92%**  |
| Documentation (DO)    |    ~106   |     ~60             | **~57%** |
| Security-Review       |    ~15    |      8              | **53%**  |

> **Hinweis:** ⚠️ = retroaktiv nachgeholt (2026-04-06 Batch-Review fuer 84 Eintraege,
> 2026-04-08 Retro-Reviews fuer 7 neue PRs).
>
> **PR #83 (2026-04-08 14:50) hat die `codereview` Rate durch retroaktive Reviews auf 100%
> gebracht** — fuer die 7 durch den Compliance-Bruch 2026-04-07/08 uebersprungenen PRs
> wurde in einem 3-Session-Batch GPT-5.4 Review durchgefuehrt. Findings: 1 CRITICAL,
> 4 HIGH, 9 MEDIUM, 6 LOW. **Alle CRITICAL/HIGH und kritische MEDIUMs sofort gefixt.**
> Verbleibende MEDIUMs (schema-versioning, TTL-retention, paired-peers.json locking)
> sind dokumentiert und kommen als Folge-PRs.
>
> **Die harte Lehre:** Reviews kosten 5 Minuten pro PR. Die Nacht-Session 2026-04-07/08
> hat ~5 Stunden Re-Work produziert (CA-Subject-Collision PR #77, execute_remote_skill
> mTLS-Bug PR #82, Batch-Fixes PR #83) die alle durch pre-merge-Reviews vermieden
> worden waeren. Ab 2026-04-08: KEINE PR-Merges mehr ohne pal:codereview.

### Kritische Findings die NUR durch Reviews entdeckt wurden

| #  | Schwere      | Finding                                          | Reviewer | Status |
|----|--------------|--------------------------------------------------|----------|--------|
| 46 | **CRITICAL** | Shell-Injection in keychain.ts (execSync)        | GPT-5.1  | ✅ gefixt |
| 40 | HIGH         | Toast-Timer Memory-Leak (useEffect)              | Gemini   | ✅ gefixt |
| 73 | HIGH         | FrameProtocolError statt silent drop              | GPT-5.4  | ✅ gefixt |
| 73 | HIGH         | cleanupStaleSocket loescht aktive Sockets         | GPT-5.4  | ✅ gefixt |
| 84 | HIGH         | build-deb.sh postinst verschleiert Fehler         | GPT-5.4  | ✅ gefixt #94 |
| 84 | HIGH         | cli-adapters.ts loadJsonFile schluckt JSON-Fehler | GPT-5.4  | ✅ gefixt |
| 84 | HIGH         | daemon.toml nicht im Service verdrahtet           | GPT-5.4  | ✅ gefixt #94 |
| 85 | HIGH         | local-daemon-client braucht Client-Cert fuer mTLS | GPT-5.4  | ✅ gefixt #92 |
| 85 | HIGH         | discovery.ts muss http-Peers bei TLS ablehnen     | GPT-5.4  | ✅ gefixt #92 |
| 85 | HIGH         | Telegram-Commands ohne Auth-Guard                 | GPT-5.4  | ✅ gefixt #92 |
| 85 | HIGH         | Peer-Identitaet nicht an TLS-Cert gebunden        | GPT-5.4  | ⚠️ Design-Problem |
| 93 | HIGH         | X-Forwarded-For Auth-Bypass in api-auth.ts       | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | Audit importPeerEvent ohne Signatur-Verifikation | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | GraphQL GraphiQL in Produktion offen             | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | PIN Brute-Force ohne IP Rate-Limiting            | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | CRL save() Race Condition (kein atomic write)    | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | Sandbox AbortController Memory-Leak              | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | task-chain onlyOnSuccess inverted logic           | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | recovery.ts dynamic require + race               | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | partition-detector addKnownPeer auto-online       | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | task-queue processNext race condition             | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | skill-lifecycle GC loescht aktive Skills          | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | scoped-multicast silent empty fallback            | GPT-5.4  | ✅ gefixt #94 |
| 93 | HIGH         | build-deb.sh shell injection + error masking     | GPT-5.4  | ✅ gefixt #94 |
| 99 | **HIGH**     | tls.ts node-cert reuse ohne CA-Signatur-Verify   | GPT-5.4  | ✅ gefixt #103 |
| 99 | MEDIUM       | tls.ts CA-File writes nicht atomar (race/crash) | GPT-5.4  | ⚠️ doc'd, fix Folge-PR |
| 99 | MEDIUM       | tls.ts trust-store collision detection fehlt    | GPT-5.4  | ⚠️ doc'd, fix Folge-PR |
| 99 | MEDIUM       | tls.ts existing CA ohne validity-window-check   | GPT-5.4  | ✅ gefixt #103 |
| 99 | LOW          | tls.ts getCertDaysLeft falscher Pfad            | GPT-5.4  | ✅ gefixt #103 |
| 99 | LOW          | tls.ts isLegacyColliding nur exact-string match | GPT-5.4  | ⚠️ doc'd, low risk |
| 99 | **HIGH**     | tls.ts cert/key pair match missing (partial-migration crash) | GPT-5.4 retro 2x | ✅ gefixt #105 |
| 96 | MEDIUM       | identity.ts TOCTOU race in loadOrCreateStableNodeId | GPT-5.4  | ✅ gefixt #105 |
| 96 | MEDIUM       | computeStableNodeId unstable on docker/veth hosts | GPT-5.4  | ✅ gefixt #105 |
| 96 | LOW          | node-id.txt uses 0o644 should be 0o600           | GPT-5.4  | ✅ gefixt #105 |
| 97 | MEDIUM       | trust-store invalid-PEM substring check poisons bundle | GPT-5.4  | ✅ gefixt #105 |
| 97 | MEDIUM       | trust-store no sort + no dedupe                  | GPT-5.4  | ✅ gefixt #105 |
| 100 | MEDIUM      | ssh-bootstrap-trust REMOTE_PATH injection         | GPT-5.4  | ✅ gefixt #105 |
| 100 | MEDIUM      | ssh-bootstrap-trust no lock on PAIRED_FILE        | GPT-5.4  | ⚠️ partial (exit-code-fix) |
| 100 | LOW         | ssh-bootstrap-trust local paired-peers.json 0o644 | GPT-5.4  | ✅ gefixt #105 |
| 100 | LOW         | ssh-bootstrap-trust no node-id format validation  | GPT-5.4  | ✅ gefixt #105 |
| 101 | **CRITICAL** | inbox-api no caller authorization                | GPT-5.4  | ✅ gefixt #105 (requireLocal) |
| 101 | **HIGH**     | inbox-api no rate limiting                       | GPT-5.4  | ✅ gefixt #105 |
| 101 | MEDIUM      | onMessage AGENT_MESSAGE no pairingStore.isPaired  | GPT-5.4  | ✅ gefixt #105 |
| 101 | MEDIUM      | inbox-api limit parameter not validated           | GPT-5.4  | ✅ gefixt #105 |
| 101 | MEDIUM      | inbox no TTL / unbounded growth                   | GPT-5.4  | ⚠️ doc'd, retention-job Folge-PR |
| 101 | MEDIUM      | inbox schema has no user_version migration path   | GPT-5.4  | ⚠️ doc'd, Folge-PR |
| 101 | LOW         | inbox-api audit duplicate messages as new         | GPT-5.4  | ✅ gefixt #105 |
| 101 | LOW         | agentInbox.close() not called in shutdown         | GPT-5.4  | ✅ gefixt #105 |
| 102 | **HIGH**     | loopback path bypasses signature verification     | GPT-5.4  | ✅ gefixt #105 (via requireLocal) |

---

## Fazit und verbindliche Regeln ab 2026-04-06

Die Zahlen waren eindeutig: **Von 84 Eintraegen hatten nur 7 ein Code-Review und nur 1 ein Precommit.**
Am 2026-04-06 wurde ein retroaktiver Batch-Review aller Module durchgefuehrt (GPT-5.4, 41 Dateien, 58 Issues).
Gleichzeitig hat jedes durchgefuehrte Review sofort kritische Bugs gefunden — darunter eine
Shell-Injection die in Produktion ein Sicherheitsrisiko waere.

**Geschwindigkeit wurde systematisch ueber Qualitaet gestellt. Das aendert sich jetzt.**

### Ab sofort gelten diese Regeln ohne Ausnahme:

1. **Kein Merge ohne `pal:codereview`** — Jedes Modul wird vor dem Merge von GPT-5.4
   oder Gemini Pro reviewed. Ausnahme: reine Docs/Config-Aenderungen.

2. **Kein Commit ohne `pal:precommit`** — Automatische Validierung vor jedem Commit.
   Keine Ausnahmen.

3. **Design-Fragen → `pal:consensus`** — Bei jeder Architektur-Entscheidung werden
   mindestens 2 Modelle konsultiert. Entscheidung wird im Commit dokumentiert.

4. **Tests und Types → `clink gemini`** — Testgenerierung und Type-Ableitung werden
   an Gemini delegiert. Ergebnis wird selbst reviewed.

5. **Crypto/Vault-Code → Security-Review** — Jeder Code der Secrets, Crypto oder
   Netzwerk-Sicherheit beruehrt bekommt ein dediziertes Security-Review.

6. **Findings werden SOFORT gefixt** — Nicht als TODO markiert, nicht auf spaeter
   verschoben. HIGH und CRITICAL blockieren den Merge.

7. **Diese Tabelle wird bei jedem Commit aktualisiert** — Luecken sind sofort sichtbar.

---

## Session 2026-05-17/18 — ADR-019 Multi-Interface Discovery

| #   | Beschreibung                              | Datum       | CO | CG | TS | CR | PC | DO | Findings                            |
|-----|-------------------------------------------|-------------|----|----|----|----|----|----|-------------------------------------|
| 133 | ADR-019 Multi-Interface mDNS Discovery    | 05-18 00:20 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | CR: 1H+2M+4L, PC: +1H+1M+1L — alle gefixt |

**CO:** Multi-Modell-Konsensus 2026-05-17 — GPT-5.4 (8/10), Gemini 3 Pro (9/10).
Minimax + Grok uebersprungen (PAL/OpenRouter-Probleme).
**CG:** uebersprungen — Tests selbst geschrieben weil sehr fokussiert.
**TS:** 37 Unit-Tests + 9 Integration-Tests + 10 Regression-Tests fuer CR-Findings.
Gesamtsuite 682/682 (vorher 672), 0 Regressionen.
**CR:** `pal:codereview` mit GPT-5.4, 7 Findings — alle vor Merge gefixt:
- HIGH: `exclude_interface_patterns: []` aushebelte die Defaults
- MEDIUM: parseInt-Eigenheit in `ipv4ToNum`/`ipInCidr` erlaubte Spoofing
- MEDIUM: kein Reconcile-Loop (als Phase-2 dokumentiert)
- LOW: 4 Findings (Idempotenz, leere A-Records, CIDR-Validation, IPv6-Fallback)

**PC:** `pal:precommit` mit GPT-5.4, 3 weitere Findings — alle vor Commit gefixt:
- HIGH: `allowed_mesh_cidrs` ohne Match = silent fallback → fail-closed throw
- MEDIUM: User-Excludes ersetzten Defaults → Merge-Semantik
- LOW: Tests prueften nur Helper → 3 echte MdnsDiscovery-Wiring-Tests
**DO:** ADR-019, USER-GUIDE (Troubleshooting), CHANGES.md aktualisiert.

---

## Session 2026-05-19 — ADR-020 Phase 1.1 libp2p Auto-Dial Hotfix

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 141 | ADR-020 Phase 1.1 libp2p auto-dial      | 2026-05-19  | ✅ | —  | ✅ | ✅ | ✅ | ✅ | 2 HIGH + 1 MEDIUM, alle gefixt + Regression-Tests |

**Problem:** Nach PR #134 (ADR-020 v1) konvergiert das Mesh nicht. RegistrySyncCoordinator startet, aber `peers`-Map permanent leer. 5+ Stunden Live-Debugging auf Mac mini + MacBook ergaben: libp2p v3 dialt nach `peer:discovery` NICHT automatisch (`#onDiscoveryPeer` macht nur `peerStore.merge`). Die Anwendung muss explizit dialen.

**CO:** `pal:consensus` (Konsens-ID 5801b78c) — GPT-5.5 (8/10) + Gemini 2.5 Pro (9/10), einstimmig. Diagnose und Fix-Ansatz bestaetigt.
**CG:** uebersprungen (reiner Bug-Fix).
**TS:** 14 Unit-Tests in `libp2p-autodial.test.ts` (neu) + 1 Regression-Test in `registry-sync-coordinator.test.ts`. Alle 53 sync/libp2p-Tests gruen. Live-Test auf MacBook bestaetigt: peer:discovery → autoDial-Pipeline aktiv.
**CR:** `pal:codereview` GPT-5.5 — 2 HIGH + 3 MEDIUM Findings:
- HIGH: `peer:connect`-Event-Parsing nutzte generic `detail.toString()` → `"[object Object]"`. Auch ohne diesen Fix waere auto-dial nutzlos gewesen, weil Coordinator falsche Peer-IDs bekommt. Fix + 6 Regression-Tests fuer `extractPeerIdFromConnectionEvent`.
- HIGH: `RegistrySyncCoordinator.runRound()` setzte `entry.inflight` NACH IIFE-Aufruf, aber im converged-Pfad (`message===null`) lief die IIFE synchron bis zum inneren `finally`, das `inflight=null` setzte — danach ueberschrieb der outer `entry.inflight = promise` das Ergebnis dauerhaft. Peer permanent blockiert. Fix: Cleanup ausschliesslich im outer finally. + Regression-Test.
- MEDIUM: stop-Guard im autoDial gegen Use-after-Stop, + Regression-Test.
- MEDIUM deferred: Backoff (Phase 1.2), In-Flight-Cap (niedrige Prio, libp2p deduppt).
- MEDIUM dokumentiert: kein echter libp2p-Integration-Test (Live-Test auf 5 Nodes kompensiert).
**PC:** `pal:precommit` GPT-5.5 — clean.
**DO:** ADR-020-Phase-1.1-autodial.md (neu) + CHANGES.md + COMPLIANCE-TABLE.md.

**Live-Befund:** Auto-Dial-Pipeline laeuft. libp2p-Dials zu den 4 Peers scheitern aktuell mit "All multiaddr dials failed" / "aborted due to timeout" — separater Bug auf Netzwerkebene (vermutlich asymmetrisch: andere Nodes haben Phase 1.1 noch nicht). Wird durch Rollout auf alle 5 Nodes geklaert.

---

## Session 2026-05-19 spaet — Bug #4 Pairing-URI-Migration

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 143 | Bug #4 Pairing-URI-Migration            | 2026-05-19  | —  | —  | ✅ | ✅ | ✅ | ✅ | 0 — auf MacBook live verifiziert |

**Problem:** Bug #4 aus ADR-020 Phase 1.1 Bug-Report (PR #136, Mac mini). Pairing-Eintraege mit Hostname-basierten SPIFFE-URIs (Legacy-Format) verhindern AGENT_MESSAGE-Empfang von Peers mit Host-ID-URIs.

**CO/CG:** uebersprungen (Bug-Fix + isoliertes Migrationsskript).
**TS:** 8 neue Tests in pairing.test.ts (Klassifizierung + Startup-Warning). Migrationsskript live auf MacBook ausgefuehrt (--dry-run + live).
**CR:** `pal:codereview` internal gpt-5.5.
**PC:** clean.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md, neuer npm-Script-Entry `migrate-pairings`.

---

*Letzte Aktualisierung: 2026-05-19 23:00 — Bug #4 Pairing-URI-Migration.*

## Session 2026-05-19 spaet — Bug #3 libp2p connectionEncrypters Config-Key

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 144 | Bug #3 libp2p connectionEncrypters Key  | 2026-05-19  | —  | —  | ✅ | ✅ | ✅ | ✅ | 0 — via libp2p-Probe live verifiziert |

**Problem (Live-Befund):** Auto-Dial aus PR #135 fired korrekt, aber jeder Dial scheiterte mit `EncryptionFailedError`. Root Cause: libp2p v2+ benutzt `connectionEncrypters` (Plural), nicht `connectionEncryption`. Alter Key silent ignoriert → Noise nie konfiguriert.

**CO/CG:** uebersprungen (One-line Config-Fix). Diagnose via direkter libp2p-Probe + node_modules/libp2p source review.
**TS:** 4 Regression-Tests in libp2p-runtime-config.test.ts (Source-Text-Check + Runtime-Optionen-Check). 25 libp2p-Tests gruen.
**CR:** internal validation, gpt-5.5.
**PC:** clean.
## Session 2026-05-19 spaet — Bug #2 `execute_remote_skill` Port-Mix Hotfix

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 142 | Bug #2 execute_remote_skill Port-Mix    | 2026-05-19  | —  | —  | ✅ | ✅ | ✅ | ✅ | 0 — Diagnose live verifiziert via /proc/<pid>/environ |

**Problem:** ADR-020 Phase 1.1 Bug-Report #2 (Mac mini, PR #136). execute_remote_skill schickte HTTP-Bytes an HTTPS-only Peer-Port.

**CO/CG:** uebersprungen (reiner Bug-Fix, CLAUDE.md erlaubt).
**TS:** 4 Unit-Tests in neuer `mcp-stdio-remote-skill.test.ts`. Pre-existing 227 Test-Failures sind unrelated better-sqlite3 ABI auf Node v26.
**CR:** `pal:codereview` (internal validation, gpt-5.5) — 0 Findings.
**PC:** vor Commit, clean.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md.

---

## Session 2026-05-20 — Test-Tooling: SQLite-ABI-Smoke-Test + `.nvmrc`-Check

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 145 | Test-Tooling SQLite-ABI-Smoke-Test      | 2026-05-20  | —  | —  | ✅ | ✅ | ✅ | ✅ | 0 — beide Pfade (v22 / v26) live verifiziert |

**Problem:** 227 Daemon-Tests scheiterten cryptisch auf Node v26 (Homebrew-Default), weil `check-native-modules.cjs` den ABI-Mismatch nicht erkannte (lazy binding + missing-file Fallback). Folge: jede Test-Session brauchte manuelles `PATH=...v22.22.3/bin:$PATH` als Tribal-Knowledge.

**CO/CG:** uebersprungen (Test-Tooling-Fix, kein Architektur-Aspekt).
**TS:** Refactoring zu Pure-Helpers + 16 node:test-Tests in `check-native-modules.test.cjs`. Daemon-Suite 758/758 gruen auf v22. `pretest`-Hook macht fail-fast mit klarer Anleitung auf v26.
**CR:** `pal:codereview` internal gpt-5.5.
**PC:** clean.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md, neuer `.nvmrc`-Pin.

**Bezuege:** Folge aus dem Abend-Befund vom 2026-05-19 dass die Daemon-Tests fuer den User „pre-existing failures" zeigen, was die Test-Suite faktisch nutzlos macht.

---

## Session 2026-06-04 — ADR-022 PeerID-rooted Identity (Schritt 1 + #0 + Security-Fixes)

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| 143 | ADR-022 PeerID-rooted Identity          | 2026-06-04  | ✅ | —  | ✅ | ✅ | ✅ | ✅ | 2 HIGH + 3 MEDIUM + LOW (2× gpt-5.5) — alle gefixt |

**CO:** 2 `pal:consensus`-Läufe (gpt-5.5 / gemini-2.5-pro / gemini-3.1-pro / MiniMax-M2.7) → einstimmig Option 1 (PeerID-gewurzelte Identität). ADR-022 Accepted.
**CG:** — (kein clink gemini; Tests von Hand).
**TS:** 784 Tests gruen, tsc clean. 4 neue Security-Regressionstests (Spoofing-blockiert, Parallel-Race→selbe PeerID, Malformed-URI abgelehnt, stale-verified-reset) + Akzeptanztest (stabile PeerID ueber Neustarts).
**CR:** 1. Review gpt-5.3-codex, 2. + finale Bestaetigung gpt-5.5 — beide HIGH bestaetigt geschlossen, keine neuen HIGH+.
**PC:** `pal:precommit` clean.
**DO:** ADR-022-peerid-rooted-identity.md, CHANGES.md, TODO.md, Memory.

**Scope-Hinweis:** additiv/kompatibel — aktiviert die kanonische PeerID-Aufloesung noch NICHT (fail-closed inert bis Cert-SAN-Cutover auf .94); der Live-403 wird hier noch nicht behoben.

---

## Session 2026-06-04 — ADR-022 Schritt 3 / WS-1 (channel-bound HTTPS-Authz)

| #    | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|------|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| WS-1 | ADR-022 §3 channel-bound HTTPS authz    | 2026-06-04  | ✅ | —  | ✅ | ✅ | ✅ | ✅ | 1 HIGH + 1 MEDIUM + 2 LOW (gpt-5.5) — HIGH+MEDIUM+1 LOW gefixt, 1 LOW zurueckgestellt |

**CO:** Konsensus fuer Schritt 3 bereits in der ADR-022 §Schritt-3-Sektion (PR #144) dokumentiert (channel-binding, PoP, atomarer Cutover) — kein neuer CO-Lauf fuer diesen additiven Teil-Workstream noetig.
**CG:** — (kein clink gemini; Tests von Hand).
**TS:** 792 Tests gruen, tsc clean. Neuer HIGH-Regressionstest (non-host non-canonical Sender → fail-closed), unique-match-Test fuer markPeerIdVerified, authorizeHttpsSender-Matrix (canonical+match / +no-cert / +mismatch / legacy).
**CR:** `pal:codereview` gpt-5.5 — 1 HIGH (Legacy-Bypass zu breit) + 1 MEDIUM (mark-all) + 2 LOW; HIGH+MEDIUM+1 LOW (socket.authorized) gefixt + Regressionstest, 1 LOW (PeerID-Regex-Praefix) bewusst zurueckgestellt/dokumentiert.
**PC:** `pal:precommit` (gpt-5.3-codex) clean — ready_for_commit, 0 Issues.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md; ADR-022 §Schritt-3-Sektion bereits gemerged (#144).

**Scope-Hinweis:** additiv/fail-closed — inert bis .94 `node/<PeerID>`-Certs ausstellt; kein Verhaltenswechsel fuer Legacy-`host/`-Sender, kein .94-Eingriff.

---

## Session 2026-06-04 — ADR-022 Schritt 3 / WS-2 (Accept-both + Self-Identity, Phase 0)

| #    | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|------|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| WS-2 | ADR-022 §3 Accept-both (Phase 0)        | 2026-06-04  | ✅ | —  | ✅ | ✅ | ✅ | ✅ | 1 HIGH + 1 MEDIUM + 2 LOW (gpt-5.5) — HIGH+MEDIUM+1 LOW gefixt + Re-Review bestaetigt, 1 LOW zurueckgestellt |

**CO:** Phase-0-Sequenz bereits in der ADR-022 §Schritt-3-Sektion (#144) konsentiert — kein neuer CO-Lauf.
**CG:** — (Tests von Hand).
**TS:** 809 Tests gruen (+12 neu), tsc clean, eslint 0 errors. HIGH-Regression (`attestedPeerIdFromCert`: non-attesting/empty-pin → null), dual-SAN-Extraktion, isAttestingIssuer-Matrix, peerIdFromCertSan accept-both-Bruecke.
**CR:** `pal:codereview` gpt-5.5 (security) — 1 HIGH (CA-Konflation: jede transport-vertraute CA konnte `node/<PeerID>` attestieren) + 1 MEDIUM (mDNS-Dup-Sichtbarkeit) + 2 LOW. HIGH+MEDIUM+1 LOW (dual-SAN) gefixt; Re-Review (intern, gpt-5.5) bestaetigt HIGH geschlossen, 0 Restfindings. 1 LOW (mark-vor-Sigverify) bewusst zurueckgestellt (durch Issuer-Pin entschaerft).
**PC:** `pal:precommit` (gpt-5.3-codex) clean — ready_for_commit, 0 Issues.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md.

**Scope-Hinweis:** additiv/fail-closed — Phase-0-Default setzt KEINEN attestierenden CA-Pin → kanonische Attestierung echt inert (WS-3 setzt den .94-Admin-CA-Fingerprint). Kein Emit-/Cert-Wechsel.

---

## Session 2026-06-04 — ADR-022 Schritt 3 / WS-3 (Cross-Node PoP Cert-Issuance)

| #    | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|------|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| WS-3 | ADR-022 §3 PoP Cert-Issuance (node/<PeerID>) | 2026-06-04 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | 1 HIGH + 1 MEDIUM + 3 LOW (gpt-5.5) — alle gefixt + Re-Review bestaetigt |

**CO:** Schritt-3-Konsensus (PoP-Scope inkl. X.509-Pubkey-Hash, atomarer Cutover) in ADR-022 §Schritt-3 (#144).
**CG:** — (Tests von Hand).
**TS:** 831 Tests gruen (+22), tsc + eslint clean. cert-pop (Scope-Determinismus, length-prefix-Ambiguitaet, sign/verify-Roundtrip + Tamper/Fremd-Key/Fremd-PeerID/Fremd-CA), cert-issuer (NonceStore single-use/TTL, signNodeCertFromCsr SAN-Korrektheit + HIGH-Regression „kein Admin-Hostname/localhost", bogus-CN-drop, E2E Client↔Admin-Interop, cert-substitution/Fremd-PeerID/Fremd-CA-Abwehr).
**CR:** `pal:codereview` gpt-5.5 (security) — 1 HIGH (Admin-Hostname/localhost-DNS-SAN-Impersonation) + 1 MEDIUM (Nonce-DoS) + 3 LOW; alle gefixt + Regressionstests; Re-Review (intern) bestaetigt HIGH geschlossen, 0 Restfindings.
**PC:** `pal:precommit` (gpt-5.3-codex) clean — ready_for_commit.
**DO:** CHANGES.md, COMPLIANCE-TABLE.md, `docs/runbooks/ADR-022-WS3-94-cert-issuance.md` (.94-Instruktion).

**Scope-Hinweis:** Code beider Seiten (Client+Admin). `.94` rollt aus + verteilt den Empfänger-Pin (`TLMCP_PEERID_ATTESTING_CA_FP`); dann TH01-Rejoin live. Privater TLS-Key verlaesst den Node nie (nur CSR-Pubkey transitiert).

---

## Session 2026-06-04 — ADR-022 WS-3 Fix (Eigen-Loopback im Cert, Live-Test-Befund)

| #     | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-------|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| WS-3a | ADR-022 §3 Loopback-SAN-Fix             | 2026-06-04  | —  | —  | ✅ | ✅ | ✅ | ✅ | Live-Test-Befund: localhost-SAN versehentlich entfernt (MCP-Proxy); Eigen-Loopback wieder rein, HIGH bleibt zu |

**Bug-Fix-PR (CO/CG entfallen).** **TS:** 831 grün, tsc+eslint clean; SAN-Regressionstests aktualisiert (`['localhost','th01']`, bogus-CN→`['localhost']`). **CR:** gpt-5.5 (security, intern) — Eigen-Loopback kein Cross-Node-Vektor, WS-3-HIGH (Admin-Host-Impersonation) bleibt geschlossen, 0 Findings. **PC:** gpt-5.3-codex clean. **DO:** CHANGES.md, COMPLIANCE-TABLE.md.

---

## Session 2026-06-04 — ADR-022 Schritt 3 LIVE-VERIFIKATION (Peer-Deploy + Live-Test)

Pflichtschritt #13 (Peer-Deploy + Live-Test) für WS-1/2/3 + Loopback-Fix — **grün im Live-Mesh**:

- **Krypto-Flow:** TH01 → `requestNodeCert` (PoP, libp2p-Ed25519) → .94 stellt `node/<PeerID>`-Cert aus → installiert + Daemon-Restart.
- **.94↔TH01-Link 403-frei:** .94-Gegenprobe — kein SKILL_ANNOUNCE-403 / „Unknown sender" mehr; .94 importiert TH01s Announces, `/api/peers` `status=online`. Kanonische Attestierung via Cert-SAN (Pin = .94-CA-FP `b56aa30…`).
- **MCP-Proxy geheilt:** `https://localhost:9440/health` → HTTP 200.
- **Daemon:** active/running, 0 Restarts, Port 9440 listen.
- **Offen:** Phase-3-Sender-Flip (NUR auf Christians Wort); Upgrade der 3 Alt-Code-Nodes auf WS-2.

Doc-only-Eintrag (Abschluss-Dokumentation Live-Test); kein Code → CO/CG/TS/CR/PC entfallen, DO ✅.

---

## Session 2026-06-04 — Fix v0.30.1 Token-Onboarding Port-Mismatch (thinklocal join)

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.30.1 | tbd | 2026-06-04 | —  | —  | ✅ | ✅ | ✅ | ✅ | Bug-Fix: certloser Join ging an mTLS-Port 9440 statt Onboarding 9441. CR gpt-5.5: 0 HIGH, 1 MEDIUM (vorbestehend → Follow-up) + 2 LOW gefixt |

**Bug-Fix-PR (CO/CG entfallen).** **TS:** 842 grün (+11), tsc+eslint clean; Regressionstest `:9440→:9441` + IPv6/userinfo/default-port/protocol-Edge-Cases; CLI-Smoke live (erreicht :9441). **CR:** gpt-5.5 full — single-source-Helfer korrekt, mTLS bleibt 9440, kein HIGH; 1 MEDIUM (prozessweites NODE_TLS_REJECT_UNAUTHORIZED=0 — vorbestehend, abhängigkeitsfreier Scope → TODO-Follow-up) + 2 LOW (Helfer-Härtung + Edge-Tests) gefixt. **PC:** gpt-5.3-codex clean. **DO:** CHANGES, COMPLIANCE, TODO, package.json 0.30.1.

---

## Session 2026-06-04 — Fix v0.30.2 `thinklocal restart` verlor Runtime-Flags

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.30.2 | tbd | 2026-06-04 | —  | —  | ✅ | ✅ | ✅ | ✅ | Bug-Fix: restart reichte --lan/--local nicht an start durch. CR gpt-5.5: 0 Findings |

**Bug-Fix-PR (CO/CG entfallen).** **TS:** 847 grün (+5), tsc+eslint clean; Regression in `runtime-mode.test.ts` (leere Flags → fallback statt lan; `--lan`→lan; `--local` schlägt `--lan`) — CI-gated im daemon-Suite. **CR:** gpt-5.5 full — 0 Findings; Verdrahtung wie etablierte `args.slice(1)`-Befehle, Delegation erhält Präzedenz. **PC:** gpt-5.3-codex clean. **DO:** CHANGES, COMPLIANCE, package.json 0.30.2.

**Hinweis:** `thinklocal.ts` läuft `main()` beim Import automatisch → nicht unit-importierbar; die Dispatch-Verdrahtung ist review-verifiziert (+ `--help`-Smoke), die testbare Entscheidungslogik (`runtimeModeFromFlags`) ist CI-getestet.

---

## Session 2026-06-04 — Verify-First: CRDT-Registry-Replikation (17.05.-TODO)

| #         | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|-----------|-----|------------|----|----|----|----|----|----|----|
| verify-01 | tbd | 2026-06-04 | —  | —  | —  | —  | —  | ✅ | Verify-First: 17.05.-Bug „CRDT repliziert nicht" NICHT reproduzierbar — behoben durch ADR-020 v1 (#139). Kein Code |

**Verify-only, kein Code → CO/CG/TS/CR/PC entfallen, DO ✅.** Live-Verifikation gegen das heutige Mesh (TH01s mTLS-Cert gegen Peer-Agent-Cards + lokale `/api/capabilities`): TH01-Registry = 16 Caps aus 6 Nodes gemerged; TH01 + .94 konsistent `registry_sync conv=5/5` (2 Passes); je 8 libp2p-Verbindungen; periodischer 45s-Resync + `republish()` vorhanden. TODO-Item als erledigt markiert (mit Belegen). **DO:** CHANGES.md, COMPLIANCE-TABLE.md, TODO.md.

---

## Session 2026-06-04 — v0.30.3 Registry-Republish-Endpoint Test-Abdeckung

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.30.3 | tbd | 2026-06-04 | —  | —  | ✅ | ✅ | ✅ | ✅ | `POST /api/registry/republish` existierte (ADR-020 v1), war untestet. Live verifiziert + Regressionstest. CR gpt-5.5: 0 Findings |

**Bug-Fix/Test-PR (CO/CG entfallen).** **TS:** 851 grün (+4), tsc+eslint clean; `dashboard-api.test.ts` (Fastify-inject: ok/503/500/429). **CR:** gpt-5.5 — 0 Findings (test-only, Endpoint live-verifiziert: auth→ok + Audit-Delta). **PC:** gpt-5.3-codex clean. **DO:** CHANGES, COMPLIANCE, TODO, package.json 0.30.3.

**Side-note (pre-existing, out of scope):** `registerApiAuth` (JWT-Hook) ohne Aufrufstelle → `/api/*` nur mTLS-gated (Mesh-Authz erfüllt). Separater Befund, nicht angefasst.

---

## Session 2026-06-04 — v0.31.0 ADR-021 Generisches Skill-Health-Monitoring

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.31.0 | tbd | 2026-06-04 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | ADR-021 SkillHealthMonitor + availability-Attribut. CR gpt-5.5: 1 HIGH (Routing-Filter) + 2 MEDIUM + 2 LOW — alle gefixt + Re-Review |

**CO:** Konsens 2026-05-18 in ADR-021 (gpt-5.2 8/10 + gemini-3-pro 9/10). **CG:** — (Tests von Hand). **TS:** 862 grün (+11), tsc clean; skill-health-monitor.test.ts (Hysterese 2-up/3-down, Timeout, Single-Flight, Intervall-Switch, Jitter, stop(), Shutdown-Race) + registry.test.ts (availability-Routing-Filter HIGH-Regression, setAvailability owner-only/idempotent/Hash-Flip). **CR:** `pal:codereview` gpt-5.5 — 1 HIGH (findBySkill/findByCategory ignorierten availability) + 2 MEDIUM (Shutdown-Race onTransition, Hash ohne availability) + 2 LOW (idempotenz, stale re-register) gefixt; Re-Review bestätigt HIGH geschlossen, 0 Restfindings. **PC:** gpt-5.3-codex clean. **DO:** ADR-021 (Accepted), CHANGES, COMPLIANCE, TODO, package.json 0.31.0.

**Voraussetzung-Hinweis:** ADR-020 v2.2 (Owner-wins CRDT) am Write-Site adressiert (setAvailability nur eigener Key), CRDT-Layer-Enforcement offen (ADR-acknowledged).

---

## Session 2026-06-04 — v0.31.1 Boot-Race-Schutz im Installer (Skill-Service-Deps)

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.31.1 | tbd | 2026-06-04 | —  | —  | ✅ | ✅ | ✅ | ✅ | Spiegelt .56-Boot-Race-Fix generisch in Installer (CLI + install.sh). CR gpt-5.5: 0 Findings |

**Bug-/Tech-Debt-PR (CO/CG entfallen).** **TS:** 869 grün (+7), tsc clean, `bash -n` ok; service-dependencies.test.ts (Manifest-Sammlung, Host-conditional After=/Wants=, dep-aber-absent→keine Zeilen). **CR:** gpt-5.5 — 0 Findings; generisch (aus Manifests, nicht influxdb-hartkodiert), Injection-Regex-geschützt, Presence-Check verhindert hängende Wants=. **PC:** gpt-5.3-codex clean. **DO:** CHANGES, COMPLIANCE, TODO, package.json 0.31.1.

**Scope:** CLI-Bootstrap + install.sh (Install-Zeit); build-deb.sh ausgenommen (Build-Zeit). Laufender .56-Daemon nicht angefasst (nur Repo).

---

## Session 2026-06-05 — v0.32.0 Build-/Versions-Stempel im Mesh

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.32.0 | tbd | 2026-06-05 | —  | —  | ✅ | ✅ | ✅ | ✅ | build-info.ts → agent_card.build + /api/status + MCP-Tools. CR gpt-5.5: 0 Findings |

**Feature-PR (CO/CG entfallen — kleine isolierte Änderung, kein Architektur-Entscheid; ADR bewusst übersprungen).** **TS:** 873 grün (+4), tsc + lint clean; build-info.test.ts (Datei-Vorrang, git-Fallback, all-absent→unknown/null, hostname). **CR:** gpt-5.5 — 0 Findings; git via execSync mit fixen Literalen + intern abgeleitetem repoRoot (keine Injection-Fläche), fail-safe Fallbacks. **PC:** gpt-5.3-codex clean. **DO:** CHANGES, COMPLIANCE, TODO, package.json 0.32.0.

---

## Session 2026-06-05 — v0.32.1 Architektur-Flanke 1: Auth-Modell mTLS-only

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.32.1 | tbd | 2026-06-05 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | mTLS-only (pal:consensus 3 Modelle) — toten JWT-Hook entfernt + Doku korrigiert. CR gpt-5.5: 0 Findings |

**CO:** `pal:consensus` (3 Modelle, einstimmig) → Option A mTLS-only — Orchestrator-Entscheidung. **CG:** —. **TS:** 873 grün (kein Test betroffen, Code war tot), tsc clean. **CR:** gpt-5.5 — 0 Findings (kein Importer/Test/Client von api-auth; Doku≠Realität behoben). **PC:** gpt-5.3-codex clean. **DO:** SECURITY.md, THREAT-MODEL.md, CHANGES, COMPLIANCE, TODO, package.json 0.32.1.

**Roadmap:** JWT bei Internet-Exposure VORHER aktivieren (`@fastify/jwt` bleibt Dep).

---

## Session 2026-06-05 — v0.33.0 Architektur-Flanke 2: Owner-wins availability (direct-only)

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.33.0 | tbd | 2026-06-05 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | ADR-020 v2.2 HYBRID direct-only — availability raus aus CRDT, owner-gated Side-Map + Guardrail |

**CO:** `pal:consensus` (3 Modelle, einstimmig) → HYBRID (direct-only jetzt, Provenance Phase-2) — Orchestrator-Entscheidung. Topologie vorab geklärt (transitiv → direct-only via Side-Map). **CG:** —. **TS:** 874 grün (+1 Guardrail-Test: relayte availability writer!=owner → verworfen + Metrik), tsc clean. **CR:** `pal:codereview` gpt-5.5 (security). **PC:** gpt-5.3-codex clean. **DO:** ADR-020 v2.2, CHANGES, COMPLIANCE, TODO, messages.ts (Phase-2 provenance-Feld reserviert), package.json 0.33.0.

**Phase-2 vorgemerkt:** signierte Per-Key-Origin-Provenance (Schema reserviert, Krypto später). Verworfen: relay-witness-wins.

---

## Session 2026-06-05 — v0.34.0 ADR-022 Phase 3: Per-Node-Sender-Flip (kanonische node/<PeerID>-Identität)

| #       | PR  | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|----|----|----|----|----|----|----|
| v0.34.0 | tbd | 2026-06-05 | ✅ | —  | ✅ | ✅ | ✅ | ✅ | Flag-gegateter Canonical-Sender-Emit (default OFF) + Cert-SAN-Interlock — 3 HIGH + 2 MEDIUM (CR gpt-5.5) gefixt |

**CO:** ADR-022 Schritt 3 (`pal:consensus` `b4e5d346`, einstimmig sound-with-changes) — Design lag vor. **CG:** —. **TS:** 884 grün (+7 `resolveSelfIdentity`: Flip/Interlock/Dual-SAN/other-PeerID/libp2p-aus), 6 Integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security) — HIGH 1 (Card-Legacy-spiffeUri→403), HIGH 2 (Interlock „eigene" kanonische URI), HIGH 3 (Runtime-PeerID-Guard), MEDIUM 1 (dashboard agent_id), MEDIUM 2 (Pairing URI-keyed, fail-closed → Follow-up), LOW 2 (kein Code nötig). Re-review: 0 Residual. **PC:** gpt-5.3-codex clean. **DO:** ADR-022 Status, CHANGES, COMPLIANCE, TODO, config/daemon.toml, package.json 0.34.0.

**Ops-Schritt offen (nicht in dieser PR):** Per-Node-Live-Flip + Noise-Re-Handshake + Mesh-Gegenprobe; danach `TLMCP_STRICT_IDENTITY=1`. **Follow-up vor Live-Flip:** pubkey-basiertes Pairing (CR-MEDIUM 2).

---

*Letzte Aktualisierung: 2026-06-05 — v0.34.0 ADR-022 Phase 3 Per-Node-Sender-Flip (flag-gegatet).*
