// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * launchd-plist.ts — ADR-029 (macOS LaunchDaemon): reiner Renderer + Validator für das
 * System-Domain-LaunchDaemon-Plist aus `scripts/service/com.thinklocal.daemon.plist.template`.
 *
 * Zweck: die fehleranfällige `sed`-Platzhalter-Ersetzung im Installer durch einen GETESTETEN,
 * reinen Kern absichern — keine hartkodierten Pfade/Benutzer (`/Users/chris`, `staff`), keine
 * im Output verbliebenen Platzhalter, ausschließlich absolute Pfade. Macht KEIN I/O, ruft KEIN
 * launchctl/bootstrap auf (das bleibt dem Installer + Christians Deploy-Gate vorbehalten).
 *
 * Platzhalter im Template: {{NODE_BIN}} {{REPO}} {{DATA_DIR}} {{CONFIG}} {{RUN_USER}} {{RUN_GROUP}}
 */

export interface LaunchDaemonContext {
  /** Absoluter Pfad zur node-Binary (z.B. /opt/homebrew/bin/node). */
  nodeBin: string;
  /** Absoluter Pfad zum Repo/Install-Verzeichnis. */
  repoDir: string;
  /** Absoluter Pfad zum Daten-Verzeichnis (enthält tls/, logs/, …). */
  dataDir: string;
  /** Benutzer, unter dem das Daemon läuft (Least-Privilege, NICHT root). */
  runUser: string;
  /** Gruppe, unter der das Daemon läuft. */
  runGroup: string;
  /** Optionaler Config-Pfad; Default: `${repoDir}/config/daemon.toml`. */
  configPath?: string;
}

/** Platzhalter-Syntax des Templates (für die Substitution): {{NAME}} mit Großbuchstaben/Unterstrich. */
const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;
/**
 * Streng-jeglicher `{{…}}`-Token (für die Clean-Prüfung). Bewusst breiter als PLACEHOLDER_RE,
 * damit auch ein versehentliches `{{lowercase}}`/`{{Mixed}}` im Template NICHT still
 * durchrutscht (CR-MEDIUM): die Substitution erfasst es nicht, also muss die Clean-Prüfung es fangen.
 */
const STRAY_PLACEHOLDER_RE = /\{\{[^}]*\}\}/g;
/** Legacy-Platzhalter der alten LaunchAgent-Plist (__NAME__) — dürfen NICHT übrig bleiben. */
const LEGACY_PLACEHOLDER_RE = /__[A-Z_]+__/;

/**
 * XML-escaped einen Wert, bevor er in ein `<string>`-Element substituiert wird (CR-HIGH).
 * Ohne dies würde ein Wert mit `&`/`<`/`>` entweder ein ungültiges Plist erzeugen oder —
 * schlimmer — zusätzliche XML-Elemente (z.B. weitere `ProgramArguments`) injizieren und damit
 * steuern, was launchd ausführt. `&` zuerst, sonst würden die Entities doppelt escaped.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validiert den Kontext fail-closed. Gibt eine Liste menschenlesbarer Fehler zurück
 * (leeres Array = gültig). Absolute Pfade erzwungen; keine leeren/whitespace-Werte;
 * Benutzer/Gruppe ohne Whitespace.
 */
export function validateLaunchDaemonContext(ctx: LaunchDaemonContext): string[] {
  const errors: string[] = [];
  const absField = (name: string, value: string | undefined): void => {
    if (!value || value.trim() === '') {
      errors.push(`${name} fehlt/leer`);
    } else if (!value.startsWith('/')) {
      errors.push(`${name} muss ein absoluter Pfad sein: '${value}'`);
    }
  };
  absField('nodeBin', ctx.nodeBin);
  absField('repoDir', ctx.repoDir);
  absField('dataDir', ctx.dataDir);
  if (ctx.configPath !== undefined) absField('configPath', ctx.configPath);

  const idField = (name: string, value: string): void => {
    if (!value || value.trim() === '') {
      errors.push(`${name} fehlt/leer`);
    } else if (/\s/.test(value)) {
      errors.push(`${name} darf keinen Whitespace enthalten: '${value}'`);
    }
  };
  idField('runUser', ctx.runUser);
  idField('runGroup', ctx.runGroup);
  return errors;
}

/**
 * Rendert das Template mit dem Kontext. Wirft, wenn (a) der Kontext ungültig ist,
 * (b) ein Template-Platzhalter im Kontext nicht abgedeckt ist, oder (c) nach dem
 * Ersetzen noch ein Platzhalter ({{…}} oder __…__) übrig bleibt (fail-closed —
 * ein unersetzter Platzhalter im LaunchDaemon-Plist würde sonst still ein kaputtes
 * Service-File erzeugen).
 */
export function renderLaunchDaemonPlist(template: string, ctx: LaunchDaemonContext): string {
  const errors = validateLaunchDaemonContext(ctx);
  if (errors.length > 0) {
    throw new Error(`[launchd-plist] ungültiger Kontext: ${errors.join('; ')}`);
  }

  const values: Record<string, string> = {
    NODE_BIN: ctx.nodeBin,
    REPO: ctx.repoDir,
    DATA_DIR: ctx.dataDir,
    CONFIG: ctx.configPath ?? `${ctx.repoDir}/config/daemon.toml`,
    RUN_USER: ctx.runUser,
    RUN_GROUP: ctx.runGroup,
  };

  const missing = new Set<string>();
  const rendered = template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const v = values[name];
    if (v === undefined) {
      missing.add(name);
      return _match;
    }
    // CR-HIGH: jeder Wert wird XML-escaped — ein `&`/`<`/`>` in Pfad/Benutzer darf weder das
    // Plist ungültig machen noch zusätzliche XML-Elemente injizieren.
    return escapeXml(v);
  });

  if (missing.size > 0) {
    throw new Error(
      `[launchd-plist] Template enthält unbekannte Platzhalter: ${[...missing].sort().join(', ')}`,
    );
  }

  assertRenderedPlistClean(rendered);
  return rendered;
}

/**
 * Prüft ein gerendertes Plist fail-closed: keine verbliebenen {{…}}/__…__-Platzhalter.
 * Wirft mit Kontext. Separat exportiert, damit der Installer das `sed`-Ergebnis ebenfalls
 * gegen denselben Vertrag prüfen kann.
 */
export function assertRenderedPlistClean(rendered: string): void {
  // CR-MEDIUM: STRAY_PLACEHOLDER_RE (jeglicher {{…}}-Token), NICHT PLACEHOLDER_RE — sonst
  // würde ein {{lowercase}}/{{Mixed}} unentdeckt durchrutschen.
  const curly = rendered.match(STRAY_PLACEHOLDER_RE);
  if (curly) {
    throw new Error(`[launchd-plist] unersetzte Platzhalter im Output: ${[...new Set(curly)].join(', ')}`);
  }
  const legacy = rendered.match(LEGACY_PLACEHOLDER_RE);
  if (legacy) {
    throw new Error(`[launchd-plist] Legacy-Platzhalter im Output: ${legacy[0]}`);
  }
}

/** Service-Label (Plist `Label`) + abgeleitete System-Domain-Konstanten (ADR-029). */
export const LAUNCHD_SERVICE_LABEL = 'com.thinklocal.daemon';
export const LAUNCHD_SYSTEM_PLIST_PATH = `/Library/LaunchDaemons/${LAUNCHD_SERVICE_LABEL}.plist`;

/**
 * ADR-029 Installer-Operationalisierung: deterministischer Install/Uninstall-Plan für den
 * System-Domain-LaunchDaemon. Reine Daten (keine Ausführung) — der Installer (`install.sh`)
 * konsumiert exakt diese Pfade/Kommandos. Hier getestet, damit Domain/Pfad/Rechte/Migration
 * EINE getestete Quelle haben (statt nur untestbares Bash). Führt NICHTS aus.
 */
export interface LaunchDaemonInstallPlan {
  label: string;
  /** Ziel-Plist in der System-Domain. */
  plistDst: string;
  /** Datei-Eigentum (System-Domain verlangt root:wheel). */
  owner: 'root:wheel';
  /** Datei-Rechte (644 — world-readable, nur root schreibbar). */
  mode: '644';
  /** `launchctl <bootstrapArgs...>` lädt den Daemon in die System-Domain. */
  bootstrapArgs: readonly string[];
  /** `launchctl <bootoutArgs...>` entlädt ihn (sauberer Stop, kein KeepAlive-Relaunch). */
  bootoutArgs: readonly string[];
  /** Alter LaunchAgent-Plist-Pfad des Nutzers — bei Migration entladen + entfernen. */
  legacyAgentPath: string;
  /** `launchctl unload <legacyAgentPath>` (alte LaunchAgent-Domain). */
  legacyUnloadArgs: readonly string[];
}

/**
 * Baut den Install/Uninstall-Plan. `userHome` = Home des installierenden Nutzers (für den
 * Legacy-LaunchAgent-Pfad). Rein; wirft bei leerem/relativem `userHome` (fail-closed).
 */
export function buildLaunchDaemonInstallPlan(opts: { userHome: string }): LaunchDaemonInstallPlan {
  const home = opts.userHome;
  if (!home || home.trim() === '' || !home.startsWith('/')) {
    throw new Error(`[launchd-plist] buildLaunchDaemonInstallPlan: ungültiges userHome '${home}'`);
  }
  const legacyAgentPath = `${home.replace(/\/+$/, '')}/Library/LaunchAgents/${LAUNCHD_SERVICE_LABEL}.plist`;
  return {
    label: LAUNCHD_SERVICE_LABEL,
    plistDst: LAUNCHD_SYSTEM_PLIST_PATH,
    owner: 'root:wheel',
    mode: '644',
    bootstrapArgs: ['bootstrap', 'system', LAUNCHD_SYSTEM_PLIST_PATH],
    bootoutArgs: ['bootout', `system/${LAUNCHD_SERVICE_LABEL}`],
    legacyAgentPath,
    legacyUnloadArgs: ['unload', legacyAgentPath],
  };
}
