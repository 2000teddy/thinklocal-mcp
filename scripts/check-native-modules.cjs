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

// Smoke-Tests pro Modul: nur require() reicht nicht — die meisten nativen
// Module laden das .node-Binding lazy (erst beim ersten Konstruktor-Aufruf).
// Wir muessen das Binding aktiv triggern um die ABI-Pruefung zu erzwingen.
const SMOKE_TESTS = {
  'better-sqlite3': (mod) => {
    // Eine in-memory DB oeffnen — das laed das .node-Binding sofort
    const db = new mod(':memory:');
    db.close();
  },
};

/**
 * Klassifiziert einen Lade-Fehler eines nativen Moduls.
 * Returns: 'abi-mismatch' | 'missing-binding' | 'other'
 *
 * Exportiert fuer Unit-Tests.
 */
function classifyLoadError(err) {
  const msg = err && err.message ? err.message : String(err);
  const isAbiMismatch =
    (err && err.code === 'ERR_DLOPEN_FAILED' && /NODE_MODULE_VERSION/.test(msg)) ||
    /NODE_MODULE_VERSION/.test(msg);
  if (isAbiMismatch) return 'abi-mismatch';
  // "Could not locate the bindings file" — passiert nach einem
  // fehlgeschlagenen Rebuild-Versuch (.node-Datei geloescht) oder wenn das
  // Modul fuer eine nicht-installierte Node-ABI vorgebaut ist. Behandeln
  // wie ABI-Mismatch: Rebuild noetig.
  const isMissingBinding = /Could not locate the bindings file/i.test(msg);
  if (isMissingBinding) return 'missing-binding';
  return 'other';
}

/**
 * Prueft ob die aktuelle Node-Major-Version mit der .nvmrc gewuenschten
 * uebereinstimmt. Returns { ok: boolean, desired?, currentMajor?, desiredMajor? }.
 * Wenn keine .nvmrc da ist, ok=true (kein Pin → kein Mismatch).
 *
 * Exportiert fuer Unit-Tests.
 */
function checkNvmrcMatch(rootDir, currentNodeVersion = process.versions.node) {
  const nvmrcPath = path.join(rootDir, '.nvmrc');
  if (!fs.existsSync(nvmrcPath)) {
    return { ok: true };
  }
  const desired = fs.readFileSync(nvmrcPath, 'utf-8').trim().replace(/^v/, '');
  const desiredMajor = desired.split('.')[0];
  const currentMajor = currentNodeVersion.split('.')[0];
  return {
    ok: desiredMajor === currentMajor,
    desired,
    desiredMajor,
    currentMajor,
  };
}

/**
 * Formatiert eine nutzerfreundliche Fehler-Meldung fuer den
 * Node-Version-Mismatch-Fall.
 *
 * Exportiert fuer Unit-Tests.
 */
function formatNvmrcMismatchMessage(currentNodeVersion, currentAbi, desired) {
  const currentMajor = currentNodeVersion.split('.')[0];
  return (
    `\n[check-native-modules] FEHLER: Node-Version-Mismatch.\n` +
    `  Aktuell: v${currentNodeVersion} (NODE_MODULE_VERSION ${currentAbi})\n` +
    `  Erwartet: v${desired} (laut .nvmrc)\n\n` +
    `  Auf diesem System sind die nativen Module (better-sqlite3) gegen die\n` +
    `  erwartete Node-Version vorgebaut. Ein Rebuild gegen v${currentMajor} schlaegt\n` +
    `  typischerweise fehl (kein prebuild + node-gyp-Inkompatibilitaeten).\n\n` +
    `  Loesung:\n` +
    `    nvm use ${desired}     # (NVM)\n` +
    `    # oder:\n` +
    `    PATH="$HOME/.nvm/versions/node/v${desired}/bin:$PATH" npm test\n\n`
  );
}

/**
 * Versucht ein natives Modul zu laden und seinen Smoke-Test auszufuehren.
 * Returns: 'ok' | 'abi-mismatch' | 'missing-binding' | 'other' | 'not-installed'
 *
 * Exportiert fuer Unit-Tests.
 */
function probeNativeModule(modulePath, smokeTestFn) {
  if (!fs.existsSync(modulePath)) return 'not-installed';
  try {
    const mod = require(modulePath);
    if (smokeTestFn) smokeTestFn(mod);
    return 'ok';
  } catch (err) {
    return classifyLoadError(err);
  }
}

function main() {
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
    const result = probeNativeModule(modulePath, SMOKE_TESTS[moduleName]);

    if (result === 'not-installed') continue;
    if (result === 'ok') {
      console.log(`[check-native-modules] OK: ${moduleName}`);
      continue;
    }
    if (result === 'abi-mismatch' || result === 'missing-binding') {
      reasons.push(`${moduleName}: ${result === 'abi-mismatch' ? 'ABI mismatch' : 'missing binding'}`);
      needsRebuild = true;
    } else {
      // 'other' — Rebuild versuchen schadet nicht, ist aber kein Auto-Trigger.
      console.warn(`[check-native-modules] WARN: ${moduleName} laed nicht (unbekannter Fehler)`);
    }
  }

  if (!needsRebuild) {
    console.log('[check-native-modules] Alle nativen Module OK');
    process.exit(0);
  }

  console.log(`[check-native-modules] Rebuild noetig: ${reasons.join(', ')}`);

  // Vor dem Rebuild-Versuch: pruefen ob das Projekt eine bevorzugte Node-Version
  // hat (.nvmrc). Wenn ja und wir laufen mit einer anderen Major-Version, ist
  // ein Rebuild-Versuch sinnlos (kein prebuilt + node-gyp scheitert oft mit
  // neueren Node-Majors). Stattdessen: klare Anleitung ausgeben.
  const nvmrcCheck = checkNvmrcMatch(rootDir);
  if (!nvmrcCheck.ok) {
    console.error(formatNvmrcMismatchMessage(process.versions.node, currentAbi, nvmrcCheck.desired));
    process.exit(1);
  }

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
}

// Nur als CLI ausfuehren, nicht bei require() — damit die Helper testbar sind.
if (require.main === module) {
  main();
}

module.exports = {
  classifyLoadError,
  checkNvmrcMatch,
  formatNvmrcMismatchMessage,
  probeNativeModule,
  NATIVE_MODULES,
  SMOKE_TESTS,
};
