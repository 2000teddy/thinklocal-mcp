# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.
Format: [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [0.1.0] — 2026-04-03 14:30 UTC

### Hinzugefügt
- **Projektinitialisierung**: Repository-Struktur, README.md, CHANGES.md, TODO.md, CONTRIBUTING.md, SECURITY.md
- **Architektur-Entwurf**: Kombination aus MCP (Nov 2025 Spec) + A2A Agent Cards für lokale Mesh-Kommunikation
- **Sicherheitskonzept**: mTLS mit lokaler CA, TOFU-Enrollment, PKI Envelope Encryption für Credential Sharing
- **Skill-System-Spezifikation**: Portables MCP-Server-Manifest-Format für Skill-Austausch zwischen Nodes
- **Agent Card Schema**: Erweiterte A2A-kompatible Agent Card mit Health, Mesh-Status und Capability-Listen
- **Dashboard-Konzept**: Chronograf-inspirierte Visualisierung mit Topologie-Graph, Health-Panels, Skill-Marketplace
- **Bedrohungsmodell**: Dokumentation von 7 Bedrohungsszenarien mit Gegenmaßnahmen
- **Branch-Strategie**: Multi-Agenten-Workflow mit `agent/<n>/<task>` Branch-Konvention
- **Tech-Stack**: TypeScript/Node.js, React/Next.js, JSON-RPC 2.0, tweetnacl-js
- **TODO**: 6-Phasen-Implementierungsplan mit ~120 Aufgaben

### Architektur-Entscheidungen
- MCP + A2A statt Custom-Protokoll (Ökosystem-Kompatibilität, Nov 2025 Spec hat Tasks + Sampling)
- TypeScript statt Python als Hauptsprache (MCP SDK-Unterstützung, Node.js native mDNS)
- Ed25519 statt RSA (schneller, kleinere Schlüssel, moderne Kryptografie)
- TOFU statt Pre-Shared Keys (bessere UX, akzeptables Risiko im LAN)
- JSON-RPC 2.0 über HTTPS statt gRPC (MCP/A2A-kompatibel, einfacher zu debuggen)

### Multi-Modell-Konsensus (6 Modelle, Ø Confidence 7.8/10)

Einstimmig: mTLS + Zero-Trust, libp2p/mDNS Mesh, CRDT Registry, signierte Skills, Audit ab Phase 1, Human Approval Gates.

| Modell | Fokus | Confidence | Kernbeitrag |
|--------|-------|-----------|-------------|
| GPT-5.4 | Security | 8/10 | SPIFFE-Identitäten, OPA/Cedar Policy Engine, 4-Phasen-Rollout |
| Gemini 3 Pro | MCP Integration | 8/10 | Daemon als transparenter MCP-Proxy, libp2p statt Custom-Mesh |
| Claude Sonnet 4.6 | Kritische Bewertung | 7/10 | SPAKE2 Bootstrap, Shamir Secret Sharing, Human Approval Gates |
| DeepSeek R1 | Skill Exchange | 8/10 | Rust für Sandboxing, Merkle-Tree Audit, Skill-Ownership-Tokens |
| Kimi K2 | Daemon-Architektur | 8/10 | GossipSub, Protobuf-Schemas, LibSodium Sealed Boxes, ECDSA |
| GLM 4.5 | Gap-Analyse | 6/10 | MVP-first mit 3-5 Agents, Warnung vor O(n²) Registry-Wachstum |

### Recherche
- Web-Recherche zu MCP Nov 2025 Spec, A2A v0.3, ACP (IBM), ANP
- Analyse der Agent Card / Agent Discovery Muster
- Sicherheitsanalyse: MCP Tool Poisoning, Cross-Server Shadowing

---

## [Unreleased]

### Geplant
- Node Daemon Grundgerüst (TypeScript)
- mDNS Discovery Module
- Lokale CA Bootstrap-Mechanismus
- Agent Card Server Endpoint
- Dashboard Grundgerüst (Next.js)
- CLI Tool `tlmcp` für Mesh-Verwaltung
- Erster eingebauter Skill: `system-monitor`
