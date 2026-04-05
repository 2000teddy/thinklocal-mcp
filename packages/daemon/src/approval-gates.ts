/**
 * approval-gates.ts — Konfigurierbare Approval-Gates pro Task-Typ
 *
 * Bestimmt welche Tasks automatisch ausgefuehrt werden duerfen
 * und welche eine manuelle Genehmigung (Human Approval) brauchen.
 *
 * Konfiguration via JSON-Datei oder Default-Regeln.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

export type ApprovalAction = 'auto' | 'approve' | 'deny';

export interface ApprovalGateRule {
  /** Skill-ID Pattern (z.B. "credential.*", "system.health", "*") */
  skillPattern: string;
  /** Requester-Pattern (Agent-ID, "*" = alle) */
  requesterPattern: string;
  /** Aktion: auto (sofort), approve (warten auf Genehmigung), deny (ablehnen) */
  action: ApprovalAction;
  /** Beschreibung der Regel */
  description?: string;
}

const DEFAULT_RULES: ApprovalGateRule[] = [
  // System-Skills: Automatisch erlaubt
  { skillPattern: 'system.*', requesterPattern: '*', action: 'auto', description: 'System-Skills sind sicher' },
  // Credential-Zugriff: Immer genehmigungspflichtig
  { skillPattern: 'credential.*', requesterPattern: '*', action: 'approve', description: 'Credential-Zugriff benoetigt Genehmigung' },
  // Alles andere: Automatisch (kann per Config geaendert werden)
  { skillPattern: '*', requesterPattern: '*', action: 'auto', description: 'Default: automatisch' },
];

/**
 * Evaluiert ob ein Task automatisch, mit Genehmigung oder gar nicht ausgefuehrt werden soll.
 */
export class ApprovalGates {
  private rules: ApprovalGateRule[] = [];

  constructor(
    dataDir: string,
    private log?: Logger,
  ) {
    this.rules = [...DEFAULT_RULES];
    this.loadCustomRules(dataDir);
  }

  /**
   * Evaluiert einen Task-Request.
   * Gibt die Aktion zurueck: auto, approve, oder deny.
   */
  evaluate(skillId: string, requesterId: string): { action: ApprovalAction; rule: string } {
    for (const rule of this.rules) {
      if (this.matchPattern(skillId, rule.skillPattern) &&
          this.matchPattern(requesterId, rule.requesterPattern)) {
        return { action: rule.action, rule: rule.description ?? rule.skillPattern };
      }
    }
    // Default: deny (paranoid)
    return { action: 'deny', rule: 'no matching rule' };
  }

  /** Gibt alle aktiven Regeln zurueck */
  listRules(): ApprovalGateRule[] {
    return [...this.rules];
  }

  /** Fuegt eine Regel am Anfang ein (hoechste Prioritaet) */
  addRule(rule: ApprovalGateRule): void {
    this.rules.unshift(rule);
    this.log?.info({ skill: rule.skillPattern, action: rule.action }, 'Approval-Gate-Regel hinzugefuegt');
  }

  private loadCustomRules(dataDir: string): void {
    const rulesPath = resolve(dataDir, 'approval-gates.json');
    if (!existsSync(rulesPath)) return;
    try {
      const raw = readFileSync(rulesPath, 'utf-8');
      const custom = JSON.parse(raw) as ApprovalGateRule[];
      if (Array.isArray(custom)) {
        // Custom-Regeln VOR Default-Regeln (hohere Prioritaet)
        this.rules = [...custom, ...this.rules];
        this.log?.info({ count: custom.length }, 'Custom Approval-Gates geladen');
      }
    } catch (err) {
      this.log?.warn({ err }, 'Approval-Gates laden fehlgeschlagen');
    }
  }

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
    return value === pattern;
  }
}
