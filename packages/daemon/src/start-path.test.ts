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
});
