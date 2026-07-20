// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * telegram-meldekanal.test.ts — ADR-038 (TL-09c). Deckt:
 *  - Injektions-Beweis: über eine REALE {@link MeldekanalRegistry} wird `approved`/`rejected` erreichbar
 *    (die „gate-Freigabe KÖNNTE approved werden"-Anforderung des Tasks) — plus durable Spiegelung in
 *    `approvals.ts`.
 *  - Fail-closed-Invarianten (ADR-036 C1/C2): Abort terminal + späterer Klick No-op, unbekanntes
 *    Callback-Shape ignoriert, fremder Chat ignoriert, Doppelklick idempotent, unhealthy ⇒ übersprungen,
 *    sendPrompt-/Persistenz-Fehler ⇒ `error` (nie stilles `approved`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalService } from './approvals.js';
import { MeldekanalRegistry, isApproved, type ApprovalRequest } from './meldekanal.js';
import {
  TelegramMeldekanal,
  type TelegramApprovalTransport,
  type TelegramDecisionEvent,
  type TelegramPromptRef,
} from './telegram-meldekanal.js';

const CHAT = '424242';

const REQ: ApprovalRequest = {
  requestId: 'r1',
  server: 'unifi',
  tool: 'block_client',
  tier: 'gate',
  senderUri: 'spiffe://thinklocal/node/12D3KooWabc',
  summary: 'block_client on unifi',
};

/** Steuerbarer Fake-Transport: erfasst sendPrompt, hält den subscribe-Handler, feuert Klicks. */
class FakeTransport implements TelegramApprovalTransport {
  healthy = true;
  healthCalls = 0;
  sent: Array<{ approveData: string; rejectData: string; text: string }> = [];
  finalized: Array<{ resultText: string; callbackQueryId: string }> = [];
  sendShouldThrow = false;
  /** Wenn true, hängt `sendPrompt` bis {@link releaseSend} — simuliert eine langsame Telegram-API. */
  blockSend = false;
  private sendRelease?: () => void;
  private handler?: (evt: TelegramDecisionEvent) => void;
  private nextMessageId = 1000;

  async isHealthy(signal: AbortSignal): Promise<boolean> {
    this.healthCalls++;
    if (signal.aborted) return false;
    return this.healthy;
  }

  async sendPrompt(input: {
    chatId: string;
    text: string;
    approveData: string;
    rejectData: string;
  }): Promise<TelegramPromptRef> {
    if (this.sendShouldThrow) throw new Error('telegram down');
    if (this.blockSend) {
      await new Promise<void>((r) => {
        this.sendRelease = r;
      });
    }
    this.sent.push({ approveData: input.approveData, rejectData: input.rejectData, text: input.text });
    return { chatId: input.chatId, messageId: this.nextMessageId++ };
  }

  /** Gibt ein hängendes `sendPrompt` frei (nur relevant mit {@link blockSend}). */
  releaseSend(): void {
    this.sendRelease?.();
  }

  subscribe(handler: (evt: TelegramDecisionEvent) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  async finalize(input: { ref: TelegramPromptRef; callbackQueryId: string; resultText: string }): Promise<void> {
    this.finalized.push({ resultText: input.resultText, callbackQueryId: input.callbackQueryId });
  }

  /** Test-Helfer: simuliert einen Button-Klick. `data` default = zuletzt gesendeter approve/reject. */
  click(action: 'approve' | 'reject', opts?: { chatId?: string; data?: string }): void {
    const last = this.sent[this.sent.length - 1];
    const data = opts?.data ?? (action === 'approve' ? last!.approveData : last!.rejectData);
    this.handler?.({
      data,
      callbackQueryId: 'cbq1',
      chatId: opts?.chatId ?? CHAT,
      messageId: 999,
    });
  }
}

describe('TelegramMeldekanal (ADR-038)', () => {
  let dir: string;
  let approvals: ApprovalService;
  let transport: FakeTransport;
  let channel: TelegramMeldekanal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-tgmk-'));
    approvals = new ApprovalService(dir);
    transport = new FakeTransport();
    channel = new TelegramMeldekanal({ chatId: CHAT, transport, approvals });
  });

  afterEach(() => {
    channel.stop();
    approvals.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('Injektion in eine reale MeldekanalRegistry', () => {
    it('approve-Klick ⇒ approved (isApproved=true) + durable approved in approvals.ts', async () => {
      const reg = new MeldekanalRegistry([channel], { healthTimeoutMs: 200, approvalTimeoutMs: 500 });
      const p = reg.requestApproval(REQ);
      // Warten bis die Vorlage raus ist, dann klicken.
      await vi_tick(() => transport.sent.length === 1);
      transport.click('approve');
      const decision = await p;

      expect(decision.outcome).toBe('approved');
      expect(decision.channelId).toBe('telegram');
      expect(isApproved(decision)).toBe(true);

      const rows = approvals.list({ type: 'mcp_gate' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('approved');
      expect(JSON.parse(rows[0]!.payload_json).requestId).toBe('r1');
      expect(transport.finalized[0]!.resultText).toContain('Freigegeben');
    });

    it('reject-Klick ⇒ rejected (isApproved=false) + durable rejected', async () => {
      const reg = new MeldekanalRegistry([channel], { healthTimeoutMs: 200, approvalTimeoutMs: 500 });
      const p = reg.requestApproval(REQ);
      await vi_tick(() => transport.sent.length === 1);
      transport.click('reject');
      const decision = await p;

      expect(decision.outcome).toBe('rejected');
      expect(isApproved(decision)).toBe(false);
      expect(approvals.list({ type: 'mcp_gate' })[0]!.status).toBe('rejected');
    });

    it('unhealthy Kanal ⇒ Registry überspringt ⇒ denied-no-channel (nie approved)', async () => {
      transport.healthy = false;
      const reg = new MeldekanalRegistry([channel], { healthTimeoutMs: 200, approvalTimeoutMs: 500 });
      const decision = await reg.requestApproval(REQ);
      expect(decision.outcome).toBe('denied-no-channel');
      expect(transport.sent).toHaveLength(0); // nie eine Vorlage gesendet
    });
  });

  describe('Fail-closed-Invarianten (direkt am Kanal)', () => {
    it('C1: Abort ist terminal ⇒ timeout, und ein SPÄTERER Klick ist ein No-op', async () => {
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      await vi_tick(() => transport.sent.length === 1);

      ctrl.abort();
      const decision = await p;
      expect(decision.outcome).toBe('timeout');

      // Späte Betreiber-Antwort nach Abort: darf NICHT nachträglich als Entscheidung wirken.
      transport.click('approve');
      // Der Promise ist bereits terminal timeout; die approval-Zeile bleibt pending (nie approved).
      const row = approvals.list({ type: 'mcp_gate' })[0]!;
      expect(row.status).toBe('pending');
    });

    it('C1-Regression (CR-HIGH): Abort WÄHREND sendPrompt in-flight ⇒ timeout, späterer Klick No-op, Zeile bleibt pending', async () => {
      // Reproduziert den CR-HIGH: schlägt der Registry-Timeout zu, während `sendPrompt` noch hängt,
      // ist das Signal beim Betreten des Promise-Executors bereits `aborted` → der `{once:true}`-
      // Abort-Listener würde nie feuern. Der pending-Eintrag DARF NICHT leaken.
      transport.blockSend = true;
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      // create() lief bereits (durable pending row); sendPrompt hängt noch.
      await vi_tick(() => approvals.list({ type: 'mcp_gate' }).length === 1);

      ctrl.abort(); // Timeout schlägt zu, WÄHREND sendPrompt hängt
      transport.releaseSend(); // sendPrompt resolved erst jetzt → Executor läuft mit abgebrochenem Signal
      const decision = await p;
      expect(decision.outcome).toBe('timeout');

      // Ein späterer Klick darf nichts mehr auslösen (kein leakender pending-Eintrag).
      transport.click('approve');
      expect(approvals.list({ type: 'mcp_gate' })[0]!.status).toBe('pending');
    });

    it('Persistenz-Fehler bei decide (nach approve-Klick) ⇒ error, nie approved', async () => {
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      await vi_tick(() => transport.sent.length === 1);
      approvals.close(); // decide() wirft jetzt → fail-closed error
      transport.click('approve');
      const decision = await p;
      expect(decision.outcome).toBe('error');
      expect(isApproved(decision)).toBe(false);
    });

    it('bereits abgebrochenes Signal beim Eintritt ⇒ timeout ohne Vorlage/Persistenz', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const decision = await channel.requestApproval(REQ, ctrl.signal);
      expect(decision.outcome).toBe('timeout');
      expect(transport.sent).toHaveLength(0);
      expect(approvals.list({ type: 'mcp_gate' })).toHaveLength(0);
    });

    it('C2: unbekanntes callback-Shape ⇒ ignoriert (Vorgang bleibt offen)', async () => {
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      await vi_tick(() => transport.sent.length === 1);

      transport.click('approve', { data: 'evil:approve:whatever' }); // falsches Präfix
      transport.click('approve', { data: 'tlgate:yes:id' }); // falsche Action
      transport.click('approve', { data: 'tlgate:approve' }); // zu wenig Segmente

      // Nichts davon darf die Freigabe auslösen — jetzt echter Klick:
      transport.click('approve');
      const decision = await p;
      expect(decision.outcome).toBe('approved');
    });

    it('Klick aus fremdem Chat ⇒ ignoriert', async () => {
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      await vi_tick(() => transport.sent.length === 1);

      transport.click('approve', { chatId: '999999' }); // fremder Chat
      transport.click('approve'); // korrekter Chat
      const decision = await p;
      expect(decision.outcome).toBe('approved');
    });

    it('Doppelklick ⇒ zweite Entscheidung ist No-op (idempotent)', async () => {
      const ctrl = new AbortController();
      const p = channel.requestApproval(REQ, ctrl.signal);
      await vi_tick(() => transport.sent.length === 1);

      transport.click('approve');
      transport.click('reject'); // zu spät — Vorgang bereits entschieden/entfernt
      const decision = await p;
      expect(decision.outcome).toBe('approved');
      expect(approvals.list({ type: 'mcp_gate' })[0]!.status).toBe('approved');
    });

    it('sendPrompt wirft ⇒ error (nie approved)', async () => {
      transport.sendShouldThrow = true;
      const ctrl = new AbortController();
      const decision = await channel.requestApproval(REQ, ctrl.signal);
      expect(decision.outcome).toBe('error');
      expect(isApproved(decision)).toBe(false);
    });

    it('Persistenz-Fehler bei create ⇒ error (nie approved)', async () => {
      approvals.close(); // DB zu ⇒ create() wirft
      const ctrl = new AbortController();
      const decision = await channel.requestApproval(REQ, ctrl.signal);
      expect(decision.outcome).toBe('error');
      expect(transport.sent).toHaveLength(0);
    });
  });
});

/** Wartet (mit Mikrotask-Ticks) bis `cond()` true ist oder die Grenze erreicht ist. */
async function vi_tick(cond: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks && !cond(); i++) {
    await Promise.resolve();
  }
}
