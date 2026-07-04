import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent as UndiciAgent, fetch } from 'undici';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadOrCreateIdentity } from './identity.js';
import { loadOrCreateTlsBundle, getCertDaysLeft, extractSpiffeUris, verifyPeerCert, selectTrustDistributionCa, type NodeCertBundle } from './tls.js';
import { startCertExpiryMonitor } from './cert-expiry-monitor.js';
import { readRamUsedPercent, readResourceMetrics } from './resource-metrics.js';
import { existsSync as fsExistsSync } from 'node:fs';
import { AuditLog } from './audit.js';
import { MdnsDiscovery } from './discovery.js';
import { startStaticPeerReconciler, resolveStaticReconcileSteadyMs } from './static-peer-reconciler.js';
import { learnInboundPeer } from './inbound-peer-learner.js';
import { AgentCardServer } from './agent-card.js';
import { MeshManager, type MeshPeer } from './mesh.js';
import { CapabilityRegistry } from './registry.js';
import { GossipSync } from './gossip.js';
import { RateLimiter } from './ratelimit.js';
import { MessageType, encodeAndSign, createEnvelope, serializeSignedMessage, type MessageEnvelope } from './messages.js';
import { TaskManager } from './tasks.js';
import { SkillManager, type SkillAnnouncePayload } from './skills.js';
import { buildSharedMcpCapabilities, registerSharedMcps, guardSharedMcpAnnounce } from './mcp-registration.js';
import { registerMcpIngressApi } from './mcp-ingress-api.js';
import { createMcpForwardExecutor, createUndiciMcpForward } from './mcp-forward-executor.js';
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
import { TokenStore } from './token-store.js';
import { registerTokenApi } from './token-api.js';
import { onboardingPort } from './onboarding-port.js';
import { CertIssuer, NonceStore, certFingerprint, resolveAttestingCaFingerprints } from './cert-issuer.js';
import { registerCertIssuanceApi } from './cert-issuance-api.js';
import { readFileSync } from 'node:fs';
import { CredentialVault } from './vault.js';
import { loadOrCreateVaultPassphrase } from './vault-passphrase.js';
import { isLoopbackHost } from './runtime-mode.js';
import { TaskExecutor } from './task-executor.js';
import { createLibp2pRuntime } from './libp2p-runtime.js';
import { checkIdentityConsistency, resolveSelfIdentity, peerIdToSpiffeUri } from './peer-identity.js';
import { loadOrCreateLibp2pPrivateKey } from './libp2p-identity.js';
import { wireRegistrySync } from './registry-sync-libp2p-adapter.js';
import type { SecretRequestPayload, SecretResponsePayload, AgentMessagePayload, AgentMessageAckPayload } from './messages.js';
import { AgentInbox } from './agent-inbox.js';
import { SYSTEM_MONITOR_MANIFEST } from './builtin-skills/system-monitor.js';
import { INFLUXDB_MANIFEST, influxdbHealthCheck } from './builtin-skills/influxdb.js';
import { SkillHealthMonitor } from './skill-health-monitor.js';
import { loadBuildInfo } from './build-info.js';
import { resolveOutboundConnectPolicy, buildMeshConnector } from './mesh-connect.js';
import { ServerIdentityPinStore, makePinningMeshCheckServerIdentity } from './server-identity-pin.js';
import { TelegramGateway } from './telegram-gateway.js';
import type { AgentCard } from './agent-card.js';
import { seedBuiltinSkills } from './builtin-skill-seed.js';

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

  // Build-/Versions-Stempel einmal beim Start lesen (im Mesh sichtbar via agent_card + /api/status).
  const buildInfo = loadBuildInfo();
  log.info(buildInfo, '[build] Build-Stempel dieses Daemons');

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

  // ADR-024: Self-Identität, Attesting-Pin und Trust-Material werden VOR dem TLS-Bundle
  // aufgelöst, weil die Canonical-Cert-Retention beim Bundle-Load bereits (a) die eigene
  // kanonische node/<PeerID>-URI (aus dem libp2p-Key) und (b) die gepinnten Attesting-CA-PEMs
  // braucht, um ein re-enrolltes kanonisches Cert NICHT zu verwerfen. Non-fatal wenn libp2p
  // deaktiviert (canonicalSelfUriForCert undefined → Retention inert → Default-Verhalten).
  const libp2pKey = config.libp2p.enabled
    ? await loadOrCreateLibp2pPrivateKey(config.daemon.data_dir, log)
    : undefined;

  // SPAKE2 Trust-Bootstrap: PairingStore VOR dem Trust-Store (gepairte CA-Certs fliessen ins
  // aggregierte Bundle) UND vor dem TLS-Bundle (ADR-024 braucht die gepairten CA-PEMs).
  const pairingStore = new PairingStore(config.daemon.data_dir, log);

  // ADR-024: PRELIMINÄRER Attesting-Pin + Trust-Material NUR für die Canonical-Cert-Retention
  // im TLS-Bundle-Load. Aus der ca.crt.pem von Disk abgeleitet (existiert vor dem Bundle).
  // Der AUTORITATIVE Pin (Inbound-Authz, Flip-Gate) wird NACH dem Bundle aus tlsBundle.caCertPem
  // neu aufgelöst (CR-MEDIUM: kein stale/leerer Pin bei First-Boot/CA-Reissue). normFp +
  // filterPinnedCaPems werden für beide Phasen wiederverwendet.
  const normFp = (fp: string): string => fp.replace(/:/g, '').toLowerCase();
  const filterPinnedCaPems = (pems: Array<string | null | undefined>, pinnedFps: readonly string[]): string[] => {
    const set = new Set(pinnedFps.map(normFp));
    return Array.from(new Set(
      pems
        .filter((pem): pem is string => typeof pem === 'string' && pem.length > 0)
        .filter((pem) => { try { return set.has(normFp(certFingerprint(pem))); } catch { return false; } }),
    ));
  };
  const ownCaDiskPem = (() => {
    const p = resolve(config.daemon.data_dir, 'tls', 'ca.crt.pem');
    return fsExistsSync(p) ? readFileSync(p, 'utf-8') : null;
  })();
  const canonicalSelfUriForCert = libp2pKey ? peerIdToSpiffeUri(libp2pKey.peerId) : undefined;
  const prelimPinnedFps = resolveAttestingCaFingerprints(
    process.env['TLMCP_PEERID_ATTESTING_CA_FP'],
    ownCaDiskPem,
  ).fingerprints;
  const prelimTrustedCaPems = filterPinnedCaPems(
    [ownCaDiskPem, ...pairingStore.getAllPeers().map((p) => p.caCertPem)],
    prelimPinnedFps,
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
      { canonicalSpiffeUri: canonicalSelfUriForCert, trustedAttestingCaPems: prelimTrustedCaPems },
      config.cert.renew_before_days,
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
  // Mesh-CA PLUS allen gepairten Peer-CAs. Connector über mesh-connect.ts:
  // TLMCP_DEBUG_CONNECT=1 loggt exakte Connect-Parameter + Socket-Fehler;
  // TLMCP_DISABLE_OUTBOUND_PINNING=1 → kein Source-Bind + autoSelectFamily=false
  // (Default-Source-Connect wie `nc`, Fix für dual-homed macOS EHOSTUNREACH).
  const outboundConnectPolicy = resolveOutboundConnectPolicy(process.env);
  if (outboundConnectPolicy.debug || outboundConnectPolicy.disablePinning || outboundConnectPolicy.spiffeServerIdentity) {
    log.info(outboundConnectPolicy, '[connect] Outbound-Connect-Policy aktiv (Debug/Escape-Hatch)');
  }
  // ADR-028 D2b-pin: per-Host-Pin-Store + pinnender Verifier (TOFU beim First-Contact,
  // danach erzwungen). Schließt die nackte-TOFU-Restlücke aus D2b.
  const serverIdentityPinStore = new ServerIdentityPinStore();
  const meshCheckServerIdentity = outboundConnectPolicy.spiffeServerIdentity
    ? makePinningMeshCheckServerIdentity(serverIdentityPinStore, log)
    : undefined;
  if (outboundConnectPolicy.spiffeServerIdentity) {
    log.warn(
      '[connect] ADR-028 D2b SPIFFE-Server-Identity AKTIV mit per-Host-Pin (D2b-pin): First-Contact = TOFU, danach gegen die gepinnte kanonische Peer-Identität erzwungen. Produktiv-/Fleet-Aktivierung = Christians Gate. Siehe docs/architecture/ADR-028-D2-spiffe-server-identity.md',
    );
  }
  const tlsDispatcher = tlsBundle
    ? new UndiciAgent({
        connect: buildMeshConnector(
          { ca: initialCaBundle, cert: tlsBundle.certPem, key: tlsBundle.keyPem },
          outboundConnectPolicy,
          log,
          meshCheckServerIdentity,
        ),
      })
    : undefined;

  // ADR-022 Phase 3 — Per-Node-Sender-Flip (Self-Identity-Ableitung):
  // `selfIdentityUri` ist die URI, die der Node als `envelope.sender` / agent_id /
  // Skill-Author / Inbox-Adresse / Audit-Identität verwendet. Sie flippt von Legacy
  // `host/<stableNodeId>` auf kanonisch `node/<PeerID>` GENAU DANN, wenn:
  //   (1) der Operator es explizit aktiviert (config/env TLMCP_EMIT_CANONICAL_SENDER), UND
  //   (2) libp2p aktiv ist → eine stabile PeerID existiert, UND
  //   (3) der laufende mTLS-Cert-SAN BEREITS kanonisch ist (`node/<PeerID>`).
  // (3) ist der Sicherheits-Interlock „Cert-SAN VOR Sender-URI" (ADR-022 Schritt 3):
  // emittierten wir kanonisch, während das Cert noch Legacy-SAN trägt, würde die
  // empfangsseitige channel-gebundene Authz (authorizeHttpsSender) den eigenen Sender
  // gegen den Cert-SAN abgleichen und mit 403 ablehnen → Mesh-Bruch. Der Signing-Key
  // bleibt der ECDSA-Agent-Key (Option B, ADR-022 §3): Peers lösen ihn über die
  // verifizierte, auf die PeerID gekeyte Agent-Card auf (resolvePeerPublicKey). Der Flip
  // ist rein additiv + per Flag reversibel (Flag aus → sofort wieder Legacy).
  // AUTORITATIVE Attesting-Pin-Auflösung (NACH dem Bundle, aus tlsBundle.caCertPem — die jetzt
  // sicher existierende/erzeugte eigene Mesh-CA; CR-MEDIUM: kein stale/leerer Pin bei
  // First-Boot/CA-Reissue). env TLMCP_PEERID_ATTESTING_CA_FP überschreibt, `none` deaktiviert.
  const attestingPin = resolveAttestingCaFingerprints(
    process.env['TLMCP_PEERID_ATTESTING_CA_FP'],
    tlsBundle?.caCertPem ?? ownCaDiskPem,
  );
  const peerIdAttestingCaFingerprints = attestingPin.fingerprints;
  log.info(
    { source: attestingPin.source, fingerprints: peerIdAttestingCaFingerprints },
    '[identity] ADR-022 Attesting-CA-Pin aufgelöst',
  );
  if (attestingPin.source === 'env') {
    const invalidPins = peerIdAttestingCaFingerprints.filter((fp) => !/^[0-9a-fA-F]{64}$/.test(fp.replace(/:/g, '')));
    if (invalidPins.length > 0) {
      log.warn({ invalidPins }, '[identity] ADR-022: Attesting-CA-Pin-Einträge mit ungültigem Format (kein SHA-256-Hex)');
    }
  }
  // Gepinnte Attesting-CA-PEMs (eigene + gepairte), gefiltert auf den autoritativen Pin.
  const trustedAttestingCaPems = filterPinnedCaPems(
    [tlsBundle?.caCertPem ?? ownCaDiskPem, ...pairingStore.getAllPeers().map((p) => p.caCertPem)],
    peerIdAttestingCaFingerprints,
  );
  const certSansAtBoot = tlsBundle ? extractSpiffeUris(tlsBundle.certPem) : [];
  // CR-HIGH (#159): nur flippen, wenn das Serving-Cert von einer gepinnten Attesting-CA
  // ausgestellt ist (Symmetrie zur Empfangsseite). ADR-024 CR-HIGH-1: die ausstellende CA
  // ist NICHT zwingend die eigene `tlsBundle.caCertPem` — bei own-CA-Nodes (.56/.222), die
  // ein .94-signiertes kanonisches Cert behalten, ist der Issuer die .94-CA. Daher KRYPTO-
  // grafisch prüfen, ob das Serving-Cert unter EINER gepinnten Attesting-CA-PEM verifiziert
  // (NICHT über den eigenen CA-Fingerprint). `servingCertIssuerCaPem` = genau diese CA (für die
  // Pairing-/Trust-Distribution, CR-HIGH-2). `verifyPeerCert` prüft Signatur + Gültigkeit.
  const servingCertIssuerCaPem = tlsBundle
    ? trustedAttestingCaPems.find((caPem) => verifyPeerCert(caPem, tlsBundle!.certPem))
    : undefined;
  const certIssuerIsAttesting = servingCertIssuerCaPem !== undefined;
  const idDecision = resolveSelfIdentity({
    emitCanonicalFlag: config.daemon.emit_canonical_sender,
    legacyUri: identity.spiffeUri,
    peerId: libp2pKey?.peerId ?? null,
    certSans: certSansAtBoot,
    certIssuerIsAttesting,
  });
  const { selfIdentityUri, emitCanonical, canonicalSelfUri } = idDecision;
  if (idDecision.blockedReason) {
    // emit_canonical_sender ist aktiv (Default true seit ADR-022 Phase 3), aber die Vorbedingung
    // (kanonischer Cert-SAN + attestierender Issuer) ist nicht erfüllt → Fail-safe: Legacy
    // emittieren. INFO statt WARN, da `true` jetzt der Default ist und ein Node ohne node/<PeerID>-
    // Attesting-Cert legitim auf Legacy bleibt (kein Fehlerzustand; ein Flip ohne Cert würde 403 erzeugen).
    log.info(
      { reason: idDecision.blockedReason, certSans: certSansAtBoot, canonicalSelfUri },
      '[identity] ADR-022 Phase 3: kanonischer Sender (noch) nicht möglich → bleibe bei Legacy-Sender (Fail-safe, erwartbar ohne node/<PeerID>-Cert)',
    );
  }
  if (emitCanonical) {
    log.info(
      { canonicalSelfUri: selfIdentityUri, legacy: identity.spiffeUri },
      '[identity] ADR-022 Phase 3 AKTIV: emittiere kanonische node/<PeerID>-Identität',
    );
  }

  // 3. Audit-Log initialisieren
  const audit = new AuditLog(config.daemon.data_dir, identity.privateKeyPem, selfIdentityUri, log);

  // 4. Event-Bus fuer Echtzeit-Events
  const eventBus = new MeshEventBus();
  eventBus.emit('system:startup', { agentId: selfIdentityUri, port: config.daemon.port });

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
  const skillManager = new SkillManager(config.daemon.data_dir, selfIdentityUri, registry, log);

  // Eingebaute Skills registrieren
  skillManager.registerLocal({ ...SYSTEM_MONITOR_MANIFEST, author: selfIdentityUri });

  // ADR-021: InfluxDB-Skill IMMER registrieren — `availability` spiegelt den Health-State
  // (initial aus einem Boot-Check). Der SkillHealthMonitor re-evaluiert periodisch und
  // toggelt availability bei Service-Ausfall/-Erholung (heilt den Boot-Race von 2026-05-17).
  const influxAvailable = await influxdbHealthCheck();
  skillManager.registerLocal(
    { ...INFLUXDB_MANIFEST, author: selfIdentityUri },
    influxAvailable ? 'healthy' : 'unhealthy',
  );
  log.info({ influxAvailable }, 'InfluxDB Skill registriert (Health-Monitor übernimmt Re-Evaluierung)');

  // Neutral builtin skills aus skills/builtin/ in das Runtime-Verzeichnis
  // seeden (Codex Ollama-Skill Pattern). Die Skills werden beim nächsten
  // SkillDiscovery-Startup automatisch entdeckt und registriert.
  const seededSkills = seedBuiltinSkills({
    dataDir: config.daemon.data_dir,
    ownAgentId: selfIdentityUri,
    log,
  });
  if (seededSkills.installed.length > 0) {
    log.info({ skills: seededSkills.installed }, 'Builtin-Skills geseeded');
  }

  // ADR-028 D4-a: geteilte MCP-Server aus der Config als mesh-Capabilities registrieren
  // (Discovery default-open, owner-gegated mit eigener SPIFFE-Identität). Einzelne
  // ungültige Einträge werden geskippt (fail-soft in buildSharedMcpCapabilities). Ein
  // STRUKTURELLER Config-Fehler wirft — hier bewusst gefangen + laut geloggt statt den
  // Boot zu crashen: Shared-MCPs sind ein optionales Discovery-Feature, kein Grund den
  // Core-Daemon (Identity/Mesh/Skills) zu stoppen.
  try {
    // ADR-032 Phantom-Announce-Guard: nur ein designierter Provider (serve_shared=true,
    // typ. der Hub) announced die deklarierten Shared-MCPs. Ein Spoke, der nur das
    // fleet-weite Template ausliefert, announced sonst mcp:*-Phantom-Provider.
    if (!config.mcp.serve_shared && config.mcp.share.length > 0) {
      log.info(
        { declared: config.mcp.share.length },
        '[mcp-share] serve_shared=false → deklarierte Shared-MCPs werden NICHT announced (Phantom-Announce-Guard; Hub setzt TLMCP_MCP_SERVE_SHARED=1)',
      );
    }
    registerSharedMcps(
      registry,
      guardSharedMcpAnnounce(
        config.mcp.serve_shared,
        buildSharedMcpCapabilities(config.mcp.share, selfIdentityUri, new Date().toISOString()),
      ),
      log,
    );
  } catch (err) {
    // CR-LOW: das Error-Objekt loggen (Stack/Kontext), nicht nur die Message.
    log.error(
      { err },
      '[mcp-share] Shared-MCP-Config ungültig — übersprungen (Daemon startet ohne geteilte MCPs)',
    );
  }

  // Registry-Sync (ADR-020 v1): Coordinator + Adapter zwischen Automerge
  // und libp2p. Hooks werden vor runtime.start() registriert, damit die
  // ersten peer:connect-Events bereits am Coordinator landen.
  const registrySync = wireRegistrySync({ registry, log });

  // ADR-021: zentraler Skill-Health-Monitor. Skills mit externer Abhängigkeit melden
  // nur ihre healthcheck-fn; der Monitor schedult, debounced (Hysterese), timeoutet und
  // toggelt bei einem State-Flip die `availability` der EIGENEN Capability + Audit + Push.
  const skillHealthMonitor = new SkillHealthMonitor({
    log,
    onTransition: (t) => {
      const availability = t.to === 'healthy' ? 'healthy' : 'unhealthy';
      registry.setAvailability(selfIdentityUri, t.skillId, availability, t.consecutiveFailures, new Date().toISOString());
      audit.append(
        'SKILL_HEALTH_TRANSITION',
        selfIdentityUri,
        `${t.skillId}:${t.from}->${t.to} fails=${t.consecutiveFailures}${t.lastError ? ` err=${t.lastError}` : ''}`,
        'skill',
        t.skillId,
      );
      // T2.2: Alert-Sink-Event (flap-gedämpft durch die Monitor-Hysterese — feuert
      // nur bei einem echten, debouncten State-Flip). Push-Zustellung an
      // Hermes/Telegram übernimmt der Sink (Admin/Hermes-Seite).
      // Listener-Isolation: MeshEventBus ruft Listener synchron — ein werfender
      // Sink-Listener darf den nachfolgenden Registry-Republish nicht überspringen.
      try {
        eventBus.emit('system:skill_health', {
          skillId: t.skillId,
          from: t.from,
          to: t.to,
          consecutiveFailures: t.consecutiveFailures,
          lastError: t.lastError,
        });
      } catch (err) {
        log.warn({ err, skillId: t.skillId }, '[skill-health] system:skill_health-Emit fehlgeschlagen');
      }
      // Sofortiger Registry-Push, damit das Mesh den State-Flip schnell sieht (ADR-020 Resync).
      void registrySync.coordinator
        .republish()
        .catch((err) => log.warn({ err, skillId: t.skillId }, '[skill-health] republish nach Transition fehlgeschlagen'));
    },
  });
  // Skills mit externer Abhängigkeit registrieren (generisch erweiterbar: Ollama, Telegram, …).
  // CR-MEDIUM (#159): Background-Loops (skillHealthMonitor, registrySync.coordinator) werden
  // erst NACH dem fail-closed Identitäts-Guard gestartet (s.u.) — bei einem Sicherheits-Abbruch
  // soll nichts vorher anlaufen. Hier nur registrieren, NICHT starten.
  skillHealthMonitor.register('influxdb', (signal) => influxdbHealthCheck(signal));

  // libp2p-Key wird bereits oben geladen (ADR-022 Phase 3 — die Self-Identität hängt davon ab).
  const libp2pRuntime = await createLibp2pRuntime({
    enabled: config.libp2p.enabled,
    bindHost: config.daemon.bind_host,
    listenPort: config.libp2p.listen_port,
    mdnsServiceTag: config.libp2p.mdns_service_tag,
    natTraversalEnabled: config.libp2p.nat_traversal_enabled,
    relayTransportEnabled: config.libp2p.relay_transport_enabled,
    relayServiceEnabled: config.libp2p.relay_service_enabled,
    announceMultiaddrs: config.libp2p.announce_multiaddrs,
    // .55-Fix (v0.34.5): auf dual-homed macOS auch die libp2p-mDNS-Instanz
    // abschalten (zweite multicast-dns-Quelle der connectx-Re-Vergiftung).
    disableMdnsInterfacePin: config.discovery.disable_mdns_interface_pin,
    // ADR-025 CR-HIGH: static-only (mdns_enabled=false) schaltet auch libp2p-mDNS ab.
    mdnsEnabled: config.discovery.mdns_enabled,
    privateKey: libp2pKey?.privateKey,
  }, log, {
    protocolHandlers: registrySync.protocolHandlers,
    peerEvents: registrySync.peerEvents,
  });
  registrySync.setRuntime(libp2pRuntime);
  await libp2pRuntime.start();

  // ADR-022 §Startup-Assertion: PeerID / Cert-SAN / authz-Identität müssen
  // übereinstimmen. Während der Migration (Legacy `host/<stableNodeId>` + admin-
  // signiertes Hostname-SAN-Cert) divergieren sie bewusst — wir loggen alle drei
  // nebeneinander und failen LAUT. Hart-Abbruch nur bei TLMCP_STRICT_IDENTITY=1,
  // sonst würde der Daemon im aktuellen (erwarteten) Drift-Zustand gar nicht starten.
  // ADR-022 #0 ERLEDIGT: die PeerID ist jetzt stabil (persistierter Key). Sobald authz
  // + Cert-SAN auf node/<PeerID> umgestellt sind, wird TLMCP_STRICT_IDENTITY=1 gefahrlos
  // — die Scharfschaltung bleibt aber bewusst Christians Entscheidung (nicht automatisch).
  {
    const peerId = libp2pRuntime.getState().peerId;
    // CR gpt-5.5 HIGH: Der Flip wurde gegen die persistierte Key-PeerID entschieden
    // (libp2pKey.peerId), BEVOR die Runtime startete. Weicht die TATSÄCHLICH laufende
    // Runtime-PeerID davon ab (degraded/Noop-Runtime, ignorierter privateKey, Dep-Fallback),
    // emittierten wir kanonisch eine PeerID, die die Runtime/Card gar nicht meldet →
    // Empfänger können den Key nicht eindeutig auflösen → 403. Fail-closed: harter Abbruch,
    // da die kanonische Identität zu diesem Zeitpunkt bereits überall verdrahtet ist.
    if (emitCanonical && peerId !== libp2pKey?.peerId) {
      log.error(
        { keyPeerId: libp2pKey?.peerId, runtimePeerId: peerId },
        '[identity] ADR-022 Phase 3: laufende libp2p-Runtime-PeerID weicht vom persistierten Key ab — kanonischer Sender wäre nicht auflösbar',
      );
      throw new Error(
        '[identity] ADR-022 Phase 3 Abbruch: Runtime-PeerID != Key-PeerID bei aktivem canonical-sender-Flip (fail-closed)',
      );
    }
    // certSan für die Assertion: die eigene kanonische SAN, falls vorhanden, sonst die erste.
    const certSan = (canonicalSelfUri && certSansAtBoot.includes(canonicalSelfUri))
      ? canonicalSelfUri
      : (certSansAtBoot[0] ?? null);
    // authzSpiffe = die TATSÄCHLICH emittierte Self-Identität (Phase-3-Flip berücksichtigt):
    // flippt sie auf kanonisch, soll die Konsistenzprüfung sie auch kanonisch sehen.
    const idCheck = checkIdentityConsistency({ authzSpiffe: selfIdentityUri, certSan, peerId });
    log.info(
      { authzSpiffe: selfIdentityUri, certSan, peerId, expected: idCheck.expected, emitCanonical },
      '[identity] ADR-022 Identitäts-Triple',
    );
    // ADR-022: Solange NICHT geflippt (Phase 0/Accept-both) KENNT der Node seine
    // kanonische node/<PeerID>-Identität (idCheck.expected), EMITTIERT aber weiterhin
    // Legacy. Eingehend werden beide SAN-Formen akzeptiert (authorizeHttpsSender +
    // peerIdFromCertSan-Brücke). Nach dem Flip (emitCanonical) emittiert er kanonisch.
    if (idCheck.expected && !emitCanonical) {
      log.info(
        { canonicalSelfUri: idCheck.expected, emitting: selfIdentityUri },
        '[identity] ADR-022 Accept-both aktiv: kanonische Self-Identität abgeleitet, emittiere weiter Legacy',
      );
    }
    if (!idCheck.consistent) {
      // CR LOW: erwartete Migrationsdrift im Non-Strict-Modus als warn (nicht error)
      // loggen, damit Monitoring nicht falsch-kritisch eskaliert; strict → error + throw.
      const strict = process.env['TLMCP_STRICT_IDENTITY'] === '1';
      const ctx = { divergences: idCheck.divergences, expected: idCheck.expected, strict };
      const msg =
        '[identity] ADR-022 Divergenz: PeerID / Cert-SAN / authz-Identität stimmen NICHT überein';
      if (strict) {
        log.error(ctx, msg);
        throw new Error(
          `[identity] ADR-022 strict mode aktiv und Identitäts-Divergenz: ${idCheck.divergences.join('; ')}`,
        );
      }
      log.warn(ctx, msg);
    }
  }

  // CR-MEDIUM (#159): Background-Loops ERST JETZT starten — nach dem fail-closed
  // Identitäts-Guard, damit bei einem Sicherheits-Abbruch keine Timer/Healthchecks/
  // Sync-Logik mehr anlaufen.
  skillHealthMonitor.start();
  if (config.libp2p.enabled) {
    registrySync.coordinator.start();
    log.info('RegistrySyncCoordinator gestartet (ADR-020 v1)');
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
    selfIdentityUri,
    identity.privateKeyPem,
    log,
    tlsDispatcher,
    undefined, // GossipConfig defaults
    skillManager,
  );

  // peerIdAttestingCaFingerprints wird bereits oben (Phase-3-Flip-Gate) berechnet.

  // 8. Agent Card Server starten (HTTP oder HTTPS).
  // trustedCaBundle: aggregiert eigene CA + gepairte Peer-CAs. Hot-Reload bei
  // neuen Pairings ist Phase 2 — aktuell zaehlt der Snapshot zum Startzeitpunkt.
  const cardServer = new AgentCardServer({
    identity,
    selfIdentityUri,
    config,
    buildInfo,
    tls: tlsBundle,
    trustedCaBundle: trustStoreNotifier?.current(),
    log,
    rateLimiter,
    // T2.4-Folge: Self-Resource-Attribute (cache-bewusst) über die Agent-Card exponieren,
    // damit Peers die place-or-refuse-relevante Kapazität sehen. Quelle = Registry-Side-Map.
    getNodeResources: () => registry.getNodeResources(selfIdentityUri),
    // ADR-022: tolerante, PeerID-gekeyte Auflösung (behebt Root-Cause (a) des
    // SKILL_ANNOUNCE-403 „Unknown sender"). Auflösung via mesh, nicht via
    // OS-/Hostname-URI. Siehe MeshManager.resolvePeerPublicKey.
    getPeerPublicKey: (agentId: string) => mesh.resolvePeerPublicKey(agentId),
    // ADR-022 §3 (channel-bound): ein CA-validierter mTLS-Cert-SAN node/<PeerID>
    // schaltet die kanonische PeerID-Auflösung für diesen Peer frei.
    onPeerCertVerified: (peerId: string, senderUri: string, remoteAddress?: string) =>
      mesh.markPeerIdVerified(peerId, senderUri, remoteAddress), // {ok, rollback} — transaktional
    // ADR-022 (CR gpt-5.5 WS-2 HIGH): NUR von der attestierenden Mesh-/Admin-CA (.94)
    // signierte node/<PeerID>-Certs dürfen eine PeerID attestieren — nicht jede CA im
    // Trust-Bundle. Pin wird oben aufgelöst (resolveAttestingCaFingerprints): Default =
    // aus der EIGENEN Single-Cert-`ca.crt.pem` abgeleitet; Env `TLMCP_PEERID_ATTESTING_CA_FP`
    // überschreibt; `none` deaktiviert (fail-closed). Paired-Fremd-CAs bleiben ausgeschlossen.
    peerIdAttestingCaFingerprints: peerIdAttestingCaFingerprints,
    // ADR-026 symmetrische Discovery: ein authentifizierter, issuer-gepinnt attestierter
    // Inbound-Sender, der (noch) nicht auflösbar ist, wird ASYNCHRON gelernt (Card-Fetch von
    // der TLS-Source-IP, gegen die attestierte PeerID validiert → AUTHN-only seen-Map). Der
    // Retry des Senders löst dann auf. mDNS-lose / mobile / NAT-Nodes brauchen keinen static_peer.
    onAuthenticatedInbound: config.discovery.auto_register_authenticated_peers
      ? (info) => {
          void learnInboundPeer({
            peerId: info.peerId,
            senderUri: info.senderUri,
            remoteAddress: info.remoteAddress,
            port: config.daemon.port,
            certFingerprint: info.certFingerprint,
            expectedSpiffeUri: peerIdToSpiffeUri(info.peerId),
            isAlreadyResolvable: () => mesh.resolvePeerPublicKey(info.senderUri) !== undefined,
            rateLimitOk: () => rateLimiter.allow(`adr026-learn:${info.peerId}`),
            fetchCard: async (endpoint) => {
              const res = await fetch(`${endpoint}/.well-known/agent-card.json`, {
                signal: AbortSignal.timeout(5_000),
                dispatcher: tlsDispatcher,
              });
              if (!res.ok) {
                await res.body?.cancel().catch(() => {});
                return null;
              }
              const card = (await res.json()) as AgentCard;
              return { spiffeUri: card.spiffeUri, publicKey: card.publicKey };
            },
            record: (e) => mesh.recordAuthenticatedSeen(e),
            audit: (a) => audit.append('PEER_OBSERVED', a.peerId, `${a.endpoint} fp=${a.certFingerprint.slice(0, 16)}`),
            log,
          }).catch((err) => log.debug({ err: (err as Error)?.message }, '[discovery] ADR-026 learn error'));
        }
      : undefined,
    onMessage: async (envelope: MessageEnvelope, senderPublicKey: string) => {
      // ADR-022 Phase 3 / CR-MEDIUM (#159): ein gepairter Peer wird nach einem Identity-Flip
      // unter neuer URI über seinen (stabilen, bereits verifizierten) Public-Key als gepairt
      // erkannt — URI-gekeytes Pairing allein bräche sonst nach dem Flip fail-closed.
      const senderIsPaired =
        pairingStore.isPaired(envelope.sender) || pairingStore.isPairedByPublicKey(senderPublicKey);
      // ADR-026 / CR gpt-5.5 HIGH 1 — AUTHN/AUTHZ-Trennung: Die Signatur kann jetzt auch über
      // einen AUTHN-only gelernten (authenticated_unapproved) Peer auflösen. State-mutierende
      // Message-Typen (REGISTRY_SYNC, SKILL_ANNOUNCE) DÜRFEN deshalb NICHT allein aus „Signatur
      // gültig" folgen — sie verlangen einen APPROVED/DISCOVERED Peer (this.peers) oder Pairing.
      // isApprovedPeerSender konsultiert authenticatedSeen NICHT → kein Leak in die Autorisierung.
      const senderAuthorizedForMeshState = senderIsPaired || mesh.isApprovedPeerSender(envelope.sender);
      // Rate-Limiting prüfen
      if (!rateLimiter.allow(envelope.sender)) {
        log.warn({ sender: envelope.sender }, 'Rate-Limited — Nachricht abgelehnt');
        return null;
      }

      // Nachricht je nach Typ verarbeiten
      switch (envelope.type) {
        case MessageType.REGISTRY_SYNC: {
          // ADR-026 INVARIANTE: registry-sync-Akzeptanz nur von approved/discovered Peers —
          // ein authenticated_unapproved (AUTHN-only) Sender darf den CRDT-State NICHT verändern.
          if (!senderAuthorizedForMeshState) {
            log.warn({ sender: envelope.sender, type: envelope.type }, 'AUTHZ: REGISTRY_SYNC von nicht-approved Sender abgelehnt (authenticated_unapproved)');
            audit.append('PEER_OBSERVED', envelope.sender, 'REGISTRY_SYNC rejected: unapproved sender');
            return null;
          }
          const response = gossip.handleSyncMessage(envelope);
          const responseEnvelope = createEnvelope(
            MessageType.REGISTRY_SYNC_RESPONSE,
            selfIdentityUri,
            response,
            { correlation_id: envelope.correlation_id },
          );
          return encodeAndSign(responseEnvelope, identity.privateKeyPem);
        }
        case MessageType.SKILL_ANNOUNCE: {
          // ADR-026 INVARIANTE: capability-merge / skill-exec-Akzeptanz nur von approved/discovered
          // Peers — ein authenticated_unapproved (AUTHN-only) Sender darf KEINE Capabilities/Skills
          // in die Registry einbringen oder Manifest-Installation/Auto-Activation auslösen.
          if (!senderAuthorizedForMeshState) {
            log.warn({ sender: envelope.sender, type: envelope.type }, 'AUTHZ: SKILL_ANNOUNCE von nicht-approved Sender abgelehnt (authenticated_unapproved)');
            audit.append('PEER_OBSERVED', envelope.sender, 'SKILL_ANNOUNCE rejected: unapproved sender');
            return null;
          }
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
          } else if (senderIsPaired) {
            vault.approveRequest(approval.id);
            const sealed = vault.sealForPeer(cred.value, secretReq.requester_public_key);
            responsePayload = { credential_name: secretReq.credential_name, status: 'approved', sealed_value: sealed, reason: null };
            audit.append('CREDENTIAL_ACCESS', envelope.sender, secretReq.credential_name);
          } else {
            responsePayload = { credential_name: secretReq.credential_name, status: 'pending', sealed_value: null, reason: 'Awaiting human approval' };
          }

          const secretResp = createEnvelope(MessageType.SECRET_RESPONSE, selfIdentityUri, responsePayload, { correlation_id: envelope.correlation_id });
          return encodeAndSign(secretResp, identity.privateKeyPem);
        }
        case MessageType.AGENT_MESSAGE: {
          // Free-form agent-to-agent message (human-initiated or agent-initiated).
          // Signature wurde bereits von agent-card.ts verifiziert. Wir pruefen nur
          // noch ob der Sender in unserem Trust-Perimeter ist.
          const msg = envelope.payload as AgentMessagePayload;
          let ack: AgentMessageAckPayload;

          if (msg.to !== selfIdentityUri) {
            ack = {
              message_id: msg.message_id,
              received_at: new Date().toISOString(),
              status: 'rejected',
              reason: 'recipient mismatch',
            };
          } else if (!senderIsPaired) {
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
                  to: selfIdentityUri,
                });
              }
            }
          }

          const ackEnvelope = createEnvelope(
            MessageType.AGENT_MESSAGE_ACK,
            selfIdentityUri,
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
    getRegistrySyncStatus: () => registrySync.coordinator.getStatus(),
  });
  // 8b. Task-Manager + Executor initialisieren
  const taskManager = new TaskManager(log);
  const taskExecutor = new TaskExecutor({
    tasks: taskManager,
    skills: skillManager,
    audit,
    eventBus,
    agentId: selfIdentityUri,
    log,
    // T2.4 place-or-refuse: bei RAM > Schwelle keine neue Platzierung annehmen.
    getRamUsedPercent: () => readRamUsedPercent(),
    refuseRamPercent: config.placement.refuse_ram_percent,
    // T2.4-Folge: CPU/agent_count-Dimensionen (opt-in, Default-Schwellen 0 = aus).
    // CPU aus der periodisch aktualisierten Side-Map (kein si.currentLoad pro Request);
    // agent_count instant aus dem AgentRegistry. Closures werden erst zur Task-Zeit
    // (post-Startup) aufgerufen → agentRegistry/registry sind dann initialisiert.
    getCpuLoad: () => registry.getNodeResources(selfIdentityUri)?.cpu_load ?? null,
    refuseCpuPercent: config.placement.refuse_cpu_percent,
    getAgentCount: () => agentRegistry.size(),
    refuseAgentCount: config.placement.refuse_agent_count,
  });

  // 8c. Pairing-Routen registrieren (pairingStore wurde oben bereits erzeugt,
  // damit der Trust-Store die bestehenden CAs beim Start kennt).
  // ADR-024 CR-HIGH-2 + MEDIUM-2 (Trust-Distribution-Lifecycle, fail-closed): gepairte Peers
  // müssen die CA bekommen, die unser SERVING-Cert ausgestellt hat — bei einem behaltenen
  // .94-signierten kanonischen Cert ist das die .94-Attesting-CA, NICHT unsere eigene Mesh-CA.
  // `selectTrustDistributionCa` wählt die erste Kandidaten-CA, die das Serving-Cert tatsächlich
  // verifiziert (Issuer-CA bevorzugt, eigene CA als Legacy-/Default-Fallback). Verifiziert KEINE
  // → null statt eines nicht-validierenden/leeren Ankers: dann KEINE Pairing-Distribution
  // registrieren (fail-closed), sonst bekämen neu gepairte Peers einen Anker, der unseren
  // Server nicht validiert.
  const pairingRouteBase = {
    store: pairingStore,
    agentId: selfIdentityUri,
    hostname: config.daemon.hostname,
    publicKeyPem: identity.publicKeyPem,
    fingerprint: identity.fingerprint,
    log,
    trustStoreNotifier,
  };
  if (tlsBundle) {
    const trustDistributionCa = selectTrustDistributionCa({
      servingCertPem: tlsBundle.certPem,
      candidateCaPems: [servingCertIssuerCaPem, tlsBundle.caCertPem],
    });
    if (trustDistributionCa) {
      registerPairingRoutes(cardServer.getServer(), { ...pairingRouteBase, caCertPem: trustDistributionCa });
    } else {
      // fail-closed: keine Kandidaten-CA verifiziert unser Serving-Cert → KEINE Pairing-Routen,
      // sonst bekämen neu gepairte Peers einen Trust-Anker, der unseren Server nicht validiert.
      log.error(
        'ADR-024 MEDIUM-2: keine Kandidaten-CA verifiziert das eigene Serving-Cert → Trust-Distribution fail-closed: Pairing-Routen NICHT registriert (inkonsistente Issuer-Topologie). Cert-Re-Enroll/CA-Refresh nötig.',
      );
    }
  } else {
    // TLS deaktiviert (Loopback/lokaler Modus): keine mTLS-Trust-Distribution möglich —
    // bisheriges Verhalten beibehalten (Pairing-Routen ohne ausstellenden CA-Anker).
    registerPairingRoutes(cardServer.getServer(), { ...pairingRouteBase, caCertPem: '' });
  }

  // 8c1b. Token-Onboarding API (ADR-016)
  // Load CA key for cert-signing (only admin nodes have this)
  const caKeyPath = join(config.daemon.data_dir, 'tls', 'ca.key.pem');
  // ADR-024 CR-HIGH-3: Token-Onboarding/Cert-Issuance NUR aktivieren, wenn unser eigenes
  // Serving-Cert auch von unserer EIGENEN ca.crt.pem signiert ist. Hält ein own-CA-Node ein
  // von .94 BEHALTENES (ADR-024 Retention) kanonisches Cert, ist die eigene CA NICHT der
  // Issuer des Serving-Certs — würden wir damit Peers onboarden, bekämen sie einen
  // Trust-Anchor, der unseren Server nicht verifiziert. Fail-safe: Issuance dann AUS.
  // (.94 behält Issuance: sein Serving-Cert IST von seiner eigenen Mesh-CA signiert.)
  const servingCertSignedByOwnCa = tlsBundle
    ? verifyPeerCert(tlsBundle.caCertPem, tlsBundle.certPem)
    : false;
  let caBundle: import('./tls.js').CaBundle | undefined;
  try {
    const caKeyPem = readFileSync(caKeyPath, 'utf-8');
    if (servingCertSignedByOwnCa) {
      caBundle = { caCertPem: tlsBundle?.caCertPem ?? '', caKeyPem: caKeyPem };
      log.info('CA-Key geladen — Token-Onboarding aktiv (Admin-Node)');
    } else {
      log.warn(
        'CA-Key vorhanden, aber Serving-Cert NICHT von der eigenen CA signiert (ADR-024: fremd-signiertes Cert behalten) — Token-Onboarding/Cert-Issuance DEAKTIVIERT (inkonsistente Issuer-Topologie, fail-safe)',
      );
    }
  } catch {
    log.info('Kein CA-Key gefunden — Token-Onboarding nicht verfuegbar (kein Admin-Node)');
  }

  const tokenStore = new TokenStore(config.daemon.data_dir, log);

  // Admin-only token endpoints on the main mTLS server (loopback)
  registerTokenApi(cardServer.getServer(), {
    tokenStore,
    pairingStore,
    trustStoreNotifier,
    audit,
    caBundle,
    ownAgentId: selfIdentityUri,
    log,
    rateLimiter,
  });

  // 8c1c. ADR-022 Schritt 3 / WS-3: PoP-basierte node/<PeerID>-Cert-Ausstellung.
  // NUR auf Admin-Nodes (CA-Key vorhanden). Endpoints liegen auf dem HAUPT-mTLS-Server
  // (9440) → nur Mesh-Mitglieder mit gültigem Legacy/node-Cert erreichen sie; die
  // kryptografische Identität liefert der PoP. Stellt Certs mit SAN node/<PeerID> aus.
  if (caBundle && caBundle.caCertPem && caBundle.caKeyPem) {
    const nonceStore = new NonceStore();
    const certIssuer = new CertIssuer({ ca: caBundle, nonceStore, log });
    registerCertIssuanceApi(cardServer.getServer(), {
      issuer: certIssuer,
      nonceStore,
      log,
      rateLimiter,
    });
    log.info({ caFingerprint: certIssuer.fingerprint }, 'ADR-022 WS-3: PoP-Cert-Ausstellung aktiv (Admin-Node)');
  }

  // Onboarding server: separate HTTPS port WITHOUT client-cert requirement.
  // New nodes don't have a cert yet, so /onboarding/join must be reachable
  // without mTLS. Only the Bearer token authenticates the request.
  if (caBundle && tlsBundle) {
    const Fastify = (await import('fastify')).default;
    const onboardingServer = Fastify({
      logger: false,
      https: {
        key: tlsBundle.keyPem,
        cert: tlsBundle.certPem,
        // NO requestCert, NO rejectUnauthorized — this is intentional!
        // The Bearer token in the Authorization header authenticates instead.
      },
    });

    // Register only the join endpoint on the onboarding server
    registerTokenApi(onboardingServer, {
      tokenStore,
      pairingStore,
      trustStoreNotifier,
      audit,
      caBundle,
      ownAgentId: selfIdentityUri,
      log,
      rateLimiter,
    });

    const onboardingListenPort = onboardingPort(config.daemon.port); // Haupt-Port + 1 (single source)
    await onboardingServer.listen({ port: onboardingListenPort, host: '0.0.0.0' });
    log.info({ port: onboardingListenPort }, 'Onboarding-Server gestartet (HTTPS ohne mTLS-Pflicht)');
  }

  // 8c2. Agent Registry (ADR-004 Phase 2)
  // MUST be created BEFORE registerInboxApi so the broadcast fanout
  // (POST /api/inbox/send with to=…/instance/*) can enumerate instances.
  const agentRegistry = new AgentRegistry({
    heartbeatIntervalMs: 5_000,
    staleFactor: 3,
    log,
  });
  agentRegistry.start();

  // T2.4: periodisch die Resource-Attribute des eigenen Knotens (free_ram, cpu_load,
  // agent_count) in die non-replizierte Registry-Side-Map schreiben. Owner-authoritativ,
  // try/catch-gekapselt (ein Mess-Fehler darf den Daemon nie crashen). unref + clear im Shutdown.
  const refreshNodeResources = async (): Promise<void> => {
    try {
      const m = await readResourceMetrics();
      registry.setNodeResources(selfIdentityUri, {
        free_ram_bytes: m.free_ram_bytes,
        ram_used_percent: m.ram_used_percent,
        cpu_load: m.cpu_load,
        agent_count: agentRegistry.size(),
      });
    } catch (err) {
      log.warn({ err }, '[resource-attrs] Aktualisierung fehlgeschlagen');
    }
  };
  void refreshNodeResources();
  const resourceRefreshTimer = setInterval(
    () => void refreshNodeResources(),
    config.placement.resource_refresh_interval_ms,
  );
  resourceRefreshTimer.unref();

  registerAgentApi(cardServer.getServer(), {
    registry: agentRegistry,
    audit,
    daemonSpiffeUri: selfIdentityUri,
    inboxSchemaVersion: 1,
    log,
  });

  // 8c3. Agent-to-Agent Messaging API
  registerInboxApi(cardServer.getServer(), {
    inbox: agentInbox,
    mesh,
    ownAgentId: selfIdentityUri,
    ownPublicKeyPem: identity.publicKeyPem,
    ownPrivateKeyPem: identity.privateKeyPem,
    tlsDispatcher,
    rateLimiter,
    log,
    eventBus,
    agentRegistry,
    pairingStore,
    onSent: (messageId, to) => {
      audit.append('AGENT_MESSAGE_TX', to, messageId);
      eventBus.emit('audit:new', {
        type: 'AGENT_MESSAGE_TX',
        to,
        message_id: messageId,
      });
    },
  });

  // 8c3b. Modell-B MCP-Proxy-Ingress (v5 Spur 3, T3.2 + T3.3): POST /api/mcp/:server.
  // D3-Sender-Auth aus dem mTLS-Client-Cert (403 bei ungueltigem/fehlendem Cert);
  // remote-forward-only (Christian-Gate Q1 = JA). T3.3: Live-undici-mTLS-Executor mit
  // per-Owner-Agent, D2-Server-Pin, Timeout/Cancel, 1-Hop-Guard + beidseitigem Audit.
  const mcpForwardHttp = createUndiciMcpForward({
    tls: tlsBundle ? { ca: initialCaBundle, cert: tlsBundle.certPem, key: tlsBundle.keyPem } : undefined,
    outboundPolicy: outboundConnectPolicy,
    log,
  });
  const mcpForwardExecutor = createMcpForwardExecutor({
    selfAgentId: selfIdentityUri,
    httpForward: mcpForwardHttp.forward,
    audit: (event, peerId, details) => audit.append(event, peerId, details),
    log,
  });
  registerMcpIngressApi(cardServer.getServer(), {
    selfAgentId: selfIdentityUri,
    resolvePeer: (agentId) => {
      const peer = mesh.getPeer(agentId);
      return peer ? { agentId, endpoint: peer.endpoint } : undefined;
    },
    getCapabilities: () => registry.getAllCapabilities(),
    requireServerIdentity: outboundConnectPolicy.spiffeServerIdentity,
    execute: mcpForwardExecutor,
    audit: (event, peerId, details) => audit.append(event, peerId, details),
    log,
  });

  // 8c4. Skill Discovery + Capability Activation (ioBroker-Moment, PR #110)
  // Auto-discovers skills from peers, installs as neutral manifests,
  // activates capabilities, triggers Claude Code adapter.
  const capActivation = new CapabilityActivationStore(config.daemon.data_dir, log);
  const skillDiscovery = new SkillDiscovery({
    dataDir: config.daemon.data_dir,
    ownAgentId: selfIdentityUri,
    activation: capActivation,
    eventBus,
    log,
  });

  // ADR-030 (T1.3): periodische SQLite-Wartung — WAL-Checkpoint (TRUNCATE) für
  // audit.db + activation.db, plus Retention auf den sicher löschbaren Tabellen
  // (peer_audit_events / terminale revoked-Capabilities). Die lokale signierte
  // audit_events-Chain bleibt unangetastet (append-only). Fehler dürfen den
  // Daemon nie crashen → alles try/catch-gekapselt.
  // wal_checkpoint(TRUNCATE) wirft nicht, wenn eine andere Verbindung das WAL
  // hält — better-sqlite3 liefert dann {busy:1} und das -wal wird NICHT gekürzt.
  // Das sichtbar machen (kein stiller Fehler), statt es zu verschlucken.
  const logIfBusy = (db: string, result: unknown): void => {
    const row = Array.isArray(result) ? (result[0] as { busy?: number } | undefined) : undefined;
    if (row?.busy) {
      log.debug({ db, result: row }, '[maintenance] WAL-Checkpoint busy — -wal nicht gekürzt');
    }
  };
  const runStorageMaintenance = (): void => {
    try {
      logIfBusy('audit', audit.checkpoint());
    } catch (err) {
      log.warn({ err }, '[maintenance] audit-Checkpoint fehlgeschlagen');
    }
    try {
      logIfBusy('capabilities', capActivation.checkpoint());
    } catch (err) {
      log.warn({ err }, '[maintenance] capability-Checkpoint fehlgeschlagen');
    }
    const DAY_MS = 86_400_000;
    if (config.retention.peer_audit_max_age_days > 0) {
      try {
        audit.prunePeerEventsOlderThan(config.retention.peer_audit_max_age_days * DAY_MS);
      } catch (err) {
        log.warn({ err }, '[maintenance] peer_audit-Retention fehlgeschlagen');
      }
    }
    if (config.retention.revoked_capability_max_age_days > 0) {
      try {
        capActivation.pruneRevokedOlderThan(
          config.retention.revoked_capability_max_age_days * DAY_MS,
        );
      } catch (err) {
        log.warn({ err }, '[maintenance] revoked-capability-Retention fehlgeschlagen');
      }
    }
  };
  // Einmal beim Start (kürzt ein evtl. großes -wal aus dem letzten Lauf), dann periodisch.
  runStorageMaintenance();
  const storageMaintenanceTimer = setInterval(
    runStorageMaintenance,
    config.retention.checkpoint_interval_ms,
  );
  storageMaintenanceTimer.unref();

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
        author: selfIdentityUri,
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
      selfIdentityUri,
      wirePayload as unknown as Record<string, unknown>,
      { ttl_ms: 60_000 },
    );
    const signed = encodeAndSign(envelope, identity.privateKeyPem);
    const body = serializeSignedMessage(signed);

    // ADR-022 Item 2: Retry mit Backoff gegen den „Unknown sender"-403 (Root-Cause b,
    // Timing). Die Card-Registrierung beim Empfänger kann ms nach Discovery noch nicht
    // da sein → erster Announce 403. Begrenzte Versuche, dann sauber aufgeben + loggen.
    void (async () => {
      const backoffsMs = [0, 750, 2000, 4000]; // 4 Versuche, erster sofort
      for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
        const delay = backoffsMs[attempt] ?? 0;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        try {
          const res = await fetch(`${peer.endpoint}/message`, {
            method: 'POST',
            headers: { 'content-type': 'application/cbor' },
            body: Buffer.from(body),
            signal: AbortSignal.timeout(10_000),
            dispatcher: tlsDispatcher,
          });
          // Body wird nie genutzt → canceln, damit undici die Connection freigibt (CR MEDIUM).
          void res.body?.cancel().catch(() => {});
          if (res.ok) {
            log.info(
              { peer: peerAgentId, skills: localSkills.map((s) => s.name), attempt: attempt + 1 },
              '[skill-discovery] SKILL_ANNOUNCE sent successfully',
            );
            eventBus.emit('skill:announced', {
              peer: peerAgentId,
              skills: localSkills.map((s) => s.name),
            });
            return;
          }
          // Von den HTTP-Status ist nur 403 („Unknown sender" — Card noch nicht
          // registriert) transient/retrybar; andere Status → sofort aufgeben.
          // (Echte Sendefehler/Timeouts fängt der catch-Block und gelten als transient.)
          if (res.status !== 403) {
            log.warn(
              { peer: peerAgentId, status: res.status },
              '[skill-discovery] SKILL_ANNOUNCE abgelehnt (nicht retrybar)',
            );
            return;
          }
          log.debug(
            { peer: peerAgentId, status: 403, attempt: attempt + 1, of: backoffsMs.length },
            '[skill-discovery] SKILL_ANNOUNCE 403 (Unknown sender) — retry nach Backoff',
          );
        } catch (err) {
          log.debug(
            { peer: peerAgentId, attempt: attempt + 1, err: err instanceof Error ? err.message : String(err) },
            '[skill-discovery] SKILL_ANNOUNCE Sendefehler — retry nach Backoff',
          );
        }
      }
      log.warn(
        { peer: peerAgentId, attempts: backoffsMs.length },
        '[skill-discovery] SKILL_ANNOUNCE endgültig fehlgeschlagen — Peer kennt unseren Sender-Key nicht, gebe auf',
      );
    })();
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
    selfIdentityUri,
    config,
    rateLimiter,
    vault,
    executor: taskExecutor,
    registrySyncRepublish: () => registrySync.coordinator.republish(),
    getRegistrySyncStatus: () => registrySync.coordinator.getStatus(),
    getSkillHealth: () => skillHealthMonitor.getStatus(),
    buildInfo,
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

  // 9. mDNS Discovery starten (ADR-019: mit Policy fuer Interface-Pinning + Anti-Leakage)
  const discovery = new MdnsDiscovery(
    config.discovery.mdns_service_type,
    log,
    config.daemon.tls_enabled,
    {
      allowed_mesh_cidrs: config.discovery.allowed_mesh_cidrs,
      exclude_interface_patterns:
        config.discovery.exclude_interface_patterns.length > 0
          ? config.discovery.exclude_interface_patterns
          : undefined,
      disable_mdns_interface_pin: config.discovery.disable_mdns_interface_pin,
      // ADR-025: mDNS komplett aus (static-only) + geordnete Interface-Präferenz.
      mdns_enabled: config.discovery.mdns_enabled,
      preferred_interfaces:
        config.discovery.preferred_interfaces.length > 0
          ? config.discovery.preferred_interfaces
          : undefined,
    },
  );

  discovery.publish(
    `${config.daemon.hostname}-${config.daemon.agent_type}`,
    config.daemon.port,
    {
      agentId: selfIdentityUri,
      p2pPeerId: libp2pRuntime.getState().peerId ?? undefined,
      capabilityHash: '',
      certFingerprint: identity.fingerprint,
      proto: proto as 'http' | 'https',
    },
  );

  discovery.browse({
    onPeerFound: async (discovered) => {
      if (discovered.agentId === selfIdentityUri) return;

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
          // CR-MEDIUM (#159): Endpoint/Host/Port erst JETZT (nach Card-Identitäts-Check)
          // verifiziert aktualisieren — nicht im rohen mDNS-addPeer-Pfad (Endpoint-Hijacking).
          mesh.confirmPeerDiscovery(discovered.agentId, discovered);
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

  // 9b. Statische Peers verbinden — ADR-025: robuster Reconciler statt einmaligem Start-Burst.
  // Auf dual-homed macOS (.55) vergiftet der Daemon-Start die connectx-Route transient (~Sekunden);
  // der frühere Einmal-Connect traf genau dieses Fenster → EHOSTUNREACH → 0 Peers, kein Retry.
  // Der Reconciler versucht nicht-verbundene Peers sofort, dann alle 15s für 5min neu; danach
  // (ADR-026/025-Follow-up) IMMER langsam weiter (60s, mDNS-unabhängig), damit ein offline
  // geflappter static_peer re-connectet/re-onlined wird (checkPeers re-pollt offline-Peers nicht).
  // Non-blocking, idempotent (mesh.addPeer dedupt über agentId), sauber stopbar im Shutdown.
  let staticPeerReconciler: { stop: () => void } | undefined;
  if (config.discovery.static_peers.length > 0) {
    log.info({ count: config.discovery.static_peers.length }, 'Statische Peers konfiguriert — Reconciler startet');
    const connectStaticPeerOnce = async (sp: typeof config.discovery.static_peers[number]): Promise<boolean> => {
      const port = sp.port ?? config.daemon.port;
      const endpoint = `${proto}://${sp.host}:${port}`;
      const name = sp.name ?? `${sp.host}:${port}`;
      const res = await fetch(`${endpoint}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(5_000),
        dispatcher: tlsDispatcher,
      });
      if (!res.ok) {
        // CR-MEDIUM: Body verwerfen, sonst hält undici die Verbindung offen (Socket-Leak bei Retry).
        await res.body?.cancel().catch(() => {});
        log.warn({ peer: name, status: res.status }, 'Statischer Peer nicht erreichbar (retry)');
        return false;
      }
      const card = (await res.json()) as AgentCard;
      const fingerprint = createHash('sha256').update(card.publicKey).digest('hex');
      mesh.addPeer({
        name,
        host: sp.host,
        port,
        agentId: card.spiffeUri,
        capabilityHash: '',
        certFingerprint: fingerprint,
        endpoint,
      });
      mesh.updateAgentCard(card.spiffeUri, card);
      log.info({ peer: name, agentId: card.spiffeUri }, 'Statischer Peer verbunden');
      return true;
    };
    staticPeerReconciler = startStaticPeerReconciler({
      staticPeers: config.discovery.static_peers,
      connectOnce: connectStaticPeerOnce,
      log,
      // ADR-026/025 Follow-up: Steady-Reconcile IMMER (nicht mehr nur mdns-off). Ein static_peer,
      // der transient offline flappt (dual-homed macOS .55), wird sonst nach dem one-shot-Connect
      // NIE wieder verbunden — und checkPeers schließt offline-Peers vom /health-Re-Poll aus →
      // dauerhaft offline trotz Erreichbarkeit. Steady (60s) re-connectet (addPeer re-onlined).
      steadyIntervalMs: resolveStaticReconcileSteadyMs(config.discovery.static_peers.length),
    });
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

  // T2.1: Live-Cert-Ablauf-Monitor — prüft das Node-Cert periodisch (nicht nur
  // beim Start) und alarmiert bei <30 d (warn) / ≤7 d (critical) via Log +
  // signiertem Audit-Event + EventBus. Reissue selbst passiert weiterhin erst
  // beim Neustart (RE-CHECK-Verdikt, PR #212).
  const certExpiryTimer = startCertExpiryMonitor(
    {
      getDaysLeft: () => getCertDaysLeft(config.daemon.data_dir),
      thresholds: {
        warnDays: config.cert.expiry_warn_days,
        criticalDays: config.cert.expiry_critical_days,
      },
      log,
      audit,
      eventBus,
    },
    config.cert.expiry_check_interval_ms,
  );

  // 12. Graceful Shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutdown eingeleitet...');
    clearInterval(storageMaintenanceTimer); // ADR-030 (T1.3)
    clearInterval(certExpiryTimer); // T2.1
    clearInterval(resourceRefreshTimer); // T2.4
    telegramGateway?.stop();
    skillHealthMonitor.stop();
    gossip.stop();
    mesh.stopHeartbeatLoop();
    taskManager.stop();
    agentRegistry.stop();
    capActivation.close();
    vault.close();
    agentInbox.close();
    rateLimiter.stop();
    mcpForwardHttp.close(); // T3.3: per-Owner undici-Agents abraeumen
    staticPeerReconciler?.stop();
    discovery.stop();
    await registrySync.coordinator.stop();
    await libp2pRuntime.stop();
    await cardServer.stop();
    audit.append('PEER_LEAVE', selfIdentityUri, 'graceful shutdown');
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
