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

  // 4. Rate-Limiter initialisieren
  const rateLimiter = new RateLimiter({ maxTokens: 20, refillRate: 2 }, log);

  // 5. Capability Registry + Skill-Manager initialisieren
  const registry = new CapabilityRegistry(log);
  const skillManager = new SkillManager(config.daemon.data_dir, identity.spiffeUri, registry, log);

  // 6. Mesh-Manager starten
  const mesh = new MeshManager(
    config.mesh.heartbeat_interval_ms,
    config.mesh.heartbeat_timeout_missed,
    {
      onPeerOnline: (peer: MeshPeer) => {
        audit.append('PEER_JOIN', peer.agentId, `${peer.host}:${peer.port}`);
        cardServer.setPeerCount(mesh.peerCount);
      },
      onPeerOffline: (peer: MeshPeer) => {
        audit.append('PEER_LEAVE', peer.agentId);
        cardServer.setPeerCount(mesh.peerCount);
        registry.markAgentOffline(peer.agentId);
        rateLimiter.removePeer(peer.agentId);
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
        default:
          log.debug({ type: envelope.type }, 'Unbekannter Nachrichtentyp');
          return null;
      }
    },
  });
  // 8b. Task-Manager initialisieren
  const taskManager = new TaskManager(log);

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

  // 8d. Dashboard-API-Routen registrieren
  registerDashboardApi(cardServer.getServer(), {
    mesh,
    registry,
    tasks: taskManager,
    audit,
    identity,
    config,
    rateLimiter,
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

  log.info(
    { port: config.daemon.port, agentType: config.daemon.agent_type, proto },
    'Daemon bereit — warte auf Peers...',
  );

  // 11. Graceful Shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutdown eingeleitet...');
    gossip.stop();
    mesh.stopHeartbeatLoop();
    taskManager.stop();
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
