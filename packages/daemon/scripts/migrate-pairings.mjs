#!/usr/bin/env node
/**
 * migrate-pairings.mjs — One-Shot-Migrationsscript fuer paired-peers.json
 *
 * Hintergrund (Bug #4 aus ADR-020 Phase 1.1 Bug-Report):
 * In aelteren Pairings wurden SPIFFE-URIs aus dem Hostname abgeleitet
 * (`spiffe://thinklocal/host/iobroker/agent/claude-code`). Spaeter wurde
 * auf einen 16-stelligen Host-Fingerprint umgestellt
 * (`spiffe://thinklocal/host/b4768fe0e2dfd41f/agent/claude-code`). Pairings
 * vom 7.-10.4.2026 nutzen Host-ID, vom 13.4.2026 Hostname — die alten
 * Eintraege wurden nie migriert. Folge: AGENT_MESSAGE/SKILL_ANNOUNCE von
 * einem Peer mit aktueller Host-ID-URI wird mit dem hostname-basierten
 * Eintrag verglichen → "nicht gepairt" → 403 reject.
 *
 * Was das Script tut:
 * 1. Liest ~/.thinklocal/pairing/paired-peers.json (oder $TLMCP_DATA_DIR/pairing/...)
 * 2. Fuer jeden Eintrag mit Legacy-URI (kein 16-hex Host-ID-Format):
 *    a. Versucht den Peer via `hostname` (aus dem Eintrag) auf Port 9440 zu
 *       erreichen
 *    b. Holt /.well-known/agent-card.json und liest die aktuelle SPIFFE-URI
 *    c. Ersetzt den Eintrag (loescht den alten, fuegt neuen mit gleichen
 *       Cert/Key-Daten ein) — falls schon ein Host-ID-Eintrag fuer denselben
 *       Peer existiert, wird der alte Legacy-Eintrag nur geloescht
 * 3. Schreibt atomar zurueck (tmpfile + rename) mit Backup
 * 4. Gibt eine Zusammenfassung aus
 *
 * Aufruf:
 *   node packages/daemon/scripts/migrate-pairings.mjs [--dry-run]
 *
 * Default: schreibt Aenderungen. --dry-run zeigt nur was passieren wuerde.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { request as httpsRequest } from 'node:https';

const HOST_ID_URI_PATTERN = /^spiffe:\/\/thinklocal\/host\/[0-9a-f]{16}\/agent\/[^/]+$/;

function isHostIdSpiffeUri(uri) {
  return HOST_ID_URI_PATTERN.test(uri);
}

function getDataDir() {
  return process.env['TLMCP_DATA_DIR'] ?? resolve(homedir(), '.thinklocal');
}

function loadLocalTlsCerts() {
  const dataDir = getDataDir();
  const certPath = resolve(dataDir, 'tls', 'node.crt.pem');
  const keyPath = resolve(dataDir, 'tls', 'node.key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  return {
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
  };
}

async function fetchAgentCard(host, port = 9440, timeoutMs = 5000) {
  const tls = loadLocalTlsCerts();
  return new Promise((res, rej) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        hostname: host,
        port,
        path: '/.well-known/agent-card.json',
        method: 'GET',
        // CA-Verifikation deaktiviert — das ist eine ONE-SHOT Migration,
        // bei der wir die "alte" Pairing-Beziehung gerade umbauen. Im
        // Produktivbetrieb laeuft Auth ueber den volle mTLS-Stack des
        // Daemons, nicht ueber dieses Script.
        rejectUnauthorized: false,
        // Client-Cert mitsenden, weil die Daemon-TLS-Konfiguration mTLS
        // erzwingt (auch fuer public PATHS wie /.well-known/agent-card.json)
        ...(tls ? { cert: tls.cert, key: tls.key } : {}),
      },
      (response) => {
        if (response.statusCode !== 200) {
          rej(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => {
          try {
            res(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (err) {
            rej(err);
          }
        });
      },
    );
    req.on('error', rej);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.end();
  });
}

export function extractSpiffeUriFromAgentCard(card) {
  // Suche in haeufigen Pfaden — Card-Schema ist nicht uniform.
  const candidates = [
    card?.spiffeUri, // aktuelles Format (top-level camelCase)
    card?.spiffe_uri,
    card?.spiffe_id,
    card?.spiffeId,
    card?.agent_id,
    card?.agentId,
    card?.identity?.spiffe_id,
    card?.identity?.spiffeUri,
    card?.identity?.uri,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('spiffe://')) return c;
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dataDir = getDataDir();
  const file = resolve(dataDir, 'pairing', 'paired-peers.json');

  if (!existsSync(file)) {
    console.error(`paired-peers.json nicht gefunden unter ${file}`);
    process.exit(1);
  }

  const raw = readFileSync(file, 'utf-8');
  let peers;
  try {
    peers = JSON.parse(raw);
  } catch (err) {
    console.error(`Konnte paired-peers.json nicht parsen: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(peers)) {
    console.error('paired-peers.json hat kein Array-Schema');
    process.exit(1);
  }

  console.log(`Gelesen: ${peers.length} Eintraege aus ${file}`);

  const legacy = peers.filter((p) => !isHostIdSpiffeUri(p.agentId));
  const current = peers.filter((p) => isHostIdSpiffeUri(p.agentId));
  console.log(`  davon Host-ID-basiert (OK): ${current.length}`);
  console.log(`  davon Legacy-hostname-basiert: ${legacy.length}`);

  if (legacy.length === 0) {
    console.log('Nichts zu tun — alle URIs sind bereits im Host-ID-Format.');
    return;
  }

  const currentUris = new Set(current.map((p) => p.agentId));
  const replacements = new Map(); // legacy-uri → new entry or null (drop)
  let resolved = 0;
  let dropped = 0;
  let kept = 0;

  for (const legacyEntry of legacy) {
    const host = legacyEntry.hostname;
    if (!host) {
      console.warn(`  - "${legacyEntry.agentId}": kein hostname-Feld, behalte Eintrag (Skript kann nicht migrieren)`);
      kept += 1;
      continue;
    }
    process.stdout.write(`  - "${legacyEntry.agentId}" via ${host} ... `);
    let card = null;
    let lastErr = null;
    // Bare hostname zuerst probieren, dann mit .local-Suffix (mDNS-Hostnamen)
    const tryHosts = host.endsWith('.local') ? [host] : [host, `${host}.local`];
    for (const h of tryHosts) {
      try {
        card = await fetchAgentCard(h);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    try {
      if (!card) throw lastErr ?? new Error('unknown error');
      const newUri = extractSpiffeUriFromAgentCard(card);
      if (!newUri) {
        console.log('FEHLER: agent-card enthielt keine SPIFFE-URI — behalte Eintrag');
        kept += 1;
        continue;
      }
      if (!isHostIdSpiffeUri(newUri)) {
        console.log(`FEHLER: Peer meldet immer noch Legacy-URI ${newUri} — behalte Eintrag`);
        kept += 1;
        continue;
      }
      if (currentUris.has(newUri)) {
        console.log(`bereits Host-ID-Eintrag vorhanden — Legacy-Eintrag wird verworfen`);
        replacements.set(legacyEntry.agentId, null);
        dropped += 1;
        continue;
      }
      const migrated = { ...legacyEntry, agentId: newUri };
      replacements.set(legacyEntry.agentId, migrated);
      currentUris.add(newUri);
      console.log(`ersetzt → ${newUri}`);
      resolved += 1;
    } catch (err) {
      console.log(`FEHLER (${err.message}) — behalte Eintrag`);
      kept += 1;
    }
  }

  // Apply replacements
  const result = peers
    .map((p) => {
      if (!replacements.has(p.agentId)) return p;
      return replacements.get(p.agentId); // either new entry or null
    })
    .filter((p) => p !== null);

  console.log('---');
  console.log(`Geplante Aktion: ${resolved} ersetzt, ${dropped} verworfen, ${kept} unberuehrt`);
  console.log(`Resultierende Eintragszahl: ${result.length}`);

  if (dryRun) {
    console.log('DRY RUN — keine Aenderungen geschrieben.');
    return;
  }

  // Backup
  const backupFile = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, backupFile);
  console.log(`Backup: ${backupFile}`);

  // Atomar schreiben: tmpfile + rename
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(result, null, 2), { mode: 0o600 });
  // POSIX rename ist atomar
  const { renameSync } = await import('node:fs');
  renameSync(tmp, file);
  console.log(`Geschrieben: ${file}`);
  console.log('Bitte Daemon neustarten (launchctl bootout+bootstrap bzw. systemctl --user restart thinklocal-daemon).');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
