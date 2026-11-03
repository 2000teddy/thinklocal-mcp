// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * Regression-Tests zu den 6 Review-Befunden an `pop-canonicalize.ts` (PR nach #362).
 * Jeder Test ist einem Fund zugeordnet und schlägt gegen die Vorversion fehl.
 *
 * Das Skript liegt bewusst unter `scripts/` und ist damit ausserhalb von `tsconfig.json` ("include":
 * ["src/**"]) und `npm run lint` — diese Datei ist deshalb die EINZIGE Absicherung, dass die Fixes
 * nicht stillschweigend zurückfallen. Vitest sammelt sie (kein `include`-Override in vitest.config.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync, symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dispatcher } from 'undici';
import {
  parseArgs,
  assertOnboarded,
  createMtlsFetch,
  backupExistingTls,
  buildConnectOptions,
  BACKUP_DIR_MODE,
  DEFAULT_SERVERNAME,
} from './pop-canonicalize.js';
import { LIBP2P_KEY_FILENAME } from '../src/libp2p-identity.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Entfernt Kommentare und String-/Template-Inhalte per Zustandsautomat. Regex scheitert hier:
 * ein `//[^\n]*`-Strip frisst das `//` in `spiffe://…` INNERHALB eines Template-Literals und
 * zerlegt alles danach (genau so fiel der erste Versuch durch). `${…}`-Interpolationen gelten
 * als Code — sonst wäre ein nur dort benutzter Import „unbenutzt" (Fehlalarm).
 *
 * BEKANNTE GRENZE (CR Runde 2): kein eigener Zustand für Regex-Literale. Solange
 * `pop-canonicalize.ts` nur `/[:.]/g` enthält, ist das folgenlos; ein später ergänztes `/'/`,
 * `/https?:\/\//` oder `/[/*]/` würde den Automaten in den String- bzw. Kommentar-Zustand
 * kippen und Code verschlucken. Die Fehlerrichtung ist dann **falsch-positiv** — der Test wird
 * rot und meldet benutzte Imports als unbenutzt, statt still durchzulassen. Wer so ein Literal
 * einführt, braucht hier einen Regex-Zustand.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | "'" | '"' | '`';
  let state: State = 'code';
  // Stack der offenen Template-Literale; pro Eintrag die `{`-Tiefe der laufenden `${…}`-Interpolation.
  const templates: { depth: number }[] = [];
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"') { state = c; i++; continue; }
      if (c === '`') { state = '`'; templates.push({ depth: 0 }); i++; continue; }
      const open = templates[templates.length - 1];
      if (open !== undefined) {
        // Innerhalb einer `${…}`-Interpolation: `}` auf Tiefe 0 führt zurück ins Template.
        if (c === '{') open.depth++;
        else if (c === '}') {
          if (open.depth === 0) { state = '`'; i++; continue; }
          open.depth--;
        }
      }
      out += c;
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; }
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i += 2; continue; }
      i++;
      continue;
    }
    // in einem String oder Template
    if (c === '\\') { i += 2; continue; }
    if (state === '`' && c === '$' && next === '{') {
      // Interpolation ist CODE — sonst gilt ein nur dort benutzter Import als unbenutzt.
      state = 'code';
      out += ' ';
      i += 2;
      continue;
    }
    if (c === state) {
      if (state === '`') templates.pop();
      state = 'code';
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** Liefert die Namen aller Imports, die im eigentlichen Code nicht vorkommen. */
function findUnusedImports(src: string): string[] {
  const importRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'[^']+';/g;
  const specs = [...src.matchAll(importRe)].map((m) => m[1]);
  const body = stripCommentsAndStrings(src.replace(importRe, ''));
  const unused: string[] = [];
  for (const spec of specs) {
    const names = spec
      .replace(/[{}]/g, ',')
      .split(',')
      .map((n) => (n.replace(/^\s*type\s+/, '').split(/\s+as\s+/).at(-1) ?? '').trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    for (const n of names) {
      if (!new RegExp(`\\b${n}\\b`).test(body)) unused.push(n);
    }
  }
  return unused;
}

let dataDir: string;

/** Legt einen vollständig onboardeten Peer an (Cert/Key/CA + persistierter libp2p-Key). */
function seedOnboardedPeer(dir: string, opts: { libp2pKey?: boolean } = {}): void {
  const tlsDir = resolve(dir, 'tls');
  mkdirSync(tlsDir, { recursive: true });
  writeFileSync(resolve(tlsDir, 'node.crt.pem'), 'cert');
  writeFileSync(resolve(tlsDir, 'node.key.pem'), 'key', { mode: 0o600 });
  writeFileSync(resolve(tlsDir, 'ca.crt.pem'), 'ca');
  if (opts.libp2pKey !== false) {
    mkdirSync(resolve(dir, 'keys'), { recursive: true });
    writeFileSync(resolve(dir, 'keys', LIBP2P_KEY_FILENAME), 'k', { mode: 0o600 });
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(resolve(tmpdir(), 'pop-canon-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('liefert Defaults inkl. servername=localhost (Fund 5)', () => {
    const args = parseArgs([]);
    expect(args.servername).toBe(DEFAULT_SERVERNAME);
    expect(args.servername).toBe('localhost');
    expect(args.adminUrl).toBe('https://10.10.10.80:9440');
    expect(args.dryRun).toBe(false);
  });

  it('erlaubt --servername zu überschreiben (Fund 5: vorher hartcodiert)', () => {
    expect(parseArgs(['--servername', 'admin.lan']).servername).toBe('admin.lan');
  });

  it('nimmt --admin-url, --data-dir und --dry-run', () => {
    const args = parseArgs(['--admin-url', 'https://1.2.3.4:9440', '--data-dir', '/tmp/x', '--dry-run']);
    expect(args.adminUrl).toBe('https://1.2.3.4:9440');
    expect(args.dataDir).toBe(resolve('/tmp/x'));
    expect(args.dryRun).toBe(true);
  });

  it('ignoriert ein Flag ohne Wert statt es zu verschlucken', () => {
    expect(parseArgs(['--servername']).servername).toBe(DEFAULT_SERVERNAME);
  });

  it('verschluckt das Folge-Flag nicht als Optionswert (CR-NIT 2)', () => {
    const args = parseArgs(['--servername', '--dry-run']);
    expect(args.servername).toBe(DEFAULT_SERVERNAME);
    expect(args.dryRun).toBe(true);
  });
});

describe('buildConnectOptions (Fund 5 an der Senke, CR-LOW 1)', () => {
  const pems = { ca: 'CA', cert: 'CERT', key: 'KEY' };

  it('reicht den geparsten servername an die mTLS-Optionen durch', () => {
    const opts = buildConnectOptions(parseArgs(['--servername', 'admin.lan']), pems);
    expect(opts.servername).toBe('admin.lan');
  });

  it('nimmt ohne Flag den Default — nicht hartcodiert, sondern aus den Args', () => {
    expect(buildConnectOptions(parseArgs([]), pems).servername).toBe(DEFAULT_SERVERNAME);
    expect(buildConnectOptions({ servername: 'x.y' }, pems).servername).toBe('x.y');
  });

  it('behält mTLS-Material und rejectUnauthorized', () => {
    const opts = buildConnectOptions(parseArgs([]), pems);
    expect(opts).toMatchObject({ ca: ['CA'], cert: 'CERT', key: 'KEY', rejectUnauthorized: true });
  });
});

describe('assertOnboarded (Fund 3: keine stille Identitäts-Neuerzeugung)', () => {
  it('geht durch, wenn Cert, Key, CA und libp2p-Key da sind', () => {
    seedOnboardedPeer(dataDir);
    expect(() => assertOnboarded(dataDir)).not.toThrow();
  });

  it('bricht ab, wenn NUR der libp2p-Key fehlt — der eigentliche Fund 3', () => {
    seedOnboardedPeer(dataDir, { libp2pKey: false });
    expect(() => assertOnboarded(dataDir)).toThrow(/libp2p-ed25519\.key/);
    expect(() => assertOnboarded(dataDir)).toThrow(/NEUE PeerID/);
  });

  it('bricht ab, wenn das Node-Cert fehlt', () => {
    seedOnboardedPeer(dataDir);
    rmSync(resolve(dataDir, 'tls', 'node.crt.pem'));
    expect(() => assertOnboarded(dataDir)).toThrow(/node\.crt\.pem/);
  });
});

describe('createMtlsFetch', () => {
  function fakeDispatcher(calls: Dispatcher.RequestOptions[]): Dispatcher {
    return {
      request: async (opts: Dispatcher.RequestOptions): Promise<unknown> => {
        calls.push(opts);
        return { statusCode: 200, body: { text: async (): Promise<string> => '{"nonce":"n"}' } };
      },
    } as unknown as Dispatcher;
  }

  it('leitet das AbortSignal durch (Fund 2: timeoutMs war wirkungslos)', async () => {
    const calls: Dispatcher.RequestOptions[] = [];
    const signal = AbortSignal.timeout(5_000);
    const res = await createMtlsFetch(fakeDispatcher(calls))('https://a.b:9440/api/cert/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal).toBe(signal);
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual({ nonce: 'n' });
  });

  it('benutzt den übergebenen dispatcher statt des Fallbacks (Fund 6)', async () => {
    const fallbackCalls: Dispatcher.RequestOptions[] = [];
    const explicitCalls: Dispatcher.RequestOptions[] = [];
    await createMtlsFetch(fakeDispatcher(fallbackCalls))('https://a.b:9440/api/cert/sign', {
      method: 'POST',
      headers: {},
      dispatcher: fakeDispatcher(explicitCalls),
    });
    expect(explicitCalls).toHaveLength(1);
    expect(fallbackCalls).toHaveLength(0);
  });

  it('fällt auf den eigenen Agent zurück, wenn kein dispatcher mitkommt (Fund 6)', async () => {
    const fallbackCalls: Dispatcher.RequestOptions[] = [];
    await createMtlsFetch(fakeDispatcher(fallbackCalls))('https://a.b:9440/x?q=1', {
      method: 'POST',
      headers: {},
    });
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0].origin).toBe('https://a.b:9440');
    expect(fallbackCalls[0].path).toBe('/x?q=1');
  });

  it('meldet ok=false bei 4xx/5xx statt zu werfen', async () => {
    const d = {
      request: async (): Promise<unknown> => ({
        statusCode: 403,
        body: { text: async (): Promise<string> => 'nope' },
      }),
    } as unknown as Dispatcher;
    const res = await createMtlsFetch(d)('https://a.b/x', { method: 'POST', headers: {} });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toBe('nope');
  });
});

describe('backupExistingTls (Fund 4: Backup-Ordner war welt-lesbar)', () => {
  it('legt das Verzeichnis mit 0700 an', () => {
    seedOnboardedPeer(dataDir);
    const dir = backupExistingTls(resolve(dataDir, 'tls'), 'stamp');
    expect(statSync(dir).mode & 0o777).toBe(BACKUP_DIR_MODE);
    expect(BACKUP_DIR_MODE).toBe(0o700);
  });

  it('kopiert Cert, Key und CA und behält den Key-Modus 0600', () => {
    seedOnboardedPeer(dataDir);
    const dir = backupExistingTls(resolve(dataDir, 'tls'), 'stamp');
    for (const n of ['node.crt.pem', 'node.key.pem', 'ca.crt.pem']) {
      expect(existsSync(resolve(dir, n))).toBe(true);
    }
    expect(statSync(resolve(dir, 'node.key.pem')).mode & 0o777).toBe(0o600);
  });

  it('überspringt fehlende Dateien statt zu werfen', () => {
    const tlsDir = resolve(dataDir, 'tls');
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(resolve(tlsDir, 'ca.crt.pem'), 'ca');
    const dir = backupExistingTls(tlsDir, 'stamp');
    expect(existsSync(resolve(dir, 'ca.crt.pem'))).toBe(true);
    expect(existsSync(resolve(dir, 'node.crt.pem'))).toBe(false);
  });
});

describe('Modul-Form', () => {
  it('startet main() auch über einen Symlink (CR-NIT 1: realpathSync auf beiden Seiten)', () => {
    // Beweist beides: der Guard greift bei echtem Aufruf UND er scheitert nicht am Symlink.
    seedOnboardedPeer(dataDir);
    const link = resolve(dataDir, 'pop-link.ts');
    symlinkSync(resolve(HERE, 'pop-canonicalize.ts'), link);
    const run = spawnSync(
      'npx',
      ['tsx', link, '--dry-run', '--data-dir', dataDir, '--servername', 'probe.lan'],
      { cwd: HERE, encoding: 'utf-8', timeout: 60_000 },
    );
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    // main() ist gelaufen (Kopfzeilen + durchgereichter servername). Dass es danach am
    // Fixture-Key scheitert, ist erwartet — der Guard ist damit bewiesen.
    expect(out).toContain('=== PoP-Kanonisierung');
    expect(out).toContain('servername: probe.lan');
  }, 70_000);

  it('führt beim Import nichts aus — main() hängt am Direktaufruf-Guard', () => {
    // Dieser Test läuft überhaupt nur, weil der Import oben keinen Cert-Request gestartet hat.
    expect(typeof parseArgs).toBe('function');
    const src = readFileSync(resolve(HERE, 'pop-canonicalize.ts'), 'utf-8');
    expect(src).toMatch(/if \(invokedDirectly\)/);
  });

  it('hat keine unbenutzten Imports (Fund 1 — von tsc/eslint nicht abgedeckt)', () => {
    const src = readFileSync(resolve(HERE, 'pop-canonicalize.ts'), 'utf-8');
    expect(findUnusedImports(src)).toEqual([]);
  });

  it('die Heuristik findet einen toten Import trotz Erwähnung in Kommentar und String (CR-LOW 2)', () => {
    // Selbsttest: ohne das Strippen von Kommentaren/Strings wäre das Ergebnis leer (falsch-negativ),
    // und ein naiver `//`-Strip zerlegt an einer URL im Template-Literal.
    const fake = [
      '/** nutzt deadA nur im Kommentar */',
      "import { deadA, used } from './x.js';",
      "import def, { alsoUsed } from './y.js';",
      "import type { DeadType } from './z.js';",
      'export const url = `spiffe://thinklocal/node/${used}`; // deadB',
      "const s = 'deadA';",
      'export const a = alsoUsed + def;',
    ].join('\n');
    expect(findUnusedImports(fake)).toEqual(['deadA', 'DeadType']);
  });
});
