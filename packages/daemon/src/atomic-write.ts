/**
 * ADR-006 Phase 1 — Atomic Write Helper
 *
 * Writes arbitrary content to a target path via the classic
 * "write tmp → fsync → rename" dance. On POSIX the final `rename`
 * is atomic within a filesystem, so a reader can never observe a
 * half-written file, even if the daemon crashes mid-write.
 *
 * Used by the session-watcher / recovery-generator pipeline to
 * update HISTORY.md / START-PROMPT.md / state.json derived-view
 * files without corrupting them. ADR-006 section "Atomic Write
 * Helper" pins this as the single-writer guarantee: the daemon is
 * the only process that writes these files, and the agent only
 * ever reads.
 *
 * See: docs/architecture/ADR-006-session-persistence.md §Architektur/5
 */
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Write `content` to `path` atomically.
 *
 * Steps:
 *   1. Open a uniquely-named temp file in the same directory.
 *   2. Write the full content.
 *   3. fsync (so the bytes are on disk).
 *   4. Close.
 *   5. rename(temp, target) — atomic on POSIX within one filesystem.
 *
 * If the temp-file write fails we best-effort-delete the temp file
 * and re-throw. If the rename fails we also clean the temp. The
 * target is only ever replaced by a fully-written file.
 *
 * @param path     absolute destination path
 * @param content  file body, any length
 */
export async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  const dir = dirname(path);
  // Dot-prefix the temp name so `ls`/globs don't accidentally pick
  // it up, and UUID-suffix to avoid collisions between concurrent
  // writers targeting the same file (even though ADR-006 enforces
  // single-writer, a test suite might run multiple writes in
  // parallel).
  const tmp = join(dir, `.${basename(path)}.tmp-${randomUUID()}`);

  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(tmp, 'wx'); // wx = exclusive create, fail if exists
    await fh.writeFile(content);
    await fh.sync();
  } catch (err) {
    // Best-effort cleanup of any partial temp. We swallow cleanup
    // errors because the primary error is what matters — the
    // caller cannot meaningfully act on a failed unlink during a
    // failed write. Filesystem-level issues (permissions, ENOSPC)
    // surface via the primary `err` below. If you need deeper
    // diagnostics, enable Node's `NODE_DEBUG=fs`. (Gemini-Pro CR
    // LOW 2026-04-09)
    if (fh) {
      try {
        await fh.close();
      } catch {
        /* noop */
      }
    }
    try {
      await unlink(tmp);
    } catch {
      /* noop */
    }
    throw err;
  }
  await fh.close();

  try {
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      /* noop */
    }
    throw err;
  }
}
