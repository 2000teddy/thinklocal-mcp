// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * telegram-meldekanal.ts — ADR-038 (TL-09c, Slice C): der erste REALE {@link Meldekanal}.
 *
 * Legt eine angehaltene schreibende MCP-`gate`-Anfrage einem Betreiber per Telegram-Inline-Keyboard
 * vor (Freigeben / Ablehnen) und spiegelt die Entscheidung durablen in den `approvals.ts`-Store
 * (`type: 'mcp_gate'`). Erfüllt den Fail-closed-Vertrag aus ADR-036 (C1 Abort terminal, C2 nur
 * `approved`/`rejected` aus dem Callback), sodass eine `gate`-Freigabe technisch `approved` werden KANN.
 *
 * Bewusste Grenzen (ADR-038):
 *  - KEIN eigener Polling-Bot. Der Kanal spricht gegen {@link TelegramApprovalTransport}; die
 *    Live-Aktivierung reicht den BESTEHENDEN Gateway-Bot als Transport herein (genau ein Bot —
 *    zwei Polling-Bots auf demselben Token ⇒ Telegram 409). Der Transport ist die einzige Netz-Naht.
 *  - KEINE Verdrahtung in `index.ts` (Registry bleibt leer → DenyAllChannel → 403). Die Aktivierung
 *    (Bot-Token/Freigabe-Chat) ist token-gegatet und NICHT Teil dieses Slices.
 *
 * Reine Logik (ohne Transport): kein I/O außer der injizierten Naht → vollständig unit-testbar.
 */
import type { Logger } from 'pino';
import type { ApprovalService } from './approvals.js';
import type {
  ApprovalDecision,
  ApprovalRequest,
  Meldekanal,
} from './meldekanal.js';

/** Präfix aller Freigabe-`callback_data`. Grenzt unsere Buttons von anderen Bot-Callbacks ab. */
const CALLBACK_PREFIX = 'tlgate';

/** Eine (best-effort) Referenz auf die gesendete Freigabe-Nachricht, um das Keyboard einzufrieren. */
export interface TelegramPromptRef {
  readonly chatId: string;
  readonly messageId: number;
}

/** Ein vom Transport geliefertes rohes Callback-Ereignis (Button-Klick). */
export interface TelegramDecisionEvent {
  /** Roher `callback_data`-String, z.B. `tlgate:approve:<id>`. */
  readonly data: string;
  /** Telegram-Callback-Query-ID (zum Bestätigen / Spinner stoppen). */
  readonly callbackQueryId: string;
  /** Chat, aus dem der Klick kam (Chat-Bindungs-Check). */
  readonly chatId: string;
  /** Nachricht, an der der Button hing (zum Einfrieren des Keyboards). */
  readonly messageId: number;
}

/**
 * Schmale Bot-Glue-Naht. Die konkrete Implementierung (Folge-Slice/Aktivierung) wickelt den
 * BESTEHENDEN Gateway-Bot ein; hier bleibt sie eine Schnittstelle, damit die Fail-closed-Logik
 * ohne Netz getestet werden kann.
 */
export interface TelegramApprovalTransport {
  /** Liveness des Bots (z.B. `getMe`). MUSS `signal` respektieren. Fehler/Timeout ⇒ unhealthy. */
  isHealthy(signal: AbortSignal): Promise<boolean>;
  /** Sendet die Freigabe-Vorlage mit zwei Inline-Buttons; liefert eine Referenz zum Einfrieren. */
  sendPrompt(input: {
    readonly chatId: string;
    readonly text: string;
    readonly approveData: string;
    readonly rejectData: string;
  }): Promise<TelegramPromptRef>;
  /** Abonniert Button-Klicks; liefert eine Unsubscribe-Funktion. */
  subscribe(handler: (evt: TelegramDecisionEvent) => void): () => void;
  /** Bestätigt den Klick + friert (best-effort) das Keyboard ein. Wirft nie fatal. */
  finalize(input: {
    readonly ref: TelegramPromptRef;
    readonly callbackQueryId: string;
    readonly resultText: string;
  }): Promise<void>;
}

export interface TelegramMeldekanalOptions {
  /** Stabile Kanal-ID (Default `telegram`). */
  readonly id?: string;
  /** Freigabe-Chat: NUR Klicks aus diesem Chat gelten (Chat-Bindung). */
  readonly chatId: string;
  readonly transport: TelegramApprovalTransport;
  readonly approvals: ApprovalService;
  readonly log?: Logger;
}

/** Ein wartender Freigabe-Vorgang: verbindet den async Callback mit dem awaitenden Promise. */
interface Pending {
  readonly ref: TelegramPromptRef;
  /** Genau einmal aufrufbar; entfernt sich selbst aus der Map (siehe `settle`). */
  resolve(evt: { outcome: 'approved' | 'rejected'; event?: TelegramDecisionEvent }): void;
}

function buildCallbackData(action: 'approve' | 'reject', approvalId: string): string {
  return `${CALLBACK_PREFIX}:${action}:${approvalId}`;
}

/**
 * Parst `tlgate:<approve|reject>:<approvalId>`. Jedes andere Shape ⇒ `null` (ignoriert).
 * `approvalId` darf `:` nicht enthalten (UUID) — daher genau 3 Segmente.
 */
function parseCallbackData(
  data: string,
): { action: 'approve' | 'reject'; approvalId: string } | null {
  const parts = data.split(':');
  if (parts.length !== 3) return null;
  const [prefix, action, approvalId] = parts;
  if (prefix !== CALLBACK_PREFIX) return null;
  if (action !== 'approve' && action !== 'reject') return null;
  if (!approvalId) return null;
  return { action, approvalId };
}

/**
 * Realer Telegram-Meldekanal (ADR-038). Injizierbar in {@link MeldekanalRegistry}.
 * Ein Instanz-weiter Callback-Router (aus dem Konstruktor abonniert) verteilt Button-Klicks
 * an den passenden wartenden Vorgang; nach Abort/Timeout ist der Vorgang aus der Map entfernt,
 * ein später Klick ist damit ein No-op (C1).
 */
export class TelegramMeldekanal implements Meldekanal {
  readonly id: string;
  private readonly chatId: string;
  private readonly transport: TelegramApprovalTransport;
  private readonly approvals: ApprovalService;
  private readonly log?: Logger;
  /** approvalId → wartender Vorgang. Präsenz = „noch offen"; Fehlen = invalidiert/entschieden. */
  private readonly pending = new Map<string, Pending>();
  private readonly unsubscribe: () => void;

  constructor(opts: TelegramMeldekanalOptions) {
    this.id = opts.id ?? 'telegram';
    this.chatId = opts.chatId;
    this.transport = opts.transport;
    this.approvals = opts.approvals;
    this.log = opts.log;
    this.unsubscribe = this.transport.subscribe((evt) => this.routeDecision(evt));
  }

  async isHealthy(signal: AbortSignal): Promise<boolean> {
    // Delegiert an den Transport (z.B. getMe). Wirft der Transport, gilt der Kanal als unhealthy;
    // die Registry umhüllt den Aufruf ohnehin zusätzlich mit Timeout + Fehlerfang.
    return this.transport.isHealthy(signal);
  }

  async requestApproval(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    // Bereits abgebrochen, bevor wir überhaupt starten ⇒ nichts vorlegen (fail-closed).
    if (signal.aborted) {
      return { outcome: 'timeout', channelId: this.id };
    }

    // 1) Durable pending-Zeile (Audit-/Korrelations-Anker). Wirft die Persistenz, ⇒ error (nie approved).
    let approvalId: string;
    try {
      approvalId = this.approvals.create({
        type: 'mcp_gate',
        payload: req,
        summary: req.summary,
      });
    } catch (err) {
      this.log?.warn({ err: String(err), requestId: req.requestId }, '[telegram-meldekanal] approval create failed');
      return { outcome: 'error', channelId: this.id, note: 'approval persistence failed' };
    }

    // 2) Vorlage senden. Schlägt das Senden fehl, ist niemand gefragt worden ⇒ error.
    let ref: TelegramPromptRef;
    try {
      ref = await this.transport.sendPrompt({
        chatId: this.chatId,
        text: this.renderPrompt(req, approvalId),
        approveData: buildCallbackData('approve', approvalId),
        rejectData: buildCallbackData('reject', approvalId),
      });
    } catch (err) {
      this.log?.warn({ err: String(err), approvalId }, '[telegram-meldekanal] sendPrompt failed');
      return { outcome: 'error', channelId: this.id, note: 'telegram sendPrompt failed' };
    }

    // 3) Bridge: Callback → awaitender Promise. Genau EIN settle (erste Entscheidung ODER Abort).
    return new Promise<ApprovalDecision>((resolvePromise) => {
      let settled = false;
      const settle = (decision: ApprovalDecision): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(approvalId); // C1: invalidiert — späterer Klick findet nichts mehr.
        signal.removeEventListener('abort', onAbort);
        resolvePromise(decision);
      };

      const onAbort = (): void => {
        // Registry-Timeout: terminal. Vorgang invalidieren; die (verworfene) Rückgabe ist `timeout`.
        this.log?.debug({ approvalId }, '[telegram-meldekanal] aborted — pending invalidated');
        settle({ outcome: 'timeout', channelId: this.id });
      };
      // C1-KRITISCH: Ist das Signal bereits abgebrochen (Timeout schlug WÄHREND `create`/`sendPrompt` zu),
      // hat das `abort`-Event schon gefeuert — ein `{once:true}`-Listener würde NIE laufen, der pending-
      // Eintrag würde leaken und ein späterer Klick den durablen Store nachträglich auf `approved` setzen.
      // Darum hier vor dem Registrieren prüfen und terminal `timeout` settlen (kein pending.set).
      if (signal.aborted) {
        settle({ outcome: 'timeout', channelId: this.id });
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(approvalId, {
        ref,
        resolve: ({ outcome, event }) => {
          // Entscheidung durable spiegeln (idempotent). Persistenz-Fehler ⇒ error, nie stilles approved.
          try {
            this.approvals.decide(approvalId, outcome);
          } catch (err) {
            this.log?.warn({ err: String(err), approvalId }, '[telegram-meldekanal] approval decide failed');
            settle({ outcome: 'error', channelId: this.id, note: 'approval persistence failed' });
            return;
          }
          if (event) {
            // Best-effort: Spinner stoppen + Keyboard einfrieren. Fehler hier ändern die Entscheidung nicht.
            void this.transport
              .finalize({
                ref,
                callbackQueryId: event.callbackQueryId,
                resultText: outcome === 'approved' ? '✅ Freigegeben' : '⛔️ Abgelehnt',
              })
              .catch((err: unknown) => {
                this.log?.debug({ err: String(err), approvalId }, '[telegram-meldekanal] finalize failed (ignored)');
              });
          }
          settle({ outcome, channelId: this.id });
        },
      });
    });
  }

  /** Verteilt einen Button-Klick an den passenden wartenden Vorgang. Unbekannt/stale ⇒ No-op (C1/C2). */
  private routeDecision(evt: TelegramDecisionEvent): void {
    // Chat-Bindung: Klicks aus fremden Chats werden nie als Entscheidung akzeptiert.
    if (evt.chatId !== this.chatId) {
      this.log?.warn({ chatId: evt.chatId }, '[telegram-meldekanal] decision from unauthorized chat ignored');
      return;
    }
    const parsed = parseCallbackData(evt.data);
    if (!parsed) return; // C2: unbekanntes Shape ⇒ ignoriert.
    const waiter = this.pending.get(parsed.approvalId);
    if (!waiter) {
      // Bereits entschieden/invalidiert (Doppelklick, später Klick nach Timeout) ⇒ No-op.
      this.log?.debug({ approvalId: parsed.approvalId }, '[telegram-meldekanal] stale/duplicate decision ignored');
      return;
    }
    waiter.resolve({
      outcome: parsed.action === 'approve' ? 'approved' : 'rejected',
      event: evt,
    });
  }

  private renderPrompt(req: ApprovalRequest, approvalId: string): string {
    return (
      `🛂 Freigabe erforderlich\n\n` +
      `Server: ${req.server}\n` +
      `Tool: ${req.tool}\n` +
      `Stufe: ${req.tier}\n` +
      `Sender: ${req.senderUri}\n` +
      `${req.summary}\n\n` +
      `Vorgang: ${approvalId}`
    );
  }

  /** Beendet das Callback-Abo. Offene Vorgänge werden NICHT auto-entschieden (fail-closed). */
  stop(): void {
    this.unsubscribe();
    this.pending.clear();
  }
}
