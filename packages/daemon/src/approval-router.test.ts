// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * approval-router.test.ts — TL-10 Slice-B-Prep: Kompositions-Primitive
 * „Matrix-Eintrag → channelId → requestApprovalOn".
 *
 * Kern der Suite: der Router darf **niemals** freigeben, ohne dass die Matrix ein wohlgeformtes Ziel
 * geliefert hat UND genau der dort benannte Kanal aktiv zugestimmt hat — und er darf **niemals** auf
 * die „erster gesunder Kanal"-Auswahl zurückfallen.
 */
import { describe, expect, it, vi } from 'vitest';
import { requestApprovalViaMatrix, type ChannelBoundApprover } from './approval-router.js';
import {
  parseFreigabeMatrix,
  type FreigabeMatrix,
  type ResolveContext,
} from './freigabe-matrix.js';
import {
  isApproved,
  MeldekanalRegistry,
  type ApprovalDecision,
  type ApprovalRequest,
} from './meldekanal.js';

const KNOWN_SERVERS = ['unifi', 'pal'] as const;

function matrixOf(entries: unknown[]): FreigabeMatrix {
  return parseFreigabeMatrix({ entries }, KNOWN_SERVERS);
}

const REQ: ApprovalRequest = {
  requestId: 'req-1',
  server: 'unifi',
  tool: 'block_client',
  tier: 'gate',
  senderUri: 'spiffe://thinklocal/node/abc',
  summary: 'block a client',
};

const CTX: ResolveContext = { tier: 'gate', server: 'unifi', tool: 'block_client' };

/** Approver-Spion: zeichnet auf, WELCHER Kanal adressiert wurde. */
function approverOf(fn: (channelId: string) => Promise<unknown>): {
  approver: ChannelBoundApprover;
  calls: string[];
} {
  const calls: string[] = [];
  const approver: ChannelBoundApprover = {
    requestApprovalOn: async (channelId, _req) => {
      calls.push(channelId);
      return (await fn(channelId)) as ApprovalDecision;
    },
  };
  return { approver, calls };
}

const ENTRY_TELEGRAM = {
  tier: 'gate',
  server: 'unifi',
  tool: 'block_client',
  channel: 'telegram',
  decider: 'human:christian',
};

describe('requestApprovalViaMatrix — nicht routable ⇒ Default-Deny, NIEMAND wird gefragt', () => {
  it('leere Matrix ⇒ denied-no-channel, Approver nie aufgerufen', async () => {
    const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));
    const res = await requestApprovalViaMatrix(matrixOf([]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(isApproved(res.decision)).toBe(false);
    expect(res.target).toBeNull();
    expect(calls).toEqual([]);
  });

  it('kein passender Eintrag (anderer server) ⇒ denied, Approver nie aufgerufen', async () => {
    const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, server: 'pal', tool: '*' }]);

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(res.target).toBeNull();
    expect(calls).toEqual([]);
  });

  it('passender server, aber anderes tier ⇒ denied (tier ist harter Prädikat-Filter)', async () => {
    const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, tier: 'consensus' }]);

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(calls).toEqual([]);
  });

  it('anderes Werkzeug ohne Wildcard ⇒ denied, Approver nie aufgerufen', async () => {
    const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, tool: 'unblock_client' }]);

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(calls).toEqual([]);
  });

  it('nicht wohlgeformtes Ziel (leerer Kanalname, an isRoutable vorbei konstruiert) ⇒ denied', async () => {
    // Der Parser ließe das nie durch — hier wird die Guard-Wirkung selbst belegt, damit ein
    // künftiger, laxerer Loader nicht unbemerkt zu einem Fail-open führt.
    const forged = {
      entries: [{ ...ENTRY_TELEGRAM, channel: '', decider: { kind: 'human', id: 'x' } }],
    };
    const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));

    const res = await requestApprovalViaMatrix(
      forged as unknown as FreigabeMatrix,
      approver,
      CTX,
      REQ,
    );

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(res.target).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('requestApprovalViaMatrix — routable ⇒ ausschließlich der Matrix-Kanal', () => {
  it('fragt GENAU den aufgelösten Kanal und gibt bei aktiver Zustimmung frei', async () => {
    const matrix = matrixOf([ENTRY_TELEGRAM]);
    const { approver, calls } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(calls).toEqual(['telegram']);
    expect(isApproved(res.decision)).toBe(true);
    expect(res.decision.channelId).toBe('telegram');
    expect(res.target).toEqual({
      channel: 'telegram',
      decider: { kind: 'human', id: 'christian' },
    });
  });

  it('exakter Tool-Eintrag schlägt Wildcard — der spezifischere Kanal wird adressiert', async () => {
    const matrix = matrixOf([
      { ...ENTRY_TELEGRAM, tool: '*', channel: 'cockpit' },
      { ...ENTRY_TELEGRAM, tool: 'block_client', channel: 'telegram' },
    ]);
    const { approver, calls } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(calls).toEqual(['telegram']);
  });

  it('Wildcard greift, wenn kein exakter Eintrag existiert', async () => {
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, tool: '*', channel: 'cockpit' }]);
    const { approver, calls } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(calls).toEqual(['cockpit']);
  });

  it('reicht die Anfrage unverändert durch', async () => {
    const matrix = matrixOf([ENTRY_TELEGRAM]);
    const seen: ApprovalRequest[] = [];
    const approver: ChannelBoundApprover = {
      requestApprovalOn: async (_id, req) => {
        seen.push(req);
        return { outcome: 'rejected' };
      },
    };

    await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(seen).toEqual([REQ]);
  });

  it('KEIN Fallback: eine echte Registry mit gesundem Fremdkanal gibt nicht frei', async () => {
    // Regression gegen genau den Fehler, den die Matrix beheben soll: „erster gesunder Kanal".
    const other = {
      id: 'other',
      isHealthy: async (): Promise<boolean> => true,
      requestApproval: async (): Promise<ApprovalDecision> => ({
        outcome: 'approved',
        channelId: 'other',
      }),
    };
    const spy = vi.spyOn(other, 'requestApproval');
    const registry = new MeldekanalRegistry([other]);
    const fallback = vi.spyOn(registry, 'requestApproval');
    const matrix = matrixOf([ENTRY_TELEGRAM]); // adressiert 'telegram' — existiert in der Registry NICHT

    const res = await requestApprovalViaMatrix(matrix, registry, CTX, REQ);

    expect(isApproved(res.decision)).toBe(false);
    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(spy).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('gegen die echte Registry: der adressierte, gesunde Kanal entscheidet', async () => {
    const telegram = {
      id: 'telegram',
      isHealthy: async (): Promise<boolean> => true,
      requestApproval: async (): Promise<ApprovalDecision> => ({
        outcome: 'approved',
        channelId: 'telegram',
      }),
    };
    const registry = new MeldekanalRegistry([telegram]);

    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), registry, CTX, REQ);

    expect(isApproved(res.decision)).toBe(true);
    expect(res.decision.channelId).toBe('telegram');
  });
});

describe('requestApprovalViaMatrix — Totalität: kein Eingang erzeugt versehentlich `approved`', () => {
  it('rejected wird unverändert durchgereicht', async () => {
    const { approver } = approverOf(async () => ({ outcome: 'rejected', note: 'nope' }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('rejected');
    expect(res.decision.note).toBe('nope');
    expect(isApproved(res.decision)).toBe(false);
  });

  it('timeout wird unverändert durchgereicht', async () => {
    const { approver } = approverOf(async () => ({ outcome: 'timeout' }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('timeout');
    expect(isApproved(res.decision)).toBe(false);
  });

  it('Wurf des Approvers ⇒ error (Router wirft nie), Ziel bleibt für Audit sichtbar', async () => {
    const { approver } = approverOf(async () => {
      throw new Error('boom');
    });
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('error');
    expect(res.decision.note).toBe('boom');
    expect(res.decision.channelId).toBe('telegram');
    expect(res.target?.channel).toBe('telegram');
  });

  it('unbekanntes Decision-Shape ⇒ error, niemals approved', async () => {
    for (const bogus of [
      null,
      undefined,
      42,
      'approved',
      {},
      { outcome: 'ja' },
      { outcome: true },
    ]) {
      const { approver } = approverOf(async () => bogus);
      const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

      expect(res.decision.outcome).toBe('error');
      expect(isApproved(res.decision)).toBe(false);
    }
  });

  it('unbekannter Kanal in der echten Registry ⇒ denied-no-channel mit sprechender note', async () => {
    const registry = new MeldekanalRegistry([]);
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), registry, CTX, REQ);

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(res.decision.note).toContain('telegram');
    expect(res.decision.channelId).toBe('telegram'); // der ADRESSIERTE Kanal (existiert nicht)
  });
});

describe('requestApprovalViaMatrix — `decider` bleibt deklarativ (v1, SECURITY.md)', () => {
  it('human-decider wird durchgereicht, aber NICHT durchgesetzt', async () => {
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, decider: 'human:christian' }]);
    // Der Kanal antwortet ohne jeden Bezug zu „christian" — v1 erzwingt das bewusst nicht.
    const { approver } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    expect(isApproved(res.decision)).toBe(true);
    expect(res.target?.decider).toEqual({ kind: 'human', id: 'christian' });
  });

  it('consensus-decider wird weder erzwungen noch abgelehnt (dokumentierte v1-Grenze)', async () => {
    const matrix = matrixOf([{ ...ENTRY_TELEGRAM, decider: 'consensus:quorum=3' }]);
    const { approver, calls } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    const res = await requestApprovalViaMatrix(matrix, approver, CTX, REQ);

    // Festgeschrieben, damit eine spätere Verschärfung eine bewusste CO-Entscheidung bleibt
    // und nicht unbemerkt hier hineinrutscht. ⚠️ KEINE Billigung von „1-aus-N": die Schutzwirkung
    // liegt beim harten `consensus`-Tier-403 im Ingress, AUSSERHALB dieses Moduls (siehe Modul-Doc).
    expect(calls).toEqual(['telegram']);
    expect(isApproved(res.decision)).toBe(true);
    expect(res.target?.decider).toEqual({ kind: 'consensus', quorum: 3 });
  });
});

describe('requestApprovalViaMatrix — ctx/req müssen dasselbe Tripel tragen (Confused Deputy)', () => {
  const MATRIX_TWO = matrixOf([
    { tier: 'gate', server: 'unifi', tool: 'get_status', channel: 'auto', decider: 'human:bot' },
    { tier: 'gate', server: 'unifi', tool: '*', channel: 'telegram', decider: 'human:christian' },
  ]);

  it('Kanalwahl nach harmlosem Werkzeug, Vorlage des scharfen ⇒ denied, niemand gefragt', async () => {
    const { approver, calls } = approverOf(async (id) => ({ outcome: 'approved', channelId: id }));

    const res = await requestApprovalViaMatrix(
      MATRIX_TWO,
      approver,
      { tier: 'gate', server: 'unifi', tool: 'get_status' }, // wählt den bequemen Kanal 'auto'
      { ...REQ, tool: 'delete_site' }, // … vorgelegt würde aber das scharfe Werkzeug
    );

    expect(res.decision.outcome).toBe('denied-no-channel');
    expect(res.decision.note).toContain('mismatch');
    expect(res.target).toBeNull();
    expect(calls).toEqual([]);
  });

  it('abweichender server bzw. tier ⇒ ebenfalls denied, niemand gefragt', async () => {
    for (const ctx of [
      { tier: 'gate', server: 'pal', tool: 'block_client' } as ResolveContext,
      { tier: 'consensus', server: 'unifi', tool: 'block_client' } as ResolveContext,
    ]) {
      const { approver, calls } = approverOf(async (id) => ({
        outcome: 'approved',
        channelId: id,
      }));
      const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, ctx, REQ);

      expect(res.decision.outcome).toBe('denied-no-channel');
      expect(calls).toEqual([]);
    }
  });
});

describe('requestApprovalViaMatrix — Totalität der AUFLÖSUNG: ein Wurf wird zu Default-Deny', () => {
  // Die Auflösung ist auf eine `parseFreigabeMatrix`-validierte Matrix ausgelegt. Ein künftiger,
  // laxerer Loader (oder ein geforgtes Objekt) darf nicht als Exception nach oben durchschlagen —
  // sonst wäre der Fehlerpfad ein 500 statt eines belegbaren Denies.
  const BROKEN: unknown[] = [
    null,
    undefined,
    42,
    { entries: 42 }, // nicht iterierbar
    { entries: [{ tier: 'gate', server: 'unifi', tool: 'block_client', channel: 'telegram' }] }, // decider fehlt
    {
      entries: [
        {
          tier: 'gate',
          server: 'unifi',
          tool: 'block_client',
          decider: { kind: 'human', id: 'x' },
          get channel(): string {
            throw new Error('getter boom');
          },
        },
      ],
    },
  ];

  it.each(BROKEN.map((m, i) => [i, m] as const))(
    'geforgte Matrix #%i ⇒ denied-no-channel statt Wurf, niemand gefragt',
    async (_i, broken) => {
      const { approver, calls } = approverOf(async () => ({ outcome: 'approved' }));

      const res = await requestApprovalViaMatrix(broken as FreigabeMatrix, approver, CTX, REQ);

      expect(res.decision.outcome).toBe('denied-no-channel');
      expect(isApproved(res.decision)).toBe(false);
      expect(res.target).toBeNull();
      expect(calls).toEqual([]);
    },
  );
});

describe('requestApprovalViaMatrix — Prototypenkette erzeugt niemals eine Freigabe', () => {
  it('Decision NUR über die Prototypenkette (`Object.create`) ⇒ error, nie approved', async () => {
    const { approver } = approverOf(async () => Object.create({ outcome: 'approved' }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('error');
    expect(isApproved(res.decision)).toBe(false);
  });

  it('verseuchtes Object.prototype macht `{}` NICHT zu einer Freigabe', async () => {
    const proto = Object.prototype as unknown as { outcome?: unknown };
    proto.outcome = 'approved';
    try {
      const registry = new MeldekanalRegistry([
        {
          id: 'telegram',
          isHealthy: async (): Promise<boolean> => true,
          requestApproval: async (): Promise<ApprovalDecision> => ({}) as ApprovalDecision,
        },
      ]);

      const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), registry, CTX, REQ);

      expect(res.decision.outcome).toBe('error');
      expect(isApproved(res.decision)).toBe(false);
    } finally {
      delete proto.outcome;
    }
  });

  it('Array mit eigener outcome-Eigenschaft ⇒ error (Arrays sind keine Decision)', async () => {
    const { approver } = approverOf(async () => Object.assign([], { outcome: 'approved' }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('error');
    expect(isApproved(res.decision)).toBe(false);
  });

  it('werfender outcome-Getter ⇒ error (normalizeDecision wirft nicht)', async () => {
    const { approver } = approverOf(async () => ({
      get outcome(): string {
        throw new Error('outcome boom');
      },
    }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.outcome).toBe('error');
    expect(isApproved(res.decision)).toBe(false);
  });
});

describe('requestApprovalViaMatrix — Forensik: abweichende Kanal-Selbstauskunft geht nicht verloren', () => {
  it('behauptet der Approver einen anderen Kanal, landet das in der note', async () => {
    const { approver } = approverOf(async () => ({
      outcome: 'approved',
      channelId: 'some-other-channel',
    }));

    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.channelId).toBe('telegram'); // der ADRESSIERTE Matrix-Kanal
    expect(res.decision.note).toContain('some-other-channel');
  });

  it('gleicher Kanal ⇒ keine Rausch-note', async () => {
    const { approver } = approverOf(async () => ({ outcome: 'approved', channelId: 'telegram' }));
    const res = await requestApprovalViaMatrix(matrixOf([ENTRY_TELEGRAM]), approver, CTX, REQ);

    expect(res.decision.channelId).toBe('telegram');
    expect(res.decision.note).toBeUndefined();
  });
});
