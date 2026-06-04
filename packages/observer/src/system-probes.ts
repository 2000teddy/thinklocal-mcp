/**
 * system-probes.ts — Read-only System-Checks fuer Observer-Agent
 *
 * SICHERHEIT: Nur Befehle aus der Whitelist werden ausgefuehrt.
 * Keine Shell-Interpolation, keine User-Input-Weiterleitung.
 * Alle Befehle sind deterministisch und modifizieren das System nicht.
 *
 * Siehe ADR-018 fuer die vollstaendige Whitelist.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ProbeResult {
  id: string;
  category: 'disk' | 'memory' | 'uptime' | 'os' | 'services' | 'logs' | 'cron' | 'updates' | 'processes';
  command: string;
  output: string;
  error: string | null;
  duration_ms: number;
  truncated: boolean;
}

/**
 * Whitelist: Nur diese Befehle duerfen ausgefuehrt werden.
 * Jeder Eintrag ist ein fester Befehl (keine User-Parameter).
 */
const SAFE_PROBES: Array<{
  id: string;
  category: ProbeResult['category'];
  command: string;
  /** Timeout in ms, default 5000 */
  timeoutMs?: number;
  /** Max output bytes, default 100_000 */
  maxBytes?: number;
}> = [
  // Disk
  { id: 'disk-usage', category: 'disk', command: 'df -h' },
  // Memory
  { id: 'memory', category: 'memory', command: 'free -m' },
  // Uptime + Load
  { id: 'uptime', category: 'uptime', command: 'uptime' },
  // OS
  { id: 'kernel', category: 'os', command: 'uname -a' },
  { id: 'os-release', category: 'os', command: 'cat /etc/os-release' },
  // Services (systemd-basierte Systeme)
  { id: 'failed-services', category: 'services', command: 'systemctl list-units --failed --no-pager' },
  // Logs (letzte 24h, max 200 Zeilen)
  {
    id: 'recent-logs',
    category: 'logs',
    command: 'journalctl --since "24 hours ago" --no-pager --lines=200 -p warning',
    maxBytes: 50_000,
  },
  // Cron-Jobs des aktuellen Users
  { id: 'user-cron', category: 'cron', command: 'crontab -l' },
  // Apt-Updates: nur ZAEHLEN und Top-20 zeigen (sonst wird der Prompt zu gross).
  // `apt list --upgradable` kann auf ungepflegten Systemen mehrere hundert Pakete
  // listen. Fuer den Observer reicht die Anzahl + Beispiele — das LLM braucht
  // nicht die vollstaendige Liste um eine Empfehlung zu geben.
  {
    id: 'apt-upgradable',
    category: 'updates',
    command: 'bash -c \'LIST=$(apt list --upgradable 2>/dev/null | tail -n +2); COUNT=$(echo "$LIST" | grep -c "." || echo 0); echo "Upgradable packages: $COUNT"; echo "---"; echo "$LIST" | head -20\'',
    maxBytes: 5000,
  },
  // Top-Memory-Prozesse
  { id: 'top-mem', category: 'processes', command: 'ps aux --sort=-%mem | head -20' },
];

/**
 * Fuehrt einen einzelnen Probe aus. Fehler werden nicht geworfen,
 * sondern als `error` im Ergebnis zurueckgegeben.
 */
async function runProbe(probe: typeof SAFE_PROBES[number]): Promise<ProbeResult> {
  const start = Date.now();
  const timeoutMs = probe.timeoutMs ?? 5000;
  const maxBytes = probe.maxBytes ?? 100_000;

  try {
    const { stdout, stderr } = await execAsync(probe.command, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: maxBytes,
    });

    const output = stdout || stderr || '';
    const truncated = output.length >= maxBytes;

    return {
      id: probe.id,
      category: probe.category,
      command: probe.command,
      output: output.slice(0, maxBytes),
      error: null,
      duration_ms: Date.now() - start,
      truncated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: probe.id,
      category: probe.category,
      command: probe.command,
      output: '',
      error: msg.slice(0, 500),
      duration_ms: Date.now() - start,
      truncated: false,
    };
  }
}

/**
 * Fuehrt alle Probes aus der Whitelist aus, parallel mit begrenzter Konkurrenz.
 */
export async function runAllProbes(): Promise<ProbeResult[]> {
  // Parallel ausfuehren — die Befehle sind read-only und beeinflussen sich nicht.
  return Promise.all(SAFE_PROBES.map(runProbe));
}

/**
 * Fuehrt einen einzelnen Probe per ID aus.
 * Nuetzlich fuer Tests oder gezieltes Debugging.
 */
export async function runProbeById(id: string): Promise<ProbeResult | null> {
  const probe = SAFE_PROBES.find(p => p.id === id);
  if (!probe) return null;
  return runProbe(probe);
}

/** Liste aller verfuegbaren Probe-IDs. Fuer Discovery/Debugging. */
export function listProbeIds(): string[] {
  return SAFE_PROBES.map(p => p.id);
}
