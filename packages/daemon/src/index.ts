import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent as UndiciAgent, fetch } from 'undici';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadOrCreateIdentity } from './identity.js';
import { loadOrCreateTlsBundle, type NodeCertBundle } from './tls.js';
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
import { TaskExecutor } from './task-executor.js';
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

  log.info({ port: config.daemon.port, agentType: config.daemon.agent_type }, 'Starte Daemon...');

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
  const tlsDisabled = process.env['TLMCP_NO_TLS'] === '1';
  if (!tlsDisabled) {
    tlsBundle = loadOrCreateTlsBundle(
      config.daemon.data_dir,
      config.daemon.hostname,
      identity.spiffeUri,
      log,
    );
    log.info('mTLS aktiviert — HTTPS mit gegenseitiger Zertifikatsprüfung');
  } else {
    log.warn('mTLS DEAKTIVIERT (TLMCP_NO_TLS=1) — nur für Entwicklung!');
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
  const vaultPassphrase = process.env['TLMCP_VAULT_PASSPHRASE'] ?? 'thinklocal-dev-vault';
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

  // 10. Heartbeat-Loop + Gossip-Sync starten
  mesh.startHeartbeatLoop();
  gossip.start();

  // 11. Telegram Gateway starten (wenn Token vorhanden)
  let telegramGateway: TelegramGateway | undefined;
  const telegramToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (telegramToken) {
    try {
      telegramGateway = new TelegramGateway(
        { botToken: telegramToken, daemonUrl: `http://localhost:${config.daemon.port}` },
        eventBus,
        log,
      );
      log.info('Telegram Gateway gestartet — sende /start an den Bot');
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
