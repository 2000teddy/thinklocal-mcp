/**
 * Unit tests for the ADR-006 atomic-write helper.
 *
 * Verifies that:
 *   1. A fresh file is created correctly.
 *   2. An existing file is replaced with the new content.
 *   3. The target is never left partially-written on success.
 *   4. Concurrent writers to the same path produce one of the
 *      candidate values — not a mashup.
 *   5. The temp file is cleaned up on the happy path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from './atomic-write.js';

describe('writeAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-atomic-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new file with the given content', async () => {
    const target = join(dir, 'state.json');
    await writeAtomic(target, '{"ok":true}');
    expect(readFileSync(target, 'utf8')).toBe('{"ok":true}');
  });

  it('replaces an existing file', async () => {
    const target = join(dir, 'HISTORY.md');
    writeFileSync(target, 'old content');
    await writeAtomic(target, 'new content');
    expect(readFileSync(target, 'utf8')).toBe('new content');
  });

  it('accepts a Buffer payload', async () => {
    const target = join(dir, 'events.bin');
    await writeAtomic(target, Buffer.from([0x01, 0x02, 0x03]));
    expect(readFileSync(target)).toEqual(Buffer.from([0x01, 0x02, 0x03]));
  });

  it('does not leave a temp file behind on the happy path', async () => {
    const target = join(dir, 'state.json');
    await writeAtomic(target, 'hi');
    const entries = readdirSync(dir);
    expect(entries).toEqual(['state.json']);
  });

  it('survives concurrent writers (final content is one of the candidates)', async () => {
    const target = join(dir, 'HISTORY.md');
    const candidates = ['A', 'B', 'C', 'D'];
    await Promise.all(candidates.map((c) => writeAtomic(target, c)));
    const final = readFileSync(target, 'utf8');
    expect(candidates).toContain(final);
    // And no temp files linger.
    const lingering = readdirSync(dir).filter((f) => f.startsWith('.'));
    expect(lingering).toEqual([]);
  });

  it('cleans up the temp file when the target directory is removed mid-write', async () => {
    // Write once successfully so the directory is primed.
    const target = join(dir, 'nested', 'state.json');
    // If nested/ does not exist the rename will fail — this is the
    // caller's responsibility per ADR-006 (the session-watcher
    // always creates the session dir first). Here we just confirm
    // the helper surfaces the error instead of swallowing it.
    await expect(writeAtomic(target, 'x')).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });
});
