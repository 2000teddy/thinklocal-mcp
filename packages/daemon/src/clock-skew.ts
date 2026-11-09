// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * clock-skew.ts — TL-15: Uhr-Abweichungs-Erkennung zwischen Partnern
 *
 * Mehrere Pfade entscheiden anhand ABSOLUTER Zeit mit Werten von einem anderen
 * Rechner (TLS-Gueltigkeitsfenster `tls.ts`, Zukunfts-Timestamp-Filter
 * `peer-cache.ts`, Auftrags-TTL TL-12, Cert-Ablauf-Monitor). Alle behandeln die
 * FOLGE einer schiefen Uhr defensiv; keiner nennt die URSACHE. Dieses Modul macht
 * sie messbar.
 *
 * Die Messstelle existiert bereits: der Heartbeat holt ohnehin `GET /health` bei
 * jedem nicht-offline Peer (`mesh.ts`), und diese Antwort traegt schon heute
 * `{ status, timestamp }` (`agent-card.ts`). Bisher wurde der Body verworfen.
 * Daher: KEIN neuer Endpunkt, KEINE Wire-Format-Aenderung, KEIN zusaetzlicher
 * Netzverkehr, KEINE Peer-Versions-Abhaengigkeit.
 *
 * Reines Modul — kein I/O, keine Timer, keine Seiteneffekte ausser dem
 * Zustandsspeicher des Monitors. Design: `docs/architecture/TL-15-clock-skew-detection.md`.
 */
import type { Logger } from 'pino';

/** Zustand eines Peers im Monitor. `unknown` ist KEIN Zustand, nur ein Messergebnis. */
export type ClockSkewState = 'ok' | 'skewed';

/** Ergebnis einer Einzelmessung. `unknown` = keine Aussage (neutral, kippt nichts). */
export type ClockSkewVerdict = ClockSkewState | 'unknown';

export interface ClockSkewEstimate {
  /** Offset der Peer-Uhr gegen die lokale, in ms. `> 0` ⇒ der Peer laeuft VOR. */
  skewMs: number;
  /** Gemessene Round-Trip-Zeit des Health-Calls in ms. */
  rttMs: number;
  /** Unsicherheit der Schaetzung = `rttMs / 2`. */
  uncertaintyMs: number;
}

/**
 * ISO-8601 mit Datum, Zeit UND explizitem Zonen-Designator.
 *
 * Das Format muss VOR `Date.parse` geprueft werden, weil `Date.parse` zwei Fallen
 * stellt (beide nachgemessen, CR-Runde 1 LOW-1):
 *  - V8s Legacy-Fallback akzeptiert fast alles mit Ziffern: `Date.parse('1')`,
 *    `Date.parse('2026')` und sogar `Date.parse('foo 10')` liefern endliche
 *    Millisekunden — genau der Epochen-Fehlalarm, den die Zahlen-Ablehnung
 *    verhindern soll, nur durch die Hintertuer.
 *  - Ein Zeitstempel OHNE Zone (`2026-11-09T10:00:00`) wird laut Spezifikation in
 *    der LOKALZEIT des Empfaengers gelesen ⇒ zwei Rechner in verschiedenen Zonen
 *    messen einen kuenstlichen Stunden-Skew.
 */
const ISO_8601_WITH_TZ =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Liest die Partner-Uhrzeit aus dem `timestamp`-Feld der `/health`-Antwort.
 *
 * Bewusst NUR ISO-8601-Strings mit Zone: das ist das Format des einzigen
 * Produzenten (`new Date().toISOString()`). Eine blanke Zahl wird ABGELEHNT, weil
 * Sekunden und Millisekunden sich nicht unterscheiden lassen — eine um Faktor 1000
 * fehlinterpretierte Epoche waere ein garantierter Fehlalarm. Unlesbar ⇒ `null`
 * ⇒ `unknown` ⇒ neutral.
 */
export function parsePeerTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ISO_8601_WITH_TZ.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * NTP-uebliche Offset-Schaetzung ueber das lokale Sende-/Empfangsfenster.
 *
 * Die naive Rechnung `localNow - peerTimestamp` ist falsch — sie gibt die halbe
 * Antwortlaufzeit als Uhrenabweichung aus. Stattdessen wird gegen die MITTE des
 * lokalen Fensters gemessen und die Unsicherheit (halbe RTT) mitgeliefert, damit
 * die Klassifikation sie abziehen kann.
 *
 * `null` wenn die Partner-Uhrzeit unlesbar ist, die lokalen Marken nicht endlich
 * sind, oder die RTT negativ waere (lokale Uhr ist zwischen den beiden Marken
 * zurueckgesprungen — dann ist die Messung selbst unbrauchbar).
 */
export function estimateClockSkew(input: {
  sentAtMs: number;
  receivedAtMs: number;
  peerTimestamp: unknown;
}): ClockSkewEstimate | null {
  const peerMs = parsePeerTimestamp(input.peerTimestamp);
  if (peerMs === null) return null;
  const { sentAtMs, receivedAtMs } = input;
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs)) return null;
  const rttMs = receivedAtMs - sentAtMs;
  if (rttMs < 0) return null;
  const midpointMs = sentAtMs + rttMs / 2;
  return { skewMs: peerMs - midpointMs, rttMs, uncertaintyMs: rttMs / 2 };
}

/**
 * Konservativ in BEIDE Richtungen. Der wahre Offset liegt im Intervall
 * `[|skew| - u, |skew| + u]` mit `u = rtt/2`; entschieden wird nur, was dieses
 * Intervall hergibt:
 *
 *  - `skewed`  wenn die UNTERE Schranke die Schwelle ueberschreitet,
 *  - `ok`      wenn die OBERE Schranke sie einhaelt,
 *  - `unknown` dazwischen — die RTT war zu hoch fuer eine belastbare Aussage.
 *
 * Eine einseitige Pruefung (nur die untere Schranke, mit `ok` als Rest) war der
 * Fehler der ersten Fassung (CR-Runde 1, MEDIUM-2): sie ist auf dem Hinweg
 * konservativ, auf dem RUECKWEG aber das Gegenteil. Ein Peer mit konstant 6 s
 * Vorlauf (Schwelle 5 s) haette bei einer RTT-Spitze von 3 s als „ok" gezaehlt,
 * damit einen `skewed→ok`-Flip ausgeloest und dem Operator die in sich
 * widerspruechliche Meldung „behoben: laeuft jetzt 6.0 s vor (Schwelle 5.0 s)"
 * geschickt — und beim naechsten schnellen Heartbeat wieder zurueckgekippt.
 * Netzlatenz haette also doch Zustandswechsel erzeugt.
 *
 * `unknown` ist fuer die Hysterese neutral, bricht also auch keine laufende Serie.
 *
 * `thresholdMs` nicht endlich oder `<= 0` ⇒ `unknown` (Feature aus ⇒ keine
 * Aussage, nicht „ok").
 */
export function classifyClockSkew(
  estimate: ClockSkewEstimate | null,
  thresholdMs: number,
): ClockSkewVerdict {
  if (estimate === null) return 'unknown';
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return 'unknown';
  const magnitude = Math.abs(estimate.skewMs);
  if (magnitude - estimate.uncertaintyMs > thresholdMs) return 'skewed';
  if (magnitude + estimate.uncertaintyMs <= thresholdMs) return 'ok';
  return 'unknown';
}

/** Zustandswechsel eines Peers — das EINZIGE, was alarmiert wird. */
export interface ClockSkewTransition {
  agentId: string;
  from: ClockSkewState;
  to: ClockSkewState;
  /** Messwert, der den Flip ausgeloest hat. `> 0` ⇒ Peer laeuft vor. */
  skewMs: number;
  rttMs: number;
  thresholdMs: number;
  /** Anzahl aufeinanderfolgender gleichgerichteter Messungen bis zum Flip. */
  confirmations: number;
}

export interface ClockSkewMonitorOptions {
  /** Schwelle in ms, oberhalb derer (nach Abzug der Unsicherheit) alarmiert wird. */
  thresholdMs: number;
  /** Aufeinanderfolgende gleichgerichtete Messungen, bevor der Zustand kippt. */
  debounce: number;
}

interface PeerSkewEntry {
  state: ClockSkewState;
  /** Verdikt der laufenden Serie. */
  streakVerdict: ClockSkewState;
  /** Laenge der laufenden Serie. */
  streak: number;
}

/**
 * Hysterese pro Peer — uebernimmt die Mechanik des `SkillHealthMonitor`.
 *
 * Alarmiert wird AUSSCHLIESSLICH der Zustandswechsel, nicht die Messung: ein Peer,
 * dessen Uhr an der Schwelle wackelt, erzeugt sonst bei 10-s-Heartbeat 8640
 * Nachrichten pro Tag. Bei Default-Debounce 3 braucht ein Flip ~30 s Bestaetigung,
 * und ein dauerhaft schiefer Peer erzeugt EINE Nachricht.
 *
 * `unknown`-Messungen sind NEUTRAL: sie zaehlen weder fuer noch gegen einen Flip
 * und lassen den Zustand stehen. Sonst gaelte ein Peer mit altem Daemon ohne
 * `timestamp`-Feld als „wieder gut".
 *
 * Startzustand ist `ok` — ein von Anfang an schiefer Peer loest also nach
 * `debounce` Bestaetigungen genau einen `ok→skewed`-Alarm aus.
 */
export class ClockSkewMonitor {
  private entries = new Map<string, PeerSkewEntry>();

  constructor(private readonly opts: ClockSkewMonitorOptions) {}

  get thresholdMs(): number {
    return this.opts.thresholdMs;
  }

  /** Anzahl beobachteter Peers — fuer Tests und Leak-Kontrolle. */
  get size(): number {
    return this.entries.size;
  }

  /** Aktueller Zustand eines Peers, oder `undefined` wenn nie gemessen. */
  stateOf(agentId: string): ClockSkewState | undefined {
    return this.entries.get(agentId)?.state;
  }

  /**
   * Verbucht eine Messung. Liefert den Zustandswechsel, wenn einer eingetreten ist,
   * sonst `null`. Wirft nie.
   */
  observe(agentId: string, estimate: ClockSkewEstimate | null): ClockSkewTransition | null {
    const verdict = classifyClockSkew(estimate, this.opts.thresholdMs);
    if (verdict === 'unknown' || estimate === null) return null;

    const entry = this.entries.get(agentId) ?? { state: 'ok', streakVerdict: verdict, streak: 0 };
    if (entry.streakVerdict === verdict) {
      entry.streak += 1;
    } else {
      entry.streakVerdict = verdict;
      entry.streak = 1;
    }
    this.entries.set(agentId, entry);

    // Verdikt bestaetigt den aktuellen Zustand ⇒ nichts zu kippen.
    if (verdict === entry.state) return null;
    if (entry.streak < this.opts.debounce) return null;

    const from = entry.state;
    const confirmations = entry.streak;
    entry.state = verdict;
    return {
      agentId,
      from,
      to: verdict,
      skewMs: estimate.skewMs,
      rttMs: estimate.rttMs,
      thresholdMs: this.opts.thresholdMs,
      confirmations,
    };
  }

  /** Vergisst einen Peer (Entfernung aus dem Mesh) — verhindert unbegrenztes Wachstum. */
  forget(agentId: string): void {
    this.entries.delete(agentId);
  }
}

/**
 * Fail-open-Klammer um Body-Lesen, Messen und Verbuchen — der Teil, den `mesh.ts`
 * sonst selbst tragen muesste.
 *
 * Als eigene Funktion, damit genau diese Klammer (Body unlesbar, kein JSON,
 * falscher Typ, werfender Reader) unit-testbar ist, ohne `undici` zu mocken —
 * dafuer gibt es im Repo keinen Praezedenzfall. `mesh.ts` behaelt dadurch nur die
 * Zeitnahme und diesen Aufruf.
 *
 * Wirft NIE: ein Mess- oder Parse-Fehler darf den Heartbeat niemals beeinflussen.
 * Der Online-/Offline-Zustand des Peers ist zu diesem Zeitpunkt bereits entschieden.
 */
export async function observeHeartbeatSkew(args: {
  monitor: ClockSkewMonitor;
  agentId: string;
  /** Lokale Zeit unmittelbar VOR dem fetch. */
  sentAtMs: number;
  /** Liest den Health-Body (im Daemon: `() => response.json()`). */
  readBody: () => Promise<unknown>;
  /** Zeitquelle fuer die Empfangsmarke — injizierbar fuer Tests. */
  now?: () => number;
  log?: Pick<Logger, 'debug'>;
}): Promise<ClockSkewTransition | null> {
  const now = args.now ?? Date.now;
  let body: unknown;
  try {
    body = await args.readBody();
  } catch (err) {
    args.log?.debug(
      { agentId: args.agentId, err: String(err) },
      '[clock-skew] Health-Body nicht lesbar — Messung uebersprungen',
    );
    return null;
  }
  try {
    const receivedAtMs = now();
    // `Object.hasOwn` statt direktem Zugriff: ein Fremd-Body darf den Wert nicht
    // ueber die Prototypenkette liefern (Haerterung analog `normalizeDecision`).
    const peerTimestamp =
      typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, 'timestamp')
        ? (body as Record<string, unknown>)['timestamp']
        : undefined;
    const estimate = estimateClockSkew({
      sentAtMs: args.sentAtMs,
      receivedAtMs,
      peerTimestamp,
    });
    return args.monitor.observe(args.agentId, estimate);
  } catch (err) {
    args.log?.debug(
      { agentId: args.agentId, err: String(err) },
      '[clock-skew] Messung fehlgeschlagen — uebersprungen',
    );
    return null;
  }
}
