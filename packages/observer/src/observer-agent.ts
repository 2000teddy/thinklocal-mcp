/**
 * observer-agent.ts — Hauptprozess des Observer-Agents
 *
 * Fuehrt einen einzelnen Observer-Run aus:
 *   1. Modell-Auswahl basierend auf RAM
 *   2. Ollama-Erreichbarkeit pruefen
 *   3. System-Probes ausfuehren
 *   4. Modell analysieren lassen
 *   5. Ergebnis ausgeben (stdout JSON) oder ins Mesh senden
 *   6. Beenden — kein Dauerlauf.
 *
 * Aufruf:
 *   node observer-agent.js              # run once, JSON auf stdout
 *   node observer-agent.js --send       # zusaetzlich ins Mesh senden
 *   node observer-agent.js --admin=<uri>  # Mesh-Zieladresse
 *
 * Env:
 *   TLMCP_OBSERVER_MODEL    Override fuer Modell-Auswahl
 *   OLLAMA_HOST             Ollama-URL (default: http://localhost:11434)
 *   TLMCP_DAEMON_URL        Daemon-URL (default: http://localhost:9440)
 *   TLMCP_OBSERVER_ADMIN    Admin-SPIFFE-URI (fuer --send)
 */

import { hostname } from 'node:os';
import { selectModelWithOverride } from './model-selector.js';
import { runAllProbes } from './system-probes.js';
import { OllamaClient } from './ollama-client.js';
import { analyzeProbes, type ObserverReport } from './analyzer.js';

interface RunOptions {
  /** Sende den Report zusaetzlich ans Mesh (Inbox-Nachricht). */
  sendToMesh?: boolean;
  /** SPIFFE-URI des Admin-Nodes. */
  adminAgentId?: string;
  /** Daemon-URL fuer Mesh-Send (default: env TLMCP_DAEMON_URL oder http://localhost:9440). */
  daemonUrl?: string;
}

export async function runObserver(opts: RunOptions = {}): Promise<ObserverReport> {
  const nodeName = hostname();

  // 1. Modell-Auswahl
  const modelChoice = selectModelWithOverride();
  if (!modelChoice) {
    return {
      node: nodeName,
      timestamp: new Date().toISOString(),
      model: 'none',
      checks_run: 0,
      findings: [],
      raw_error: 'Insufficient RAM for observer agent (need >= 4 GB)',
    };
  }

  // 2. Ollama-Check
  const ollama = new OllamaClient();
  const available = await ollama.isModelAvailable(modelChoice.model);
  if (!available) {
    return {
      node: nodeName,
      timestamp: new Date().toISOString(),
      model: modelChoice.model,
      checks_run: 0,
      findings: [],
      raw_error: `Ollama not reachable or model '${modelChoice.model}' not installed. Run: ollama pull ${modelChoice.model}`,
    };
  }

  // 3. Probes
  const probes = await runAllProbes();

  // 4. Analyse
  const report = await analyzeProbes(ollama, modelChoice.model, probes, nodeName);

  // 5. Optional: Ins Mesh senden
  if (opts.sendToMesh && opts.adminAgentId) {
    await sendToMesh(report, opts.adminAgentId, opts.daemonUrl);
  }

  return report;
}

async function sendToMesh(
  report: ObserverReport,
  adminAgentId: string,
  daemonUrl?: string,
): Promise<void> {
  const url = daemonUrl ?? process.env['TLMCP_DAEMON_URL'] ?? 'http://localhost:9440';
  const subject = `[observer] ${report.node}: ${report.findings.length} Befund(e)`;

  try {
    await fetch(`${url}/api/inbox/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: adminAgentId,
        subject,
        body: report,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Best-effort: Observer darf nicht crashen wenn Daemon nicht erreichbar ist.
    process.stderr.write(`[observer] Mesh-Send fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// CLI-Einstiegspunkt
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sendToMesh = args.includes('--send');
  const adminFlag = args.find(a => a.startsWith('--admin='));
  const adminAgentId = adminFlag
    ? adminFlag.slice('--admin='.length)
    : process.env['TLMCP_OBSERVER_ADMIN'];

  const report = await runObserver({
    sendToMesh,
    adminAgentId,
  });

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  // Exit-Code: 0 wenn keine kritischen Findings, 1 sonst
  const hasCritical = report.findings.some(f => f.severity === 'critical' || f.severity === 'error');
  process.exit(hasCritical ? 1 : 0);
}

// Nur ausfuehren wenn direkt gestartet (nicht beim Import)
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
