// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * cert-monitor-wiring.ts — ADR-045 Vorbedingung B: die **testbare** Verdrahtung der Cert-Expiry-Monitore.
 *
 * #297 hat die B-Funktionsteile geliefert (`getCaCertDaysLeft`, `cert-expiry-monitor.ts` `subject`-Label,
 * `ca-cert-expiry.test.ts`) — aber die **Verdrahtung** in `index.ts` (dass der Daemon **beide** Monitore mit
 * den **richtigen** Quellen startet: Node-Leaf via `getCertDaysLeft`, CA/Intermediate via `getCaCertDaysLeft`,
 * getrennt per `subject`) lief **inline im Main** und war **ungetestet**: ein versehentliches „beide lesen
 * `node.crt.pem`" oder ein weggefallener CA-Monitor wäre unsichtbar geblieben. Diese Datei zieht genau diese
 * Auswahl in eine **reine** Funktion, die `index.ts` konsumiert und ein Test regressionsfest macht.
 *
 * Rein, kein I/O beim Bauen (die `getDaysLeft`-Closures lesen erst beim Aufruf), keine Runtime-Verdrahtung
 * hier — `index.ts` ergänzt `log`/`audit`/`eventBus` und ruft `startCertExpiryMonitor` je Spec.
 */
import { getCertDaysLeft, getCaCertDaysLeft } from './tls.js';
import type { CertExpiryMonitorDeps, CertExpiryThresholds } from './cert-expiry-monitor.js';

/** Der quell-/klassifikationsspezifische Teil eines Monitors (ohne Runtime-Deps log/audit/eventBus). */
export type CertExpiryMonitorSpec = Pick<CertExpiryMonitorDeps, 'getDaysLeft' | 'subject' | 'thresholds'>;

/**
 * Baut die Spezifikationen für **alle** Cert-Expiry-Monitore des Daemons (ADR-045 Vorbedingung B):
 *  - **Node-Leaf** (`node.crt.pem` via {@link getCertDaysLeft}), `subject: 'Node'`.
 *  - **CA/Intermediate** (`ca.crt.pem` via {@link getCaCertDaysLeft}), `subject: 'CA'` — vorher sah der
 *    Node-Monitor die CA nie (Ausstellungs-Tod lief lautlos).
 *
 * Beide teilen dieselben Schwellen. Rein; die Datei-Zugriffe passieren erst, wenn eine `getDaysLeft`-Closure
 * aufgerufen wird.
 */
export function buildCertExpiryMonitorSpecs(
  dataDir: string,
  thresholds: CertExpiryThresholds,
): CertExpiryMonitorSpec[] {
  return [
    { getDaysLeft: () => getCertDaysLeft(dataDir), subject: 'Node', thresholds },
    { getDaysLeft: () => getCaCertDaysLeft(dataDir), subject: 'CA', thresholds },
  ];
}
