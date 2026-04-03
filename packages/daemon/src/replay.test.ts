import { describe, it, expect, afterEach } from 'vitest';
import { ReplayGuard } from './replay.js';

describe('ReplayGuard — Replay-Schutz', () => {
  let guard: ReplayGuard;

  afterEach(() => {
    guard?.stop();
  });

  it('akzeptiert neue Nachrichten', () => {
    guard = new ReplayGuard();
    expect(guard.isReplay('sender-1', 'key-1', 30_000)).toBe(false);
  });

  it('erkennt Replay innerhalb der TTL', () => {
    guard = new ReplayGuard();
    expect(guard.isReplay('sender-1', 'key-1', 30_000)).toBe(false);
    expect(guard.isReplay('sender-1', 'key-1', 30_000)).toBe(true); // Replay!
  });

  it('erlaubt gleichen Key von verschiedenen Sendern', () => {
    guard = new ReplayGuard();
    expect(guard.isReplay('sender-a', 'key-1', 30_000)).toBe(false);
    expect(guard.isReplay('sender-b', 'key-1', 30_000)).toBe(false); // Anderer Sender
  });

  it('erlaubt gleiche Nachricht nach TTL-Ablauf', async () => {
    guard = new ReplayGuard();
    expect(guard.isReplay('sender-1', 'key-1', 50)).toBe(false); // 50ms TTL

    await new Promise((r) => setTimeout(r, 100)); // Warte 100ms

    expect(guard.isReplay('sender-1', 'key-1', 50)).toBe(false); // TTL abgelaufen → ok
  });
});
