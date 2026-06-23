/**
 * Unit-Tests für ADR-029 LaunchDaemon-Renderer/Validator (rein, kein I/O).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderLaunchDaemonPlist,
  validateLaunchDaemonContext,
  assertRenderedPlistClean,
  escapeXml,
  type LaunchDaemonContext,
} from './launchd-plist.js';

// Das echte Template (single source of truth) wird mitgetestet, damit Template-Drift auffällt.
const TEMPLATE_PATH = join(__dirname, '..', '..', '..', 'scripts', 'service', 'com.thinklocal.daemon.plist.template');
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');

const validCtx = (): LaunchDaemonContext => ({
  nodeBin: '/opt/homebrew/bin/node',
  repoDir: '/opt/thinklocal-mcp',
  dataDir: '/Users/svc-thinklocal/.thinklocal',
  runUser: 'svc-thinklocal',
  runGroup: 'staff',
});

describe('validateLaunchDaemonContext', () => {
  it('akzeptiert einen vollständigen, absoluten Kontext', () => {
    expect(validateLaunchDaemonContext(validCtx())).toEqual([]);
  });

  it('lehnt relative/leere Pfade ab', () => {
    const errors = validateLaunchDaemonContext({ ...validCtx(), nodeBin: 'node', repoDir: '' });
    expect(errors.some((e) => e.includes('nodeBin'))).toBe(true);
    expect(errors.some((e) => e.includes('repoDir'))).toBe(true);
  });

  it('lehnt Benutzer/Gruppe mit Whitespace oder leer ab', () => {
    const errors = validateLaunchDaemonContext({ ...validCtx(), runUser: 'two words', runGroup: '' });
    expect(errors.some((e) => e.includes('runUser'))).toBe(true);
    expect(errors.some((e) => e.includes('runGroup'))).toBe(true);
  });

  it('prüft configPath nur wenn gesetzt', () => {
    expect(validateLaunchDaemonContext({ ...validCtx(), configPath: undefined })).toEqual([]);
    expect(validateLaunchDaemonContext({ ...validCtx(), configPath: 'relative.toml' })).toContainEqual(
      expect.stringContaining('configPath'),
    );
  });
});

describe('renderLaunchDaemonPlist', () => {
  it('rendert ein sauberes Plist ohne verbliebene Platzhalter', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, validCtx());
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(out).not.toMatch(/__[A-Z_]+__/);
    expect(out).toContain('<string>/opt/homebrew/bin/node</string>');
    expect(out).toContain('<string>svc-thinklocal</string>'); // UserName
    expect(out).toContain('<string>staff</string>'); // GroupName
  });

  it('setzt UserName/GroupName (LaunchDaemon läuft NICHT als root)', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, validCtx());
    expect(out).toMatch(/<key>UserName<\/key>\s*<string>svc-thinklocal<\/string>/);
    expect(out).toMatch(/<key>GroupName<\/key>\s*<string>staff<\/string>/);
  });

  it('defaultet CONFIG auf <repo>/config/daemon.toml', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, validCtx());
    expect(out).toContain('<string>/opt/thinklocal-mcp/config/daemon.toml</string>');
  });

  it('respektiert einen expliziten configPath', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, { ...validCtx(), configPath: '/etc/thinklocal/daemon.toml' });
    expect(out).toContain('<string>/etc/thinklocal/daemon.toml</string>');
  });

  it('leitet Log-Pfade aus DATA_DIR ab', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, validCtx());
    expect(out).toContain('<string>/Users/svc-thinklocal/.thinklocal/logs/daemon.log</string>');
    expect(out).toContain('<string>/Users/svc-thinklocal/.thinklocal/logs/daemon.error.log</string>');
  });

  it('wirft fail-closed bei ungültigem Kontext (relativer nodeBin)', () => {
    expect(() => renderLaunchDaemonPlist(TEMPLATE, { ...validCtx(), nodeBin: 'node' })).toThrow(/ungültiger Kontext/);
  });

  it('wirft, wenn das Template einen unbekannten Platzhalter enthält', () => {
    const bad = TEMPLATE + '\n<!-- {{UNKNOWN_PLACEHOLDER}} -->';
    expect(() => renderLaunchDaemonPlist(bad, validCtx())).toThrow(/unbekannte Platzhalter/);
  });

  it('das echte Template enthält KEINE hartkodierten Benutzer-/Pfad-Literale', () => {
    // Regressionsschutz gegen ein Zurückrutschen auf __HOME__/chris/staff im Template.
    expect(TEMPLATE).not.toContain('/Users/chris');
    expect(TEMPLATE).not.toMatch(/__[A-Z_]+__/); // alte LaunchAgent-Platzhalter
    expect(TEMPLATE).toContain('{{RUN_USER}}');
    expect(TEMPLATE).toContain('{{NODE_BIN}}');
  });
});

describe('assertRenderedPlistClean', () => {
  it('akzeptiert ein vollständig ersetztes Plist', () => {
    expect(() => assertRenderedPlistClean('<plist>/opt/x</plist>')).not.toThrow();
  });

  it('wirft bei verbliebenem {{…}}-Platzhalter (z.B. fehlerhaftes sed im Installer)', () => {
    expect(() => assertRenderedPlistClean('<string>{{NODE_BIN}}</string>')).toThrow(/unersetzte Platzhalter/);
  });

  // CR-MEDIUM: auch non-uppercase {{…}} muss gefangen werden (sonst stiller Durchrutscher).
  it('wirft auch bei {{lowercase}}/{{Mixed}}-Platzhaltern', () => {
    expect(() => assertRenderedPlistClean('<string>{{version}}</string>')).toThrow(/unersetzte Platzhalter/);
    expect(() => assertRenderedPlistClean('<string>{{ConfigFile}}</string>')).toThrow(/unersetzte Platzhalter/);
  });

  it('wirft bei verbliebenem Legacy-__…__-Platzhalter', () => {
    expect(() => assertRenderedPlistClean('<string>__HOME__/x</string>')).toThrow(/Legacy-Platzhalter/);
  });
});

// CR-HIGH: XML-Escaping gegen ungültiges Plist + Element-Injection.
describe('escapeXml + Render-Escaping', () => {
  it('escaped die fünf XML-Metazeichen', () => {
    expect(escapeXml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });

  it('escaped & in einem Pfad statt ungültiges XML zu erzeugen', () => {
    const out = renderLaunchDaemonPlist(TEMPLATE, { ...validCtx(), dataDir: '/opt/foo&bar/.thinklocal' });
    expect(out).toContain('/opt/foo&amp;bar/.thinklocal');
    expect(out).not.toMatch(/foo&bar/); // kein rohes & im Output
  });

  it('verhindert XML-Element-Injection über einen bösartigen Pfad-Wert', () => {
    const inject = '/opt/x</string><string>/bin/evil.sh</string><string>/ignored';
    const out = renderLaunchDaemonPlist(TEMPLATE, { ...validCtx(), repoDir: inject });
    expect(out).not.toContain('<string>/bin/evil.sh</string>'); // NICHT als echtes Element injiziert
    expect(out).toContain('&lt;/string&gt;&lt;string&gt;'); // escaped als Text
  });
});
