/**
 * peer-identity.ts — ADR-022: PeerID-gewurzelte Knoten-Identität
 *
 * Kanonische Quelle der Knoten-Identität ist die libp2p-Ed25519-PeerID.
 * SPIFFE-ID und mTLS-X.509-SAN werden DARAUS abgeleitet — NICHT aus
 * Hostname/MAC/IP/HW-UUID. Siehe `docs/architecture/ADR-022-peerid-rooted-identity.md`.
 *
 * Dieses Modul enthält die reinen (seiteneffektfreien) Helfer für:
 *  - Ableitung der kanonischen SPIFFE-URI aus der PeerID
 *  - Parsen einer PeerID aus einer kanonischen SPIFFE-URI
 *  - die ADR-022 §Startup-Assertion (Divergenz PeerID / Cert-SAN / authz-Identität)
 *
 * BEWUSST KEINE Key-Lifecycle-Logik hier (Backup/Duplikat-Erkennung/Rotation) —
 * das ist in ADR-022 als Top-Risiko vermerkt und folgt separat. Diese Helfer
 * verbauen es nicht: sie nehmen die PeerID als gegeben und leiten nur ab.
 */

/** Trust-Domain (Christians Festlegung, ADR-022). Keine `.mesh`-Varianten. */
export const TRUST_DOMAIN = 'thinklocal';

/** Kanonische SPIFFE-URI aus der libp2p-PeerID: spiffe://thinklocal/node/<PeerID>. */
export function peerIdToSpiffeUri(peerId: string): string {
  return `spiffe://${TRUST_DOMAIN}/node/${peerId}`;
}

/**
 * Extrahiert die PeerID aus einer kanonischen Node-SPIFFE-URI.
 * Liefert null, wenn die URI nicht dem `node/<PeerID>`-Schema folgt
 * (z.B. eine Legacy-`host/<id>`-URI während der Migration).
 */
export function spiffeUriToPeerId(uri: string): string | null {
  // KANONISCH = exakt `spiffe://thinklocal/node/<PeerID>` (kein Suffix, KEIN trim).
  // M3 (CR gpt-5.5): KEIN uri.trim() in Identitätsvergleichen — sonst gälte
  // "…/node/<PeerID> " (mit Whitespace) als dieselbe ID. PeerID-Zeichensatz strikt
  // auf base58btc (12D3Koo…) / CIDv1-base32 (k51…/bafz…) = [A-Za-z0-9] beschränken
  // (kein '/', kein '?'/'#', kein Whitespace) → keine Alias-Identitäten beim
  // späteren cert-SAN-Cutover. Fail-closed.
  const m = /^spiffe:\/\/thinklocal\/node\/([A-Za-z0-9]+)$/.exec(uri);
  return m ? (m[1] ?? null) : null;
}

/** True, wenn die URI dem kanonischen PeerID-Schema (node/<PeerID>) folgt. */
export function isCanonicalNodeUri(uri: string): boolean {
  return spiffeUriToPeerId(uri) !== null;
}

/** Die drei Identitäts-Sichten, die zur Boot-Zeit übereinstimmen MÜSSEN. */
export interface IdentityTriple {
  /** Identität, mit der wir Envelopes signieren und gegen die authz prüft. */
  authzSpiffe: string;
  /** SPIFFE-URI aus dem SAN unseres Serving-Certs (null wenn nicht lesbar). */
  certSan: string | null;
  /** Aktuelle libp2p-PeerID (null wenn libp2p (noch) nicht verfügbar). */
  peerId: string | null;
}

export interface IdentityConsistency {
  consistent: boolean;
  /** Erwartete kanonische URI aus der PeerID (null wenn keine PeerID da). */
  expected: string | null;
  /** Menschenlesbare Divergenzen für das Boot-Log. */
  divergences: string[];
}

/**
 * ADR-022 §Startup-Assertion. Prüft, ob authz-Identität und Cert-SAN der aus
 * der PeerID abgeleiteten kanonischen URI entsprechen.
 *
 * Während der Migration (Legacy-`host/<stableNodeId>`-URIs, admin-signiertes
 * Cert mit Hostname-SAN) wird das bewusst `consistent:false` liefern — genau
 * das ist der diagnostische Zweck: die Divergenz sichtbar machen, nicht
 * verstecken. Ob der Daemon bei Divergenz hart abbricht oder nur laut warnt,
 * entscheidet der Aufrufer (siehe TLMCP_STRICT_IDENTITY).
 */
export function checkIdentityConsistency(t: IdentityTriple): IdentityConsistency {
  const divergences: string[] = [];

  if (!t.peerId) {
    // Ohne PeerID können wir die kanonische Identität nicht ableiten.
    divergences.push('peerId fehlt — libp2p-Identität nicht verfügbar');
    return { consistent: false, expected: null, divergences };
  }

  const expected = peerIdToSpiffeUri(t.peerId);

  if (t.authzSpiffe !== expected) {
    divergences.push(`authz-Identität '${t.authzSpiffe}' != erwartet '${expected}'`);
  }
  if (t.certSan !== null && t.certSan !== expected) {
    divergences.push(`Cert-SAN '${t.certSan}' != erwartet '${expected}'`);
  }
  if (t.certSan === null) {
    divergences.push('Cert-SAN nicht lesbar — Abgleich übersprungen');
  }

  return { consistent: divergences.length === 0, expected, divergences };
}
