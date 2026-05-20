/**
 * check-native-modules.test.cjs — Unit-Tests fuer die Helper-Funktionen.
 *
 * Hintergrund: dieses Skript wird als `pretest`-Hook in packages/daemon
 * ausgefuehrt. Wenn die ABI-Klassifizierung oder der .nvmrc-Check still
 * fehlerhaft wird, sehen wir das nur durch verwirrende Test-Fehler.
 * Diese Tests sichern die Pure-Function-Helper ab.
 *
 * Aufruf:
 *   node --test scripts/check-native-modules.test.cjs
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  classifyLoadError,
  checkNvmrcMatch,
  formatNvmrcMismatchMessage,
  probeNativeModule,
} = require('./check-native-modules.cjs');

// --- classifyLoadError ---

test('classifyLoadError: ERR_DLOPEN_FAILED mit NODE_MODULE_VERSION → abi-mismatch', () => {
  const err = new Error(
    "The module ... was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 147.",
  );
  err.code = 'ERR_DLOPEN_FAILED';
  assert.strictEqual(classifyLoadError(err), 'abi-mismatch');
});

test('classifyLoadError: NODE_MODULE_VERSION-Text ohne ERR_DLOPEN_FAILED-Code → trotzdem abi-mismatch', () => {
  const err = new Error('something NODE_MODULE_VERSION 147 mismatch');
  assert.strictEqual(classifyLoadError(err), 'abi-mismatch');
});

test('classifyLoadError: "Could not locate the bindings file" → missing-binding', () => {
  const err = new Error('Could not locate the bindings file. Tried: ...');
  assert.strictEqual(classifyLoadError(err), 'missing-binding');
});

test('classifyLoadError: "could not locate the bindings file" (case-insensitive) → missing-binding', () => {
  const err = new Error('could not locate THE bindings file. tried: a, b, c');
  assert.strictEqual(classifyLoadError(err), 'missing-binding');
});

test('classifyLoadError: unbekannter Fehler → other', () => {
  assert.strictEqual(classifyLoadError(new Error('SyntaxError in module')), 'other');
});

test('classifyLoadError: null/undefined → other', () => {
  assert.strictEqual(classifyLoadError(null), 'other');
  assert.strictEqual(classifyLoadError(undefined), 'other');
});

// --- checkNvmrcMatch ---

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmrc-test-'));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('checkNvmrcMatch: keine .nvmrc → ok=true', () => {
  withTmpDir((dir) => {
    const result = checkNvmrcMatch(dir, '26.0.0');
    assert.strictEqual(result.ok, true);
  });
});

test('checkNvmrcMatch: .nvmrc-Major identisch → ok=true', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, '.nvmrc'), '22.22.3\n');
    const result = checkNvmrcMatch(dir, '22.22.3');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.desired, '22.22.3');
    assert.strictEqual(result.currentMajor, '22');
    assert.strictEqual(result.desiredMajor, '22');
  });
});

test('checkNvmrcMatch: .nvmrc-Major unterschiedlich → ok=false', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, '.nvmrc'), '22.22.3\n');
    const result = checkNvmrcMatch(dir, '26.0.0');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.desired, '22.22.3');
    assert.strictEqual(result.currentMajor, '26');
    assert.strictEqual(result.desiredMajor, '22');
  });
});

test('checkNvmrcMatch: .nvmrc mit fuehrendem "v" wird normalisiert', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, '.nvmrc'), 'v22.22.3\n');
    const result = checkNvmrcMatch(dir, '22.22.3');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.desired, '22.22.3');
  });
});

test('checkNvmrcMatch: gleiche Major, unterschiedliche Minor → ok=true (nur Major zaehlt)', () => {
  withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, '.nvmrc'), '22.0.0\n');
    const result = checkNvmrcMatch(dir, '22.22.3');
    assert.strictEqual(result.ok, true);
  });
});

// --- formatNvmrcMismatchMessage ---

test('formatNvmrcMismatchMessage: enthaelt aktuelle Version, gewuenschte Version und Loesungs-Hint', () => {
  const msg = formatNvmrcMismatchMessage('26.0.0', '147', '22.22.3');
  assert.match(msg, /Node-Version-Mismatch/);
  assert.match(msg, /v26\.0\.0/);
  assert.match(msg, /NODE_MODULE_VERSION 147/);
  assert.match(msg, /v22\.22\.3.*laut \.nvmrc/);
  assert.match(msg, /nvm use 22\.22\.3/);
  assert.match(msg, /PATH=.*\.nvm\/versions\/node\/v22\.22\.3\/bin/);
});

// --- probeNativeModule ---

test('probeNativeModule: nicht-existierender Pfad → not-installed', () => {
  withTmpDir((dir) => {
    const result = probeNativeModule(path.join(dir, 'does-not-exist'));
    assert.strictEqual(result, 'not-installed');
  });
});

test('probeNativeModule: existiert + smoke-Test geht durch → ok', () => {
  withTmpDir((dir) => {
    const modDir = path.join(dir, 'fake-mod');
    fs.mkdirSync(modDir);
    fs.writeFileSync(
      path.join(modDir, 'index.js'),
      'module.exports = function () { return { ok: true }; };',
    );
    fs.writeFileSync(
      path.join(modDir, 'package.json'),
      JSON.stringify({ name: 'fake-mod', main: 'index.js' }),
    );
    const result = probeNativeModule(modDir, (mod) => {
      const instance = mod();
      if (!instance.ok) throw new Error('smoke failed');
    });
    assert.strictEqual(result, 'ok');
  });
});

test('probeNativeModule: smoke-Test wirft "Could not locate the bindings file" → missing-binding', () => {
  withTmpDir((dir) => {
    const modDir = path.join(dir, 'fake-mod');
    fs.mkdirSync(modDir);
    fs.writeFileSync(
      path.join(modDir, 'index.js'),
      'module.exports = function () { throw new Error("Could not locate the bindings file. Tried: a, b"); };',
    );
    fs.writeFileSync(
      path.join(modDir, 'package.json'),
      JSON.stringify({ name: 'fake-mod', main: 'index.js' }),
    );
    const result = probeNativeModule(modDir, (mod) => mod());
    assert.strictEqual(result, 'missing-binding');
  });
});

test('probeNativeModule: smoke-Test wirft ABI-Mismatch → abi-mismatch', () => {
  withTmpDir((dir) => {
    const modDir = path.join(dir, 'fake-mod');
    fs.mkdirSync(modDir);
    fs.writeFileSync(
      path.join(modDir, 'index.js'),
      'module.exports = function () { const e = new Error("compiled against NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 147"); e.code = "ERR_DLOPEN_FAILED"; throw e; };',
    );
    fs.writeFileSync(
      path.join(modDir, 'package.json'),
      JSON.stringify({ name: 'fake-mod', main: 'index.js' }),
    );
    const result = probeNativeModule(modDir, (mod) => mod());
    assert.strictEqual(result, 'abi-mismatch');
  });
});
