/**
 * Skill Discovery tests — the "ioBroker-Moment" flow.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillDiscovery, type AnnouncedSkill } from './skill-discovery.js';
import { CapabilityActivationStore } from './capability-activation.js';
import { MeshEventBus, type MeshEvent } from './events.js';
import { installSkill, type SkillManifest, MANIFEST_FORMAT_VERSION } from './skill-manifest.js';

const OWN_ID = 'spiffe://thinklocal/host/abc/agent/claude-code';
const PEER_ID = 'spiffe://thinklocal/host/def/agent/claude-code';

function makeAnnouncement(overrides: Partial<AnnouncedSkill> = {}): AnnouncedSkill {
  return {
    name: 'thinklocal-influxdb',
    version: '1.0.0',
    description: 'Query InfluxDB time-series data',
    origin: PEER_ID,
    capabilities: ['influxdb.query', 'influxdb.write'],
    ...overrides,
  };
}

describe('SkillDiscovery', () => {
  let dataDir: string;
  let claudeDir: string;
  let activation: CapabilityActivationStore;
  let eventBus: MeshEventBus;
  let discovery: SkillDiscovery;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tlmcp-discovery-'));
    claudeDir = mkdtempSync(join(tmpdir(), 'claude-skills-'));
    activation = new CapabilityActivationStore(dataDir);
    eventBus = new MeshEventBus();
    discovery = new SkillDiscovery({
      dataDir,
      ownAgentId: OWN_ID,
      activation,
      eventBus,
      claudeSkillsDir: claudeDir,
    });
  });

  afterEach(() => {
    activation.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
  });

  describe('handlePeerAnnouncement()', () => {
    it('installs a skill from a peer announcement', () => {
      const count = discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);
      expect(count).toBe(1);

      // Neutral manifest installed
      const manifestPath = join(dataDir, 'skills', 'thinklocal-influxdb', 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(manifest.name).toBe('thinklocal-influxdb');
      expect(manifest.origin).toBe(PEER_ID);
    });

    it('auto-activates capabilities for the peer', () => {
      discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);

      expect(activation.isActive('influxdb.query', PEER_ID)).toBe(true);
      expect(activation.isActive('influxdb.write', PEER_ID)).toBe(true);
    });

    it('creates a Claude Code skill file', () => {
      discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);

      const claudePath = join(claudeDir, 'thinklocal-influxdb.md');
      expect(existsSync(claudePath)).toBe(true);
      const content = readFileSync(claudePath, 'utf8');
      expect(content).toContain('name: thinklocal-influxdb');
      expect(content).toContain('source: thinklocal-mesh');
    });

    it('emits capability:discovered and capability:activated events', () => {
      const events: MeshEvent[] = [];
      eventBus.onAny((e) => events.push(e));

      discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);

      const types = events.map((e) => e.type);
      expect(types).toContain('capability:discovered');
      expect(types).toContain('capability:activated');
    });

    it('handles multiple skills in one announcement', () => {
      const skills = [
        makeAnnouncement({ name: 'skill-a', capabilities: ['a.do'] }),
        makeAnnouncement({ name: 'skill-b', capabilities: ['b.do'] }),
      ];
      const count = discovery.handlePeerAnnouncement(PEER_ID, skills);
      expect(count).toBe(2);
      expect(activation.isActive('a.do', PEER_ID)).toBe(true);
      expect(activation.isActive('b.do', PEER_ID)).toBe(true);
    });

    it('is idempotent — re-announcing same skill does not create duplicates', () => {
      discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);
      discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);
      expect(activation.listActive()).toHaveLength(2); // 2 capabilities, not 4
    });

    // Gemini-Pro CR MEDIUM: explicit path traversal regression test
    it('rejects malicious skill names via installSkill sanitization', () => {
      const malicious = makeAnnouncement({ name: '../../etc/passwd', capabilities: ['evil.do'] });
      // installSkill throws on path traversal — handlePeerAnnouncement should
      // not crash but also should not install.
      expect(() => discovery.handlePeerAnnouncement(PEER_ID, [malicious])).toThrow();
      const badPath = join(dataDir, '..', '..', 'etc', 'passwd');
      expect(existsSync(badPath)).toBe(false);
    });

    // Gemini-Pro CR HIGH: counter should only count genuinely new skills
    it('returns 0 for re-announcements of already-known skills', () => {
      const first = discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);
      expect(first).toBe(1);
      const second = discovery.handlePeerAnnouncement(PEER_ID, [makeAnnouncement()]);
      expect(second).toBe(0);
    });

    it('includes prompt content in the installed SKILL.md when provided', () => {
      const withPrompt = makeAnnouncement({ prompt: '# Custom Instructions\n\nDo the thing.' });
      discovery.handlePeerAnnouncement(PEER_ID, [withPrompt]);

      const skillMd = join(dataDir, 'skills', 'thinklocal-influxdb', 'SKILL.md');
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, 'utf8')).toContain('Custom Instructions');
    });
  });

  describe('getLocalAnnouncements()', () => {
    it('returns installed skills for broadcasting to peers', () => {
      installSkill(
        {
          name: 'my-local-skill',
          version: '1.0.0',
          description: 'Test',
          origin: OWN_ID,
          capabilities: ['local.do'],
          format_version: MANIFEST_FORMAT_VERSION,
        },
        '# Local skill prompt',
        dataDir,
      );

      const announcements = discovery.getLocalAnnouncements();
      expect(announcements).toHaveLength(1);
      expect(announcements[0]!.name).toBe('my-local-skill');
      expect(announcements[0]!.origin).toBe(OWN_ID);
    });

    it('returns empty array when no skills are installed', () => {
      expect(discovery.getLocalAnnouncements()).toEqual([]);
    });
  });

  describe('getDiscoverySummary()', () => {
    it('returns a human-readable summary of discovered skills', () => {
      discovery.handlePeerAnnouncement(PEER_ID, [
        makeAnnouncement({ name: 'influxdb' }),
        makeAnnouncement({ name: 'n8n-trigger' }),
      ]);

      const summary = discovery.getDiscoverySummary();
      expect(summary).toContain('Discovered skills');
      expect(summary).toContain('influxdb');
      expect(summary).toContain('n8n-trigger');
    });

    it('returns a helpful message when no skills are discovered', () => {
      const summary = discovery.getDiscoverySummary();
      expect(summary).toContain('No skills discovered');
    });
  });
});
