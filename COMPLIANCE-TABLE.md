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
| 125 | #110      | Skill Discovery — ioBroker-Moment                               | 04-11 16:50 | —  | —  | ✅ | ✅ | —  | ✅ | **Dieser PR.** `skill-discovery.ts`: Peer-Announcement → Manifest install → Capability auto-activate → Claude-Adapter. 13 Tests. CR Gemini Pro: 0 CRITICAL, 1× HIGH (Counter) + 2× MEDIUM (Path-Test, Trust-Model) + 1× LOW (Prompt-Hop) alle gefixt. |

---

## Gesamtstatistik

### Compliance-Rate ueber alle 106 Eintraege

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

*Letzte Aktualisierung: 2026-04-08 14:50 — Batch-Review Fixes PR #105 (GitHub #83): 3 retroaktive GPT-5.4 Reviews + sofortige Fixes fuer 1 CRITICAL, 4 HIGH, 9 MEDIUM, 6 LOW*
