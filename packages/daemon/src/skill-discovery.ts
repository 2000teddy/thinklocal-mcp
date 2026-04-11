/**
 * Skill Discovery — Der "ioBroker-Moment"
 *
 * Automatisiert den Flow:
 *   1. Daemon startet → liest eigene Skills
 *   2. Bei jedem neuen Peer → announced lokale Skills via Gossip
 *   3. Empfaengt SKILL_ANNOUNCE → installiert als neutrales Manifest
 *   4. Materialisiert als SKILL.md + manifest.json in ~/.thinklocal/skills/
 *   5. Triggert Claude-Code-Adapter → .claude/skills/<name>.md
 *   6. Capability-Activation: discovered → active (fuer gepaarte Peers)
 *
 * Verbindet den alten SkillManager (Phase 3) mit dem neuen
 * agent-neutralen Manifest-Format (PR #98) und dem Capability-
 * Activation-State (PR #100).
 *
 * See: docs/ROADMAP-POST-PAPERCLIP.md "ioBroker-Moment"
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import {
  installSkill,
  listInstalledSkills,
  type SkillManifest as NeutralManifest,
  computeManifestHash,
} from './skill-manifest.js';
import { installClaudeSkill } from './skill-adapter-claude.js';
import type { CapabilityActivationStore } from './capability-activation.js';
import type { MeshEventBus } from './events.js';

export interface SkillDiscoveryDeps {
  /** Data directory root (~/.thinklocal). */
  dataDir: string;
  /** Own daemon SPIFFE-URI (3-component). */
  ownAgentId: string;
  /** Capability activation store (PR #100). */
  activation: CapabilityActivationStore;
  /** Event bus for live notifications. */
  eventBus: MeshEventBus;
  /** Logger. */
  log?: Logger;
  /** Override Claude skills target dir (for tests). */
  claudeSkillsDir?: string;
}

export interface AnnouncedSkill {
  name: string;
  version: string;
  description: string;
  origin: string;
  capabilities: string[];
  prompt?: string;
}

export class SkillDiscovery {
  private readonly deps: SkillDiscoveryDeps;

  constructor(deps: SkillDiscoveryDeps) {
    this.deps = deps;
  }

  /**
   * Build the list of local skills to announce to peers.
   * Reads from ~/.thinklocal/skills/ (neutral manifest format).
   */
  getLocalAnnouncements(): AnnouncedSkill[] {
    const installed = listInstalledSkills(this.deps.dataDir);
    return installed.map((s) => {
      // Include SKILL.md content so multi-hop re-announcement preserves
      // the prompt. Without this, a skill discovered from Peer B and
      // re-announced to Peer C would lose its prompt content.
      // (Gemini-Pro CR LOW: prompt loss on re-announcement.)
      let prompt: string | undefined;
      if (s.hasPrompt) {
        try {
          prompt = readFileSync(resolve(s.dirPath, 'SKILL.md'), 'utf8');
        } catch {
          /* non-fatal — announce without prompt */
        }
      }
      return {
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description,
        origin: this.deps.ownAgentId,
        capabilities: s.manifest.capabilities,
        prompt,
      };
    });
  }

  /**
   * Process an incoming skill announcement from a peer.
   * Installs the skill locally as a neutral manifest + SKILL.md,
   * registers it in the capability-activation store, and triggers
   * the Claude Code adapter.
   *
   * Returns the number of newly installed skills.
   */
  handlePeerAnnouncement(
    peerAgentId: string,
    skills: AnnouncedSkill[],
  ): number {
    let installed = 0;
    const { activation, eventBus, log } = this.deps;

    for (const skill of skills) {
      const manifest: NeutralManifest = {
        name: skill.name,
        version: skill.version,
        description: skill.description,
        origin: peerAgentId,
        capabilities: skill.capabilities,
        format_version: 1,
      };

      // Install as neutral manifest in ~/.thinklocal/skills/<name>/
      const result = installSkill(manifest, skill.prompt, this.deps.dataDir);
      const hash = computeManifestHash(manifest);

      // Track whether any capability was newly discovered (not just updated)
      let isNewDiscovery = false;

      // Register in capability-activation store
      for (const capId of skill.capabilities) {
        // discover() returns the row id — check if it's the first time
        const existingBefore = activation.get(capId, peerAgentId);
        activation.discover(capId, skill.version, peerAgentId, hash);

        if (!existingBefore) {
          isNewDiscovery = true;
        }

        // Auto-activate for paired peers (the ioBroker default).
        // SECURITY NOTE: this implies a high-trust mesh. A compromised peer
        // could announce arbitrary capabilities and they'd be auto-activated.
        // For production use with untrusted peers, consider gating activation
        // behind the Approval service (ADR-007 PR #97). Currently this is
        // acceptable because all peers are locally-owned + manually paired.
        // (Gemini-Pro CR MEDIUM: document trust model.)
        if (activation.activate(capId, peerAgentId)) {
          log?.info(
            { capabilityId: capId, peer: peerAgentId },
            '[skill-discovery] capability auto-activated',
          );
          eventBus.emit('capability:activated', {
            capabilityId: capId,
            peer: peerAgentId,
            skillName: skill.name,
          });
        }
      }

      // Trigger Claude Code adapter
      try {
        const adapterResult = installClaudeSkill(result, this.deps.claudeSkillsDir);
        if (adapterResult.written) {
          log?.info(
            { skillName: skill.name, outputPath: adapterResult.outputPath },
            '[skill-discovery] Claude Code skill installed',
          );
        }
      } catch (err) {
        // Adapter failure should not block the discovery flow
        log?.warn(
          { skillName: skill.name, err },
          '[skill-discovery] Claude Code adapter failed (non-fatal)',
        );
      }

      // Only count genuinely new skills, not re-announcements of existing ones.
      // (Gemini-Pro CR HIGH: misleading counter.)
      if (isNewDiscovery) {
        installed++;
        eventBus.emit('capability:discovered', {
          skillName: skill.name,
          peer: peerAgentId,
          capabilities: skill.capabilities,
        });
      }
    }

    if (installed > 0) {
      log?.info(
        { peer: peerAgentId, installed, total: skills.length },
        '[skill-discovery] peer skills installed',
      );
    }

    return installed;
  }

  /**
   * Summary of all discovered skills (for CLI / Dashboard display).
   * Returns the "ioBroker-Moment" message.
   */
  getDiscoverySummary(): string {
    const skills = listInstalledSkills(this.deps.dataDir);
    if (skills.length === 0) {
      return 'No skills discovered yet. Connect peers to discover capabilities.';
    }

    const byOrigin = new Map<string, string[]>();
    for (const s of skills) {
      const origin = s.manifest.origin || 'local';
      const list = byOrigin.get(origin) ?? [];
      list.push(s.manifest.name);
      byOrigin.set(origin, list);
    }

    const lines = ['Discovered skills in your mesh:'];
    for (const [origin, names] of byOrigin) {
      lines.push(`  ${origin}: ${names.join(', ')}`);
    }
    return lines.join('\n');
  }
}
