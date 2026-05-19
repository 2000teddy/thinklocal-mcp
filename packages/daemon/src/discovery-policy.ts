/**
 * discovery-policy.ts — ADR-019 Multi-Interface Discovery Policy
 *
 * Bei Multi-Homed Hosts (mehrere NICs in verschiedenen Subnetzen) waehlt
 * bonjour-service standardmaessig ein "falsches" Interface und published
 * trotzdem alle lokalen IPs in den A-Records. Dieses Modul:
 *
 * 1. Inventarisiert aktive IPv4-Interfaces
 * 2. Filtert nach erlaubten Mesh-CIDRs (z.B. 10.10.10.0/24)
 * 3. Schliesst virtuelle Interfaces (docker/tailscale/utun/veth/bridge) aus
 * 4. Liefert die Mesh-IP fuer Service-Publishing
 * 5. Bietet Helper zur Patch von bonjour-service Service.records()
 * 6. Validiert empfangene Peer-IPs gegen erlaubte CIDRs (Anti-Leakage)
 *
 * Siehe docs/architecture/ADR-019-multi-interface-discovery.md.
 */

import { networkInterfaces } from 'node:os';
import type { Service } from 'bonjour-service';

export interface MeshInterface {
  name: string;
  address: string;
  cidr: string;
  netmask: string;
}

export interface DiscoveryPolicyConfig {
  /**
   * Erlaubte Mesh-CIDRs. Nur Interfaces deren IP in einem dieser CIDRs
   * liegt werden fuer Discovery verwendet. Leerer Array = auto-detect
   * (alle nicht-virtuellen Interfaces erlauben).
   */
  allowed_mesh_cidrs?: string[];

  /**
   * Glob-Patterns fuer Interface-Namen die ausgeschlossen werden sollen.
   * Default schliesst typische virtuelle Interfaces aus.
   */
  exclude_interface_patterns?: string[];
}

export const DEFAULT_EXCLUDE_PATTERNS = [
  'docker*',
  'tailscale*',
  'utun*',
  'veth*',
  'bridge*',
  'br-*',
  'tun*',
  'tap*',
  'awdl*',
  'llw*',
  'anpi*',
  'ap*',
  'gif*',
  'stf*',
  'lo*',
];

/**
 * Prueft ob eine IPv4-Adresse in einem CIDR-Range liegt.
 * Nur IPv4 — IPv6 ist Phase 2 (siehe ADR-019).
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  if (!base || !prefixStr) return false;
  // MEDIUM-FIX (CR-Review): Strikte Validierung. parseInt('24xyz') = 24
  // wuerde sonst manipulierte CIDRs durchgehen lassen.
  if (!/^\d{1,2}$/.test(prefixStr)) return false;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) return false;

  const ipNum = ipv4ToNum(ip);
  const baseNum = ipv4ToNum(base);
  if (ipNum === null || baseNum === null) return false;

  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    // MEDIUM-FIX (CR-Review): Strikte Validierung gegen parseInt-Eigenheit.
    // parseInt('10abc') = 10 wuerde sonst '10abc.10.10.55' als gueltige
    // IP akzeptieren. Wir verlangen exakt 1-3 Ziffern, keine Sonderzeichen.
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    num = (num * 256 + n) >>> 0;
  }
  return num;
}

/**
 * Glob-style match (nur '*' am Ende oder Anfang, kein vollwertiges Regex).
 * Beispiele: "docker*" matcht "docker0", "*0" matcht "en0".
 */
export function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === name) return true;
  if (pattern.endsWith('*') && !pattern.startsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith('*') && !pattern.endsWith('*')) {
    return name.endsWith(pattern.slice(1));
  }
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    return name.includes(pattern.slice(1, -1));
  }
  return false;
}

/**
 * Inventarisiert alle aktiven IPv4-Interfaces des Hosts (ohne Loopback).
 * Optional kann eine Test-Quelle uebergeben werden statt os.networkInterfaces().
 */
export function listActiveIPv4Interfaces(
  source: () => ReturnType<typeof networkInterfaces> = networkInterfaces,
): MeshInterface[] {
  const all = source();
  const result: MeshInterface[] = [];
  for (const [name, addrs] of Object.entries(all)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        result.push({ name, address: a.address, cidr: a.cidr ?? '', netmask: a.netmask });
      }
    }
  }
  return result;
}

/**
 * Waehlt die Mesh-tauglichen Interfaces aus.
 *
 * Auswahllogik:
 * 1. Falls allowed_mesh_cidrs gesetzt: filtere Interfaces deren IP in einem
 *    der CIDRs liegt
 * 2. Falls leer: nimm alle Interfaces die nicht in exclude_patterns matchen
 * 3. Wende exclude_patterns auf alle Kandidaten an
 */
export function selectMeshInterfaces(
  config: DiscoveryPolicyConfig = {},
  source: () => ReturnType<typeof networkInterfaces> = networkInterfaces,
): MeshInterface[] {
  const all = listActiveIPv4Interfaces(source);
  // HIGH-FIX (CR-Review #1): Leeres Array darf NICHT die Defaults aushebeln.
  // MEDIUM-FIX (Precommit-Review): User-Patterns ERWEITERN Defaults statt sie
  // zu ersetzen. Ein User der `["myVpn0"]` setzt soll Docker/utun NICHT verlieren.
  // De-Dup damit doppelte Patterns nicht schaden.
  const userExcludes = config.exclude_interface_patterns ?? [];
  const excludePatterns = Array.from(new Set([...DEFAULT_EXCLUDE_PATTERNS, ...userExcludes]));
  const allowedCidrs = config.allowed_mesh_cidrs ?? [];

  return all.filter((iface) => {
    // Exclude virtual / unerwuenschte Interfaces
    for (const pattern of excludePatterns) {
      if (matchesPattern(iface.name, pattern)) return false;
    }

    // Wenn CIDRs gesetzt: nur passende erlauben
    if (allowedCidrs.length > 0) {
      return allowedCidrs.some((cidr) => ipInCidr(iface.address, cidr));
    }

    return true;
  });
}

/**
 * Liefert die Mesh-IP fuer Service-Publishing.
 * Bei mehreren passenden: nimmt die erste (deterministisch nach Interface-Name).
 * Liefert undefined wenn keine passende IP gefunden.
 */
export function getMeshIp(
  config: DiscoveryPolicyConfig = {},
  source: () => ReturnType<typeof networkInterfaces> = networkInterfaces,
): string | undefined {
  const ifaces = selectMeshInterfaces(config, source).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return ifaces[0]?.address;
}

/**
 * Validiert ob eine empfangene Peer-IP zu einem erlaubten Mesh-CIDR gehoert.
 * Bei leerer allowed_mesh_cidrs Liste werden alle IPs akzeptiert.
 *
 * Anti-Leakage-Schutz: Wenn ein mDNS-Reflector (Fritzbox/Avahi) Peers
 * aus einem fremden Subnet spiegelt, lehnen wir sie ab.
 */
export function isPeerIpAllowed(
  ip: string,
  config: DiscoveryPolicyConfig = {},
): boolean {
  const cidrs = config.allowed_mesh_cidrs ?? [];
  if (cidrs.length === 0) return true;
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Patcht service.records() so dass nur A-Records mit der gewuenschten
 * Mesh-IP und keine AAAA-Records mehr published werden.
 *
 * Hintergrund: bonjour-service.Service.records() iteriert ueber
 * os.networkInterfaces() und published ALLE IPs — egal was im
 * Bonjour-Konstruktor steht. Das fuehrt dazu dass Peers ueber IPs
 * aus fremden Subnetzen (DMZ, Hotel-WLAN) entdeckt werden, die
 * weder routbar sind noch von der Mesh-CA gedeckt sind.
 *
 * Diese Funktion uebernimmt der Service-Instanz die records()-Methode
 * und filtert auf nur die erlaubte IP.
 */
/**
 * Liefert true wenn nach dem Patch mindestens ein A-Record fuer allowedIp
 * vorhanden ist. false wenn der Service ohne passenden A-Record bleibt
 * (Caller sollte dann warnen oder publish abbrechen).
 */
export function restrictServiceToIp(service: Service, allowedIp: string): boolean {
  // Service ist eine fremde Klasse — wir patchen via duck-typing.
  const svc = service as unknown as {
    records: () => Array<{ type: string; data: unknown }>;
    __thinklocalRestrictedTo?: string;
  };

  // LOW-FIX (CR-Review): Idempotenz — bei mehrfachem Aufruf nicht erneut wrappen.
  if (svc.__thinklocalRestrictedTo === allowedIp) {
    return svc.records().some((r) => r.type === 'A' && r.data === allowedIp);
  }
  if (svc.__thinklocalRestrictedTo !== undefined) {
    // Bereits anders gepatcht — restore origRecords nicht moeglich, also abort
    throw new Error(
      `Service bereits auf '${svc.__thinklocalRestrictedTo}' beschraenkt; Re-Patch auf '${allowedIp}' nicht erlaubt`,
    );
  }

  const origRecords = svc.records.bind(svc);
  svc.records = function () {
    const all = origRecords();
    return all.filter((r) => {
      if (r.type === 'A') return r.data === allowedIp;
      if (r.type === 'AAAA') return false; // IPv6 Phase 2
      return true;
    });
  };
  svc.__thinklocalRestrictedTo = allowedIp;

  // Verifiziere dass der Service ueberhaupt einen passenden A-Record hat.
  return svc.records().some((r) => r.type === 'A' && r.data === allowedIp);
}
