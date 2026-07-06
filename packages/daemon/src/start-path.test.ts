// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * T1.1 (V5 Spur 1) — Regressionstest: Der scharfe Daemon-Startpfad laeuft ueber
 * `node <…>/dist/index.js`, NICHT mehr ueber `tsx`/`src/index.ts`.
 *
 * Hintergrund: `tsx` ist eine devDependency und transpiliert zur Laufzeit
 * (esbuild-Service). Messung 2026-06-29: tsx-src ~201 MiB / 2.08s vs.
 * node-dist ~132 MiB / 1.19s (-34% RSS, -43% Start-CPU). Der Deb-Postinst
 * laeuft `npm install --omit=dev`, installiert tsx also gar nicht — der
 * Daemon MUSS daher ueber dist starten.
 *
 * Dieser Test schlaegt fehl, sobald jemand den Daemon-Start auf tsx/src
 * zuruckdreht. Die CLI- und mcp-stdio-Wrapper duerfen tsx weiter nutzen
 * (separater Pfad, hier bewusst NICHT geprueft).
 */

const here = dirname(fileURLToPath(import.meta.url)); // packages/daemon/src
const repoRoot = resolve(here, '../../..'); // → Repo-Wurzel

describe('T1.1 daemon start path uses node dist, not tsx', () => {
  it('root package.json: start + daemon:start zeigen auf dist, ohne tsx', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    for (const script of ['start', 'daemon:start']) {
      const cmd: string = pkg.scripts?.[script] ?? '';
      expect(cmd, `${script} fehlt`).not.toBe('');
      expect(cmd, `${script} muss node dist/index.js starten`).toContain(
        'node packages/daemon/dist/index.js',
      );
      expect(cmd, `${script} darf nicht via tsx starten`).not.toMatch(/tsx/);
    }
  });

  it('daemon package.json: start startet node dist/index.js', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, 'packages/daemon/package.json'), 'utf8'),
    );
    expect(pkg.scripts?.start).toBe('node dist/index.js');
  });

  it('build-deb.sh: systemd ExecStart + tlmcp-daemon-Wrapper laufen ueber dist, nicht tsx', () => {
    const sh = readFileSync(resolve(repoRoot, 'scripts/build-deb.sh'), 'utf8');
    const lines = sh.split('\n');

    // systemd Unit: ExecStart zeigt auf dist und enthaelt KEIN tsx (egal welche Loader-Form)
    expect(sh).toContain(
      'ExecStart=/usr/bin/node /opt/thinklocal-mcp/packages/daemon/dist/index.js',
    );
    const execStart = lines.filter((l) => l.startsWith('ExecStart='));
    expect(execStart.length, 'genau eine ExecStart-Zeile erwartet').toBe(1);
    expect(execStart[0], 'ExecStart darf kein tsx (--import/--loader/npx) enthalten').not.toMatch(
      /tsx/,
    );

    // CLI-Wrapper tlmcp-daemon: exec-Zeile zeigt auf dist und enthaelt KEIN tsx
    expect(sh).toContain(
      'exec node /opt/thinklocal-mcp/packages/daemon/dist/index.js "$@"',
    );
    // Nur der Daemon-Entrypoint (index.js/index.ts) — NICHT der mcp-stdio-Wrapper,
    // der bewusst weiter ueber tsx laeuft (out of scope T1.1).
    const daemonWrapperExec = lines.filter(
      (l) => l.includes('exec node') && /packages\/daemon\/(dist|src)\/index\.(js|ts)/.test(l),
    );
    expect(daemonWrapperExec.length, 'genau eine Daemon-Wrapper-exec-Zeile erwartet').toBe(1);
    expect(daemonWrapperExec[0], 'Daemon-Wrapper darf kein tsx enthalten').not.toMatch(/tsx/);
  });

  it('build-deb.sh: kompiliert dist vor dem Packen und bricht bei fehlendem dist ab', () => {
    const sh = readFileSync(resolve(repoRoot, 'scripts/build-deb.sh'), 'utf8');
    expect(sh, 'Build-Schritt (npm run build) fehlt').toMatch(
      /cd packages\/daemon && npm run build/,
    );
    expect(sh, 'Guard auf dist/index.js fehlt').toContain(
      'packages/daemon/dist/index.js nach Build nicht vorhanden',
    );
  });

  // --- install.sh: Linux systemd-User-Service wird zur Laufzeit generiert ---
  it('install.sh: generierter systemd-ExecStart laeuft ueber dist, nicht tsx + baut dist vor dem Start', () => {
    const sh = readFileSync(resolve(repoRoot, 'scripts/install.sh'), 'utf8');
    // INDEX_PATH (in den Service-Heredoc interpoliert) zeigt auf dist/index.js
    expect(sh, 'INDEX_PATH muss auf dist/index.js zeigen').toContain(
      'INDEX_PATH="$INSTALL_DIR/packages/daemon/dist/index.js"',
    );
    // Daemon-ExecStart (referenziert $INDEX_PATH; die zweite ExecStart-Zeile ist das Dashboard)
    const daemonExec = sh
      .split('\n')
      .filter((l) => l.startsWith('ExecStart=') && l.includes('$INDEX_PATH'));
    expect(daemonExec.length, 'genau eine Daemon-ExecStart-Zeile erwartet').toBe(1);
    expect(daemonExec[0]).toBe('ExecStart=$NODE_PATH $INDEX_PATH');
    expect(daemonExec[0], 'ExecStart darf kein TSX_PATH mehr referenzieren').not.toMatch(/TSX_PATH/);
    // Build-Schritt + Guard vor dem Service-Start (sonst fehlt dist/index.js)
    expect(sh, 'Daemon-Build (npx tsc) fehlt im Installer').toMatch(
      /cd "\$INSTALL_DIR\/packages\/daemon" && npx tsc/,
    );
    expect(sh, 'dist-Guard fehlt im Installer').toContain('dist/index.js fehlt');
  });

  // --- statische Service-/Plist-Templates ---
  it('thinklocal-daemon.service (statisch): ExecStart laeuft ueber dist, nicht tsx', () => {
    const svc = readFileSync(
      resolve(repoRoot, 'scripts/service/thinklocal-daemon.service'),
      'utf8',
    );
    const execStart = svc.split('\n').filter((l) => l.startsWith('ExecStart='));
    expect(execStart.length).toBe(1);
    expect(execStart[0]).toContain('packages/daemon/dist/index.js');
    expect(execStart[0]).not.toMatch(/tsx/);
  });

  it('com.thinklocal.daemon.plist (Legacy): ProgramArguments laeuft ueber dist, nicht tsx', () => {
    const plist = readFileSync(
      resolve(repoRoot, 'scripts/service/com.thinklocal.daemon.plist'),
      'utf8',
    );
    const block = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
    expect(block, 'ProgramArguments nicht gefunden').not.toBe('');
    // nur die ausfuehrbaren <string>-Argumente pruefen (nicht die XML-Kommentare)
    const strings = [...block.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([
      '__NODE_PATH__',
      '__INSTALL_DIR__/packages/daemon/dist/index.js',
    ]);
    expect(strings.join(' '), 'kein tsx/src im Daemon-Argument').not.toMatch(/tsx|src\/index\.ts/);
  });

  // --- HIGH-Regression: service.sh (macOS Legacy-LaunchAgent) muss dist bauen/garantieren ---
  it('service.sh: garantiert dist/index.js vor dem launchctl-bootstrap (HIGH-Fix)', () => {
    const sh = readFileSync(resolve(repoRoot, 'scripts/service/service.sh'), 'utf8');
    expect(sh, 'ensure_daemon_built-Guard fehlt').toContain('ensure_daemon_built');
    expect(sh, 'Build/Guard auf dist/index.js fehlt').toContain('dist/index.js');
    // im cmd_install MUSS der Guard VOR render_plist/bootstrap laufen
    const installIdx = sh.indexOf('ensure_daemon_built   # T1.1');
    const renderIdx = sh.indexOf('render_plist "$node_path"');
    expect(installIdx, 'ensure_daemon_built nicht im cmd_install').toBeGreaterThan(0);
    expect(installIdx, 'Guard muss vor render_plist stehen').toBeLessThan(renderIdx);
  });

  // --- ssh-bootstrap-trust.sh: Restart-Hinweis matcht den dist-Prozess ---
  it('ssh-bootstrap-trust.sh: pkill-Hinweis matcht dist-Daemon, nicht tsx/src', () => {
    const sh = readFileSync(resolve(repoRoot, 'scripts/ssh-bootstrap-trust.sh'), 'utf8');
    expect(sh).toContain("pkill -f 'daemon/dist/index.js'");
    expect(sh).not.toMatch(/pkill -f 'tsx\.\*src\/index\.ts'/);
  });

  // --- Windows-Scheduled-Task: Daemon ueber dist (Konsistenz, Windows out-of-scope v1) ---
  it('thinklocal-daemon.ps1: Daemon-EntryPoint ist dist\\index.js, nicht tsx/src', () => {
    const ps1 = readFileSync(
      resolve(repoRoot, 'scripts/service/thinklocal-daemon.ps1'),
      'utf8',
    );
    // EntryPoint-Zuweisung zeigt auf dist\index.js
    const entry = ps1.split('\n').find((l) => l.includes('$EntryPoint =')) ?? '';
    expect(entry, '$EntryPoint nicht gefunden').not.toBe('');
    expect(entry).toMatch(/dist\\index\.js/);
    expect(entry).not.toMatch(/src\\index\.ts/);
    // kein tsx-Loader-Pfad mehr (Kommentare duerfen "tsx" erwaehnen, Code-Zeilen nicht)
    const codeLines = ps1.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(codeLines.join('\n'), 'kein tsx-Pfad mehr im Code').not.toMatch(/tsx/);
  });
});
