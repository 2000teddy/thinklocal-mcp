#!/usr/bin/env node
/**
 * scan-network.ts — Netzwerk-Scanner fuer thinklocal-mcp
 *
 * Findet Rechner im lokalen Netzwerk die fuer thinklocal-mcp geeignet sind.
 * Drei Scan-Modi:
 *
 * 1. mDNS-Scan: Findet bereits laufende thinklocal-Daemons
 * 2. SSH-Scan: Findet erreichbare Rechner mit SSH (fuer Deployment)
 * 3. Eignungs-Check: Prueft ob Node.js installiert ist
 *
 * Nutzung:
 *   npx tsx packages/cli/src/scan-network.ts           # Alles scannen
 *   npx tsx packages/cli/src/scan-network.ts --mdns    # Nur thinklocal-Daemons
 *   npx tsx packages/cli/src/scan-network.ts --ssh     # Nur SSH-erreichbare Hosts
 */

import { networkInterfaces } from 'node:os';
import { execSync } from 'node:child_process';

interface DiscoveredHost {
  ip: string;
  hostname: string;
  hasDaemon: boolean;
  hasSSH: boolean;
  hasNode: boolean;
  nodeVersion: string | null;
  daemonPort: number | null;
  agentType: string | null;
  os: string | null;
}

// --- Lokales Subnetz ermitteln ---
function getLocalSubnet(): { ip: string; subnet: string; broadcast: string } {
  const ifaces = networkInterfaces();
  for (const ifaceList of Object.values(ifaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address !== '127.0.0.1') {
        const parts = iface.address.split('.');
        return {
          ip: iface.address,
          subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
          broadcast: `${parts[0]}.${parts[1]}.${parts[2]}.255`,
        };
      }
    }
  }
  return { ip: '127.0.0.1', subnet: '127.0.0', broadcast: '127.0.0.255' };
}

// --- thinklocal-Daemons via HTTP finden ---
async function scanForDaemons(subnet: string): Promise<DiscoveredHost[]> {
  const hosts: DiscoveredHost[] = [];
  const ports = [9440, 9441, 9442]; // Standard-Ports

  console.log(`  Scanne ${subnet}.1-254 auf thinklocal-Daemons...`);

  const promises: Promise<void>[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    for (const port of ports) {
      promises.push(
        fetch(`http://${ip}:${port}/health`, { signal: AbortSignal.timeout(1_000) })
          .then(async (res) => {
            if (res.ok) {
              // Agent Card abrufen fuer Details
              try {
                const cardRes = await fetch(`http://${ip}:${port}/.well-known/agent-card.json`, {
                  signal: AbortSignal.timeout(2_000),
                });
                const card = (await cardRes.json()) as Record<string, unknown>;
                hosts.push({
                  ip,
                  hostname: (card['hostname'] as string) ?? ip,
                  hasDaemon: true,
                  hasSSH: false,
                  hasNode: true,
                  nodeVersion: null,
                  daemonPort: port,
                  agentType: ((card['capabilities'] as Record<string, unknown>)?.['agents'] as string[])?.[0] ?? null,
                  os: null,
                });
              } catch {
                hosts.push({
                  ip, hostname: ip, hasDaemon: true, hasSSH: false, hasNode: true,
                  nodeVersion: null, daemonPort: port, agentType: null, os: null,
                });
              }
            }
          })
          .catch(() => { /* Host nicht erreichbar */ }),
      );
    }
  }

  await Promise.all(promises);
  return hosts;
}

// --- SSH-erreichbare Hosts finden (via arp/ping-Scan) ---
function scanForSSHHosts(subnet: string): DiscoveredHost[] {
  const hosts: DiscoveredHost[] = [];

  console.log(`  Scanne ${subnet}.1-254 auf SSH-Erreichbarkeit...`);
  console.log('  (Dies kann 10-30 Sekunden dauern)\n');

  // ARP-Tabelle lesen (schneller als Ping-Scan)
  try {
    const arpOutput = execSync('arp -a 2>/dev/null || true', { encoding: 'utf-8', timeout: 5000 });
    const arpLines = arpOutput.split('\n');

    for (const line of arpLines) {
      const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
      if (!match) continue;
      const ip = match[1];
      if (!ip.startsWith(subnet)) continue;

      // SSH-Port pruefen (schneller Test)
      try {
        execSync(`nc -z -w1 ${ip} 22 2>/dev/null`, { timeout: 2000 });

        // Hostname ermitteln
        let hostname = ip;
        try {
          const hostOutput = execSync(`ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no -o BatchMode=yes ${ip} hostname 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          if (hostOutput) hostname = hostOutput;
        } catch { /* ok */ }

        // Node.js pruefen
        let nodeVersion: string | null = null;
        try {
          nodeVersion = execSync(`ssh -o ConnectTimeout=2 -o BatchMode=yes ${ip} 'node -v' 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
        } catch { /* ok */ }

        hosts.push({
          ip,
          hostname,
          hasDaemon: false,
          hasSSH: true,
          hasNode: !!nodeVersion,
          nodeVersion,
          daemonPort: null,
          agentType: null,
          os: null,
        });
      } catch {
        // Kein SSH
      }
    }
  } catch {
    console.log('  ARP-Scan fehlgeschlagen — ueberspringe SSH-Scan');
  }

  return hosts;
}

// --- Ergebnisse anzeigen ---
function printResults(hosts: DiscoveredHost[]): void {
  const daemons = hosts.filter((h) => h.hasDaemon);
  const sshHosts = hosts.filter((h) => h.hasSSH && !h.hasDaemon);
  const suitable = sshHosts.filter((h) => h.hasNode);
  const needsNode = sshHosts.filter((h) => !h.hasNode);

  console.log('\n  ========================================');
  console.log('  Netzwerk-Scan Ergebnisse');
  console.log('  ========================================\n');

  // Bereits laufende Daemons
  if (daemons.length > 0) {
    console.log(`  Laufende thinklocal-Daemons (${daemons.length}):`);
    for (const h of daemons) {
      console.log(`    ${h.hostname.padEnd(25)} ${h.ip}:${h.daemonPort}  [${h.agentType ?? '?'}]`);
    }
    console.log();
  }

  // Geeignete Hosts (SSH + Node.js)
  if (suitable.length > 0) {
    console.log(`  Geeignete Hosts fuer Deployment (${suitable.length}):`);
    for (const h of suitable) {
      console.log(`    ${h.hostname.padEnd(25)} ${h.ip.padEnd(16)} Node ${h.nodeVersion}`);
      console.log(`      Deploy: ./scripts/deploy-remote.sh ${h.ip}`);
    }
    console.log();
  }

  // Hosts die noch Node.js brauchen
  if (needsNode.length > 0) {
    console.log(`  Hosts ohne Node.js (${needsNode.length}):`);
    for (const h of needsNode) {
      console.log(`    ${h.hostname.padEnd(25)} ${h.ip.padEnd(16)} (Node.js fehlt)`);
      console.log(`      Installiere: ssh ${h.ip} 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs'`);
    }
    console.log();
  }

  if (hosts.length === 0) {
    console.log('  Keine Hosts im Netzwerk gefunden.\n');
  }

  // Zusammenfassung
  console.log('  Zusammenfassung:');
  console.log(`    ${daemons.length} thinklocal-Daemon(s) aktiv`);
  console.log(`    ${suitable.length} Host(s) bereit fuer Deployment`);
  console.log(`    ${needsNode.length} Host(s) benoetigen Node.js`);
  console.log();
}

// --- Main ---
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mdnsOnly = args.includes('--mdns');
  const sshOnly = args.includes('--ssh');

  console.log('\n  thinklocal-mcp Netzwerk-Scanner\n');

  const { ip, subnet } = getLocalSubnet();
  console.log(`  Lokale IP: ${ip}`);
  console.log(`  Subnetz:   ${subnet}.0/24\n`);

  const allHosts: DiscoveredHost[] = [];

  if (!sshOnly) {
    const daemons = await scanForDaemons(subnet);
    allHosts.push(...daemons);
    console.log(`  ${daemons.length} Daemon(s) gefunden\n`);
  }

  if (!mdnsOnly) {
    const sshHosts = scanForSSHHosts(subnet);
    // Deduplizieren (kein Daemon-Host doppelt)
    for (const h of sshHosts) {
      if (!allHosts.some((a) => a.ip === h.ip)) {
        allHosts.push(h);
      }
    }
  }

  printResults(allHosts);
}

main().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
