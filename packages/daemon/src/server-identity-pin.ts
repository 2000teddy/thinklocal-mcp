// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * server-identity-pin.ts — ADR-028 D2b-pin: per-Host-Pin (TOFU) für die SPIFFE-
 * Server-Identitäts-Verifikation. Schließt die in ADR-028-D2 dokumentierte
 * „nackter TOFU"-Restlücke: statt bei aktivem Flag JEDE gültige thinklocal-SPIFFE-
 * SAN zu akzeptieren, wird die beim ersten validierten Kontakt gesehene kanonische
 * Identität pro Dial-Host GEPINNT und danach ERZWUNGEN.
 *
 * Warum dial-host-gekeyt (nicht über die Mesh-Registry by host): der Overlay-Dial
 * geht auf die Tailscale-100.x-Adresse, während `MeshPeer.host` die entdeckte LAN-IP
 * trägt — die matchen nicht. Der Pin muss deshalb auf dem TATSÄCHLICHEN Dial-Host
 * basieren, dessen Cert (CA-validiert via rejectUnauthorized) im Handshake die
 * kanonische SAN liefert.
 *
 * Sicherheit: First-Contact bleibt TOFU (inhärent; CA-Chain ist geprüft, aber der
 * erste Responder wird vertraut). Der Pin verhindert SPÄTERE Impersonation: ein
 * anderer (ebenfalls CA-signierter) Mesh-Node, der sich später unter derselben
 * Host-Adresse ausgibt, wird gegen den Pin abgelehnt (fail-closed im Verifier).
 */
import { spiffeUrisFromSubjectAltName } from './peer-identity.js';
import { normalizeAgentId } from './spiffe-uri.js';
import { verifyMeshServerIdentity, type PeerCertLike } from './mesh-server-identity.js';
import type { Logger } from 'pino';

export type PinOutcome = 'pinned' | 'match' | 'conflict';

/**
 * In-Memory-Pin-Store: Dial-Host → normalisierte kanonische SPIFFE-Identität.
 *
 * CR-LOW (gpt-5.3-codex): bewusst NICHT persistent — nach einem Daemon-Neustart
 * tritt der (inhärente) First-Contact-TOFU pro Host einmalig erneut auf. Akzeptabel,
 * weil die CA-Chain weiterhin streng geprüft wird (rejectUnauthorized) und das Fenster
 * nur den ersten Dial nach Neustart betrifft. Atomare 0600-Persistenz (Re-TOFU
 * vermeiden) ist ein bewusster Folgeschritt, falls operativ erwünscht.
 */
export class ServerIdentityPinStore {
  private readonly pins = new Map<string, string>();

  /** Gepinnte erwartete Identität für `host`, oder undefined (noch nicht gepinnt). */
  get(host: string): string | undefined {
    return this.pins.get(host);
  }

  has(host: string): boolean {
    return this.pins.has(host);
  }

  /**
   * TOFU-Beobachtung: pinnt `host`→`normalizedId`, falls noch ungepinnt.
   * - ungepinnt → 'pinned'
   * - gepinnt + gleich → 'match'
   * - gepinnt + abweichend → 'conflict' (Pin bleibt UNVERÄNDERT — kein Re-Pin auf
   *   eine fremde Identität; die Ablehnung erfolgt fail-closed im Verifier).
   */
  observe(host: string, normalizedId: string): PinOutcome {
    const current = this.pins.get(host);
    if (current === undefined) {
      this.pins.set(host, normalizedId);
      return 'pinned';
    }
    return current === normalizedId ? 'match' : 'conflict';
  }

  size(): number {
    return this.pins.size;
  }
}

/**
 * Genau EINE kanonische thinklocal-SPIFFE-Identität aus den Cert-SANs, oder null bei
 * 0 oder >1 (mehrdeutig → KEIN Auto-Pin; lieber TOFU als ein falscher Pin). Reine Funktion.
 */
export function singleNormalizedIdFromCert(cert: PeerCertLike | undefined): string | null {
  const ids = new Set<string>();
  for (const san of spiffeUrisFromSubjectAltName(cert?.subjectaltname)) {
    try {
      ids.add(normalizeAgentId(san));
    } catch {
      // fremde Trust-Domain / malformed → ignorieren
    }
  }
  if (ids.size !== 1) return null;
  const [only] = ids;
  return only ?? null;
}

/**
 * Baut eine `checkServerIdentity`-Funktion (Node-TLS-Vertrag), die den per-Host-Pin
 * erzwingt: erst gegen den (ggf. vorhandenen) Pin verifizieren; bei First-Contact ohne
 * Pin TOFU + eindeutige kanonische Identität pinnen. Vertrag: `undefined`=ok, `Error`=Abbruch.
 */
export function makePinningMeshCheckServerIdentity(
  store: ServerIdentityPinStore,
  log?: Logger,
): (host: string, cert: PeerCertLike) => Error | undefined {
  return (host: string, cert: PeerCertLike): Error | undefined => {
    const expected = store.get(host);
    const err = verifyMeshServerIdentity(host, cert, { expectedSpiffeId: expected });
    if (err) return err;
    if (expected === undefined) {
      // First-Contact: kanonische Identität pinnen, falls eindeutig.
      const id = singleNormalizedIdFromCert(cert);
      if (id) {
        const outcome = store.observe(host, id);
        if (outcome === 'pinned') {
          log?.info({ host, id }, '[mesh-server-identity] TOFU-Pin gesetzt (D2b-pin)');
        }
      } else {
        log?.warn(
          { host },
          '[mesh-server-identity] kein eindeutiger kanonischer SAN → kein Pin gesetzt (TOFU bleibt für diesen Host)',
        );
      }
    }
    return undefined;
  };
}
