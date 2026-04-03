/**
 * system-monitor.ts — Eingebauter Skill: System-Monitoring
 *
 * Stellt MCP-Tools fuer System-Ueberwachung bereit:
 * - system.health: CPU, RAM, Disk, Netzwerk-Auslastung
 * - system.processes: Top-Prozesse nach CPU/RAM
 * - system.network: Netzwerk-Interfaces und Verbindungen
 * - system.disk: Dateisystem-Nutzung
 *
 * Wird automatisch beim Daemon-Start registriert.
 */

import * as si from 'systeminformation';
import type { SkillManifest } from '../skills.js';

export const SYSTEM_MONITOR_MANIFEST: SkillManifest = {
  id: 'system-monitor',
  version: '1.0.0',
  description: 'System-Monitoring: CPU, RAM, Disk, Netzwerk, Prozesse',
  author: '', // Wird beim Registrieren mit der Agent-ID befuellt
  integrity: 'builtin',
  runtime: 'node',
  entrypoint: 'builtin',
  dependencies: ['systeminformation'],
  tools: ['system.health', 'system.processes', 'system.network', 'system.disk'],
  resources: [],
  category: 'monitoring',
  permissions: ['system.read'],
  requirements: { os: ['darwin', 'linux', 'win32'] },
  createdAt: new Date().toISOString(),
};

// --- Tool-Implementierungen ---

export async function systemHealth(): Promise<Record<string, unknown>> {
  const [cpu, mem, disk, osInfo, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.time(),
  ]);

  return {
    cpu: {
      load_percent: Math.round(cpu.currentLoad * 10) / 10,
      cores: cpu.cpus.length,
      per_core: cpu.cpus.map((c) => Math.round(c.load * 10) / 10),
    },
    memory: {
      total_gb: Math.round((mem.total / 1e9) * 10) / 10,
      used_gb: Math.round((mem.used / 1e9) * 10) / 10,
      free_gb: Math.round((mem.free / 1e9) * 10) / 10,
      used_percent: Math.round((mem.used / mem.total) * 1000) / 10,
    },
    disk: disk.map((d) => ({
      mount: d.mount,
      size_gb: Math.round((d.size / 1e9) * 10) / 10,
      used_gb: Math.round((d.used / 1e9) * 10) / 10,
      use_percent: d.use,
    })),
    os: {
      platform: osInfo.platform,
      distro: osInfo.distro,
      release: osInfo.release,
      arch: osInfo.arch,
      hostname: osInfo.hostname,
    },
    uptime: {
      seconds: time.uptime,
      formatted: formatUptime(time.uptime),
    },
  };
}

export async function systemProcesses(limit = 10): Promise<Record<string, unknown>> {
  const procs = await si.processes();
  const topCpu = procs.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      pid: p.pid,
      cpu_percent: Math.round(p.cpu * 10) / 10,
      mem_percent: Math.round(p.mem * 10) / 10,
      state: p.state,
    }));

  return {
    total: procs.all,
    running: procs.running,
    top_by_cpu: topCpu,
  };
}

export async function systemNetwork(): Promise<Record<string, unknown>> {
  const [ifaces, stats] = await Promise.all([
    si.networkInterfaces(),
    si.networkStats(),
  ]);

  const interfaces = (Array.isArray(ifaces) ? ifaces : [ifaces]).map((i) => ({
    iface: i.iface,
    ip4: i.ip4,
    ip6: i.ip6,
    mac: i.mac,
    speed: i.speed,
    type: i.type,
    operstate: i.operstate,
  }));

  const traffic = stats.map((s) => ({
    iface: s.iface,
    rx_bytes: s.rx_bytes,
    tx_bytes: s.tx_bytes,
    rx_sec: Math.round(s.rx_sec),
    tx_sec: Math.round(s.tx_sec),
  }));

  return { interfaces, traffic };
}

export async function systemDisk(): Promise<Record<string, unknown>> {
  const [fs, io] = await Promise.all([
    si.fsSize(),
    si.disksIO(),
  ]);

  return {
    filesystems: fs.map((f) => ({
      fs: f.fs,
      mount: f.mount,
      type: f.type,
      size_gb: Math.round((f.size / 1e9) * 10) / 10,
      used_gb: Math.round((f.used / 1e9) * 10) / 10,
      available_gb: Math.round(((f.size - f.used) / 1e9) * 10) / 10,
      use_percent: f.use,
    })),
    io: io ? {
      read_sec: io.rIO_sec,
      write_sec: io.wIO_sec,
      total_read: io.rIO,
      total_write: io.wIO,
    } : null,
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
