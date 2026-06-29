/**
 * cert-expiry-monitor.ts — T2.1 (V5 Spur 2)
 *
 * Live-Überwachung des TLS-Node-Cert-Ablaufs. Schließt die im RE-CHECK
 * (PR #212) belegte Lücke: bisher wurde der Ablauf NUR einmal beim Start
 * geprüft → ein langlebiger Daemon, der über das Ablaufdatum hinaus läuft,
 * bekam keinen Alarm.
 *
 * WICHTIG (RE-CHECK-Verdikt): Dieser Monitor ROTIERT NICHT. Der Reissue
 * passiert weiterhin ausschließlich beim (Neu-)Start via
 * `loadOrCreateTlsBundle()` (Behalten-Gate `daysLeft > 7`). Der Monitor macht
 * den Ablauf nur SICHTBAR (Log + signiertes Audit-Event + EventBus) und sagt im
 * Critical-Fall explizit, dass ein **Neustart** den Reissue auslöst.
 */
import type { Logger } from 'pino';
import type { AuditEventType } from './audit.js';
import type { MeshEventType } from './events.js';

export type CertExpiryTier = 'ok' | 'warn' | 'critical' | 'unknown';

export interface CertExpiryThresholds {
  /** Warnschwelle in Tagen (z. B. 30). */
  warnDays: number;
  /** Kritisch-Schwelle in Tagen (z. B. 7). */
  criticalDays: number;
}

/** Strukturell getippte Abhängigkeiten — hält das Modul unit-testbar. */
export interface CertExpiryMonitorDeps {
  /** Liefert verbleibende Tage des Node-Certs, oder null wenn unlesbar. */
  getDaysLeft: () => number | null;
  thresholds: CertExpiryThresholds;
  log: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  audit: { append: (type: AuditEventType, peerId?: string, details?: string) => void };
  eventBus: { emit: (type: MeshEventType, data?: Record<string, unknown>) => void };
}

/**
 * Reine Klassifikation — keine Seiteneffekte. `daysLeft === null` → 'unknown'.
 * Reihenfolge: critical (≤ criticalDays) vor warn (≤ warnDays) vor ok.
 */
export function classifyCertExpiry(
  daysLeft: number | null,
  thresholds: CertExpiryThresholds,
): CertExpiryTier {
  if (daysLeft === null) return 'unknown';
  if (daysLeft <= thresholds.criticalDays) return 'critical';
  if (daysLeft <= thresholds.warnDays) return 'warn';
  return 'ok';
}

/**
 * Führt EINEN Check aus: klassifiziert, loggt, und alarmiert bei warn/critical
 * durch ein signiertes Audit-Event (`CERT_EXPIRY_WARNING`) + EventBus-Emit
 * (`system:cert_expiry`). Gibt den Tier zurück (für Tests/Caller).
 *
 * Bei 'ok'/'unknown' wird KEIN Audit-Event geschrieben (kein Log-Spam) — nur
 * debug/warn-Log. So bleibt der Audit-Log ein Signal, kein Heartbeat.
 */
export function runCertExpiryCheck(deps: CertExpiryMonitorDeps): CertExpiryTier {
  const daysLeft = deps.getDaysLeft();
  const tier = classifyCertExpiry(daysLeft, deps.thresholds);

  if (tier === 'unknown') {
    deps.log.warn('[cert-monitor] Node-Cert-Restlaufzeit nicht ermittelbar (Cert unlesbar?)');
    return tier;
  }
  if (tier === 'ok') {
    deps.log.debug({ daysLeft }, '[cert-monitor] Node-Cert gültig');
    return tier;
  }

  // warn | critical → sichtbar + durabel.
  const restartHint =
    'Reissue passiert erst beim Daemon-Neustart (loadOrCreateTlsBundle, daysLeft<=7) — KEINE In-Process-Rotation.';
  const details = JSON.stringify({ daysLeft, tier, action: restartHint });

  if (tier === 'critical') {
    deps.log.error({ daysLeft, action: restartHint }, '[cert-monitor] KRITISCH: TLS-Node-Cert läuft sehr bald ab — Neustart für Reissue erforderlich');
  } else {
    deps.log.warn({ daysLeft, action: restartHint }, '[cert-monitor] TLS-Node-Cert läuft bald ab');
  }

  // Signiertes Audit-Event (kein stiller Fehler) + EventBus für Dashboard/SSE.
  deps.audit.append('CERT_EXPIRY_WARNING', undefined, details);
  deps.eventBus.emit('system:cert_expiry', { daysLeft, tier });

  return tier;
}

/**
 * Startet den periodischen Monitor: ein sofortiger Check + `setInterval`.
 * Der Timer ist `unref()`'d (blockiert Shutdown nicht) und wird vom Caller im
 * `shutdown()` via `clearInterval` gestoppt. Jeder Lauf ist try/catch-gekapselt
 * — ein Check-Fehler darf den Daemon nie crashen.
 */
export function startCertExpiryMonitor(
  deps: CertExpiryMonitorDeps,
  intervalMs: number,
): NodeJS.Timeout {
  const tick = (): void => {
    try {
      runCertExpiryCheck(deps);
    } catch (err) {
      deps.log.warn({ err }, '[cert-monitor] Check fehlgeschlagen');
    }
  };
  tick(); // sofort beim Start
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}
