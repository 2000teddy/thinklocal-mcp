/**
 * Unit-Tests für den ADR-004-Empfangs-Loop (Mesh-Messaging A3, `inbox-poller.ts`).
 * Deckt: pollInboxOnce (deliver→mark-read, at-least-once bei Zustell-Fehler,
 * Fehler-Isolation, Reihenfolge, leer) und createInboxPoller (Interval-Runner,
 * Nicht-Überlappung, Fetch-Fehler crasht den Loop nicht, start/stop).
 * KEIN Daemon/Netz/echte Timer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// requestDaemon mocken (hoisted), damit buildDaemonInboxDeps ohne echten Daemon testbar ist.
const { requestDaemonMock } = vi.hoisted(() => ({ requestDaemonMock: vi.fn() }));
vi.mock('./local-daemon-client.js', () => ({ requestDaemon: requestDaemonMock }));

import {
  pollInboxOnce,
  createInboxPoller,
  buildDaemonInboxDeps,
  type InboxPollerDeps,
  type PolledMessage,
} from './inbox-poller.js';

const msg = (id: string, over: Partial<PolledMessage> = {}): PolledMessage => ({
  message_id: id,
  from: 'spiffe://thinklocal/node/12D3KooWSender',
  subject: 's',
  body: { hello: id },
  ...over,
});

function makeDeps(over: Partial<InboxPollerDeps> = {}): {
  deps: InboxPollerDeps;
  delivered: string[];
  marked: string[];
} {
  const delivered: string[] = [];
  const marked: string[] = [];
  const deps: InboxPollerDeps = {
    fetchUnread: async () => [],
    deliver: (m) => {
      delivered.push(m.message_id);
    },
    markRead: async (id) => {
      marked.push(id);
    },
    ...over,
  };
  return { deps, delivered, marked };
}

describe('pollInboxOnce', () => {
  it('leer → 0/0/0, keine Zustellung/Markierung', async () => {
    const { deps, delivered, marked } = makeDeps();
    expect(await pollInboxOnce(deps)).toEqual({ total: 0, delivered: 0, failed: 0, markFailed: 0 });
    expect(delivered).toEqual([]);
    expect(marked).toEqual([]);
  });

  it('stellt zu UND markiert gelesen (Reihenfolge erhalten)', async () => {
    const { deps, delivered, marked } = makeDeps({
      fetchUnread: async () => [msg('a'), msg('b'), msg('c')],
    });
    const r = await pollInboxOnce(deps);
    expect(r).toEqual({ total: 3, delivered: 3, failed: 0, markFailed: 0 });
    expect(delivered).toEqual(['a', 'b', 'c']);
    expect(marked).toEqual(['a', 'b', 'c']);
  });

  it('at-least-once: Zustell-Fehler → NICHT markiert (Redelivery), Rest läuft weiter', async () => {
    const marked: string[] = [];
    const deps: InboxPollerDeps = {
      fetchUnread: async () => [msg('a'), msg('boom'), msg('c')],
      deliver: (m) => {
        if (m.message_id === 'boom') throw new Error('session down');
      },
      markRead: async (id) => {
        marked.push(id);
      },
    };
    const r = await pollInboxOnce(deps);
    expect(r).toEqual({ total: 3, delivered: 2, failed: 1, markFailed: 0 });
    // 'boom' NICHT markiert → bleibt ungelesen für den nächsten Zyklus.
    expect(marked).toEqual(['a', 'c']);
  });

  it('CR-M1: markRead-Fehler → markFailed (zugestellt, aber Duplikat kommt), NICHT failed', async () => {
    const deps: InboxPollerDeps = {
      fetchUnread: async () => [msg('a')],
      deliver: () => undefined,
      markRead: async () => {
        throw new Error('mark-read 500');
      },
    };
    expect(await pollInboxOnce(deps)).toEqual({ total: 1, delivered: 0, failed: 0, markFailed: 1 });
  });
});

describe('createInboxPoller (Interval-Runner)', () => {
  // Manueller Timer: fängt die Runner-Callback ab, um Ticks deterministisch auszulösen.
  function manualTimer(): {
    setIntervalFn: typeof setInterval;
    clearIntervalFn: typeof clearInterval;
    fire: () => void;
    cleared: () => boolean;
  } {
    let cb: (() => void) | undefined;
    let cleared = false;
    return {
      setIntervalFn: ((fn: () => void): ReturnType<typeof setInterval> => {
        cb = fn;
        return { unref: () => undefined } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        cleared = true;
      }) as unknown as typeof clearInterval,
      fire: () => cb?.(),
      cleared: () => cleared,
    };
  }

  it('start registriert Timer, tick pollt; stop cleart', async () => {
    const { deps, delivered } = makeDeps({ fetchUnread: async () => [msg('a')] });
    const t = manualTimer();
    const poller = createInboxPoller(deps, { intervalMs: 1000, setIntervalFn: t.setIntervalFn, clearIntervalFn: t.clearIntervalFn });
    expect(poller.running()).toBe(false);
    poller.start();
    expect(poller.running()).toBe(true);
    t.fire();
    await new Promise((r) => setImmediate(r)); // Mikrotask-Queue leeren
    expect(delivered).toEqual(['a']);
    poller.stop();
    expect(t.cleared()).toBe(true);
    expect(poller.running()).toBe(false);
  });

  it('nicht-überlappend: ein langsamer Zyklus blockt den zweiten Tick', async () => {
    const releases: Array<() => void> = [];
    let fetchCalls = 0;
    const deps: InboxPollerDeps = {
      fetchUnread: async () => {
        fetchCalls += 1;
        await new Promise<void>((resolve) => releases.push(resolve)); // hängt bis freigegeben
        return [];
      },
      deliver: () => undefined,
      markRead: async () => undefined,
    };
    const t = manualTimer();
    const poller = createInboxPoller(deps, { intervalMs: 1000, setIntervalFn: t.setIntervalFn, clearIntervalFn: t.clearIntervalFn });
    poller.start();
    t.fire(); // Zyklus 1 startet, hängt in fetchUnread
    await new Promise((r) => setImmediate(r));
    t.fire(); // Zyklus 2 wird durch inFlight-Guard verworfen
    await new Promise((r) => setImmediate(r));
    expect(fetchCalls).toBe(1); // nur EIN laufender Zyklus
    releases.forEach((fn) => fn()); // Zyklus 1 abschließen
    await new Promise((r) => setImmediate(r));
    t.fire(); // jetzt darf wieder gepollt werden
    await new Promise((r) => setImmediate(r));
    expect(fetchCalls).toBe(2);
    poller.stop();
  });

  it('Fetch-Fehler crasht den Loop NICHT (nächster Tick läuft)', async () => {
    let calls = 0;
    const deps: InboxPollerDeps = {
      fetchUnread: async () => {
        calls += 1;
        if (calls === 1) throw new Error('daemon unreachable');
        return [];
      },
      deliver: () => undefined,
      markRead: async () => undefined,
    };
    const t = manualTimer();
    const poller = createInboxPoller(deps, { intervalMs: 1000, setIntervalFn: t.setIntervalFn, clearIntervalFn: t.clearIntervalFn });
    poller.start();
    t.fire();
    await new Promise((r) => setImmediate(r));
    t.fire(); // trotz Fehler im ersten Tick läuft der zweite
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(2);
    poller.stop();
  });
});

describe('buildDaemonInboxDeps (Daemon-I/O gegen requestDaemon)', () => {
  const CFG = { baseUrl: 'https://localhost:9440', dataDir: '/tmp/x' };
  beforeEach(() => requestDaemonMock.mockReset());

  it('fetchUnread: GET /api/inbox?unread=true, extrahiert messages', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 200, body: JSON.stringify({ messages: [msg('a'), msg('b')] }) });
    const { fetchUnread } = buildDaemonInboxDeps(CFG);
    const out = await fetchUnread();
    expect(out.map((m) => m.message_id)).toEqual(['a', 'b']);
    const [path] = requestDaemonMock.mock.calls[0] as [string, unknown];
    expect(path).toBe('/api/inbox?unread=true');
  });

  it('fetchUnread: for_instance wird URL-enkodiert angehängt', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 200, body: '{"messages":[]}' });
    const { fetchUnread } = buildDaemonInboxDeps({ ...CFG, forInstance: 'spiffe://thinklocal/host/HUB/agent/claude-code/instance/i1' });
    await fetchUnread();
    const [path] = requestDaemonMock.mock.calls[0] as [string, unknown];
    expect(path).toBe('/api/inbox?unread=true&for_instance=spiffe%3A%2F%2Fthinklocal%2Fhost%2FHUB%2Fagent%2Fclaude-code%2Finstance%2Fi1');
  });

  it('fetchUnread: non-2xx → wirft', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 500, body: 'boom' });
    await expect(buildDaemonInboxDeps(CFG).fetchUnread()).rejects.toThrow(/HTTP 500/);
  });

  it('fetchUnread: malformter JSON-2xx-Body → klarer Fehler (CR-M2)', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 200, body: 'not json' });
    await expect(buildDaemonInboxDeps(CFG).fetchUnread()).rejects.toThrow(/malformed JSON/);
  });

  it('fetchUnread: fehlendes messages-Array → [] (defensiv)', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 200, body: '{}' });
    expect(await buildDaemonInboxDeps(CFG).fetchUnread()).toEqual([]);
  });

  it('markRead: POST /api/inbox/mark-read mit message_id; non-2xx → wirft', async () => {
    requestDaemonMock.mockResolvedValueOnce({ status: 200, body: '{"status":"marked_read"}' });
    await buildDaemonInboxDeps(CFG).markRead('m1');
    const [path, opts] = requestDaemonMock.mock.calls[0] as [string, { method?: string; body?: unknown }];
    expect(path).toBe('/api/inbox/mark-read');
    expect(opts.method).toBe('POST');
    expect(opts.body).toEqual({ message_id: 'm1' });

    requestDaemonMock.mockResolvedValueOnce({ status: 503, body: '' });
    await expect(buildDaemonInboxDeps(CFG).markRead('m2')).rejects.toThrow(/mark-read failed: HTTP 503/);
  });
});
