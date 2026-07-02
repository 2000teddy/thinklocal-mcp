/**
 * inbox-poller.ts — ADR-004-Empfangs-Loop (Mesh-Messaging A3, code-only).
 *
 * Wiederverwendbare, deploy-agnostische Primitive für zyklisches Inbox-Polling:
 * `unread → deliver → mark-read`. Ein Agent-Supervisor/Hook (Agent-Home, NICHT im
 * Repo) verdrahtet die eigentliche Session-Zustellung über den `deliver`-Callback;
 * dieses Modul kapselt nur die Poll-/Mark-Read-/Fehler-Isolations-Logik.
 *
 * **At-least-once:** `mark-read` passiert ERST nach erfolgreicher `deliver`. Schlägt
 * `deliver` fehl, bleibt die Nachricht ungelesen → Redelivery im nächsten Zyklus
 * (Dedupe über `message_id` beim Konsumenten). So geht keine Nachricht durch einen
 * Zustell-Crash verloren.
 *
 * Reine Logik: Netz/Timer sind injizierbar → vollständig ohne Daemon/Netz unit-testbar.
 */
import type { Logger } from 'pino';
import { requestDaemon } from './local-daemon-client.js';

/** Eine aus der Inbox gepollte Nachricht (Teilmenge von GET /api/inbox). */
export interface PolledMessage {
  message_id: string;
  from: string;
  subject?: string | null;
  body: unknown;
  received_at?: string;
  to_instance?: string | null;
  in_reply_to?: string | null;
}

export interface InboxPollerDeps {
  /** Holt die aktuell ungelesenen Nachrichten (real: GET /api/inbox?unread=true[&for_instance]). */
  fetchUnread: () => Promise<PolledMessage[]>;
  /** Markiert eine Nachricht als gelesen (real: POST /api/inbox/mark-read). */
  markRead: (messageId: string) => Promise<void>;
  /** Zustellung in die Agent-Session (Agent-Home). Wirft bei Fehlschlag → kein mark-read. */
  deliver: (message: PolledMessage) => Promise<void> | void;
  log?: Logger;
}

/**
 * Ergebnis eines Poll-Zyklus. `failed` und `markFailed` sind bewusst getrennt
 * (CR-M1): sie haben unterschiedliche Semantik für den Betrieb.
 */
export interface PollResult {
  /** Anzahl geholter ungelesener Nachrichten. */
  total: number;
  /** Zugestellt UND als gelesen markiert (abgeschlossen). */
  delivered: number;
  /** Zustellung fehlgeschlagen → NICHT gelesen, sichere Redelivery nächster Zyklus. */
  failed: number;
  /** Zugestellt, aber mark-read fehlgeschlagen → wird nächsten Zyklus ERNEUT zugestellt
   *  (at-least-once Duplikat; Konsument dedupt per message_id). Getrennt von `failed`,
   *  damit Betrieb „sicher wartend" von „Duplikat kommt" unterscheiden kann. */
  markFailed: number;
}

/**
 * Ein Poll-Zyklus: ungelesene holen, je Nachricht zustellen und (nur bei Erfolg)
 * als gelesen markieren. Pro-Nachricht fehler-isoliert; ein Fetch-Fehler propagiert
 * (der Runner fängt ihn). Reihenfolge bleibt erhalten (sequentiell, kein Reordering).
 */
export async function pollInboxOnce(deps: InboxPollerDeps): Promise<PollResult> {
  const messages = await deps.fetchUnread();
  let delivered = 0;
  let failed = 0;
  let markFailed = 0;
  for (const message of messages) {
    let didDeliver = false;
    try {
      await deps.deliver(message);
      didDeliver = true;
      await deps.markRead(message.message_id);
      delivered += 1;
    } catch (err) {
      const detail = { message_id: message.message_id, err: err instanceof Error ? err.message : String(err) };
      if (didDeliver) {
        // Zugestellt, aber mark-read schlug fehl → nächster Zyklus liefert erneut (Duplikat).
        markFailed += 1;
        deps.log?.warn(detail, '[inbox-poller] delivered but mark-read failed — will redeliver (dedup by message_id)');
      } else {
        // Zustellung schlug fehl → bleibt ungelesen, sichere Redelivery.
        failed += 1;
        deps.log?.warn(detail, '[inbox-poller] delivery failed — left unread for redelivery');
      }
    }
  }
  return { total: messages.length, delivered, failed, markFailed };
}

export interface InboxPoller {
  start: () => void;
  stop: () => void;
  running: () => boolean;
}

export interface InboxPollerOptions {
  intervalMs: number;
  /** Timer-Injektion für Tests; Default globales setInterval/clearInterval. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Interval-Runner um `pollInboxOnce`. **Nicht-überlappend** (ein noch laufender Zyklus
 * wird nicht erneut gestartet — schützt vor Doppel-Zustellung bei langsamem `deliver`),
 * fehler-gekapselt (ein Zyklus-Fehler crasht den Loop nie), `unref()` (blockiert den
 * Prozess-Exit nicht).
 *
 * CR-L2: `stop()` ist KEIN Quiesce — es beendet den Interval, lässt aber einen bereits
 * laufenden Zyklus (inkl. `markRead`) sauber zu Ende laufen (kein torn cycle, kein
 * verlorener mark-read). `stop()` wartet NICHT auf den Drain.
 */
export function createInboxPoller(deps: InboxPollerDeps, opts: InboxPollerOptions): InboxPoller {
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return; // Überlappungs-Schutz
    inFlight = true;
    try {
      await pollInboxOnce(deps);
    } catch (err) {
      deps.log?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[inbox-poller] poll cycle failed (daemon unreachable?) — retrying next tick',
      );
    } finally {
      inFlight = false;
    }
  };

  return {
    start(): void {
      if (timer) return;
      timer = setIntervalFn(() => void tick(), opts.intervalMs);
      // unref falls vorhanden (Node-Timer) — blockiert den Prozess-Exit nicht.
      (timer as { unref?: () => void }).unref?.();
    },
    stop(): void {
      if (timer) {
        clearIntervalFn(timer);
        timer = undefined;
      }
    },
    running(): boolean {
      return timer !== undefined;
    },
  };
}

export interface DaemonInboxPollerConfig {
  baseUrl: string;
  dataDir: string;
  /** Kanonische Instanz-URI (A1) → nur an diese Instanz adressierte Nachrichten pollen. */
  forInstance?: string;
  deliver: (message: PolledMessage) => Promise<void> | void;
  intervalMs: number;
  log?: Logger;
}

/**
 * Baut die Daemon-I/O-Closures (`fetchUnread`/`markRead`) gegen den lokalen Daemon
 * (mTLS via `requestDaemon`). `fetchUnread` liest `GET /api/inbox?unread=true[&for_instance=<uri>]`,
 * `markRead` postet `POST /api/inbox/mark-read`. Non-2xx → Fehler (Runner isoliert ihn).
 * Exportiert für Unit-Tests (I/O-Vertrag ohne Interval-Runner).
 */
export function buildDaemonInboxDeps(
  config: Pick<DaemonInboxPollerConfig, 'baseUrl' | 'dataDir' | 'forInstance'>,
): { fetchUnread: () => Promise<PolledMessage[]>; markRead: (messageId: string) => Promise<void> } {
  const fetchUnread = async (): Promise<PolledMessage[]> => {
    const params = ['unread=true'];
    if (config.forInstance) params.push(`for_instance=${encodeURIComponent(config.forInstance)}`);
    const res = await requestDaemon(`/api/inbox?${params.join('&')}`, {
      baseUrl: config.baseUrl,
      dataDir: config.dataDir,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`inbox fetch failed: HTTP ${res.status}`);
    }
    // CR-M2: klarer Fehler bei non-JSON-2xx-Body (statt eines nackten SyntaxError, der
    // in den Runner-Logs von „daemon down" ununterscheidbar wäre). CR-L1: der `as`-Cast
    // ist trusted-source (loopback-authentifizierter Daemon); Extra-Felder werden ignoriert.
    let parsed: { messages?: PolledMessage[] };
    try {
      parsed = JSON.parse(res.body) as { messages?: PolledMessage[] };
    } catch {
      throw new Error(`inbox fetch: malformed JSON body (HTTP ${res.status})`);
    }
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  };

  const markRead = async (messageId: string): Promise<void> => {
    const res = await requestDaemon('/api/inbox/mark-read', {
      baseUrl: config.baseUrl,
      dataDir: config.dataDir,
      method: 'POST',
      body: { message_id: messageId },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`mark-read failed: HTTP ${res.status}`);
    }
  };

  return { fetchUnread, markRead };
}

/**
 * Baut einen `InboxPoller`, der gegen den lokalen Daemon (mTLS via `requestDaemon`)
 * pollt. Für Agent-Supervisor/Hook (Deploy-Zeit) gedacht. Session-Zustellung über
 * `config.deliver` (Agent-Home).
 */
export function createDaemonInboxPoller(config: DaemonInboxPollerConfig): InboxPoller {
  const { fetchUnread, markRead } = buildDaemonInboxDeps(config);
  return createInboxPoller(
    { fetchUnread, markRead, deliver: config.deliver, log: config.log },
    { intervalMs: config.intervalMs },
  );
}
