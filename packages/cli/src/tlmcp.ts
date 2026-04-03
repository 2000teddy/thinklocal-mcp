#!/usr/bin/env node
/**
 * tlmcp — CLI fuer thinklocal-mcp Mesh-Verwaltung
 *
 * Befehle:
 *   tlmcp status          — Daemon-Status anzeigen
 *   tlmcp peers           — Verbundene Peers auflisten
 *   tlmcp capabilities    — Capability-Registry abfragen
 *   tlmcp tasks           — Tasks anzeigen
 *   tlmcp vault list      — Vault-Credentials auflisten
 *   tlmcp vault store     — Credential speichern
 *   tlmcp pairing start   — Pairing-PIN generieren
 *   tlmcp pairing status  — Pairing-Status anzeigen
 *   tlmcp audit           — Audit-Log anzeigen
 */

const DAEMON_URL = process.env['TLMCP_DAEMON_URL'] ?? 'http://localhost:9440';

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`);
  if (!res.ok) {
    console.error(`Fehler: ${res.status} ${res.statusText}`);
    console.error(`Daemon erreichbar? (${DAEMON_URL})`);
    process.exit(1);
  }
  return res.json();
}

async function postJson(path: string, body: unknown = {}): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Fehler: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return res.json();
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printTable(rows: Record<string, unknown>[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('  (keine Eintraege)');
    return;
  }
  // Spaltenbreiten berechnen
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? '').length)),
  );
  // Header
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(columns.map((_, i) => '-'.repeat(widths[i])).join('  '));
  // Rows
  for (const row of rows) {
    console.log(columns.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

// --- Befehle ---

async function cmdStatus(): Promise<void> {
  const data = (await fetchJson('/api/status')) as Record<string, unknown>;
  console.log('\n  thinklocal-mcp Daemon Status');
  console.log('  ============================');
  console.log(`  Agent:         ${data['agent_id']}`);
  console.log(`  Hostname:      ${data['hostname']}:${data['port']}`);
  console.log(`  Uptime:        ${data['uptime_seconds']}s`);
  console.log(`  Peers online:  ${data['peers_online']}`);
  console.log(`  Capabilities:  ${data['capabilities_count']}`);
  console.log(`  Active Tasks:  ${data['active_tasks']}`);
  console.log(`  Audit Events:  ${data['audit_events']}`);
  console.log();
}

async function cmdPeers(): Promise<void> {
  const data = (await fetchJson('/api/peers')) as { peers: Record<string, unknown>[] };
  console.log(`\n  Verbundene Peers (${data.peers.length}):\n`);
  printTable(
    data.peers.map((p) => ({
      name: p['name'],
      host: `${p['host']}:${p['port']}`,
      status: p['status'],
      last_seen: p['last_seen'],
    })),
    ['name', 'host', 'status', 'last_seen'],
  );
  console.log();
}

async function cmdCapabilities(): Promise<void> {
  const data = (await fetchJson('/api/capabilities')) as {
    capabilities: Record<string, unknown>[];
    hash: string;
  };
  console.log(`\n  Capabilities (${data.capabilities.length}) | Hash: ${data.hash?.slice(0, 12)}\n`);
  printTable(
    data.capabilities.map((c) => ({
      skill: c['skill_id'],
      version: c['version'],
      agent: String(c['agent_id'] ?? '').split('/').pop(),
      health: c['health'],
      category: c['category'],
    })),
    ['skill', 'version', 'agent', 'health', 'category'],
  );
  console.log();
}

async function cmdTasks(): Promise<void> {
  const data = (await fetchJson('/api/tasks')) as { tasks: Record<string, unknown>[] };
  console.log(`\n  Tasks (${data.tasks.length}):\n`);
  printTable(
    data.tasks.map((t) => ({
      id: String(t['id']).slice(0, 8),
      skill: t['skill_id'],
      state: t['state'],
      requester: String(t['requester'] ?? '').split('/').pop(),
      created: t['created_at'],
    })),
    ['id', 'skill', 'state', 'requester', 'created'],
  );
  console.log();
}

async function cmdVaultList(): Promise<void> {
  const data = (await fetchJson('/api/vault/credentials')) as {
    credentials: Record<string, unknown>[];
  };
  console.log(`\n  Vault Credentials (${data.credentials.length}):\n`);
  printTable(
    data.credentials.map((c) => ({
      name: c['name'],
      category: c['category'],
      accesses: c['accessCount'],
      expires: c['expiresAt'] ?? '--',
    })),
    ['name', 'category', 'accesses', 'expires'],
  );
  console.log();
}

async function cmdVaultStore(name: string, value: string, category = 'general'): Promise<void> {
  await postJson('/api/vault/credentials', { name, value, category });
  console.log(`  Credential '${name}' gespeichert (Kategorie: ${category})`);
}

async function cmdPairingStart(): Promise<void> {
  const data = (await postJson('/pairing/start')) as { pin: string; expires_in_seconds: number };
  console.log('\n  Pairing-PIN generiert:');
  console.log(`\n     ${data.pin}\n`);
  console.log(`  Gueltig fuer ${data.expires_in_seconds} Sekunden.`);
  console.log('  Teile diese PIN dem Benutzer des anderen Nodes mit.\n');
}

async function cmdPairingStatus(): Promise<void> {
  const data = (await fetchJson('/pairing/status')) as {
    active_session: Record<string, unknown> | null;
    paired_peers: Record<string, unknown>[];
  };
  if (data.active_session) {
    console.log(`\n  Aktive Session: ${data.active_session['state']} (${data.active_session['age_seconds']}s)`);
  }
  console.log(`\n  Gepaarte Peers (${data.paired_peers.length}):\n`);
  printTable(
    data.paired_peers.map((p) => ({
      hostname: p['hostname'],
      agent: String(p['agent_id'] ?? '').split('/').pop(),
      paired_at: p['paired_at'],
    })),
    ['hostname', 'agent', 'paired_at'],
  );
  console.log();
}

async function cmdAudit(limit = 20): Promise<void> {
  const data = (await fetchJson(`/api/audit?limit=${limit}`)) as {
    events: Record<string, unknown>[];
    total: number;
  };
  console.log(`\n  Audit-Log (${data.events.length}/${data.total}):\n`);
  printTable(
    data.events.map((e) => ({
      id: e['id'],
      time: String(e['timestamp'] ?? '').slice(11, 19),
      type: e['event_type'],
      peer: e['peer_id'] ? String(e['peer_id']).split('/').pop() : '--',
      details: e['details'] ?? '--',
    })),
    ['id', 'time', 'type', 'peer', 'details'],
  );
  console.log();
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'status': return cmdStatus();
    case 'peers': return cmdPeers();
    case 'capabilities':
    case 'caps': return cmdCapabilities();
    case 'tasks': return cmdTasks();
    case 'vault':
      if (args[1] === 'list') return cmdVaultList();
      if (args[1] === 'store' && args[2] && args[3]) return cmdVaultStore(args[2], args[3], args[4]);
      console.log('  Nutzung: tlmcp vault list | tlmcp vault store <name> <value> [category]');
      return;
    case 'pairing':
    case 'pair':
      if (args[1] === 'start') return cmdPairingStart();
      if (args[1] === 'status') return cmdPairingStatus();
      console.log('  Nutzung: tlmcp pairing start | tlmcp pairing status');
      return;
    case 'audit': return cmdAudit(Number(args[1]) || 20);
    default:
      console.log(`
  tlmcp — thinklocal-mcp CLI

  Befehle:
    status              Daemon-Status anzeigen
    peers               Verbundene Peers auflisten
    capabilities|caps   Capability-Registry abfragen
    tasks               Tasks anzeigen
    vault list          Vault-Credentials auflisten
    vault store <n> <v> Credential speichern
    pairing start       Pairing-PIN generieren
    pairing status      Pairing-Status anzeigen
    audit [limit]       Audit-Log anzeigen (Default: 20)

  Env: TLMCP_DAEMON_URL (Default: http://localhost:9440)
`);
  }
}

main().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
