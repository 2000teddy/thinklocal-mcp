#!/usr/bin/env node
/*
 * check-native-modules.cjs
 *
 * Verifiziert, dass alle nativen Node-Module gegen die *aktuelle* Node-Version
 * kompiliert sind. Wenn nicht, wird automatisch `npm rebuild` ausgefuehrt.
 *
 * Hintergrund: Nach einem Node-Upgrade (z.B. von v22 → v25) ist die ABI-Version
 * (NODE_MODULE_VERSION, process.versions.modules) inkompatibel. Native Module
 * wie better-sqlite3 schlagen dann mit ERR_DLOPEN_FAILED fehl. Dieses Script
 * wird im root postinstall + im daemon-postinstall aufgerufen und repariert
 * solche Mismatches automatisch.
 *
 * Aufruf:
 *   node scripts/check-native-modules.cjs                  (root, default)
 *   node scripts/check-native-modules.cjs <package-dir>    (spezifisches Paket)
 *
 * Exit-Code 0 bei Erfolg (auch nach erfolgreichem Rebuild),
 * Exit-Code 1 wenn Rebuild fehlschlaegt.
 */

'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const NATIVE_MODULES = ['better-sqlite3'];

const rootDir = path.resolve(__dirname, '..');
const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rootDir, 'packages', 'daemon');

if (!fs.existsSync(targetDir)) {
  console.log(`[check-native-modules] Skip: ${targetDir} existiert nicht`);
  process.exit(0);
}

const nodeModulesDir = path.join(targetDir, 'node_modules');
if (!fs.existsSync(nodeModulesDir)) {
  console.log(`[check-native-modules] Skip: keine node_modules in ${targetDir} (erster Install?)`);
  process.exit(0);
}

const currentAbi = process.versions.modules;
console.log(
  `[check-native-modules] Node ${process.version}, ABI ${currentAbi}, Ziel ${path.relative(rootDir, targetDir) || '.'}`,
);

let needsRebuild = false;
const reasons = [];

for (const moduleName of NATIVE_MODULES) {
  const modulePath = path.join(nodeModulesDir, moduleName);
  if (!fs.existsSync(modulePath)) {
    continue; // Modul nicht installiert in diesem Paket — kein Problem
  }

  try {
    require(modulePath);
    console.log(`[check-native-modules] OK: ${moduleName}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const isAbiMismatch =
      err && err.code === 'ERR_DLOPEN_FAILED' && /NODE_MODULE_VERSION/.test(msg);
    if (isAbiMismatch) {
      const wantedMatch = msg.match(/NODE_MODULE_VERSION (\d+)/g);
      const wanted = wantedMatch ? wantedMatch.join(' vs ') : 'unknown';
      reasons.push(`${moduleName}: ABI mismatch (${wanted})`);
      needsRebuild = true;
    } else {
      // Anderer Fehler — Rebuild versuchen schadet nicht, ist aber kein Auto-Trigger.
      console.warn(`[check-native-modules] WARN: ${moduleName} laed nicht: ${msg}`);
    }
  }
}

if (!needsRebuild) {
  console.log('[check-native-modules] Alle nativen Module OK');
  process.exit(0);
}

console.log(`[check-native-modules] Rebuild noetig: ${reasons.join(', ')}`);
console.log(`[check-native-modules] Fuehre 'npm rebuild ${NATIVE_MODULES.join(' ')}' in ${targetDir} aus...`);

try {
  execSync(`npm rebuild ${NATIVE_MODULES.join(' ')}`, {
    cwd: targetDir,
    stdio: 'inherit',
  });
  console.log('[check-native-modules] Rebuild erfolgreich');
  process.exit(0);
} catch (err) {
  console.error('[check-native-modules] Rebuild fehlgeschlagen:', err.message);
  process.exit(1);
}
