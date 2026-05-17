import { Bonjour, type Service, type Browser } from 'bonjour-service';
import type { Logger } from 'pino';
import {
  type DiscoveryPolicyConfig,
  getMeshIp,
  isPeerIpAllowed,
  restrictServiceToIp,
} from './discovery-policy.js';

export interface DiscoveredPeer {
  name: string;
  host: string;
  port: number;
  agentId: string;
  p2pPeerId?: string;
  capabilityHash: string;
  certFingerprint: string;
  endpoint: string;
}

export interface DiscoveryEvents {
  onPeerFound: (peer: DiscoveredPeer) => void;
  onPeerLeft: (name: string) => void;
}

export class MdnsDiscovery {
  private bonjour: Bonjour;
  private browser: Browser | null = null;
  private meshIp?: string;

  constructor(
    private serviceType: string,
    private log?: Logger,
    private requireTls = false,
    private policy: DiscoveryPolicyConfig = {},
  ) {
    // ADR-019: explizites Interface-Pinning fuer den mDNS-Socket
    // (steuert auf welchem Interface Multicast versendet wird).
    //
    // LIMITATION (CR-Review MEDIUM, Phase 2): meshIp wird nur EINMAL beim
    // Start berechnet. Wenn das Mesh-Interface zur Laufzeit verschwindet
    // (Kabel raus, WLAN aus, Sleep-Wake), zeigt der gepatchte Service
    // weiter auf die tote IP. Der in ADR-019 spezifizierte Reconcile-Loop
    // alle 5s ist hier noch NICHT implementiert — siehe Phase 2 ADR-019.
    this.meshIp = getMeshIp(policy);

    // HIGH-FIX (Precommit-Review): Fail-closed wenn allowed_mesh_cidrs
    // explizit gesetzt ist aber kein Interface dazu passt. Silent fallback
    // zu unrestricted Publishing wuerde genau die Cross-Subnet-Leakage
    // wieder einfuehren, die diese ADR-019 verhindern soll.
    const hasCidrPolicy = (policy.allowed_mesh_cidrs ?? []).length > 0;
    if (hasCidrPolicy && !this.meshIp) {
      throw new Error(
        `[discovery] allowed_mesh_cidrs ${JSON.stringify(policy.allowed_mesh_cidrs)} ` +
          `konfiguriert, aber kein lokales Interface passt. ` +
          `Daemon-Start abgebrochen — sonst wuerde mDNS auf ALLEN Interfaces leaken.`,
      );
    }

    const bonjourOpts = this.meshIp ? { interface: this.meshIp } : {};
    this.bonjour = new Bonjour(bonjourOpts as object);

    if (this.meshIp) {
      this.log?.info(
        { meshIp: this.meshIp, allowedCidrs: policy.allowed_mesh_cidrs },
        '[discovery] Interface-Pinning aktiv',
      );
    }
  }

  publish(
    name: string,
    port: number,
    txt: {
      agentId: string;
      p2pPeerId?: string;
      capabilityHash: string;
      certFingerprint: string;
      proto: 'http' | 'https';
    },
  ): void {
    const service = this.bonjour.publish({
      name,
      type: this.serviceType.replace(/^_/, '').replace(/\._tcp$/, ''),
      port,
      txt: {
        'agent-id': txt.agentId,
        'p2p-peer-id': txt.p2pPeerId ?? '',
        'capability-hash': txt.capabilityHash,
        'cert-fingerprint': txt.certFingerprint,
        proto: txt.proto,
      },
      disableIPv6: true,
    });

    // ADR-019 KEY-FIX: bonjour-service.Service.records() iteriert ueber
    // ALLE os.networkInterfaces() und published trotz Interface-Pinning
    // alle IPs in A-Records. Wir patchen records() um nur die Mesh-IP
    // zu published — verhindert dass Peers ueber DMZ/WLAN-IPs entdeckt
    // werden, die weder routbar sind noch von der Mesh-CA gedeckt.
    if (this.meshIp) {
      const hasMatchingARecord = restrictServiceToIp(service, this.meshIp);
      if (!hasMatchingARecord) {
        // LOW-FIX (CR-Review): bonjour generiert keinen A-Record fuer die
        // Mesh-IP — vermutlich weil sie zwischen Inventarisierung und
        // publish() verschwunden ist (Race). Service waere unreachable.
        this.log?.error(
          { meshIp: this.meshIp, name },
          '[discovery] KRITISCH: Mesh-IP nicht in Service-Records — andere Peers koennen nicht zu uns verbinden',
        );
      }
    }

    this.log?.info(
      { name, port, type: this.serviceType, restrictedTo: this.meshIp },
      'mDNS Service publiziert',
    );
  }

  browse(events: DiscoveryEvents): void {
    this.browser = this.bonjour.find(
      { type: this.serviceType.replace(/^_/, '').replace(/\._tcp$/, '') },
      (service: Service) => {
        const txt = service.txt as Record<string, string> | undefined;
        if (!txt?.['agent-id']) return;

        // Bevorzuge IP-Adresse aus mDNS (addresses[]) statt Hostname
        // Hostname allein (z.B. "influxdb") kann ohne DNS nicht aufgeloest werden
        const addresses = (service as unknown as { addresses?: string[] }).addresses;
        const allIpv4 = (addresses ?? []).filter((a: string) =>
          /^\d+\.\d+\.\d+\.\d+$/.test(a),
        );

        // ADR-019 Anti-Leakage: bevorzuge IPs die in einem erlaubten Mesh-CIDR
        // liegen. Wenn keine passt: lehne den Peer ab (statt zu raten und in
        // ein fremdes Subnet zu verbinden).
        const meshIpv4 = allIpv4.find((a) => isPeerIpAllowed(a, this.policy));
        const leakedIpv4 = allIpv4.filter((a) => !isPeerIpAllowed(a, this.policy));

        const hasCidrPolicy = (this.policy.allowed_mesh_cidrs ?? []).length > 0;

        if (allIpv4.length > 0 && !meshIpv4) {
          this.log?.warn(
            { peer: service.name, addresses: allIpv4, allowedCidrs: this.policy.allowed_mesh_cidrs },
            '[discovery] Peer-IPs liegen alle ausserhalb der erlaubten Mesh-CIDRs — ignoriert',
          );
          return;
        }
        if (leakedIpv4.length > 0) {
          this.log?.debug(
            { peer: service.name, accepted: meshIpv4, leaked: leakedIpv4 },
            '[discovery] Peer published IPs aus fremden Subnetzen — nur Mesh-IP wird verwendet',
          );
        }

        // LOW-FIX (CR-Review): Bei aktiver CIDR-Policy und keinem IPv4
        // lieber rejecten als auf service.host (Hostname) zu fallen — der
        // Hostname kann aus einem fremden Subnet stammen und ohne DNS
        // nicht aufgeloest werden. Backward-Compat: kein CIDR-Policy → fallback ok.
        if (hasCidrPolicy && !meshIpv4) {
          this.log?.warn(
            { peer: service.name, host: service.host },
            '[discovery] Kein erlaubtes IPv4 — Hostname-Fallback bei aktiver CIDR-Policy abgelehnt',
          );
          return;
        }
        const resolvedHost = meshIpv4 ?? allIpv4[0] ?? service.host;

        // Endpoint aus host:port ableiten — Protokoll aus TXT lesen (http/https)
        const proto = txt['proto'] === 'https' ? 'https' : 'http';

        // Reject unencrypted peers when TLS is required (HIGH finding)
        if (this.requireTls && proto !== 'https') {
          this.log?.warn(
            { peer: service.name, proto },
            'Peer ohne TLS ignoriert (requireTls aktiv)',
          );
          return;
        }

        const peer: DiscoveredPeer = {
          name: service.name,
          host: resolvedHost,
          port: service.port,
          agentId: txt['agent-id'],
          p2pPeerId: txt['p2p-peer-id'] || undefined,
          capabilityHash: txt['capability-hash'] ?? '',
          certFingerprint: txt['cert-fingerprint'] ?? '',
          endpoint: `${proto}://${resolvedHost}:${service.port}`,
        };

        this.log?.info(
          {
            peer: peer.name,
            host: peer.host,
            port: peer.port,
            originalHost: service.host,
            addresses,
            meshFiltered: leakedIpv4.length > 0,
          },
          'Peer entdeckt',
        );
        events.onPeerFound(peer);
      },
    );
  }

  unpublish(): void {
    this.bonjour.unpublishAll();
    this.log?.info('mDNS Service abgemeldet');
  }

  stop(): void {
    this.browser?.stop();
    this.unpublish();
    this.bonjour.destroy();
  }
}
