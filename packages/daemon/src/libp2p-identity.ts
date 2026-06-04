/**
 * libp2p-identity.ts — ADR-022 Voraussetzung #0: persistierter libp2p-Ed25519-Key
 *
 * GRUNDLAGE der ganzen ADR-022: die kanonische Knoten-Identität ist die libp2p-PeerID,
 * und die ist nur dann stabil, wenn der Ed25519-Key ÜBER NEUSTARTS HINWEG persistiert
 * wird. Vorher erzeugte `createLibp2p()` bei jedem Start einen neuen Key → neue PeerID
 * (belegt durch zwei Smoke-Tests am 2026-06-03 mit verschiedenen PeerIDs). Dieses Modul
 * erzeugt den Key einmalig, schreibt ihn restriktiv auf Platte (0600) und lädt ihn
 * danach bei jedem Start. `createLibp2p({ privateKey })` wird damit verdrahtet.
 *
 * SPEICHERORT (Designentscheidung, ADR-022 — siehe Annahmen im Report):
 *   `<dataDir>/keys/libp2p-ed25519.key`, wobei `dataDir = config.daemon.data_dir`
 *   (TLMCP_DATA_DIR ?? os.homedir()/.thinklocal — plattformneutral, NICHT hardcoded).
 *   Bewusst NICHT ein separater XDG-Pfad: ALLE übrige Identitäts-Material (agent.key.pem,
 *   node-id.txt, Certs) liegt bereits unter `<dataDir>/keys/`. Den libp2p-Key dort
 *   anzusiedeln hält das Identitäts-Set zusammen; eine spätere XDG-Migration würde den
 *   gesamten dataDir verschieben, nicht nur diesen Key.
 *
 * FORMAT: libp2p-Standard-Protobuf-Serialisierung (`privateKeyToProtobuf`), binär.
 *   Enthält den Key-Typ → `privateKeyFromProtobuf` round-trippt und ist offen für
 *   künftige Key-Typen. Verbaut Rotation/Backup/Clone-Detection NICHT: Backup = Datei
 *   kopieren; Rotation = neue Datei schreiben; Clone-Detection = optionaler Sidecar-
 *   Fingerprint (alles ADR-022-Top-Risiko, hier bewusst NICHT implementiert).
 */

import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import {
  readFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync,
  openSync, writeSync, fsyncSync, closeSync, chmodSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Logger } from 'pino';

export const LIBP2P_KEY_FILENAME = 'libp2p-ed25519.key';

export interface LoadedLibp2pKey {
  /** Der persistierte/geladene Ed25519-PrivateKey (für createLibp2p({ privateKey })). */
  privateKey: PrivateKey;
  /** true, wenn der Key in DIESEM Aufruf neu erzeugt wurde (Erststart). */
  generated: boolean;
  /** Die stabile PeerID-String-Form (für Logging/Assertion). */
  peerId: string;
}

/**
 * Atomisches + crash-durables Binär-Write (CR HIGH): temp schreiben, fsync auf die
 * Datei, rename, dann fsync auf das Verzeichnis. Ohne die fsyncs kann ein Power-Loss
 * trotz „atomischem" Rename dazu führen, dass der Key nach Reboot fehlt → PeerID
 * würde dann doch driften (genau das, was #0 verhindern soll).
 */
function atomicWriteBinary(path: string, data: Buffer, mode: number, log?: Logger): void {
  const tmp = `${path}.${process.pid}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'w', mode);
    // LOW (CR): writeSync kann partiell schreiben → bis zur vollen Länge schleifen.
    let off = 0;
    while (off < data.length) {
      off += writeSync(fd, data, off, data.length - off);
    }
    fsyncSync(fd); // Datei-Inhalt durable
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
  // Verzeichnis-Eintrag (das Rename) durable machen. M2 (CR): Fehler NICHT still
  // verschlucken — warnen, weil die Crash-Durability sonst nur scheinbar garantiert ist
  // (manche FS/OS unterstützen dir-fsync nicht).
  try {
    const dfd = openSync(dirname(path), 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch (err) {
    log?.warn(
      { dir: dirname(path), err: err instanceof Error ? err.message : String(err) },
      '[libp2p-identity] Directory-fsync fehlgeschlagen — Crash-Durability des Key-Writes NICHT garantiert',
    );
  }
}

/** PeerID-String aus einem PrivateKey ableiten (deterministisch, stabil). */
export function libp2pPeerIdString(privateKey: PrivateKey): string {
  return peerIdFromPrivateKey(privateKey).toString();
}

/**
 * M1 (CR): keys/-Verzeichnis owner-only (0700) anlegen UND bei existierendem, zu offenem
 * Verzeichnis nachziehen/warnen — eine 0600-Keydatei schützt nicht, wenn das Verzeichnis
 * für Gruppe/Andere schreibbar ist (lokaler Angreifer könnte die Datei ersetzen).
 */
function ensureKeyDirSecure(keyDir: string, log?: Logger): void {
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  try {
    const dirMode = statSync(keyDir).mode & 0o777;
    if ((dirMode & 0o077) !== 0) {
      try {
        chmodSync(keyDir, 0o700);
        log?.warn({ keyDir, was: dirMode.toString(8) }, '[libp2p-identity] keys/-Verzeichnis war zu offen → auf 0700 gesetzt');
      } catch {
        log?.warn({ keyDir, mode: dirMode.toString(8) }, '[libp2p-identity] keys/-Verzeichnis zu offen (sollte 0700) — chmod fehlgeschlagen, bitte manuell `chmod 700`');
      }
    }
  } catch { /* stat-Fehler ignorieren */ }
}

/** Liest + validiert die vorhandene Key-Datei (Perms-Warnung, Korrupt-Check, Ed25519-Check). */
function loadExistingKey(keyPath: string, log?: Logger): LoadedLibp2pKey {
  try {
    const mode = statSync(keyPath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      log?.warn(
        { keyPath, mode: mode.toString(8) },
        '[libp2p-identity] Key-Datei mit zu offenen Rechten (sollte 0600 sein) — bitte `chmod 600`',
      );
    }
  } catch { /* stat-Fehler ignorieren, Laden trotzdem versuchen */ }

  const buf = readFileSync(keyPath);
  let privateKey: PrivateKey;
  try {
    privateKey = privateKeyFromProtobuf(new Uint8Array(buf));
  } catch (cause) {
    // Fail-loud: stilles Neugenerieren würde die Identität wechseln (wie ein Clone).
    throw new Error(
      `[libp2p-identity] Ungültige/korrupte libp2p-Key-Datei: ${keyPath}. ` +
        `Restore aus Backup oder explizite Rotation nötig — KEIN stilles Neugenerieren.`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  if (privateKey.type !== 'Ed25519') {
    throw new Error(
      `[libp2p-identity] Unerwarteter Key-Typ '${privateKey.type}' in ${keyPath}; erwartet 'Ed25519'.`,
    );
  }
  const peerId = libp2pPeerIdString(privateKey);
  log?.info({ keyPath, peerId }, '[libp2p-identity] Persistierten libp2p-Key geladen (stabile PeerID)');
  return { privateKey, generated: false, peerId };
}

/**
 * HIGH 2 (CR): exklusiver First-Create-Lock. Verhindert, dass zwei parallel startende
 * Prozesse (gleicher dataDir, Key fehlt) beide einen ANDEREN Key erzeugen und per
 * last-writer-wins-rename die Identität überschreiben (→ PeerID-Drift trotz #0).
 * Liefert den Lock-fd, oder 'key-appeared' wenn währenddessen ein anderer Prozess den
 * Key geschrieben hat (dann laden statt generieren).
 */
async function acquireKeyCreateLock(
  lockPath: string,
  keyPath: string,
): Promise<number | 'key-appeared'> {
  const maxWaitMs = 30_000; // CR LOW: 30s statt 5s — langsame FS/Entropie/Key-Erzeugung
  const stepMs = 100;
  let waited = 0;
  for (;;) {
    try {
      return openSync(lockPath, 'wx', 0o600); // atomar exklusiv anlegen (EEXIST wenn belegt)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (existsSync(keyPath)) return 'key-appeared'; // anderer Prozess hat den Key geschrieben
      if (waited >= maxWaitMs) {
        throw new Error(
          `[libp2p-identity] Key-Lock ${lockPath} seit >${maxWaitMs}ms belegt und kein Key erschienen — ` +
            `anderer Prozess hängt oder stale lock. Bitte manuell prüfen/entfernen.`,
        );
      }
      await new Promise((r) => setTimeout(r, stepMs));
      waited += stepMs;
    }
  }
}

/**
 * Lädt den persistierten libp2p-Ed25519-Key oder erzeugt ihn beim Erststart (unter
 * exklusivem Lock). Idempotent: jeder weitere Aufruf — auch parallel — liefert denselben
 * Key (⇒ dieselbe PeerID).
 *
 * @param dataDir  `config.daemon.data_dir` (plattformneutral aufgelöst).
 */
export async function loadOrCreateLibp2pPrivateKey(
  dataDir: string,
  log?: Logger,
): Promise<LoadedLibp2pKey> {
  const keyDir = resolve(dataDir, 'keys');
  const keyPath = resolve(keyDir, LIBP2P_KEY_FILENAME);
  ensureKeyDirSecure(keyDir, log);

  if (existsSync(keyPath)) return loadExistingKey(keyPath, log);

  // First-Create: exklusiver Lock + Re-Check UNTER dem Lock (HIGH 2).
  const lockPath = `${keyPath}.lock`;
  const lock = await acquireKeyCreateLock(lockPath, keyPath);
  if (lock === 'key-appeared') {
    return loadExistingKey(keyPath, log); // anderer Prozess war schneller
  }
  try {
    if (existsSync(keyPath)) return loadExistingKey(keyPath, log); // Re-Check unter Lock
    const privateKey = await generateKeyPair('Ed25519');
    atomicWriteBinary(keyPath, Buffer.from(privateKeyToProtobuf(privateKey)), 0o600, log);
    const peerId = libp2pPeerIdString(privateKey);
    log?.info(
      { keyPath, peerId },
      '[libp2p-identity] Neuer libp2p-Ed25519-Key generiert + persistiert (0600) — PeerID ab jetzt stabil',
    );
    return { privateKey, generated: true, peerId };
  } finally {
    try { closeSync(lock); } catch { /* best effort */ }
    try { unlinkSync(lockPath); } catch { /* best effort */ }
  }
}
