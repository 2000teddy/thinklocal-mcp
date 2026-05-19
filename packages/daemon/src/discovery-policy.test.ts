/**
 * discovery-policy.test.ts — Unit-Tests fuer ADR-019 Multi-Interface Policy
 */
import { describe, it, expect, beforeEach } from 'vitest';

import type { networkInterfaces as NetworkInterfacesFn } from 'node:os';
import {
  ipInCidr,
  matchesPattern,
  selectMeshInterfaces,
  getMeshIp,
  isPeerIpAllowed,
  restrictServiceToIp,
  DEFAULT_EXCLUDE_PATTERNS,
} from './discovery-policy.js';

type NetworkInterfacesReturn = ReturnType<typeof NetworkInterfacesFn>;

describe('ipInCidr', () => {
  it('matcht IP innerhalb /24', () => {
    expect(ipInCidr('10.10.10.55', '10.10.10.0/24')).toBe(true);
    expect(ipInCidr('10.10.10.1', '10.10.10.0/24')).toBe(true);
    expect(ipInCidr('10.10.10.255', '10.10.10.0/24')).toBe(true);
  });

  it('lehnt IP ausserhalb /24 ab', () => {
    expect(ipInCidr('10.10.11.1', '10.10.10.0/24')).toBe(false);
    expect(ipInCidr('10.0.0.20', '10.10.10.0/24')).toBe(false);
    expect(ipInCidr('192.168.1.1', '10.10.10.0/24')).toBe(false);
  });

  it('unterstuetzt /32 (Single-Host)', () => {
    expect(ipInCidr('10.10.10.55', '10.10.10.55/32')).toBe(true);
    expect(ipInCidr('10.10.10.56', '10.10.10.55/32')).toBe(false);
  });

  it('unterstuetzt /0 (alle)', () => {
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '0.0.0.0/0')).toBe(true);
  });

  it('unterstuetzt /16', () => {
    expect(ipInCidr('10.10.99.55', '10.10.0.0/16')).toBe(true);
    expect(ipInCidr('10.11.0.1', '10.10.0.0/16')).toBe(false);
  });

  it('lehnt ungueltige CIDR ab', () => {
    expect(ipInCidr('10.10.10.55', 'invalid')).toBe(false);
    expect(ipInCidr('10.10.10.55', '10.10.10.0/99')).toBe(false);
    expect(ipInCidr('10.10.10.55', '10.10.10.0/-1')).toBe(false);
  });

  it('lehnt ungueltige IP ab', () => {
    expect(ipInCidr('not-an-ip', '10.10.10.0/24')).toBe(false);
    expect(ipInCidr('10.10.10.999', '10.10.10.0/24')).toBe(false);
    expect(ipInCidr('10.10.10', '10.10.10.0/24')).toBe(false);
  });
});

describe('matchesPattern', () => {
  it('matcht prefix mit *', () => {
    expect(matchesPattern('docker0', 'docker*')).toBe(true);
    expect(matchesPattern('docker', 'docker*')).toBe(true);
    expect(matchesPattern('en0', 'docker*')).toBe(false);
  });

  it('matcht suffix mit *', () => {
    expect(matchesPattern('en0', '*0')).toBe(true);
    expect(matchesPattern('en1', '*0')).toBe(false);
  });

  it('matcht enthalten mit *...*', () => {
    expect(matchesPattern('br-1234', '*br*')).toBe(true);
    expect(matchesPattern('en0', '*br*')).toBe(false);
  });

  it('matcht exact ohne *', () => {
    expect(matchesPattern('lo', 'lo')).toBe(true);
    expect(matchesPattern('lo0', 'lo')).toBe(false);
  });

  it('schliesst Docker und VPN durch Defaults aus', () => {
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('docker0', p))).toBe(true);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('utun4', p))).toBe(true);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('tailscale0', p))).toBe(true);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('br-1234abcd', p))).toBe(true);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('veth0', p))).toBe(true);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('awdl0', p))).toBe(true);
  });

  it('laesst echte NICs durch', () => {
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('en0', p))).toBe(false);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('en10', p))).toBe(false);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('eth0', p))).toBe(false);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('ens18', p))).toBe(false);
    expect(DEFAULT_EXCLUDE_PATTERNS.some((p) => matchesPattern('wlan0', p))).toBe(false);
  });
});

describe('selectMeshInterfaces', () => {
  let mockSource: () => NetworkInterfacesReturn;

  beforeEach(() => {
    mockSource = () =>
      ({
        lo0: [
          { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
        ],
        en10: [
          { address: '10.10.10.55', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '10.10.10.55/24' },
        ],
        en8: [
          { address: '10.0.0.20', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:00', internal: false, cidr: '10.0.0.20/24' },
        ],
        en0: [
          { address: '10.10.100.150', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:01', internal: false, cidr: '10.10.100.150/24' },
        ],
        docker0: [
          { address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:02', internal: false, cidr: '172.17.0.1/16' },
        ],
        utun4: [
          { address: '100.64.0.1', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '100.64.0.1/24' },
        ],
      }) as unknown as NetworkInterfacesReturn;
  });

  it('schliesst Loopback und virtuelle Interfaces standardmaessig aus', () => {
    const ifaces = selectMeshInterfaces({}, mockSource);
    const names = ifaces.map((i) => i.name);
    expect(names).not.toContain('lo0');
    expect(names).not.toContain('docker0');
    expect(names).not.toContain('utun4');
  });

  it('liefert alle echten Interfaces wenn keine CIDR-Policy gesetzt', () => {
    const ifaces = selectMeshInterfaces({}, mockSource);
    const names = ifaces.map((i) => i.name).sort();
    expect(names).toEqual(['en0', 'en10', 'en8']);
  });

  it('filtert auf allowed_mesh_cidrs', () => {
    const ifaces = selectMeshInterfaces({ allowed_mesh_cidrs: ['10.10.10.0/24'] }, mockSource);
    expect(ifaces.length).toBe(1);
    expect(ifaces[0]?.address).toBe('10.10.10.55');
  });

  it('schliesst auch via allowed_mesh_cidrs DMZ aus', () => {
    const ifaces = selectMeshInterfaces({ allowed_mesh_cidrs: ['10.10.10.0/24'] }, mockSource);
    expect(ifaces.map((i) => i.address)).not.toContain('10.0.0.20');
    expect(ifaces.map((i) => i.address)).not.toContain('10.10.100.150');
  });

  it('respektiert custom exclude_interface_patterns (additiv zu Defaults)', () => {
    const ifaces = selectMeshInterfaces({ exclude_interface_patterns: ['en8'] }, mockSource);
    const names = ifaces.map((i) => i.name);
    expect(names).not.toContain('en8');
    expect(names).toContain('en10');
  });

  it('akzeptiert mehrere allowed_mesh_cidrs', () => {
    const ifaces = selectMeshInterfaces(
      { allowed_mesh_cidrs: ['10.10.10.0/24', '10.0.0.0/24'] },
      mockSource,
    );
    expect(ifaces.length).toBe(2);
    const addrs = ifaces.map((i) => i.address).sort();
    expect(addrs).toEqual(['10.0.0.20', '10.10.10.55']);
  });
});

describe('getMeshIp', () => {
  let mockSource: () => NetworkInterfacesReturn;

  beforeEach(() => {
    mockSource = () =>
      ({
        en10: [
          { address: '10.10.10.55', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '10.10.10.55/24' },
        ],
        en8: [
          { address: '10.0.0.20', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:00', internal: false, cidr: '10.0.0.20/24' },
        ],
      }) as unknown as NetworkInterfacesReturn;
  });

  it('liefert IP aus allowed_mesh_cidrs', () => {
    expect(getMeshIp({ allowed_mesh_cidrs: ['10.10.10.0/24'] }, mockSource)).toBe('10.10.10.55');
  });

  it('liefert deterministisch (string-sortierter Interface-Name) bei mehreren passenden', () => {
    // localeCompare: "en10" kommt VOR "en8" (zeichenweise: 1 < 8)
    expect(
      getMeshIp({ allowed_mesh_cidrs: ['10.10.10.0/24', '10.0.0.0/24'] }, mockSource),
    ).toBe('10.10.10.55');
  });

  it('liefert undefined wenn kein Interface passt', () => {
    expect(getMeshIp({ allowed_mesh_cidrs: ['192.168.99.0/24'] }, mockSource)).toBeUndefined();
  });
});

describe('isPeerIpAllowed', () => {
  it('erlaubt alle IPs wenn keine CIDR-Policy gesetzt', () => {
    expect(isPeerIpAllowed('1.2.3.4', {})).toBe(true);
    expect(isPeerIpAllowed('10.10.10.55', {})).toBe(true);
  });

  it('erlaubt nur IPs in allowed_mesh_cidrs', () => {
    const cfg = { allowed_mesh_cidrs: ['10.10.10.0/24'] };
    expect(isPeerIpAllowed('10.10.10.55', cfg)).toBe(true);
    expect(isPeerIpAllowed('10.0.0.20', cfg)).toBe(false);
    expect(isPeerIpAllowed('192.168.1.1', cfg)).toBe(false);
  });

  it('akzeptiert mehrere CIDRs', () => {
    const cfg = { allowed_mesh_cidrs: ['10.10.10.0/24', '192.168.1.0/24'] };
    expect(isPeerIpAllowed('10.10.10.55', cfg)).toBe(true);
    expect(isPeerIpAllowed('192.168.1.100', cfg)).toBe(true);
    expect(isPeerIpAllowed('10.0.0.20', cfg)).toBe(false);
  });
});

describe('Regression: CR-Review-Fixes', () => {
  describe('HIGH: Empty exclude_interface_patterns muss Defaults nutzen', () => {
    const mockSource = (): ReturnType<typeof NetworkInterfacesFn> =>
      ({
        en10: [
          { address: '10.10.10.55', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb', internal: false, cidr: '10.10.10.55/24' },
        ],
        docker0: [
          { address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: 'cc:dd', internal: false, cidr: '172.17.0.1/16' },
        ],
        utun4: [
          { address: '100.64.0.1', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '100.64.0.1/24' },
        ],
      }) as unknown as NetworkInterfacesReturn;

    it('schliesst Docker/VPN auch bei exclude_interface_patterns=[] aus (HIGH-FIX)', () => {
      const ifaces = selectMeshInterfaces({ exclude_interface_patterns: [] }, mockSource);
      const names = ifaces.map((i) => i.name);
      expect(names).not.toContain('docker0');
      expect(names).not.toContain('utun4');
      expect(names).toContain('en10');
    });

    it('schliesst Docker/VPN auch bei exclude_interface_patterns=undefined aus', () => {
      const ifaces = selectMeshInterfaces({}, mockSource);
      const names = ifaces.map((i) => i.name);
      expect(names).not.toContain('docker0');
      expect(names).not.toContain('utun4');
    });

    it('Defaults und User-Excludes werden gemerged (MEDIUM-FIX Precommit)', () => {
      // User fuegt en10 hinzu — Docker/utun MUESSEN trotzdem ausgeschlossen bleiben
      const ifaces = selectMeshInterfaces({ exclude_interface_patterns: ['en10'] }, mockSource);
      const names = ifaces.map((i) => i.name);
      expect(names).not.toContain('en10');
      expect(names).not.toContain('docker0');
      expect(names).not.toContain('utun4');
    });
  });

  describe('MEDIUM: parseInt-Spoofing in ipv4ToNum / ipInCidr', () => {
    it('lehnt IPs mit Buchstaben im Oktett ab', () => {
      expect(ipInCidr('10abc.10.10.55', '10.10.10.0/24')).toBe(false);
      expect(ipInCidr('10.10.10.55abc', '10.10.10.0/24')).toBe(false);
      expect(ipInCidr('10.5e1.10.55', '10.10.10.0/24')).toBe(false);
    });

    it('lehnt IPs mit Dezimalpunkten im Oktett ab', () => {
      expect(ipInCidr('1.5.10.10.55', '10.10.10.0/24')).toBe(false);
      expect(ipInCidr('10.10.10.55.99', '10.10.10.0/24')).toBe(false);
    });

    it('lehnt CIDR mit Buchstaben im Prefix ab', () => {
      expect(ipInCidr('10.10.10.55', '10.10.10.0/24xyz')).toBe(false);
      expect(ipInCidr('10.10.10.55', '10.10.10.0/2a')).toBe(false);
    });

    it('lehnt CIDR mit Dezimalpunkt im Prefix ab', () => {
      expect(ipInCidr('10.10.10.55', '10.10.10.0/24.5')).toBe(false);
      expect(ipInCidr('10.10.10.55', '10.10.10.0/1.5')).toBe(false);
    });

    it('akzeptiert weiterhin korrekte IPs und CIDRs', () => {
      expect(ipInCidr('10.10.10.55', '10.10.10.0/24')).toBe(true);
      expect(ipInCidr('192.168.1.1', '192.168.0.0/16')).toBe(true);
    });
  });
});

describe('restrictServiceToIp', () => {
  it('filtert A-Records auf gewuenschte IP', () => {
    const records = [
      { type: 'PTR', data: 'something' },
      { type: 'SRV', data: { port: 9440 } },
      { type: 'TXT', data: { key: 'value' } },
      { type: 'A', data: '10.0.0.20' },
      { type: 'A', data: '10.10.10.55' },
      { type: 'A', data: '10.10.100.150' },
      { type: 'AAAA', data: 'fe80::1' },
      { type: 'AAAA', data: '2a02:810d:9d:7a00::1' },
    ];
    const fakeService = {
      records: () => records,
    };

    const ok = restrictServiceToIp(
      fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
      '10.10.10.55',
    );
    expect(ok).toBe(true);

    const filtered = (fakeService as unknown as { records: () => typeof records }).records();
    expect(filtered.filter((r) => r.type === 'A').length).toBe(1);
    expect(filtered.find((r) => r.type === 'A')?.data).toBe('10.10.10.55');
    expect(filtered.filter((r) => r.type === 'AAAA').length).toBe(0);
    expect(filtered.filter((r) => r.type === 'PTR').length).toBe(1);
    expect(filtered.filter((r) => r.type === 'SRV').length).toBe(1);
    expect(filtered.filter((r) => r.type === 'TXT').length).toBe(1);
  });

  it('liefert false wenn Mesh-IP nicht in records ist (LOW-FIX warn-signal)', () => {
    const records = [
      { type: 'A', data: '10.0.0.20' },
      { type: 'A', data: '10.10.100.150' },
    ];
    const fakeService = {
      records: () => records,
    };
    const ok = restrictServiceToIp(
      fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
      '10.10.10.55',
    );
    expect(ok).toBe(false);
    const filtered = (fakeService as unknown as { records: () => typeof records }).records();
    expect(filtered.length).toBe(0);
  });

  it('ist idempotent bei mehrfachem Aufruf mit gleicher IP (LOW-FIX)', () => {
    const records = [
      { type: 'A', data: '10.10.10.55' },
      { type: 'A', data: '10.0.0.20' },
    ];
    const fakeService = {
      records: () => records,
    };
    const first = restrictServiceToIp(
      fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
      '10.10.10.55',
    );
    const second = restrictServiceToIp(
      fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
      '10.10.10.55',
    );
    expect(first).toBe(true);
    expect(second).toBe(true);
    const filtered = (fakeService as unknown as { records: () => typeof records }).records();
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.data).toBe('10.10.10.55');
  });

  it('wirft bei Re-Patch auf andere IP (LOW-FIX safety)', () => {
    const records = [
      { type: 'A', data: '10.10.10.55' },
      { type: 'A', data: '10.0.0.20' },
    ];
    const fakeService = {
      records: () => records,
    };
    restrictServiceToIp(
      fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
      '10.10.10.55',
    );
    expect(() =>
      restrictServiceToIp(
        fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
        '10.0.0.20',
      ),
    ).toThrow(/bereits.*10\.10\.10\.55/);
  });
});
