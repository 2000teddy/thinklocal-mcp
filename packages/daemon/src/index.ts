import { resolve } from 'node:path';
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
import { MessageType, encodeAndSign, createEnvelope, type MessageEnvelope } from './messages.js';
import { TaskManager } from './tasks.js';
import { SkillManager, type SkillAnnouncePayload } from './skills.js';
import { registerDashboardApi } from './dashboard-api.js';
import { PairingStore } from './pairing.js';
import { registerPairingRoutes } from './pairing-handler.js';
import { MeshEventBus } from './events.js';
import { registerWebSocket } from './websocket.js';
import { CredentialVault } from './vault.js';
import { loadOrCreateVaultPassphrase } from './vault-passphrase.js';
import { isLoopbackHost } from './runtime-mode.js';
import { TaskExecutor } from './task-executor.js';
import { createLibp2pRuntime } from './libp2p-runtime.js';
import type { SecretRequestPayload, SecretResponsePayload } from './messages.js';
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

  // 1. Identität laden oder generieren
  const identity = await loadOrCreateIdentity(
    config.daemon.data_dir,
    config.daemon.agent_type,
    config.daemon.hostname,
    log,
  );
  log.info({ spiffeUri: identity.spiffeUri, fingerprint: identity.fingerprint.slice(0, 16) }, 'Identität geladen');

  // 2. TLS-Bundle laden oder erstellen (CA + Node-Zertifikat)
  let tlsBundle: NodeCertBundle | undefined;
  if (config.daemon.tls_enabled) {
    tlsBundle = loadOrCreateTlsBundle(
      config.daemon.data_dir,
      config.daemon.hostname,
      identity.spiffeUri,
      log,
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

  // Undici-Dispatcher für ausgehende HTTPS-Verbindungen (vertraut nur unserer Mesh-CA)
  const tlsDispatcher = tlsBundle
    ? new UndiciAgent({
        connect: {
          ca: tlsBundle.caCertPem,
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

  // 8. Agent Card Server starten (HTTP oder HTTPS)
  const cardServer = new AgentCardServer({
    identity,
    config,
    tls: tlsBundle,
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
          skillManager.handleAnnounce(envelope.sender, announcePayload);
          return null; // Kein Response nötig
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

  // 8c. Pairing-Store + Routen registrieren
  const pairingStore = new PairingStore(config.daemon.data_dir, log);
  registerPairingRoutes(cardServer.getServer(), {
    store: pairingStore,
    agentId: identity.spiffeUri,
    hostname: config.daemon.hostname,
    publicKeyPem: identity.publicKeyPem,
    caCertPem: tlsBundle?.caCertPem ?? '',
    fingerprint: identity.fingerprint,
    log,
  });

  // 8d. WebSocket fuer Echtzeit-Events
  await registerWebSocket(cardServer.getServer(), eventBus, log);

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

  const proto = cardServer.protocol;

  // 9. mDNS Discovery starten
  const discovery = new MdnsDiscovery(config.discovery.mdns_service_type, log);

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
        { botToken: telegramToken, daemonUrl: `http://localhost:${config.daemon.port}`, chatIdFile },
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
    vault.close();
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
