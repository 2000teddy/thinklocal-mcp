// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * pairing-canonicalize.ts — KW28 TL-00: CA-verankerte, IDENTITÄTS-GEBUNDENE Kanonisierung eines
 * Legacy-`host/`-PairingStore-Eintrags auf die kanonische `node/<PeerID>`-Identität eines
 * re-enrollten Peers.
 *
 * HINTERGRUND (der 403-Gap): Der Outbound-AGENT_MESSAGE-ACL (`inbox-api.ts`) prüft
 * `pairingStore.isPaired(<normalizedTo>)` — URI-gekeyt. Ein Peer, der nach einem Re-Enroll seine
 * kanonische `node/<PeerID>`-Identität announced (z.B. .52/.55, token-onboarded), wird abgelehnt
 * (403 „peer not paired"), solange TH01s `paired-peers.json` ihn nur unter der ALTEN
 * `host/<id>`-URI führt.
 *
 * SICHERHEITSMODELL — ZWEI unabhängige Bindungen sind nötig (CR-CRITICAL):
 *  (1) **CA-Anker:** Das aktuell präsentierte Leaf-Cert MUSS unter der GESPEICHERTEN `caCertPem` des
 *      Eintrags verifizieren (`verifyPeerCert` = Signatur + Gültigkeit).
 *  (2) **Identitäts-Bindung:** Die kanonische `node/<PeerID>`-SAN des Certs MUSS **exakt** der vom
 *      Aufrufer asserted `expectedCanonicalUri` entsprechen.
 *
 * WARUM (1) ALLEIN NICHT REICHT: Die Mesh nutzt eine **geteilte zentrale CA** (Attesting-CA .94).
 * Damit verifiziert `verifyPeerCert(storedCa, leaf)` für JEDEN Mesh-Node — nicht nur den gemeinten.
 * Ohne (2) könnte der Eintrag von Peer A auf die (CA-gültige) Identität von Peer B re-gekeyt werden
 * (Identitäts-Substitution). `expectedCanonicalUri` ist die vom Betreiber via `discover_peers`
 * (daemon-verifizierte Peer-Identität) festgestellte Nachfolge-Identität dieses Eintrags; der Runner
 * bindet zusätzlich das Cert an die gewählte Adresse (SAN-Cross-Check). Erst beide Bindungen zusammen
 * schließen die Substitution aus.
 *
 * pubkey/fingerprint werden bewusst NICHT aus dem Cert befüllt: der Cert-Schlüssel ist der RSA-TLS-
 * Schlüssel, NICHT der ECDSA-Signing-Key, den `isPairedByPublicKey` (pairing.ts) inbound matcht —
 * eine Befüllung wäre irreführend/wirkungslos. Der URI-Re-Key allein schließt den 403-Gap (isPaired
 * URL-gekeyt); inbound greift nach dem Re-Key ebenfalls über `isPaired(node/…)`. Die vorhandenen
 * pubkey/fingerprint-Werte des Eintrags bleiben unverändert.
 *
 * Reine Funktion (kein I/O, kein Netz) → vollständig unit-testbar.
 */
import forge from 'node-forge';
import { verifyPeerCert, extractSpiffeUris } from './tls.js';
import { isCanonicalNodeUri } from './peer-identity.js';
import type { PairedPeer } from './pairing.js';

/** Ergebnis: entweder ein re-gekeyter Eintrag oder ein Skip mit Grund (fail-closed). */
export type CanonicalizeResult =
  | { ok: true; migrated: PairedPeer }
  | { ok: false; skip: string };

/**
 * Kanonisiert einen Legacy-`host/`-Eintrag auf `expectedCanonicalUri`, verankert am gespeicherten CA
 * UND an der asserted Identität. Reine Funktion, wirft nicht.
 *
 * Reihenfolge (fail-closed — jeder Fehlerfall → `skip`, der Aufrufer BEHÄLT den Legacy-Eintrag):
 *  1. `expectedCanonicalUri` ist keine kanonische node/-URI → `invalid-expected-uri`.
 *  2. Eintrag bereits kanonisch → `already-canonical`.
 *  3. Kein `caCertPem` (kein Trust-Anker) → `no-trust-anchor`.
 *  4. Leaf-Cert verifiziert NICHT unter dem gespeicherten CA → `cert-not-under-stored-ca` (Anker-Gate).
 *  5. Keine kanonische node/-SAN im Cert → `no-canonical-san`.
 *  6. Cert trägt eine ZWEITE (fremde) node/-SAN → `multiple-node-sans` (überbreit, Confused-Deputy-Schutz).
 *  7. node/-SAN ≠ `expectedCanonicalUri` → `canon-uri-mismatch` (Anti-Substitution-Bindung).
 * Sonst: `{ ok, migrated }` mit `agentId=<expectedCanonicalUri>`; `publicKeyPem`, `fingerprint`,
 * `caCertPem`, `hostname`, `pairedAt` bleiben unverändert.
 */
export function canonicalizePairedPeer(
  entry: PairedPeer,
  nodeCertPem: string,
  expectedCanonicalUri: string,
): CanonicalizeResult {
  try {
    if (!isCanonicalNodeUri(expectedCanonicalUri)) {
      return { ok: false, skip: 'invalid-expected-uri' };
    }
    if (isCanonicalNodeUri(entry.agentId)) {
      return { ok: false, skip: 'already-canonical' };
    }
    if (!entry.caCertPem || entry.caCertPem.trim() === '') {
      return { ok: false, skip: 'no-trust-anchor' };
    }
    // Anker-Gate: das präsentierte Cert MUSS unter der gespeicherten (vertrauten) CA verifizieren.
    if (!verifyPeerCert(entry.caCertPem, nodeCertPem)) {
      return { ok: false, skip: 'cert-not-under-stored-ca' };
    }
    const sans = extractSpiffeUris(nodeCertPem);
    const nodeSans = sans.filter((u) => u.startsWith('spiffe://thinklocal/node/'));
    const canon = nodeSans.find((u) => isCanonicalNodeUri(u));
    if (!canon) {
      return { ok: false, skip: 'no-canonical-san' };
    }
    if (nodeSans.some((u) => u !== canon)) {
      return { ok: false, skip: 'multiple-node-sans' };
    }
    // Anti-Substitution: das Cert MUSS genau die asserted Nachfolge-Identität tragen.
    if (canon !== expectedCanonicalUri) {
      return { ok: false, skip: 'canon-uri-mismatch' };
    }
    // Sanity: das Cert-PEM muss parsebar sein (defensive; extractSpiffeUris war schon erfolgreich).
    forge.pki.certificateFromPem(nodeCertPem);
    const migrated: PairedPeer = { ...entry, agentId: canon };
    return { ok: true, migrated };
  } catch {
    return { ok: false, skip: 'parse-error' };
  }
}
