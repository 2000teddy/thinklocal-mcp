/**
 * ADR-007 Phase A PR A3 — Approval Service tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalService } from './approvals.js';

describe('ApprovalService', () => {
  let dir: string;
  let svc: ApprovalService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tlmcp-approvals-'));
    svc = new ApprovalService(dir);
  });

  afterEach(() => {
    svc.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('create()', () => {
    it('creates a pending approval and returns the id', () => {
      const id = svc.create({
        type: 'peer_join',
        payload: { peer: 'spiffe://thinklocal/host/abc/agent/claude-code', pin: '123456' },
        summary: 'Peer abc wants to join the mesh',
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const row = svc.get(id)!;
      expect(row.status).toBe('pending');
      expect(row.type).toBe('peer_join');
      expect(row.summary).toContain('abc wants to join');
      expect(JSON.parse(row.payload_json).pin).toBe('123456');
      expect(row.decided_at).toBeNull();
    });
  });

  describe('decide()', () => {
    it('approves a pending request', () => {
      const id = svc.create({ type: 'peer_join', payload: {}, summary: 'test' });
      const decided = svc.decide(id, 'approved', 'looks good')!;
      expect(decided.status).toBe('approved');
      expect(decided.decided_at).not.toBeNull();
      expect(decided.decision_note).toBe('looks good');
    });

    it('rejects a pending request', () => {
      const id = svc.create({ type: 'peer_join', payload: {}, summary: 'test' });
      const decided = svc.decide(id, 'rejected', 'untrusted')!;
      expect(decided.status).toBe('rejected');
    });

    it('is idempotent: re-deciding returns the existing decision', () => {
      const id = svc.create({ type: 'peer_join', payload: {}, summary: 'test' });
      svc.decide(id, 'approved');
      const second = svc.decide(id, 'rejected', 'too late')!;
      // Should still be approved, not overwritten.
      expect(second.status).toBe('approved');
      expect(second.decision_note).not.toBe('too late');
    });

    it('returns null for unknown id', () => {
      expect(svc.decide('nonexistent', 'approved')).toBeNull();
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      svc.create({ type: 'peer_join', payload: {}, summary: 'peer A' });
      svc.create({ type: 'skill_activate', payload: {}, summary: 'skill X' });
      const id3 = svc.create({ type: 'peer_join', payload: {}, summary: 'peer B' });
      svc.decide(id3, 'approved');
    });

    it('returns all approvals without filter', () => {
      expect(svc.list()).toHaveLength(3);
    });

    it('filters by status', () => {
      const pending = svc.list({ status: 'pending' });
      expect(pending).toHaveLength(2);
    });

    it('filters by type', () => {
      const peerJoins = svc.list({ type: 'peer_join' });
      expect(peerJoins).toHaveLength(2);
    });

    it('filters by both status and type', () => {
      const pendingPeers = svc.list({ status: 'pending', type: 'peer_join' });
      expect(pendingPeers).toHaveLength(1);
      expect(pendingPeers[0]!.summary).toBe('peer A');
    });

    it('respects limit', () => {
      expect(svc.list({ limit: 1 })).toHaveLength(1);
    });
  });

  describe('pendingCount()', () => {
    it('counts all pending approvals', () => {
      svc.create({ type: 'peer_join', payload: {}, summary: 'a' });
      svc.create({ type: 'skill_activate', payload: {}, summary: 'b' });
      expect(svc.pendingCount()).toBe(2);
    });

    it('counts pending by type', () => {
      svc.create({ type: 'peer_join', payload: {}, summary: 'a' });
      svc.create({ type: 'skill_activate', payload: {}, summary: 'b' });
      expect(svc.pendingCount('peer_join')).toBe(1);
    });

    it('excludes decided approvals', () => {
      const id = svc.create({ type: 'peer_join', payload: {}, summary: 'a' });
      svc.decide(id, 'approved');
      expect(svc.pendingCount()).toBe(0);
    });
  });

  describe('isApproved()', () => {
    it('returns true for approved, false for pending/rejected/unknown', () => {
      const id1 = svc.create({ type: 'peer_join', payload: {}, summary: 'a' });
      expect(svc.isApproved(id1)).toBe(false); // pending
      svc.decide(id1, 'approved');
      expect(svc.isApproved(id1)).toBe(true);

      const id2 = svc.create({ type: 'peer_join', payload: {}, summary: 'b' });
      svc.decide(id2, 'rejected');
      expect(svc.isApproved(id2)).toBe(false);

      expect(svc.isApproved('nonexistent')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('survives re-opens', () => {
      svc.create({ type: 'peer_join', payload: {}, summary: 'persist test' });
      svc.close();
      const svc2 = new ApprovalService(dir);
      expect(svc2.pendingCount()).toBe(1);
      svc2.close();
    });
  });
});
