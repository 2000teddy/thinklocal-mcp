/**
 * mesh-server-identity.ts — ADR-028 D2b: SPIFFE-URI-basierte Server-Identitäts-
 * Verifikation für ausgehende mTLS-Dials (ersetzt den IP-altname-Check).
 *
 * Problem (ADR-027 / RUNBOOK-55-A Fall C): Node-Certs SANen ihre SPIFFE-URI
 * (`node/<PeerID>`) PLUS ihre LAN-IP, aber NICHT die Tailscale-100.x-IP. Node's
 * Default-TLS prüft den Hostnamen/die IP gegen die altnames → ein Overlay-Dial
 * (100.x) scheitert mit `ERR_TLS_CERT_ALTNAME_INVALID`, obwohl die SPIFFE-Identität
 * korrekt + CA-signiert ist. (curl kam nur mit `-k` durch = SAN-Check aus.)
 *
 * Fix: `checkServerIdentity` durch eine SPIFFE-URI-SAN-Prüfung ersetzen. Damit ist
 * die Identität an die kryptografische Workload-Identität gebunden statt an eine
 * variable Netz-Adresse → Overlay/Cross-Subnet funktioniert OHNE per-IP-Cert-Reissue.
 *
 * SICHERHEIT (CO 2026-06-16, beide Modelle — fail-closed):
 *  - Läuft NUR zusätzlich zur CA-Chain-Validierung. `rejectUnauthorized:true` bleibt;
 *    diese Funktion wird von Node ERST NACH erfolgreicher Chain-Prüfung aufgerufen
 *    und lockert die Chain NIE. Sie ersetzt ausschließlich den altname-Abgleich.
 *  - Exakte Trust-Domain + strikte Grammatik via `normalizeAgentId`/`parseSpiffeUri`
 *    (fremde Trust-Domain / malformed SAN werden verworfen).
 *  - ALLE URI-SANs werden geprüft (nicht nur die erste — Übergangs-Certs tragen ggf.
 *    Legacy + kanonisch).
 *  - `expectedSpiffeId` (aus der Peer-Registry/Pin gebunden, NICHT aus dem Cert):
 *    wenn gesetzt, MUSS eine SAN exakt dazu normalisieren — sonst Ablehnung. Ohne
 *    Pin (TOFU) wird eine gültige thinklocal-SPIFFE-SAN verlangt; der per-Host-Pin
 *    ist der unmittelbare Folgeschritt (D2b-pin), s. ADR-028-D2-Doc.
 *  - Fehlt eine gültige SAN / Mismatch → Error (fail-closed → Handshake-Abbruch).
 */
import { spiffeUrisFromSubjectAltName } from './peer-identity.js';
import { normalizeAgentId } from './spiffe-uri.js';

export interface PeerCertLike {
  /** Node `TLSSocket.getPeerCertificate().subjectaltname`, z.B. "URI:spiffe://…, IP Address:10.0.0.1". */
  readonly subjectaltname?: string;
}

export interface MeshServerIdentityPolicy {
  /**
   * Erwartete (kanonische oder Legacy-) SPIFFE-Identität dieses Dial-Ziels, sofern
   * bekannt (gepinnt aus der Peer-Registry — NICHT aus dem Cert). Gesetzt → eine SAN
   * MUSS exakt dazu normalisieren. Ungesetzt → TOFU: nur gültige thinklocal-SAN nötig.
   */
  readonly expectedSpiffeId?: string;
}

/**
 * Verifiziert die Server-Identität anhand der SPIFFE-URI-SANs. Vertrag wie Node
 * `checkServerIdentity`: `undefined` = akzeptiert, `Error` = Handshake abbrechen.
 * Reine Funktion (kein I/O) → vollständig unit-testbar.
 */
export function verifyMeshServerIdentity(
  host: string,
  cert: PeerCertLike | undefined,
  policy: MeshServerIdentityPolicy = {},
): Error | undefined {
  const sans = spiffeUrisFromSubjectAltName(cert?.subjectaltname);
  if (sans.length === 0) {
    return new Error(`mesh-server-identity: kein SPIFFE-URI-SAN im Peer-Cert für ${host}`);
  }
  // Nur SANs behalten, die als thinklocal-SPIFFE-URI parsen (exakte Trust-Domain +
  // strikte Grammatik); auf die kanonische Vergleichsform normalisieren.
  const normalized: string[] = [];
  for (const san of sans) {
    try {
      normalized.push(normalizeAgentId(san));
    } catch {
      // fremde Trust-Domain / malformed → ignorieren (fail-closed: zählt nicht als gültig)
    }
  }
  if (normalized.length === 0) {
    return new Error(
      `mesh-server-identity: keine gültige thinklocal-SPIFFE-SAN für ${host} (SANs: ${JSON.stringify(sans)})`,
    );
  }
  if (policy.expectedSpiffeId !== undefined) {
    let expected: string;
    try {
      expected = normalizeAgentId(policy.expectedSpiffeId);
    } catch {
      return new Error(
        `mesh-server-identity: expectedSpiffeId ist keine gültige thinklocal-SPIFFE-Identität: ${policy.expectedSpiffeId}`,
      );
    }
    if (!normalized.includes(expected)) {
      return new Error(
        `mesh-server-identity: Cert-SANs ${JSON.stringify(normalized)} matchen die erwartete Identität ${expected} für ${host} nicht`,
      );
    }
  }
  return undefined;
}

/**
 * Baut eine `checkServerIdentity`-Funktion (Node-TLS-Vertrag). `resolveExpected`
 * liefert — falls bekannt — die gepinnte erwartete SPIFFE-Identität für den Ziel-Host
 * (aus der Peer-Registry, NICHT aus dem Cert). Default: undefined → TOFU.
 */
export function makeMeshCheckServerIdentity(
  resolveExpected?: (host: string) => string | undefined,
): (host: string, cert: PeerCertLike) => Error | undefined {
  return (host: string, cert: PeerCertLike): Error | undefined => {
    // CR-LOW (gpt-5.3-codex): ein werfender Resolver darf den TLS-Pfad nicht
    // undefiniert lassen → fail-closed, niemals stillschweigend ohne Pin durchlassen.
    let expectedSpiffeId: string | undefined;
    try {
      expectedSpiffeId = resolveExpected?.(host);
    } catch (err) {
      return new Error(
        `mesh-server-identity: expected-id-Resolver für ${host} warf (${err instanceof Error ? err.message : String(err)}) → fail-closed`,
      );
    }
    return verifyMeshServerIdentity(host, cert, { expectedSpiffeId });
  };
}
