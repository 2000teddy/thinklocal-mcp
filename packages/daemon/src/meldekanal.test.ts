// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * meldekanal.test.ts — ADR-036 (TL-09, Slice A). Deckt die Fail-closed-Invarianten aus
 * dem CO (opus+sonnet 2026-07-15): Deny-Default (leere Liste + Default-Ctor), erster
 * gesunder Kanal terminal, Timeout+Abort, throw→error, Shape-Normalisierung, späte
 * Resolution verworfen, Health-Hang⇒unhealthy, `isApproved`-Allowlist.
 */
import { describe, it, expect } from 'vitest';
import {
  MeldekanalRegistry,
  DenyAllChannel,
  isApproved,
  type Meldekanal,
  type ApprovalRequest,
  type ApprovalDecision,
} from './meldekanal.js';

const REQ: ApprovalRequest = {
  requestId: 'r1',
  server: 'unifi',
  tool: 'block_client',
  tier: 'gate',
  senderUri: 'spiffe://thinklocal/node/12D3KooWabc',
  summary: 'block_client on unifi',
};

const FAST = { healthTimeoutMs: 30, approvalTimeoutMs: 30 };

/** Minimaler gesunder Kanal mit fixer Entscheidung. */
function healthy(id: string, decision: ApprovalDecision): Meldekanal {
  return {
    id,
    isHealthy: async () => true,
    requestApproval: async () => decision,
  };
}

/** Unhealthy Kanal (würde, falls doch gefragt, approven — darf aber nie gefragt werden). */
function unhealthyButWouldApprove(id: string): Meldekanal {
  return {
    id,
    isHealthy: async () => false,
    requestApproval: async () => ({ outcome: 'approved', channelId: id }),
  };
}

describe('MeldekanalRegistry — Fail-safe Deny-Default', () => {
  it('leere Registry (Default-Ctor) ⇒ denied-no-channel', async () => {
    const reg = new MeldekanalRegistry([], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('denied-no-channel');
    expect(isApproved(d)).toBe(false);
  });

  it('explizit [DenyAllChannel] ⇒ denied-no-channel (gleicher Pfad wie leere Liste)', async () => {
    const reg = new MeldekanalRegistry([new DenyAllChannel()], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('denied-no-channel');
  });

  it('DenyAllChannel ist immer unhealthy', async () => {
    const c = new DenyAllChannel();
    expect(await c.isHealthy(AbortSignal.timeout(1000))).toBe(false);
  });
});

describe('MeldekanalRegistry — Kanal-Auswahl', () => {
  it('erster gesunder Kanal gewinnt (approved) und trägt die channelId', async () => {
    const reg = new MeldekanalRegistry(
      [healthy('a', { outcome: 'approved', channelId: 'a' }), healthy('b', { outcome: 'rejected', channelId: 'b' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('approved');
    expect(d.channelId).toBe('a');
    expect(isApproved(d)).toBe(true);
  });

  it('unhealthy Kanal wird übersprungen, der nächste gesunde genutzt', async () => {
    const reg = new MeldekanalRegistry(
      [unhealthyButWouldApprove('dead'), healthy('live', { outcome: 'rejected', channelId: 'live' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.channelId).toBe('live');
    expect(d.outcome).toBe('rejected');
  });

  it('erster gesunder Kanal ist TERMINAL: rejected fällt NICHT auf einen approvenden zweiten Kanal durch', async () => {
    const reg = new MeldekanalRegistry(
      [healthy('first', { outcome: 'rejected', channelId: 'first' }), healthy('second', { outcome: 'approved', channelId: 'second' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('rejected');
    expect(d.channelId).toBe('first');
    expect(isApproved(d)).toBe(false);
  });
});

describe('MeldekanalRegistry — Fail-open-Fallen', () => {
  it('Approval-Timeout ⇒ timeout, und der Kanal-Signal wird abgebrochen', async () => {
    let aborted = false;
    const slow: Meldekanal = {
      id: 'slow',
      isHealthy: async () => true,
      requestApproval: (_req, signal) =>
        new Promise((_resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          // löst nie selbst auf → Registry-Timeout muss greifen
        }),
    };
    const reg = new MeldekanalRegistry([slow], { healthTimeoutMs: 30, approvalTimeoutMs: 15 });
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('timeout');
    expect(d.channelId).toBe('slow');
    expect(aborted).toBe(true);
  });

  it('späte Resolution nach dem Timeout wird verworfen (kein nachträgliches approve)', async () => {
    const late: Meldekanal = {
      id: 'late',
      isHealthy: async () => true,
      requestApproval: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ outcome: 'approved', channelId: 'late' }), 40);
        }),
    };
    const reg = new MeldekanalRegistry([late], { healthTimeoutMs: 30, approvalTimeoutMs: 10 });
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('timeout');
    // warten, bis die späte Resolution feuern würde — Ergebnis darf sich nicht ändern.
    await new Promise((r) => setTimeout(r, 60));
    expect(d.outcome).toBe('timeout');
  });

  it('werfender Kanal ⇒ error (nie approve)', async () => {
    const boom: Meldekanal = {
      id: 'boom',
      isHealthy: async () => true,
      requestApproval: async () => {
        throw new Error('kanal kaputt');
      },
    };
    const reg = new MeldekanalRegistry([boom], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
    expect(d.channelId).toBe('boom');
    expect(d.note).toContain('kanal kaputt');
  });

  it('Kanal liefert undefined ⇒ error (Shape-Normalisierung)', async () => {
    const bad: Meldekanal = {
      id: 'bad',
      isHealthy: async () => true,
      requestApproval: async () => undefined as unknown as ApprovalDecision,
    };
    const reg = new MeldekanalRegistry([bad], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
  });

  it('Kanal liefert unbekanntes outcome ⇒ error (nie durchgereicht)', async () => {
    const bad: Meldekanal = {
      id: 'bad2',
      isHealthy: async () => true,
      requestApproval: async () => ({ outcome: 'yes-please' } as unknown as ApprovalDecision),
    };
    const reg = new MeldekanalRegistry([bad], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
    expect(d.note).toContain('unknown outcome');
  });

  it('Health-Check wirft ⇒ Kanal gilt als unhealthy, nächster wird genutzt', async () => {
    const healthThrows: Meldekanal = {
      id: 'sick',
      isHealthy: async () => {
        throw new Error('health probe failed');
      },
      requestApproval: async () => ({ outcome: 'approved', channelId: 'sick' }),
    };
    const reg = new MeldekanalRegistry(
      [healthThrows, healthy('ok', { outcome: 'rejected', channelId: 'ok' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.channelId).toBe('ok');
  });

  it('Health-Check hängt ⇒ Timeout ⇒ unhealthy, nächster wird genutzt', async () => {
    const healthHangs: Meldekanal = {
      id: 'hang',
      isHealthy: () => new Promise<boolean>(() => {}),
      requestApproval: async () => ({ outcome: 'approved', channelId: 'hang' }),
    };
    const reg = new MeldekanalRegistry(
      [healthHangs, healthy('ok', { outcome: 'rejected', channelId: 'ok' })],
      { healthTimeoutMs: 15, approvalTimeoutMs: 30 },
    );
    const d = await reg.requestApproval(REQ);
    expect(d.channelId).toBe('ok');
  });

  it('alle Kanäle unhealthy ⇒ denied-no-channel (kein approve durch tote Kanäle)', async () => {
    const reg = new MeldekanalRegistry(
      [unhealthyButWouldApprove('d1'), unhealthyButWouldApprove('d2')],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('denied-no-channel');
  });

  // CR-HIGH: timeout/error/bad-shape am ERSTEN gesunden Kanal sind TERMINAL — dürfen NICHT
  // auf einen approvenden zweiten Kanal durchfallen (das wäre Rechte-Eskalation / fail-open).
  it('Timeout am ersten gesunden Kanal ist terminal (kein Durchfall auf approvenden zweiten)', async () => {
    const slow: Meldekanal = {
      id: 'slow',
      isHealthy: async () => true,
      requestApproval: (_req, _signal) => new Promise<ApprovalDecision>(() => {}),
    };
    const reg = new MeldekanalRegistry(
      [slow, healthy('second', { outcome: 'approved', channelId: 'second' })],
      { healthTimeoutMs: 30, approvalTimeoutMs: 15 },
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('timeout');
    expect(d.channelId).toBe('slow');
    expect(isApproved(d)).toBe(false);
  });

  it('Fehler am ersten gesunden Kanal ist terminal (kein Durchfall auf approvenden zweiten)', async () => {
    const boom: Meldekanal = {
      id: 'boom',
      isHealthy: async () => true,
      requestApproval: async () => {
        throw new Error('kaputt');
      },
    };
    const reg = new MeldekanalRegistry(
      [boom, healthy('second', { outcome: 'approved', channelId: 'second' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
    expect(d.channelId).toBe('boom');
  });

  it('ungültiges Shape am ersten gesunden Kanal ist terminal (kein Durchfall auf approvenden zweiten)', async () => {
    const bad: Meldekanal = {
      id: 'bad',
      isHealthy: async () => true,
      requestApproval: async () => undefined as unknown as ApprovalDecision,
    };
    const reg = new MeldekanalRegistry(
      [bad, healthy('second', { outcome: 'approved', channelId: 'second' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
    expect(d.channelId).toBe('bad');
  });

  // CR-MEDIUM: ein SYNCHRON werfender Kanal darf die Registry-Kette nicht abbrechen.
  it('synchron werfender Health-Check ⇒ unhealthy, nächster Kanal genutzt (kein Registry-Throw)', async () => {
    const syncThrowHealth: Meldekanal = {
      id: 'sync-sick',
      isHealthy: (): Promise<boolean> => {
        throw new Error('sync health throw');
      },
      requestApproval: async () => ({ outcome: 'approved', channelId: 'sync-sick' }),
    };
    const reg = new MeldekanalRegistry(
      [syncThrowHealth, healthy('ok', { outcome: 'rejected', channelId: 'ok' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.channelId).toBe('ok');
    expect(d.outcome).toBe('rejected');
  });

  it('synchron werfender requestApproval ⇒ error (terminal, kein Registry-Throw)', async () => {
    const syncThrow: Meldekanal = {
      id: 'sync-boom',
      isHealthy: async () => true,
      requestApproval: (): Promise<ApprovalDecision> => {
        throw new Error('sync approval throw');
      },
    };
    const reg = new MeldekanalRegistry([syncThrow], FAST);
    const d = await reg.requestApproval(REQ);
    expect(d.outcome).toBe('error');
    expect(d.channelId).toBe('sync-boom');
  });

  // CR-LOW: non-boolean truthy Health darf NICHT als gesund gelten (strict === true).
  it('non-boolean truthy isHealthy ⇒ Kanal übersprungen', async () => {
    const liar: Meldekanal = {
      id: 'liar',
      isHealthy: async () => 1 as unknown as boolean,
      requestApproval: async () => ({ outcome: 'approved', channelId: 'liar' }),
    };
    const reg = new MeldekanalRegistry(
      [liar, healthy('ok', { outcome: 'rejected', channelId: 'ok' })],
      FAST,
    );
    const d = await reg.requestApproval(REQ);
    expect(d.channelId).toBe('ok');
  });

  // CR-LOW: späte REJECTION (nicht nur Resolution) nach Timeout ⇒ kein Unhandled-Rejection.
  it('späte Rejection nach Timeout ⇒ Ergebnis bleibt timeout, kein Unhandled-Rejection', async () => {
    const rejected: string[] = [];
    const handler = (e: unknown): void => {
      rejected.push(String(e));
    };
    process.on('unhandledRejection', handler);
    try {
      const lateReject: Meldekanal = {
        id: 'late-reject',
        isHealthy: async () => true,
        requestApproval: () =>
          new Promise<ApprovalDecision>((_resolve, reject) => {
            setTimeout(() => reject(new Error('late boom')), 40);
          }),
      };
      const reg = new MeldekanalRegistry([lateReject], { healthTimeoutMs: 30, approvalTimeoutMs: 10 });
      const d = await reg.requestApproval(REQ);
      expect(d.outcome).toBe('timeout');
      await new Promise((r) => setTimeout(r, 60));
      expect(rejected).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', handler);
    }
  });
});

describe('isApproved — Allowlist', () => {
  it('nur approved ⇒ true; alles andere ⇒ false', () => {
    expect(isApproved({ outcome: 'approved' })).toBe(true);
    for (const outcome of ['rejected', 'denied-no-channel', 'timeout', 'error'] as const) {
      expect(isApproved({ outcome })).toBe(false);
    }
  });
});
