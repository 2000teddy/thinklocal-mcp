// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * probe-classify.ts — Klassifiziert fehlgeschlagene `fetch()`-Proben (z.B. `tl check` /
 * Remote-Diagnose), um einen **TLS/mTLS-Reset** (der Port antwortet → der Daemon LÄUFT, aber die
 * Probe passte nicht: `http://` gegen TLS-Port, oder `https://` ohne Client-Cert) von einem
 * **echten „down"** (kein Listener / DNS / unerreichbar) zu unterscheiden.
 *
 * Hintergrund: `/health` und `/api/status` hängen am mTLS-`cardServer`
 * (`requestCert + rejectUnauthorized`, keine Public-Path-Allowlist). Eine Probe ohne gültiges
 * Mesh-Client-Cert wird auf TLS-Ebene resettet → `fetch` wirft, OHNE dass der Daemon „down" ist.
 * Ein pauschales „nicht erreichbar" erzeugt dann **Phantom-ROT**.
 * Siehe `docs/DIAGNOSE-api-status-phantom-rot.md`.
 */

export type ProbeErrorKind = 'down' | 'tls' | 'timeout' | 'unknown';

export interface ProbeErrorVerdict {
  kind: ProbeErrorKind;
  /** true nur, wenn der Port nachweislich geantwortet hat (TLS-Reset) → NICHT als „down"/ROT melden. */
  likelyUp: boolean;
  /** Node/undici-Fehlercode, falls vorhanden (`ECONNREFUSED`, `ECONNRESET`, `HPE_*`, …). */
  code: string | null;
  /** Kurzer, operator-tauglicher Hinweis. */
  hint: string;
}

/** Kein Listener / DNS / Routing — der Port antwortet NICHT. Echtes „down". */
const DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
/** Mehrdeutig: langsam / gefiltert / down. */
const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT']);
/** Port antwortet, aber Handshake/Transport bricht ab → Daemon läuft hinter mTLS/https. */
const TLS_RESET_CODES = new Set(['ECONNRESET', 'EPROTO', 'UND_ERR_SOCKET', 'ERR_SSL_WRONG_VERSION_NUMBER']);
/** Cert-/TLS-Vertrauensbrüche (Port spricht TLS, aber Trust/SAN passt nicht) — code ODER message. */
const TLS_TRUST_HINT = /cert|_ssl_|altname|verify|self.signed|wrong version/i;
/** Socket-/HTTP-Parse-Signaturen: es kamen Nicht-HTTP-Bytes zurück (TLS-Alert) → Port sprach TLS. */
const TLS_SOCKET_HINT = /socket hang up|other side closed/i;

function pickErr(err: unknown): { name: string; code: string | null; message: string } {
  const e = err as
    | { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string; name?: string } }
    | null
    | undefined;
  return {
    name: e?.name ?? e?.cause?.name ?? '',
    code: e?.cause?.code ?? e?.code ?? null,
    message: (e?.cause?.message ?? e?.message ?? '').toString(),
  };
}

/**
 * Ordnet einen `fetch`-Fehler einer der vier Klassen zu. Konservativ: `likelyUp` nur bei
 * nachweislichem Port-Antworten (TLS), niemals bei Timeout/unklar — so wird weder ein echtes
 * „down" beschönigt noch ein TLS-Reset fälschlich als ROT gemeldet.
 */
export function classifyProbeError(err: unknown): ProbeErrorVerdict {
  const { name, code, message } = pickErr(err);

  // 1. Timeout (mehrdeutig)
  if (name === 'TimeoutError' || name === 'AbortError' || (code !== null && TIMEOUT_CODES.has(code))) {
    return { kind: 'timeout', likelyUp: false, code, hint: 'Timeout — Host/Port langsam, gefiltert oder down.' };
  }

  // 2. Echtes down / kein Listener / DNS / Routing (Port antwortet nicht)
  if (code !== null && DOWN_CODES.has(code)) {
    const hint =
      code === 'ECONNREFUSED'
        ? 'Kein Listener auf dem Port — Daemon aus oder falscher Port.'
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? 'Hostname nicht auflösbar (DNS).'
          : 'Host/Netz nicht erreichbar (Routing/Firewall).';
    return { kind: 'down', likelyUp: false, code, hint };
  }

  // 3. Port antwortet, aber TLS/mTLS/Trust bricht ab → Daemon läuft; Probe war http:// oder ohne Client-Cert
  const isTls =
    (code !== null && TLS_RESET_CODES.has(code)) ||
    (code !== null && code.startsWith('HPE_')) ||
    (code !== null && TLS_TRUST_HINT.test(code)) ||
    TLS_TRUST_HINT.test(message) ||
    TLS_SOCKET_HINT.test(message);
  if (isTls) {
    return {
      kind: 'tls',
      likelyUp: true,
      code,
      hint: 'Port antwortet, aber TLS/mTLS: mit https:// + Mesh-Client-Cert prüfen — kein „down".',
    };
  }

  // 4. Unklar (konservativ: nicht als „up" werten)
  return { kind: 'unknown', likelyUp: false, code, hint: `Unklarer Verbindungsfehler${code ? ` (${code})` : ''}.` };
}
