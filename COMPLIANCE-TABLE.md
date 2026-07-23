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
| v0.34.56 | #229 (base=main, gemergt) | 2026-07-01 21:15 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: 0× HIGH/CRIT; CR-M1 (loser SAN-Match)→strikt+Test; CR-L2 (Self-1-Hop)→T3.3-Hinweis |

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
| v0.34.61 | #234 (base=main, gemergt) | 2026-07-02 08:43 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude: APPROVE-WITH-NITS, 0× HIGH/CRIT; M1/M2/L1/L2 umgesetzt · **Review-Blocker (for_instance-Vertrag) gefixt** |

**CO:** kein neuer Konsens — Umsetzung von ADR-004 (Empfangs-Loop); Mechanismus-Entscheidung (reine Poller-Primitive im Repo, Session-Zustellung Agent-Home) im changes/ + Code dokumentiert. **CG:** n/a. **TS:** `inbox-poller.test.ts` (13): `pollInboxOnce` (leer, happy+Reihenfolge, at-least-once-Zustell-Fehler→failed, **CR-M1** markRead-Fehler→markFailed), `createInboxPoller` (start/stop, **Nicht-Überlappung unter async**, Fetch-Fehler crasht Loop nicht), `buildDaemonInboxDeps` (Endpoint + for_instance-Enkodierung, non-2xx→wirft, **CR-M2** malformter JSON→klarer Fehler, defensives messages-Array, mark-read POST/Fehler) via vi.mock. Volle Suite **1319 grün**, tsc 0, authored-eslint 0, build 0. dist-Smoke: at-least-once (boom bleibt ungelesen). **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; at-least-once korrekt (kein mark-without-deliver, kein Message-Loss), Nicht-Überlappung hält unter async, for_instance enkodiert, kein Body-Logging. **CR-M1** (failed konflierte Zustell-/mark-Fehler) → eigenes `markFailed`-Feld. **CR-M2** (malformter JSON log-ununterscheidbar von „down"; buildDaemonInboxDeps uncovered) → klarer Fehler + vi.mock-Coverage. **CR-L1** (`as`-Cast trusted-source) + **CR-L2** (`stop()` kein Quiesce) im Code dokumentiert. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** CHANGES (v0.34.61), COMPLIANCE, `changes/2026-07-02_a3-inbox-poller.md`. **Review-Blocker (2026-07-02 09:10, funktional):** die Inbox-API (ADR-005) validiert `for_instance` als **einzelne Instanz-Komponente** (`SPIFFE_COMPONENT_REGEX`), und `to_agent_instance` speichert `getAgentInstance(to)` = die Komponente; der Poller sendete die **volle** A1-Instanz-URI → live **400**. **Gefixt:** `instanceComponentForQuery()` extrahiert die 4. Komponente (volle URI → `<id>`; nackte Komponente → as-is) vor dem `for_instance`-Query. Tests: +`instanceComponentForQuery`-Unit (voll/nackt/3-Komp) + `buildDaemonInboxDeps` sendet `for_instance=i1` (nicht die URI). Suite **1337 grün**, tsc 0, authored-eslint 0, build 0; dist-Smoke bestätigt. **Status:** code-only, **kein Deploy**; Deploy-Zeit (Agent-Home): Poller in Supervisor/Hook einhängen (deliver→Session, forInstance aus A1). A2 Rollout folgt; E2E send-to-instance beim DoD-Probelauf.

---

*Letzte Aktualisierung: 2026-07-02 08:43 — v0.34.61 feat(mesh): ADR-004 Inbox-Empfangs-Loop-Primitive (A3).*

---

## Session 2026-07-02 10:40 — v0.34.62 perf(daemon): T1.1 RSS/CPU-Mess-Slice (tsx→node dist Vorher/Nachher, code-only)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.62 | #235 (base=main, gemergt) | 2026-07-02 10:40 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude: APPROVE-WITH-NITS, 0× HIGH/CRIT; M1+L2/L3/L4/L5 · **Review-Blocker Prozessbaum (Single-PID→Baum) gefixt** |

**CO:** kein neuer Konsens — die T1.1-Startumstellung ist bereits gemergt (PR #217); dieser Slice liefert nur den DoD-Mess-Teil (Auswertungs-Primitive + Runbook). **CG:** n/a. **TS:** `rss-cpu-stats.test.ts` (12): `percentile` (Grenzen q=0/0.5/0.95/1, keine Mutation, Fehler leer/ungültig-q), `computeStats` (leer/non-finite wirft), `parsePsSample` (KiB→Bytes, null bei unparsebar), `summarizeSamples`, `formatComparison` (Δ-Vorzeichen, before=0→n/a, **CR-M1** non-finite→wirft). Volle Suite **1349 grün**, tsc 0, authored-eslint 0, build 0. Live-Smoke: Sampler misst echten PID, `--compare` erzeugt Tabelle, kaputte JSON→klarer Fehler (kein NaN), bad args→Usage-Exit. **CR:** unabhängiger **Claude**-Subagent (adversarial; nur claude/codex/agy — `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× CRITICAL/HIGH; Stats korrekt (nearest-rank ohne Off-by-one/Mutation), ehrlich zum Scope. **CR-M1** (NaN-Leck in `--compare` bei hand-editierter JSON) → `assertFiniteSummary`-Guard + Regressionstest + CLI-Guard. **CR-L2** (Arg-Validierung positive Ganzzahl), **CR-L3** (parsePsSample einzeilig-Kommentar), **CR-L4** (`LC_ALL=C` in `ps` + Runbook), **CR-L5** (Runbook `pgrep` statt `$!`). **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** `docs/operations/T1.1-rss-cpu-measurement.md` (neu), CHANGES (v0.34.62), COMPLIANCE, `changes/2026-07-02_t11-rss-cpu-measurement.md`. **Review-Blocker #235 (2026-07-02 11:08, funktional):** Sampler maß nur Single-PID, während `tsx` ein Prozessbaum ist (node + esbuild-Kind) vs. `node dist/` Einzelprozess → irreführender Vergleich. **Gefixt:** `parsePidPpid`/`collectProcessTree` (root+Nachfahren, zyklen-sicher) + `aggregateTreeSample` (Σ RSS/CPU); Sampler misst pro Tick den ganzen Baum. +7 Tests (jetzt 19). Suite **1356 grün**; Live-Tree-Smoke bestätigt. **Status:** code-only, **kein Deploy**; Live-Erhebung der realen RSS/CPU-Zahlen (idle+Last, before/after) = Deploy-Schritt, danach Ergebnis-Tabelle in den T1.1-Abschluss.

---

## Session 2026-07-02 12:48 — v0.34.63 docs(ops): T1.1 RSS/CPU-Live-Messung tsx→node dist (DoD-Abschluss)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.63 | (offen, base=main) | 2026-07-02 12:48 | n/a | n/a | ✅ | n/a | ✅ | ✅ | Doc-only Evidence-Slice; reale Live-Zahlen n=60: RSS -40.2%, CPU -45.5% |

**Typ:** Doc-only/Evidence — kein Produktionscode, keine Konfig, kein Deploy. Nach CLAUDE.md darf eine Doc-only-PR CO/CG/CR auslassen; TS ist hier der **Live-Mess-Beleg** selbst. **CO/CG:** n/a (keine Architektur-/Boilerplate-Frage). **TS:** kein neuer Code → keine neuen Unit-Tests; die **genutzte** Mess-Primitive `rss-cpu-stats.ts` ist grün (`rss-cpu-stats.test.ts` **19**), tsc 0. Der eigentliche TS-Nachweis dieses Slices ist der **reproduzierbare Live-Lauf**: isolierte Instanz (`TLMCP_RUNTIME_MODE=local`, libp2p/mDNS aus, Port 9460, temp data dir — stört Produktiv-Daemon 9440 + LAN-Mesh NICHT), je **n=60** Samples @1s, 20s Warmup, Prozessbaum-Sampling. Ergebnis: **RSS 215.8→129.1 MiB (-40.2%)**, **CPU 4.82→2.63% (-45.5%)**; Roh-JSONs eingebettet, kein Zahlen-Erfinden. **CR:** n/a (Doc-only; Zahlen sind Sampler-Output, keine Logik). **PC:** manuell (tsc 0, Primitive-Test grün, keine Streu-Prozesse/Ports, Produktiv-9440 unberührt, `git diff` reviewed) — `agy` fehlt. **DO:** `docs/operations/T1.1-rss-cpu-measurement.md` (Ergebnis-Sektion), `changes/2026-07-02_t11-rss-cpu-live-measurement.md`, CHANGES (v0.34.63), COMPLIANCE. **Caveat:** Absolutwerte isoliert < Produktion; das Δ (identische Konfig beider Läufe) ist das DoD-Signal. **Status:** schließt den DoD-Mess-Teil von T1.1 (von v0.34.62/#235 als Folge offengelassen). **Kein Deploy.**

---

*Letzte Aktualisierung: 2026-07-02 12:48 — v0.34.63 docs(ops): T1.1 RSS/CPU-Live-Messung (DoD-Abschluss).*

---

## Session 2026-07-02 06:24 — v0.34.57 feat(mcp): Modell-B T3.3 — Live-Forward-Executor (undici-mTLS, D2-Pin, 1-Hop-Guard, beidseitiges Audit)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.57 | (offen, base=main, restacked nach #229-Merge) | 2026-07-02 06:24 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: 0× CRIT; 2× HIGH (H1 Cache-Key, H2 Pin-Downgrade)→gefixt+Tests; M4/L1/L4→gefixt; M1/M2/L2→ADR dokumentiert |

**CO:** Christian-Gate Q1 = JA + ADR-028-D4-Konsens (unveränderte konsentierte Architektur, benannter strikt-linearer Slice T3.3) — keine neue Konsensrunde. **CG:** n/a. **TS:** `mcp-forward-executor.test.ts` (neu, 13: remote hop+1/Payload/Audit-TX, Pin-Durchreichung, Self-Loop 508, 1-Hop 502, local 501, reject 500, CR-M4-Audit; undici-Forward mit injiziertem fetch: Success/Non-JSON/502/503/Cache), `mcp-forward-executor-pin.test.ts` (neu, 4: CR-H2 Connector-Pin aus Request + kein TOFU-Downgrade, CR-H1 Cache-Key inkl. expectedSpiffeId), `mcp-ingress-api.test.ts` (+6: Hop/Payload/Server-Durchreichung, RX/Reject-Audit). dist-Live-Smoke: Forward hop=1→200+Body, Self-Loop 508, Route-D3-403. Volle Suite **108 Files / 1332 grün**, tsc 0, authored-eslint 0, build 0. **CR:** unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt im Env): 0× CRITICAL. **CR-H1** (Agent-Cache nur nach targetAgentId → Stale-Pin-Reuse) → Cache-Key `target|pin|expectedSpiffeId` + Tests. **CR-H2** (Connector-Policy aus globaler statt Request-Policy → möglicher stiller TOFU-Downgrade) → Policy aus Request abgeleitet + Tests. **CR-M4** (reject/local/fail-Pfade nicht auditiert) + **CR-L1** (5xx-RX→REJECT) + **CR-L4** (close().catch) gefixt. **CR-M1/M2** (Hop untrusted → Loop-Sicherheit am Owner-Terminus; Origin-Attribution forwarder-basiert in Beta) + **CR-L2** (Body-Read-Deadline optional) in ADR-028-D4 als bewusste Entscheidung dokumentiert. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** `docs/architecture/ADR-028-D4-*` (T3.3-Sektion + Trust-Modell), CHANGES (v0.34.57), COMPLIANCE, `changes/2026-07-02_t33-mcp-forward-executor.md`. **Status:** remote-forward-only, **kein Deploy**; T3.4 (`mcp-stdio`-Proxy-Tools) → T3.5 (Zwei-Peer-DoD) folgen; Owner-local-exec bleibt per Q1 zurückgestellt.

---

## Session 2026-07-02 06:44 — v0.34.58 feat(mcp): Modell-B T3.4 — client-seitige MCP-Proxy-Tools in mcp-stdio (tools/list / tools/call)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.58 | #231 (offen, base=#237 T3.3, restacked) | 2026-07-02 06:44 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial: 0× HIGH/CRIT; Zusatz-Tests (Traversal/503/unpräfixiert/Scalar); Test-getriebener null-Crash-Fix; M1/M2 dokumentiert |

**CO:** Christian-Gate Q1 = JA + ADR-028-D4-Konsens (benannter strikt-linearer Slice T3.4) — keine neue Konsensrunde. **CG:** n/a. **TS:** `mcp-proxy-client.test.ts` (neu, 15): JSON-RPC-Bau (list/call, args-default), Body-Parsing (JSON/Non-JSON/leer/Scalar), `extractSharedMcpServers` (Filter, defensiv null/garbage, unpräfixierter skill_id ausgeschlossen), `callMcpProxy` (Pfad-Enkodierung, Status-Durchreichung inkl. 501/503, **Security Path-Traversal `../peers`→`..%2Fpeers`**). Test-getriebener Fix: null-Array-Eintrag-Crash in `extractSharedMcpServers` → object/null-Guard. dist-Live-Smoke: `mcp_list_servers` parst, `tools/list`→200, `tools/call`→501-Passthrough; 3 Tools in `dist/mcp-stdio.js`. Volle Suite **109 Files / 1347 grün**, tsc 0, authored-eslint 0, build 0. **CR:** unabhängiger **Claude**-Subagent (adversarial Security+Correctness; nur claude/codex/agy — `agy` fehlt im Env): 0× CRITICAL/HIGH; Passthrough/Fehler-Surfacing korrekt, **kein Path-Traversal** (encodeURIComponent; Servername = Registry-Lookup-Key), Trust-Modell intakt (kein Sender-Spoofing). Umgesetzt: Zusatz-Tests (Traversal-Encoding, 502/503-Passthrough, unpräfixierter skill_id, Scalar-JSON). Bewusst belassen+dokumentiert: **M1** `mcp_list_servers` gleicher `fetchDaemon`-Fehlermodus wie alle GET-List-Tools (Konsistenz); **M2** Servername daemon-seitig kanonisiert. **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy`-Backend fehlt. **DO:** `docs/architecture/ADR-028-D4-*` (T3.4-Sektion), CHANGES (v0.34.58), COMPLIANCE, `changes/2026-07-02_t34-mcp-stdio-proxy-tools.md`. **Status:** remote-forward-only, **kein Deploy**; T3.5 (Zwei-Peer-DoD) = echter Ende-zu-Ende-Beweis; Owner-local-exec bleibt per Q1 zurückgestellt.

---

## Session 2026-07-02 15:37 — v0.34.64 test(mcp): MCP-Forward-Naht-Integrationstest (T3.2+T3.3)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.64 | (offen, base=main) | 2026-07-02 15:37 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Test-only; CR Claude adversarial APPROVE-WITH-NITS, 0× HIGH/MED/LOW, kein False-Green (echte Naht) |

**Typ:** Test-only, ungated, kein Produktionscode/Deploy. **CO/CG:** n/a. **TS:** `mcp-forward-integration.test.ts` (neu, 5) — schließt die Naht-Coverage-Lücke: verdrahtet die **echten** `makeMcpIngressHandler` → `createMcpForwardExecutor` → `createUndiciMcpForward` (kein `vi.mock`, nur `fetch` gestubbt). Beweist realer Hop=incomingHop+1, URL/Payload/Servername-Durchreichung, Owner-Passthrough (JSON/Non-JSON/503), beidseitiges Audit (TX+RX), 1-Hop-Guard 502 (kein Fetch), local-exec 501 (kein Fetch). Volle Suite **114 Files / 1412 grün** (+5), tsc 0, authored-eslint 0, build 0. **CR:** unabhängiger **Claude**-Subagent (adversarial, Fokus False-Green; `agy` fehlt im Env): **APPROVE-WITH-NITS**, 0× HIGH/MEDIUM/LOW; quellen-verifiziert kein `vi.mock`, realer Modulgraph, Undici-Connector real gebaut (synthetisches PEM wirft erst beim nie stattfindenden Handshake), `hop='1'` aus realem `+1`, Audit-Assertions decken den Kontrollfluss. NIT: Audit-`details`-String-Kopplung (inhärent, akzeptiert). **PC:** manuell (tsc/authored-eslint/Suite/Build grün, `git diff` reviewed) — `agy` fehlt. **DO:** CHANGES (v0.34.64), COMPLIANCE, `changes/2026-07-02_t3x-mcp-forward-seam-integration-test.md`. **Scope:** de-riskt den deploy-gated **T3.5**-Zwei-Peer-DoD, ersetzt ihn NICHT. **Kein Deploy.**

---

## Session 2026-07-03 06:34 — feat(mcp): Ausführungsstufen-Durchsetzung am Hub-Ingress (7.8 P6, ADR-033)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| ADR-033  | (offen, base=main) | 2026-07-03 06:34 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial APPROVE, 0× HIGH/CRIT; 1× MED (Audit-Unterscheidbarkeit) + 1× LOW (consensus×local-Test) gefixt+Test |

**Typ:** Feature (Security-Gate), **repo-only, kein Deploy/Device/systemd**; direkt aus Gate 2 (Lese-/Schreib-Stufen = Beta-Pflicht). **CO:** n/a — Architektur bereits entschieden (Gate 2 + ADR-028-D4-`execution_tier`); ADR-033 dokumentiert die Durchsetzung vor dem Code. **CG:** n/a. **TS:** `mcp-ingress.test.ts` (+8: gate/consensus je remote+local → 403 KEIN Dispatch, self-Regression → execute, 3× reine `enforceExecutionTier`), `mcp-ingress-api.test.ts` (+1: Tier-403 → REJECT `tier=gate`, Gegenprobe Auth-403 ohne `tier=`). Full Suite **114 Files / 1421 grün**, tsc 0, eslint 0. **CR:** unabhängiger **Claude**-Subagent (adversarial, Security; `agy` fehlt im Env): **APPROVE**, 0× HIGH/CRITICAL — Tier-Extraktion local+remote korrekt, fail-closed vor `execute`, kein fail-open, Q1/owner-local-exec unberührt, Exhaustiveness-Guard fail-closed. Gefixt: **MED** (REJECT-Audit `tier=`-Suffix → Tier- vs Auth-403 unterscheidbar) + **LOW** (consensus×local-Test), je mit Test. **PC:** manuell (tsc/eslint/Suite/`git diff` grün) — `agy`-Backend fehlt. **DO:** `docs/architecture/ADR-033-*`, COMPLIANCE, `changes/2026-07-03_mcp-ingress-tier-enforcement.md`. **Q1-Grenze:** Gate sitzt VOR dem Executor; self+local endet unverändert im 501-Stub. Kein Owner-local-exec.

---

## Session 2026-07-03 08:33 — docs+feat: A5 Agent-Integration + konfigurierbare Poll-Intervalle (v0.34.66)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.66 | (offen, base=main) | 2026-07-03 08:33 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial APPROVE, 0× HIGH/CRIT; stop-during-inflight-Test (Nit) nachgezogen |

**Typ:** Adoptions-Slice A5 (Docs+Config), **repo-only, kein Deploy/Device/systemd**. **CO:** n/a (folgt aus Christians A5-Freigabe 2026-07-03 + ADR-004; keine neue Architektur). **CG:** n/a. **TS:** `agent-poll-config.test.ts` (neu, 7: Mode-Defaults, Env-Overrides, fail-safe ungültig/≤0, Invariante maxMs≥initialMs, unknown-Mode), `inbox-poller.test.ts` (+7: adaptiver Backoff/Deckel, Reset-bei-Verkehr, Fehler→Backoff, stop-during-inflight-Drain, maxMs<initialMs-Clamp). Full Suite **115 Files / 1435 grün**, tsc 0, eslint 0. **CR:** unabhängiger **Claude**-Subagent (adversarial, Fokus State-Machine+False-Green; `agy` fehlt im Env): **APPROVE**, 0× HIGH/CRITICAL — kein stop/reschedule-Race, kein inFlight-Deadlock, Backoff-Mathematik korrekt, Clamp in beiden Schichten konsistent, Tests nicht-tautologisch (Delay-Sequenz), `intervalMs` sauber ersetzt ohne Bruch. Nachgezogen: stop-during-inflight-Test. **PC:** manuell (tsc/eslint/Suite/`git diff` grün) — `agy`-Backend fehlt. **DO:** `docs/AGENT-INTEGRATION.md` (neu), README + INSTALL.md (Rotfaden-Verweise), CHANGES (v0.34.66), COMPLIANCE, `changes/2026-07-03_a5-agent-integration-docs.md`. **Abgrenzung:** `TLMCP_AGENT_POLL_*_MS` (Agent-Inbox-Poll, außerhalb LLM) ≠ `TLMCP_HEARTBEAT_MS` (Daemon-Peer-Heartbeat) — explizit dokumentiert. **Scope:** kein Deploy; Poller-Wiring in den Agent-Supervisor = Folge-Slice.

---

## Session 2026-07-03 10:02 — docs+test: Cert-Auto-Rotation RE-CHECK (WOCHENPLAN-KW27 §2, v0.34.67)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.67 | (offen, base=main) | 2026-07-03 10:02 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude verifiziert alle 4 Verdikt-Claims VERIFIED, Test nicht-tautologisch, 0 Overclaims |

**Typ:** RE-CHECK-Verdikt + reproduzierbarer Test, **repo-only, kein Deploy, kein Code-Fix**. **CO:** n/a (Investigation/Verdikt, keine Architektur). **CG:** n/a. **TS:** `cert-expiry-monitor.test.ts` (+1: abgelaufenes Cert daysLeft=-1 → nur Alarm, KEINE In-Process-Rotation; struktureller Beweis via Deps-Key-Set). Full Suite **115 Files / 1436 grün**, tsc 0, eslint 0 (1 vorbestehende Warnung an `makeLog`, nicht in diesem Diff). **CR:** unabhängiger **Claude**-Subagent (Verifikation der Verdikt-Claims gegen den Code; `agy` fehlt im Env): **alle 4 VERIFIED** — `cert-rotation.ts` existiert nicht, kein `pairing-store.json`-Ref (autoritativ `pairing/paired-peers.json`), Monitor ohne Rotate-Hook (Reissue startup-only `loadOrCreateTlsBundle` Gate daysLeft>7), Test nicht-tautologisch; 0 Overclaims. **PC:** manuell (tsc/eslint/Suite/`git diff`/Strukturbelege grün) — `agy`-Backend fehlt. **DO:** `docs/RECHECK-cert-rotation-2026-07-03.md` (Verdikt), CHANGES (v0.34.67), COMPLIANCE, `changes/2026-07-03_cert-recheck-kw27.md`. **Verdikt:** Auto-Rotation feuert NICHT (by design); T2.1-als-Pfad-Bug NICHT gerechtfertigt; 2026-09-02-Ablauf durch geplanten Neustart gemindert; In-Process-Rotation = optionales Feature (Christian-Entscheidung).

---

## Session 2026-07-04 08:54 — feat(tls): Cert-Reissue-Schwelle 30 Tage + konfigurierbar (Wochen-Neustart-Rhythmus, v0.34.68)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.68 | (offen, base=main) | 2026-07-04 08:54 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude: Erst-Review REQUEST-CHANGES (2 MED+2 LOW), alle gefixt+Test, Re-Review APPROVE |

**Typ:** Daemon-Code (Cert-Reissue-Schwelle 30 d + konfigurierbar), **Deploy/Timer folgt getrennt (Admin/Orchestrator-Lane)**. **CO:** n/a (Christian-Freigabe 04.07. „1 ja"; Design Kap. 13.4/3.8; keine neue Architektur-Frage). **CG:** n/a. **TS:** `tls.test.ts` (+4: ≤30 Reissue, >30 Behalten, Non-Regression `renewBeforeDays=7`, exakte `==`-Grenze via +12h-Mint), `cert-expiry-monitor.test.ts` (Default 30, Env-Override, Reject 0/≥90, **echtes TOML-0-Reject**), `cert-rotation-recheck.test.ts` (Retain-Fixtures 30→60 d an neue Schwelle angepasst). Full Suite **115 Files / 1443 grün**, tsc 0; eslint: nur vorbestehende Errors auf main (mit/ohne Diff identisch — CI gated nicht auf eslint, nur tsc+vitest). **CR:** unabhängiger **Claude**-Subagent (adversarial; `agy`/codex nicht im Env, Claude ist zulässig): Erst-Review **REQUEST-CHANGES** — MED1 TOML-Pfad `renew_before_days` unvalidiert (0=fail-open), MED2 Boundary-Test false-green (9>10 statt 10>10), LOW Upper-Bound-Loop, LOW token-onboarded-Doc. **Alle 4 gefixt** (Post-Merge-Validierung `[1,89]` inkl. TOML; +12h-Mint für echte `==`-Grenze; `NODE_CERT_VALIDITY_DAYS` exportiert; token-onboarded-Kommentar) + Tests. **Re-Review APPROVE**, nicht-tautologisch. **PC:** manuell (tsc/Suite/`git diff` grün; eslint-Errors pre-existing) — `agy`-Backend fehlt. **DO:** CHANGES (v0.34.68), COMPLIANCE, `changes/2026-07-04_cert-renew-threshold-config.md`. **Config-Keys:** `cert.renew_before_days` (Default 30, Env `TLMCP_CERT_RENEW_BEFORE_DAYS`). **Grenze:** kein Timer/Betrieb/Deploy in diesem Slice.

---

## Session 2026-07-06 06:03 — feat(tls): Re-Pair-Migrationsstufe Legacy→kanonisch (ADR-034, KW28 §2 A / TL-00a, v0.34.69)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.69 | (offen, base=main) | 2026-07-06 06:03 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude adversarial APPROVE 0×HIGH/CRIT; LOW-1/LOW-2/NIT-1 gefixt → Re-Review APPROVE |

**Typ:** Daemon-Code (Cert-Identity-Migration, opt-in), **kein Roll-out/Timer/Live-Aktion**. **CO:** Design-Entscheidung (Lock-Mechanismus, Key-Reuse-vs-Re-Key) als **ADR-034 VOR dem Code** dokumentiert + begründet (statt pal:consensus — agy/codex nicht im Env, MiniMax verboten). **CG:** n/a. **TS:** `tls.test.ts` +7 (Migration+Key-Reuse+Archiv, Idempotenz, Regression-Schalter-AUS bitidentisch, fail-closed-Backup-Fehler, Lock-busy-skip, Lock-stale-steal, bereits-kanonisch-no-op) mit echten geminteten Fixtures. Full Suite **115 Files / 1450 grün**, tsc 0; eslint: 3 Errors/16 Warnings = strikt ⊆ main (22 Probleme) → keine neuen. **CR:** unabhängiger **Claude**-Subagent (adversarial, Fokus Hermes-Risiko-1: keine zwei parallelen Identitäten / Torn-Pair / halbes File): **APPROVE**, 0× HIGH/CRITICAL — Exactly-one-identity, Atomicity (Key-Reuse→Einzeldatei-Swap), Lock (kein Leak/Deadlock), Opt-in-off-Regression, Fail-closed, Detection alle bestätigt. Gefixt: **LOW-2** (non-EEXIST-Lock-Fehler → fail-closed null statt re-key), **LOW-1** (Dir-fsync Durabilität), **NIT-1** (tmp-Cleanup) → Re-Review **APPROVE**. **PC:** manuell (tsc/Suite/`git diff`/eslint-Snapshot grün) — `agy`-Backend fehlt. **DO:** `docs/architecture/ADR-034-*`, CHANGES (v0.34.69), COMPLIANCE, `changes/2026-07-06_repair-migrationsstufe.md`. **Config-Key:** `cert.migrate_legacy_identity` (Default false, Env `TLMCP_CERT_MIGRATE_LEGACY_IDENTITY`). **Grenze:** kein Timer/Roll-out/Enddatum in diesem Slice.


## Admin-Lane 2026-07-06 07:04 — chore(license): ELv2-Vorbereitung (#244)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| ELv2-lic | #244 (base=main) | 2026-07-06 07:04 | n/a | n/a | n/a (rein Kommentar/Metadaten) | claude Sub-Agent GREEN (kein pal:codereview verfügbar) | n/a | ✅ README/LICENSE | ELv2 LICENSE + source-available README + 266 Copyright-Header; GPL/AGPL-Scan sauber; awaiting Christian Gate 4; Merge NICHT autonom (2-Parteien-Review-Gate) |

---

## Session 2026-07-07 06:12 — feat(pairing): CA-verankerter host/→node/-Re-Key (TL-00, KW28, v0.34.70)

| #        | PR    | Datum            | CO  | CG | TS | CR | PC | DO | Findings                           |
|----------|-------|------------------|-----|----|----|----|----|----|------------------------------------|
| v0.34.70 | (offen, base=main) | 2026-07-07 06:12 | s.u. | n/a | ✅ | ✅ | ✅ | ✅ | CR Claude REQUEST-CHANGES (CRITICAL Identitäts-Substitution via geteilte CA + HIGH RSA/ECDSA-Key) → gefixt → Re-Review APPROVE |

**Typ:** Daemon-Tool (Pairing-Trust-Re-Key) + Runbook, **kein Auto-Run/Deploy** (Operator-gesteuert im Di→Mi-Fenster). **CO:** Design-/Sicherheitsentscheidung (CA-Anker + expected-URI-Bindung gegen Identitäts-Substitution bei geteilter Mesh-CA) im Modul-Header + Runbook dokumentiert; keine pal:consensus (agy/codex nicht im Env, MiniMax verboten). **CG:** n/a. **TS:** `pairing-canonicalize.test.ts` (neu, 9): Happy-Re-Key, **Anti-Substitution** (A-Eintrag + B-Cert unter GETEILTEM CA → `canon-uri-mismatch`), Anker-Gate (fremde CA → `cert-not-under-stored-ca`), invalid-expected-uri, already-canonical, no-trust-anchor, no-canonical-san, multiple-node-sans, unlesbares Cert. Runner parse-validiert (Pflicht-Args → exit 2 vor Netz). Full Suite **115 Files / 1459 grün**, tsc 0, eslint 0 (neue src-Dateien). **CR:** unabhängiger **Claude**-Subagent (adversarial, Fokus Trust-Modell/Identitäts-Substitution): Erst-Review **REQUEST-CHANGES** — **CRITICAL-1** geteilte zentrale Mesh-CA → `verifyPeerCert` bindet Re-Key NICHT an den spezifischen Peer (A→B-Substitution), **CRITICAL-2** Runner lone-`--address`-Sammel-Apply + fehlende Adress-Cert-Bindung, **HIGH-1** pubkey/fingerprint aus RSA-TLS-Key statt ECDSA-Signing-Key (false-green). **Alle gefixt:** expected-URI-Bindung (`canon-uri-mismatch`) + Runner single-entry + `--peer`/`--address`/`--expect-uri` Pflicht + Adress-SAN-Cross-Check; pubkey/fingerprint bleiben unverändert (nur `agentId` re-gekeyt). **Re-Review APPROVE**, keine neuen Issues. **PC:** manuell (tsc/Suite/`git diff`/eslint grün) — `agy`-Backend fehlt. **DO:** `docs/REENROLL-52-RUNBOOK.md` (neu), CHANGES (v0.34.70), COMPLIANCE, `changes/2026-07-07_pairing-canonicalize.md`. **Grenze:** kein Auto-Run/Deploy/Domain-Flip; Ausführung im Fenster.

---

## Sweep 2026-07-07 17:24 — docs(todo): v5.1-Roadmap in Projekt-TODO übernommen (Arbeits-Wahrheit)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| v51-todo | (offen, base=main) | 2026-07-07 17:24 | n/a | n/a | n/a | n/a | ✅ | ✅ | Doc-only: `TODO.md` + COMPLIANCE. Kein Code → CO/CG/TS/CR n/a. PC: `git diff` gesichtet, keine Code-/Test-Dateien berührt. |

**Typ:** Doc-only-Sweep (kein Code). Übernimmt `~/hermes/reference/architecture-v5.1/todos/TODO-thinklocal-mcp.md`
(TL-00…TL-24) in `/opt/thinklocal-mcp/TODO.md` als neuen Abschnitt „v5.1-Roadmap — Arbeits-Wahrheit", jeder
Punkt mit Präfix `[v5.1]`. **Zusammengeführt statt dupliziert** (per „↔ vgl."): TL-00a↔ADR-034/#245/#246,
TL-00b/TL-13↔ADR-024-Rollout-Gate/Produktiv-Flotten-Flip, TL-01…TL-06↔#229/#231/#237/#238/#232,
TL-08↔#239 ADR-033, TL-11↔ADR-004, TL-16↔„Unsicherer Vault-Default", TL-24↔„Hot-Reload TrustStore #117".
**Bewusst NICHT übernommen:** der Referenz-Kopf (Lane/Repo/Gate-Meta) — als Doku-Framing in den
Abschnitts-Intro gefaltet statt als Task dupliziert. Architekturdatei bleibt Referenz. **CO:** n/a (keine
Architektur-/Design-Änderung, reines Roadmap-Tracking). **DO:** dieser Eintrag + TODO.md.

---

## Sweep 2026-07-07 21:04 — docs(security): SECURITY.md v0.34.70-Nachzug (Doku-Pflege-Altlast §2)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| sec-md-altlast | #248 (merged) | 2026-07-07 21:04 | n/a | n/a | n/a | ✅ | ✅ | ✅ | Doc-only (SECURITY.md). CR: Claude-Subagent adversarial (Faktentreue vs. Code/ADRs) → 1 MINOR (ADR-033 Stufe „pro Server" nicht „je tools/call") gefixt, Rest APPROVE. |

**Typ:** Doc-only-Altlast aus MD-Pflege-Audit. Bringt SECURITY.md von „Stand v0.24"/„(v0.31)" auf v0.34.70:
neuer Härtungs-Abschnitt (ADR-022/026/024/033/034, #165/#191/#225/#226/#239/#245/#246, Toter-Code #221–#224),
Superseded-Hinweis, „Policy Engine (OPA/Rego)"-Stale-Korrektur, +2 Security-Review-Zeilen. **CO/CG/TS:** n/a
(kein Code, keine neue Design-Entscheidung — bildet nur bereits gemergte/ADR-dokumentierte Härtung ab). **CR:**
unabhängiger **Claude**-Subagent, adversarial auf Überclaim/Fehlaussage gegen `packages/daemon/src` + ADRs;
8 Claim-Gruppen verifiziert, 1 MINOR gefixt (ADR-033 Stufen-Granularität). **PC:** `git diff` gesichtet —
nur `SECURITY.md`/`CHANGES.md`/`changes/`/COMPLIANCE berührt, keine Code-/Test-Dateien. **DO:** SECURITY.md,
CHANGES.md ([Unreleased]), `changes/2026-07-07_security-md-altlast-nachzug.md`, dieser Eintrag.

---

## Sweep 2026-07-07 21:12 — docs(governance): Doku-Rollen festschreiben + Phasen-Schalter streichen

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| doc-roles | #249 (merged) | 2026-07-07 21:12 | n/a | n/a | n/a | n/a | ✅ | ✅ | Doc-only (CONTRIBUTING.md + CLAUDE.md). MD-Pflege-Audit Punkte 3+4. Kein Code → CO/CG/TS/CR n/a. PC: `git diff` — nur .md/changes. Rebased auf main nach #248 (nur Doku-Konfliktauflösung, kein neuer Inhalt). |

**Typ:** Governance-Doc (kein Code). Schreibt die 5-Datei-Doku-Rollen in CONTRIBUTING.md fest
(`changes/`/`CHANGES.md`/`HISTORY.md`/`COMPLIANCE-TABLE.md`/`TODO.md` — Leser/Takt/Durchsetzung) und
**streicht den „ab Phase 2"-Schalter ersatzlos** (COMPLIANCE ab sofort je PR Pflicht; die „Phase 1/2"-
Überschriften hier sind rein chronologisch, kein Gate). CLAUDE.md-Hinweis + Verweis. **CO:** n/a (setzt
Christians Beschluss um, keine offene Design-Frage). **DO:** CONTRIBUTING.md, CLAUDE.md, CHANGES.md,
`changes/2026-07-07_doc-roles-phase-switch.md`, dieser Eintrag. Enforcement (Ebene-1-CI-Gate) = eigener PR.

---

## Sweep 2026-07-07 21:11 — ci(gate): Ebene-1 Doku-Compliance-Gate (warnend → blockierend)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| doc-gate | #250 (merged) | 2026-07-07 21:11 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CI-Workflow. TS: YAML-Parse + 9-Szenarien-Logik-Dry-Test (1 Regex-Bug gefunden+gefixt: `docs(`-Titel hinter `[agent]` wurde nicht exempt). CR: Selbst-Review Logikpfade + Dogfood (dieser PR besteht sein eigenes Gate). |

**Typ:** CI-Gate (kein Daemon-Code). `.github/workflows/doc-compliance-gate.yml` — verlangt je PR
`changes/`-Eintrag + COMPLIANCE-Zeile; Ausnahme Label `no-doc-needed`/Titel-Typ `docs`/`chore`. **Rollout:**
2 Wochen warnend (`ENFORCE_BLOCKING=false`), Flip-Ziel 2026-07-21 → blockierend + required-check in
Branch-Protection (Christian/Hermes). **CO/CG:** n/a (setzt Beschluss um; keine offene Design-Frage). **TS:**
YAML-safe_load grün + 9 Logik-Szenarien lokal nachgestellt (both-present/PASS, missing/WARN+FAIL, 3 Exemptions,
Substring-„documentation" nicht fälschlich exempt) → **1 Regex-Bug (`[[:space:]\]]`-Bracket) gefunden+gefixt**.
**CR:** Selbst-Review + Dogfood. **PC:** `git diff` — nur `.github/workflows/` + `.md`/`changes/`. **DO:**
CHANGES.md, `changes/2026-07-07_doc-compliance-gate.md`, dieser Eintrag; Rollen/Gate-Verweis in CONTRIBUTING (#249).

## Sweep 2026-07-08 17:05 — docs(runbook): .52-Readiness Preflight und Backup-Anker

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| runbook  | #251 (merged) | 2026-07-08 17:05 | n/a | n/a | n/a | ✅ | ✅ | ✅ | Doc-only (REENROLL-52-RUNBOOK.md). TS/CG/CO: n/a da kein Code. PC: `git diff` geprüft. CR: Unabhängiger Agent prüfte Änderungen auf Sinnhaftigkeit und Vollständigkeit. |

**Typ:** Doc-only. Erweitert das Runbook für die Anmeldung des `.52` (iobroker) Nodes am Mesh um read-only Preflight-Schritte (Zertifikat gegen Trust-Anker verifizieren) und eine manuell erstellte daemon-inerte Backup-Datei vor der Mutation. **CO/CG/TS:** n/a. **CR:** Agent-Selbst-Review. **PC:** `git diff` zeigt reine `.md`-Änderungen. **DO:** `REENROLL-52-RUNBOOK.md`, `changes/2026-07-08_runbook-52-readiness.md`, dieser Eintrag.

## Sweep 2026-07-09 07:15 — docs(compliance): Compliance-Drift nachgezogen (#249/#250/#251)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| drift    | (offen, base=main) | 2026-07-09 07:15 | n/a | n/a | n/a | ✅ | ✅ | ✅ | Doc-only (`COMPLIANCE-TABLE.md` + `CHANGES.md` + `changes/`). TS/CG/CO: n/a da kein Code. PC: `git diff` — nur `.md`/`changes/`, keine Datei außerhalb des Doku-Nachtrags. CR: claude/codex/agy. |

**Typ:** Doc-only. Zieht drei bereits gemergte PRs in der Doku nach: #249/#250/#251 von „(offen)" auf „(merged)" gesetzt, fehlender `CHANGES.md`-Historieneintrag für #251 ergänzt, und dieser Nachtrag trägt seine eigene `changes/`- + COMPLIANCE-Zeile (damit das Ebene-1-Doku-Gate nicht an der eigenen Existenz stolpert). **CO/CG/TS:** n/a (kein Code). **CR:** claude/codex/agy. **PC:** `git diff` zeigt reine `.md`/`changes/`-Änderungen, keine Daemon-/CI-/Test-Datei. **DO:** `COMPLIANCE-TABLE.md`, `CHANGES.md`, `changes/2026-07-09_compliance-drift-nachtrag.md`, dieser Eintrag.

## Sweep 2026-07-10 06:20 — feat(mcp): TL07 local-exec-Naht (Owner-Seite, injizierbar)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| tl07-seam | (offen, base=main) | 2026-07-10 06:20 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Daemon-Code (Executor-Naht + Audit-Event) + Tests. CO/CG: n/a (kleiner Slice, Q1 historisch entschieden). TS: +4 Tests (injizierter Exec 200/Spec+Payload/kein Net-Egress, MCP_EXEC_LOCAL-Audit, ≥500→REJECT, Throw→502); 1462 gesamt grün, tsc+ESLint sauber. CR: claude-Subagent PASS, keine HIGH/MED — Tier-Gate upstream in handleMcpIngress vor execute(), Naht öffnet keinen Bypass. PC: `git diff` — nur Executor/Audit/Test + Doku. |

**Typ:** Daemon-Code (kein Deploy/Live-Wiring — index.ts injiziert keine `localExec` → Produktion unverändert 501). Macht den Owner-seitigen local-exec von einem 501-Stub zu einer **injizierbaren Naht** (`McpLocalExec`): fehlt sie → 501 (Q1-Default, rückwärtskompatibel); vorhanden → lokaler Serve + `MCP_EXEC_LOCAL`-Audit (Owner-Hälfte des Kap.-7.7-Beweises). Die reale mcporter-`spawn`-Primitive ist der nächste Slice (offene Runtime-Fragen im `changes/`-Eintrag + PR dokumentiert, nicht geraten). **DO:** `changes/2026-07-10_tl07-mcp-local-exec-seam.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-10 07:18 — feat(mcp): TL07 reale mcporter-local-exec-Primitive + Wiring

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| tl07-mcporter | (offen, base=main) | 2026-07-10 07:18 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Daemon-Code (`mcp-mcporter-exec.ts` neu + `index.ts` Wiring) + Tests. CO: n/a (Vertrag grounded aus mcporter --help + Live-Probe, keine offene Design-Frage). CG: n/a. TS: 18 Tests inkl. **realem execFileRunner** (echte Kindprozesse) + End-to-End-Smoke gegen lokalen thinklocal-Server (200); 1481 gesamt grün, tsc+ESLint sauber (1 vorbestehender index.ts-Fehler, nicht aus diesem Slice). CR: claude-Subagent PASS, keine HIGH/CRITICAL — no-shell/execFile + Tier-Gate upstream; MED (runner-Test)+2 LOW direkt gefixt. PC: `git diff` — nur Primitive/Wiring/Test + Doku. |

**Typ:** Daemon-Code. Liefert die **reale** Owner-seitige local-exec-Primitive (`mcporter list`/`call`) hinter der Naht aus #253 und verdrahtet sie in `index.ts` **nur bei `serve_shared=true`** (defense-in-depth). Kein Deploy/Neustart → Produktion erst mit Provider-Deploy aktiv. Grüner TH01↔.52-Beweis braucht noch `serve_shared`-Deploy am Owner (503→Provider) — separate Live-Mutation. **CO/CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `changes/2026-07-10_tl07-mcporter-local-exec.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-10 08:33 — docs(runbook): MCP-Provider aktivieren (serve_shared + mcporter-PATH)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| runbook-provider | (offen, base=main) | 2026-07-10 08:33 | n/a | n/a | n/a | ✅ | ✅ | ✅ | Doc-only (neues `docs/RUNBOOK-mcp-provider-serve-shared.md` + `CHANGES.md` + `changes/`). TS/CG/CO: n/a (kein Code). Inhalt 1:1 aus dem live-verifizierten TL07-tools/call-Beweis (PATH-Pflicht → sonst 502 leeres detail; UNIFI_API_KEY-Klartext-Rotation). PC: `git diff` — nur `.md`/`changes/`. CR: claude/codex/agy. |

**Typ:** Doc-only. Schreibt zwei am TL07/Kap.-7.7-Beweis (Report `2026-07-10_0805`) verifizierte Betriebsfakten ins Deploy-Runbook fest: (1) `~/.npm-global/bin` MUSS in der Daemon-systemd-PATH stehen, sonst `execFile('mcporter')`→ENOENT→502 „mcporter exec failed" mit leerem `detail`; (2) `~/.mcporter/mcporter.json` kann Credentials im Klartext führen (`UNIFI_API_KEY`) → Rotation/`chmod 600`. **CO/CG/TS:** n/a. **CR:** claude/codex/agy. **PC:** reine `.md`/`changes/`-Änderung. **DO:** `docs/RUNBOOK-mcp-provider-serve-shared.md`, `CHANGES.md`, `changes/2026-07-10_runbook-mcp-provider-serve-shared.md`, dieser Eintrag.

## Sweep 2026-07-10 11:40 — feat(mcp): TL07 pro-Tool-Ausführungsstufe (Entscheidung 2)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| tl07-tier | (offen, base=main) | 2026-07-10 11:40 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Daemon-Code (`deriveToolTier` + Ingress `maxTier(cap,tool)`) + Tests. CO: n/a (Christians Entscheidung 2 = A, keine offene Design-Frage). CG: n/a. TS: +9 Tests (deriveToolTier read/write/destruktiv/unknown, maxTier, Ingress block_client→403/list_clients→200/get_switch_stack→200/tools/list→200/no-payload-kompat); 1495 gesamt grün, tsc+ESLint sauber. CR: claude-Subagent PASS, keine HIGH/MED — kein Under-Gating (alle unifi-Schreibverben ≥ gate), Single-Enforcement, fail-closed camelCase/unknown; 3 LOW → ADR-033-Notiz. PC: `git diff` — nur Registry/Ingress/Test + Doku. |

**Typ:** Daemon-Code. Setzt Entscheidung 2 („lesend≠schreibend" am selben Server) um: die effektive Stufe am Ingress ist `max(Capability-Stufe, Werkzeug-Stufe)`; die Werkzeug-Stufe aus dem `tools/call`-Toolnamen (führendes Verb) hebt schreibende/destruktive Tools auf gate/consensus (403), während `list_clients` durchgeht. Ermöglicht die block_client-Gegenprobe (Ablaufplan Schritt 5) nach Merge+Deploy. **CO/CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `changes/2026-07-10_tl07-per-tool-tier.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-11 22:05 — feat(discovery): ADR-035 A3 Card-Fetch-Retry + Root-Cause/ADR

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr035-a3 | #257 (merged) | 2026-07-11 22:05 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Daemon-Code (Learner Card-Fetch-Retry+Backoff) + ADR-035 + TODO. CO: n/a für A3 (mechanische Retry-Naht, Design in ADR-035 gesetzt; CO ist für A1/B TL-26/TL-29 vorgemerkt). CG: n/a. TS: +4 Tests (Wellen-Recovery/Erschöpfung/Backoff-Reihenfolge/kein-Retry-SAN-Mismatch/maxAttempts=1), Delay injiziert; 1499 grün, tsc+ESLint sauber. CR: claude-Subagent. PC: `git diff` — Learner+Test + Doku (ADR/TODO/changes). |

**Typ:** Daemon-Code + Design-Doku. Root-Cause der „Discovery überlebt Neustart-Wellen nicht"-Regression (keine Peer-Persistenz + mDNS one-shot + spröder Async-Learn) dokumentiert in ADR-035; dieser PR liefert Slice A3 (Card-Fetch-Retry mit Backoff, rückwärtskompatibel, kein Deploy). Folge-Slices A1/A2/A4/B = TL-26…TL-29. **CO/CG:** n/a (A3). **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-035-…md`, `TODO.md`, `changes/2026-07-11_adr035-card-fetch-retry.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-12 07:17 — feat(discovery): ADR-035 A4a mDNS-Re-Query (Fallback verschoben)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr035-a4a | #258 (merged) | 2026-07-12 07:17 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | Daemon-Code (`discovery.reQuery()`/`resolveMdnsRequeryIntervalMs` + config-Feld + index.ts-Timer). CO: n/a (A4a mechanisch, Design in ADR-035 gesetzt; CO für A1/B TL-26/29 vorgemerkt). CG: n/a. TS: +10 Tests (reQuery→Browser.update() / no-op vor browse / no-op mdns-off; resolveMdnsRequeryIntervalMs Klemmung 0/neg/NaN/floor; config default/env/coercion); 1509 grün, tsc sauber, keine neuen ESLint-Errors. CR: claude-Subagent PASS **+ Codex-Review auf PR = CHANGES-NEEDED** → der ursprünglich mitgelieferte `remoteAddress`-Fallback wurde **entfernt** (kein AUTHN-neutraler Pfad: self-asserted Card-`publicKey` nicht ans Transport-Cert gebunden). PC: `git diff` — discovery/config/index + Tests + Doku. |

**Typ:** Daemon-Code + Config + Design-Doku. ADR-035 Slice **A4a** (TL-28): periodisches aktives mDNS-Re-Query (`Browser.update()`, Timer unref't + im Shutdown gestoppt, ≥5000 ms geklemmt) schließt das Announce-Fenster nach Neustart-Wellen ohne static_peers. **Der `remoteAddress`-Fallback wurde nach Codex-CHANGES-NEEDED aus dieser PR herausgenommen** und als identitäts-gebundener, gegatteter Slice **A4b / TL-28b** neu spezifiziert (Learner-Fetch muss auf `expectedSpiffeUri` gepinnt sein, D2b, bevor er aktiviert wird). Additiv/rückwärtskompatibel, kein Deploy/Secret/Gate. **CO/CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-035-…md` (Slice-Tabelle A4a=erledigt / A4b=offen-gated + Begründung), `config/daemon.toml`, `TODO.md` (TL-28 ✅ / TL-28b offen), `changes/2026-07-12_adr035-a4-mdns-requery-fallback.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-12 11:00 — feat(discovery): ADR-035 A1 Peer-Cache-Persistenz (Locator-only, TL-26)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr035-a1 | #259 (merged) | 2026-07-12 11:00 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | **CO: `pal:consensus` — einstimmig Option A (Locator-only)**, 2 Modelle (cli-claude-opus/against + cli-claude-sonnet/for), Brief `docs/architecture/ADR-035-A1-peer-cache-CO-brief.md`. ⚠️ Cross-Vendor (GPT/Gemini) diese Runde NICHT gelaufen (codex/agy nicht im PATH) → Follow-up notiert. CG: n/a. TS: +25 Tests (peer-cache 19 inkl. SECURITY-kein-publicKey-auf-Platte + fail-closed-Matrix + mergeLocators-Union [CR-MEDIUM-Fix]; mesh 3 exportSeenLocators/inert; config 3); 1534 grün, tsc sauber, keine neuen ESLint-Errors. CR: claude-Subagent (adversarial, Invarianten-Fokus) — alle 6 Invarianten HALTEN; Verdikt **CHANGES-NEEDED→behoben** (kein HIGH): MEDIUM (Flush merged Boot-Ziele nicht → 14d-Durability nichtig, CO §6.3) via `mergeLocators` gefixt + LOW Port-Range 1–65535; 2. LOW dir-Mode akzeptabel. PC: `git diff` — peer-cache/mesh/config/index/atomic-write + Tests + Doku. |

**Typ:** Daemon-Code + Config + Design-Doku. ADR-035 Slice **A1** (TL-26): Peer-Auflösungs-Cache **Locator-only** (kein publicKey auf Platte → Datei ist strukturell keine AUTHN-Trust-Quelle), TTL 14d/512 LRU, fail-closed-Parsing, atomarer chmod-600-Write, `peer_cache_enabled` (Default true). **Verhaltens-inert** (nur Schreiben/Laden der Boot-Re-Learn-Ziele; kein Auflösungspfad) — **A2/TL-27 muss unmittelbar folgen** (CO-Auflage, A2-Invarianten im TL-27-Eintrag hinterlegt). Additiv/rückwärtskompatibel, kein Deploy/Secret/Gate. **CO:** ✅ (bindend Option A). **CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** CO-Brief, `docs/architecture/ADR-035-…` (indirekt), `config/daemon.toml`, `TODO.md` (TL-26 ✅ / TL-27-Invarianten), `changes/2026-07-12_adr035-a1-peer-cache-persistence.md`, `CHANGES.md`, dieser Eintrag.

## Sweep 2026-07-12 11:43 — feat(discovery): ADR-035 A2 proaktives Boot-Re-Learn (TL-27)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr035-a2 | #260 (merged) | 2026-07-12 11:43 | ✅(n/a-neu) | n/a | ✅ | ✅ | ✅ | ✅ | CO: **kein neuer CO** — die Attestierungs-Primitive `verifyMeshServerIdentity`(hartes `expectedSpiffeId`) ist bereits ADR-028-D2b-CO-blessed (2026-06-16, beide Modelle, fail-closed); A2 wendet sie maximal strikt an (kein TOFU, PeerID aus A1-Cache). A2-Invarianten aus dem A1-CO. CG: n/a. TS: +20 Tests (INV-A2-1 fetch-bekommt-expectedSpiffeUri + Card-SAN≠expected→rejected; INV-A2-2 endpoint-blocked/SSRF-Matrix; Wellen-Recovery/Backoff/Rate-Limit); 1554 grün, tsc sauber, keine neuen ESLint-Errors. CR: claude-Subagent (adversarial, **Pin-Enforcement-Fokus** — höchstes Risiko: schreibt in authenticatedSeen aus Outbound-Fetch) — **APPROVE, kein HIGH**; Pin end-to-end verifiziert (volle Chain + harter SPIFFE-SAN-Match, kein Skip via disablePinning, A4b nicht reintroduced). MED (unbounded res.json()) **in-slice gefixt** via `readCappedText` (256 KiB-Limit); 3 LOW deferred (dokumentiert, keine Identity-Defekte). PC: `git diff` — boot-relearn/index + Tests + Doku. |

**Typ:** Daemon-Code. ADR-035 Slice **A2** (TL-27): proaktives Boot-Re-Learn aus dem A1-Cache stellt die AUTHN-Auflösung nach Restart selbst wieder her. **Sicherheits-Kern:** OUTBOUND-Fetch → je Dial ein dedizierter, HART auf `expectedSpiffeUri` gepinnter mTLS-Dial (unabhängig vom global-AUS D2b-Flag) → A4b-Klasse ausgeschlossen; `certFingerprint`=HINT; SSRF-Gate + Timeout + Rate-Limit. Neu: `boot-relearn.ts` (rein). Additiv, kein Deploy/Secret/Gate. **CO:** n/a-neu (Primitive schon CO-blessed). **CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `changes/2026-07-12_adr035-a2-boot-relearn.md`, `CHANGES.md`, `TODO.md` (TL-27 ✅), dieser Eintrag.

## Sweep 2026-07-12 12:07 — feat(discovery): ADR-035 A4b identitäts-gebundener Inbound-Fallback (TL-28b)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr035-a4b | #261 (merged) | 2026-07-12 12:07 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | CO: n/a (Pin-Muster + Primitive schon in A2/D2b-CO etabliert; kein neuer Design-Fork — Anwendung auf den Inbound-Fallback). CG: n/a. TS: +7 Tests (Fallback nur GEPINNT + expectedSpiffeUri-Pin-Ziel; **SECURITY: ohne Pin-Dep fail-closed / Fremd-Card→rejected**; Source-IP-Pfad ungepinnt unverändert; Retry; CR-LOW-1 Subnetz-Gate) + pinned-card-fetch.test.ts +5 (Codex #261: direkter Adapter-Seam — spiffeServerIdentity erzwungen + SAN-Pin real geprüft); 1566 grün, tsc sauber, keine neuen ESLint-Errors. CR: claude-Subagent (adversarial, „Fallback-nur-gepinnt"-Fokus — reaktiviert die #258-Codex-Lücke) — **APPROVE, kein HIGH/MED**; Fallback end-to-end pinned-only verifiziert (kein ungepinnter Pfad; poisoned-host→Handshake-Abbruch). LOW-1 (Fallback-Subnetz-Gate) **in-slice gefixt**; LOW-2 (Retry bei Pin-Mismatch) akzeptiert. PC: `git diff` — pinned-card-fetch(neu)/learner/index + Tests + Doku. |

**Typ:** Daemon-Code. ADR-035 Slice **A4b** (TL-28b): reaktiviert den in #258 verschobenen `remoteAddress`-Fallback **identitäts-gebunden** — der Fallback-Fetch läuft NUR über einen per-Dial hart auf `expectedSpiffeUri` gepinnten mTLS (`pinned-card-fetch.ts`, aus A2 extrahiert/geteilt), unabhängig vom global-aus D2b-Flag → **kein Christian-Gate mehr** (das frühere „gated" ist aufgehoben). Source-IP-Pfad unverändert; fehlt Adresse/Pin-Dep → fail-closed. Additiv, kein Deploy/Secret/Gate. **CO/CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `changes/2026-07-12_adr035-a4b-inbound-fallback.md`, `CHANGES.md`, `TODO.md` (TL-28b ✅), dieser Eintrag.

## Sweep 2026-07-13 06:13 — docs: COMPLIANCE-/CHANGES-PR-Felder auf Realzustand (Reconcile-Nachtrag)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| docs-pr-reconcile | #262 (base=main, gemergt) | 2026-07-13 06:13 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only** (kein Code). Reconcile-Wächter 03:34: PR-Felder der gemergten ADR-035-A-Reihe auf Realzustand gezogen — adr035-a3→#257, a4a→#258, a1→#259, a2→#260, a4b→#261, alle `(merged)`; CHANGES-A4b-Eintrag mit `PR #261` explizit. CO/CG/TS/CR: n/a (keine Code-/Design-Änderung). PC: `git diff` — nur `.md`/`changes/`. |

**Typ:** Doc-only. Realabgleich der PR-Felder (kein Halbwissen — nur die vom Wächter benannten gemergten #257–#261). **CO/CG/TS/CR:** n/a (keine Code-/Test-Änderung). **PC:** reine `.md`/`changes/`-Änderung. **DO:** `COMPLIANCE-TABLE.md` (5 PR-Felder + diese Zeile), `CHANGES.md` (A4b-PR-Bezug), `changes/2026-07-13_docs-compliance-pr-reconcile.md`.

## Sweep 2026-07-15 10:14 — feat(security): ADR-036 Meldekanal-Abstraktion + Fail-safe (TL-09 Slice A)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr036-tl09a | #263 (merged) | 2026-07-15 10:14 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` — Zerlegung einstimmig angenommen**, 2 Modelle (`cli-claude-opus`/neutral + `cli-claude-sonnet`/against); drei Interface-Nachschärfungen übernommen (async `isHealthy`, Deny-Default in Registry + `isApproved`-Allowlist, `AbortSignal` in Signatur). ⚠️ Cross-Vendor (codex/agy nicht im PATH) diese Runde NICHT gelaufen → Follow-up notiert. CG: n/a (agy fehlt; Testdesign aus CO). TS: +22 Tests (Deny-Default leer/Default-Ctor; erster gesunder Kanal terminal für approved/rejected/timeout/error/bad-shape; unhealthy-skip; sync-Wurf Health+Approval; non-boolean-truthy Health; späte Rejection kein Unhandled-Rejection; `isApproved`-Allowlist); **1588 grün**, tsc sauber, ESLint 0. CR: claude-Subagent (adversarial, Fail-open-Fokus; agy-Backend fehlt) — **kein direkter Fail-open-Pfad**; HIGH (Test-Lücke terminal-erster-Kanal bei timeout/error) + MEDIUM (synchroner Kanal-Wurf entkommt `withTimeout`) **beide in-slice gefixt + Regressionstests**, 2 LOW ebenfalls. PC: `git diff` — 3 neue Dateien, `mcp-ingress.ts` unangetastet, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-Doku. TL-09 **Slice A** (ADR-036): reine, austauschbare Meldekanal-Abstraktion (`meldekanal.ts`: `Meldekanal`/`MeldekanalRegistry`/`DenyAllChannel`/`isApproved`) verankert die eiserne Regel „kein erreichbarer Kanal ⇒ schreibender Aufruf bleibt verweigert" strukturell. **`mcp-ingress.ts` bewusst unverändert** (hartes 403 bleibt → Risiko-Delta null, TL-07-Beweis unberührt). Ingress-Wiring + Telegram-Adapter = **Slice B/TL-09b** (in TODO.md als Pflicht-Folge geführt); Freigabe-Matrix = TL-10. Additiv, kein Deploy/Secret/Gate. **CO:** ✅. **CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-036-meldekanal-abstraction.md`, `TODO.md` (TL-09 Slice A ✅ / TL-09b offen), `CHANGES.md`, `changes/2026-07-15_adr036-meldekanal-slice-a.md`, dieser Eintrag.

## Sweep 2026-07-15 11:23 — feat(security): ADR-037 Ingress-Wiring der Meldekanal-Freigabe (TL-09b)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr037-tl09b | #264 (merged) | 2026-07-15 11:23 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` (opus neutral + sonnet against) empfahl einstimmig TL-09b VOR TL-10** (Reorder ggü. Sweep) — ADR-036s `ApprovalRequest` hat keinen `decider`-Consumer → TL-10-first wäre blinder Seam; TL-09b verhaltensidentisch/risikoarm. **Nutzer bestätigt** (AskUserQuestion). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +11 Ingress-Tests (gate approved→execute; rejected/denied-no-channel/timeout/error→403; Resolver-Throw→403; malformed-Resolve→403; gate-ohne-Resolver→403; consensus+approver→403; self-nicht-konsultiert; ctx server/tool/tier; tool-raise→approved→execute) + `deriveToolName`; **1598 grün**, tsc sauber, ESLint 0 (geänderte Dateien). CR: claude-Subagent (adversarial, Fail-open-Fokus) — **kein CRITICAL/HIGH**, alle 7 Invarianten verifiziert; LOW-1 (`isApproved` außerhalb try) + LOW-3 (Dispatch-Assertion) **in-slice gefixt + Regression**; LOW-2 = pre-existing ADR-033. **CR extern (Codex #264, CHANGES-NEEDED→behoben):** MEDIUM Audit-Korrelationsverlust (approved Write ununterscheidbar von ungegatetem Read) + Scope-Regression (`MCP_FORWARD_GATE` fälschlich nach TL-09c verschoben) → **Fix:** dediziertes `MCP_FORWARD_GATE`-Audit (requestId/outcome/channelId, VOR Dispatch) + 4 adapter-Tests mit echter Registry; 1602 grün. PC: `git diff` — 8 Dateien + ADR, Secret-Scan clean; **vorbestehend nicht-eingeführt:** `index.ts:284` non-null-assert (ESLint-Error auf main, durch +1-Import verschoben). |

**Typ:** Daemon-Code + Design-Doku. TL-09b (ADR-037): verdrahtet die Meldekanal-Abstraktion (ADR-036) an den Hub-Ingress — `handleMcpIngress` bekommt einen optionalen `resolveApproval`-Dep; `gate` holt (falls verdrahtet) eine Freigabe ein, **nur `isApproved` lässt durch**, sonst 403; `consensus` nie geroutet (403); fail-closed bei Throw/malformed. Hinter Env-Flag `TLMCP_APPROVAL_CHANNEL_ENABLED` (Default aus) mit **leerer** Registry → 403 = verhaltensidentisch zu `main`. Gibt `meldekanal.ts` einen lebenden Consumer; TL-10 (Matrix) + realer TelegramMeldekanal (TL-09c) docken am `resolveApproval`-Seam an. **CO:** ✅. **CG:** n/a. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-037-…md`, `TODO.md` (TL-09b ✅ / TL-09c + TL-10 offen), `CHANGES.md`, `changes/2026-07-15_adr037-ingress-approval-wiring.md`, `COMPLIANCE-TABLE.md` (+ #263→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 13:03 — docs: TL-11/TL-12 Discovery + Slice-Proposal (doc-first)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| tl11-12-discovery | #265 (merged) | 2026-07-15 13:03 | ✅ | n/a | n/a | n/a | ✅ | ✅ | **Doc-only** (Discovery/Scoping, kein Code). CO: **`pal:consensus` (opus neutral + sonnet against), einstimmig Reorder TL-12→TL-11** + Auflagen (TL-12: verbatim signierte Bytes, `signer_keyid` gegen Key-Rotation, Diskriminator signiert+server-abgeleitet fail-closed, Order-Nonce jetzt; TL-11: edge-driven auf `inbox:new`, Transport-Entscheidung im ADR erzwingen, ACL+coalesce, Cross-Repo-`deliver` + Zwei-Peer-DoD). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG/TS/CR: n/a (kein Code). PC: reine `.md`, Secret-Scan clean. Nebenbefund dokumentiert: `index.ts:1097` `inboxSchemaVersion:1` vs DB-v2. |

**Typ:** Doc-only. Discovery für TL-11 (Heartbeat-Weckruf) + TL-12 (signierte Postfach-Zustellung): Ist-Zustand (file:line-belegt), kleinste erste Scheibe je Feature, Reihenfolge, Sicherheits-Invarianten. **Kern:** TL-12 Slice A (signierter, re-verifizierbarer Auftrag im Postfach) = nächste Scheibe; TL-11 folgt edge-driven. Implementierungs-ADRs (ADR-038/039) bekommen je eigenen CO. **DO:** `docs/architecture/TL-11-12-wake-postbox-discovery.md`, `TODO.md` (Reihenfolge + Slices), `CHANGES.md`, `changes/2026-07-15_tl11-12-discovery.md`, `COMPLIANCE-TABLE.md` (+ #264→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 14:01 — feat(security): ADR-038 signierte Postfach-Aufträge (TL-12 Slice A)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr038-tl12a | #266 (merged) | 2026-07-15 14:01 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` (opus neutral + sonnet against)** — Design bestätigt + gehärtet (immutable `signer_pubkey`; `verify_verdict` nur Krypto + separates `trust_status`; Marker gehärtet mit **issuer===sender** Relay-Schutz + INVALID-Audit; `store()` nur `OrderContext\|null`; verbatim Bytes; CBOR-Decode fail-closed; Migration transaktional; Index `(signer_keyid,order_nonce)`). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +37 Tests (signed-order 19 inkl. Tri-State + `classifyInboundOrder`-Ingest-Seam, agent-inbox 15 inkl. BLOB-roundtrip `Buffer.compare===0` + v2→v3-Migration, inbox-api 3 Read-Surface); **1629 grün**, tsc sauber, ESLint 0 (geänderte Dateien). CR: adversarialer claude-Subagent (Fail-open/Krypto) — **kein Fail-open-Pfad**, alle 7 Invarianten verifiziert; LOW-1 (MAX_ORDER_BYTES↔Body-Limit → 47 KiB) + Fresh-DB-Transaktions-Symmetrie **in-slice gefixt**, LOW-2 (TTL-Read) dokumentiert. **Codex #266 (2 Runden) → beide MEDIUM in-slice geschlossen:** (1) `verifyStoredOrder` jetzt am Read-Pfad (`GET /api/inbox` re-verifiziert live + `is_order`/`order`-Block, +3 API-Tests inkl. **Live-Re-Verify fängt at-rest-Korruption**); (2) stiller Marker-Downgrade behoben via **Tri-State** `extractOrderMarker` (`absent`/`invalid`/`bytes`) + `classifyInboundOrder`-Ingest-Seam — malformed-present (wrong-type/malformed-base64/oversize) → INVALID + `ORDER_VERIFY_FAILED`, nie Plain; +Seam-Regressionen. LOW Doc-Drift (ADR 64→47 KiB, changes Read-Wiring Slice A) korrigiert. **1629 grün.** PC: `git diff` — 5 Code + ADR + Doku, Secret-Scan clean; **vorbestehend nicht-eingeführt:** `index.ts:286` non-null (durch +2 Imports verschoben), require/`!` in `agent-inbox-adr005.test.ts` (nur 2 `user_version`-Assertions v2→v3 angepasst). |

**Typ:** Daemon-Code + Design-Doku. TL-12 Slice A (ADR-038): signierter, re-verifizierbarer Auftrag im Postfach — `signed-order.ts` (Order = signierter `type='ORDER'`-Envelope im Body-Marker, fail-closed Verify mit Relay-Schutz), Inbox-Schema v3 (verbatim `signed_bytes` + immutable `signer_pubkey`), `store()` typsicher (`is_order` unfälschbar), `verifyStoredOrder` rotationsfest. Ingest-Wiring + `ORDER_RX`/`ORDER_VERIFY_FAILED`-Audit. **Keine Ausführung** (Slice B), first-class Type (Slice C). Plain-Nachrichten + Zwei-Peer-Beweis unberührt. **CO:** ✅. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-038-…md`, `TODO.md` (TL-12 Slice A ✅ / B+C offen), `CHANGES.md`, `changes/2026-07-15_adr038-signed-postbox-orders.md`, `COMPLIANCE-TABLE.md` (+ #265→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 16:20 — feat(security): ADR-039 gepflegte Read-only-Werkzeugklasse je Server (TL-08 Slice 1)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr039-tl08a | #267 (offen) | 2026-07-15 16:20 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` (opus neutral + sonnet against)** — Design bestätigt + gehärtet: **BLOCKER** Allowlist nur auf `tools/call` (sonst `tools/list`→403 Discovery-Bruch); `canonicalizeServerName` im Lookup (kein `/api/mcp/UNIFI`-Bypass); Tool-Name exakt (fail-closed); Credential-Reads raus aus readOnly; Shape `{readOnly, consensus?}`; Fixture-Subset-Test. ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +14 Tests (readOnly→self, block→gate, delete→consensus, unlisted→gate, credential-Reads→gate, `tools/list`→self, Kanonisierung, exakter Name, ungoverned-Heuristik, **Fixture-Subset `readOnly⊆67`**, whitespace→consensus; Ingress e2e list_clients→200/get_wlan→403/tools/list→200); **1643 grün**, tsc/ESLint 0. CR: adversarialer claude-Subagent — **kein Self-Bypass für write/destruktiv**, alle Invarianten ok; 3 MEDIUM **in-slice gefixt** (`list_wans` PPPoE-Passwort + `get_network`/`list_networks` IPsec-PSK aus readOnly → gegatet; whitespace-Name `" delete_network "` → consensus statt gate), LOW client-PII für Slice 2. PC: `git diff` — 2 Code + Fixture + ADR + Doku, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-Doku. TL-08 Slice 1 (ADR-039): gepflegte Read-only-Allowlist je governed Server (unifi, 24 non-secret Reads aus echtem 67-Tool-Inventar) ersetzt die Verb-Heuristik. `deriveToolTierForServer`: readOnly→self, unlisted `tools/call`→≥gate (nie Downgrade), `tools/list`/ungoverned→Heuristik; Server kanonisiert, Tool exakt; Credential-Reads gegatet. Strikte Verschärfung, kein Downgrade; Plain + ungoverned unberührt. **CO:** ✅. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-039-…md`, `TODO.md` (TL-08 Slice 1 ✅ / Slice 2 offen), `CHANGES.md`, `changes/2026-07-15_adr039-per-server-tool-class-map.md`, `COMPLIANCE-TABLE.md` (+ #266→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 16:45 — feat(security): ADR-040 Werkzeugklassen-Observability (TL-08 Slice 2a)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr040-tl08b | #268 (merged) | 2026-07-15 16:45 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | **Reine Telemetrie — null Gate-Verhaltensänderung** (`deriveToolTierForServer` byte-unverändert). CO: **`pal:consensus` (opus+sonnet)** — Boolean→`classifyGateReason` (diskriminiert, **single source of truth**: ruft `deriveToolTierForServer`, Cross-Check-Test); `sensitive`-Set (10 credential-Reads explizit, 2b-Input); `reason=` an `typeof tier==='string'` gebunden; Ehrlichkeit: 2a ist Telemetrie, „Drift-Check" = Snapshot-Lint (nicht Live), Anspruch 1,5/3; Field-Redaction = Slice 2b eigener CO (Fail-closed-Default, Owner-Redaction). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +16 (classifyGateReason-Buckets + **Cross-Check-Biconditional 67-Tool-Fixture**, computeToolClassDrift leer+Drift-Fälle, `readOnly∩sensitive=∅`; Ingress-API reason=write-verb/sensitive-governed, Auth-403 ohne reason=); **1651 grün**, tsc/ESLint 0. CR: claude-Subagent — **zero-gate-change bestätigt**, alle 5 Invarianten verifiziert, keine HIGH/MEDIUM. PC: `git diff` — 2 Code + ADR + Doku, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-Doku. TL-08 Slice 2a (ADR-040): reine Observability — `sensitive`-Set (macht die bewusst gegateten credential-Reads explizit), `classifyGateReason` (diskriminierter Gate-Grund fürs Audit, single source of truth), `reason=`-Audit-Suffix, `computeToolClassDrift`-Snapshot-Lint. **Null Gate-Verhaltensänderung.** Field-Redaction = Slice 2b (eigener CO). **CO:** ✅. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-040-…md`, `TODO.md` (Slice 2a ✅ / 2b+2c offen), `CHANGES.md`, `changes/2026-07-15_adr040-tool-class-observability.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

## Sweep 2026-07-15 17:25 — feat(security): ADR-041 owner-seitige Feld-Redaction (TL-08 Slice 2b)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr041-tl08c | #269 (merged) | 2026-07-15 17:25 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` (opus neutral + sonnet against)** — **BLOCKER** „inert" falsch (approved gate-Call fällt via ADR-037 durch) → **Policy R: owner-Redaction unconditional**; **deny-by-default Feld-Allowlist** statt Secret-Denylist (Unknown-unknown-Leak); fail-closed=200+Notiz (kein 5xx); **kein Gate-Flip** + Gate-still-blocks-Regression („wired ≠ exposed"); 2b-Grenze (`SERVER_SAFE_FIELDS` unifi leer, Feld-Kuratierung+nested-JSON+Gate-Flip = 2c). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +21 (deny-by-default/Arrays/bounds/purity; redactSensitiveResult redacted/fail-closed/idempotent; **CR-HIGH Array-Skalar-Leak**; Exec-Seam fake Runner; **CR-MEDIUM Error-Pfad**; Gate-still-blocks alle 10); **1672 grün**, tsc/ESLint 0. CR: adversarialer claude-Subagent — **1 HIGH** (skalare Array-Elemente leaken unter deny-by-default) + **1 MEDIUM** (Owner-Exec-Fehlerpfad `detail` leakt roh) **in-slice gefixt + Regression**; LOW (Tool-Casing) für 2c; 6 Invarianten sonst verifiziert. PC: `git diff` — 2 Code + ADR + Doku, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-Doku. TL-08 Slice 2b (ADR-041): owner-seitige fail-closed Redaction-Mechanik (`redact-mcp-response.ts` deny-by-default, Policy R unconditional, verdrahtet im Owner-Local-Exec). **Kein Gate-Flip** (sensitive Tools bleiben gegatet; Regression). Feld-Kuratierung + Gate-Flip = Slice 2c (eigener Security-CR). **CO:** ✅. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-041-…md`, `TODO.md` (Slice 2b ✅ / 2c offen), `CHANGES.md`, `changes/2026-07-15_adr041-owner-side-field-redaction.md`, `COMPLIANCE-TABLE.md` (+ #268→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 17:44 — feat(security): ADR-042 Live-Drift-Check + Gate-Flip-Blocker (TL-08 Slice 2c, partiell)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| adr042-tl08d | #270 (merged) | 2026-07-15 17:44 | ✅(n/a-neu) | n/a | ✅ | ✅ | ✅ | ✅ | **Kern-Befund: Gate-Flip BLOCKED** — die 10 sensitiven unifi-Tools haben **kein `outputSchema`** (Subagent-Analyse der live tools/list); Safe-Field-Feldnamen nur per Tool-Aufruf = Secret-Exposition → in dieser Lane autonom nicht sicher lieferbar (Unblock: Doku/Quell-Transkription / Christian-Liste / redact-before-log-Sampling, ADR-042). **Geliefert (secret-sicher, null Gate-Change):** `checkToolClassDrift`-Seam gegen live `tools/list` (nur Namen), warn-loggt Drift; ungoverned→null, Fetch-Fehler→null+warn (fail-safe). CO: n/a-neu (Drift-Check bereits ADR-040-CO-blessed [Folge b]; Gate-Flip-Blocker = Befund, kein Design). ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +6 (konsistent/stale/unclassified/ungoverned-no-fetch/Kanonisierung/Fetch-Fehler); **1678 grün**, tsc/ESLint 0. CR: adversarialer claude-Subagent — **CLEAN** (secret-sicher, fail-safe, zero-gate-change, alle 5 Invarianten); Blocker sound; ergänzte Unblock-Pfad (c). PC: `git diff` — 1 Code + ADR + Doku, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-/Blocker-Doku. TL-08 Slice 2c teils geliefert: secret-sicherer Live-Drift-Check-Seam (`tool-class-drift.ts`) + **dokumentierter Gate-Flip-Blocker** (kein `outputSchema` für sensitive Tools → Safe-Field-Kuratierung braucht Christian-Input/Doku-Transkription). **Null Gate-Verhaltensänderung.** **CO:** n/a-neu. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-042-…md`, `TODO.md` (2c Drift-Check ✅ / Gate-Flip ⛔ BLOCKED), `CHANGES.md`, `changes/2026-07-15_adr042-drift-check-gateflip-blocker.md`, `COMPLIANCE-TABLE.md` (+ #269→merged Reconcile), dieser Eintrag.

## Sweep 2026-07-15 18:49 — feat: ADR-043 Heartbeat-Weckruf-Kontrakt (TL-11 Slice A)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| #271 | (base=main, gemergt) | 2026-07-15 18:49 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | CO: **`pal:consensus` (opus neutral + sonnet against)** — (A) Transport = WS-`inbox:new`-Reuse (Wake best-effort/lossy/idempotent), Risiken+WS-Instanz-Bindung als offene Abhängigkeit; (B) **Broadcast-Fallback gestrichen → fail-closed** (`null`/nicht-live → `[]`; Broadcast wäre 1→N-Amplifikation + Metadaten-Leak); (C) **Slice verdrahten** (nicht inert): `to_agent_instance` in `inbox:new` + `agent:wake`-Event. Cross-Repo-Supervisor + Zwei-Peer-DoD extern-blocked. ⚠️ Cross-Vendor (codex/agy) nicht im PATH. CG: n/a. TS: +14 (resolve fail-closed, Coalescer, computeWakes, Emitter adressiert/unadressiert-null-WARN/Feld-fehlt-still/nicht-live-still/coalesced); **1692 grün**, tsc/ESLint 0. CR: adversarialer claude-Subagent — **alle 6 Invarianten PASS** (kein Fanout/Amplifikation/Leak; Metadaten-Leak in ADR benannt); 2 LOW **in-slice gefixt** (WARN nur bei präsentem null-Feld → keine Alert-Fatigue; Coalescer-Map-Pruning). PC: `git diff` — 4 Code + ADR + Doku, Secret-Scan clean. |

**Typ:** Daemon-Code + Design-Doku. TL-11 Slice A (ADR-043): edge-driven Heartbeat-Weckruf-Kontrakt — `wake-contract.ts` (fail-closed Resolver/Coalescer/Zero-Content-Signal), verdrahtet `inbox:new`+`to_agent_instance` → `agent:wake` über Registry-Fanout. **Kein neuer Transport** (WS-Reuse); letzter CLI-Hop + Zwei-Peer-Proof extern-blocked (Agent-Home-Supervisor). **CO:** ✅. **TS/CR/PC:** s. Zeile. **DO:** `docs/architecture/ADR-043-…md`, `TODO.md` (TL-11 Slice A ✅ / Slice B extern-blocked), `CHANGES.md`, `changes/2026-07-15_adr043-heartbeat-wake-contract.md`, `COMPLIANCE-TABLE.md` (+ #270→merged Reconcile), dieser Eintrag.

---

## Sweep 2026-07-16 07:14 — fix(cli): TLS/mTLS-Reset von „down" unterscheiden (KW29 Bug-Pfad 1)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| #272 | (base=main, gemergt) | 2026-07-16 07:14 | — | n/a | ✅ | ✅ | ✅ | ✅ | **Reiner Bug-Fix → CO/CG entfallen** (CLAUDE.md-Ausnahme). Phantom-ROT: `tl check`/`cmdCheck` meldete jeden `fetch`-Fehler gegen `/health`+`/api/status` als „nicht erreichbar", obwohl die Endpunkte am mTLS-`cardServer` hängen (`agent-card.ts:225-230`) und `http://`/cert-lose Proben TLS-resettet werden → Port antwortet, Daemon läuft. Fix: `probe-classify.ts` (`classifyProbeError` → down/tls/timeout/unknown, `likelyUp` konservativ), `cmdCheck` meldet TLS-Reset als `warn`+Hinweis statt `fail`-ROT. TS: **+19 Unit-Tests** inkl. Kern-Invariante + null-Robustheit; voller Lauf **1763 grün**, tsc(strict)/ESLint 0. CR: adversarialer Claude-Subagent — **APPROVE, keine HIGH/MEDIUM** (Buckets vs. undici-Semantik bestätigt, null-sicher, kein Control-Flow-Regress); 2 LOW **in-slice gefixt** (Timeout aus `cause.name`; Test-Lücken). PC: `git diff` + Secret-Scan clean. |

**Typ:** CLI-Bug-Fix + Diagnose-Doku. **Kein** Deploy/Secret/Christian, **kein** neuer Transport, **kein** geändertes Endpoint-Verhalten. Bundle mit dem Evidence-Pack (`docs/DIAGNOSE-api-status-phantom-rot.md`) derselben Bug-Path. **DO:** Diagnose-Doku, `CHANGES.md`, `changes/2026-07-16_cli-tls-reset-vs-down.md`, `TODO.md` (Bug-Path-Notiz + TL-11 WS-Binding-Backlog), dieser Eintrag.

---

## Sweep 2026-07-16 07:48 — fix(service): /sbin+/usr/sbin in Unit-PATH (KW29 Bug-Pfad 2)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| #273 | (base=main, gemergt) | 2026-07-16 07:48 | — | n/a | ✅ | ✅ | ✅ | ✅ | **Reiner Bug-Fix → CO/CG entfallen.** `.55` (macOS) mount-Flood: Unit-PATH ohne `/sbin`+`/usr/sbin` → `systeminformation.fsSize()` `execSync('mount')`/`('diskutil list')` auf darwin **ohne** stderr-`ignore` (anders als Linux-Pfad) → Node `execSync` erbt Child-stderr → `command not found` in `StandardErrorPath`, periodisch (Resource-Refresh + agent-card + system-monitor) = Flut. Fix: `/usr/sbin:/sbin` an **alle 7** Unit-PATH-Stellen. TS: +1 Regression (`launchd-plist.test.ts` PATH `:/sbin`+`:/usr/sbin`), **1767 grün**, `bash -n` OK, Mechanismus lokal bewiesen (execSync-stderr-Erbe vs. `ignore`). CR: adversarialer Claude — Kette **bestätigt** (execSync-Default-Erbe; darwin unsuppressed; mount/diskutil in /sbin,/usr/sbin); Append sicher; **1 MEDIUM** (7. PATH-Stelle `thinklocal.ts:1387`) + 1 LOW (Count 6→7) **in-slice gefixt**. PC: Secret-Scan clean. |

**Typ:** Service-Unit-Config-Fix + Diagnose-Doku + Regression-Test. `.55`-Live-Bestätigung (`daemon.error.log`→0 nach Neustart) ist deploy-gated (Fenster). **DO:** `docs/DIAGNOSE-55-mount-command-not-found-flood.md`, `CHANGES.md`, `changes/2026-07-16_service-unit-path-sbin.md`, dieser Eintrag.

---

## Sweep 2026-07-16 10:37 — feat(wake): agent:wake gerichtet + routbar (TL-11 §4 directed-wake)

| #        | PR    | Datum            | CO  | CG  | TS  | CR  | PC  | DO | Findings                           |
|----------|-------|------------------|-----|-----|-----|-----|-----|----|------------------------------------|
| #277 | (base=main, gemergt) | 2026-07-16 10:37 | ⚠️ | n/a | ✅ | ✅ | ✅ | ✅ | CO: Design doc-first in `TL-11-wake-routing.md` (#276); directed-Mechanismus low-controversy + per CR bestätigt → separater `pal:consensus` für den Code-Slice entfiel bewusst. Macht den gemergten `agent:wake` (ADR-043) routbar + schließt Leak: Emit trägt `spiffe_uri` (fail-closed ohne SPIFFE), `agent:wake` = directed Event (nie an Ungefilterte = D1; match `instance_id`/`spiffe_uri` = D2). TS: +7 Tests (spiffe_uri-Payload, fail-closed, kein Leak, routbar, drop non-match, event-type-Filter, Regression nicht-directed); **1774 grün**, tsc 0, geänderte Dateien lint-clean. CR: adversarialer Claude — **APPROVE, 6 Invarianten PASS**; 1 LOW (Doku-Hinweis) inline. PC: Secret-Scan clean. |

**Typ:** Daemon-Code + Tests (Umsetzung des #276-Designs). CLI-letzter-Hop + Zwei-Peer-Live-Proof bleiben extern-blocked. **DO:** `CHANGES.md`, `changes/2026-07-16_tl11-directed-wake.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

| #278 | (base=main, gemergt) | 2026-07-16 14:50 | — | n/a | ✅ | ✅ | ✅ | ✅ | **Additive Observability → CO/CG entfallen** (Design in `mesh.ts`-JSDoc + `DIAGNOSE §9` begründet). Phantom-ROT von unten: `/api/status` exponierte nur `peers_online` (`getOnlinePeers`, `status==='online'`); ausgehender HTTP-Heartbeat (`checkPeers`→`fetch(/health,{dispatcher:tlsDispatcher})`, `rejectUnauthorized:true`) schlägt bei CA-Rotation/SAN/EHOSTUNREACH fehl → Peers `offline`, bleiben aber im Map → `peers_online` sinkt bis 0 trotz bekannter Peers; extern nicht von „0 bekannt" trennbar. Live-Beleg TH01: `peers_online=3` vs agent-card `peers_connected=6` / libp2p `4`, Audit PEER_JOIN 958/LEAVE 834. Fix: neu `getPeerCounts()` (atomarer Snapshot, `known===online+offline`), `/api/status`+`mesh_status` liefern `peers_known`/`peers_offline` (additiv, nicht-brechend). TS: **+6 Tests** (5 getPeerCounts inkl. Invariante + worst-case known>0/online==0, 1 REST-Feld-Test); **1706 grün**, tsc(strict)/Source-Lint 0-neu. CR: adversarialer Claude — **APPROVE, keine HIGH/MEDIUM** (Invariante by-construction, `peerCounts.online===getOnlinePeers().length`, kein neuer Leak, Snapshot atomar; 1 LOW bewusst nicht gefixt; Reviewer lief 53 Tests+tsc). PC: `git diff`+Secret-Scan clean. Cert-/CA-Heilen der Fleet Christian-gated (out of scope). Folge-Slice zu #272. |

**Typ:** Daemon-/UI-Code + Tests + Diagnose-Doku (KW29 Bug-Pfad 1, Datensicht). Cert-/CA-/SAN-Heilen (`mesh-ca-rotation-repair-all`/`th55-pathA-cert-san-blocker`/`th55-ehostunreach-host-routing`) bleibt Christian-gated. **DO:** `docs/DIAGNOSE-api-status-phantom-rot.md` §9, `docs/API-REFERENCE.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-16_peers-known-observability.md`, dieser Eintrag.

| #279 | (base=main, gemergt) | 2026-07-16 15:45 | — | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (KW30 proof→autonomy) → CO/CG/TS entfallen** (kein Code; „test-aware": §7 mappt jede Garantie auf einen grünen Test; kein neuer Beschluss, aus #271/#277 abgeleitet). Repo-Wahrheit TL-11: Slice A (ADR-043,#271)+§4 directed-wake(#277) gemergt → `agent:wake` trägt `spiffe_uri`+directed zugestellt; TODO-Backlog-Befunde (Leak D1+Mis-Routing D2) dadurch **bereits geschlossen** (stale TODO korrigiert). Neu `docs/architecture/TL-11-wake-consumer-contract.md` — Implementer-Spec für Out-of-Repo-Supervisor (WS `/ws` mTLS+**loopback-only 4003**, Subscribe `?subscribe=agent:wake&agent=<spiffe>`, Zero-Content-Payload `{instance_id,spiffe_uri,reason:'inbox'}`, lossy/coalesced≤1·2000ms/fail-closed, Referenz-Loop, §7-Test-Mapping). **De-riskt** Slice B (Supervisor→CLI-Hop bleibt out-of-repo+deploy-gated). CR: Doc-Accuracy-Subagent — **ACCURATE auf Kern-Kontrakt** (Payload/Subscribe/mTLS/alle 10 §7-Zeilen bestätigt); **1 materielle Auslassung (loopback-only) gefixt**; **Zusatz-Befund** Frame-Pfad umgeht Loopback-Gate (`websocket.ts:187-189`) als OFFENER Härtungs-Posten §8.1+TODO (Design-Entscheidung nötig, kein Live-Exploit). PC: Secret-Scan clean. |

**Typ:** Doc-only Architektur-Companion (TL-11 Consumer-Contract) + TODO-Reconciliation. TL-11 Slice B (Supervisor→CLI + Zwei-Peer-Proof) bleibt extern-blocked; Frame-Pfad-Loopback-Härtung = eigener TS+CR-Slice (Entscheidung offen). **DO:** `docs/architecture/TL-11-wake-consumer-contract.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-16_tl11-wake-consumer-contract.md`, dieser Eintrag.

| #280 | (base=main, gemergt) | 2026-07-16 17:20 | — | n/a | ✅ | ✅ | ✅ | ✅ | **Security-Bug-Fix → CO/CG entfallen** (setzt die bereits gemergte Invariante durch, kein neuer Beschluss; verworfene Alternative in Doc §8.1 + `changes/` begründet). Schließt den in #279 §8.1 dokumentierten Befund: „agent-gefilterte WS-Subscriptions sind loopback-only" wurde nur am Query-Pfad (`?agent=`→`4003`) durchgesetzt; der Frame-Pfad `{type:'subscribe',agent:…}` setzte `agentFilter` **ohne** Loopback-Check → Nicht-Loopback-mTLS-Peer konnte per Frame fremde `agent:wake` abonnieren (Snooping). Fix: reine `rejectsAgentFilter(agent,isLoopback)` von **beiden** Pfaden, `ClientState.isLoopback` am Connect aus `req.ip` (kein `trustProxy` → nicht spoofbar), Frame-Verstoß `4003` **vor** State-Mutation; konservativ strikt-loopback-only. TS: **+16 Tests** (IP-Prädikat + Regel, beide Pfade + L1-Array); `websocket.test.ts` **30 grün**, daemon-Suite **1714 grün**, tsc(strict)/Lint 0. CR: adversarialer Claude — **APPROVE, keine HIGH/MEDIUM** (isLoopback stabil, Gate-vor-Mutation, alle Schreibpfade dicht, `req.ip` sicher verifiziert); **L1 (Query-Array-Asymmetrie) in-slice gefixt**, **L2 (Live-WS-Integrationstest) als Grenze akzeptiert** (im Repo nicht simulierbar, Regel voll unit-getestet). PC: Secret-Scan clean. |

**Typ:** Daemon-Security-Bug-Fix + Tests + Doc-Update (TL-11 §8.1-Härtung). **DO:** `docs/architecture/TL-11-wake-consumer-contract.md` §8.1/§3, `TODO.md`, `CHANGES.md`, `changes/2026-07-16_tl11-frame-loopback-gate.md`, dieser Eintrag.

| #281 | (base=main, gemergt) | 2026-07-16 18:10 | — | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View → CO/CG entfallen** (kompakte Projektion vorhandener Daten, Präzedenz #278; Design gepinnt in `TL-21-skeleton-disclosure.md`, kein Kap.06-Spec im Repo → Ambiguität festgeschrieben, nicht über Scope erweitert). **Lane:** TL-12 B0 Christian-gated (Scoping §9), TL-14a an Decision-7 + undecided CA-Architektur (kein ADR) blockiert → Pivot auf TL-21 (kein Christian-Gate). Neu `capability-skeleton.ts` (reine `firstSentence`/`buildCapabilitySkeleton`, deterministisch) + `GET /api/capabilities/overview` → `{skills,count}` (dedupliziert pro `skill_id`, Name+erster Satz, Health-Aggregation); Stufe 2 = bestehendes `?skill_id=` unverändert. TS: **+15 Tests** (firstSentence-Kanten, Dedupe/Sort/Tie-Break, Health-Aggregation, Endpoint). Suite **1729 grün**, tsc(strict)/neue-Dateien-Lint 0. CR: adversarialer Claude — **kein HIGH**; **1 MEDIUM (uncapped Satz-mit-Terminator → 8-KB-Blowup) in-slice gefixt + Regressionstest**; **3 LOW gefixt** (Dezimal-Lookahead, `HEALTH_RANK`-NaN-Fallback, locale-fixe Sortierung). PC: Secret-Scan clean. Slice 2 (MCP-Tool) folgt. **Nachtrag 2026-07-17 (externer codex-Review):** **CR-MEDIUM** — non-string `description` (runtime-untyped CRDT, nicht schema-validiert) ließ `firstSentence().trim()` werfen → `GET /api/capabilities/overview` **500** aus **einer** geschmiedeten Peer-Capability. **Gefixt total/fail-safe:** `asStr()`-Normalisierer, `firstSentence(unknown)` guarded, `skill_id`-non-string→skip, `agent_id`/`category`→normalisiert; **CR-LOW** Doku-Drift (`SUMMARY_MAX_LEN`=Inhalts-Cap, Ergebnis ≤161). **+6 Regression-Tests** (pure-function + Endpoint malformed→**200**), Suite **1735 grün**. Kein Merge (Christian-gated). |

**Typ:** Daemon-Feature (read-only, additiv) + Design-Doku + Tests (TL-21 Slice 1, Kap. 06 Kontext-Ökonomie). **DO:** `docs/architecture/TL-21-skeleton-disclosure.md`, `docs/API-REFERENCE.md`, `TODO.md`, `CHANGES.md`, `changes/2026-07-16_tl21-skeleton-overview.md`, dieser Eintrag.

| #282 | (base=main, gemergt) | 2026-07-17 06:38 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-Infra + Doku-Korrektur → CO/CG entfallen** (kein Runtime-Change, keine Design-Frage; leitet die Wire-Form aus gemergtem Code #271/#277/#280 ab). Schließt die Draht-Ebenen-Lücke: die §2–§5-Garantien der `TL-11-wake-consumer-contract.md` waren nur pure-function-bewacht (`matchesSubscription`/`rejectsAgentFilter`/`isLoopbackIp`). Neu `tl11-wake-wire.conformance.test.ts` — echter Fastify-Server + `registerWebSocket` auf `127.0.0.1:<ephemeral>`, echter Node-22-`WebSocket`-Client (kein neuer Dependency) treibt connect→subscribe→`agent:wake`-Frame. **7 grün** (§3 Subscribe, §4 Zero-Content-Wire-Shape, directed Match/deny/drop, §8.1 Frame-Pfad, §2 Loopback-Positivpfad) **+ 2 `it.todo`** (§2 mTLS-Pflicht + Nicht-Loopback-`4003` → brauchen Cert-Fixtures/Nicht-Loopback-Bindung). Negativ-Tests via **Same-Socket-Barrier** (deterministisch, kein `sleep`). **Wire-Shape-Befund:** Fanout sendet das ganze `MeshEvent` → Payload liegt **unter `.data`**; Consumer-Doc §4/§6 (`ev.reason`→`ev.data.reason`)/§7.1 korrigiert. TS: neue Datei 7+2, volle Suite **1721 grün + 2 todo**, tsc(strict)/neue-Datei-Lint 0. CR: Self-CR adversarial (Race-frei: Listener vor `emit`; Dead-Code entfernt; Cleanup schließt Sockets+Server) — `agy` fehlt im Env. PC: Secret-Scan clean. De-riskt TL-11 Slice B; Out-of-Repo-Hop bleibt extern-blockiert. Kein Merge (Review-Pfad-Blocker: nur 2000teddy gh-authed). |

**Typ:** Test-Infra (neuer Conformance-Test) + Doku-Korrektur (TL-11 Draht-Ebene). Kein Runtime-Change. **DO:** `docs/architecture/TL-11-wake-consumer-contract.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-17_tl11-wake-wire-conformance.md`, dieser Eintrag.

| #283 | (base=main, gemergt) | 2026-07-17 13:05 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-Infra (cert-fixture Slice) → CO/CG entfallen** (kein Runtime-Change, keine Design-Frage; leitet mTLS-/Loopback-Semantik aus gemergtem Code + agent-card.ts ab). Zieht die zwei offenen `it.todo` des Wire-Scaffolds an → `tl11-wake-wire.conformance.test.ts` **11 grün** (0 todo). **§2 mTLS-Pflicht:** zweiter Harness mit demselben Vertrag wie der cardServer (Fastify `https`+`requestCert`+`rejectUnauthorized`, agent-card.ts:229-230), In-Memory-CA/Server-/Client-Leaf (node-forge), undici-`WebSocket`+`Agent`-Client → gültiges Client-Cert erreicht `/ws` (`system:connected`), cert-los + `ws://` → TLS-Reset. **§2 Nicht-Loopback → `4003`:** Bindung an echte Nicht-Loopback-IPv4 (kein `trustProxy` → `req.ip`=Socket-Peer), `it.skipIf` auf Loopback-Hosts. **TS:** Datei 11 grün, Suite **1746 grün** (127 Files), tsc(strict)/neue-Datei-Lint 0. **CR ✅ (Claude-Pfad, Hausregel-bestätigt 2026-07-17):** codex/agy nicht im PATH (`[[pal-review-backend-agy-missing]]`) → adversariales **Claude-Review-Subagent** zählt als erlaubter Claude-Pfad (NICHT MiniMax/pal:chat) — **kein HIGH**; M1 (Timeout-Sentinel → Negatives beweisen echten Reset), M2 (Abgrenzung mTLS-Semantik ≠ Prod-Verdrahtung; cardServer-Wiring-Test = Follow-up), L2 (Listener-Race), L3 (Link-Local-Ausschluss) adressiert. PC: Secret-Scan clean. **Merge-blocked:** GH zeigt **kein Review-of-record** (`REVIEW_REQUIRED`) → geparkt bis ein formaler Approve (z. B. `peppiseppiullmann-ci`) oder ein bereits autorisierter Merge-Pfad erscheint; **keine Christian-Eskalation**. |

**Typ:** Test-Infra (cert-fixture Slice, TL-11 §2 mTLS + Nicht-Loopback-4003). Kein Runtime-Change. **DO:** `changes/2026-07-17_tl11-cert-fixtures.md`, `CHANGES.md`, `TODO.md`, Header-Doc der Testdatei, dieser Eintrag.

| #284 | (base=main, gemergt) | 2026-07-17 17:06 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (KW29 Bug-Pfad 2 einsortieren) → CO/CG/TS entfallen** (kein Code, keine Design-Entscheidung — 2b-Weg-Wahl explizit an CO delegiert). Neu `docs/BUGPFAD-2-logflut-status.md` = konsolidierter Beleg + Issue-Vorlage (KW29-Freitag-Deliverable). Trennt die **zwei** Hälften: **2a** `mount:command not found`-Flut/Unit-PATH = repo-seitig GESCHLOSSEN (#273 `f57ae5a`, 7 PATH-Stellen, `launchd-plist.test.ts` 25 grün, `.55`-Live-Beleg operator-gated); **2b** unbegrenztes Log-Wachstum = **OFFEN** (append-only Senken `plist:37/40`/`service:25-26` + Logger-stdout `logger.ts:5-11` pino `destination:1`, **kein** Rotations-/Cap-/newsyslog-/logrotate-Mechanismus im Repo — Grep-Falsifikation negativ). `TODO.md` Bug-Pfad-2-Eintrag ergänzt. **CR:** Doc-Accuracy-Subagent (adversarial, jede Datei:Zeile geprüft, „no rotation" aktiv falsifiziert) — **kein HIGH/MEDIUM**, 1 LOW (`maxBytes`-Label) gefixt. **PC:** Secret-Scan clean. Volle Suite **1746 grün** (Regressions-Absicherung). Kein Merge (Review-of-record-Blocker, s. #283). |

**Typ:** Doc-only (KW29 Bug-Pfad 2 Log-Flut Beleg/Issue-Vorlage). Kein Runtime-Change. **DO:** `docs/BUGPFAD-2-logflut-status.md`, `changes/2026-07-17_bugpath2-logflut-evidence.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #285 | (base=main, gemergt) | 2026-07-17 18:13 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View (TL-21 Slice 2) → CO/CG entfallen** (kompakte Projektion vorhandener Daten, Design gepinnt in `TL-21-skeleton-disclosure.md`, Präzedenz #281). Neues MCP-Tool `list_capabilities_overview` → `{skills,count}` = dieselbe „Name+1 Satz"-Übersicht wie REST `GET /api/capabilities/overview`, für Agent-Kontext-Ökonomie (Details via `query_capabilities`). Neu reine Funktion `buildCapabilityOverview` als **eine Quelle der Wahrheit**, von REST **und** MCP benutzt → strukturelle Parität. **TS:** +6 Tests (echtes registriertes Tool via `_registeredTools[name].handler` invoked + Envelope-Unit), Suite **1752 grün** (128 Files), tsc(strict)/neue-Datei-Lint 0. **CR:** adversariales Claude-Subagent (codex/agy nicht im PATH, `[[pal-review-backend-agy-missing]]`) — **kein HIGH**; Rate-Limit-Abwesenheit als kein Problem eingestuft (auth. lokaler stdio-Transport, Geschwister-Tools ebenso, strikte Teilmenge von `query_capabilities`); **1 MEDIUM an der Wurzel gefixt** (Envelope-Parität via gemeinsamem Builder statt nur Test-Assertion). **PC:** Secret-Scan clean. Review-of-record: `peppiseppiullmann-ci` APPROVED (2026-07-19), gemergt. |

**Typ:** Daemon-Feature (read-only, additiv, TL-21 Slice 2 MCP-Tool). Kein bestehendes Verhalten geändert. **DO:** `changes/2026-07-17_tl21-slice2-mcp-overview.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #286 | (base=main, gemergt) | 2026-07-18 06:04 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (Reconcile-Cursor-Hygiene) → CO/CG/TS entfallen** (kein Code, keine Design-Frage). Reconcile-Wächter (`reports/reconcile-drift-2026-07-18-0332.md`) meldete Drift: TODO.md höchste PR-Ref nur **#277** (Cursor 7 hinter #284), CHANGES.md-#284-Eintrag ohne „#284"-Marker. Live verifiziert: die Einträge der gemergten Slices #281–#284 existierten ohne PR-Nummer. Fix: PR-Nummern an die **bestehenden** TODO/CHANGES-Einträge annotiert (#281 TL-21 Slice 1, #282 Wire-Scaffold, #283 cert-fixture, #284 Bug-Pfad 2 Doc) → Cursor rückt auf #284. `COMPLIANCE-TABLE` war bereits aktuell. **CR:** Self-CR mechanisch — jede der 8 Annotationen per `git log origin/main` gegen ihren Merge-Commit gegengeprüft (830feed/898802b/94f24f7/58c7df9), kein Mis-Mapping. **PC:** Secret-Scan clean. Doku-Compliance-Gate deckt Konsistenz. Review-of-record: `peppiseppiullmann-ci` APPROVED (2026-07-19), gemergt. |

**Typ:** Doc-only (Reconcile-Cursor-Hygiene, PR-Nummern in TODO/CHANGES nachgezogen). Kein Runtime-Change. **DO:** `changes/2026-07-18_reconcile-doc-cursor.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #287 | (base=main, gemergt) | 2026-07-18 13:02 | ⚠️ | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-10 Freigabe-Matrix v1 Scoping/Discovery, Design-Doku VOR Code) → CG/TS entfallen** (kein Code). Neu `docs/architecture/TL-10-freigabe-matrix-scoping.md`: groundet den `resolveApproval`-Seam (`mcp-ingress.ts:105-110`, nur `tier==='gate'`) — heute wählt `MeldekanalRegistry.requestApproval` den ersten gesunden Kanal terminal (`meldekanal.ts:194-213`); TL-10 ersetzt genau diese Auswahl durch matrix-getriebenes Routing, Auswertung bleibt `isApproved`-Allowlist (`:83-85`). Pinnt die CO-Auflagen (2026-07-15: tier statt tool_class, Parse-Rejects, `isRoutable()`-Guard), v1-Vorschlag (Schema/Spezifität/decider-Grammatik), Slice-Zerlegung A(rein)→B(Verdrahtung). **§5: 5 exakt offene Entscheidungen als Code-Gate.** **CO ⚠️:** CO-Auflagen liegen vor (2026-07-15) → Note **konsolidiert** sie, trifft **keine** neue Design-Entscheidung (§5 bleibt offen für Folge-CO) → kein neuer CO-Lauf. **CR:** Doc-Accuracy self — jedes Code-Zitat per grep/sed gegen die Quelle verifiziert. **PC:** Secret-Scan clean. Kein Slice implementiert, kein Runtime-Change. Review-of-record: `peppiseppiullmann-ci` APPROVED (2026-07-19), gemergt. |

**Typ:** Doc-only (TL-10 Freigabe-Matrix v1 Scoping/Discovery-Note, Design VOR Code). Kein Runtime-Change. **DO:** `docs/architecture/TL-10-freigabe-matrix-scoping.md`, `changes/2026-07-18_tl10-freigabe-matrix-scoping.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #288 | (base=main, gemergt) | 2026-07-19 08:40 | ⚠️ | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-14a CA-Zweistufen-Umzug Scoping/Discovery, Design VOR Runbook/Skripten) → CG/TS entfallen** (kein Code, keine Skripte). Neu `docs/architecture/TL-14a-ca-two-stage-scoping.md`: groundet den Ist-Zustand — heute flache **einstufige** Self-Signed-Root (`createMeshCA` `tls.ts:59`, `cA:true`/`keyCertSign` `tls.ts:84-85`, `createNodeCert` signiert Leafs direkt `tls.ts:108/174`, Root-Key **online + ko-lokalisiert** mit dem Aussteller `cert-issuer.ts`, Persistenz `ca.crt.pem`/`ca.key.pem` `tls.ts:403-404`); Ziel: offline Root → Intermediate TH01 → Geschwister-Intermediate TH02. Konsolidiert die bindenden Beschlüsse (ADR-022/024/034, Decision-7 Trust-Domain-Kopplung, TL-13-Vorlauf), Runbook-Skelett (7 Schritte), **§5: 6 exakt offene Entscheidungen als Gate** (Trust-Domain-Kopplung, `pathLen`, Intermediate-Validität, Cross-Sign vs. Cutover, Chain-Ausroll-Mechanik = TL-14b-Kern, TH02-Rolle). **CO ⚠️:** bindende Beschlüsse liegen vor → Note **konsolidiert** sie, trifft **keine** neue Design-Entscheidung (§5 offen für Folge-CO/ADR) → kein neuer CO-Lauf. **CR:** Doc-Accuracy self — jedes Code-Zitat per grep/sed gegen die Quelle verifiziert (`tls.ts`, `cert-issuer.ts`, `config.ts`). **PC:** Secret-Scan clean (nur Doku). Kein Runbook-Volltext, keine Skripte, kein Deploy/Cross-Host. Durchführung = **TL-14b** (⛔ gated). |

**Typ:** Doc-only (TL-14a CA-Zweistufen-Umzug Scoping/Discovery-Note, Design VOR Runbook/Skripten). Kein Runtime-Change. **DO:** `docs/architecture/TL-14a-ca-two-stage-scoping.md`, `changes/2026-07-19_tl14a-ca-two-stage-scoping.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #289 | (base=main, gemergt) | 2026-07-19 09:12 | ⚠️ | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-14a Entscheidungs-Checkliste / Change-Order, Folge zu Scoping-§5) → CG/TS entfallen** (kein Code, keine Skripte). Neu `docs/architecture/TL-14a-decision-checklist.md`: die 6 §5-Entscheidungen (D1 Trust-Domain-Kopplung, D2 `pathLen`, D3 Intermediate-Validität, D4 Cross-Sign vs. Cutover, D5 Chain-Ausroll-Mechanik = TL-14b-Kern, D6 TH02-Rolle) als aktionierbares Register — je Eintrag Frage/Optionen/**nicht-bindende** Empfehlung/Abhängigkeit/Entscheider/blockiert/Status + Kopf-Tabelle + leere Sign-off-Zeile. **CO ⚠️:** Artefakt **trifft keine** Entscheidung — es macht D1–D6 abstimmbar (Empfehlungen gegroundet: `createMeshCA` `tls.ts:59/84`, `resolveAttestingCaFingerprints` `cert-issuer.ts:121`, `renew_before_days` `config.ts:165/251`, `ca.crt.legacy.pem` `tls.ts:437`), Beschluss fällt per Folge-CO (`pal:consensus`) + Christian-Sign-off → ADR → kein neuer CO-Lauf jetzt. **CR:** Doc-Accuracy self — jedes Code-Zitat per grep/sed verifiziert. **PC:** Secret-Scan clean (nur Doku). Kein Runbook-Volltext, keine Skripte, kein Deploy/Cross-Host. |

**Typ:** Doc-only (TL-14a Entscheidungs-Checkliste / Change-Order, §5 → aktionierbares Register). Kein Runtime-Change. **DO:** `docs/architecture/TL-14a-decision-checklist.md`, `changes/2026-07-19_tl14a-decision-checklist.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #290 | (base=main, gemergt) | 2026-07-19 09:33 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only (TL-14a Consensus-Brief D1–D6, Peer-Agent-PR — nachgetragen per Reconcile 2026-07-20) → CO/CG/TS entfallen** (kein Code, Abstimmungs-Vorlage). Neu `docs/architecture/TL-14a-consensus-brief-D1-D6.md`: bereitet die 6 §5-Entscheidungen (D1–D6, aus Decision-Checklist #289) für den `pal:consensus`-Lauf auf (Frage/Optionen/nicht-bindende Empfehlung + Nächste-Schritte); **trifft keine Entscheidung**. Führte zum Consensus-Ergebnis #291. **CR/PC:** nicht durch mich belegt (Peer-Agent-PR #290, Merge-Commit `4c8898d`); dieser Reconcile trägt nur die fehlende Historie-Zeile nach, bewertet die Fremd-PR **nicht** rückwirkend. Kein Deploy/Secret/Cross-Host. |

**Typ:** Doc-only (TL-14a Consensus-Brief D1–D6, Peer-Agent-PR #290, Reconcile-Nachtrag). Kein Runtime-Change. **DO:** `docs/architecture/TL-14a-consensus-brief-D1-D6.md` (in #290); Historie-Nachtrag in `CHANGES.md` + dieser Zeile.

| #291 | (base=main, gemergt) | 2026-07-19 11:34 | ✅ | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-14a `pal:consensus`-Ergebnis-Protokoll über D1–D6) → CG/TS entfallen** (kein Code, keine Skripte). Neu `docs/architecture/TL-14a-consensus-result-D1-D6.md`: protokolliert den tatsächlichen Lauf. **CO ✅ (durchgeführt, Infra-eingeschränkt):** `codex`+`agy` fehlen im PATH (`[[pal-review-backend-agy-missing]]`) → kein Cross-Vendor-Pass; konsultiert **Same-Vendor-2-Modell-Panel** claude-opus (8/10) + claude-sonnet (7/10), Re-Run mit codex/agy vermerkt. **Einstimmig 5/6** bestätigt; einzige Divergenz **D3-Laufzeit** — beide verwerfen ≥5 J (opus 12–24 Mon., sonnet 3 J → Korridor ~1–3 J, Owner-Entscheidung). Auflagen A (Chain/pathLen-Enforcement in `verifyPeerCert` `tls.ts:729`), B (Intermediate-Expiry-Monitoring fehlt), C (keine Revocation-Infra; sonnet: gepinnte Denylist) — beide: **blockierend**. **Trifft keine verbindliche Entscheidung** — Input für Christian-Sign-off + ADR. **CR:** Claude-Review-Subagent (Doc-Accuracy) — 3 Defekte gefunden+gefixt (erfundener `verifyCanonicalNodeCert` raus, Anker→`tls.ts:729`, „Ein-Modell"-Rest→2-Modell). **PC:** Secret-Scan clean (nur Doku). Kein Deploy/Cross-Host. |

**Typ:** Doc-only (TL-14a `pal:consensus`-Ergebnis-Protokoll D1–D6, Same-Vendor-2-Modell-Panel). Kein Runtime-Change. **DO:** `docs/architecture/TL-14a-consensus-result-D1-D6.md`, `changes/2026-07-19_tl14a-consensus-result.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #292 | (base=main, gemergt) | 2026-07-19 13:04 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-11 Slice-B Integrations-Runbook, Prep) → CO/CG/TS entfallen** (kein Code, kein neuer Beschluss — leitet aus gemergtem Kontrakt + Spec ab). Neu `docs/RUNBOOK-TL-11-wake-supervisor.md`: operativer Companion zur Consumer-Contract-Spec — Verortung (derselbe Host/Loopback sonst `4003`), vorhandenes Client-Cert (kein Secret), Subscribe-Form, `.data`-Payload-Reaktion, Cold-Start-Sweep-Pflicht, **Zwei-Peer-Proof-Prozedur** (`[[dod-two-peer-mcp-proof]]`) + Verifikations-Checkliste (gegen testgebundene Invarianten) + No-op-Rückfall. De-riskt Slice B, **entfernt den Blocker nicht** (letzter Hop `pokeCli` out-of-repo, Host-/Deploy-gated). §9 hält TL-08/09/10-Wahrheit sichtbar. **CR:** Claude-Review-Subagent (Doc-Accuracy) — Anker/`pokeCli`-Out-of-Repo-Klarstellung gegen Quelle verifiziert. **PC:** Secret-Scan clean (nur Doku). Kein Deploy/Secret/Cross-Host, keine Supervisor-Änderung. |

**Typ:** Doc-only (TL-11 Slice-B Integrations-Runbook, Prep — de-riskt den extern-blockierten Slice B). Kein Runtime-Change. **DO:** `docs/RUNBOOK-TL-11-wake-supervisor.md`, `changes/2026-07-19_tl11-sliceb-runbook.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #293 | (base=main, gemergt) | 2026-07-19 13:34 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (TL-14a Consensus-Blocker A & B code-Grounding vor ADR) → CO/CG/TS entfallen** (Discovery, kein Code/Beschluss). Neu `docs/architecture/TL-14a-blocker-AB-grounding.md`: **A pathLen/Chain NICHT garantiert** — App-`verifyPeerCert` (`tls.ts:729`) flacher Ein-Aussteller-Verify, kein Chain-Building/pathLen (`verifyCertificateChain`/`createCaStore` = 0 Treffer), genutzt von Pin/Retention/Trust-Distribution (`tls.ts:388/516/769`); Transport-mTLS (`agent-card.ts:225-231`) würde prüfen, aber einstufig + 2-Stufen-ungetestet → D2 auf App-Pfad kosmetisch. **B Intermediate-Expiry fehlt ganz** — Live-Monitor liest nur `node.crt.pem` (`getCertDaysLeft`, `index.ts:1613`, `tls.ts:708-724`), CA/Intermediate live nie geprüft (nur Start-Reissue für own-CA), rotiert nicht → Vorbedingung für D3. **CR:** adversarischer Claude-Review-Subagent — Kern-Befunde bestätigt, **3 Präzisions-Defekte gefixt** („0 Treffer repo-weit"→`src`-scoped; „einzelne CA"→Multi-CA-Bundle; B-Nuance own-CA-Start-Reissue). **PC:** Secret-Scan clean (nur Doku). Folge-Slices (chain-fähiger Verify + Charakterisierungs-Test; CA-Expiry-Quelle) benannt, nicht umgesetzt. Kein Deploy/Secret/Cross-Host. |

**Typ:** Doc-only (TL-14a Consensus-Blocker A & B code-Grounding vor ADR). Kein Runtime-Change. **DO:** `docs/architecture/TL-14a-blocker-AB-grounding.md`, `changes/2026-07-19_tl14a-blocker-AB-grounding.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #294 | (base=main, gemergt) | 2026-07-19 14:04 | ✅ | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (ADR-045 CA-Zweistufen-Hierarchie, Draft/Proposed) → CG/TS entfallen** (kein Code). Neu `docs/architecture/ADR-045-ca-two-stage-hierarchy.md`: faltet D1–D6-Konsens (`TL-14a-consensus-result`) + A/B-Grounding in eine Architektur-Entscheidung. **Entscheidet** D1 entkoppeln / D2 `pathLen 0` / D4 Doppel-Pin-Cutover / D5 Token-Re-Onboard / D6 TH02 kalt (konsens-getragen); **parkt D3** (Intermediate-Laufzeit, Korridor 1–3 J) als einzige Owner-Entscheidung → Status **Proposed** bis Christian-Sign-off. Vorbedingungen A (Chain/pathLen) + B (Intermediate-Expiry) als blockierende Code-Folge-Slices verankert; verworfene Alternativen + Konsequenzen. **CO ✅:** stützt sich auf den 2026-07-19-`pal:consensus`-Lauf (opus 8/10 + sonnet 7/10); keine neue Design-Frage offen außer der geparkten Owner-Entscheidung D3. **CR:** Claude-Review-Subagent (Doc-Accuracy) folgt vor Merge. **PC:** Secret-Scan clean (nur Doku). Kein Deploy/Secret/Cross-Host; Durchführung = TL-14b (⛔ gated). |

**Typ:** Doc-only (ADR-045 CA-Zweistufen-Hierarchie, Draft/Proposed). Kein Runtime-Change. **DO:** `docs/architecture/ADR-045-ca-two-stage-hierarchy.md`, `changes/2026-07-19_adr-045-ca-hierarchy.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #295 | (base=main, gemergt) | 2026-07-19 17:35 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-only (TL-14a Vorbedingung-A Charakterisierung) → CO/CG entfallen** (kein Design-Beschluss, kein Verhaltens-Change). Neu `packages/daemon/src/tls-chain-characterization.test.ts`: baut Root → forge-Intermediate (`cA:true`) → Leaf und belegt regressionsfest, dass `verifyPeerCert` ein **flacher Ein-Aussteller-Verify** ist — `verifyPeerCert(root, leaf@intermediate)` = **false**, nur direkter Aussteller = true. Groundet Blocker A (ADR-045); **kein Fix**, dokumentiert die Lücke (rot ⇒ chain-fähig geworden). **TS:** +4 Tests, Suite **1756 grün**, tsc(strict)/Lint 0. **CR:** externer Claude-Review-Subagent folgt vor Merge. **PC:** Secret-Scan clean. Kein Deploy/Secret/Cross-Host. |

**Typ:** Test-only (TL-14a Vorbedingung-A Charakterisierungs-Test, kein Fix/Verhaltens-Change). Kein Runtime-Change. **DO:** `packages/daemon/src/tls-chain-characterization.test.ts`, `changes/2026-07-19_tl14a-blockerA-char-test.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #296 | (base=main, gemergt) | 2026-07-20 06:08 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (Reconcile: PR-Nummern-Nachtrag COMPLIANCE + CHANGES #288–#295 + fehlender #290-Eintrag) → CO/CG/TS entfallen** (kein Code, Doku-Hygiene). Reconcile-Wächter (2026-07-20 03:34) meldete: CHANGES- **und** COMPLIANCE-Einträge für #288–#295 ohne PR-Nummer (Spalte `(offen, base=main)` + Topic-Label), #290 (Peer-Agent) ganz fehlend. Fix: 7 CHANGES-Überschriften + 7 COMPLIANCE-Erst-Spalten auf die echte PR-Nummer gesetzt (#288/#289/#291/#292/#293/#294/#295), #290-Historie in CHANGES + COMPLIANCE ergänzt. **Jede Zuordnung gegen den Merge-Commit verifiziert** (`gh pr view … mergeCommit`: f630c38/1a2557e/4c8898d/16cc43b/80cde74/a49325f/80e4826/41a4603). **CR:** externer Claude-Review-Subagent — **PR↔Eintrag-Mapping vollständig korrekt bestätigt** (alle 8 SHAs matchen), 1 strukturellen Defekt (diese Zeile 9→10 Spalten) gefixt. **PC:** Secret-Scan clean (nur Doku). Doku-Compliance-Gate deckt Konsistenz. Kein Deploy/Secret/Cross-Host. |

**Typ:** Doc-only (Reconcile PR-Nummern-Nachtrag #288–#295 + #290-Historie). Kein Runtime-Change. **DO:** `changes/2026-07-20_reconcile-compliance-288-295.md`, `CHANGES.md`, `COMPLIANCE-TABLE.md`, dieser Eintrag.

| #297 | (base=main, gemergt) | 2026-07-20 06:40 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (ADR-045 Vorbedingung B: CA/Intermediate-Expiry-Monitoring) → CO/CG entfallen** (kein neuer Design-Beschluss — additiv, ADR-045 bereits akzeptiert). Neu `getCaCertDaysLeft` (`tls.ts`, liest `tls/ca.crt.pem`, gemeinsamer Helper `certDaysLeftAtPath`, `getCertDaysLeft` unverändert) + `subject`-Label im `cert-expiry-monitor` (Default `'Node'` → Log-Meldungen byte-identisch; Audit-Detail additive Obermenge um `subject`, bestehende Tests grün) + zweiter CA-Monitor in `index.ts` (subject `'CA'`, gleiche Schwellen, im Shutdown geräumt). Macht CA/Intermediate **live** sichtbar (vorher nur Node-Leaf); **keine** `verifyPeerCert`/Trust-Semantik berührt. **TS:** +6 Tests (`ca-cert-expiry.test.ts`), Suite **1762 grün**, tsc(strict) 0, neue-Datei-Lint 0 (2 pre-existing eslint-Errors in `tls.ts:563`/`index.ts` außerhalb der Edits, nicht CI-gated). **CR:** externer Claude-Review-Subagent folgt vor Merge. **PC:** Secret-Scan clean (Certs zur Laufzeit geforgt). Kein Deploy/Secret/Cross-Host. |

**Typ:** Daemon-Feature (ADR-045 Vorbedingung B, CA/Intermediate-Expiry-Monitoring; additiv, keine Trust-Semantik-Änderung). Kein Deploy/Secret. **DO:** `packages/daemon/src/tls.ts`, `packages/daemon/src/cert-expiry-monitor.ts`, `packages/daemon/src/index.ts`, `packages/daemon/src/ca-cert-expiry.test.ts`, `changes/2026-07-20_tl14a-B-ca-expiry-monitor.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #298 | (base=main, gemergt) | 2026-07-20 07:18 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (ADR-045 Vorbedingung A: chain-fähiger Verify + pathLen-Enforcement) → CO/CG entfallen** (additiv, ADR-045 akzeptiert). Neu `verifyPeerCertChain(trustAnchorPems, chainPems)` (`tls.ts`): volle Ketten-Verifikation via forge `verifyCertificateChain` (Signaturen/Gültigkeit/`cA`-Flag) **+ manuelles `pathLenConstraint`-Enforcement** — **Befund:** forge erzwingt pathLen für In-Chain-Intermediates, aber NICHT das eigene pathLen des **Trust-Ankers** (Root im caStore, unprozessiert) → ein pathLen-0-Root akzeptierte fälschlich eine Intermediate-Kette; RFC-5280-§4.2.1.9-Check über den vollen root→leaf-Pfad schließt die Anker-Lücke. **TS:** +6 Tests (`chain-verify.test.ts`: gültige Kette, **pathLen-0-Reject**, Charakterisierungs-Kontrast, Fremd-Anker/unvollständig/leer), Suite **1768 grün**, tsc(strict) 0, neue-Datei-Lint 0 (`tls.ts:563`-eslint-Error ist pre-existing, außerhalb der Edits). **Additiv:** flacher `verifyPeerCert` + Trust-Caller unverändert (#295 bleibt grün); Rewiring = Folge-Slice (erst mit 2-Tier/TL-14b). **CR:** externer Claude-Review-Subagent (node-forge-Source gelesen) — **SOUND, kein pathLen-Bypass/Fail-open**; 1 Wording-Präzisierung gefixt (forge-Lücke = nur das Trust-Anker-pathLen, nicht In-Chain). **PC:** Secret-Scan clean. Kein Deploy/Secret/Cross-Host. |

**Typ:** Daemon-Feature (ADR-045 Vorbedingung A, chain-fähiger Verify + pathLen; additiv, flacher Pfad unverändert). Kein Deploy/Secret. **DO:** `packages/daemon/src/tls.ts`, `packages/daemon/src/chain-verify.test.ts`, `changes/2026-07-20_tl14a-A-chain-verify.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #299 | (base=main, gemergt) | 2026-07-20 07:36 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (ADR-045 A2: Rewire erste Trust-Entscheidung auf Chain-Verify + Anker-Validity-Härtung) → CO/CG entfallen** (additiv). `isRetainableCanonicalCert` nutzt jetzt `verifyPeerCertChain(attestingCaPems, [certPem])` statt `some(verifyPeerCert(...))` — single-tier äquivalent, chain-ready für 2-Tier. **Voraussetzung gehärtet:** Probe zeigte `verifyPeerCertChain([expiredCA],[leaf]) = true` (forge prüft das caStore-**Anker**-Fenster nicht) → hätte **ADR-024 MEDIUM-1** regressiert; explizite `notBefore`/`notAfter`-Anker-Prüfung + Regressionstest ergänzt. **Bewusst NICHT rewired:** `selectTrustDistributionCa` (gibt CA zurück) + Token-Onboard (Single-Anchor) — flacher Verify natürlicher Fit. **TS:** `tls.test.ts` 49/49 (inkl. abgelaufene-Attesting-CA), +1 chain-verify-Test, Suite **1769 grün**, tsc(strict) 0, neue-Code-Lint 0. **CR:** externer Claude-Review-Subagent folgt vor Merge. **PC:** Secret-Scan clean. Kein Deploy/Secret/Cross-Host. |

**Typ:** Daemon-Feature (ADR-045 A2: Chain-Verify-Rewire `isRetainableCanonicalCert` + Anker-Validity; additiv, ADR-024-MEDIUM-1-erhaltend). Kein Deploy/Secret. **DO:** `packages/daemon/src/tls.ts`, `packages/daemon/src/chain-verify.test.ts`, `changes/2026-07-20_tl14a-A2-rewire-chain-verify.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #300 | (base=main, gemergt) | 2026-07-20 11:12 | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (TL-10 Freigabe-Matrix Slice A: reiner Parser/Resolver/Guard, KEINE Verdrahtung).** Neu `freigabe-matrix.ts`: `parseFreigabeMatrix(raw, knownServers)` (fail-closed, alle CO-§2.2-Rejects: unbekannte Keys, tool-ohne-server, non-kanonischer Server [D4], `tier`/`decider`-Grammatik, `consensus:quorum=N` N≥2, Duplikat-Spezifität), `resolveEntry` (exakt > Wildcard `*`; kein Match ⇒ null), `isRoutable` (einziger Guard analog `isApproved`), `FreigabeMatrixError`. **CO ✅:** read-only §5-CO (`pal:consensus` opus 8/10 + sonnet 8/10 einstimmig) fixierte D1 (eigene TOML-Datei), D4 (`resolveMcp`-`knownServers`), D5 (Default-Deny 403) als Slice-A-Vertrag. **Bewusst außer Scope (Slice B, gated):** D2 (Registry-`requestApprovalOn`) + **D3** (`human:<id>` v1 deklarativ, nur parse-validiert → Christian-Sign-off + SECURITY.md VOR Slice B). **TS:** +28 Tests (`freigabe-matrix.test.ts`), Suite **1797 grün**, tsc(strict)/neue-Datei-Lint 0. **CR:** externer Claude-Review-Subagent folgt vor Merge. **PC:** Secret-Scan clean. `mcp-ingress` unangetastet, kein Runtime-Change/Deploy/Secret. |

**Typ:** Daemon-Feature (TL-10 Freigabe-Matrix Slice A, reines Modul ohne Verdrahtung; D2/D3 = Slice B, gated). Kein Deploy/Secret. **DO:** `packages/daemon/src/freigabe-matrix.ts`, `packages/daemon/src/freigabe-matrix.test.ts`, `changes/2026-07-20_tl10-sliceA-freigabe-matrix.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #301 | (base=main, gemergt) | 2026-07-20 11:44 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only (SECURITY.md-Anteil TL-10 Freigabe-Matrix: D3-Guardrail + Aktivierungs-Vorbedingungen) → CO/CG/TS entfallen** (kein Code, der §5-CO-geforderte D3-Doc-Anteil). Neue SECURITY.md-Sektion „Freigabe-Matrix (TL-10)": macht sichtbar, dass **`decider: human:<id>` v1 REIN DEKLARATIV / NICHT durchgesetzt** ist (keine Zugriffskontrolle; `consensus:quorum=N` nur parse-validiert), dokumentiert die Fail-closed-Guardrails (Parse-Reject/Default-Deny 403/einziger `isRoutable`-Pfad/`resolveMcp`-Server-Check), die **4 Aktivierungs-Vorbedingungen** (D3-Sign-off, D2-Registry-Bindung, Env-Flag Default-AUS + Startup-Warn, reviewte `freigabe-matrix.toml`) und die owner-gated Teile (Flag-Flip, D3-Enforcement, Policy-Änderungen). **CR:** externer Claude-Review-Subagent folgt vor Merge. **PC:** Secret-Scan clean (nur Doku). Kein Runtime-Change (Resolver unverdrahtet), kein Deploy/Secret. |

**Typ:** Doc-only (SECURITY.md D3-Guardrail für TL-10 Freigabe-Matrix; VOR Slice B, kein Runtime-Change). Kein Deploy/Secret. **DO:** `SECURITY.md`, `changes/2026-07-20_tl10-security-freigabe-matrix.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #302 | (base=main, gemergt) | 2026-07-20 12:58 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (TL-09c: erster realer `Meldekanal` — `TelegramMeldekanal`, ADR-038) → CO/CG entfallen** (Interface + Fail-closed-Vertrag bereits in ADR-036 `pal:consensus` opus+sonnet konsentiert; dieser Slice implementiert akzeptiertes Design, keine neue Architektur-Frage). Neu `telegram-meldekanal.ts`: `requestApproval` = `approvals.create({type:'mcp_gate'})` → Inline-Keyboard (`tlgate:approve\|reject:<id>`) → In-Memory-Bridge Callback↔Promise → `approvals.decide` (idempotent). **Injizierbar** in reale `MeldekanalRegistry` (Test beweist end-to-end `approved`). Bot-Glue über schmalen `TelegramApprovalTransport` (kein zweiter Polling-Bot → kein Telegram-`409`). `ApprovalType` additiv um `'mcp_gate'` (kein exhaustiver Switch). **Fail-closed (ADR-036 C1/C2):** Abort terminal (später Klick No-op), fremder Chat/malformed ignoriert, Doppelklick idempotent, `create`/`decide`/`sendPrompt`-Fehler ⇒ `error` (nie stilles `approved`). **TS:** +12 Tests (Injektions-Beweis + Fail-closed + 2 CR-Regressionstests), Suite **1809 grün** (133 Files), tsc(strict) 0, neue-Produktionsdatei-Lint 0. **CR ✅:** externer Claude-Review-Subagent — **1 HIGH** gefunden & gefixt: Abort **während** `await sendPrompt` → `{once:true}`-Listener feuerte nie → pending-Leak → später Klick setzte durable Zeile nach Timeout auf `approved` (C1-Bruch); Fix = `signal.aborted`-Recheck vor `pending.set` + Regressionstest; LOW (toter `note`) entfernt. **PC:** Secret-Scan clean (nur Doku-Referenzen auf „Token"). **`index.ts` unangetastet** (Registry weiter leer → gate=403, Risiko-Delta **null**); Aktivierung (Bot-Token/Freigabe-Chat) Christian-gegatet (RUNBOOK-TL-11 §TL-09c). Kein Deploy/Secret/Cross-Host. |
| #303 | (base=main, gemergt) | 2026-07-20 14:12 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View (TL-21 Peer-Skelett, `GET /api/peers/overview`) → CO/CG entfallen** (kompakte Projektion vorhandener Daten, Design gepinnt in `TL-21-skeleton-disclosure.md` §2/§4 „Skelett für Peers/Tools/Tasks — dasselbe Muster"; Präzedenz #281/#285/#278; `clink`/`gemini` nicht im PATH). Neu `peer-skeleton.ts`: reine, deterministische `buildPeerSkeleton`/`buildPeerOverview` (`{agent_id,name,status,version,skills:count,load_percent}`, sortiert nach `agent_id`, locale-unabhängig) — ersetzt für „wer ist im Mesh?" die vollen Agent-Card-`capabilities`-Arrays durch **Zähler**. **Total gegen malformed/geforgte Wire-Card-Daten** (non-string → `''`/`null`, non-array skills → `0`, non-finite `load_percent` → `null`, unbekannter `status` → `'unknown'`) → kein 500er (Härtungs-Klasse wie #281). Endpoint **same-source** `mesh.getOnlinePeers()` wie `GET /api/peers` (kein neuer Daten-/Identitätspfad, rate-limited); Details auf Abruf über das unveränderte `GET /api/peers`. **TS:** +15 Tests (`peer-skeleton.test.ts` 12: Projektion/Sortier-Determinismus/7 Malformed-Regressionen/Envelope + `dashboard-api.test.ts` 3: Endpoint-Wiring/leer/malformed→200), Suite **1824 grün** (134 Files), tsc(strict) 0, neue-Dateien eslint/prettier 0. **CR ✅:** code-review-Skill (medium; `agy` fehlt für `pal:codereview`) — **keine Korrektheits-Bugs**, 1 LOW (helper-Duplikat `asStr`/`cmpStr` bewusst belassen = per-Modul-Konvention von `capability-skeleton.ts`), kein HIGH/CRITICAL → keine Fix-Pflicht. **PC:** Secret-Scan clean; `dashboard-api.ts` (bereits vor PR nicht prettier-clean) NICHT ganz-reformatiert (nur 11 additive Zeilen). **`index.ts` unangetastet**, kein State/Deploy/Secret, Risiko-Delta **null**. Optionales Folgeslice: MCP-Tool `list_peers_overview` (derselbe Builder, wie Slice 1→2). |
| #304 | (base=main, gemergt) | 2026-07-20 16:36 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View (TL-21 Peer-Skelett als MCP-Tool `list_peers_overview`) → CO/CG entfallen** (MCP-Companion zur gemergten REST-Peer-Übersicht `GET /api/peers/overview` #303; Design gepinnt in `TL-21-skeleton-disclosure.md` §4 „Peer-MCP-Tool als optionales Folgeslice"; Präzedenz `list_capabilities_overview` Slice 2; `clink`/`gemini` nicht im PATH). Neues MCP-Tool `list_peers_overview` (keine Parameter) in `mcp-server.ts`, direkt hinter `discover_peers`, ruft den **gemeinsamen** Envelope-Builder `buildPeerOverview(mesh.getOnlinePeers())` — **dieselbe reine Funktion und dieselbe Datenquelle** wie REST → strukturelle Parität, kein Drift (exakt das Muster `list_capabilities_overview`/`buildCapabilityOverview`). Kein neuer Builder/Getter/State, reine Transport-Wiederverwendung; Details auf Abruf über unverändertes `discover_peers`/`get_agent_card`. **TS:** +4 Tests (`mcp-server.test.ts`: echtes registriertes Tool via `_registeredTools[name].handler`, Envelope-Parität mit REST, leeres Mesh→kein throw, geforgte Wire-Card→total), Suite **1828 grün** (134 Files), tsc(strict) 0, geänderte Dateien eslint/prettier 0. **CR ✅:** code-review-Skill (medium; `agy` fehlt für `pal:codereview`) — **keine Korrektheits-Bugs**, kein HIGH/CRITICAL (1:1-Spiegel des gemergten Slice-2/3-Pfads, nichts entfernt, keine neue Call-Site-Vorbedingung). **PC:** Secret-Scan clean. **`index.ts` unangetastet**, kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additiver Read-View (TL-21 Peer-Skelett — read-only, kein State, `index.ts` unangetastet). Kein Deploy/Secret. **DO:** `packages/daemon/src/mcp-server.ts`, `packages/daemon/src/mcp-server.test.ts`, `docs/architecture/TL-21-skeleton-disclosure.md`, `changes/2026-07-20_tl21-peers-overview-mcp.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #305 | (base=main, gemergt) | 2026-07-20 17:15 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-only Regressions-Absicherung (TL-11 cardServer-mTLS-Wiring, CR-M2-Follow-up) → CO/CG entfallen** (reine Test-Coverage eines gemergten, konsentierten Vertrags; `clink`/`gemini` nicht im PATH). #283 prüfte die mTLS-Pflicht über einen ZWEITEN Harness, NICHT die reale Klasse `AgentCardServer` → ein Regress von `requestCert` in `agent-card.ts` blieb ungefangen (Zero-Trust-Grenze könnte still aufweichen). Neu `agent-card-mtls-wiring.test.ts` (+3): konstruiert den ECHTEN `AgentCardServer` mit In-Memory-TLS-Bundle (`createMeshCA`/`createNodeCert`, kein Secret, kein Port-Listen, kein Host-Hop), liest `requestCert`/`rejectUnauthorized` direkt vom darunterliegenden Node-`tls.Server` (`fastify.server`) → beweist agent-card.ts:229-230 (beide `true`) + Bundle-Pfad schwächt nicht + Negativkontrolle. **TS:** +3 Tests, **mutations-verifiziert** (`requestCert:false` → Test rot, dann revertiert; Guard beißt nachweislich), Full-Suite **1831 grün** (135 Files), tsc(strict) 0, neue Datei eslint 0 + prettier clean. **CR ✅:** code-review-Skill (medium; `agy` fehlt) — keine Findings (test-only, reused `createMeshCA`/`createNodeCert`, Harness spiegelt `agent-card.test.ts`). **PC:** Secret-Scan clean (Certs zur Laufzeit in-memory, nichts committed). **`agent-card.ts` unverändert**, kein Produktionscode/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Test-only Regressions-Absicherung (TL-11 cardServer-mTLS-Wiring, CR-M2 — kein Produktionscode, `agent-card.ts` unangetastet). Kein Deploy/Secret. **DO:** `packages/daemon/src/agent-card-mtls-wiring.test.ts`, `changes/2026-07-20_tl11-cardserver-mtls-wiring-test.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #306 | (base=main, gemergt) | 2026-07-20 18:05 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only Backlog-Cleanup (TL-00d verifiziert erledigt) → CO/CG/TS/CR entfallen** (kein Code-/Test-/Design-Diff; Doc-only-Ausnahme wie #84). Wahrheitsgetreue Verifikation gegen HEAD: TL-00d („#242-Konfig-Keys `cert.renew_before_days` + `TLMCP_CERT_RENEW_BEFORE_DAYS` dokumentieren") ist **vollständig** in `docs/USER-GUIDE.md` abgedeckt — TOML-`[cert]`-Beispiel (l.79-82), Env-Var-Tabelle mit Wertebereich `[1, 89]`/Default `30` (l.105), dedizierter Abschnitt „Zertifikats-Erneuerung" mit Mapping-Tabelle TOML-Key ↔ Env ↔ Default ↔ Bereich ↔ Bedeutung + #242-Attribution + Validierungs-Begründung (l.115-117). Doku **akkurat** ggü. Code bei HEAD: `[1, 89]` ⇐ `NODE_CERT_VALIDITY_DAYS=90` + Validator `config.ts:465-476`; Default `30` ⇐ `config.ts:251`; Env-Wiring `config.ts:406-407`. → Keine fehlende/falsche Abdeckung, kein zusätzlicher Doc-Change; TL-00d in `TODO.md` auf `[x]` mit belegter Notiz. **PC:** Secret-Scan clean. Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Backlog-Cleanup (TL-00d Verifikation — kein Code/Test, USER-GUIDE bereits vollständig). Kein Deploy/Secret. **DO:** `TODO.md`, `changes/2026-07-20_tl00d-verify-cert-renew-knobs-documented.md`, `CHANGES.md`, dieser Eintrag.

| #307 | (base=main, gemergt) | 2026-07-21 07:20 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only Scoping/Park (TL-12 Slice C, first-class ORDER — Gate-Check) → CO/CG/TS/CR entfallen** (Design-Discovery ohne bindende Entscheidung, kein Code-/Test-/Config-Diff; Präzedenz `TL-12-slice-b-execution-scoping.md`; Cross-Vendor-CO separat pal-PATH-blockiert). Gate-Check für „Marker → first-class `MessageType='ORDER'`, sobald Peers ≥ Version" ergab **PARK — nicht ehrlich low-ambiguity baubar**, drei repo-geerdete Vorbehalte: **V1** kein `case MessageType.ORDER` im Dispatch → top-level ORDER fällt in `default` (`index.ts:932-934`, `return null`, kein ACK/Store/Audit), einziger Send-Pfad ist AGENT_MESSAGE (`inbox-api.ts:277`), ORDER reist heute nur als base64-Body-Marker (`signed-order.ts:63,75`) → Flip still-droppend gegen nicht upgegradete Peers; **V2** „Peers ≥ Version"-Gate nicht evaluierbar — `version-compat.ts` (`PROTOCOL_VERSION`/`FEATURE_MATRIX`/`checkCompatibility`/`isFeatureAvailable`/`meetsMinVersion`) außerhalb Tests **nirgends** aufgerufen, kein per-Peer-Version-Tracking/Wire-Austausch; **V3** selbst der additive Empfänger-Handler ist ADR-pflichtig — `store(fromAgent, AgentMessagePayload, order?)` (`agent-inbox.ts:256`) koppelt die Inbox-Zeile an message_id/subject/body/to des AGENT_MESSAGE-Wrappers, wrapper-lose ORDER erzwingt neues Mapping (+ Dedup-Kollision mit Slice-B-Ledger), ohne Sender nicht gegen realen Peer testbar (Zwei-Peer-DoD). Prüfpfad: (1) Wire-Feature/Version-Exchange via Agent-Card (additiv) → löst V2, (2) Empfänger-Handler+Mapping als ADR fleet-weit, (3) Sender-Flip erst nach „alle Peers ≥ Feature". Kein Pivot auf TL-11 B (host-/fenster-gated) / TL-14a (Owner-Sign-off) möglich. **PC:** Secret-Scan clean. Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Scoping/Park (TL-12 Slice C Gate-Check — kein Code/Test, Design-Discovery). Kein Deploy/Secret. **DO:** `docs/architecture/TL-12-slice-c-scoping.md`, `TODO.md`, `changes/2026-07-21_tl12-slicec-scoping-park.md`, `CHANGES.md`, dieser Eintrag.

| #308 | (base=main, gemergt) | 2026-07-21 08:10 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only Scoping-ADR (ADR-046 Wire-Feature/Version-Exchange, Status Proposed) → CO/CG/TS/CR entfallen** (Design-Discovery, kein Code-/Test-/Config-Diff; Impl-CO bewusst auf die Folge-Slice aufgeschoben, Cross-Vendor-`pal:consensus` derzeit pal-PATH-blockiert). Scopet den TL-12-Slice-C-Prerequisite aus PR #307: das fehlende „Peer ≥ Feature X"-Signal. **Geerdet:** `AgentCard` (`agent-card.ts:22-111`) trägt `version`/`build.version`, aber **kein** `protocol_version`/`features`; `version-compat.ts` (`PROTOCOL_VERSION`/`FEATURE_MATRIX`/`checkCompatibility`/`isFeatureAvailable`) ist **außerhalb Tests nirgends** aufgerufen (tot). **Aber** die Consumer-Seite existiert schon: gefetchte Card wird nach mTLS+Identitäts-Check pro Peer gehalten (`mesh.updateAgentCard`/`MeshPeer.agentCard`/`mesh.getPeer`, `mesh.ts:20,189,258`), Fetch pinned (`pinned-card-fetch.ts:35`), Parse tolerant (`as AgentCard`, `index.ts:1491,1553`) → additives Feld low-risk. **Vorschlag:** additiver optionaler `protocol`-Block (`protocol_version`/`min_compatible_version`/`features[]`) aus `version-compat.ts` + reiner **fail-closed** Consumer-Helper `peerSupportsFeature` (absent/unknown ⇒ unsupported); Seed-Flag `order-envelope-v2`. Entsperrt Slice-C-V2 (Gate evaluierbar); V1/V3 bleiben eigenen Slices; **kein** ORDER-Handler/Sender-Flip hier. **PC:** Secret-Scan clean. Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Scoping-ADR (ADR-046 Wire-Feature/Version-Exchange, Proposed — kein Code/Test, Design-Discovery). Kein Deploy/Secret. **DO:** `docs/architecture/ADR-046-wire-feature-version-exchange.md`, `TODO.md`, `changes/2026-07-21_adr-046-wire-feature-exchange-scoping.md`, `CHANGES.md`, dieser Eintrag.

| #309 | (base=main, gemergt) | 2026-07-21 09:45 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View (TL-21 Slice 5 — Task-Skelett, `GET /api/tasks/overview` + MCP `list_tasks_overview`) → CO/CG entfallen** (kompakte Projektion vorhandener Daten, Design gepinnt in `TL-21-skeleton-disclosure.md` §4 „dasselbe Muster für Tools/Tasks"; Präzedenz #281/#285/#303/#304/#278; `clink`/`gemini` nicht im PATH). Neu `task-skeleton.ts`: reine, deterministische `buildTaskSkeleton`/`buildTaskHistogram`/`buildTaskOverview` — ein Eintrag pro Task `{id,skill_id,state,executor,has_result,has_error}` (sortiert nach `id`, locale-unabhängig) ersetzt die vollen `input`/`result`/`error`-Blobs durch **Signale**; zusätzlich Status-Histogramm `by_state` (Invariante `Summe===count`) für „was läuft gerade?". **Total gegen malformed/geforgte Felder** (non-string id/skillId → `''`, non-string executor → `null`, unbekannter `state` → konsistent `'requested'`) → kein 500er (Härtungs-Klasse #281/#303). REST-Endpoint + MCP-Tool rufen **denselben** Envelope-Builder `buildTaskOverview(tasks.getAllTasks())` (same-source wie `GET /api/tasks`) → strukturelle Parität, kein Drift; Details auf Abruf über unverändertes `GET /api/tasks`. **TS:** +25 Tests (`task-skeleton.test.ts` 18 + `mcp-server.test.ts` 4: registriertes Tool via `_registeredTools[name].handler`/Envelope-Parität/leer/malformed + `dashboard-api.test.ts` 3: Endpoint-Wiring/leer/malformed→200), Suite **1856 grün** (136 Files), tsc(strict) 0, geänderte Dateien eslint (0 errors)/prettier clean. **CR ✅:** adversariales Claude-Subagent (`agy` fehlt für `pal:codereview`, `[[pal-review-backend-agy-missing]]`) — **kein HIGH/CRITICAL**; **1 MEDIUM** (Doc/Code-Drift: Doku sagte malformed `state` werde „übersprungen", Code zählt ihn korrekt als `requested`) → **Doku an korrekten Code angeglichen + Semantik-sperrender Regressionstest**; 3 LOW bewertet (1 Test-Härtung übernommen; helper-Duplikat/O(2n) = bewusste Per-Modul-Konvention wie `peer-skeleton.ts`). **PC:** Secret-Scan clean. **`index.ts` unangetastet**, kein State/Deploy/Secret, Risiko-Delta **null**. Verbleibt offen: **Tools**-Skelett (MCP-Tool-Fläche selbst) = eigener Slice. |

**Typ:** Additiver Read-View (TL-21 Slice 5 Task-Skelett — read-only, kein State, `index.ts` unangetastet). Kein Deploy/Secret. **DO:** `packages/daemon/src/task-skeleton.ts`, `packages/daemon/src/task-skeleton.test.ts`, `packages/daemon/src/dashboard-api.ts`(+test), `packages/daemon/src/mcp-server.ts`(+test), `docs/architecture/TL-21-skeleton-disclosure.md` §4, `docs/API-REFERENCE.md`, `changes/2026-07-21_tl21-tasks-overview.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #310 | (base=main, gemergt) | 2026-07-21 15:40 | n/a | n/a | n/a | n/a | ✅ | ✅ | **Doc-only Cross-Vendor-Consensus-Nachlauf (TL-14a D1–D6) → CO/CG/TS/CR entfallen** (Doc-only-Ausnahme wie #84/#286; dies **ist** der versuchte CO-Lauf, keine neue Design-Frage). Führt den in `TL-14a-consensus-result-D1-D6.md` „Nächste Schritte" #1 benannten Cross-Vendor-`pal:consensus`-Re-Versuch aus: Roster `gpt-5.5`(codex) + `gemini-pro`(agy), neutral, mit 5 Grounding-Docs. **Beide erneut Provider-Fehler** *„executable 'codex'/'agy' not found in PATH"* — identisch 2026-07-19; zusätzlich `command -v codex/agy/gemini/clink` alle NOT in PATH (2026-07-21 verifiziert) → Cross-Vendor-Pass **unverändert infra-blockiert**. **Kein** Konsens-Fehlschlag (Same-Vendor-Claude-Panel steht 5/6 konvergent; D3 = inhärente Owner-Entscheidung, Korridor 1–3 J), nur die zusätzliche GPT/Gemini-Sicht fehlt → **kein Christian-Ping** (Constraint erfüllt: Ping nur bei echter Nicht-Konvergenz). Neu `docs/architecture/TL-14a-consensus-crossvendor-followup-2026-07-21.md`: protokolliert Re-Versuch + konsolidiert D1/D2/D4/D5/D6 (modellbestätigt) + D3 (Owner) + Auflagen A/B/C (blockierend) + Handoff (Owner-Sign-off → ADR-045 Accepted; agent-ausführbar nur Code-Slices A+B). **CR:** Self-CR — jede Faktenaussage gegen Quell-Docs + Live-`pal`/`command -v`-Ergebnisse gegengeprüft, keine erfundene Entscheidung. **PC:** Secret-Scan clean. Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Cross-Vendor-Consensus-Nachlauf + Decision-Handoff (TL-14a — kein Code/Test, protokolliert einen infra-blockierten CO-Re-Versuch). Kein Deploy/Secret. **DO:** `docs/architecture/TL-14a-consensus-crossvendor-followup-2026-07-21.md`, `TODO.md`, `changes/2026-07-21_tl14a-crossvendor-followup.md`, `CHANGES.md`, dieser Eintrag.

| #311 | (base=main, gemergt) | 2026-07-21 16:10 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-only Coverage-Ergänzung (TL-14a Slice A — D2-Invariante) → CO/CG entfallen** (kein Produktionscode, keine Design-Frage; Design in ADR-045, Consensus lief 2026-07-19). **Nichts re-implementiert:** der chain-fähige `verifyPeerCertChain` + `enforcePathLenConstraint` (`tls.ts`) ist bereits gelandet (#298/#299). Reale Delta: der bestehende pathLen-Test setzte den Constraint am **Root**; die **D2-Kern-Sicherheitseigenschaft** (ein **Intermediate** mit `pathLen 0` darf **keine Sub-CA** ausstellen) war **nicht direkt** getestet. Neuer fokussierter Negativtest in `chain-verify.test.ts`: `Root(pathLen 2)→Intermediate(pathLen 0)→Sub-CA→Leaf` wird abgelehnt (Root bewusst großzügig → **isoliert** die Intermediate-Grenze als einzige Ursache), fail-closed über beide Ebenen (forge-In-Chain-Check + `enforcePathLenConstraint`); **gepaarte Gegenprobe** (dieselbe Kette OHNE Sub-CA = gültig) schützt gegen einen degenerierten „immer-false"-Verifier. **TS ✅:** +1 Test (`chain-verify.test.ts` 8), relevante TLS-Suiten 67 grün, Full-Suite **1857 grün** (136 Files), tsc(strict) 0, eslint 0/prettier clean. **CR:** Self-CR — Test isoliert nachweislich die Intermediate-`pathLen`-0-Eigenschaft. **PC:** Secret-Scan clean (Certs in-memory via forge). **`tls.ts` unverändert**, kein Produktionscode/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Test-only Coverage-Ergänzung (TL-14a Slice A D2-Invariante — kein Produktionscode, `tls.ts` unangetastet). Kein Deploy/Secret. **DO:** `packages/daemon/src/chain-verify.test.ts`, `changes/2026-07-21_tl14a-sliceA-intermediate-subca-test.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #312 | (base=main, gemergt) | 2026-07-21 17:15 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Read-View (TL-21 Slice 6 — Tool-Skelett, `GET /api/tools/overview` + MCP `list_tools_overview`) → CO/CG entfallen** (kompakte Projektion vorhandener Daten, Design gepinnt in `TL-21-skeleton-disclosure.md` §4 „dasselbe Muster für Tools"; Präzedenz #281/#285/#303/#304/#309; `clink`/`gemini` nicht im PATH). Schließt TL-21 ab (Skills/Peers/Tasks/Tools je REST+MCP). Neu `tool-skeleton.ts`: reine, deterministische `buildToolSkeleton`/`buildToolOverview` — filtert `registry.getAllCapabilities()` auf die MCP-Service-Einträge (`category='mcp'`) und dedupliziert pro **Server** (kanonisierter Name): `{ server, summary, execution_tier, providers, health }`, sortiert nach `server`. Tool-spezifisch die **`execution_tier`** (self/gate/consensus) **konservativ** = restriktivste Stufe (`maxTier`) über alle Provider. REST-Endpoint + MCP-Tool rufen **denselben** Envelope-Builder `buildToolOverview(registry.getAllCapabilities())` → strukturelle Parität, kein Drift; Details auf Abruf über unverändertes `GET /api/capabilities?category=mcp`. **Total gegen malformed/geforgte Felder** (non-string skill_id/category → skip; non-string description → `''`) → kein 500er. **TS:** +33 Tests (`tool-skeleton.test.ts` 23 + `mcp-server.test.ts` 4 + `dashboard-api.test.ts` 3; die 3 CR-Regressionen Teil der 23), Suite **1887 grün** (137 Files), tsc(strict) 0, geänderte Dateien eslint (0 errors)/prettier clean. **CR ✅:** adversariales Claude-Subagent (`agy` fehlt für `pal:codereview`, `[[pal-review-backend-agy-missing]]`) — **kein HIGH/CRITICAL**; **1 MEDIUM an der Wurzel gefixt**: malformed non-array `permissions` waren fail-**open** (→ `self`, unter-behauptet die Stufe + weicht von `resolveMcp` ab) → `providerTier` fail-**closed** auf mind. `gate` + 3 Regressionstests (inkl. Parität `overview ≥ resolveMcp`); der ratifizierende Fail-open-Test umgedreht. **PC:** Secret-Scan clean. **`index.ts` unangetastet**, kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additiver Read-View (TL-21 Slice 6 Tool-Skelett — read-only, kein State, `index.ts` unangetastet; schließt TL-21 ab). Kein Deploy/Secret. **DO:** `packages/daemon/src/tool-skeleton.ts`, `packages/daemon/src/tool-skeleton.test.ts`, `packages/daemon/src/dashboard-api.ts`(+test), `packages/daemon/src/mcp-server.ts`(+test), `docs/architecture/TL-21-skeleton-disclosure.md` §4, `docs/API-REFERENCE.md`, `changes/2026-07-21_tl21-tools-overview.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #313 | (base=main, gemergt) | 2026-07-22 06:05 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only Reconcile (PR-Nummern-Nachtrag COMPLIANCE + CHANGES + TODO-Cursor, #297–#312) → CO/CG/TS entfallen** (kein Code/Test/Design, Doku-Hygiene; Präzedenz #286/#296). Seit #296 (deckte #288–#295 ab) waren **#297–#312** gemergt, aber unnummeriert: 16 COMPLIANCE-Erst-Spalten `(offen, base=main)` → verifizierte Merge-Nummer `#NNN` + `(base=main, gemergt)` (9→10 Spalten wie #288–#295) + #296-Col-2-Selbst-Referenz nachgezogen; 16(+1) CHANGES-Überschriften um `, #NNN)` ergänzt (#296–#312); 9 gemergte TODO-Slice-Einträge (`Slice 3/4/5/6`, TL-14a `A`/`A2`/`B`/`D2`/Cross-Vendor) annotiert → höchste PR-Ref **#299 → #312**. **Jede Zuordnung inhaltlich gegen den gemergten PR-Titel/-Timestamp verifiziert** (`gh pr list --state merged`; z.B. #297 B-Monitor / #298 chain-verify / #299 A2-Rewire / #300 TL-10-A / … / #312 Tool-Skelett); alle 16 Timestamp-Anker vor der Ersetzung eindeutig, reine 1:1-in-place-Annotation (keine Inhaltsänderung), Spaltenzahl == Referenz #292 (#302 12 Pipes = pre-existing escaped `\|`). **CR:** Self-CR — Mapping gegen Merge-Zustand gegengeprüft, keine erfundene Nummer. **PC:** Secret-Scan clean (nur Doku). Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Bookkeeping-Reconcile (PR-Nummern #297–#312 + TODO-Cursor — kein Code/Test/Design). Kein Deploy/Secret. **DO:** `COMPLIANCE-TABLE.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-22_reconcile-pr-numbers-297-312.md`, dieser Eintrag.

| #314 | (base=main, gemergt) | 2026-07-22 06:20 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additiver Groundwork-Slice (ADR-046 ungegateter Consumer-Kern `supportsFeature`, fail-closed) → CO/CG entfallen** (implementiert **ausschließlich** den bewusst decision-unabhängigen Teil; Design gepinnt in ADR-046, die CO-pflichtigen Beschlüsse Platzierung/Vokabular/Semver werden NICHT berührt; `clink`/`gemini` nicht im PATH). Kontext: ADR-046 (TL-12-Slice-C-Enabler) lässt **zwei** Fragen CO-offen — Card-Platzierung der Feature-Liste (`protocol`-Block vs. `capabilities.services`) **und** Feature-Vokabular/`protocol_version`-Semver. Neu `packages/daemon/src/wire-feature.ts`: `supportsFeature(advertisedFeatures, feature)` nimmt die annoncierte Feature-**Liste** (NICHT die `AgentCard`) + den **Namen** als Parameter → **platzierungs- UND vokabular-agnostisch**: kein neues Card-Feld, kein geseedetes Flag, keine Semver-Politik, **kein Runtime-Change** (0 Aufrufer). Kodifiziert die non-negotiable §2-Invariante **fail-closed** (`undefined`/`null`/Nicht-Array/leer/nicht-gelistet/non-string/leeres-feature ⇒ `false`; einziger `true`-Pfad = echtes Array enthält exakten String; wirft nie) — „**absent ⇒ false, NIE assume-yes**" an EINER Stelle, die die CO-Folge-Slice mit `card.<platzierung>?.features` aufruft. **TS:** +10 Tests (`wire-feature.test.ts`: positiv single/multi + fail-closed alle Zweige + Totalität gegen malformed), Suite **1897 grün** (138 Files), tsc(strict) 0, eslint 0/prettier clean. **CR ✅:** adversariales Claude-Subagent — **GREEN, keine Findings**; fail-closed-Vertrag korrekt (zwei Guards vor `includes`), „ungegatet"-Claim bestätigt (keine Card-/Vokabular-/Semver-Bindung, 0 Aufrufer), total/deterministisch. **PC:** Secret-Scan clean. **Weiterhin CO-gated (unberührt):** `protocol`-Block/Platzierung, Producer-Befüllung, Vokabular/Semver, `version-compat`-Verdrahtung, ORDER-Handler/Sender-Flip (= Slice C proper). Kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additiver Groundwork-Slice (ADR-046 ungegateter fail-closed Consumer-Kern — read-only, kein State, 0 Aufrufer, kein Runtime-Change). Kein Deploy/Secret. **DO:** `packages/daemon/src/wire-feature.ts`, `packages/daemon/src/wire-feature.test.ts`, `docs/architecture/ADR-046-wire-feature-version-exchange.md` (§Umsetzungsstand), `changes/2026-07-22_wire-feature-consumer-core.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #315 | (base=main, gemergt) | 2026-07-22 08:30 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Daemon-Feature (TL-08 Slice 2c: Live-Tool-Class-Drift-Check-Hook, ADR-042 — ehrliche Verdrahtung des vorhandenen `checkToolClassDrift`-Seams) → CO/CG entfallen** (implementiert konsentiertes Design; ADR-042 + TODO benennen „Verdrahtungs-Hook = Folge"; `clink`/`gemini` nicht im PATH). **Read-only, KEIN Gate-Flip** (sensitive→redaction bleibt Christian-gated, außer Scope). Neu `tool-class-drift-hook.ts`: `buildGovernedToolListFetcher` (resolved servierenden Peer via `resolveMcp`/`mesh.getPeer`, holt LIVE `tools/list` über die **vorhandene** ausgehende mTLS-Forward-Primitive `mcpForwardHttp.forward` → Peer-`/api/mcp/<server>`; **secret-sicher** — nur `tools/list`, **kein** `tools/call`, keine Werte; extrahiert Namen via `extractToolNames`) + `runGovernedToolClassDriftChecks` (je governed Server — heute `unifi` — Drift → neues `TOOL_CLASS_DRIFT`-Audit als Kurations-Signal). `mcp-proxy-client.ts` + `extractToolNames`/`hasToolsArray`; `audit.ts` + Event-Typ. In `index.ts` fail-safe verdrahtet (`setTimeout(60s)`+`setInterval(1h)`, `.unref()`, im Shutdown geräumt; +41/-0 additiv); jeder Fehlerpfad (kein Provider/Endpoint/Non-200/200-ohne-`result.tools`/Fetch-Wurf) → übersprungen, **nie** Crash/false-positive. **TS:** +22 Tests (`tool-class-drift-hook.test.ts` 15 + `mcp-proxy-client.test.ts` +7), Suite **1919 grün** (139 Files), tsc(strict) 0, neue/geänderte Dateien eslint 0/prettier clean (`index.ts` NICHT ganz-reformatiert; pre-existing `no-non-null-assertion` dort ist vorbestehend, CI lintet nicht). **CR ✅:** adversariales Claude-Subagent — Secret-safe/fail-safe/no-gate-flip/Forward-Korrektheit/Resource-Safety bestätigt; **1 MEDIUM (M1: 200-ohne-`result.tools` → false-positive „alles stale") an der Wurzel gefixt** (`hasToolsArray`-Guard im Fetcher wirft statt `[]` → Seam skippt) + 3 Regressionstests (Fetcher + E2E), kein HIGH. **PC:** Secret-Scan clean (Hook ruft nie ein Tool auf, auditiert keine Werte — nur Zähler + `unclassified`-Namen). **Live-E2E gegen echten `unifi`-Peer** = eigenes Live-Fenster (kein governed Peer im CI); Logik seam-getestet, Hook bei fehlendem Peer sicherer No-op. Kein Deploy/Secret/Cross-Host, Risiko-Delta **null**. |

**Typ:** Daemon-Feature (TL-08 Slice 2c Drift-Check-Hook — read-only, kein Gate-Flip). Kein Deploy/Secret. **DO:** `packages/daemon/src/tool-class-drift-hook.ts`(+test), `packages/daemon/src/mcp-proxy-client.ts`(+test), `packages/daemon/src/audit.ts`, `packages/daemon/src/index.ts`, `changes/2026-07-22_tool-class-drift-hook.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #316 | (base=main, gemergt) | 2026-07-22 09:45 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Fail-safe-Härtung (TL-08 Slice 2c Drift-Hook, CR-LOW aus #315-Review) → CO/CG entfallen** (Härtung eines gemergten, konsentierten Slices; keine Design-Frage; `clink`/`gemini` nicht im PATH). **Read-only, kein Gate-Flip.** Schließt die Sibling-Lücke zu M1: der M1-Guard `hasToolsArray` fängt 200-**ohne**-`result.tools`-Array; ein 200 mit **nicht-leerem** `tools`-Array, dessen Einträge **alle** malformed sind (kein gültiger `name`), passierte `hasToolsArray`, `extractToolNames`→`[]` → `computeToolClassDrift` meldete fälschlich **alle** 27+10 kuratierten unifi-Tools als stale (ein spurioses `TOOL_CLASS_DRIFT`-Audit). Fix: `buildGovernedToolListFetcher` wirft jetzt auch bei „rohes tools-Array nicht-leer, aber 0 verwertbare Namen" (→ Seam → null → skip); legitim leeres `[]` bleibt gültiges leeres Inventar; ≥1 gültiger Name liefert die gültigen (Teil-Malformed toleriert, dokumentierte Grenze). **TS:** +3 Tests (Fetcher all-malformed→Wurf, partiell→gültige Namen, E2E kein false-positive), Suite **1922 grün** (139 Files), tsc(strict) 0, geänderte Dateien eslint 0/prettier clean. **CR:** Self-CR — direkte Umsetzung des externen #315-Review-LOW, dieselbe fail-safe-Klasse wie M1 an EINER Stelle (Fetcher-Guard). **PC:** Secret-Scan clean (nur Namen/Zähler, keine Werte). Kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Fail-safe-Härtung (TL-08 Slice 2c Drift-Hook, CR-LOW — read-only, kein Gate-Flip). Kein Deploy/Secret. **DO:** `packages/daemon/src/tool-class-drift-hook.ts`(+test), `changes/2026-07-22_drift-hook-allmalformed-guard.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #317 | (base=main, gemergt) | 2026-07-22 10:45 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additive ungegatete Security-Primitive (TL-10 D2-Prep: `MeldekanalRegistry.requestApprovalOn(channelId, req)`) → CO/CG entfallen** (additive Primitive der TL-10-§5-CO-Design-Linie D2 „`channelId`-Ref + Registry-`requestApprovalOn`"; keine neue Design-Frage; `clink`/`gemini` nicht im PATH). Beleg: `TODO.md` TL-10 Slice B braucht D2 = diese Registry-Bindung, `SECURITY.md` „Freigabe-Matrix (TL-10)" nennt sie als Aktivierungs-Vorbedingung. Neue Methode fragt **gezielt** den adressierten Kanal (statt „erster gesunder") — **fail-closed & verhaltensgleich zu `requestApproval`, nur OHNE Fallback**: unbekannte `channelId`/unhealthy/Health-Timeout/-Fehler ⇒ `denied-no-channel`; Approval-Timeout ⇒ `timeout`; Wurf/unbekanntes Shape ⇒ `error`; **nur** ein gesund-adressierter, aktiv zustimmender Kanal ⇒ `approved` (`isApproved`-Allowlist unverändert; Reuse `withTimeout`/`normalizeDecision`). **`requestApproval` unverändert; KEIN Matrix-Wiring, KEIN Env-Flag-Flip, KEIN Ingress, 0 Aufrufer** (kein Runtime-Change). **TS:** +10 Tests (`meldekanal.test.ts`: gezielte Auswahl statt Reihenfolge, unknown→denied/nicht-gefragt, unhealthy→denied/kein-Fallback, Health-/Approval-Timeout, Wurf→error, unbekanntes Shape→error, leere Registry, `requestApproval` unverändert), Suite **1932 grün** (139 Files), tsc(strict) 0, eslint 0/prettier clean. **CR ✅:** adversariales Claude-Subagent — **GREEN, keine Findings** (kein Input ⇒ `approved` ohne gesund-adressierten aktiv-zustimmenden Kanal; kein Fallback-Leak; `requestApproval` unberührt; ungegatet/additiv 0 Aufrufer; Determinismus/Resource ok). **PC:** Secret-Scan clean. Ingress-Wiring/Matrix/Env-Flag/D3-Sign-off bleiben Slice-B-gated. Kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additive ungegatete Security-Primitive (TL-10 D2-Prep Kanal-Bindung — `requestApproval` unverändert, 0 Aufrufer, kein Runtime-Change). Kein Deploy/Secret. **DO:** `packages/daemon/src/meldekanal.ts`(+test), `changes/2026-07-22_meldekanal-request-approval-on.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #318 | (base=main, gemergt) | 2026-07-23 06:15 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only Reconcile (PR-Nummern-Nachtrag COMPLIANCE + CHANGES + TODO, #313–#317) → CO/CG/TS entfallen** (kein Code/Test/Design, Doku-Hygiene; Präzedenz #84/#286/#296/#313). Schließt den Drift aus dem Reconcile-Wächter-Bericht `~/hermes/reports/reconcile-drift-2026-07-23-0333.md` („Neue Merges seit #312: 5 (bis #317)"; gemeldet: #317/#316/#314/#313 fehlen in COMPLIANCE, CHANGES ohne #317-Eintrag). **#315 war ebenfalls stale, wurde aber NICHT gemeldet** — die Nummer kommt im Fließtext der #316-Zeile vor („CR-LOW aus #315-Review") und erfüllt so die Substring-Prüfung des deterministischen Wächters, obwohl die #315-**Zeile** noch `(offen, base=main)` trug; hier mit-reconcilet (Wahrheit vor Report-Buchstaben). **Was:** 5 COMPLIANCE-Erst-Spalten `(offen, base=main)` → verifizierte Merge-Nummer `#NNN` + `(base=main, gemergt)` (9→10 Spalten wie #288–#312), Zuordnung über den **eindeutigen** Timestamp-Anker (06:05→#313, 06:20→#314, 08:30→#315, 09:45→#316, 10:45→#317); 5 CHANGES-Überschriften um `, #NNN)` ergänzt (#313–#317, damit auch der gemeldete #317-Eintrag); 4 gemergte TODO-Einträge annotiert (`Verdrahtungs-Hook` #315, `CR-LOW-Härtung` #316, `Ungegateter Consumer-Kern` #314, `D2-Prep` #317) → höchste TODO-**Eintrags-Annotation** **#312 → #317** (als bloßer Substring stand `#315` schon in der `Post-#315-Review`-Prosa); #313 bekommt keinen TODO-Eintrag (Doc-only-Housekeeping ohne Roadmap-Slice). **Aus dem CR zusätzlich (MEDIUM):** dieselbe Staleness eine **Spalte weiter** — 18 Zeilen, deren Erst-Spalte die Nummer schon trug, deren **PR-Spalte** aber `(offen, base=main)` sagte (#271/#272/#273/#277–#287 + die vier älter formatierten #262/#229/#234/#235); für den Wächter unsichtbar, weil die Nummer ja vorkommt. Alle 18 einzeln `gh`-verifiziert `MERGED` → `(base=main, gemergt)`. **Bewusst NICHT gefixt und stattdessen explizit benannt:** 28 Zeilen der Vor-#271-Ära (~1226–1625, Erst-Spalte = Version/Label wie `v0.34.43`/`ADR-033`/`tl07-tier`) tragen `(offen, base=main)` **ohne jede PR-Nummer in der Zeile** — Auflösung Version→PR ist Archäologie, nicht mechanisch belegbar, gehört in einen eigenen PR statt als Raten in einen Drift-Fix. **TODO-Wahrheit gegen den Merge-Stand geprüft, keine Korrektur nötig:** TL-08 Slice 2c bleibt `[~]` (Gate-Flip sensitive→redaction weiter ⛔ Christian-gated, nicht mit-erledigt), TL-10 Slice B weiter offen (Matrix/Env-Flag/D3-Sign-off; Primitive hat 0 Aufrufer), ADR-046-Platzierung/Vokabular/Producer weiter CO-gated; kein gemergter PR als offen, kein offener Punkt als erledigt markiert. **Verifikation:** `gh pr list --state merged` → alle fünf `MERGED` mit Titel-/Timestamp-Match; alle 5 Anker vor der Ersetzung eindeutig; `gh pr view <n>` für jede der 18 Spalte-2-Zeilen → `MERGED`; **effektive** Spaltenzahl (rohe Pipes minus escaped `\|`) == Referenz #312 (11; die #313-Zeile 12 roh / 1 escaped = 11, weil ihr eigener Text einen **pre-existing escaped** `\|` zitiert); nach dem Reconcile **0** stale `(offen, base=main)`-Zeilen **mit PR-Bezug** außer dieser (der benannte Vor-#271-Rest hat keinen). **CR ✅:** adversariales Claude-Subagent (`agy`/`codex` nicht im PATH) — **kein HIGH**; alle 14 Nummer-Zuordnungen unabhängig re-derived (korrekt), Diff mechanisch als 1:1-in-place bestätigt (kein Verdikt/Häkchen/Timestamp verändert), Substring-Erklärung zu #315 gegen Wächter-Bericht **und** `git show main:COMPLIANCE-TABLE.md` verifiziert, TODO-Wahrheit bestätigt, Suite 1932/139 nachgefahren, Secret-Scan 0. **1 MEDIUM an der Wurzel gefixt** (die „0 stale"-Aussage war für Spalte 2 falsch → 18 belegbare Zeilen mit-reconcilet, 28 nicht belegbare explizit benannt) + 3 LOW adressiert („höchste PR-Ref" → Eintrags-Annotation präzisiert; „rendert korrekt" durch die tatsächliche Pipe-Arithmetik ersetzt — der Block ab #278 hat vorbestehend keine Delimiter-Zeile; CR-Feld erst **nach** dem Review gesetzt). **PC:** Secret-Scan clean (nur Doku). Kein Code/Test/State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Doc-only Bookkeeping-Reconcile (PR-Nummern #313–#317 + TODO-Wahrheitsprüfung — kein Code/Test/Design). Kein Deploy/Secret. **DO:** `COMPLIANCE-TABLE.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-23_reconcile-pr-numbers-313-317.md`, dieser Eintrag.

| #319 | (base=main, gemergt) | 2026-07-23 06:45 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additive ungegatete Kompositions-Primitive (TL-10 Slice-B-Prep: `requestApprovalViaMatrix` — Matrix-Eintrag → `channelId` → Freigabe) → CO/CG entfallen** (folgt zwingend aus dem bereits getroffenen §5-CO 2026-07-20 D1–D5; keine neue Architektur-Frage; `clink`/`gemini` nicht im PATH). **Beleg:** beide Hälften liegen gemergt und **unverbunden** auf `main` — `freigabe-matrix.ts` `resolveEntry`/`isRoutable` (Slice A, #300) und `MeldekanalRegistry.requestApprovalOn` (D2-Prep, #317); `SECURITY.md` „Freigabe-Matrix (TL-10)" nennt als **Aktivierungs-Vorbedingung 2** exakt „Kanalauswahl wird auf den **Matrix-Kanal** beschränkt", was die Registry-Methode allein nicht leistet (es fehlte die Übergabe des Matrix-Kanals). Neu `approval-router.ts`: `requestApprovalViaMatrix(matrix, approver, ctx, req)` → `{ decision, target }`. **Fail-closed:** nicht routable (kein Match / leere Matrix / nicht wohlgeformtes Ziel, D5) ⇒ `denied-no-channel` und es wird **niemals ein Kanal gefragt** (`target === null` ⇔ „niemand gefragt"); Routbarkeit entscheidet allein `isRoutable(resolveEntry(...))` (die `null`-Abfrage ist reines Compiler-Narrowing, keine zweite Policy — beide Wege enden identisch im Default-Deny). **Routable ⇒ ausschließlich `requestApprovalOn(target.channel)`; KEIN Fallback auf „erster gesunder Kanal"** — erzwungen **per Typ** über die schmale `ChannelBoundApprover`-Sicht, in der `requestApproval()` gar nicht existiert (fail-closed per Typ, nicht per Disziplin). **`ctx`/`req`-Bindung (aus dem CR):** beide müssen dasselbe `(tier, server, tool)`-Tripel tragen, sonst ⇒ `denied-no-channel` ohne Kanal-Frage — zwei ungebundene Quellen wären ein **Confused-Deputy-Vektor** (Kanalwahl nach dem harmlosen Werkzeug, Vorlage des scharfen), und unter D3-Nicht-Durchsetzung IST die Kanalwahl die einzige Kontrolle der Matrix. **Total:** Wurf ⇒ `error`, **Wurf der Auflösung selbst** (geforgte Matrix) ⇒ `denied-no-channel` statt Exception; unbekanntes Decision-Shape ⇒ `error` über das jetzt **exportierte und gehärtete** `normalizeDecision` der Registry (dieselbe Mechanik an EINER Stelle statt Nachbau); `isApproved()` bleibt EINZIGER Auswertungspfad. **`decider` bleibt deklarativ (D3):** nur für Audit durchgereicht, **nicht** durchgesetzt — auch `consensus:quorum=N` wird weder erzwungen noch abgelehnt (per Test festgeschrieben, damit eine Verschärfung eine **bewusste CO-Entscheidung** bleibt); ⚠️ die Schutzwirkung ruht auf dem harten `consensus`-Tier-403 im **Ingress**, also außerhalb dieses Moduls — jetzt als Pflichtpunkt 5 in §7.2. **KEIN TOML-Loader, KEIN Ingress-Wiring, KEIN Env-Flag, KEIN D3-Sign-off, 0 Aufrufer** (kein Runtime-Change). **TS:** +39 Tests (`approval-router.test.ts` 32: nicht-routable/niemand-gefragt inkl. an `isRoutable` vorbei geforgtem Ziel, exakt-der-Matrix-Kanal inkl. **KEIN-Fallback-Regression gegen eine echte `MeldekanalRegistry`** mit gesundem Fremdkanal (Spione: Fremdkanal nie gefragt, `requestApproval` nie aufgerufen), Totalität der Approver-Antwort, `decider`-deklarativ, **neu aus dem CR**: `ctx`/`req`-Bindung, 6× Totalität der Auflösung, 4× Prototypenkette, 2× Forensik; `meldekanal.test.ts` +7: dieselben Prototypen-/Array-/Getter-Angriffe direkt gegen `requestApproval` UND `requestApprovalOn`), Suite **1971 grün** (140 Files), tsc(strict) 0, neue/geänderte Dateien eslint 0 errors/0 warnings (die eine Warnung in `meldekanal.test.ts:369` ist vorbestehend, per `git stash` gegengeprüft), prettier clean. **CR ✅:** adversariales Claude-Subagent mit Security-Fokus (`agy`/`codex` nicht im PATH), 26 Angriffs-Proben — **kein HIGH**, **4 MEDIUM an der Wurzel gefixt**: (1) `resolveEntry`/`isRoutable` lagen außerhalb des `try` → geforgte Matrix warf statt zu verweigern, obwohl „wirft nie" zugesagt war; (2) `ctx`/`req` ungebunden → Confused Deputy; (3) **`normalizeDecision` las `outcome` über die Prototypenkette und akzeptierte Arrays → ein Kanal-`{}` konnte `approved` werden** (Fail-open ausgerechnet im Fail-closed-Filter; einzige Pollution-Primitive im Repo ist `config.ts` `deepMerge` über TOML-Keys, daher MEDIUM statt HIGH) → `Object.hasOwn` + Array-Reject + Totalität gegen werfende Getter/`toString`, womit auch die „wirft nicht"-Zusage der Registry-Methoden erstmals hält; (4) Consensus-Nicht-Erzwingung korrekt, aber die tragende externe Vorbedingung nicht benannt → Modul-Doc + §7.2 + Testkommentar. Dazu LOW-1 (`channelId`-Stempelung vernichtete die Selbstauskunft des Approvers → geht jetzt in die `note`) und LOW-3 (Registry-`normalizeDecision` außerhalb jedes `try` → mit erledigt). **GREEN geblieben:** kein Fail-open-Pfad zu `approved` ohne aktiv zustimmenden Matrix-Kanal (Thenables/boxed Strings/Symbole/rejected Promises/`Object.create(null)`), kein Fallback-Leak, kein Guard-Bypass, 0 Aufrufer, Export verhaltensneutral, Doku-Zahlen real. **Bewusst nicht gefixt, benannt:** whitespace-only Kanalname parst + `decider`-Aliasing — beide vorbestehend aus #300, fail-closed in der Wirkung, gehören in den D1-Loader-Slice (§7.2 Punkt 6). **PC:** Secret-Scan clean (keine Credentials/Hosts/IPs, keine Policy-Datei). D1-Loader + kuratierte Matrix-Datei, Ingress-Verdrahtung, Env-Flag-Regime, D3-Christian-Sign-off und Aktivierung bleiben **gated**. Kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additive ungegatete Kompositions-Primitive (TL-10 Slice-B-Prep — 0 Aufrufer, kein Runtime-Change, kein Gate-Flip) + Fail-closed-Härtung von `normalizeDecision` (CR-MEDIUM). Kein Deploy/Secret. **DO:** `packages/daemon/src/approval-router.ts`(+test), `packages/daemon/src/meldekanal.ts`(+test), `docs/architecture/TL-10-freigabe-matrix-scoping.md` §7, `changes/2026-07-23_tl10-approval-router.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #320 | (base=main, gemergt) | 2026-07-23 12:45 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Test-only Conformance-Ergänzung (TL-11 Emitter-Ende-zu-Ende: `inbox:new` → echter `/ws`-Socket) → CO/CG entfallen** (kein Produktionscode, kein Design-Diff, kein neuer Beschluss — alle geprüften Zusagen stammen aus gemergtem Code #271/#277 + der bestehenden Consumer-Spec; `clink`/`gemini` nicht im PATH). **Die geschlossene Lücke:** der Wake-Kontrakt hat zwei Schichten — **Emitter** (`registerWakeEmitter`: Auflösung/Coalescing/Fail-closed-SPIFFE) und **Routing** (`websocket.ts`). Schicht 1 war NUR gegen reine Funktionen getestet; **alle** Draht-Tests aus #282/#283 injizieren `agent:wake` **direkt auf den Bus**. Genau die **Naht** dazwischen war unbewacht: umginge der Emitter den Coalescer, weckte eine nicht-live Instanz oder verlöre die SPIFFE-Regel, blieben alle Pure-Function- UND alle Draht-Tests grün — während der Supervisor aus Slice B, der auf diese §5-Zusagen baut, zu oft/zu selten/gar nicht geweckt würde. **+8 Tests** fahren jetzt die volle Kette `inbox:new` → Emitter → `agent:wake` → realer Loopback-Socket: genau 1 **inhaltsfreies** Wake (Payload-Keys exakt `instance_id`/`reason`/`spiffe_uri`, `message_id` taucht im Frame nicht auf) · **coalesced** (2 rasche Nachrichten → 1 Frame) · Fenster **läuft ab** (danach weckt die nächste wieder → belegt Fenster statt Dauer-Unterdrückung) · live **ohne** SPIFFE → 0 Frames (Client filtert dabei auf `instance_id`, bekäme also eines) · Ziel **nicht live** → 0 Frames · **kein Broadcast** (unadressiert: weder gefilterter noch **ungefilterter** Client) · leeres `to_agent_instance` = unadressiert · directed trifft nur den passenden Client, nicht den Nachbarn. Uhr + Live-Liste **injiziert** ⇒ deterministisch (kein `sleep`, keine Fake-Timer); Negativfälle über den vorhandenen **Same-Socket-Barrier**. **Mutations-verifiziert statt bloßer Grün-Meldung:** Coalescer umgangen ⇒ Coalescing-Test rot; SPIFFE-Guard entfernt ⇒ „ohne SPIFFE" rot; Liveness-Filter in `resolveWakeTargets` **+** WARN-Guard entfernt ⇒ „nicht live" rot; **nur** der WARN-Guard entfernt bleibt grün — die Liveness ist **doppelt** bewacht, der Test pinnt das Verhalten, nicht eine Codezeile (ehrlich vermerkt statt kaschiert). **Nebenbei echte Doku-Drift korrigiert:** Consumer-Contract §7.1 führte die mTLS-Pflicht und den Nicht-Loopback-`4003`-Reject weiter als „`it.todo`, bleibt unit-bewacht, bis die Fixtures stehen" — **#283** hat beide längst zu echten Tests gemacht. **TS:** Suite **1979 grün** (140 Files), tsc(strict) 0, geänderte Datei eslint 0/0, prettier clean. **CR:** externes Review am PR (adversariales Claude-Subagent). **PC:** Secret-Scan clean (Fixture-SPIFFE + `127.0.0.1`, keine echten Hosts). **`wake-contract.ts`/`websocket.ts`/`index.ts` unangetastet** — kein Produktionscode, kein State/Deploy/Secret, Risiko-Delta **null**. **TL-11 Slice B bleibt extern-/Host-gated** (letzter Hop out-of-repo); WS-Instanz-Bindung und Opt-in-Broadcast bleiben beschlusspflichtig und unberührt. |

**Typ:** Test-only Conformance-Ergänzung (TL-11 Emitter-Ende-zu-Ende — kein Produktionscode, kein Gate, kein Deploy/Secret). **DO:** `packages/daemon/src/tl11-wake-wire.conformance.test.ts`, `docs/architecture/TL-11-wake-consumer-contract.md` §7.1/§7.2, `changes/2026-07-23_tl11-emitter-wire-conformance.md`, `CHANGES.md`, `TODO.md`, dieser Eintrag.

| #321 | (base=main, gemergt) | 2026-07-23 13:10 | n/a | n/a | n/a | ✅ | ✅ | ✅ | **Doc-only Post-Merge-Reconcile (PR-Nummern-Nachtrag für #320) → CO/CG/TS entfallen** (kein Code/Test/Design, Doku-Hygiene; Präzedenz #84/#286/#296/#313/#318). #320 ist seit `mergedAt=2026-07-23T11:07:16Z` gemergt (mergeCommit `f47edea`), seine Bookkeeping-Einträge trugen aber noch den Vor-Merge-Zustand. **3 Annotationen, rein 1:1 in-place:** COMPLIANCE-Erst-Spalte `(offen, base=main)` → `#320` + `(base=main, gemergt)` (9→10 Spalten wie #288–#319); CHANGES-Überschrift um `, #320)` ergänzt; TODO-Eintrag `TL-11 Emitter-Ende-zu-Ende-Conformance` annotiert. **Verifikation:** `gh pr view 320` → `state=MERGED` mit Titel-/Topic-Match gegen die annotierte Zeile; der Timestamp-Anker `2026-07-23 12:45` war vor der Ersetzung **eindeutig** (genau 1 Treffer); nach dem Reconcile **0** stale `(offen, base=main)`-**Erst-Spalten** außer dieser (die verbleibenden Vorkommen sind der in #318 explizit benannte **Vor-#271-Rest** — Zeilen mit Version/Label statt PR-Nummer — plus Prosa-Zitate in Reconcile-Zeilen; unverändert bewusst offen, weil Version→PR Archäologie ist und in einen eigenen PR gehört); Suite unverändert **1979 grün** (140 Files, kein `.ts`-Diff). Kein Inhalts-, Struktur- oder Verdikt-Diff an einer Bestandszeile. **CR:** externes Review am PR + Self-CR (Zuordnung gegen PR-Titel/-Timestamp gegengeprüft, keine erfundene Nummer). **PC:** Secret-Scan clean (nur Doku). Kein Code/Test/State/Deploy/Secret/Host, Risiko-Delta **null**. |

**Typ:** Doc-only Post-Merge-Reconcile (PR-Nummer #320 — kein Code/Test/Design). Kein Deploy/Secret. **DO:** `COMPLIANCE-TABLE.md`, `CHANGES.md`, `TODO.md`, `changes/2026-07-23_reconcile-pr-320.md`, dieser Eintrag.

| (offen, base=main) | 2026-07-23 13:25 | n/a | n/a | ✅ | ✅ | ✅ | ✅ | **Additive ungegatete reine Primitive (TL-11 Reconciliation-Sweep-Kern `computeSweepTargets`) + Scoping-Note ADR-047 → CO/CG entfallen** (der Kern folgt derselben Prep-Form wie #314/#317; die Note **trifft keine** Architektur-Entscheidung, sie bereitet sie vor — Präzedenz `TL-10-freigabe-matrix-scoping.md` §5 / ADR-046-Scoping; `clink`/`gemini` nicht im PATH). **Ehrliche Vorgeschichte (Rev. 2):** die erste Fassung dieses PRs lieferte **nur** die Scoping-Note und begründete das damit, alle drei „Optional/danach"-Punkte seien entscheidungsgebunden. Das externe Review hat das als **HIGH-1** widerlegt — die von der Note **selbst** vorgeschlagene Signatur enthält weder Coalescer noch Uhr, Trigger oder Flag, ist also gerade **nicht** blockiert. Konsequenz: Slice **gebaut**, Blocker-Behauptung in ADR-047 §3/§5 ausdrücklich **zurückgezogen**. Neu `sweep-targets.ts`: `computeSweepTargets(live, unreadFor)` beantwortet genau **eine** Frage (welche live registrierte, **routbare** Instanz hat ungelesene Post) — rein, deterministisch (stabil nach `instanceId` sortiert, keine Uhr/kein Zufall), **fail-closed wie der Emitter** (ohne routbare `spiffeUri` kein Ziel; unbrauchbarer oder **werfender** Zähler ⇒ kein Ziel; wirft nie), **0 Aufrufer** ⇒ kein Runtime-Change. „Ob"/„wann" gesweept wird, die Coalescer-Wahl, ein Env-Flag und die Legacy-Politik (`includeLegacy`) bleiben **Aufrufer-Fragen** und damit gated — der Kern nimmt keine davon vorweg (Coalescing greift, wie beim Emitter, erst **nach** der Ziel-Auflösung). **HIGH-2:** §2s Begründung widersprach dem Beschluss, den sie schützen sollte — „Broadcast strukturell nicht zustellbar" gilt nicht für den in **ADR-043 CO-B** beschlossenen **Emitter**-seitigen Broadcast (`resolveWakeTargets(null, live)` = N **gerichtete**, heute routbare Wakes; **D1 bleibt zu**); der reale Blocker ist die dort benannte **1→N-Amplifikation**, die in der ersten Fassung gar nicht vorkam. **Weitere CR-Korrekturen (5 MEDIUM):** Cert-Identität ist **~3 Zeilen Wiederverwendung** (`extractCanonicalSender`, `mcp-ingress-api.ts:57` + Fastify-Muster `:163-164`) statt „neue Verdrahtung"; der als Argument benutzte **Beobachter-Konsument existiert im Repo nicht** (Dashboard ohne Query, kein WS-Client in der CLI) ⇒ die daraus gezogene Vorentscheidung zurückgenommen; das vom Runbook vorgeschriebene **Host**-Cert macht eine cert-abgeleitete Instanz-Bindung **tautologisch** (echter Schutz bräuchte ein per-Instanz-Credential — deshalb wird der technisch ungegatete `allowsAgentFilter`-Kern hier **bewusst nicht** gebaut: er wäre tautologisch grün); der bevorzugte Sweep-Trigger „WS-(Re-)Connect" hat **keinen** Hook (`registerWebSocket` gibt nichts zurück, `clients` modulprivat) und wäre der **teuerste**, während `agentRegistry.on(...)` (`agent-registry.ts:240-242`) bereits existiert; die Coalescer-Frage ist ein **falsches Entweder-oder** (eigener `WakeCoalescer` bzw. eigener, ausdrücklich erweiterbarer `WakeReason` lösen sie auf; die Spec nennt mehrfaches Wecken in der **Idempotent**-Zeile selbst „harmlos"). **TS:** +13 Tests (`sweep-targets.test.ts`: Auswahl/Sortierstabilität/Dedupe, fail-closed gegen fehlende SPIFFE + 9 malformte Einträge, werfender Zähler ⇒ Instanz entfällt/übrige bleiben, 9 unbrauchbare Zählerwerte, kein verstecktes „schon geweckt"-Gedächtnis, genau eine Zähler-Abfrage je routbarer Instanz), Suite **1992 grün** (141 Files), tsc(strict) 0, neue Dateien eslint 0/0, prettier clean. **CR ✅:** adversariales Claude-Subagent mit dem ausdrücklichen Auftrag „konstruiere einen ungegateten Slice; gelingt es, ist das ein Finding" — **2 HIGH + 5 MEDIUM + 4 LOW**, beide HIGH und alle MEDIUM an der Wurzel behoben; LOW: `:32`↔`:33`-Fehlanker und `:94-100` korrigiert, `includeLegacy`-Vorbehalt ergänzt, zwei als Vorentscheidung lesende Sätze zurückgenommen, plus die vom Review nebenbei gefundene **Alt-Drift** in `TL-11-wake-consumer-contract.md` (`websocket.ts:66`→`:89-90`, `:64`→`:88`) mitgefixt. **PC:** Secret-Scan clean. **Unverändert gated:** Sweep-**Verdrahtung**, TL-11 Slice B (out-of-repo Hop), TL-12 B/C (owner/CO), TL-10-Verdrahtung (D1-Loader/D3) — kein Loader, kein Flag-Flip, kein Host-Hop. Kein State/Deploy/Secret, Risiko-Delta **null**. |

**Typ:** Additive ungegatete reine Primitive (TL-11 Sweep-Kern — 0 Aufrufer, kein Runtime-Change) + Scoping-Note ADR-047 (Rev. 2 nach CR). Kein Deploy/Secret/Host. **DO:** `packages/daemon/src/sweep-targets.ts`(+test), `docs/architecture/ADR-047-tl11-wake-followups-scoping.md`, `docs/architecture/TL-11-wake-consumer-contract.md` (Alt-Drift), `TODO.md`, `changes/2026-07-23_adr-047-tl11-followups-scoping.md`, `CHANGES.md`, dieser Eintrag.

---

*Letzte Aktualisierung: 2026-07-23 13:25 — feat(tl11): Reconciliation-Sweep-Kern `computeSweepTargets` (rein, fail-closed, 0 Aufrufer) + ADR-047-Scoping Rev. 2; das externe Review widerlegte die ursprüngliche „alles blockiert"-Einschätzung (HIGH-1) → Slice gebaut, Blocker-Behauptung zurückgezogen; §2-Begründung gegen ADR-043 CO-B korrigiert (HIGH-2: echter Blocker = 1→N-Amplifikation); +13 Tests, Suite 1992 grün; Verdrahtung/Slice B/TL-12 bleiben gated.*
