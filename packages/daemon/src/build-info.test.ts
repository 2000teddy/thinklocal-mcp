import { describe, it, expect } from 'vitest';
import { loadBuildInfo } from './build-info.js';

const HOST = (): string => 'test-node';

function fileMap(map: Record<string, string>): (p: string) => string {
  return (p: string) => {
    const hit = Object.entries(map).find(([k]) => p.endsWith(k));
    if (!hit) throw new Error(`ENOENT ${p}`);
    return hit[1];
  };
}

describe('loadBuildInfo', () => {
  it('VERSION-Datei + BUILD-Datei haben Vorrang vor git', () => {
    const info = loadBuildInfo('/repo', {
      readFile: fileMap({ VERSION: '1.2.3\n', BUILD: 'ci-4242\n' }),
      runGit: () => { throw new Error('git should not be called'); },
      hostnameFn: HOST,
    });
    expect(info).toMatchObject({ build_version: '1.2.3', build_number: 'ci-4242', build_node: 'test-node' });
  });

  it('ohne VERSION → package.json version; ohne BUILD → git short SHA + commit-Datum', () => {
    const info = loadBuildInfo('/repo', {
      readFile: fileMap({ 'package.json': JSON.stringify({ version: '0.31.1' }) }),
      runGit: (args) => (args.startsWith('rev-parse') ? 'abc1234\n' : '2026-06-05T10:00:00+02:00\n'),
      hostnameFn: HOST,
    });
    expect(info).toEqual({
      build_version: '0.31.1',
      build_number: 'abc1234',
      build_node: 'test-node',
      build_date: '2026-06-05T10:00:00+02:00',
    });
  });

  it('weder Dateien noch git → unknown / null (kein Crash)', () => {
    const info = loadBuildInfo('/repo', {
      readFile: () => { throw new Error('ENOENT'); },
      runGit: () => { throw new Error('not a git repo'); },
      hostnameFn: HOST,
    });
    expect(info).toEqual({ build_version: 'unknown', build_number: 'unknown', build_node: 'test-node', build_date: null });
  });

  it('build_node kommt aus hostnameFn', () => {
    const info = loadBuildInfo('/repo', {
      readFile: fileMap({ VERSION: '9.9.9' }),
      runGit: () => 'x',
      hostnameFn: () => 'minimac-94',
    });
    expect(info.build_node).toBe('minimac-94');
  });
});
