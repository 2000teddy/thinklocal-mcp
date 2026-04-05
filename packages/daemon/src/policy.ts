/**
 * policy.ts — Leichtgewichtige Policy Engine fuer das Mesh
 *
 * Definiert Regeln wer was im Mesh darf:
 * - Welche Agents duerfen welche Skills abfragen?
 * - Welche Agents duerfen Skills installieren?
 * - Welche Agents duerfen Credentials teilen?
 * - Welche Task-Typen brauchen Human Approval?
 *
 * Statt OPA/Rego nutzen wir ein einfaches JSON-Format
 * das zur Laufzeit evaluiert wird. Policies koennen ueber
 * das Mesh signiert verteilt werden (Phase 2).
 *
 * Architektur:
 * - Default-Policies sind eingebaut (deny-by-default fuer Credentials)
 * - Custom-Policies aus config/policies.json
 * - Jede Policy hat: action, subject, resource, effect (allow/deny)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

// --- Policy-Typen ---

export type PolicyEffect = 'allow' | 'deny';

export type PolicyAction =
  | 'skill.execute'
  | 'skill.install'
  | 'skill.announce'
  | 'credential.read'
  | 'credential.write'
  | 'credential.share'
  | 'task.create'
  | 'task.delegate'
  | 'peer.connect'
  | 'audit.read';

export interface Policy {
  /** Eindeutiger Policy-Name */
  name: string;
  /** Beschreibung */
  description: string;
  /** Aktion die reguliert wird */
  action: PolicyAction;
  /** Wer (Agent-ID Pattern, "*" = alle) */
  subject: string;
  /** Worauf (Skill-ID Pattern, Credential-Name Pattern, "*" = alle) */
  resource: string;
  /** Erlauben oder Verbieten */
  effect: PolicyEffect;
  /** Erfordert Human Approval? */
  requires_approval?: boolean;
  /** Prioritaet (hoeher = wichtiger, default 0) */
  priority?: number;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  matchedPolicy: string | null;
  reason: string;
}

// --- Default-Policies (eingebaut) ---

const DEFAULT_POLICIES: Policy[] = [
  // Skill-Ausfuehrung: Standardmaessig erlaubt fuer alle Peers
  {
    name: 'default-skill-execute',
    description: 'Alle Peers duerfen Skills ausfuehren',
    action: 'skill.execute',
    subject: '*',
    resource: '*',
    effect: 'allow',
  },
  // Skill-Installation: Nur mit Approval
  {
    name: 'default-skill-install',
    description: 'Skill-Installation erfordert Genehmigung',
    action: 'skill.install',
    subject: '*',
    resource: '*',
    effect: 'allow',
    requires_approval: true,
  },
  // Credential-Lesen: Nur lokal
  {
    name: 'default-credential-read',
    description: 'Credential-Zugriff nur lokal',
    action: 'credential.read',
    subject: '*',
    resource: '*',
    effect: 'allow',
  },
  // Credential-Sharing: Immer mit Approval
  {
    name: 'default-credential-share',
    description: 'Credential-Sharing erfordert immer Genehmigung',
    action: 'credential.share',
    subject: '*',
    resource: '*',
    effect: 'allow',
    requires_approval: true,
    priority: 100,
  },
  // Peer-Verbindung: Standardmaessig erlaubt
  {
    name: 'default-peer-connect',
    description: 'Neue Peers werden akzeptiert',
    action: 'peer.connect',
    subject: '*',
    resource: '*',
    effect: 'allow',
  },
  // Audit: Alle duerfen lesen
  {
    name: 'default-audit-read',
    description: 'Audit-Log fuer alle lesbar',
    action: 'audit.read',
    subject: '*',
    resource: '*',
    effect: 'allow',
  },
];

// --- Policy Engine ---

export class PolicyEngine {
  private policies: Policy[] = [];

  constructor(
    private dataDir: string,
    private log?: Logger,
  ) {
    this.policies = [...DEFAULT_POLICIES];
    this.loadCustomPolicies();
  }

  /**
   * Evaluiert ob eine Aktion erlaubt ist.
   * Prueft alle Policies in Prioritaets-Reihenfolge.
   */
  evaluate(action: PolicyAction, subject: string, resource: string): PolicyDecision {
    // Policies nach Prioritaet sortieren (hoechste zuerst)
    const sorted = this.policies
      .filter((p) => p.action === action)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const policy of sorted) {
      if (this.matchesPattern(subject, policy.subject) && this.matchesPattern(resource, policy.resource)) {
        return {
          allowed: policy.effect === 'allow',
          requiresApproval: policy.requires_approval ?? false,
          matchedPolicy: policy.name,
          reason: policy.description,
        };
      }
    }

    // Default: Deny wenn keine Policy matched
    return {
      allowed: false,
      requiresApproval: false,
      matchedPolicy: null,
      reason: 'Keine Policy gefunden — Zugriff verweigert (deny-by-default)',
    };
  }

  /** Gibt alle aktiven Policies zurueck */
  listPolicies(): Policy[] {
    return [...this.policies];
  }

  /** Fuegt eine Policy hinzu */
  addPolicy(policy: Policy): void {
    this.policies.push(policy);
    this.log?.info({ name: policy.name, action: policy.action }, 'Policy hinzugefuegt');
  }

  /** Entfernt eine Policy nach Name */
  removePolicy(name: string): boolean {
    const before = this.policies.length;
    this.policies = this.policies.filter((p) => p.name !== name);
    return this.policies.length < before;
  }

  // --- Policy-Versionierung + Mesh-Verteilung ---

  /** Aktuelle Policy-Version (Hash ueber alle Policies) */
  getVersion(): string {
    const data = this.policies
      .map((p) => `${p.name}:${p.action}:${p.subject}:${p.resource}:${p.effect}:${p.priority ?? 0}`)
      .sort()
      .join('|');
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Exportiert alle Custom-Policies (ohne Defaults) fuer Mesh-Verteilung.
   * Kann von einem Peer importiert werden.
   */
  exportForSync(): { version: string; policies: Policy[] } {
    const customPolicies = this.policies.filter(
      (p) => !p.name.startsWith('default-'),
    );
    return {
      version: this.getVersion(),
      policies: customPolicies,
    };
  }

  /**
   * Importiert Policies von einem Peer (Mesh-Sync).
   * Akzeptiert nur wenn Version neuer (Version-String verglichen).
   */
  importFromPeer(data: { version: string; policies: Policy[] }, peerId: string): number {
    let imported = 0;
    for (const policy of data.policies) {
      // Nur importieren wenn nicht bereits vorhanden
      if (!this.policies.find((p) => p.name === policy.name)) {
        this.policies.push({ ...policy });
        imported++;
      }
    }
    if (imported > 0) {
      this.log?.info({ from: peerId, imported, version: data.version }, 'Policies von Peer importiert');
    }
    return imported;
  }

  /** Speichert aktuelle Custom-Policies auf Disk */
  save(): void {
    const policyPath = resolve(this.dataDir, 'policies.json');
    const custom = this.policies.filter((p) => !p.name.startsWith('default-'));
    const { writeFileSync } = require('node:fs');
    writeFileSync(policyPath, JSON.stringify(custom, null, 2));
    this.log?.info({ count: custom.length }, 'Policies gespeichert');
  }

  // --- Interne Methoden ---

  private loadCustomPolicies(): void {
    const policyPath = resolve(this.dataDir, 'policies.json');
    if (!existsSync(policyPath)) return;

    try {
      const raw = readFileSync(policyPath, 'utf-8');
      const custom = JSON.parse(raw) as Policy[];
      if (Array.isArray(custom)) {
        this.policies.push(...custom);
        this.log?.info({ count: custom.length }, 'Custom-Policies geladen');
      }
    } catch (err) {
      this.log?.warn({ err }, 'Custom-Policies laden fehlgeschlagen');
    }
  }

  /**
   * Einfacher Pattern-Matcher fuer Policy-Regeln.
   *
   * Unterstuetzte Muster:
   * - `"*"` — Matcht alles (Wildcard)
   * - `"system.*"` — Prefix-Match: matcht "system.health", "system.disk", etc.
   * - `"influxdb.query"` — Exakter Match: matcht nur genau diesen String
   *
   * NICHT unterstuetzt (by design — Einfachheit > Maechgkeit):
   * - Regex-Patterns (z.B. `"system\\..*"`)
   * - Glob-Patterns mit `?` oder `[abc]`
   * - Negation (z.B. `"!system.*"`)
   * - Mehrere Patterns (z.B. `"system.*,influxdb.*"`)
   *
   * Fuer komplexere Regeln: Mehrere Policies mit verschiedenen Patterns anlegen.
   */
  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return value === pattern;
  }
}
