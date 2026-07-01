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

## Session 2026-06-06 — v0.34.1 ADR-022 Phase-3-Härtung (TH02-Live-Flip-Befunde)

| #       | PR  | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|-----|----|----|----|----|----|----|
| v0.34.1 | tbd | 2026-06-06 | n/a | —  | ✅ | ✅ | ✅ | ✅ | Card-Re-Fetch/Supersession + Issuer-Pin-Symmetrie + Guard-Reihenfolge + Pairing pubkey — CR-HIGH/MEDIUM/LOW gefixt |

**CO:** entfällt (Härtung nach TH02-Test; Design aus ADR-022 §3 + #159-Review). **CG:** —. **TS:** 892 grün (+8: Supersession attestiert/Lag-Fallback/no-evict, Issuer-Pin `cert_issuer_not_attesting`, pubkey-Pairing, confirmPeerDiscovery), 6 Integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 — fand HIGH (mDNS-getriebene Eviction-DoS) + MEDIUM (sticky endpoint) + LOW (canonical-Warnung); alle gefixt (Supersession hinter issuer-gepinnte Cert-Attestierung verschoben), Re-review 0 Residual. **PC:** clean. **DO:** CHANGES, COMPLIANCE, TODO, package.json 0.34.1.

**Gate:** Produktiv-Flip bleibt gestoppt bis Merge + TH02-Live-Re-Verifikation (sauberer Flip, Announces 200 statt 403).

---

## Session 2026-06-06 — v0.34.2 Attesting-CA-Pin Auto-Derive (Fleet-Voraussetzung)

| #       | PR  | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|-----|----|----|----|----|----|----|
| v0.34.2 | tbd | 2026-06-06 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | Pin aus eigener Mesh-CA ableiten (env-override + `none` + Single-Cert-Guard) — CR MEDIUM+LOW gefixt |

**CO:** `pal:consensus` (gpt-5.5 adversarial; gemini billing-capped) → auto-derive + env-override + Guards, Singleton-Mesh-CA-Invariante. **CG:** —. **TS:** 898 grün (+6 Resolver: env/derived/none/bundle-guard/null/broken-PEM), 6 Integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security) — kein HIGH/CRITICAL; MEDIUM (defektes PEM → Boot-Crash) gefixt (try/catch+Test), LOW (Env-Format-Warnung, stale Kommentar) gefixt; 2 MEDIUM als Follow-up dokumentiert (token-onboard-Validierung pre-existing; mTLS-Integrationstest, live bereits bewiesen). **PC:** clean. **DO:** ADR-022-Sektion, CHANGES, COMPLIANCE, TODO, package.json 0.34.2.

**Live (2026-06-06):** TH01+TH02 auf v0.34.1, TH02-Flip gegen v0.34.1-Nachbar grün. Produktiv-Flip (.56/.52/.222) gestoppt bis Christians Wort.

---

## Session 2026-06-08 — v0.34.3 Outbound-Connect Debug + Escape-Hatch (.55 EHOSTUNREACH)

| #       | PR  | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|-----|----|----|----|----|----|----|
| v0.34.3 | tbd | 2026-06-08 | n/a | —  | ✅ | ✅ | ✅ | ✅ | mesh-connect.ts: TLMCP_DEBUG_CONNECT + TLMCP_DISABLE_OUTBOUND_PINNING — CR kein HIGH, 2 LOW gefixt |

**CO:** entfällt (Bug-Fix/Diagnose, keine Architektur-Weiche; Default-Verhalten unverändert). **CG:** —. **TS:** 908 grün (+10 mesh-connect: Policy-Parse, Connector-Optionen ±disablePinning, Debug-Passthrough Fehler/Erfolg genau einmal), 6 Integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security) — kein CRITICAL/HIGH/MEDIUM (mTLS scharf, keine Key-Leakage); 2× LOW gefixt (Passthrough-Test, getypte Optionen). **PC:** clean. **DO:** CHANGES, COMPLIANCE, TODO, ADR-019-Notiz, package.json 0.34.3.

**Loop:** .94 deployt auf .55 + testet Debug/Disable-Flag, Logs zurück an Claude bis gefixt. TABU nichts extern.

---

*Letzte Aktualisierung: 2026-06-08 — v0.34.3 Outbound-Connect Debug + Escape-Hatch.*
---

## Session 2026-06-08 — v0.34.5 mDNS-Interface-Pin abschaltbar (.55 connectx-Fix)

| #   | PR                                      | Datum       | CO | CG | TS | CR | PC | DO | Findings                           |
|-----|-----------------------------------------|-------------|----|----|----|----|----|----|----|
| #164 | mDNS-Interface-Pin-Disable (.55-Bug)   | 2026-06-08  | —  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5 (2 Runden): 0 HIGH/CRITICAL; R1 1 MEDIUM+2 LOW, R2 1 MEDIUM+2 LOW — alle gefixt + Regression-Tests. Live-verifiziert auf .55. |

**Scope:** zwei Vergiftungsquellen auf dual-homed macOS .55, ein Flag `disable_mdns_interface_pin`:
(1) bonjour-Socket-Interface-Pin (Startup) — Commit `5ffdd5d`; (2) `@libp2p/mdns` zweite multicast-dns-Instanz (~27s, Live-Befund Operator) — Folge-Commit.
**CO:** entfällt — reiner Bug-Fix (Root-Causes eindeutig: die zwei mDNS-Multicast-Stacks; keine Architektur-Frage offen).
**CG:** entfällt — Tests von Hand.
**TS:** 913 Tests grün (80 Dateien), tsc clean, Integration 6/6 grün. Neu: `discovery.test.ts` Block „mDNS-Interface-Pin-Disable" + `config-mdns-pin.test.ts` (Quelle 1); `libp2p-runtime.test.ts` (resolveLibp2pMdnsEnabled, state mdns:false) + `libp2p-runtime-config.test.ts` (Runtime-Test: `start()` lässt `services.mdns` weg + ruft `deps.mdns()` nie auf wenn geflaggt; Positiv-Pfad) (Quelle 2). **Live-verifiziert auf .55:** Pin-Fix entfernt Startup-Vergiftung bestätigt (Operator); libp2p-mDNS-Quelle root-caused; Final-Heal/Re-Test (sudo) offen beim Operator.
**CR:** `pal:codereview` gpt-5.5 (security), 2 Runden (je 0 CRITICAL/HIGH): R1 (bonjour) MEDIUM publish()-Pfad + 2 LOW; R2 (libp2p) MEDIUM Runtime-Test + 2 LOW — alle mit Tests/Doku geschlossen.
**PC:** `pal:precommit` gpt-5.3-codex: 0 Blocker.
**DO:** ADR-019 (Abschnitt „.55 connectx-Vergiftung" + Nachtrag libp2p-mDNS), CHANGES.md (v0.34.5 + Nachtrag), config/daemon.toml (Flag-Doku), TODO.md, Memory.

---

*Letzte Aktualisierung: 2026-06-08 — v0.34.5 mDNS-Interface-Pin abschaltbar (.55 connectx-Fix).*
## Session 2026-06-08 — v0.34.4 Bug #2: Canonical-Sender-Akzeptanz (Host-Bind nach Cert-Attestierung)

| #       | PR  | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|---------|-----|------------|-----|----|----|----|----|----|----|
| v0.34.4 | tbd | 2026-06-08 | n/a | —  | ✅ | ✅ | ✅ | ✅ | markPeerIdVerified bindet attestierte PeerID an TLS-Source-Host — 2 HIGH + MEDIUM + LOW gefixt |

**CO:** entfällt (Bug-Fix; Root-Cause am Code). **CG:** —. **TS:** 904 grün (+6 mesh: Host-Bind/IPv6-mapped/no-match/no-rebind/transaktionaler-Rollback/peerId-null), 6 Integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security) — 2 HIGH (Trust-State vor Sig-Prüfung → transaktional+Rollback; peerId=null-Treffer binden) + MEDIUM (Shared-IP, durch Rollback gedeckt) + 2 LOW gefixt; Re-review 0 Residual. **PC:** gpt-5.3-codex clean. **DO:** ADR-022-Sektion, CHANGES, COMPLIANCE, TODO, package.json 0.34.4.

**Akzeptanz-Gate:** TH01-Flip → SKILL_ANNOUNCE 5/5 (auch .56/.222) nach Deploy auf alle v0.34.2-Nachbarn. Live-Gegenprobe .94.

---

## Session 2026-06-09 — v0.34.6 (DRAFT) ADR-024 Canonical-Cert-Retention

| #       | PR    | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-------|------------|----|----|----|----|----|----|----|
| v0.34.6 | DRAFT | 2026-06-09 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | 4 HIGH (über 3 CR-Runden) gefixt + re-reviewed → 0 CRITICAL/HIGH; 2 MEDIUM + 2 LOW dokumentiert als merge-blocking-vor-Deploy |

**CO:** `pal:consensus` gpt-5.5 (8/10, endorsed mit Krypto-Härtung „verify gegen gepinntes CA-PEM"). **CG:** ⚠️ gemini-2.5-pro nicht erreichbar (429 monthly-spend-cap) — Tests von Hand. **TS:** +12 Tests (`tls.test.ts`: Retention keep/regenerate, wrong-PeerID, unpinned-Issuer, Multi-SAN-Migration vs. fremd, cert-key-Mismatch, CA-owner, own-CA), 941 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security, 3 Runden) — HIGH-1 Flip-Gate-CA, HIGH-2 Trust-Distribution-CA, HIGH-3 Issuance-Topologie + MEDIUM (Multi-SAN, runtime-pin) gefixt; final 0 CRITICAL/HIGH. **PC:** gpt-5.3-codex 0 Blocker. **DO:** ADR-024, CHANGES (v0.34.6 DRAFT), COMPLIANCE, TODO.

**Status:** DRAFT-PR, wartet auf Review. **KEIN Deploy/Re-Enroll/Merge/Branch-Protection-Änderung ohne Christians ausdrückliches Wort.** Merge-blocking-vor-Deploy: CA-Validity im Retention-Verify + Trust-Distribution-Lifecycle (ADR-024).

---

## Session 2026-06-09 — v0.34.7 (DRAFT) ADR-025 Static-Peer-Join + mDNS-off + Interface-Präferenz (.55)

| #       | PR    | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-------|------------|----|----|----|----|----|----|----|
| v0.34.7 | DRAFT | 2026-06-09 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5 (2 Runden): 1 HIGH (libp2p-mDNS-Gating) + 3 MEDIUM + 1 LOW gefixt → 0 CRITICAL/HIGH; 1 Rest-MEDIUM (harmloser Shutdown-Race) dokumentiert |

**CO:** `pal:analyze` gpt-5.5 — alle 3 Optionen endorsed (1+2 must-have .55, 3 should-have /16). **CG:** ⚠️ gemini 429-Quota — Tests von Hand. **TS:** +20 Tests, 962 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (2 Runden) — HIGH (mdns_enabled schaltete libp2p-mDNS nicht ab) + MEDIUM (steady-reconcile, undici-body-leak, stop-in-flight) + LOW gefixt; final 0 CRITICAL/HIGH. **PC:** gpt-5.3-codex 0 Blocker. **DO:** ADR-025, CHANGES (v0.34.7 DRAFT), COMPLIANCE, TODO.

**Status:** DRAFT-PR, wartet auf Review. **KEIN Deploy/Merge/Branch-Protection-Änderung ohne Christians Wort.** Test auf `.55` durch Orchestrator.

---

## LIVE-DEPLOY 2026-06-10 — Linux-Fleet auf 92e6058 (#165 ADR-024 + #166 ADR-025 gemerged)

Christian-autorisiert (Orchestrator .94). Per-VM git pull main (HEAD 92e6058) + tsc-build + Daemon-Restart; own-CA-Nodes (.56/.222) zusätzlich Node-Cert RE-ENROLL (node/<PeerID>, extra-CA = .94-Mesh-CA b56aa3 im Request-Trust). Verifiziert je Node: canonical `node/<PeerID>`, build_number=92e6058, **5/5 SKILL_ANNOUNCE, 0×403**.

| Node | Re-Enroll? | Ergebnis |
|------|-----------|----------|
| TH01(.80) / TH02(.82) / .52 | nein (bereits canonical) | ✅ upgraded, canonical, 5/5, 0×403 |
| .56 (influxdb) | ja | ✅ (ADR-024 hält Cert; InfluxDB unberührt, RAM ok, Backup gewaived) |
| .222 (ai-n8n) | ja | ✅ |

**.94 (CA-Owner) + .55 (macOS)** durch Orchestrator (Kopierkästen geliefert). Daemon-only-Scope strikt. **Keine Branch-Protection-Änderung; Merge dieser Doku-PR durch Christian.**

---

## Session 2026-06-10 — v0.34.8 (DRAFT) ADR-026 Symmetrische Auth-Peer-Discovery (403 „Unknown sender"-Fix)

| #       | PR    | Datum      | CO | CG | TS | CR | PC | DO | Findings                           |
|---------|-------|------------|----|----|----|----|----|----|----|
| v0.34.8 | #168  | 2026-06-10 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5 (security): 2 HIGH (AUTHN/AUTHZ-Leak REGISTRY_SYNC/SKILL_ANNOUNCE; mehrdeutige PeerID-Override) + 1 MEDIUM (IPv6-Endpoint) + 2 LOW — alle gefixt + Regressionstests → 0 CRITICAL/HIGH |

**CO:** `pal:consensus` (gpt-5.5 for 9/10, gpt-5.3-codex neutral 9/10) — Option A (Inbound-Auto-Registrierung) als Root-Fix endorsed, B1/B2 als unzureichend verworfen. **CG:** ⚠️ gemini 429-Quota — Tests von Hand. **TS:** +24 Tests (mesh authenticatedSeen/isApprovedPeerSender/fail-closed/Architektur-Isolation, learner-Outcomes inkl. IPv6/empty-addr, config-Flag), 983 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (security) — 2 HIGH (AUTHN/AUTHZ-Trennung via `isApprovedPeerSender`-Gate auf state-mutierenden Message-Typen; `matches>1` fail-closed) + MEDIUM (IPv6/IPv4-mapped Endpoint-Bracket) + 2 LOW gefixt + Regressionstests. **PC:** gpt-5.3-codex. **DO:** ADR-026 (Accepted, §6 Impl.-Ergebnis), CHANGES (v0.34.8 DRAFT), COMPLIANCE, TODO.

**Status:** PR #168, ready (nicht Draft) — Orchestrator merged mit `gh pr merge --admin --squash` sobald Gates grün (Christian autorisiert). **#164/#166 unangetastet.** Fleet-Deploy + `.55`-Test durch Orchestrator.

---

## Session 2026-06-10 — v0.34.9 (DRAFT) Static-Peer Online-Self-Healing (ADR-026/025-Follow-up)

| #       | PR    | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|---------|-------|------------|-----|----|----|----|----|----|----|
| v0.34.9 | DRAFT | 2026-06-10 | n/a | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5: 0 HIGH; 1 MEDIUM (addPeer re-online feuerte kein onPeerOnline) + 2 LOW (stale Kommentare) gefixt + Regressionstests → 0 CRITICAL/HIGH |

**CO:** entfällt (Bug-Fix/Robustheit, keine Architektur-Weiche; Default-Verhalten ohne static_peers unverändert). **CG:** —. **TS:** +6 Tests (Reconciler Self-Heal-Flap, `resolveStaticReconcileSteadyMs` mdns-Unabhängigkeit/zero/konfigurierbar, mesh Offline→Online-Event feuert / kein Doppel-Feuer), 989 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (quick) — 0 HIGH/CRITICAL; MEDIUM (onPeerOnline beim Re-Connect) + 2 LOW (Kommentare) gefixt + Regressionstest. **PC:** gpt-5.3-codex (intern) — validation_complete, 0 Blocker. **DO:** CHANGES (v0.34.9 DRAFT), COMPLIANCE, TODO, package.json 0.34.9.

**Status:** DRAFT-PR, ready — Orchestrator merged mit `gh pr merge --admin --squash` sobald Gates grün (Christian autorisiert). Macht `.55`/jeden static_peer self-healing nach transienten Blips. **#164/#166/#168 unangetastet.**

---

## Session 2026-06-11 — v0.34.10 (DRAFT) emit_canonical_sender Default true (ADR-022 Durable-Fix)

| #        | PR    | Datum      | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------|-----|----|----|----|----|----|----|
| v0.34.10 | DRAFT | 2026-06-11 | ✅  | ⚠️ | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5: 0 HIGH/CRITICAL; 1 MEDIUM (committed-toml-Guard) + 3 LOW (Kommentare/Log-Wording) gefixt + Regressionstest |

**CO:** `pal:consensus` (gpt-5.5/MiniMax-M3, im .55-AUTH-Brief) — Default-Flip ist die durable Folge der ADR-022-Richtung; Sofort-Unblock-Analyse separat. **CG:** ⚠️ gemini 429-Quota — Tests von Hand. **TS:** +4 (loadConfig Default true, Env 0/1, committed-`config/daemon.toml`-Regression-Guard), 993 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 (quick) — Default-Flip sicher dank Fail-safe-Interlock (`flag && certSanIsCanonical && certIssuerIsAttesting`); MEDIUM + 3 LOW gefixt. **PC:** gpt-5.3-codex (intern) — validation_complete, 0 Blocker. **DO:** CHANGES (v0.34.10), COMPLIANCE, TODO, package.json 0.34.10.

**Status:** DRAFT-PR, ready — `gh pr merge --admin --squash` (Christian autorisiert). Behebt die committed-`false`-Legacy-Regression beim `git pull` (TH01/.55). **Separater Befund (kein Code-Fix):** .55 `peers_online=0` = host-seitiger macOS-`connectx`-EHOSTUNREACH (raw `net.connect` scheitert, `curl` ok, saubere Route) → .55-Host-Reset (Christian, sudo/reboot), NICHT der Connector.

---

## Merge-Status-Hygiene (2026-06-15 16:19)

Die oben als „DRAFT-PR / wartet auf Review/Merge" geführten Sessions sind **gemergt** (verifiziert via `git log origin/main`):

| Eintrag | PR | Commit auf main |
|---------|----|-----------------|
| ADR-024 Canonical-Cert-Retention | #165 | `357842f` (⚠️ 2 CR/PC-MEDIUMs offen → „ADR-024-Rollout-Gate" in TODO) |
| ADR-025 .55-Mesh-Join | #166 | `92e6058` |
| ADR-026 Symmetrische Auth-Peer-Discovery | #168 | `58377b8` |
| Static-Peer Online-Self-Healing (v0.34.9) | #169 | `b1e5b48` |
| emit_canonical_sender Default true (v0.34.10) | #170 | `a804f2f` |

**Doku-PRs gemergt:** #171 (.55-Runbooks A/C2 + ADR-027 + Onboarding/Re-Enroll), #172 (.gitignore-Hygiene), #173 (TODO/COMPLIANCE-Hygiene), #174 (Diagnose Capability-Drift).

---

## Session 2026-06-15 22:33 — v0.34.11 (DRAFT) fix: registry-sync dialProtocol PeerId (Capability-Count-Drift)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.11 | #175  | 2026-06-15 22:33 | n/a | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.5 (quick): 0 HIGH/CRITICAL/MEDIUM; 2 LOW (peerIdFromString-Throw-Kontext + PeerId-Shape-Assertion) gefixt |

**CO:** entfällt (reiner Bug-Fix; Root-Cause in #174 belegt). **CG:** —. **TS:** +3 (`libp2p-runtime.test.ts`: dialProtocol/hangUpPeer → PeerId-Objekt mit toString-Round-Trip + Shape `toCID`; ungültige PeerID → kontextueller Throw), 996 unit + 6 integration grün, tsc clean. **CR:** `pal:codereview` gpt-5.5 — 0 HIGH/CRITICAL/MEDIUM, 2 LOW gefixt. **PC:** `pal:precommit` gpt-5.3-codex (intern) — 0 Blocker. **DO:** CHANGES (v0.34.11), COMPLIANCE, package.json 0.34.11.

**Status:** Code-PR #175 — `dialProtocol`/`hangUpPeer` übergeben jetzt ein PeerId-Objekt (`peerIdFromString` via `toPeerId`) statt String → behebt den libp2p-v2-`getPeerId`-Fehler, der die Automerge-Registry-Sync-Konvergenz brach. **Orchestrator merged `--admin` nach Review** (kein Self-Merge). Reine Korrektheit, kein .55-/Produktiv-Eingriff.

---

## Session 2026-06-16 20:25 — v0.34.12 (DRAFT) feat(identity): ADR-028 D1 — kanonische node/<PeerID> adressierbar

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.12 | (neu) | 2026-06-16 20:25 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex (security): 0 HIGH/CRITICAL; optionale PeerID-Längenband-Boundary-Tests ergänzt |

**CO:** ADR-028 `pal:consensus` (gpt-5.5 for 9/10 + gpt-5.3-codex against 8/10, Konsens hoch). **CG:** —. **TS:** `spiffe-uri.test.ts` +kanonisch/Reject/Boundary-Coverage, 34 spiffe + 1002 daemon unit grün, tsc 0, eslint 0. **CR:** `pal:codereview` gpt-5.3-codex (security) — 0 HIGH/CRITICAL, alle 4 Prüfziele erfüllt. **PC:** `pal:precommit` gpt-5.3-codex — 0 Blocker. **DO:** CHANGES (v0.34.12), COMPLIANCE, ADR-028 (ACCEPTED).

**Status:** ADR-028 D1 — `parseSpiffeUri`/`normalizeAgentId` akzeptieren die kanonische `node/<PeerID>`-Identität (diskriminierte Union, fail-closed) → Orchestrator .94 wieder adressierbar (RUNBOOK-55-A Fall B). Additiv, Legacy-Pfad unverändert. **Merge/Deploy = Christians Gate** (kein Self-Merge, kein Produktiv-Rollout/Cert-Änderung/Daemon-Flip). D2a/D2b/D3/D4 + HTTPS-Cutover folgen je eigener PR.

---

## Session 2026-06-16 22:22 — v0.34.13 (DRAFT) feat(transport): ADR-028 D2b SPIFFE-Server-Identity

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.13 | (neu) | 2026-06-16 22:22 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex (security): 0 HIGH/CRITICAL, kein Auth-Bypass; MEDIUM (TOFU-Startup-Guard) + LOW (Resolver-try/catch fail-closed) gefixt |

**CO:** ADR-028 `pal:consensus` (gpt-5.5 9/10 + gpt-5.3-codex 8/10) — deckt D2-Richtung + Härtungen. **CG:** —. **TS:** `mesh-server-identity.test.ts` (alle Bypass-Modi fail-closed) + `mesh-connect.test.ts` (Flag-Wiring, rejectUnauthorized true), 1017 daemon unit grün, tsc 0, lint 0 (2 nicht-fatale Warnings, eine pre-existing). **CR:** `pal:codereview` gpt-5.3-codex (security) — fail-closed-Invarianten bestätigt, kein Bypass; MEDIUM+LOW gefixt. **PC:** `pal:precommit` gpt-5.3-codex — 0 Blocker. **DO:** CHANGES (v0.34.13), COMPLIANCE, ADR-028-D2-Doc.

**Status:** ADR-028 D2b — `checkServerIdentity` via SPIFFE-URI-SAN (statt IP-altname) hinter Flag `TLMCP_SPIFFE_SERVER_IDENTITY` (**Default OFF**). Macht Overlay/Cross-Subnet-Dial (.55→100.x) identitäts-validiert möglich. **Produktiv-Aktivierung/Cert-Rollout = Christians Gate.** Folge-PR: D2b-pin (per-Host-`resolveExpected` aus der Registry) — erst danach Fleet-Aktivierung.

---

## Session 2026-06-17 06:35 — v0.34.14 (DRAFT) feat(transport): ADR-028 D2b-pin per-Host-TOFU-Pin

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.14 | (neu, gestackt auf #180) | 2026-06-17 06:35 | ✅ | — | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex (security): 0 HIGH/CRITICAL; MEDIUM (kein stiller TOFU-Fallback → fail-fast) gefixt; LOW (Pin-Persistenz) bewusst deferiert |

**CO:** ADR-028-Konsens (deckt D2-Richtung + Pin-Härtung). **CG:** —. **TS:** `server-identity-pin.test.ts` (pin/match/conflict, per-Host, mehrdeutig→kein-Pin, Impersonation-nach-Pin abgelehnt) + `mesh-connect.test.ts` (Injektion, fehlender-Checker→throws), 1029 daemon unit grün, tsc 0, geänderte Dateien eslint-error-frei. **CR:** `pal:codereview` gpt-5.3-codex (security) — fail-closed bestätigt, kein Bypass; MEDIUM gefixt, LOW deferiert. **PC:** `pal:precommit` gpt-5.3-codex — 0 Blocker. **DO:** CHANGES (v0.34.14), COMPLIANCE.

**Status:** ADR-028 D2b-pin — per-Host-TOFU-Pin (`ServerIdentityPinStore`) erzwingt nach First-Contact die gepinnte kanonische Peer-Identität → schließt die nackte-TOFU-Lücke aus D2b. Gestackt auf #180 (Base = D2-Branch). Flag bleibt **Default OFF**; **Produktiv-/Fleet-Aktivierung + Cert-Rollout = Christians Gate**. Folge: nach Merge von #180 → diesen PR → optionale Pin-Persistenz + 1-Node-Aktivierung (.55-Overlay-Verifikation).

---

## Session 2026-06-19 12:35 — v0.34.15 (DRAFT) feat(discovery): ADR-028 D4-a MCP-Service-Modell (rein)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.15 | #185  | 2026-06-19 12:35 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex: 0 HIGH/CRITICAL; 2 MEDIUM (NaN-Trust fail-open, Servername-Kanonisierung→Split-Brain) + LOW gefixt |

**CO:** ADR-028-Konsens + D4-Arbeitslinien-Patch (#184: Discovery default-open, 3-Stufen self/gate/consensus). **CG:** —. **TS:** `mcp-service-registry.test.ts` (17: Capability-Bau, Tier-Ableitung fail-closed, Multi-Provider, Offline-Skip, Case-Insensitivity, kein Allowlist), 1046 daemon unit grün, tsc 0, geänderte Dateien eslint-error-frei. **CR:** `pal:codereview` gpt-5.3-codex (full) — default-open + Tier-Ableitung bestätigt; 2 MEDIUM + LOW gefixt. **PC:** `pal:precommit` — 0 Blocker. **DO:** CHANGES (v0.34.15), COMPLIANCE.

**Status:** ADR-028 D4-a — reines, getestetes MCP-Service-Capability-Modell (`buildMcpCapability`/`deriveExecutionTier`/`resolveMcp`), Discovery default-open, Ausführungsrisiko via `self|gate|consensus`. **Kein Wiring/Routing/Endpoint, kein Deploy, kein Flag-Flip.** Folge: D4-a-Teil-2 (Live-Registrierung als shared-MCP + `/api/capabilities`-Filter + `resolve_mcp`-Primitive), dann D4-b (MCP-Proxy-Routing).

---

## Session 2026-06-20 12:42 — v0.34.16 (DRAFT) feat(discovery): ADR-028 D4-a Teil 2 Shared-MCP-Config (rein)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.16 | #186  | 2026-06-20 12:42 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex: 0 Findings; 1 optionaler Härtungstest (kein Falsy-Coercion) ergänzt |

**CO:** ADR-028-Konsens + D4-Patch (#184, gemergt: Discovery default-open). **CG:** —. **TS:** `mcp-share-config.test.ts` (13: default-open, opt-out nur via `false`, kein Falsy-Coercion, Defaults, alle Fehlformen, `enabledSharedMcps`), 1042 daemon unit grün, tsc 0, eslint-error-frei. **CR:** `pal:codereview` gpt-5.3-codex (full) — 0 Findings, alle 4 Kriterien erfüllt. **PC:** `pal:precommit` — 0 Blocker. **DO:** CHANGES (v0.34.16), COMPLIANCE.

**Status:** ADR-028 D4-a Teil 2 — reiner Shared-MCP-Config-Parser (`parseSharedMcpConfig`/`enabledSharedMcps`), Discovery default-open, opt-out via `share=false`. **Unblocked** (kein Import aus #185, das inzwischen gemergt ist), **kein Wiring/Endpoint/Deploy/Flag-Flip.** Folge: Registrierung der enabled Shared-MCPs als `mcp:<server>`-Capability via `buildMcpCapability` (#185) + `resolve_mcp`-Primitive.

---

## Session 2026-06-20 16:25 — v0.34.17 (DRAFT) feat(discovery): ADR-028 D4-a Shared-MCP-Registrierungs-Komposition

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.17 | (neu) | 2026-06-20 16:25 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex: 0 funktionale Blocker; MEDIUM (Owner-Gating-Override-Regressionstest) ergänzt |

**CO:** ADR-028-Konsens + D4-Patch (#184). **CG:** —. **TS:** `mcp-registration.test.ts` (9: Komposition, default-open, execution_tier-Strip→kein CRDT-Leak, fail-fast/fail-soft, Owner-Gating-Override-Ignoranz, Mock-Registry), 1068 daemon unit grün, tsc 0, eslint-error-frei. **CR:** `pal:codereview` gpt-5.3-codex (full) — Leak-Pfad geschlossen, 2-Stufen-Fehler korrekt; MEDIUM-Test ergänzt. **PC:** `pal:precommit` — 0 Blocker. **DO:** CHANGES (v0.34.17), COMPLIANCE.

**Status:** ADR-028 D4-a — Registrierungs-Komposition (`buildSharedMcpCapabilities`/`registerSharedMcps`) verbindet #185+#186 zu owner-gegateten `mcp:<server>`-Capabilities. **Kein Routing/Endpoint/Cert/Flag, kein Deploy.** Folge: Boot-Verdrahtung (Config `mcp.share` in config.ts + Aufruf beim Daemon-Start), dann D4-b (MCP-Proxy-Routing).

---

## Session 2026-06-20 17:10 — v0.34.18 (DRAFT) feat(discovery): ADR-028 D4-a Boot-Verdrahtung (mcp.share)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.18 | (neu) | 2026-06-20 17:10 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex: MEDIUM (deepMerge Array-Target-Härtung) + 2 LOW (Error-Objekt-Log, Negativ-Shape-Test) gefixt |

**CO:** ADR-028-Konsens + D4-Patch (#184). **CG:** —. **TS:** `config-mcp-share.test.ts` (3: Default, `[[mcp.share]]`-Parse, mis-shaped `[mcp.share]`→Nicht-Array), 1071 daemon unit grün, tsc 0, keine NEUEN eslint-Errors (index.ts:268 `tlsBundle!` ist pre-existing). **CR:** `pal:codereview` gpt-5.3-codex (full) — Boot-Wiring korrekt + owner-gegated; MEDIUM+2LOW gefixt. **PC:** `pal:precommit` — 0 Blocker. **DO:** CHANGES (v0.34.18), COMPLIANCE, `config/daemon.toml`-Doku.

**Status:** ADR-028 D4-a Boot-Verdrahtung — `mcp.share`-Config wird beim Daemon-Start gelesen + via `registerSharedMcps` als owner-gegatete `mcp:<server>`-Capabilities registriert (Discovery default-open, fail-soft im try/catch). **Kein Routing/Endpoint/Cert/Flag, kein Deploy.** Folge: **D4-b** (MCP-Proxy-Ingress `/api/mcp/<server>` + Forward-Routing über mTLS, D2/D3-Interlock).

---

## Session 2026-06-20 17:35 — v0.34.19 (DRAFT) feat(discovery): ADR-028 D4-b (Start) MCP-Routing-Entscheidung

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.19 | (neu) | 2026-06-20 17:35 | ✅  | —  | ✅ | ✅ | ✅ | ✅ | CR gpt-5.3-codex: MEDIUM (skill_id-fail-closed Filter) + 2 LOW (Tie-Break-/Purity-Test) gefixt |

**CO:** ADR-028-Konsens + D4-Patch (#184). **CG:** —. **TS:** `mcp-routing.test.ts` (11: self/remote/none, self-Präferenz, healthy>degraded, Tie-Break, offline-Skip, fail-closed-mis-wired, Case-Insensitivity, Purity), 1082 daemon unit grün, tsc 0, eslint-error-frei. **CR:** `pal:codereview` gpt-5.3-codex (full) — reine Entscheidung korrekt; MEDIUM+2LOW gefixt. **PC:** `pal:precommit` — 0 Blocker. **DO:** CHANGES (v0.34.19), COMPLIANCE.

**Status:** ADR-028 D4-b Start — reiner Routing-Planner (`planMcpRoute`: self/remote/none, Provider-Wahl, fail-closed skill_id-Filter). **KEIN Endpoint/Forward/mcporter/Cert/Flag, kein Deploy.** Folge-Slices: `/api/mcp/<server>`-Ingress (D3-Sender-Binding) → mTLS-Forward (D2-Server-Identity) → lokaler mcporter-Exec.

---

## Session 2026-06-22 21:50 — v0.34.20 fix(tls): ADR-024 Rollout-Gate — die 2 MERGE-blockierenden MEDIUMs (#165)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.20 | (neu) | 2026-06-22 21:50 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude (codereviewer): 0 CRITICAL/HIGH; 1 MEDIUM (Test-Coverage-Lücke downstream `caValid`) → mit 2 Tests geschlossen |

**CO/CG:** — (reiner Bug-Fix, schließt bekannte CR/PC-MEDIUMs aus #165). **TS:** `tls.test.ts` +9 → 30 (MEDIUM-1: CA-Gültigkeit gültig/abgelaufen/noch-nicht-gültig fail-closed; MEDIUM-2: `selectTrustDistributionCa` Issuer-/eigene-CA-Wahl, falsche+abgelaufene-erst-Kandidat-Skip, fail-closed-Fälle; Retention-Regression bei abgelaufener Attesting-CA). 1093 daemon unit grün, 6 integration grün, tsc 0. **CR:** clink **claude** codereviewer (Hausregel: nur claude/codex/agy, **nie MiniMax/pal:chat**; codex-CLI nicht installiert) — 0 CRITICAL/HIGH, 1 MEDIUM gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.20), COMPLIANCE, TODO.md.

**Status:** ADR-024 Rollout-Gate-MEDIUMs geschlossen — (1) `verifyPeerCert` prüft CA-Gültigkeitsfenster fail-closed; (2) Trust-Distribution wählt fail-closed nur eine CA, die das eigene Serving-Cert verifiziert, sonst keine Pairing-Registrierung. **KEIN Deploy/Re-Enroll/Flag-Flip.** getPeerId-Teil von B7 bereits via #175 (4b55f69) auf main. Offen für Gate #8 (Christian): Merge dieses PR → dann Re-Enroll-Voraussetzung erfüllt (Re-Enroll/100%-canonical-Emit bleibt separates Christian-Gate).

---

*Letzte Aktualisierung: 2026-06-22 21:50 — v0.34.20 fix(tls): ADR-024 Rollout-Gate — 2 MEDIUMs (#165) geschlossen.*

---

## Session 2026-06-23 10:30 — v0.34.21 feat(macos): ADR-029 LaunchDaemon — Template + Render-Kern (Prep)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.21 | (neu) | 2026-06-23 10:30 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude (codereviewer): 1 HIGH (XML-Escaping/Element-Injection) + 1 MEDIUM (`{{lowercase}}`-Bypass) → beide gefixt + 4 Regressionstests |

**CO/CG:** — (beschlossenes Backlog-Item B6 „LaunchDaemon-Umstieg", kein Architektur-Konflikt). **TS:** `launchd-plist.test.ts` (19: Validierung, Render, Fail-closed, CR-Regression XML-Escaping/Injection/lowercase, Template-Regression). 1112 daemon unit grün, tsc 0. **CR:** clink **claude** codereviewer (Hausregel: nur claude/codex/agy, **nie MiniMax/pal:chat**; codex-CLI nicht installiert) — 1 HIGH + 1 MEDIUM gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.21), COMPLIANCE, TODO, ADR-029.

**Status:** ADR-029-Prep deploy-frei — System-Domain-Plist-Template + getesteter, fail-closed Render-Kern (`launchd-plist.ts`). **KEIN Installer-Umbau, kein `launchctl`/`bootstrap`, kein Deploy/Install.** Offen für Christian-Gate: `install_macos_service`-Umbau auf `bootstrap system` + `/Library/LaunchDaemons/`, Service-User-Anlage, README/INSTALL-Umstellung, Live-Install/Reboot (FileVault).

---

## Session 2026-06-23 11:05 — v0.34.22 feat(discovery): ADR-028 D4-b MCP-Forward-Spec-Builder (Prep)

(v0.34.21 = ADR-029 LaunchDaemon-Prep auf separatem Branch/PR #192.)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.22 | (neu) | 2026-06-23 11:05 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude (codereviewer): 0 CRITICAL/HIGH; 1 MEDIUM (URL-Base statt `parsed.origin` → Path/Query/Userinfo-Pollution) → gefixt + 2 Regressionstests |

**CO/CG:** — (Folge-Slice eines akzeptierten ADR-028 D4; kein neuer Architektur-Konflikt). **TS:** `mcp-forward.test.ts` (14: none/local/remote, URL/Sender/Tier/Pin, Flag, trailing-slash, Servername-Encoding, CR-Regression origin/userinfo, fail-closed kein/leer/nicht-HTTPS/ungültig/leerer-Sender, local-exec ohne Sender). 1107 daemon unit grün, tsc 0. **CR:** clink **claude** codereviewer (Hausregel: nur claude/codex/agy, **nie MiniMax/pal:chat**; codex-CLI nicht installiert) — 0 CRITICAL/HIGH, 1 MEDIUM gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.22), COMPLIANCE, ADR-028-D4-Notiz.

**Status:** ADR-028 D4-b Forward-Spec — reiner `buildMcpForwardSpec` (local-exec/remote-forward/unavailable, fail-closed, D2-Pin + D3-Sender in der Spec). **KEIN `/api/mcp`-Ingress, kein echter mTLS-Forward, kein mcporter-Exec, kein Deploy.** Folge-Slices (Christian-Gate): Fastify-Ingress `/api/mcp/<server>` → undici-mTLS-Forward (D2-Dispatcher) → lokaler mcporter-Exec → 3-Stufen-Enforcement (D4-d).

---

*Letzte Aktualisierung: 2026-06-23 11:05 — v0.34.22 feat(discovery): ADR-028 D4-b MCP-Forward-Spec-Builder (Prep).*

---

## Session 2026-06-23 13:30 — v0.34.24 feat(macos): ADR-029 Installer auf System-Domain-LaunchDaemon operationalisiert

(v0.34.23 = ADR-028 D4-b D2-Forward-Dispatch auf separatem Branch/PR #195.)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.24 | (neu) | 2026-06-23 13:30 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude (codereviewer): 3 MEDIUM (eval-Injection via SUDO_USER, bootout-Label-Drift, cleanup `$HOME` statt Lauf-Nutzer-Home) + 2 LOW (sed-`&`-Escaping, leere NODE_BIN) → ALLE gefixt |

**CO/CG:** — (Operationalisierung des beschlossenen B6/ADR-029; kein Architektur-Konflikt). **TS:** `launchd-plist.test.ts` +4 → 23 (`buildLaunchDaemonInstallPlan`: System-Domain-Pfad/root:wheel/644/bootstrap+bootout-Label, Legacy-Pfad aus userHome, fail-closed userHome, kein LaunchAgents-Ziel). `bash -n` clean, 1130 daemon unit grün, tsc 0. **CR:** clink **claude** codereviewer (Hausregel: nur claude/codex/agy, **nie MiniMax/pal:chat**; codex-CLI nicht installiert) — 3 MEDIUM + 2 LOW gefixt (Username-Validierung+dscl vor eval, sed-Escaping, NODE_BIN-Guard, Label-Form, Lauf-Nutzer-Home). **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.24), COMPLIANCE, ADR-029.

**Status:** ADR-029 operationalisiert — `install.sh` (macOS) nutzt das System-Domain-LaunchDaemon-Template + getesteten Install-Plan (headless/FileVault, Least-Privilege, kein mystery-relauncher), inkl. Legacy-LaunchAgent-Migration. **Reines Skript-/Code-Edit — `install.sh` NICHT ausgeführt.** Offen für Christian-Deploy-Gate: tatsächliches Ausführen von `install.sh`/`bootstrap system`, Service-User-Anlage, Live-Install/Reboot (FileVault).

---

*Letzte Aktualisierung: 2026-06-23 13:30 — v0.34.24 feat(macos): ADR-029 Installer auf System-Domain-LaunchDaemon operationalisiert.*

---

## Session 2026-06-24 07:32 — v0.34.26 + v0.34.25 ADR-028 D4-b (D2-Forward Exec-Schicht #198 + /api/mcp-Ingress-Handler #199)

| #        | PR              | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-----------------|------------------|-----|----|----|----|----|----|----|
| v0.34.26 | (#198, base=main) | 2026-06-24 06:47 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude + agy (Zweitstimme): 0 CRITICAL/HIGH; 2 MEDIUM (Exhaustiveness-`never`-Guard, leerer `expectedSpiffeId` umgeht XOR) → gefixt + Regressionstests |
| v0.34.25 | (#199 Re-PR, base=main) | 2026-06-24 07:05 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude (im Original-#197): 0 CRITICAL/HIGH; 2 MEDIUM (`execute`-Typ `Exclude<…,none>`, `try/catch`→500 Vertrag) → gefixt + Regressionstest. Code byte-identisch zu #197-Cherry-pick. |

**v0.34.26 — D2-Forward Exec-Schicht (Skelett, #198):** `buildMcpExecSpec` (mcporter-local-Stub / mtls-forward / reject), fail-closed, D2-Pin-Re-Check. **mcporter-`argv` = provisorischer Platzhalter** (kein stabiler CLI-Vertrag; ADR-023). **KEIN Net-Egress, kein mcporter-Call, kein Live-Wiring, kein Deploy.** Folge-Slices (Christian-Gate): echter undici-mTLS-Forward-Executor + mcporter-`spawn` + Fastify-Route-Wiring + 3-Stufen-Enforcement (D4-d).

**v0.34.25 — /api/mcp-Ingress-Handler-Logik (#199 Re-PR):** `handleMcpIngress` (D3-Auth-Gate → resolve/plan/spec/dispatch → injizierter Executor), fail-closed, D2-Pin/D3-Sender konsistent zu #195. **KEIN Net-Egress, kein Fastify-Wiring in den Live-Server, kein mcporter-Exec, kein Deploy.** **Re-PR:** Original-#197 wurde in den bereits-gemergten #195-Branch gemergt → Code kam nie auf main; #199 cherry-pickt `374d6f7` sauber auf einen frischen Branch gegen `origin/main` (Code-Dateien konfliktfrei; CHANGES/COMPLIANCE/ADR-Doku-Konflikt nach #198-Merge aufgelöst, beide Einträge behalten).

**CO/CG:** — (Folge-Slice akzeptiertes ADR-028 D4). **TS:** v0.34.26 `mcp-forward-exec.test.ts` (12: Happy-Path local/remote, Plan-Mismatch, Pin-Violation beide Richtungen + leerer String, Timeout-Stub, Auth-Reject, configPath, Stub-Konstante, fail-fast unbekannter kind); v0.34.25 `mcp-ingress.test.ts` (12: Auth-Gate null/unauth, Happy-Path local+remote, Invalid-Plan/offline/kein-Endpoint→503, Reject-on-Mismatch, 400 missing-server, mTLS-Pin-Konsistenz+TOFU, 500-Throw-Abfang). Daemon-unit-Suite grün, tsc 0. **Live read-only `/healthz` (mTLS):** Daemon erreichbar (`/healthz`=404 Route absent, `/health`=200 ~3.8 ms). **CR:** Hausregel — nur claude/codex/agy, **nie MiniMax/pal:chat**; codex bis 25.06 quota-gesperrt). **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.26 + v0.34.25), COMPLIANCE, ADR-028-D4-Notiz.

**Status:** ADR-028 D4-b **D2-Forward + Ingress-Handler komplett** (Skelett + Handler-Logik) — beide PRs als squash-merge über admin-override (Self-Approval-Block) gelandet. Re-PR-Mechanismus hat funktioniert (Cherry-pick gegen main, Code byte-identisch zu bereits-reviewtem Original).

---

*Letzte Aktualisierung: 2026-06-24 07:32 — v0.34.26 + v0.34.25 ADR-028 D4-b (#198 + #199) gemergt.*

---

## Session 2026-06-25 10:05 — v0.34.28 feat(macos): ADR-029 Homebrew-Formel + USER-GUIDE auf System-Domain-Semantik angeglichen

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.28 | (neu, base=main) | 2026-06-25 10:05 | —   | —  | ⚠️ | ✅ | ✅ | ✅ | CR clink claude: DSL korrekt; 2 MEDIUM (Caveat-Pfad relativ→`#{libexec}`; SIGTERM-Exit-0-Abhängigkeit) → gefixt/verifiziert |

**CO/CG:** — (Konsistenz-Slice eines bereits gemergten ADR-029). **TS:** ⚠️ kein TS geändert → keine neuen Unit-Tests; `ruby`/`brew` auf dem Linux-Host n/a → Formel per Inspektion gegen Homebrew-`service`-DSL geprüft; SIGTERM→`exit(0)` in `index.ts:1304` verifiziert (sichert `KeepAlive{SuccessfulExit:false}`-Korrektheit). tsc 0, daemon-unit-Suite 1164 grün (keine Regression). **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat) — 0 CRITICAL/HIGH, 2 MEDIUM gefixt. **PC:** `pal:precommit` internal. **DO:** CHANGES (v0.34.28), COMPLIANCE, TODO.

**Status:** ADR-029-Konsistenz — Homebrew-`service do` auf `keep_alive successful_exit: false` + `run_type :immediate` + ADR-029-Caveat (headless→System-Domain-Installer); USER-GUIDE macOS-Pfad auf `/Library/LaunchDaemons/`. **Reines Formel-/Doku-Edit — kein `brew`/`install.sh`-Run, kein Deploy.** Live-Install bleibt Christians Deploy-Gate.

---

*Letzte Aktualisierung: 2026-06-25 10:05 — v0.34.28 feat(macos): ADR-029 Homebrew-Formel + USER-GUIDE System-Domain-Semantik.*

---

## Session 2026-06-25 13:05 — v0.34.29 docs(todo): ADR-024/ADR-029-Status gegen main abgeglichen

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.29 | (neu, base=main) | 2026-06-25 13:05 | —   | —  | n/a (docs-only) | ✅ | ✅ | ✅ | Reine TODO-Status-Hygiene; gemergte Items (#191/#196/#201) waren noch als „offen" markiert |

**CO/CG:** — (docs-only Reconcile). **TS:** n/a (kein Code; Status-Aussagen gegen gh/git verifiziert: #191 gemergt 2026-06-23, #196 + #201 gemergt 2026-06-25). **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat). **PC:** `pal:precommit` internal. **DO:** CHANGES (v0.34.29), COMPLIANCE.

**Status:** TODO.md gegen main abgeglichen — ADR-024-Gate (Code via #191 auf main; offen nur Re-Enroll=Deploy-Gate) + ADR-029-Installer-Sub-Items (#196/#200/#201 erledigt; offen nur Live-Install=Deploy-Gate). Keine Code-/Verhaltens-Änderung.

---

*Letzte Aktualisierung: 2026-06-25 13:05 — v0.34.29 docs(todo): ADR-024/ADR-029-Status gegen main abgeglichen.*

---

## Session 2026-06-25 14:35 — v0.34.30 feat(macos): ADR-029 Installer-Legacy-Migration reversibel (.disabled-Backup)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.30 | (#203, base=main) | 2026-06-25 14:35 | —   | —  | ⚠️ | ✅ | ✅ | ✅ | CR clink claude: Bash-Migration `rm`→`mv .disabled.<ts>` (reversibel); **Post-Review CR-MEDIUM** (`cleanup_existing` löschte Legacy-Agent → reinstall/update irreversibel) gefixt: cleanup löscht nicht mehr, Backup zentral in `install_macos_service`; **Post-Review CR-AMBER** (`cleanup_existing` prüfte `darwin` statt `macos` → macOS-Block toter Code) + **CR-Re-Review** (`set -e`: ungeschützte `launchctl unload` → reinstall-Abbruch, `|| true` ergänzt) gefixt |

**CO/CG:** — (letzter ADR-029-Installer-Sub-Punkt, TODO:354). **TS:** ⚠️ Bash (kein TS) → `bash -n` clean + Backup-Logik smoke-getestet (`legacy.plist`→`.disabled.<ts>`); daemon-unit-Suite unverändert grün (kein TS geändert). **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat). **PC:** `pal:precommit` internal. **DO:** CHANGES (v0.34.30), COMPLIANCE, TODO.

**Status:** ADR-029 — LaunchAgent→LaunchDaemon-Migration jetzt **reversibel** (`unload` + `mv` → `.disabled.<datum>` statt `rm`), Rollback möglich. Durable-Behavior (KeepAlive{SuccessfulExit:false}/RunAtLoad/FileVault/kein mystery-relauncher) war schon vollständig auf main (#192/#196/#201). **Reines Skript-Edit — kein `install.sh`-Run, kein Deploy.** Live-Install bleibt Christians Deploy-Gate.

---

*Letzte Aktualisierung: 2026-06-25 14:35 — v0.34.30 feat(macos): ADR-029 Installer-Legacy-Migration reversibel.*

---

## Session 2026-06-26 09:05 — v0.34.31 test(libp2p): B7 getPeerId-Repro + Regressionstest

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.31 | (neu, base=main) | 2026-06-26 09:05 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude GREEN; Regressionstest empirisch bewiesen (Fix-Revert → 5 rot, restore → grün) |

**CO/CG:** — (Test-Härtung eines gemergten Fixes #175). **TS:** `libp2p-runtime.test.ts` +3 (REPRO: String→exakt `getPeerId is not a function`; FIX dial+hangUp: PeerId-Objekt-Pfad). **Empirischer Guard-Beleg:** Fix temporär revertiert → `FIX:`-Tests + 3 bestehende getPeerId-Tests ROT (5 failed); restore → 1167 grün. tsc 0. **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat) — GREEN, faithful repro/kein false-negative. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.31), COMPLIANCE.

**Status:** B7 getPeerId — Code-Fix war via #175 (4b55f69) auf main; jetzt **expliziter Repro + Regressionstest** an die reale Fehlersignatur gebunden (test-only, kein Prod-Code). Live-`converged:false` bleibt deploy-abhängig (#194-Diagnose) = Christian-Deploy-Gate.

---

*Letzte Aktualisierung: 2026-06-26 09:05 — v0.34.31 test(libp2p): B7 getPeerId-Repro + Regressionstest.*

---

## Session 2026-06-26 12:02 — v0.34.32 docs(todo): B7 getPeerId Regression-Proof #204 im Status nachgezogen

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.32 | (neu, base=main) | 2026-06-26 12:02 | —   | —  | n/a (docs) | — | — | ✅ | TODO:29 nannte nur #175 → #204-Regression-Proof ergänzt; offen nur Deploy-Gate |

**CO/CG/CR/PC:** — (reine TODO-Status-Hygiene, kein Code). **TS:** n/a. **DO:** TODO.md (#175+#204), CHANGES (v0.34.32), COMPLIANCE. **Status:** B7 repo-seitig vollständig (Code #175 + Regression-Proof #204); offen nur Live-`converged`-Deploy-Gate (#194). Keine Code-/Verhaltens-Änderung.

---

*Letzte Aktualisierung: 2026-06-26 12:02 — v0.34.32 docs(todo): B7 Regression-Proof #204 im Status nachgezogen.*

---

## Session 2026-06-27 06:40 — v0.34.33 test(tls): Regressionstest eigene-CA-Gültigkeit beim Reuse (PR #77)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.33 | (neu, base=main) | 2026-06-27 06:40 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude GREEN; ungebachter `caValid`-Reissue-Pfad (PR #77) empirisch festgenagelt (Bruch → 2 rot, restore → grün); 1 LOW (DAY-Shadow) gefixt |

**CO/CG:** — (Test-Härtung eines bestehenden security-Checks). **TS:** `tls.test.ts` +2 (eigene CA abgelaufen/noch-nicht-gültig → CA-Reissue). Empirischer Coverage-Beleg: `caValid` (tls.ts:218) brechen → all-30-grün (Gap), nach Tests → Bruch macht 2 ROT, restore → 32 grün. tsc 0, full 1169 grün. **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat) — GREEN, 1 LOW gefixt. **PC:** `pal:precommit` internal — 0 Issues. **DO:** CHANGES (v0.34.33), COMPLIANCE.

**Status:** TLS-Härtung test-only — der PR-#77-Pfad „eigene CA abgelaufen/noch-nicht-gültig → Reissue" ist jetzt fail-closed test-bewacht (war ungetestet). Keine Produktiv-Code-Änderung; gleicher cert-validity-fail-closed-Strang wie ADR-024 MEDIUM-1.

---

*Letzte Aktualisierung: 2026-06-27 06:40 — v0.34.33 test(tls): Regressionstest eigene-CA-Gültigkeit beim Reuse (PR #77).*

---

## Session 2026-06-27 10:05 — v0.34.34 feat(discovery): ADR-028 NIC-Auswahl — allowed_mesh_cidrs überstimmt tailscale*/utun*-Exclude

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.34 | (neu, base=main) | 2026-06-27 10:05 | —   | —  | ✅ | ✅ | ✅ | ✅ | CR clink claude; allowed-CIDR-Override (default-neutral) + 5 Tests, empirisch guard-bewiesen |

**CO/CG:** — (design-first ADR-028-Note vor Code; kleinster sicherer Slice). **TS:** `discovery-policy.test.ts` +5 → 47 (Override, LAN+Tailscale-Koexistenz, nur-erlaubte-CIDR, docker0-bleibt-aus, default-neutral). Empirischer Beleg: Override-Block raus → ADR-028-Tests rot, re-applied → 1174 grün. tsc 0. **CR:** clink **claude** codereviewer (nur claude/codex/agy, nie MiniMax/pal:chat). **PC:** `pal:precommit` internal. **DO:** CHANGES (v0.34.34), COMPLIANCE, ADR-028-Note, TODO:30.

---

**Status:** ADR-028 NIC-Auswahl — `selectMeshInterfaces` lässt eine IP in explizit gesetztem `allowed_mesh_cidrs` den `tailscale*/utun*`-Exclude überstimmen (Overlay-Self-Advertise). Default-neutral, rein/testbar. **Kein Deploy/Cert/Flag;** Live-Aktivierung auf `.55` = Christian-Deploy-Gate (Pfad A).

---

## Session 2026-06-29 14:42 — v0.34.36 fix(cert): Recovery-/Rotation-Helper auf kanonische TLS-/Pairing-Pfade migriert

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.36 | (#209, base=main) | 2026-06-29 14:42 | —   | —  | ✅ | ✅ | — | ✅ | PR #208 Follow-up: Legacy-Pfad-Mismatch gefixt; codex review GREEN |

**CO/CG:** — (kleiner Bug-Fix fuer empirisch belegten Legacy-Pfad-Mismatch aus v0.34.35). **TS:** `cert-rotation.test.ts` +3 und `recovery.test.ts` +1; `cd packages/daemon && npx vitest run src/cert-rotation.test.ts src/recovery.test.ts` gruen; `npm run daemon:build` gruen. **CR:** `codex review --uncommitted` auf PR-Branch/Head `3c1fb8c` — keine actionable correctness issues; nach Compliance-Fix Head `c72fbe7` nur CHANGES.md ergaenzt. **PC:** — (pal/precommit nicht genutzt; kein MiniMax/pal:chat). **DO:** CHANGES (v0.34.36), COMPLIANCE, `changes/2026-06-29_cert-recovery-canonical-paths.md`.

**Status:** `rotateCert()`, `trustReset()`, `runRecoveryChecks()` und `auditCerts()` verwenden jetzt die kanonischen Runtime-Pfade `tls/node.crt.pem`, `tls/node.key.pem` und `pairing/paired-peers.json` statt der alten `certs/node.*`-/`pairing-store.json`-Pfade. Kein Deploy.

---

## Session 2026-06-29 16:15 — v0.34.37 perf(daemon): Startpfad `tsx` → `node dist/` (T1.1 / V5 Spur 1)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.37 | (#210, base=main) | 2026-06-29 16:15 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Rebase nach #209-Merge; CR Claude-Subagent APPROVE-WITH-NITS (alle low/info); RSS −34 % / Start-CPU −43 % gemessen; Regressionstest empirisch guard-bewiesen |

**CO/CG:** n/a — keine Architektur-/Design-Frage, `tsx→dist` ist bereits gebundene Tech-Entscheidung (V5 T1.1); reiner Perf/Packaging-Slice. **TS:** `start-path.test.ts` (neu, 4 Tests); volle Daemon-Suite 96 Files / **1178 grün** (auch nach Rebase auf main re-verifiziert). Empirischer Beleg: ExecStart→tsx zurückgedreht ⇒ 1 rot, restauriert ⇒ 4 grün. Messung 3×Median: RSS 201→132 MiB, Start-CPU 2.08→1.19 s. **CR:** unabhängiger **Claude**-Subagent-Review (nur claude/codex/agy — `agy`-Backend von `pal:codereview` im Env nicht installiert, daher Claude-Subagent als echtes Review). APPROVE-WITH-NITS, 0× HIGH/CRITICAL. **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.37), COMPLIANCE, `changes/2026-06-29_t11-tsx-to-node-dist.md`. **Status:** Repo-Slice durch; Live-Cutover TH01 (build vor Restart) bleibt gateter Deploy-Schritt.

---

## Session 2026-06-29 17:15 — v0.34.38 feat(storage): SQLite WAL-Checkpoint + Retention (T1.3 / V5 Spur 1, ADR-030)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.38 | (#211, base=main) | 2026-06-29 17:15 | △ ADR | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE-WITH-NITS (kein Bug); beide Low-Nits adressiert; Retention empirisch guard-bewiesen |

**CO/CG:** CO via **ADR-030** (Design-Doku VOR Code) — `pal:consensus` extern nicht verfügbar (`agy`-Backend fehlt im Env), daher explizite konservative Design-Begründung; default-sicher (kein Eingriff in die signierte Audit-Chain). CG n/a. **TS:** `retention.test.ts` (neu, 10 Tests): checkpoint `busy===0`, peer-/revoked-Retention (alt weg, neu/aktiv bleibt), **lokale Chain unangetastet**, `0`=No-Op, config-Defaults/Env/Validierung. Volle Suite **99 Files / 1195 grün**, tsc 0. Empirischer Beleg: Cutoff `<`→`>` invertiert ⇒ 1 rot, restauriert ⇒ 10 grün. **CR:** unabhängiger **Claude**-Subagent-Review (nur claude/codex/agy — `agy` fehlt im Env). APPROVE-WITH-NITS, 0× HIGH/CRITICAL; busy-Logging + `busy===0`-Assertion als Reaktion ergänzt. **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.38), COMPLIANCE, ADR-030, `changes/2026-06-29_t13-sqlite-wal-checkpoint-retention.md`. **Status:** Repo-Slice durch; kein Deploy.

---

## Session 2026-06-29 17:40 — v0.34.39 test(cert): RE-CHECK Cert/Rotation — Verdikt festgenagelt (KW27)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.39 | (#212, base=main) | 2026-06-29 17:40 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Evidence/Test-only; Verdikt: cert-rotation.ts tot, Rotation feuert nur beim Start, kein Timer → T2.1 gerechtfertigt; empirisch guard-bewiesen |

**CO/CG:** n/a — reiner Evidence-/Verdikt-Slice (kein Produktionscode, keine Design-Frage). **TS:** `cert-rotation-recheck.test.ts` (neu, 4 Tests): 30-Tage→behalten, 3-Tage→Reissue-beim-Load, Reissue-nur-auf-Load, `cert-rotation.ts`-Importeure=0. Volle Suite **100 Files / 1199 grün**, tsc 0. Empirischer Beleg: Reissue-Gate `daysLeft > 7` → `> 0` mutiert ⇒ 1 rot, restauriert ⇒ 4 grün. **CR:** unabhängiger **Claude**-Subagent-Review (nur claude/codex/agy — `agy` fehlt im Env). **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.39), COMPLIANCE, `changes/2026-06-29_cert-rotation-recheck-verdict.md`. **Status:** Verdikt belegt; **Folge-Slice = T2.1** (laufender Cert-Check + Alert + Reissue/Hot-Reload). Kein Deploy.

---

## Session 2026-06-29 18:15 — v0.34.40 feat(cert): Live-Cert-Ablauf-Monitor + <30d-Alert (T2.1 / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.40 | (#213, base=main) | 2026-06-29 18:15 | △ #212 | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE-WITH-NITS; CR-LOW (warn>critical) gefixt+getestet, CR-MEDIUM (Push-Sink) als T2.2/T2.3-Scope-Grenze; empirisch guard-bewiesen |

**CO/CG:** CO via RE-CHECK-Verdikt #212 (Design dort empfohlen: laufender Check + Alert + Reissue-bei-Neustart). CG n/a. **TS:** `cert-expiry-monitor.test.ts` (neu, 17 Tests): classify-Grenzen, runCheck-Gating (Audit/Emit nur warn/critical, „Neustart"-Hinweis), periodischer Re-Check (Fake-Timer = T2.1-Kern), Crash-Sicherheit, config Defaults/Env/`warn<=critical`-throw. Volle Suite **101 Files / 1216 grün**, tsc 0, eslint 0. Empirischer Beleg: critical-Grenze `<=`→`<` mutiert ⇒ 1 rot, restauriert ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE-WITH-NITS, 0× HIGH/CRITICAL; CR-LOW gefixt, CR-MEDIUM dokumentierte Scope-Grenze. **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.40), COMPLIANCE, `changes/2026-06-29_t21-cert-expiry-monitor.md`. **Status:** Repo-Slice durch; Push-Sink = T2.2/T2.3; In-Process-Reissue = größerer Folge-Slice. Kein Deploy.

---

## Session 2026-06-29 18:40 — v0.34.41 fix(influx): Health-Probe-Fix + Skill-Health-Alert-Event (T2.2 / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.41 | (#214, base=main) | 2026-06-29 18:40 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE-WITH-NITS, Probe-Fix CORRECT; beide Nits adressiert; empirisch guard-bewiesen |

**CO/CG:** n/a — gezielter Bugfix (Root-Cause `/health` < 1.8 → 404 → false-negative) + kleines Alert-Event; keine Architektur-Frage. **TS:** `builtin-skills/influxdb.test.ts` (neu, 6 Tests): /health-200→healthy (kein /ping), /health-404→/ping-204→healthy (Regression), Netzwerkfehler→Fallback, beide-nicht-ok→unhealthy, beide-werfen→unhealthy, aborted-Signal→false. Volle Suite **102 Files / 1222 grün**, tsc 0, eslint 0. Empirischer Beleg: /ping-Fallback entfernt ⇒ 3 rot, restauriert ⇒ 6 grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE-WITH-NITS, 0× HIGH/CRITICAL; Nit-1 (`/ping`-Liveness im Doc) + Nit-2 (emit listener-isoliert) gefixt. **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.41), COMPLIANCE, `changes/2026-06-29_t22-influx-probe-alert-sink.md`. **Status:** Probe-/Daemon-Seite durch; Push-Zustellung (Telegram/Hermes) = Admin/Hermes-Seite. Kein Deploy.

---

## Session 2026-06-30 06:18 — v0.34.42 feat(placement): Resource-Attribute + place-or-refuse (T2.4 / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|----|
| v0.34.42 | (#215, base=main) | 2026-06-30 06:18 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE-WITH-NITS, Gate+Side-Map CORRECT; CR-MEDIUM (fail-open) gefixt+getestet; empirisch guard-bewiesen |

**CO/CG:** n/a — Implementierung gemäß vorgegebener V5-T2.4-Spec; Scope-Map (Explore) statt Design-Frage. **TS:** `place-or-refuse.test.ts` (neu, 14): computeRamUsedPercent (cache-bewusst/robust), evaluatePlacement (`>`-Grenzen, ==90→accept), Executor-Gate-Integration (RAM>90→capacity VOR Skill-Check, <90→normal, Mess-Fehler→fail-open), Registry-Side-Map, config Defaults/Env/Range; `dashboard-api.test.ts` +2 (503/404). Volle Suite **103 Files / 1238 grün**, tsc 0, eslint 0. Empirischer Beleg: Gate `>`→`>=` mutiert ⇒ ==90-Test rot, restauriert ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE-WITH-NITS, 0× HIGH/CRITICAL; CR-MEDIUM (Gate ohne try/catch) → fail-open gefixt. **PC:** `pal:precommit` (s. PR-Body). **DO:** CHANGES (v0.34.42), COMPLIANCE, `changes/2026-06-30_t24-resource-attrs-place-or-refuse.md`. **Status:** Repo-Slice durch; Mesh-Exposition der Attribute + CPU/agent_count-Heuristik = Folge-Slices. Kein Deploy.

---

## Session 2026-06-30 12:40 — v0.34.43 fix(telegram): Alert-Events in Daemon-Telegram-Sink verdrahten (T2.2-Follow-up / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.43 | (offen, base=main) | 2026-06-30 12:40 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE, 0× HIGH/CRITICAL, Regression-Preservation der 6 alten Cases bestätigt; 1 LOW-Nit (daysLeft-Guard) adressiert; empirisch guard-bewiesen |

**CO/CG:** n/a — gezielter Bugfix einer Observability-Lücke (zwei gemergte Alert-Events fielen durch den Telegram-Switch); keine Architektur-Frage. **TS:** `telegram-gateway.test.ts` (neu, 11 — erste Testdatei des Moduls): skill_health ungesund/Recovery, cert_expiry warn/critical (Tier + Reissue-Hinweis), Regression der 6 bestehenden Cases, `null`-Spam-Unterdrückung (4 Typen). Volle Suite **104 Files / 1249 grün**, tsc 0, eslint 0. Empirischer Beleg: `system:skill_health`-Case entfernt ⇒ 2 rot, restauriert ⇒ 11 grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE, 0× HIGH/CRITICAL; Regression-Preservation der 6 alten Cases byte-identisch bestätigt; LOW-Nit (`daysLeft ?? '?'`) adressiert. **PC:** manuell (tsc/eslint/Suite grün, `git diff` reviewed — `agy`-Backend fehlt). **DO:** CHANGES (v0.34.43), COMPLIANCE, `changes/2026-06-30_t22-telegram-alert-sink-wire.md`. **Status:** Daemon-Sink durch; breiteres Hermes-Operator-Routing = Admin/Hermes-Seite. Kein Deploy.

---

## Session 2026-06-30 13:30 — v0.34.44 perf(daemon): Start tsx → node dist/ (T1.1 / V5 Spur 1)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.44 | (offen, base=main) | 2026-06-30 13:30 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE-WITH-FINDINGS; **CR-HIGH** (service.sh ohne Build vor bootstrap) gefixt+getestet, **CR-MEDIUM** (.ps1 Daemon-tsx) gefixt, **CR-LOW** (install.sh/.service-Regression-Test) ergänzt; empirisch guard-bewiesen |

**CO/CG:** n/a — vorgegebener V5-T1.1-Slice (Runtime-Umstellung), keine offene Design-Frage. **Belegt-erst (V5 §H):** RSS ~265→~166 MB (−~100 MB/−37 %), 2→1 Prozess, Boot ~1.1→~0.7 s (2 Läufe je Variante, reproduzierbare Harness). **TS:** `start-path.test.ts` (+6: install.sh-ExecStart+Build-Guard, statisches `.service`, Legacy-Plist, `service.sh ensure_daemon_built` inkl. Reihenfolge-Check = CR-HIGH-Regression, `ssh-bootstrap`-pkill, `.ps1`-Entry) + `launchd-plist.test.ts` (+1: gerendertes `ProgramArguments == [node, dist/index.js]`). Volle Suite **104 Files / 1256 grün**, tsc 0, eslint 0, bash -n grün. Empirischer Beleg: Plist-Template auf tsx zurückmutiert ⇒ T1.1-Test rot, restauriert ⇒ grün; Smoke `node dist/index.js` bootet voll durch. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE-WITH-FINDINGS, 0× CRITICAL; CR-HIGH (service.sh) + CR-MEDIUM (.ps1) gefixt+getestet, CR-LOW (Regression-Coverage) ergänzt. **PC:** manuell (tsc/eslint/Suite/bash -n grün, `git diff` reviewed). **DO:** CHANGES (v0.34.44), COMPLIANCE, `changes/2026-06-30_t11-node-dist-start.md`. **Status:** Repo-Umstellung durch; scharfe Service-Neuinstallation = Christians Deploy-Gate. Kein Deploy.

---

## Session 2026-06-30 14:32 — v0.34.45 feat(placement): CPU/agent_count-Heuristik + Mesh-Exposition (T2.4-Folge / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.45 | (offen, base=main) | 2026-06-30 14:32 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE, 0× HIGH/CRITICAL; **CR-MEDIUM** (asymmetrisches fail-open CPU/agent-Reader) gefixt+getestet, **CR-LOW** (Wrapper-Divergenz dokumentiert + Test RAM-throw+CPU ergänzt), NIT (Funktion zwischen Imports) bereinigt; empirisch guard-bewiesen |

**CO/CG:** n/a — benannter T2.4-Folge-Slice (Out-of-scope-Liste aus #215), keine offene Design-Frage. **TS:** `place-or-refuse.test.ts` (+11, jetzt 25): `evaluatePlacementMetrics` (CPU/agents-Grenzen, ==→accept, 0=aus, null-skip, RAM→CPU→agents-Priorität), Executor-Integration (CPU/agent_count refuse + Fehlertext; deaktiviert→inert; **RAM-throw+CPU→CPU greift**; **CPU-Reader-throw→übersprungen, kein Crash**), config CPU/agent Defaults/Env/Range; `agent-card.test.ts` (neu, 3): `resources`-Exposition via Fastify-`inject()` (present/undefined-Snapshot/ohne Option). Volle Suite **105 Files / 1270 grün**, tsc 0, authored-files eslint 0 Errors. Empirischer Beleg: `exceeds` `>`→`>=` mutiert ⇒ 3 Grenz-Tests (RAM/CPU/agents) rot, restauriert ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE, 0× HIGH/CRITICAL; CR-MEDIUM (per-Dimension fail-open der CPU/agent-Reader via `safeReadDimension`) gefixt+getestet, CR-LOW (Wrapper-`<=0`-Divergenz dokumentiert; RAM-throw+CPU-Test ergänzt), NIT (describeLimit zwischen Imports) bereinigt. **PC:** manuell (tsc/eslint-authored/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.45), COMPLIANCE, `changes/2026-06-30_t24-cpu-agentcount-mesh-resource.md`. **Status:** Repo-Slice durch; Peer-Resource-basierte Routing-Auswahl (Anfrager wählt least-loaded) = Folge-Slice. Kein Deploy.

---

## Session 2026-06-30 15:23 — v0.34.46 feat(routing): Peer-Resource-basierte least-loaded-Auswahl (T2.4-Folge / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.46 | (offen, base=main) | 2026-06-30 15:23 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE, 0× HIGH/CRITICAL; **CR-MEDIUM** (peer-gelieferte resources ungeprüft → NaN-Vergleichs-Gift, Zero-Trust-LAN) gefixt via `buildLoadMap`-finite-Validierung + Regression-Test; LOW/NIT (self-Last-Grenze, volle Card-Shape) dokumentiert; empirisch guard-bewiesen |

**CO/CG:** n/a — benannter T2.4-Folge-Slice (least-loaded-Routing), keine offene Design-Frage. **TS:** `peer-selection.test.ts` (neu, 13): `compareLoad`-Ordnung, `pickLeastLoaded` (Min-Last/Gleichstand→früher/fail-open/partiell/Einzel/leer→wirft), `buildLoadMap` (valide/fehlend/**NaN/string/fehlendes-Feld ausgelassen**/Integration garbage-übersprungen); `dashboard-api.test.ts` (+2): `/api/peers` resources + null. Volle Suite **106 Files / 1285 grün**, tsc 0, authored-files eslint 0. Empirischer Beleg: Auswahl-Reduce invertiert ⇒ 3 Auswahl-Tests rot, restauriert ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE, 0× HIGH/CRITICAL; CR-MEDIUM (Zero-Trust-Validierung der Peer-resources) via `buildLoadMap` gefixt+getestet. **PC:** manuell (tsc/eslint-authored/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.46), COMPLIANCE, `changes/2026-06-30_t24-least-loaded-routing.md`. **Status:** Repo-Slice durch; Self-Last-Einbeziehung + Live-Zwei-Peer-Routing-Beweis (deploy-gegated) = Folge. Kein Deploy.

---

## Session 2026-06-30 16:09 — v0.34.47 feat(routing): Self-Last in der least-loaded-Auswahl (T2.4-Folge / V5 Spur 2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.47 | (offen, base=main) | 2026-06-30 16:09 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent merge-fähig, 0× HIGH/CRITICAL; Drei-Wege-Key-Match (write/read/candidate = selfIdentityUri) verifiziert; **CR-MEDIUM** (Wiring-Entscheidung untestbar) via reine `chooseTargetAgent`-Extraktion + 6 Tests gefixt; empirisch guard-bewiesen |

**CO/CG:** n/a — direkte #219-Folge (Self-Last), keine offene Design-Frage. **TS:** `peer-selection.test.ts` (+6, jetzt 20): `chooseTargetAgent` (explizit gefunden/nicht-Kandidat→null, self gewinnt bei geringster Last, ausgelasteter self→remote, fail-open→erster Kandidat, self-NaN→ausgeschlossen); `dashboard-api.test.ts` (+2): `/api/status` `resources` + Self-Key-Assertion + null. Volle Suite **106 Files / 1294 grün**, tsc 0, authored-files eslint 0. Empirischer Beleg: Self-Merge in `chooseTargetAgent` entfernt ⇒ „self gewinnt"-Test rot, restauriert ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). Merge-fähig, 0× HIGH/CRITICAL; CR-MEDIUM (untestbare `execute_remote_skill`-Entscheidung) via reine `chooseTargetAgent` extrahiert + getestet. **PC:** manuell (tsc/eslint-authored/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.47), COMPLIANCE, `changes/2026-06-30_t24-selfload-routing.md`. **Status:** Repo-Slice durch; Live-Zwei-Peer-Routing-Beweis (deploy-gegated) = Folge. Kein Deploy.

---

## Session 2026-06-30 16:39 — v0.34.48 chore(cert): cert-rotation.ts deprecaten (Cleanup)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.48 | (offen, base=main) | 2026-06-30 16:39 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE, 0× HIGH/CRITICAL/MEDIUM/LOW (2 kosmetische NITs); Deprecation verifiziert akkurat (0 Importeure, kanonische Pfade live, keine Logik-Änderung); empirisch guard-bewiesen |

**CO/CG:** n/a — Cleanup/Doku-Slice (tote Altverdrahtung markieren), keine Design-Frage, keine Verhaltensänderung. **TS:** `cert-rotation-recheck.test.ts` (+1): Guard, dass `cert-rotation.ts` `@deprecated`-markiert bleibt + auf `loadOrCreateTlsBundle`/`cert-expiry-monitor` zeigt (token-basiert, nicht prosa-überfittet); `cert-rotation.test.ts` Header-Notiz. Volle Suite **106 Files / 1295 grün**, tsc 0. Empirischer Beleg: `@deprecated`-Marker entfernt ⇒ Guard-Test rot, restauriert ⇒ grün. (Vorbestehender `require()`-eslint-Error in `auditCerts` Z168 = Baseline seit 2026-04-05, nicht Teil des Slices.) **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE, 0× HIGH/CRITICAL/MEDIUM/LOW; bestätigt: 0 ausführbare Zeilen geändert, `@deprecated` bricht Build nicht (keine no-deprecated-Regel). **PC:** manuell (tsc/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.48), COMPLIANCE, `changes/2026-06-30_cert-rotation-deprecate.md`, TODO.md. **Status:** Markiert; optionales hartes Entfernen = Folge-Slice. Kein Deploy.

---

## Session 2026-06-30 17:38 — v0.34.49 chore(policy): policy.ts/PolicyEngine deprecaten (Cleanup)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.49 | (#222, base=main) | 2026-06-30 17:38 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE; **CR-HIGH** (Doku zitierte unverdrahtetes `approval-gates.ts` als kanonisch) gefixt → Pfad auf `isApprovedPeerSender`+Vault-Approval-Flow korrigiert (Header/Guard/Doku mitgezogen); empirisch guard-bewiesen |

**CO/CG:** n/a — Cleanup/Doku-Slice (totes Modul markieren), keine Design-Frage, keine Verhaltensänderung. **TS:** `policy.test.ts` (+2 Guards): 0 Produktions-Importeure (scannt daemon/cli, schließt lebendes `discovery-policy.ts` aus) + Modul bleibt `@deprecated`-markiert + zeigt auf `isApprovedPeerSender`/`createApprovalRequest`. Volle Suite **106 Files / 1297 grün**, tsc 0. Empirischer Beleg: `@deprecated`-Marker entfernt ⇒ Guard-Test rot, restauriert ⇒ grün. (Vorbestehende `require()`-eslint-Errors in `policy.ts` Z206/247 = Baseline seit 2026-04-05, git-blame-belegt, nicht im Slice.) **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE; CR-HIGH (Doku-Genauigkeit: `approval-gates.ts` selbst unverdrahtet) gefixt; bestätigt: comment-only (0 ausführbare Zeilen), 0 Importeure, `isApprovedPeerSender` real verdrahtet (`mesh.ts:357`→`index.ts:618`), `@deprecated` bricht Build nicht. **PC:** manuell (tsc/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.49), COMPLIANCE, `changes/2026-06-30_policy-engine-deprecate.md`, TODO.md §3.4. **Status:** Markiert; hartes Entfernen / ADR-Anschluss = Folge-Slice. Kein Deploy.

---

## Session 2026-06-30 18:36 — v0.34.50 chore(lint): require()→import in Legacy-Modulen

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.50 | (offen, base=main) | 2026-06-30 18:36 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent APPROVE, 0× HIGH/CRITICAL/MEDIUM; semantische Äquivalenz bestätigt, kein Verhaltens-Change; CR-NIT (getVersion/save untested) adressiert (+2 Tests) |

**CO/CG:** n/a — Lint-Quality-Slice (require→import), keine Design-Frage, keine Verhaltensänderung. **TS:** `policy.test.ts` (+2): `getVersion` (deterministischer 16-Hex-Hash, ändert sich bei Policy-Änderung → konvertierter `createHash`-Pfad) + `save` (nur Custom-Policies → konvertierter `writeFileSync`-Pfad); `cert-rotation.test.ts auditCerts` übt den `forge`-Pfad. Volle Suite **106 Files / 1299 grün**, tsc 0. Empirischer Beleg: eslint auf `policy.ts`+`cert-rotation.ts` **3 Errors → 0** (Datei-Level). **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env). APPROVE, 0× HIGH/CRITICAL/MEDIUM; bestätigt default-/named-Imports korrekt, eager node-forge-Import sicher (harte Dependency), kein Leftover-`require`. **PC:** manuell (tsc/eslint/Suite grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.50), COMPLIANCE, `changes/2026-06-30_require-to-import-lint.md`. **Status:** Module bleiben @deprecated (nur Import-Mechanik geändert). Kein Deploy.

---

## Session 2026-07-01 06:10 — v0.34.51 chore(cleanup): tote Legacy-Module hart entfernen

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.51 | (offen, base=main) | 2026-07-01 06:10 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | (Review folgt) Hard-Remove `cert-rotation.ts`+`policy.ts` (read-first: weiterhin 0 Produktions-Importeure); RE-CHECK A behalten, RE-CHECK B → Removal-Guard; empirisch guard-bewiesen |

**CO/CG:** n/a — Cleanup/Hard-Remove-Slice (totes Legacy), keine Design-Frage, kein Laufzeit-Change. **TS:** entfernt `cert-rotation.test.ts` + `policy.test.ts` (Tests der gelöschten Module); `cert-rotation-recheck.test.ts` behält RE-CHECK A (kanonischer Reissue-Pfad via `tls.ts`) + Removal-Guard (Datei weg + kein Importeur). tsc **0** (keine verwaisten Importe). Volle Suite **106 Files / 1281 grün** (−18 = genau die gelöschten `policy.test.ts` (13) + `cert-rotation.test.ts` (5); keine anderen Tests betroffen). Empirischer Beleg: `cert-rotation.ts`-Stub wieder angelegt ⇒ Removal-Guard rot, entfernt ⇒ grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env) — s. PR-Body. **PC:** manuell (tsc/Suite grün, `git diff`/`git status` reviewed) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.51), COMPLIANCE, `changes/2026-07-01_remove-dead-legacy-modules.md`, TODO.md. **Status:** Hard-Remove durch; realer Laufzeitpfad (tls.ts/cert-expiry-monitor/mTLS/isApprovedPeerSender/Vault-Approval) unberührt. Kein Deploy.

---

## Session 2026-07-01 12:17 — v0.34.52 fix(tls): token-onboarded Bundle fail-closed gegen ca.crt.pem validieren (127b)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.52 | (offen, base=main) | 2026-07-01 12:17 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Security-Subagent: 1× MEDIUM (falscher caCertPem-Anchor auf entferntem Retention-Fallback) — behoben durch Entfernen des Fallbacks; Re-Review APPROVE, 0× HIGH/MEDIUM offen |

**CO/CG:** n/a — Security-Hardening-Bugfix (pre-existing CR-MEDIUM, TODO #127b), kein Architektur-Neuentwurf. **TS:** neuer `describe`-Block „127b — Token-onboarded Bundle" in `tls.test.ts` (der token-onboarded Zweig war **komplett ungetestet**): 6 Regressionstests (gültig-durchgereicht+Anchor-verifiziert, kanonisches Onboard, sowie fail-closed für nicht-signiert/Cert-Key-Mismatch/abgelaufene-CA/inkonsistenter-Anchor). `tls.test.ts` **38/38**, volle Suite **104 Files / 1287 grün**, `tsc` **0**, `npm run build` grün. **CR:** unabhängiger **Claude**-Security-Subagent (nur claude/codex/agy — `agy` fehlt im Env); fand 1× MEDIUM → aufgelöst durch Design-Vereinfachung (Fallback entfernt); Re-Review bestätigt kein Live-Node-Bruch, keine neuen Findings. **PC:** manuell (tsc/Build/Suite grün, Secret-Scan sauber, `git diff`/`status` reviewed) — `agy`-Backend fehlt. **DO:** `changes/2026-07-01_tls-token-onboard-ca-validate.md`, COMPLIANCE. **Status:** Nur Verhaltensänderung für **inkonsistente/ungültige** Token-Bundles (fail-closed throw statt still servieren); gültige Bundles unverändert. Kein Deploy, kein Gerät, kein Christian-Gate.

---

## Session 2026-07-01 13:19 — v0.34.53 test(mtls): dedizierter Issuer-Fingerprint-Integrationstest (127c)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.53 | (offen, base=main) | 2026-07-01 13:19 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Test-Review: solide, 0× HIGH/CRITICAL; 1× LOW (Format-Divergenz selbst-dokumentieren) übernommen |

**CO/CG:** n/a — Pure-Test-Slice (TODO #127c), keine Design-Frage, keine Runtime-Änderung. **TS:** IST der Slice — neue `packages/daemon/src/mtls-issuer-fingerprint.test.ts`: echter `node:tls`-mTLS-Handshake, exerziert den Produktionspfad (`resolveAttestingCaFingerprints → isAttestingIssuer → attestedPeerIdFromCert`) gegen die Wire-Werte `getPeerCertificate(true).issuerCertificate.fingerprint256` + `subjectaltname` (wie `agent-card.ts`); 6 Assertions inkl. Negativkontrolle (fremde CA) + Format-Divergenz. **6/6** grün, volle Suite **105 Files / 1293 grün**, `tsc` 0, `eslint` (neue Datei) 0, `npm run build` grün. **CR:** unabhängiger **Claude**-Test-Subagent (nur claude/codex/agy — `agy` fehlt im Env) — verifizierte Kernannahmen gegen `dist/` (Wire divergiert real, kein Tautologie-Grün); solide, kein HIGH/CRITICAL. **PC:** manuell (tsc/build/suite/lint grün, Secret-Scan sauber, `git diff`/`status` reviewed) — `agy`-Backend fehlt. **DO:** `changes/2026-07-01_mtls-issuer-fingerprint-test.md`, CHANGES (v0.34.53), COMPLIANCE, `TODO.md` #127c. **Status:** Reine Testabdeckung; kein Produktionscode berührt. Kein Deploy, kein Gerät, kein Christian-Gate.

---

## Session 2026-07-01 13:47 — v0.34.54 fix(mesh): Peer-Eintrag bei krypto-attestiertem Flip auf kanonische agentId umschlüsseln (127a)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.54 | (offen, base=main) | 2026-07-01 13:47 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude-Subagent: solide, 0× HIGH/CRITICAL/MEDIUM; 2× LOW (occupant-Guard-Test praktisch unerreichbar/Defensiv, Rollback-Kommentar) — Kommentar präzisiert |

**CO/CG:** n/a — kosmetischer Bookkeeping-Fix (TODO #127a), keine Design-Frage, keine Autorisierungs-/Binding-Semantik. **TS:** 3 neue `mesh.test.ts`-Tests — (1) krypto-attestierter Flip schlüsselt Legacy-Eintrag auf kanonische agentId um (Key+Feld, kein Offline-Event, Auflösung unverändert), (2) `rollback()` stellt Legacy-Key+agentId+`peerIdVerified=false` wieder her, (3) keine Fremd-/Duplicate-/Orphan-Key-Korruption (fremder Peer unberührt, genau 2 Einträge); ein bestehender Spoof-Safe-Test auf den kanonischen Key nachgezogen (Bookkeeping, Security-Assertion `ok=false` unverändert). `mesh.test.ts` **34/34**, volle Suite **104 Files / 1290 grün**, `tsc` 0, `npm run build` grün. **CR:** unabhängiger **Claude**-Subagent (nur claude/codex/agy — `agy` fehlt im Env); durchgespielt: Re-Key↔Supersession-Reihenfolge, inverse Rollback-Ordnung, Spoof-Schutz + `!targetViaRemoteHost`-Guardrail intakt — solide, kein HIGH/CRITICAL/MEDIUM. **PC:** manuell (tsc/build/suite grün, Diff auf `mesh.ts`+`mesh.test.ts` beschränkt, `git diff`/`status` reviewed) — `agy`-Backend fehlt. **DO:** `changes/2026-07-01_mesh-peer-canonical-rekey.md`, CHANGES (v0.34.54), COMPLIANCE, `TODO.md` #127a. **Status:** Reine Map-/Darstellungs-Konsistenz im bereits verifizierten Flip-Pfad; `.56/.222`-Host-Bind-Pfad + Autorisierung unverändert. Kein Deploy, kein Gerät, kein Christian-Gate, keine ADR-024/.94/cert-SAN/live-flip-Arbeit.

---

## Session 2026-07-01 14:20 — v0.34.55 docs(adr): ADR-031 Tailscale-Transport-Policy — T2.5-Entscheidungsvorlage (Doc-only)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.55 | (offen, base=main) | 2026-07-01 14:20 | konsol. | n/a | n/a | ✅ | ✅ | ✅ | CR Claude-Faithfulness: quellentreu, konfliktfrei, bleibt Optionsvorlage; 1× LOW (Querverweis) präzisiert |

**CO:** konsolidiert — Optionsvorlage aus **zwei** vorhandenen Admin-Decision-Prep-Drafts (06-30 + 07-01), keine neue Konsensrunde (Guardrail); die eigentliche Q4/Q5-Entscheidung bleibt **Christian** (nicht im ADR präjudiziert). **CG/TS:** n/a — Doc-only, kein Code. **CR:** unabhängiger **Claude**-Faithfulness-Subagent (nur claude/codex/agy — `agy` fehlt im Env): Empfehlungslinie A2+B2 quellentreu, Live-Belege/Policy-Schema 1:1 aus den Drafts, Status korrekt `Proposed/DRAFT`, Q4/Q5 offen gehalten, **kein** materieller Draft-Konflikt, keine Halluzination; 1× LOW (HTTPS-Fallback-Querverweis) präzisiert. **PC:** manuell (Quellen-Read-first, `git diff`/`status` reviewed, kein Code/Deploy). **DO:** `docs/architecture/ADR-031-tailscale-transport-policy.md` (neu), `changes/2026-07-01_adr-031-tailscale-transport.md`, CHANGES (v0.34.55). **Status:** reine Entscheidungsvorlage; Q4/Q5-Transport-Entscheidung bleibt Christian-gated. Kein Deploy, kein Transport-Umbau, kein Christian-Ping.

---

## Session 2026-07-02 07:22 — v0.34.59 fix(mcp): Phantom-Announce-Guard für geteilte MCP-Server (serve_shared, ADR-032)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.59 | (offen, base=main) | 2026-07-02 07:22 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: APPROVE-WITH-NITS, 0× HIGH/CRIT; CR-L1 (non-boolean TOML umgeht Guard) → strikte Coercion + Test; L2 kosmetisch |

**CO:** kein neuer Architektur-Konsens nötig — Hardening zu ADR-028 D4 (fixt den MEDIUM aus dem #229-Review); Design in **ADR-032** (neu). **CG:** n/a. **TS:** `mcp-registration.test.ts` (+6): `guardSharedMcpAnnounce` (true-passthrough per Identity, false→0 Caps + skip-Grund, leer-in/leer-out, bestehende skipped erhalten, E2E false→0 register, E2E true→N register); `config-mcp-share.test.ts` (+4): serve_shared Default false, TOML true, **non-boolean TOML → false (CR-L1)**, Env 1/0 + Env-schlägt-TOML. Volle Suite **1306 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: guard off unterdrückt (0 caps + Grund), on reicht durch. **CR:** unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; Guard schließt das Loch (einzige Gate am einzigen registerSharedMcps-Callsite, kein Bypass), Default fail-safe über alle 3 Ebenen, Provider-Passthrough per Identity (kein Regress). **CR-L1** (non-boolean TOML-`serve_shared` truthy → Guard-Bypass) → strikte `=== true`-Coercion + Regressionstest. **L2** (skip.server `mcp:unifi` vs `unifi` Asymmetrie) kosmetisch, per Test fixiert. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** `docs/architecture/ADR-032-*` (neu), CHANGES (v0.34.59), COMPLIANCE, `changes/2026-07-02_mcp-phantom-announce-guard.md`. **Status:** eigenständig gegen `main`, mergebar **vor** T3.3 (#230); default-off (fail-safe), Hub setzt `serve_shared=true`. Kein Deploy.

---

## Session 2026-07-01 21:15 — v0.34.56 feat(mcp): Modell-B MCP-Proxy — Share pal+unifi (T3.1) + Live-Ingress /api/mcp/:server (T3.2)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.56 | #229 (offen, base=main) | 2026-07-01 21:15 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: 0× HIGH/CRIT; CR-M1 (loser SAN-Match)→strikt+Test; CR-L2 (Self-1-Hop)→T3.3-Hinweis |

**CO:** ersetzt durch **Christian-Gate Q1 = JA** (v5-WORKING §9) + bestehender ADR-028-D4-Konsens — die Architektur ist unverändert die konsentierte; keine neue Design-Frage, daher keine neue Konsensrunde. **CG:** n/a — kein Boilerplate/Type-Ableitung delegiert. **TS:** `mcp-ingress-api.test.ts` (neu, 13): `extractCanonicalSender` (kein Socket/nicht-authorized/kein-Cert/nur-Legacy/**CR-M1 malform**→null; canonical>legacy), Handler 403 (unauth/legacy/**CR-M1 node/evil/extra**), 400, 503, 501-remote (`/T3\.3/`), 501-local (`/local-exec deferred/`); `mcp-share-beta.test.ts` (neu, 3): lädt **echte** config/daemon.toml (pal+unifi geteilt, e3dc/idm NICHT, Bau ohne Skip). Live-`fastify.inject()`-Route-Smoke: 403 ohne Client-Cert. Volle Suite **107 Files / 1312 grün**, tsc 0, authored-eslint 0, build 0. **CR:** unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt im Env): Gate fail-closed & korrekt, 0× HIGH/CRITICAL; **CR-M1 (MEDIUM)** loser `node/`-Prefix-Match → strikte `isCanonicalNodeUri`-Validierung + 2 Regressionstests; **CR-L2 (LOW)** Self-Forward-1-Hop als T3.3-Executor-Guard-Hinweis vermerkt (heute inert, 501). **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** `config/daemon.toml`, `docs/architecture/ADR-028-D4-*` (T3.1/T3.2-Sektion), CHANGES (v0.34.56), COMPLIANCE, `changes/2026-07-01_t31-t32-modell-b-mcp-ingress.md`. **Status:** remote-forward-only, **kein Net-Egress, kein Deploy**; T3.3 (Live-undici-Executor, 1-Hop-Guard, D2-Pin, beidseitiges Audit) → T3.4 → T3.5 Zwei-Peer-DoD folgen strikt linear.

---

## Session 2026-07-02 08:18 — v0.34.60 fix(agent): Registrierung node/-fähig + präzise Register-Diagnose (Mesh-Messaging A1)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.60 | (offen, base=main) | 2026-07-02 08:18 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: APPROVE-WITH-NITS, 0× HIGH/CRIT; M1 (E2E send-to-instance = A2/A3) festgezurrt; L1/L2 umgesetzt |

**CO:** kein neuer Konsens — Bug-Fix auf bestehender ADR-005/ADR-028-D1-Grammatik; Instanz-URI-Schema-Entscheidung (host-Grammatik, PeerID im Node-Slot) im Code + changes/ dokumentiert. **CG:** n/a. **TS:** `agent-api.test.ts`: node/<PeerID>-Daemon → register **200** (Regression zum 500), **register→heartbeat→unregister-Round-Trip** unter node-URI, `buildInstanceSpiffe`-Unit (legacy-host, node→host-instance, malformed→null, bad-chars→null, **Zwei-Grammatik-Split** normalizeAgentId≠node-Identität); `agent-register-format.test.ts` (neu, 7): register ok / **http-500-NICHT-unreachable** / transport-error, Body-Kürzung/Einzeilung, unregister ok→null/http/error. Volle Suite **1320 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: node→host-instance, malformed→null, 500 sichtbar. **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; Schema sicher (Instanz-URI kollidiert nicht mit node-Identität; normalizeAgentId nur auf echte Cert-SANs), null-Vertrag tight, Fehler-Surfacing korrekt, unregister async-safe. **CR-M1** (Cross-Grammatik-E2E-Adressierung) = **A2/A3-Scope** (Deploy + Receive-Loop, DoD) → per Split- + Round-Trip-Test festgezurrt. **CR-L1** (Doc: `stableNodeId` kann base58-PeerID halten) → Kommentar in spiffe-uri.ts. **CR-L2** (repräsentative 51-Zeichen-PeerID-Fixture). **CR-L3** (dataDir jetzt durchgereicht) = bewusste Korrektur, kein Regress. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** CHANGES (v0.34.60), COMPLIANCE, `changes/2026-07-02_a1-agent-register-node-spiffe.md`. **Status:** eigenständig gegen `main`; A2 Rollout (Deploy-Gate) → A3 Empfangs-Loop → A4 Runbook + DoD-Probelauf. Kein Deploy.

---

## Session 2026-07-02 08:43 — v0.34.61 feat(mesh): ADR-004 Inbox-Empfangs-Loop-Primitive (Mesh-Messaging A3, code-only)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.61 | #234 (offen, base=main) | 2026-07-02 08:43 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude: APPROVE-WITH-NITS, 0× HIGH/CRIT; M1/M2/L1/L2 umgesetzt · **Review-Blocker (for_instance-Vertrag) gefixt** |

**CO:** kein neuer Konsens — Umsetzung von ADR-004 (Empfangs-Loop); Mechanismus-Entscheidung (reine Poller-Primitive im Repo, Session-Zustellung Agent-Home) im changes/ + Code dokumentiert. **CG:** n/a. **TS:** `inbox-poller.test.ts` (13): `pollInboxOnce` (leer, happy+Reihenfolge, at-least-once-Zustell-Fehler→failed, **CR-M1** markRead-Fehler→markFailed), `createInboxPoller` (start/stop, **Nicht-Überlappung unter async**, Fetch-Fehler crasht Loop nicht), `buildDaemonInboxDeps` (Endpoint + for_instance-Enkodierung, non-2xx→wirft, **CR-M2** malformter JSON→klarer Fehler, defensives messages-Array, mark-read POST/Fehler) via vi.mock. Volle Suite **1319 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: at-least-once (boom bleibt ungelesen). **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; at-least-once korrekt (kein mark-without-deliver, kein Message-Loss), Nicht-Überlappung hält unter async, for_instance enkodiert, kein Body-Logging. **CR-M1** (failed konflierte Zustell-/mark-Fehler) → eigenes `markFailed`-Feld. **CR-M2** (malformter JSON log-ununterscheidbar von „down"; buildDaemonInboxDeps uncovered) → klarer Fehler + vi.mock-Coverage. **CR-L1** (`as`-Cast trusted-source) + **CR-L2** (`stop()` kein Quiesce) im Code dokumentiert. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** CHANGES (v0.34.61), COMPLIANCE, `changes/2026-07-02_a3-inbox-poller.md`. **Review-Blocker (2026-07-02 09:10, funktional):** die Inbox-API (ADR-005) validiert `for_instance` als **einzelne Instanz-Komponente** (`SPIFFE_COMPONENT_REGEX`), und `to_agent_instance` speichert `getAgentInstance(to)` = die Komponente; der Poller sendete die **volle** A1-Instanz-URI → live **400**. **Gefixt:** `instanceComponentForQuery()` extrahiert die 4. Komponente (volle URI → `<id>`; nackte Komponente → as-is) vor dem `for_instance`-Query. Tests: +`instanceComponentForQuery`-Unit (voll/nackt/3-Komp) + `buildDaemonInboxDeps` sendet `for_instance=i1` (nicht die URI). Suite **1337 grün**, tsc 0, authored-eslint 0, build 0; dist-Smoke bestätigt. **Status:** code-only, **kein Deploy**; Deploy-Zeit (Agent-Home): Poller in Supervisor/Hook einhängen (deliver→Session, forInstance aus A1). A2 Rollout folgt; E2E send-to-instance beim DoD-Probelauf.

---

*Letzte Aktualisierung: 2026-07-02 08:43 — v0.34.61 feat(mesh): ADR-004 Inbox-Empfangs-Loop-Primitive (A3).*

---

## Session 2026-07-02 10:40 — v0.34.62 perf(daemon): T1.1 RSS/CPU-Mess-Slice (tsx→node dist Vorher/Nachher, code-only)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.62 | #235 (offen, base=main) | 2026-07-02 10:40 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude: APPROVE-WITH-NITS, 0× HIGH/CRIT; M1+L2/L3/L4/L5 · **Review-Blocker Prozessbaum (Single-PID→Baum) gefixt** |

**CO:** kein neuer Konsens — die T1.1-Startumstellung ist bereits gemergt (PR #217); dieser Slice liefert nur den DoD-Mess-Teil (Auswertungs-Primitive + Runbook). **CG:** n/a. **TS:** `rss-cpu-stats.test.ts` (12): `percentile` (Grenzen q=0/0.5/0.95/1, keine Mutation, Fehler leer/ungültig-q), `computeStats` (leer/non-finite wirft), `parsePsSample` (KiB→Bytes, null bei unparsebar), `summarizeSamples`, `formatComparison` (Δ-Vorzeichen, before=0→n/a, **CR-M1** non-finite→wirft). Volle Suite **1349 grün**, tsc 0, authored-eslint 0, build 0. Live-Smoke: Sampler misst echten PID, `--compare` erzeugt Tabelle, kaputte JSON→klarer Fehler (kein NaN), bad args→Usage-Exit. **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; Stats korrekt (nearest-rank ohne Off-by-one/Mutation), ehrlich zum Scope. **CR-M1** (NaN-Leck in `--compare` bei hand-editierter JSON) → `assertFiniteSummary`-Guard + Regressionstest + CLI-Guard. **CR-L2** (Arg-Validierung positive Ganzzahl), **CR-L3** (parsePsSample einzeilig-Kommentar), **CR-L4** (`LC_ALL=C` in `ps` + Runbook), **CR-L5** (Runbook `pgrep` statt `$!`). **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** `docs/operations/T1.1-rss-cpu-measurement.md` (neu), CHANGES (v0.34.62), COMPLIANCE, `changes/2026-07-02_t11-rss-cpu-measurement.md`. **Review-Blocker #235 (2026-07-02 11:08, funktional):** Sampler maß nur Single-PID, während `tsx` ein Prozessbaum ist (node + esbuild-Kind) vs. `node dist/` Einzelprozess → irreführender Vergleich. **Gefixt:** `parsePidPpid`/`collectProcessTree` (root+Nachfahren, zyklen-sicher) + `aggregateTreeSample` (Σ RSS/CPU); Sampler misst pro Tick den ganzen Baum. +7 Tests (jetzt 19). Suite **1356 grün**; Live-Tree-Smoke bestätigt. **Status:** code-only, **kein Deploy**; Live-Erhebung der realen RSS/CPU-Zahlen (idle+Last, before/after) = Deploy-Schritt, danach Ergebnis-Tabelle in den T1.1-Abschluss.

---

*Letzte Aktualisierung: 2026-07-02 10:40 — v0.34.62 perf(daemon): T1.1 RSS/CPU-Mess-Slice.*
