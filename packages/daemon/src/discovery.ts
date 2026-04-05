import { Bonjour, type Service, type Browser } from 'bonjour-service';
import type { Logger } from 'pino';

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

  constructor(
    private serviceType: string,
    private log?: Logger,
    private requireTls = false,
  ) {
    this.bonjour = new Bonjour();
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
    this.bonjour.publish({
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
    });

    this.log?.info({ name, port, type: this.serviceType }, 'mDNS Service publiziert');
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
        const ipv4 = addresses?.find((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        const resolvedHost = ipv4 ?? service.host;

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
          { peer: peer.name, host: peer.host, port: peer.port, originalHost: service.host, addresses },
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
