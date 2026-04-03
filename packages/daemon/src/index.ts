import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadOrCreateIdentity } from './identity.js';
import { AuditLog } from './audit.js';
import { MdnsDiscovery } from './discovery.js';
import { AgentCardServer } from './agent-card.js';
import { MeshManager, type MeshPeer } from './mesh.js';
import type { AgentCard } from './agent-card.js';

async function main(): Promise<void> {
  // Config-Pfad: wenn in worktree, suche config/ relativ zum Repo-Root
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

  // 2. Audit-Log initialisieren
  const audit = new AuditLog(config.daemon.data_dir, identity.privateKeyPem, identity.spiffeUri, log);

  // 3. Mesh-Manager starten
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
      },
    },
    log,
  );

  // 4. Agent Card Server starten
  const cardServer = new AgentCardServer(identity, config, log);
  await cardServer.start();

  // 5. mDNS Discovery starten
  const discovery = new MdnsDiscovery(config.discovery.mdns_service_type, log);

  discovery.publish(
    `${config.daemon.hostname}-${config.daemon.agent_type}`,
    config.daemon.port,
    {
      agentId: identity.spiffeUri,
      capabilityHash: '',
      certFingerprint: identity.fingerprint,
      endpoint: `http://${config.daemon.hostname}:${config.daemon.port}`,
    },
  );

  discovery.browse({
    onPeerFound: async (discovered) => {
      // Eigenen Service ignorieren
      if (discovered.agentId === identity.spiffeUri) return;

      mesh.addPeer(discovered);

      // Agent Card abrufen und Identität verifizieren
      try {
        const res = await fetch(`${discovered.endpoint}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const card = (await res.json()) as AgentCard;

          // Identitäts-Check: SPIFFE-URI und Public-Key-Fingerprint müssen übereinstimmen
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

  // 6. Heartbeat-Loop starten
  mesh.startHeartbeatLoop();

  log.info(
    { port: config.daemon.port, agentType: config.daemon.agent_type },
    'Daemon bereit — warte auf Peers...',
  );

  // 7. Graceful Shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutdown eingeleitet...');
    mesh.stopHeartbeatLoop();
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
