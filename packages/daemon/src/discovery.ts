import { Bonjour, type Service, type Browser } from 'bonjour-service';
import type { Logger } from 'pino';

export interface DiscoveredPeer {
  name: string;
  host: string;
  port: number;
  agentId: string;
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
  ) {
    this.bonjour = new Bonjour();
  }

  publish(
    name: string,
    port: number,
    txt: { agentId: string; capabilityHash: string; certFingerprint: string; endpoint: string },
  ): void {
    this.bonjour.publish({
      name,
      type: this.serviceType.replace(/^_/, '').replace(/\._tcp$/, ''),
      port,
      txt: {
        'agent-id': txt.agentId,
        'capability-hash': txt.capabilityHash,
        'cert-fingerprint': txt.certFingerprint,
        endpoint: txt.endpoint,
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

        // Endpoint immer aus host:port ableiten — TXT-endpoint nicht blind vertrauen
        const peer: DiscoveredPeer = {
          name: service.name,
          host: service.host,
          port: service.port,
          agentId: txt['agent-id'],
          capabilityHash: txt['capability-hash'] ?? '',
          certFingerprint: txt['cert-fingerprint'] ?? '',
          endpoint: `http://${service.host}:${service.port}`,
        };

        this.log?.info({ peer: peer.name, host: peer.host, port: peer.port }, 'Peer entdeckt');
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
