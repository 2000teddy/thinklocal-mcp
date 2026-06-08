import { networkInterfaces } from 'node:os';
import { Bonjour, type Service, type Browser } from 'bonjour-service';
import type { Logger } from 'pino';
import {
  type DiscoveryPolicyConfig,
  getMeshIp,
  isPeerIpAllowed,
  restrictServiceToIp,
} from './discovery-policy.js';

// Test-Hook: erlaubt Stubbing von os.networkInterfaces() ohne globalen vi.spyOn.
// In Production undefined → discovery-policy.ts nimmt den Default (os).
type NetworkInterfacesSource = () => ReturnType<typeof networkInterfaces>;

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

/**
 * Bestimmt die bonjour-service-Optionen (rein, testbar). Ohne meshIp: Default (kein Pin).
 * Mit meshIp + Pin: `{ interface, bind:'0.0.0.0' }` (Outbound auf das Mesh-NIC, Receive auf
 * allen). `disableInterfacePin` (dual-homed macOS, .55-Bug): KEIN `interface` → multicast-dns
 * ruft kein setMulticastInterface auf → vergiftet macOS connectx-scoped-routing NICHT;
 * `bind:'0.0.0.0'` bleibt für Receive. A-Record-Hygiene läuft separat über meshIp.
 */
export function resolveBonjourOptions(
  meshIp: string | undefined,
  disableInterfacePin: boolean,
): Record<string, unknown> {
  if (!meshIp) return {};
  if (disableInterfacePin) return { bind: '0.0.0.0' };
  return { interface: meshIp, bind: '0.0.0.0' };
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
    networkInterfacesSource?: NetworkInterfacesSource,
  ) {
    // ADR-019: explizites Interface-Pinning fuer den mDNS-Socket
    // (steuert auf welchem Interface Multicast versendet wird).
    //
    // LIMITATION (CR-Review MEDIUM, Phase 2): meshIp wird nur EINMAL beim
    // Start berechnet. Wenn das Mesh-Interface zur Laufzeit verschwindet
    // (Kabel raus, WLAN aus, Sleep-Wake), zeigt der gepatchte Service
    // weiter auf die tote IP. Der in ADR-019 spezifizierte Reconcile-Loop
    // alle 5s ist hier noch NICHT implementiert — siehe Phase 2 ADR-019.
    this.meshIp = getMeshIp(policy, networkInterfacesSource);

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

    // ADR-019 Hotfix (Konsens GPT-5.4 + GPT-5.1-Codex + Gemini-3-Pro):
    // {interface} ohne {bind} laesst multicast-dns den UDP-Socket auf die
    // unicast-IP binden (`socket.bind(5353, '10.10.10.94', ...)`). Damit
    // werden Multicast-Pakete an 224.0.0.251 vom Kernel nicht mehr an den
    // Socket geliefert — wir senden raus, empfangen aber nichts.
    // Gegenmittel: bind: '0.0.0.0' fuer Receive (multicast-dns Zeile 65),
    // interface: meshIp bleibt fuer setMulticastInterface() = Outbound auf das richtige NIC.
    //
    // BUG (.55, dual-homed macOS, 2026-06-08): das `interface`-Pinning ruft
    // setMulticastInterface(meshIp) auf dem mDNS-Socket → vergiftet auf macOS den
    // connectx-scoped-routing-Zustand PROZESSWEIT (10.10.10/24 wird zur REJECT-Route,
    // EHOSTUNREACH für ALLE ausgehenden Connects, auch plain `node net.connect`).
    // `disable_mdns_interface_pin` schaltet NUR den Socket-Interface-Pin ab (kein
    // setMulticastInterface) — die A-Record-Hygiene (restrictServiceToIp, unten) bleibt
    // erhalten. Outbound-mDNS geht dann über das Default-IF; Mesh-Konnektivität via
    // static_peer. Default false (Linux/Standard-Nodes pinnen wie bisher).
    const disablePin = policy.disable_mdns_interface_pin === true;
    const bonjourOpts = resolveBonjourOptions(this.meshIp, disablePin);
    this.bonjour = new Bonjour(bonjourOpts as object);

    if (this.meshIp && disablePin) {
      this.log?.warn(
        { meshIp: this.meshIp, bind: '0.0.0.0' },
        '[discovery] mDNS-Interface-Pin DEAKTIVIERT (dual-homed-macOS-Workaround) — Outbound-mDNS via Default-IF, Mesh via static_peer; A-Record-Hygiene bleibt aktiv',
      );
    } else if (this.meshIp) {
      this.log?.info(
        { meshIp: this.meshIp, bind: '0.0.0.0', allowedCidrs: policy.allowed_mesh_cidrs },
        '[discovery] Interface-Pinning aktiv (outbound), receive auf 0.0.0.0',
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
