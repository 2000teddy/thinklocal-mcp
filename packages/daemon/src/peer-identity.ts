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

/** Eingabe der Phase-3-Sender-Flip-Entscheidung (ADR-022 Schritt 3). */
export interface SelfIdentityInput {
  /** Operator-Flag (config/env): kanonisch emittieren wollen. */
  emitCanonicalFlag: boolean;
  /** Legacy-Self-URI (`host/<stableNodeId>/agent/<type>`), immer vorhanden. */
  legacyUri: string;
  /** Stabile libp2p-PeerID; null wenn libp2p deaktiviert (local-Modus). */
  peerId: string | null;
  /**
   * ALLE SPIFFE-URI-SANs des laufenden mTLS-Node-Certs (Dual-SAN-Migrations-Certs
   * tragen Legacy + kanonisch). Der Flip greift nur, wenn die EIGENE kanonische URI
   * hier enthalten ist — nicht „irgendeine kanonische SAN" (sonst node/<andere-PeerID>
   * → emittierter Sender ≠ präsentiertes Cert → 403).
   */
  certSans: string[];
}

/** Ergebnis der Phase-3-Sender-Flip-Entscheidung. */
export interface SelfIdentityDecision {
  /** Die TATSÄCHLICH zu emittierende Self-Identität (Sender/agent_id/author/…). */
  selfIdentityUri: string;
  /** True, wenn auf kanonisch geflippt wurde. */
  emitCanonical: boolean;
  /** Die ableitbare kanonische URI (null wenn keine PeerID). */
  canonicalSelfUri: string | null;
  /** True, wenn die EIGENE kanonische URI unter den laufenden Cert-SANs ist. */
  certSanIsCanonical: boolean;
  /** Grund, WARUM das gesetzte Flag NICHT griff (sonst undefined). */
  blockedReason?: 'libp2p_disabled_no_peerid' | 'cert_san_not_canonical';
}

/**
 * ADR-022 Schritt 3 — Per-Node-Sender-Flip-Entscheidung (rein, seiteneffektfrei).
 *
 * Flippt die Self-Identität von Legacy `host/<id>` auf kanonisch `node/<PeerID>`
 * GENAU DANN, wenn (1) der Operator es aktiviert hat, (2) eine PeerID existiert UND
 * (3) der laufende mTLS-Cert-SAN BEREITS kanonisch ist. (3) ist der Sicherheits-
 * Interlock „Cert-SAN VOR Sender-URI": ein kanonischer Sender bei noch Legacy-Cert
 * würde empfangsseitig (authorizeHttpsSender) gegen den Cert-SAN mismatchen → 403.
 * Fail-safe: ist das Flag gesetzt aber eine Bedingung unerfüllt, bleibt es bei Legacy
 * und `blockedReason` nennt den Grund (für eine laute Warnung beim Aufrufer).
 */
export function resolveSelfIdentity(input: SelfIdentityInput): SelfIdentityDecision {
  const canonicalSelfUri = input.peerId ? peerIdToSpiffeUri(input.peerId) : null;
  // EXAKT: die eigene kanonische URI muss unter den Cert-SANs sein (nicht nur
  // „irgendeine kanonische SAN"). Schließt node/<andere-PeerID>-Certs aus.
  const certSanIsCanonical = canonicalSelfUri !== null && input.certSans.includes(canonicalSelfUri);
  const emitCanonical = input.emitCanonicalFlag && certSanIsCanonical;

  let blockedReason: SelfIdentityDecision['blockedReason'];
  if (input.emitCanonicalFlag && !emitCanonical) {
    blockedReason = !canonicalSelfUri ? 'libp2p_disabled_no_peerid' : 'cert_san_not_canonical';
  }

  return {
    selfIdentityUri: emitCanonical ? canonicalSelfUri! : input.legacyUri,
    emitCanonical,
    canonicalSelfUri,
    certSanIsCanonical,
    blockedReason,
  };
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

/**
 * Extrahiert die SPIFFE-URI aus dem `subjectaltname`-String eines mTLS-Peer-Certs
 * (Node `TLSSocket.getPeerCertificate().subjectaltname`), Format z.B.:
 * `"URI:spiffe://thinklocal/node/<PeerID>, DNS:foo, IP Address:10.0.0.1"`.
 * Liefert die erste `URI:spiffe://`-Eintragung oder null.
 */
export function spiffeFromSubjectAltName(subjectAltName: string | undefined | null): string | null {
  if (!subjectAltName) return null;
  for (const part of subjectAltName.split(',')) {
    const t = part.trim();
    if (t.startsWith('URI:spiffe://')) return t.slice('URI:'.length);
  }
  return null;
}

export interface HttpsSenderAuthz {
  ok: boolean;
  /** PeerID, deren Bindung der präsentierte Cert-SAN kryptografisch (CA-verbürgt) belegt — nur bei kanonischem Sender + Match. */
  verifiedPeerId?: string;
  /** true bei Legacy-`host/<id>`-Sender: Cert-Gate übersprungen, bestehende exakte Auflösung greift (Migrations-Kompat). */
  legacy?: boolean;
  /** Ablehnungsgrund, wenn ok=false. */
  reason?: string;
}

/**
 * ADR-022 Schritt 3 — channel-gebundene HTTPS-Authz (CR gpt-5.5: HTTPS-Nachrichten
 * AUSSCHLIESSLICH über den präsentierten mTLS-Cert-SAN autorisieren, nie über ein
 * globales Flag, nie aus mDNS/Card).
 *
 * - KANONISCHER `node/<PeerID>`-Sender: der (per rejectUnauthorized CA-validierte)
 *   Client-Cert-SAN MUSS exakt `envelope.sender` sein → PeerID ist dann kryptografisch
 *   an diese Verbindung gebunden (`verifiedPeerId`). Fehlt/Mismatch → Ablehnung.
 * - LEGACY `host/<id>`-Sender: kein Cert-Gate (`legacy:true`); die bestehenden exakten
 *   Auflösungspfade greifen (Migrations-Kompatibilität, additiv).
 *
 * Reine Funktion (kein I/O) → vollständig unit-testbar.
 */
/** True nur für das exakte Legacy-Schema `spiffe://thinklocal/host/<id>` (kein Suffix). */
export function isLegacyHostUri(uri: string): boolean {
  return /^spiffe:\/\/thinklocal\/host\/[A-Za-z0-9._-]+\/agent\/[A-Za-z0-9._-]+$/.test(uri);
}

/**
 * Accept-both-Brücke (ADR-022 Phase 0): liefert die PeerID, die ein präsentierter
 * mTLS-Cert-SAN kryptografisch belegt — UNABHÄNGIG davon, ob `envelope.sender` noch
 * die Legacy-`host/<id>`-Form trägt.
 *
 * WARUM separat von `authorizeHttpsSender`: In Phase 1 wird das Cert eines Nodes auf
 * SAN `node/<PeerID>` neu ausgestellt (von der CA/.94, nach PoP-Verifikation), der
 * `envelope.sender` bleibt aber noch Legacy (Flip erst in Phase 3). Über diesen Pfad
 * erkennt der Empfänger die PeerID-Bindung SOFORT aus dem CA-signierten Cert-SAN —
 * statt erst beim späteren Sender-Flip. Das ist genau der „accept-both"-Rollout:
 * ein node/<PeerID>-Cert wird überall akzeptiert+verwertet, bevor irgendwer flippt.
 *
 * Sicherheit: Der Aufrufer MUSS garantieren, dass `certSan` von einem TLS-VALIDIERTEN
 * Socket stammt (`authorized===true`) — dann ist der SAN CA-signiert und die CA hat
 * (Pfad B) den PoP geprüft, d.h. der Verbindungspartner kontrolliert den Ed25519-Key
 * dieser PeerID. Ein Angreifer kann kein CA-signiertes `node/<victimPeerId>`-Cert
 * erlangen (PoP braucht den fremden privaten Key). null, wenn kein kanonischer SAN.
 */
export function peerIdFromCertSan(certSan: string | null): string | null {
  return certSan ? spiffeUriToPeerId(certSan) : null;
}

/**
 * Extrahiert ALLE `URI:spiffe://`-Einträge aus einem `subjectaltname`-String.
 * Migrationskritisch (CR gpt-5.5 WS-2 LOW): ein Übergangs-Cert kann gleichzeitig
 * eine Legacy-`host/<id>`- UND eine kanonische `node/<PeerID>`-SAN tragen. Der
 * Single-Wert-Parser `spiffeFromSubjectAltName` liefert nur den ERSTEN Eintrag und
 * würde — je nach Reihenfolge — die kanonische SAN übersehen. Hier alle, damit der
 * Aufrufer gezielt die `node/<PeerID>`-SAN herausziehen kann.
 */
export function spiffeUrisFromSubjectAltName(subjectAltName: string | undefined | null): string[] {
  if (!subjectAltName) return [];
  const out: string[] = [];
  for (const part of subjectAltName.split(',')) {
    const t = part.trim();
    if (t.startsWith('URI:spiffe://')) out.push(t.slice('URI:'.length));
  }
  return out;
}

/** Normalisiert einen X.509-Fingerprint (Doppelpunkte raus, Großschreibung) für Vergleiche. */
function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toUpperCase();
}

/**
 * True, wenn `issuerFingerprint` zu einer der `attestingFingerprints` gehört —
 * der CAs, die laut ADR-022 berechtigt sind, eine `node/<PeerID>`-PoP-Attestierung
 * auszustellen (die Admin-/Mesh-CA auf .94). Leere Liste / fehlender Fingerprint
 * → false (fail-closed, Pfad inert bis der Pin gesetzt ist).
 */
export function isAttestingIssuer(
  issuerFingerprint: string | null | undefined,
  attestingFingerprints: readonly string[],
): boolean {
  if (!issuerFingerprint || attestingFingerprints.length === 0) return false;
  const want = normalizeFingerprint(issuerFingerprint);
  return attestingFingerprints.some((fp) => normalizeFingerprint(fp) === want);
}

/**
 * Zentrale Attestierungs-Entscheidung für eingehende mTLS-Verbindungen (ADR-022
 * Phase 0, CR gpt-5.5 WS-2 HIGH). Liefert die PeerID NUR, wenn BEIDES gilt:
 *  1. das Cert trägt eine kanonische `node/<PeerID>`-SAN, UND
 *  2. der Aussteller ist eine GEPINNTE PeerID-attestierende CA (.94).
 *
 * WARUM der Issuer-Pin kritisch ist: Der mTLS-Trust-Bundle enthält bewusst MEHRERE
 * CAs (eigene Mesh-CA + gepairte Peer-CAs). Würde jede transport-vertraute CA als
 * attestierend gelten, könnte eine bösartige gepairte CA ein `node/<victimPeerId>`-
 * Cert ausstellen und damit eine fremde PeerID „verifizieren" (Cert-Substitution /
 * Confused-Deputy). Nur die CA, die den ADR-022-PoP (Signatur über X.509-Pubkey-Hash)
 * erzwingt, darf attestieren. null = keine Attestierung (fail-closed).
 */
export function attestedPeerIdFromCert(
  certSans: readonly string[],
  issuerFingerprint: string | null | undefined,
  attestingFingerprints: readonly string[],
): string | null {
  const canonical = certSans.find((u) => peerIdFromCertSan(u) !== null) ?? null;
  if (canonical === null) return null;
  if (!isAttestingIssuer(issuerFingerprint, attestingFingerprints)) return null;
  return peerIdFromCertSan(canonical);
}

export function authorizeHttpsSender(senderUri: string, certSpiffe: string | null): HttpsSenderAuthz {
  const wantPeerId = spiffeUriToPeerId(senderUri);
  if (wantPeerId === null) {
    // CR gpt-5.5 HIGH: NUR exaktes host/<id>-Legacy-Schema bekommt den Cert-Gate-Bypass.
    // Alles andere (malformed, fremde SPIFFE-Formen, node/<PeerID>/suffix) → fail-closed.
    if (isLegacyHostUri(senderUri)) {
      return { ok: true, legacy: true };
    }
    return { ok: false, reason: 'unsupported sender URI: only canonical node/<PeerID> or legacy host/<id>/agent/<type>' };
  }
  const certPeerId = certSpiffe ? spiffeUriToPeerId(certSpiffe) : null;
  if (certPeerId !== null && certPeerId === wantPeerId) {
    return { ok: true, verifiedPeerId: wantPeerId };
  }
  return {
    ok: false,
    reason: certPeerId === null
      ? 'kanonischer node/<PeerID>-Sender, aber kein passender mTLS-Cert-SAN präsentiert'
      : `Cert-SAN PeerID (${certPeerId}) != Sender PeerID (${wantPeerId})`,
  };
}
