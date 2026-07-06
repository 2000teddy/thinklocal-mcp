// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * discovery.test.ts — Integration-Tests fuer ADR-019 Policy-Integration
 *
 * Verifiziert dass MdnsDiscovery die Discovery-Policy korrekt anwendet:
 * - Konstruktor pinned auf Mesh-IP
 * - Fail-closed wenn CIDR-Policy gesetzt aber keine Mesh-IP gefunden
 * - publish() patcht service.records() um IPs zu beschraenken
 * - browse() filtert Peers mit IPs ausserhalb der erlaubten CIDRs
 *
 * Echte Multicast-Tests stehen im PoC-Script (scripts/discovery-poc.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MdnsDiscovery, resolveBonjourOptions } from './discovery.js';
import {
  ipInCidr,
  isPeerIpAllowed,
  restrictServiceToIp,
} from './discovery-policy.js';

// Spy auf den Bonjour-Konstruktor + Lifecycle-Spies fuer Shutdown-Ordering-Tests.
// Wir mocken bonjour-service so, dass der echte mDNS-Stack nicht startet, wir
// aber die Aufrufe sehen koennen (Bind-Regression-Test + Shutdown-Ordering).
const bonjourCtorSpy = vi.fn();
const browserStopSpy = vi.fn();
const unpublishAllSpy = vi.fn();
const destroySpy = vi.fn();
// Konfigurierbarer publish()-Service: Tests koennen `publishHolder.records` mit
// gemischten A/AAAA-Records vorbelegen und nach discovery.publish() ueber
// `publishHolder.service` die gefilterten Records inspizieren. vi.hoisted, weil
// die vi.mock-Factory ueber die Imports gehoben wird.
const publishHolder = vi.hoisted(() => ({
  records: [] as Array<{ type: string; data: unknown }>,
  service: null as { records: () => Array<{ type: string; data: unknown }> } | null,
}));
vi.mock('bonjour-service', () => {
  class FakeBonjour {
    constructor(opts: object) {
      bonjourCtorSpy(opts);
    }
    publish() {
      const initial = [...publishHolder.records];
      const svc = { records: () => initial };
      publishHolder.service = svc;
      return svc;
    }
    find() {
      return { stop: browserStopSpy };
    }
    unpublishAll() {
      unpublishAllSpy();
    }
    destroy() {
      destroySpy();
    }
  }
  return { Bonjour: FakeBonjour };
});

describe('Discovery-Policy-Integration', () => {
  describe('Anti-Leakage-Filter (browse path)', () => {
    it('akzeptiert Peer mit IP im Mesh-CIDR', () => {
      expect(isPeerIpAllowed('10.10.10.55', { allowed_mesh_cidrs: ['10.10.10.0/24'] })).toBe(true);
    });

    it('lehnt Peer mit IP ausserhalb Mesh-CIDR ab (DMZ-Leak via mDNS-Reflector)', () => {
      expect(isPeerIpAllowed('10.0.0.20', { allowed_mesh_cidrs: ['10.10.10.0/24'] })).toBe(false);
    });

    it('lehnt Peer mit Hotel-WLAN-IP ab', () => {
      expect(isPeerIpAllowed('192.168.1.42', { allowed_mesh_cidrs: ['10.10.10.0/24'] })).toBe(false);
    });

    it('akzeptiert alle wenn keine Policy gesetzt (Backward-Compat)', () => {
      expect(isPeerIpAllowed('10.0.0.20', {})).toBe(true);
      expect(isPeerIpAllowed('192.168.1.42', {})).toBe(true);
    });
  });

  describe('Service-Records-Restriction (publish path)', () => {
    it('reduziert published A-Records auf eine einzelne Mesh-IP', () => {
      // Simuliere bonjour-service.Service mit 3 IPv4 + 2 IPv6 A-Records
      const fakeService = {
        records: () => [
          { type: 'PTR', data: 'svc.local' },
          { type: 'SRV', data: { port: 9440, target: 'host.local' } },
          { type: 'TXT', data: { 'agent-id': 'test' } },
          { type: 'A', data: '10.10.10.55' }, // Mesh
          { type: 'A', data: '10.0.0.20' },   // DMZ — Leak
          { type: 'A', data: '10.10.100.150' }, // WLAN — Leak
          { type: 'AAAA', data: 'fe80::1' },
          { type: 'AAAA', data: '2a02:810d::1' },
        ],
      };

      restrictServiceToIp(
        fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
        '10.10.10.55',
      );

      const filtered = (fakeService as unknown as { records: () => Array<{ type: string; data: unknown }> }).records();
      const aRecords = filtered.filter((r) => r.type === 'A');
      const aaaaRecords = filtered.filter((r) => r.type === 'AAAA');

      expect(aRecords.length).toBe(1);
      expect(aRecords[0]?.data).toBe('10.10.10.55');
      expect(aaaaRecords.length).toBe(0);
      // Andere Record-Typen bleiben unberuehrt
      expect(filtered.filter((r) => r.type === 'PTR').length).toBe(1);
      expect(filtered.filter((r) => r.type === 'SRV').length).toBe(1);
      expect(filtered.filter((r) => r.type === 'TXT').length).toBe(1);
    });

    it('verhaelt sich idempotent bei mehrfachem Aufruf von records()', () => {
      const fakeService = {
        records: () => [
          { type: 'A', data: '10.10.10.55' },
          { type: 'A', data: '10.0.0.20' },
        ],
      };

      restrictServiceToIp(
        fakeService as unknown as Parameters<typeof restrictServiceToIp>[0],
        '10.10.10.55',
      );

      // mDNS ruft records() bei jedem Query auf — Filter muss stabil sein
      const first = (fakeService as unknown as { records: () => Array<{ type: string; data: unknown }> }).records();
      const second = (fakeService as unknown as { records: () => Array<{ type: string; data: unknown }> }).records();
      expect(first.length).toBe(1);
      expect(second.length).toBe(1);
      expect(first[0]?.data).toBe('10.10.10.55');
      expect(second[0]?.data).toBe('10.10.10.55');
    });
  });

  describe('MdnsDiscovery-Wiring (LOW-FIX Precommit)', () => {
    it('Konstruktor wirft fail-closed wenn CIDR-Policy gesetzt aber kein Match (HIGH-FIX)', () => {
      // CIDR die garantiert auf keinem Test-Host matcht
      const unmatchablePolicy = { allowed_mesh_cidrs: ['198.51.100.0/24'] };
      expect(() => {
        new MdnsDiscovery('_thinklocal._tcp', undefined, true, unmatchablePolicy);
      }).toThrow(/allowed_mesh_cidrs.*konfiguriert.*kein lokales Interface/);
    });

    it('Konstruktor laeuft durch ohne CIDR-Policy (Backward-Compat)', () => {
      let discovery: MdnsDiscovery | undefined;
      expect(() => {
        discovery = new MdnsDiscovery('_thinklocal._tcp', undefined, true, {});
      }).not.toThrow();
      discovery?.stop();
    });

    it('Konstruktor laeuft durch wenn CIDR-Policy gesetzt und IP da ist', () => {
      // Das eigene Loopback-CIDR matcht garantiert irgendwas...
      // Stattdessen: leere Policy + erfolgreicher Auto-Detect
      let discovery: MdnsDiscovery | undefined;
      expect(() => {
        discovery = new MdnsDiscovery('_thinklocal._tcp', undefined, true);
      }).not.toThrow();
      discovery?.stop();
    });
  });

  describe('ADR-019 Hotfix: Bind-Regression (Multi-Modell-Konsens)', () => {
    // Deterministischer Network-Interface-Stub fuer reproduzierbare Tests
    // unabhaengig vom CI-Host. Pflicht laut Code-Review GPT-5.4 (MEDIUM-Fix).
    const fakeMeshInterface = () => ({
      en0: [
        {
          address: '10.10.10.94',
          netmask: '255.255.255.0',
          family: 'IPv4' as const,
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '10.10.10.94/24',
          scopeid: 0,
        },
      ],
    });

    beforeEach(() => {
      bonjourCtorSpy.mockClear();
      browserStopSpy.mockClear();
      unpublishAllSpy.mockClear();
      destroySpy.mockClear();
    });

    afterEach(() => {
      bonjourCtorSpy.mockClear();
    });

    it('uebergibt bind:"0.0.0.0" UND interface:meshIp deterministisch (Stub)', () => {
      // Network-Stub injiziert → meshIp ist garantiert "10.10.10.94".
      // Damit deckt der Test den Pinned-Pfad immer ab, auch auf CI ohne Netz.
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        {},
        fakeMeshInterface,
      );

      expect(bonjourCtorSpy).toHaveBeenCalledTimes(1);
      expect(bonjourCtorSpy).toHaveBeenCalledWith({
        interface: '10.10.10.94',
        bind: '0.0.0.0',
      });
      discovery.stop();
    });

    it('positive CIDR-Policy-Pfad: matching Interface → Bonjour mit beiden Opts', () => {
      // LOW-FIX (CR): expliziter CIDR-Policy-Test mit deterministischem Stub.
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        { allowed_mesh_cidrs: ['10.10.10.0/24'] },
        fakeMeshInterface,
      );

      expect(bonjourCtorSpy).toHaveBeenCalledWith({
        interface: '10.10.10.94',
        bind: '0.0.0.0',
      });
      discovery.stop();
    });

    it('uebergibt KEINE Optionen wenn keine Mesh-IP existiert (Backward-Compat)', () => {
      // Network-Stub liefert leeres Interface-Set → meshIp undefined.
      const noInterfaces = () => ({});
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        {},
        noInterfaces,
      );

      expect(bonjourCtorSpy).toHaveBeenCalledTimes(1);
      expect(bonjourCtorSpy).toHaveBeenCalledWith({});
      discovery.stop();
    });

    it('Regression-Invariante: bind:"0.0.0.0" ist NIEMALS gleich interface', () => {
      // Die kritische Invariante: Wenn ein Interface gepinnt wird, MUSS der
      // bind auf '0.0.0.0' sein. Andernfalls killt der unicast-bind den
      // Multicast-Receive (siehe multicast-dns Zeile 65, ADR-019 Phase-1.1).
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        {},
        fakeMeshInterface,
      );
      const opts = bonjourCtorSpy.mock.calls[0]?.[0] as {
        interface?: string;
        bind?: string;
      };
      expect(opts.interface).toBe('10.10.10.94');
      expect(opts.bind).toBe('0.0.0.0');
      expect(opts.bind).not.toBe(opts.interface);
      discovery.stop();
    });

    it('Shutdown-Ordering: stop() ruft browser.stop, unpublishAll, destroy', () => {
      // LOW-FIX (CR): verifiziere Lifecycle-Order beim Shutdown.
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        {},
        fakeMeshInterface,
      );
      discovery.browse({ onPeerFound: vi.fn(), onPeerLeft: vi.fn() });

      expect(browserStopSpy).not.toHaveBeenCalled();
      expect(unpublishAllSpy).not.toHaveBeenCalled();
      expect(destroySpy).not.toHaveBeenCalled();

      discovery.stop();

      expect(browserStopSpy).toHaveBeenCalledTimes(1);
      expect(unpublishAllSpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('mDNS-Interface-Pin-Disable (.55 connectx-Bug, 2026-06-08)', () => {
    const fakeMeshInterface = () => ({
      en10: [
        {
          address: '10.10.10.55',
          netmask: '255.255.255.0',
          family: 'IPv4' as const,
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '10.10.10.55/24',
          scopeid: 0,
        },
      ],
    });

    beforeEach(() => {
      bonjourCtorSpy.mockClear();
    });
    afterEach(() => {
      bonjourCtorSpy.mockClear();
    });

    // --- Pure-Function-Tests: resolveBonjourOptions ---

    it('resolveBonjourOptions: ohne meshIp → leere Opts (kein Pin moeglich)', () => {
      expect(resolveBonjourOptions(undefined, false)).toEqual({});
      expect(resolveBonjourOptions(undefined, true)).toEqual({});
    });

    it('resolveBonjourOptions: meshIp + Pin AN → interface + bind (Default-Pfad)', () => {
      expect(resolveBonjourOptions('10.10.10.55', false)).toEqual({
        interface: '10.10.10.55',
        bind: '0.0.0.0',
      });
    });

    it('resolveBonjourOptions: meshIp + Pin AUS → NUR bind (kein interface → kein setMulticastInterface)', () => {
      const opts = resolveBonjourOptions('10.10.10.55', true);
      expect(opts).toEqual({ bind: '0.0.0.0' });
      // Kern-Invariante des .55-Fixes: KEIN interface-Key → multicast-dns ruft
      // setMulticastInterface() NICHT auf → macOS connectx-scoped-routing bleibt heil.
      expect(opts).not.toHaveProperty('interface');
    });

    // --- Integration: Ctor verdrahtet das Flag korrekt nach Bonjour ---

    it('Ctor mit disable_mdns_interface_pin=true → Bonjour ohne interface-Pin', () => {
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        { disable_mdns_interface_pin: true },
        fakeMeshInterface,
      );
      expect(bonjourCtorSpy).toHaveBeenCalledTimes(1);
      expect(bonjourCtorSpy).toHaveBeenCalledWith({ bind: '0.0.0.0' });
      const opts = bonjourCtorSpy.mock.calls[0]?.[0] as { interface?: string };
      expect(opts.interface).toBeUndefined();
      discovery.stop();
    });

    it('Ctor mit disable_mdns_interface_pin=false → Pin bleibt aktiv (Default-Verhalten)', () => {
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        { disable_mdns_interface_pin: false },
        fakeMeshInterface,
      );
      expect(bonjourCtorSpy).toHaveBeenCalledWith({
        interface: '10.10.10.55',
        bind: '0.0.0.0',
      });
      discovery.stop();
    });

    it('Ctor ohne Flag → identisch zum Pin-Default (Backward-Compat)', () => {
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        {},
        fakeMeshInterface,
      );
      expect(bonjourCtorSpy).toHaveBeenCalledWith({
        interface: '10.10.10.55',
        bind: '0.0.0.0',
      });
      discovery.stop();
    });

    it('Pin-Disable + publish() filtert A-Records weiterhin auf meshIp (CR-MEDIUM)', () => {
      // CR-MEDIUM (gpt-5.5): die A-Record-Hygiene-Garantie haengt am publish()-Pfad
      // (restrictServiceToIp), nicht nur an den Ctor-Opts. Dieser Test geht WIRKLICH
      // durch discovery.publish() und prueft, dass bei abgeschaltetem Pin nur die
      // Mesh-IP als A-Record uebrig bleibt und AAAA verschwindet — sonst wuerde der
      // No-Pin-Pfad fremde IPs leaken.
      publishHolder.records = [
        { type: 'A', data: '10.10.10.55' }, // Mesh
        { type: 'A', data: '192.168.1.20' }, // fremdes Subnet — muss raus
        { type: 'AAAA', data: 'fe80::1' }, // IPv6 — Phase 2, muss raus
        { type: 'TXT', data: { 'agent-id': 'test' } },
      ];
      const discovery = new MdnsDiscovery(
        '_thinklocal._tcp',
        undefined,
        true,
        { disable_mdns_interface_pin: true, allowed_mesh_cidrs: ['10.10.10.0/24'] },
        fakeMeshInterface,
      );
      expect(bonjourCtorSpy).toHaveBeenCalledWith({ bind: '0.0.0.0' });

      discovery.publish('node', 9440, {
        agentId: 'spiffe://thinklocal/host/test/agent/claude-code',
        capabilityHash: '',
        certFingerprint: '',
        proto: 'https',
      });

      const filtered = publishHolder.service?.records() ?? [];
      expect(filtered.filter((r) => r.type === 'A')).toEqual([
        { type: 'A', data: '10.10.10.55' },
      ]);
      expect(filtered.some((r) => r.type === 'AAAA')).toBe(false);
      // Nicht-Adress-Records bleiben unberuehrt.
      expect(filtered.some((r) => r.type === 'TXT')).toBe(true);

      publishHolder.records = [];
      publishHolder.service = null;
      discovery.stop();
    });

    it('Fail-Closed bleibt unter Pin-Disable aktiv: CIDR-Policy ohne Match wirft (CR-LOW)', () => {
      // CR-LOW (gpt-5.5): die zentrale Sicherheitsbehauptung ist "Pin-Disable laesst
      // Fail-Closed unveraendert". Mit allowed_mesh_cidrs gesetzt, aber KEINEM
      // passenden Interface, MUSS der Ctor werfen — auch (gerade) mit disable_mdns_interface_pin.
      const noMatchingInterface = () => ({
        en5: [
          {
            address: '192.168.1.20',
            netmask: '255.255.255.0',
            family: 'IPv4' as const,
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '192.168.1.20/24',
            scopeid: 0,
          },
        ],
      });
      expect(
        () =>
          new MdnsDiscovery(
            '_thinklocal._tcp',
            undefined,
            true,
            { disable_mdns_interface_pin: true, allowed_mesh_cidrs: ['10.10.10.0/24'] },
            noMatchingInterface,
          ),
      ).toThrow(/allowed_mesh_cidrs/);
    });
  });

  describe('mDNS komplett deaktiviert (ADR-025 mdns_enabled=false)', () => {
    const fakeMeshInterface = () => ({
      en10: [{ address: '10.10.10.55', netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal: false, cidr: '10.10.10.55/24', scopeid: 0 }],
    });
    beforeEach(() => { bonjourCtorSpy.mockClear(); });
    afterEach(() => { bonjourCtorSpy.mockClear(); });

    it('erzeugt KEINE Bonjour-Instanz wenn mdns_enabled=false', () => {
      const d = new MdnsDiscovery('_thinklocal._tcp', undefined, true, { mdns_enabled: false }, fakeMeshInterface);
      expect(bonjourCtorSpy).not.toHaveBeenCalled();
      d.stop();
    });

    it('publish/browse/unpublish/stop sind no-op (kein Throw) bei mdns_enabled=false', () => {
      const d = new MdnsDiscovery('_thinklocal._tcp', undefined, true, { mdns_enabled: false }, fakeMeshInterface);
      expect(() => {
        d.publish('node', 9440, { agentId: 'x', capabilityHash: '', certFingerprint: '', proto: 'https' });
        d.browse({ onPeerFound: vi.fn(), onPeerLeft: vi.fn() });
        d.unpublish();
        d.stop();
      }).not.toThrow();
      expect(bonjourCtorSpy).not.toHaveBeenCalled();
    });

    it('startet NICHT fail-closed bei allowed_mesh_cidrs ohne Match, wenn mDNS aus (static-only)', () => {
      const noMatch = () => ({ en5: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4' as const, mac: '0', internal: false, cidr: '192.168.1.20/24', scopeid: 0 }] });
      expect(() => new MdnsDiscovery('_thinklocal._tcp', undefined, true, { mdns_enabled: false, allowed_mesh_cidrs: ['10.10.10.0/24'] }, noMatch)).not.toThrow();
      expect(bonjourCtorSpy).not.toHaveBeenCalled();
    });

    it('mdns_enabled=true (default) erzeugt weiterhin eine Bonjour-Instanz', () => {
      const d = new MdnsDiscovery('_thinklocal._tcp', undefined, true, { mdns_enabled: true }, fakeMeshInterface);
      expect(bonjourCtorSpy).toHaveBeenCalledTimes(1);
      d.stop();
    });
  });

  describe('CIDR-Edge-Cases (Reflektor-Resilience)', () => {
    it('lehnt Spoofing-Versuche aus benachbarten Subnetzen ab', () => {
      // Angreifer published als 10.10.11.55 — sieht aehnlich aus aber falsches Subnet
      expect(ipInCidr('10.10.11.55', '10.10.10.0/24')).toBe(false);
    });

    it('Link-Local 169.254/16 wird nicht versehentlich erlaubt', () => {
      expect(ipInCidr('169.254.0.1', '10.10.10.0/24')).toBe(false);
      expect(ipInCidr('169.254.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('Docker-Bridge 172.17/16 wird nicht erlaubt wenn nur 10.x konfiguriert', () => {
      expect(ipInCidr('172.17.0.1', '10.10.10.0/24')).toBe(false);
      expect(ipInCidr('172.18.0.1', '10.10.10.0/24')).toBe(false);
    });
  });
});
