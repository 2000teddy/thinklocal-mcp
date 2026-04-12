import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent as UndiciAgent, fetch } from 'undici';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadOrCreateIdentity } from './identity.js';
import { loadOrCreateTlsBundle, getCertDaysLeft, type NodeCertBundle } from './tls.js';
import { AuditLog } from './audit.js';
import { MdnsDiscovery } from './discovery.js';
import { AgentCardServer } from './agent-card.js';
import { MeshManager, type MeshPeer } from './mesh.js';
import { CapabilityRegistry } from './registry.js';
import { GossipSync } from './gossip.js';
import { RateLimiter } from './ratelimit.js';
import { MessageType, encodeAndSign, createEnvelope, serializeSignedMessage, type MessageEnvelope } from './messages.js';
import { TaskManager } from './tasks.js';
import { SkillManager, type SkillAnnouncePayload } from './skills.js';
import { registerDashboardApi } from './dashboard-api.js';
import { registerInboxApi } from './inbox-api.js';
import { AgentRegistry } from './agent-registry.js';
import { registerAgentApi } from './agent-api.js';
import { SkillDiscovery, type AnnouncedSkill } from './skill-discovery.js';
import { CapabilityActivationStore } from './capability-activation.js';
import { PairingStore } from './pairing.js';
import { registerPairingRoutes } from './pairing-handler.js';
import { TrustStoreNotifier } from './trust-store.js';
import { MeshEventBus } from './events.js';
import { registerWebSocket } from './websocket.js';
import { registerComplianceApi } from './compliance-check.js';
import { CredentialVault } from './vault.js';
import { loadOrCreateVaultPassphrase } from './vault-passphrase.js';
import { isLoopbackHost } from './runtime-mode.js';
import { TaskExecutor } from './task-executor.js';
import { createLibp2pRuntime } from './libp2p-runtime.js';
import type { SecretRequestPayload, SecretResponsePayload, AgentMessagePayload, AgentMessageAckPayload } from './messages.js';
import { AgentInbox } from './agent-inbox.js';
import { SYSTEM_MONITOR_MANIFEST } from './builtin-skills/system-monitor.js';
import { INFLUXDB_MANIFEST, influxdbHealthCheck } from './builtin-skills/influxdb.js';
import { TelegramGateway } from './telegram-gateway.js';
import type { AgentCard } from './agent-card.js';

async function main(): Promise<void> {
  // Config-Pfad
  const configPath = process.env['TLMCP_CONFIG']
    ?? resolve(process.cwd(), 'config', 'daemon.toml');

  const config = loadConfig(configPath);
  const log = createLogger(config.logging.level, 'thinklocal-daemon');

  log.info(
    {
      port: config.daemon.port,
      bindHost: config.daemon.bind_host,
      runtimeMode: config.daemon.runtime_mode,
      tlsEnabled: config.daemon.tls_enabled,
      agentType: config.daemon.agent_type,
    },
    'Starte Daemon...',
  );

  // 1. Identität laden oder generieren.
  //
  // ACHTUNG: Wir uebergeben hier bewusst KEINEN hostname mehr.
  // loadOrCreateIdentity faellt dadurch auf loadOrCreateStableNodeId() zurueck —
  // eine Hardware-basierte ID, die in keys/node-id.txt persistiert wird und
  // unabhaengig vom OS-Hostname ist. So bleibt die SPIFFE-URI auch dann stabil,
  // wenn macOS den Hostnamen dynamisch aendert (minimac-200 → minimac-1014 → ...).
  //
  // config.daemon.hostname wird weiterhin fuer mDNS-Service-Name und Agent-Card-URLs
  // verwendet — dort ist der OS-Hostname das Richtige.
  const identity = await loadOrCreateIdentity(
    config.daemon.data_dir,
    config.daemon.agent_type,
    undefined,
    log,
  );
  log.info(
    {
      spiffeUri: identity.spiffeUri,
      fingerprint: identity.fingerprint.slice(0, 16),
      stableNodeId: identity.stableNodeId,
      osHostname: config.daemon.hostname,
    },
    'Identität geladen',
  );

  // 2. TLS-Bundle laden oder erstellen (CA + Node-Zertifikat)
  let tlsBundle: NodeCertBundle | undefined;
  if (config.daemon.tls_enabled) {
    tlsBundle = loadOrCreateTlsBundle(
      config.daemon.data_dir,
      config.daemon.hostname,
      identity.spiffeUri,
      log,
      identity.stableNodeId,
    );
    log.info('mTLS aktiviert — HTTPS mit gegenseitiger Zertifikatsprüfung');
  } else {
    if (isLoopbackHost(config.daemon.bind_host)) {
      log.warn(
        { runtimeMode: config.daemon.runtime_mode },
        'TLS deaktiviert, aber Daemon ist auf Loopback gebunden — lokaler Betriebsmodus',
      );
    } else {
      log.error(
        { bindHost: config.daemon.bind_host, runtimeMode: config.daemon.runtime_mode },
        'TLS deaktiviert und Daemon nicht auf Loopback beschraenkt — unsicherer Netzwerkbetrieb',
      );
    }
  }

  // Agent-to-Agent Inbox fuer Messaging zwischen Agents im Mesh.
  // Wird weiter unten in den onMessage-Handler eingebunden und ueber MCP-Tools
  // send_message_to_peer / read_inbox / mark_read freigegeben.
  const agentInbox = new AgentInbox(config.daemon.data_dir, log);

  // SPAKE2 Trust-Bootstrap: PairingStore muss VOR dem Trust-Store angelegt
  // werden, damit die CA-Certs aller bereits gepairten Peers beim Start sofort
  // ins aggregierte Bundle einfliessen (bootstrap trust von Disk).
  const pairingStore = new PairingStore(config.daemon.data_dir, log);

  // Aggregiertes mTLS Trust-Bundle: eigene CA + alle gepairten Peer-CAs.
  // Ohne diese Aggregation scheitert der mTLS-Handshake zwischen Peers mit
  // "certificate signature failure", weil jeder Node nur seine eigene CA
  // kennt — die Pairing-Daten wurden zwar auf Disk persistiert, aber nie
  // in den aktiven TLS-Kontext geladen.
  const trustStoreNotifier = tlsBundle
    ? new TrustStoreNotifier(tlsBundle.caCertPem, pairingStore, log)
    : undefined;
  const initialCaBundle = trustStoreNotifier?.current() ?? [];

  // Undici-Dispatcher für ausgehende HTTPS-Verbindungen. Vertraut der eigenen
  // Mesh-CA PLUS allen gepairten Peer-CAs.
  const tlsDispatcher = tlsBundle
    ? new UndiciAgent({
        connect: {
          ca: initialCaBundle,
          cert: tlsBundle.certPem,
          key: tlsBundle.keyPem,
          rejectUnauthorized: true,
        },
      })
    : undefined;

  // 3. Audit-Log initialisieren
  const audit = new AuditLog(config.daemon.data_dir, identity.privateKeyPem, identity.spiffeUri, log);

  // 4. Event-Bus fuer Echtzeit-Events
  const eventBus = new MeshEventBus();
  eventBus.emit('system:startup', { agentId: identity.spiffeUri, port: config.daemon.port });

  // 4b. Credential Vault initialisieren
  const vaultPassphrase = loadOrCreateVaultPassphrase(
    config.daemon.data_dir,
    process.env['TLMCP_VAULT_PASSPHRASE'],
    log,
  );
  const vault = new CredentialVault(config.daemon.data_dir, vaultPassphrase, log);

  // 4c. Rate-Limiter initialisieren
  const rateLimiter = new RateLimiter({ maxTokens: 20, refillRate: 2 }, log);

  // 5. Capability Registry + Skill-Manager initialisieren
  const registry = new CapabilityRegistry(log);
  const skillManager = new SkillManager(config.daemon.data_dir, identity.spiffeUri, registry, log);

  // Eingebaute Skills registrieren
  skillManager.registerLocal({ ...SYSTEM_MONITOR_MANIFEST, author: identity.spiffeUri });

  // InfluxDB Skill nur registrieren wenn InfluxDB erreichbar ist
  const influxAvailable = await influxdbHealthCheck();
  if (influxAvailable) {
    skillManager.registerLocal({ ...INFLUXDB_MANIFEST, author: identity.spiffeUri });
    log.info('InfluxDB Skill registriert — Datenbank erreichbar');
  } else {
    log.info('InfluxDB nicht erreichbar — Skill nicht registriert');
  }

  const libp2pRuntime = await createLibp2pRuntime({
    enabled: config.libp2p.enabled,
    bindHost: config.daemon.bind_host,
    listenPort: config.libp2p.listen_port,
    mdnsServiceTag: config.libp2p.mdns_service_tag,
    natTraversalEnabled: config.libp2p.nat_traversal_enabled,
    relayTransportEnabled: config.libp2p.relay_transport_enabled,
    relayServiceEnabled: config.libp2p.relay_service_enabled,
    announceMultiaddrs: config.libp2p.announce_multiaddrs,
  }, log);
  await libp2pRuntime.start();

  // 6. Mesh-Manager starten
  const mesh = new MeshManager(
    config.mesh.heartbeat_interval_ms,
    config.mesh.heartbeat_timeout_missed,
    {
      onPeerOnline: (peer: MeshPeer) => {
        audit.append('PEER_JOIN', peer.agentId, `${peer.host}:${peer.port}`);
        cardServer.setPeerCount(mesh.peerCount);
        eventBus.emit('peer:join', { agentId: peer.agentId, host: peer.host, port: peer.port });
      },
      onPeerOffline: (peer: MeshPeer) => {
        audit.append('PEER_LEAVE', peer.agentId);
        cardServer.setPeerCount(mesh.peerCount);
        registry.markAgentOffline(peer.agentId);
        registry.removePeerCapabilities(peer.agentId);
        rateLimiter.removePeer(peer.agentId);
        eventBus.emit('peer:leave', { agentId: peer.agentId });
      },
    },
    log,
    tlsDispatcher,
  );

  // 7. Gossip-Sync initialisieren
  const gossip = new GossipSync(
    registry,
    mesh,
    identity.spiffeUri,
    identity.privateKeyPem,
    log,
    tlsDispatcher,
    undefined, // GossipConfig defaults
    skillManager,
  );

  // 8. Agent Card Server starten (HTTP oder HTTPS).
  // trustedCaBundle: aggregiert eigene CA + gepairte Peer-CAs. Hot-Reload bei
  // neuen Pairings ist Phase 2 — aktuell zaehlt der Snapshot zum Startzeitpunkt.
  const cardServer = new AgentCardServer({
    identity,
    config,
    tls: tlsBundle,
    trustedCaBundle: trustStoreNotifier?.current(),
    log,
    rateLimiter,
    getPeerPublicKey: (agentId: string) => {
      const peer = mesh.getPeer(agentId);
      return peer?.agentCard?.publicKey;
    },
    onMessage: async (envelope: MessageEnvelope) => {
      // Rate-Limiting prüfen
      if (!rateLimiter.allow(envelope.sender)) {
        log.warn({ sender: envelope.sender }, 'Rate-Limited — Nachricht abgelehnt');
        return null;
      }

      // Nachricht je nach Typ verarbeiten
      switch (envelope.type) {
        case MessageType.REGISTRY_SYNC: {
          const response = gossip.handleSyncMessage(envelope);
          const responseEnvelope = createEnvelope(
            MessageType.REGISTRY_SYNC_RESPONSE,
            identity.spiffeUri,
            response,
            { correlation_id: envelope.correlation_id },
          );
          return encodeAndSign(responseEnvelope, identity.privateKeyPem);
        }
        case MessageType.SKILL_ANNOUNCE: {
          const announcePayload = envelope.payload as SkillAnnouncePayload;
          // Phase 3 SkillManager: registers in CRDT capability registry
          skillManager.handleAnnounce(envelope.sender, announcePayload);
          // Post-Paperclip SkillDiscovery (PR #110): installs neutral manifests,
          // auto-activates capabilities, triggers Claude Code adapter.
          try {
            const announced: AnnouncedSkill[] = announcePayload.skills.map((s) => ({
              name: s.id,
              version: s.version,
              description: s.description,
              origin: envelope.sender,
              capabilities: [s.id], // Phase 3 skills use id as capability
            }));
            skillDiscovery.handlePeerAnnouncement(envelope.sender, announced);
          } catch (err) {
            log.warn({ from: envelope.sender, err }, '[skill-discovery] announcement handling failed (non-fatal)');
          }
          return null;
        }
        case MessageType.SECRET_REQUEST: {
          const secretReq = envelope.payload as SecretRequestPayload;
          log.info({ from: envelope.sender, credential: secretReq.credential_name }, 'Secret-Anfrage erhalten');
          eventBus.emit('audit:new', { type: 'SECRET_REQUEST', from: envelope.sender, credential: secretReq.credential_name });

          const approval = vault.createApprovalRequest(envelope.sender, secretReq.credential_name, secretReq.reason);
          const cred = vault.retrieve(secretReq.credential_name);
          let responsePayload: SecretResponsePayload;

          if (!cred) {
            responsePayload = { credential_name: secretReq.credential_name, status: 'denied', sealed_value: null, reason: 'Credential not found' };
          } else if (pairingStore.isPaired(envelope.sender)) {
            vault.approveRequest(approval.id);
            const sealed = vault.sealForPeer(cred.value, secretReq.requester_public_key);
            responsePayload = { credential_name: secretReq.credential_name, status: 'approved', sealed_value: sealed, reason: null };
            audit.append('CREDENTIAL_ACCESS', envelope.sender, secretReq.credential_name);
          } else {
            responsePayload = { credential_name: secretReq.credential_name, status: 'pending', sealed_value: null, reason: 'Awaiting human approval' };
          }

          const secretResp = createEnvelope(MessageType.SECRET_RESPONSE, identity.spiffeUri, responsePayload, { correlation_id: envelope.correlation_id });
          return encodeAndSign(secretResp, identity.privateKeyPem);
        }
        case MessageType.AGENT_MESSAGE: {
          // Free-form agent-to-agent message (human-initiated or agent-initiated).
          // Signature wurde bereits von agent-card.ts verifiziert. Wir pruefen nur
          // noch ob der Sender in unserem Trust-Perimeter ist.
          const msg = envelope.payload as AgentMessagePayload;
          let ack: AgentMessageAckPayload;

          if (msg.to !== identity.spiffeUri) {
            ack = {
              message_id: msg.message_id,
              received_at: new Date().toISOString(),
              status: 'rejected',
              reason: 'recipient mismatch',
            };
          } else if (!pairingStore.isPaired(envelope.sender)) {
            // SECURITY (PR #79 GPT-5.4 retro MEDIUM): Pruefen ob Sender
            // in unserem Trust-Perimeter ist. Signaturpruefung durch
            // agent-card.ts beweist nur "kommt von einem Cert mit bekannter
            // CA", nicht "ich habe explizit mit diesem Agent gepairt".
            // Ein Peer der gestern gepairt war und heute kompromittiert ist,
            // wuerde sonst bis in alle Ewigkeit in meinen Inbox schreiben.
            log.warn(
              { from: envelope.sender, message_id: msg.message_id },
              'AGENT_MESSAGE von nicht-gepairtem Sender abgelehnt',
            );
            ack = {
              message_id: msg.message_id,
              received_at: new Date().toISOString(),
              status: 'rejected',
              reason: 'sender not in pairing store',
            };
          } else {
            const result = agentInbox.store(envelope.sender, msg);
            if (result.status === 'rejected') {
              ack = {
                message_id: msg.message_id,
                received_at: new Date().toISOString(),
                status: 'rejected',
                reason: result.reason,
              };
            } else {
              // delivered oder duplicate -> beide zaehlen als "angekommen"
              ack = {
                message_id: msg.message_id,
                received_at: new Date().toISOString(),
                status: 'delivered',
                reason: result.status === 'duplicate' ? 'already in inbox' : undefined,
              };
              // SECURITY (GPT-5.4 retro LOW): nur fresh deliveries auditieren,
              // nicht Duplikate — sonst wird das Audit-Log unnoetig noisy.
              if (result.status === 'delivered') {
                audit.append('AGENT_MESSAGE_RX', envelope.sender, msg.message_id);
                eventBus.emit('audit:new', {
                  type: 'AGENT_MESSAGE',
                  from: envelope.sender,
                  message_id: msg.message_id,
                  subject: msg.subject ?? null,
                });
                // ADR-004 Phase 3: Push-Notification an WebSocket-Clients
                eventBus.emit('inbox:new', {
                  from: envelope.sender,
                  message_id: msg.message_id,
                  subject: msg.subject ?? null,
                  to: identity.spiffeUri,
                });
              }
            }
          }

          const ackEnvelope = createEnvelope(
            MessageType.AGENT_MESSAGE_ACK,
            identity.spiffeUri,
            ack,
            { correlation_id: envelope.correlation_id },
          );
          return encodeAndSign(ackEnvelope, identity.privateKeyPem);
        }
        default:
          log.debug({ type: envelope.type }, 'Unbekannter Nachrichtentyp');
          return null;
      }
    },
    getLibp2pState: () => libp2pRuntime.getState(),
  });
  // 8b. Task-Manager + Executor initialisieren
  const taskManager = new TaskManager(log);
  const taskExecutor = new TaskExecutor({
    tasks: taskManager,
    skills: skillManager,
    audit,
    eventBus,
    agentId: identity.spiffeUri,
    log,
  });

  // 8c. Pairing-Routen registrieren (pairingStore wurde oben bereits erzeugt,
  // damit der Trust-Store die bestehenden CAs beim Start kennt).
  registerPairingRoutes(cardServer.getServer(), {
    store: pairingStore,
    agentId: identity.spiffeUri,
    hostname: config.daemon.hostname,
    publicKeyPem: identity.publicKeyPem,
    caCertPem: tlsBundle?.caCertPem ?? '',
    fingerprint: identity.fingerprint,
    log,
    trustStoreNotifier,
  });

  // 8c2. Agent-to-Agent Messaging API
  registerInboxApi(cardServer.getServer(), {
    inbox: agentInbox,
    mesh,
    ownAgentId: identity.spiffeUri,
    ownPublicKeyPem: identity.publicKeyPem,
    ownPrivateKeyPem: identity.privateKeyPem,
    tlsDispatcher,
    rateLimiter,
    log,
    eventBus,
    onSent: (messageId, to) => {
      audit.append('AGENT_MESSAGE_TX', to, messageId);
      eventBus.emit('audit:new', {
        type: 'AGENT_MESSAGE_TX',
        to,
        message_id: messageId,
      });
    },
  });

  // 8c3. Agent Registry REST API (ADR-004 Phase 2)
  // Loopback-only endpoints for each local agent-instance (Claude Code,
  // Codex, Gemini CLI, …) to register itself + send heartbeats. Stale
  // entries are auto-evicted after 3 * heartbeat interval.
  const agentRegistry = new AgentRegistry({
    heartbeatIntervalMs: 5_000,
    staleFactor: 3,
    log,
  });
  agentRegistry.start();
  registerAgentApi(cardServer.getServer(), {
    registry: agentRegistry,
    audit,
    daemonSpiffeUri: identity.spiffeUri,
    inboxSchemaVersion: 1,
    log,
  });

  // 8c4. Skill Discovery + Capability Activation (ioBroker-Moment, PR #110)
  // Auto-discovers skills from peers, installs as neutral manifests,
  // activates capabilities, triggers Claude Code adapter.
  const capActivation = new CapabilityActivationStore(config.daemon.data_dir, log);
  const skillDiscovery = new SkillDiscovery({
    dataDir: config.daemon.data_dir,
    ownAgentId: identity.spiffeUri,
    activation: capActivation,
    eventBus,
    log,
  });

  // Announce local skills to every new peer that joins.
  // This is the "push" side of the ioBroker-Moment: when a peer appears,
  // we send a signed SKILL_ANNOUNCE message via mTLS so its daemon
  // can install the skills and trigger the Claude Code adapter.
  eventBus.on('peer:join', (event) => {
    const peerAgentId = event.data.agentId as string | undefined;
    if (!peerAgentId) return;
    const localSkills = skillDiscovery.getLocalAnnouncements();
    if (localSkills.length === 0) return;

    log.info(
      { peer: peerAgentId, skillCount: localSkills.length },
      '[skill-discovery] announcing local skills to new peer via wire',
    );

    // Build the Phase-3 SkillAnnouncePayload for wire compat
    // Build a wire-compatible SKILL_ANNOUNCE payload. We prefer existing
    // Phase-3 manifests from the SkillManager (type-safe), falling back to
    // a minimal shape for skills that only exist in the neutral format.
    // The receiving daemon's SKILL_ANNOUNCE handler accepts both shapes.
    const wireSkills = localSkills.map((s) => {
      const existing = skillManager.getSkill(s.name.replace('thinklocal-', ''));
      if (existing) return existing;
      return {
        id: s.name,
        version: s.version,
        description: s.description,
        author: identity.spiffeUri,
        integrity: '',
        runtime: 'node',
        entrypoint: '',
        dependencies: [],
        tools: s.capabilities,
        resources: [],
        permissions: [],
        requirements: {},
        category: 'mesh-discovered',
        createdAt: new Date().toISOString(),
      };
    });
    const wirePayload = { skills: wireSkills };

    // Send via mTLS to the peer (same pattern as gossip.ts)
    const peer = mesh.getPeer(peerAgentId);
    if (!peer?.endpoint) {
      log.debug({ peerAgentId }, '[skill-discovery] peer has no endpoint yet, skipping wire send');
      return;
    }

    const envelope = createEnvelope(
      MessageType.SKILL_ANNOUNCE,
      identity.spiffeUri,
      wirePayload as unknown as Record<string, unknown>,
      { ttl_ms: 60_000 },
    );
    const signed = encodeAndSign(envelope, identity.privateKeyPem);
    const body = serializeSignedMessage(signed);

    fetch(`${peer.endpoint}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/cbor' },
      body: Buffer.from(body),
      signal: AbortSignal.timeout(10_000),
      dispatcher: tlsDispatcher,
    })
      .then((res) => {
        if (res.ok) {
          log.info(
            { peer: peerAgentId, skills: localSkills.map((s) => s.name) },
            '[skill-discovery] SKILL_ANNOUNCE sent successfully',
          );
          eventBus.emit('skill:announced', {
            peer: peerAgentId,
            skills: localSkills.map((s) => s.name),
          });
        } else {
          log.warn(
            { peer: peerAgentId, status: res.status },
            '[skill-discovery] SKILL_ANNOUNCE send failed',
          );
        }
      })
      .catch((err) => {
        log.warn(
          { peer: peerAgentId, err: err instanceof Error ? err.message : String(err) },
          '[skill-discovery] SKILL_ANNOUNCE send error (non-fatal)',
        );
      });
  });

  // Log discovery summary at startup
  const summary = skillDiscovery.getDiscoverySummary();
  log.info({ summary }, '[skill-discovery] startup summary');

  // 8d. WebSocket fuer Echtzeit-Events
  await registerWebSocket(cardServer.getServer(), eventBus, log);

  // 8d2. ADR-004 Phase 4: Compliance-Check API (loopback-only)
  // Agents poll this endpoint periodically to check if they have open
  // compliance issues (uncommitted changes, missing docs, etc.)
  const repoRoot = process.env['TLMCP_REPO_ROOT'] ?? join(config.daemon.data_dir, '..', '..');
  registerComplianceApi(cardServer.getServer(), repoRoot, log);

  // 8e. Dashboard-API-Routen registrieren
  registerDashboardApi(cardServer.getServer(), {
    mesh,
    registry,
    tasks: taskManager,
    audit,
    identity,
    config,
    rateLimiter,
    vault,
    executor: taskExecutor,
  });

  await cardServer.start();

  // Hot-Reload TrustStore: nach einem erfolgreichen Pairing wird der
  // TLS-Context des Servers UND des Undici-Dispatchers aktualisiert,
  // ohne dass der Daemon neu gestartet werden muss.
  if (trustStoreNotifier) {
    trustStoreNotifier.onChange((newBundle) => {
      // 1. Server-side: neue Peer-CAs fuer eingehende mTLS-Verbindungen
      cardServer.reloadTlsContext(newBundle);

      // 2. Client-side: neuer Undici-Dispatcher fuer ausgehende Verbindungen
      // Undici Agent kann nicht in-place aktualisiert werden, aber der
      // getCachedHttpsAgent() in local-daemon-client.ts nutzt mtime-basierte
      // Invalidierung — nach einem Pairing aendert sich die trust-bundle-Datei
      // und der naechste Request erstellt automatisch einen neuen Agent.
      log.info({ caCount: newBundle.length }, 'TrustStore hot-reload: neue Peer-CAs aktiv');
    });
  }

  const proto = cardServer.protocol;

  // 9. mDNS Discovery starten
  const discovery = new MdnsDiscovery(config.discovery.mdns_service_type, log, config.daemon.tls_enabled);

  discovery.publish(
    `${config.daemon.hostname}-${config.daemon.agent_type}`,
    config.daemon.port,
    {
      agentId: identity.spiffeUri,
      p2pPeerId: libp2pRuntime.getState().peerId ?? undefined,
      capabilityHash: '',
      certFingerprint: identity.fingerprint,
      proto: proto as 'http' | 'https',
    },
  );

  discovery.browse({
    onPeerFound: async (discovered) => {
      if (discovered.agentId === identity.spiffeUri) return;

      mesh.addPeer(discovered);

      // Agent Card abrufen und Identität verifizieren
      try {
        const res = await fetch(`${discovered.endpoint}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(5_000),
          dispatcher: tlsDispatcher,
        });
        if (res.ok) {
          const card = (await res.json()) as AgentCard;

          const cardFingerprint = createHash('sha256').update(card.publicKey).digest('hex');
          if (card.spiffeUri !== discovered.agentId || cardFingerprint !== discovered.certFingerprint) {
            log.warn(
              { discovered: discovered.agentId, cardSpiffe: card.spiffeUri },
              'Agent Card Identitäts-Mismatch — Card abgelehnt',
            );
            return;
          }

          mesh.updateAgentCard(discovered.agentId, card);
          log.info({ peer: card.name }, 'Agent Card verifiziert und akzeptiert');
        }
      } catch (err) {
        log.warn({ endpoint: discovered.endpoint, err }, 'Agent Card abrufen fehlgeschlagen');
      }
    },
    onPeerLeft: (name: string) => {
      log.info({ name }, 'mDNS Peer verschwunden');
    },
  });

  // 9b. Statische Peers verbinden (parallel, Fallback wenn mDNS nicht funktioniert)
  if (config.discovery.static_peers.length > 0) {
    log.info({ count: config.discovery.static_peers.length }, 'Statische Peers konfiguriert');
    await Promise.allSettled(config.discovery.static_peers.map(async (sp) => {
      const port = sp.port ?? config.daemon.port;
      const endpoint = `${proto}://${sp.host}:${port}`;
      const name = sp.name ?? `${sp.host}:${port}`;
      try {
        const res = await fetch(`${endpoint}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(5_000),
          dispatcher: tlsDispatcher,
        });
        if (res.ok) {
          const card = (await res.json()) as AgentCard;
          const fingerprint = createHash('sha256').update(card.publicKey).digest('hex');
          const peer = {
            name,
            host: sp.host,
            port,
            agentId: card.spiffeUri,
            capabilityHash: '',
            certFingerprint: fingerprint,
            endpoint,
          };
          mesh.addPeer(peer);
          mesh.updateAgentCard(card.spiffeUri, card);
          log.info({ peer: name, agentId: card.spiffeUri }, 'Statischer Peer verbunden');
        } else {
          log.warn({ peer: name, status: res.status }, 'Statischer Peer nicht erreichbar');
        }
      } catch (err) {
        log.warn({ peer: name, err }, 'Statischer Peer Verbindung fehlgeschlagen');
      }
    }));
  }

  // 10. Heartbeat-Loop + Gossip-Sync starten
  mesh.startHeartbeatLoop();
  gossip.start();

  // 11. Telegram Gateway starten (wenn Token vorhanden)
  let telegramGateway: TelegramGateway | undefined;
  const telegramToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (telegramToken) {
    try {
      const chatIdFile = resolve(config.daemon.data_dir, 'telegram-chat-id');
      telegramGateway = new TelegramGateway(
        { botToken: telegramToken, daemonUrl: `${proto}://localhost:${config.daemon.port}`, chatIdFile, fetchDispatcher: tlsDispatcher },
        eventBus,
        log,
      );
    } catch (err) {
      log.warn({ err }, 'Telegram Gateway konnte nicht gestartet werden');
    }
  } else {
    log.debug('Kein TELEGRAM_BOT_TOKEN — Telegram Gateway deaktiviert');
  }

  log.info(
    { port: config.daemon.port, agentType: config.daemon.agent_type, proto },
    'Daemon bereit — warte auf Peers...',
  );

  // Zertifikat-Ablauf-Warnung
  const certDaysLeft = getCertDaysLeft(config.daemon.data_dir);
  if (certDaysLeft !== null) {
    if (certDaysLeft <= 7) {
      log.warn({ certDaysLeft }, 'Zertifikat laeuft in weniger als 7 Tagen ab!');
      eventBus.emit('system:startup', { warning: 'cert_expiry_soon', certDaysLeft });
    } else if (certDaysLeft <= 30) {
      log.info({ certDaysLeft }, 'Zertifikat laeuft in weniger als 30 Tagen ab');
    } else {
      log.debug({ certDaysLeft }, 'Zertifikat gueltig');
    }
  }

  // 12. Graceful Shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutdown eingeleitet...');
    telegramGateway?.stop();
    gossip.stop();
    mesh.stopHeartbeatLoop();
    taskManager.stop();
    agentRegistry.stop();
    capActivation.close();
    vault.close();
    agentInbox.close();
    rateLimiter.stop();
    discovery.stop();
    await libp2pRuntime.stop();
    await cardServer.stop();
    audit.append('PEER_LEAVE', identity.spiffeUri, 'graceful shutdown');
    audit.close();
    log.info('Daemon gestoppt.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fataler Fehler:', err);
  process.exit(1);
});
