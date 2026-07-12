// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * peer-cache.ts — ADR-035 A1 / TL-26: Peer-Auflösungs-Cache (Locator-only).
 *
 * ZWECK: Nach einem Daemon-Restart die *Wiederfindbarkeit* zuvor gelernter Peers
 * überleben lassen, damit Neustart-Wellen nicht in stundenlangem „Unknown sender" enden.
 *
 * CO-Entscheidung (pal:consensus 2026-07-12, einstimmig Option A, s.
 * docs/architecture/ADR-035-A1-peer-cache-CO-brief.md):
 *  - **Locator-only.** Persistiert wird NUR `{peerId, spiffeUri, endpoint, certFingerprint,
 *    lastSeen}` — NIEMALS der `publicKey`. Damit kann die Platte KEINE AUTHN-Key-Attribution
 *    liefern (die A4b-Fehlerklasse ist strukturell ausgeschlossen, nicht per Gate). Die
 *    AUTHN-Bindung wird nach dem Boot frisch über live mTLS neu aufgebaut (A2/TL-27).
 *  - **`certFingerprint` ist ein HINT** (log-on-change), NIE ein Accept-Gate beim Re-Learn —
 *    sonst würde eine CA-Reissue-Rotation fail-closed einen Selbst-Outage erzeugen. (A2-Invariante.)
 *  - **TTL 14 Tage**, **Cap 512 (LRU nach `lastSeen`)**.
 *
 * Dieses Modul ist REIN: keine fs-/Timer-/Date.now-Nutzung. `nowMs` wird injiziert, damit
 * Serialisierung/Parsing/TTL deterministisch unit-testbar sind. Die eigentliche Datei-I/O
 * (atomarer chmod-600-Write, Boot-Load) sitzt im Aufrufer (index.ts).
 */
import { spiffeUriToPeerId } from './peer-identity.js';

/** ADR-035 A1: getrennte, restart-überlebende Persistenz-TTL (≫ In-Memory-Hot-TTL 15 min). */
export const PEER_CACHE_TTL_MS = 14 * 24 * 60 * 60_000; // 14 Tage (≥ 2× Wochen-Neustart-Rhythmus)
/** Harter Cap; bei Überschreitung werden die ältesten (kleinstes `lastSeen`) verworfen (LRU). */
export const PEER_CACHE_MAX = 512;
/** Schema-Version im Datei-Envelope — erlaubt späteres fail-closed-Verwerfen bei Format-Bruch. */
export const PEER_CACHE_SCHEMA = 1;

/**
 * Ein persistierter Locator — bewusst OHNE `publicKey`. Rein „wo/als-wen finde ich diesen Peer
 * wieder", nie „mit welchem Key spricht er" (das entsteht erst durch frisches live-Re-Learn).
 */
export interface PeerCacheLocator {
  /** Kanonische libp2p-PeerID (aus `spiffeUri` = peerIdToSpiffeUri(peerId)). */
  peerId: string;
  /** Kanonische node/<PeerID>-SPIFFE-URI. */
  spiffeUri: string;
  /** Zuletzt bekannter Endpoint (https://host:port). Beim Re-Learn nur ein Kandidat (HINT). */
  endpoint: string;
  /** sha256 des zuletzt gesehenen Client-Leaf-Certs. HINT/log-on-change — NIE Accept-Gate. */
  certFingerprint: string;
  /** Zeitpunkt des letzten erfolgreichen Kontakts (ms). Steuert TTL + LRU. */
  lastSeen: number;
}

interface CacheDocument {
  schema: number;
  entries: PeerCacheLocator[];
}

/** Endpoint grob validieren: https, Host, Port im gültigen Bereich (1–65535). CR-LOW: `\d{1,5}`
 *  allein ließe `:99999` durch — der Port ist für A2 ein Dial-Kandidat, also hier schon strikt. */
function isPlausibleEndpoint(ep: unknown): ep is string {
  if (typeof ep !== 'string') return false;
  const m = /^https:\/\/[^\s/]+:(\d{1,5})$/.exec(ep);
  if (!m) return false;
  const port = Number(m[1]);
  return port >= 1 && port <= 65535;
}

/** sha256-Hex (64 Zeichen) — der Fingerprint ist ein Hint, aber grobes Schema-Gating schadet nie. */
function isPlausibleFingerprint(fp: unknown): fp is string {
  return typeof fp === 'string' && /^[a-f0-9]{64}$/i.test(fp);
}

/**
 * Ein Roh-Objekt fail-closed in einen validen Locator überführen (oder null verwerfen).
 * Strikt: kanonische node/<PeerID>-URI, peerId == daraus abgeleitete PeerID, plausible
 * endpoint/fingerprint, endliches lastSeen. KEIN `publicKey` (wird ignoriert, falls vorhanden).
 */
function coerceLocator(raw: unknown): PeerCacheLocator | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const { peerId, spiffeUri, endpoint, certFingerprint, lastSeen } = o;
  if (typeof spiffeUri !== 'string') return null;
  const derivedPeerId = spiffeUriToPeerId(spiffeUri);
  if (!derivedPeerId) return null; // nur kanonische node/<PeerID>-URIs
  if (typeof peerId !== 'string' || peerId !== derivedPeerId) return null;
  if (!isPlausibleEndpoint(endpoint)) return null;
  if (!isPlausibleFingerprint(certFingerprint)) return null;
  if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen) || lastSeen <= 0) return null;
  return { peerId, spiffeUri, endpoint, certFingerprint, lastSeen };
}

/**
 * Serialisiert Locator in den Datei-Envelope. Erzwingt Locator-only: schreibt EXPLIZIT nur die
 * fünf Felder — selbst wenn ein Aufrufer versehentlich ein Objekt mit `publicKey` übergibt, landet
 * der Key NICHT auf der Platte (strukturelle Garantie der CO-Entscheidung).
 */
export function serializeCache(locators: readonly PeerCacheLocator[]): string {
  const doc: CacheDocument = {
    schema: PEER_CACHE_SCHEMA,
    entries: locators.map((l) => ({
      peerId: l.peerId,
      spiffeUri: l.spiffeUri,
      endpoint: l.endpoint,
      certFingerprint: l.certFingerprint,
      lastSeen: l.lastSeen,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * Parst + filtert den Cache fail-closed: falsches/kaputtes JSON oder falsche Schema-Version → `[]`.
 * Verwirft abgelaufene (nowMs - lastSeen > ttlMs) und ungültige Einträge; dedupt nach peerId
 * (neuestes `lastSeen` gewinnt); erzwingt den LRU-Cap (behalte die `cap` neuesten).
 */
export function parseCache(
  raw: string,
  nowMs: number,
  ttlMs: number = PEER_CACHE_TTL_MS,
  cap: number = PEER_CACHE_MAX,
): PeerCacheLocator[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof doc !== 'object' || doc === null) return [];
  const d = doc as Record<string, unknown>;
  if (d['schema'] !== PEER_CACHE_SCHEMA || !Array.isArray(d['entries'])) return [];

  const byPeerId = new Map<string, PeerCacheLocator>();
  for (const rawEntry of d['entries']) {
    const loc = coerceLocator(rawEntry);
    if (!loc) continue;
    if (nowMs - loc.lastSeen > ttlMs) continue; // abgelaufen
    if (loc.lastSeen > nowMs + 60_000) continue; // Zukunfts-Timestamp (Clock-Skew/Tamper) → raus
    const existing = byPeerId.get(loc.peerId);
    if (!existing || loc.lastSeen > existing.lastSeen) byPeerId.set(loc.peerId, loc);
  }

  const sorted = [...byPeerId.values()].sort((a, b) => b.lastSeen - a.lastSeen); // neueste zuerst
  return sorted.slice(0, Math.max(0, cap));
}

/**
 * ADR-035 A1 (CR MEDIUM / CO §6.3): Union der **live** Locator (frisch aus `authenticatedSeen`) mit
 * den beim Boot **geladenen** Locator, damit ein Flush die durable Menge nicht auf „seit diesem Boot
 * live gesehen" schrumpft. Bei peerId-Kollision gewinnt der Live-Eintrag (frischeres `lastSeen`);
 * rein additiv sonst. TTL/LRU-Pruning macht `parseCache` beim nächsten Boot. Rein/deterministisch.
 */
export function mergeLocators(
  live: readonly PeerCacheLocator[],
  loaded: readonly PeerCacheLocator[],
): PeerCacheLocator[] {
  const byPeerId = new Map<string, PeerCacheLocator>();
  for (const l of loaded) byPeerId.set(l.peerId, l);
  for (const l of live) byPeerId.set(l.peerId, l); // Live überschreibt geladen
  return [...byPeerId.values()];
}
