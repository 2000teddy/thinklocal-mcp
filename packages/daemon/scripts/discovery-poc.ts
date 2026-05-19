/**
 * discovery-poc.ts — ADR-019 Proof-of-Concept
 *
 * Testet ob bonjour-service tatsaechlich interface-spezifisch published.
 *
 * Modi:
 *   publish   — startet nur den Publisher (Service annonciert)
 *   browse    — startet nur den Browser (entdeckt Services)
 *   both      — startet beide im selben Prozess (NICHT empfohlen, Multicast-Loopback Issues)
 *
 * Optionen:
 *   --pin              Bonjour mit { interface: meshIp }
 *   --no-pin           Bonjour ohne Interface-Option
 *   --mesh-ip <ip>     explizit zu verwendende IP (default: erste 10.10.10.x)
 *   --service-type <t> mDNS-Service-Type (default: adr019-poc)
 *   --duration <sec>   wie lange laufen (default: 15s publish, 10s browse)
 *
 * Beispiele:
 *
 *   # Terminal A — Publisher mit Pinning
 *   npx tsx scripts/discovery-poc.ts publish --pin
 *
 *   # Terminal B — Browser
 *   npx tsx scripts/discovery-poc.ts browse
 *
 *   # Cross-host: Publisher auf MacBook, Browser auf minimac
 *   ssh chris@10.10.10.55 'cd ~/Entwicklung_local/thinklocal-mcp/packages/daemon && npx tsx scripts/discovery-poc.ts publish --pin'
 *   npx tsx scripts/discovery-poc.ts browse
 *
 * Erfolgskriterium:
 *   - Browser zeigt published Service mit addresses = [meshIp] (nur einer)
 *   - Bei --no-pin: addresses enthaelt ALLE lokalen IPs des Publishers
 */

import { Bonjour } from 'bonjour-service';
import { networkInterfaces, hostname } from 'node:os';

type Iface = { name: string; address: string; cidr: string; netmask: string };

function listActiveIPv4Interfaces(): Iface[] {
  const all = networkInterfaces();
  const result: Iface[] = [];
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

type Mode = 'publish' | 'browse' | 'both';

interface Args {
  mode: Mode;
  pin: boolean;
  meshIp?: string;
  serviceType: string;
  duration: number;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const positional = raw.filter(a => !a.startsWith('--'));
  const mode = (positional[0] ?? 'both') as Mode;

  let pin = true;
  let meshIp: string | undefined;
  let serviceType = 'adr019-poc';
  let duration = mode === 'browse' ? 10 : 15;

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--no-pin') pin = false;
    else if (a === '--pin') pin = true;
    else if (a === '--mesh-ip') meshIp = raw[++i];
    else if (a === '--service-type') serviceType = raw[++i];
    else if (a === '--duration') duration = parseInt(raw[++i] ?? '15', 10);
  }

  return { mode, pin, meshIp, serviceType, duration };
}

function selectMeshIp(interfaces: Iface[], explicit?: string): string {
  if (explicit) return explicit;
  const tenTen = interfaces.find(i => i.address.startsWith('10.10.10.'));
  if (tenTen) return tenTen.address;
  return interfaces[0]?.address ?? '127.0.0.1';
}

async function runPublisher(args: Args, meshIp: string): Promise<Bonjour> {
  const bonjourOpts = args.pin ? { interface: meshIp } : {};
  console.log(`[publisher] Bonjour-Optionen: ${JSON.stringify(bonjourOpts)}`);

  const bonjour = new Bonjour(bonjourOpts as object);
  const serviceName = `adr019-poc-${process.pid}`;
  const service = bonjour.publish({
    name: serviceName,
    type: args.serviceType,
    port: 9999,
    txt: {
      test: 'interface-pinning',
      meshIp,
      mode: args.pin ? 'pin' : 'no-pin',
      pid: String(process.pid),
      hostname: hostname(),
    },
    disableIPv6: true,
  });

  // KEY-INSIGHT: bonjour-service.Service.records() iteriert ueber alle
  // os.networkInterfaces() und ignoriert die `interface`-Option komplett.
  // Wir muessen records() monkey-patchen um A-Records zu filtern.
  if (args.pin) {
    const origRecords = (service as any).records.bind(service);
    (service as any).records = function() {
      const all = origRecords();
      return all.filter((r: any) => {
        if (r.type === 'A') return r.data === meshIp;
        if (r.type === 'AAAA') return false;
        return true;
      });
    };
    console.log(`[publisher] ✓ records() monkey-patched: nur A=${meshIp} wird published`);
  }

  service.on('up', () => {
    console.log(`[publisher] ✓ Service "up" — FQDN=${service.fqdn}`);
    console.log(`[publisher]   host: ${service.host}`);
    console.log(`[publisher]   addresses (local view): ${JSON.stringify(service.addresses ?? [])}`);
  });

  service.on('error', (err) => {
    console.error(`[publisher] ✗ Service-Fehler: ${err}`);
  });

  return bonjour;
}

interface Discovery {
  name: string;
  fqdn: string;
  host: string;
  addresses: string[];
  txt: Record<string, string>;
  refererAddress?: string;
  expectedMeshIp?: string;
  mode?: string;
  isCorrect?: boolean;
}

function runBrowser(args: Args): { bonjour: Bonjour; discoveries: Discovery[] } {
  const bonjour = new Bonjour({});
  const discoveries: Discovery[] = [];
  console.log(`[browser] Starte Browser fuer _${args.serviceType}._tcp ...`);

  const browser = bonjour.find({ type: args.serviceType });
  browser.on('up', (svc) => {
    const addresses = svc.addresses ?? [];
    const txt = (svc.txt ?? {}) as Record<string, string>;
    const expectedMeshIp = txt['meshIp'];
    const mode = txt['mode'];
    // Bei PIN: erwartet GENAU eine IPv4-Adresse die gleich expectedMeshIp ist.
    // IPv6 wird ignoriert (Phase 2). Bei NO-PIN: Leak ist erwartet.
    const ipv4Addrs = addresses.filter(a => !a.includes(':'));
    const isCorrect = mode === 'pin'
      ? ipv4Addrs.length === 1 && ipv4Addrs[0] === expectedMeshIp
      : ipv4Addrs.length > 1; // NO-PIN sollte Leak zeigen

    const d: Discovery = {
      name: svc.name,
      fqdn: svc.fqdn,
      host: svc.host,
      addresses,
      txt,
      refererAddress: svc.referer?.address,
      expectedMeshIp,
      mode,
      isCorrect,
    };
    discoveries.push(d);

    console.log(`[browser] ✓ Discovered: ${d.name}`);
    console.log(`[browser]   host=${d.host} mode=${d.mode}`);
    console.log(`[browser]   expectedMeshIp=${d.expectedMeshIp}`);
    console.log(`[browser]   actual addresses=${JSON.stringify(d.addresses)}`);
    console.log(`[browser]   referer=${d.refererAddress}`);
    console.log(`[browser]   ${d.isCorrect ? '✓ KORREKT (nur erwartete IP)' : '✗ FALSCH (IPs leaken oder fehlen)'}`);
    console.log();
  });

  return { bonjour, discoveries };
}

function analyzeResults(discoveries: Discovery[], args: Args, meshIp: string) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ERGEBNIS-ANALYSE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Erwartete Mesh-IP (lokal): ${meshIp}`);
  console.log(`Modus: ${args.pin ? 'PIN' : 'NO-PIN'}`);
  console.log(`Discovered Services: ${discoveries.length}`);
  console.log();

  if (discoveries.length === 0) {
    console.log('Keine Services entdeckt. Ist der Publisher (anderer Prozess/Host) aktiv?');
    console.log('Bei lokalem 2-Prozess-Test: ist Multicast-Loopback im Netzwerk aktiviert?');
    return;
  }

  let correct = 0;
  let leaked = 0;
  for (const d of discoveries) {
    if (d.isCorrect) {
      correct++;
    } else {
      leaked++;
      console.log(`✗ Geleakter Service: ${d.name}`);
      console.log(`  Erwartet: ${d.expectedMeshIp}`);
      console.log(`  Bekommen: ${JSON.stringify(d.addresses)}`);
      const wrongIps = d.addresses.filter(ip => ip !== d.expectedMeshIp);
      console.log(`  Leak: ${JSON.stringify(wrongIps)}`);
    }
  }

  console.log();
  console.log(`Korrekt published: ${correct}/${discoveries.length}`);
  console.log(`Mit IP-Leak:       ${leaked}/${discoveries.length}`);
  console.log();

  if (correct === discoveries.length && correct > 0) {
    console.log('✓✓✓ POC ERFOLGREICH: bonjour-service published korrekt nur die Mesh-IP wenn { interface } gesetzt ist.');
    console.log('Empfehlung: ADR-019 D+A umsetzbar mit bestehender Library.');
  } else if (leaked > 0) {
    console.log('⚠⚠⚠ POC ZEIGT IP-LEAK: bonjour-service published trotz Pinning mehrere IPs.');
    console.log('Empfehlung: Fallback nötig (custom A-Record-Manipulation oder native DNS-SD).');
  }
}

async function main() {
  const args = parseArgs();
  const interfaces = listActiveIPv4Interfaces();
  const meshIp = selectMeshIp(interfaces, args.meshIp);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ADR-019 Discovery PoC — Mode: ${args.mode.toUpperCase()}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Hostname: ${hostname()}`);
  console.log(`PID: ${process.pid}`);
  console.log(`Aktive IPv4-Interfaces:`);
  for (const i of interfaces) {
    console.log(`  ${i.name.padEnd(10)} ${i.address.padEnd(16)} CIDR=${i.cidr}`);
  }
  console.log(`Gewaehlte Mesh-IP: ${meshIp}`);
  console.log();

  let publisher: Bonjour | undefined;
  let browserResult: { bonjour: Bonjour; discoveries: Discovery[] } | undefined;

  if (args.mode === 'publish' || args.mode === 'both') {
    publisher = await runPublisher(args, meshIp);
  }

  if (args.mode === 'browse' || args.mode === 'both') {
    browserResult = runBrowser(args);
  }

  console.log(`\nLaeuft ${args.duration} Sekunden...\n`);
  await new Promise(r => setTimeout(r, args.duration * 1000));

  if (browserResult) {
    analyzeResults(browserResult.discoveries, args, meshIp);
    browserResult.bonjour.destroy();
  }

  if (publisher) {
    publisher.destroy();
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
