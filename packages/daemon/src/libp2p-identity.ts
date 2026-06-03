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
  openSync, writeSync, fsyncSync, closeSync,
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
function atomicWriteBinary(path: string, data: Buffer, mode: number): void {
  const tmp = `${path}.${process.pid}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'w', mode);
    writeSync(fd, data);
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
  // Verzeichnis-Eintrag (das Rename) durable machen — best effort (manche FS/OS
  // unterstützen dir-fsync nicht, dann ignorieren).
  try {
    const dfd = openSync(dirname(path), 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch { /* best effort */ }
}

/** PeerID-String aus einem PrivateKey ableiten (deterministisch, stabil). */
export function libp2pPeerIdString(privateKey: PrivateKey): string {
  return peerIdFromPrivateKey(privateKey).toString();
}

/**
 * Lädt den persistierten libp2p-Ed25519-Key oder erzeugt ihn beim Erststart.
 * Idempotent: jeder weitere Aufruf liefert denselben Key (⇒ dieselbe PeerID).
 *
 * @param dataDir  `config.daemon.data_dir` (plattformneutral aufgelöst).
 */
export async function loadOrCreateLibp2pPrivateKey(
  dataDir: string,
  log?: Logger,
): Promise<LoadedLibp2pKey> {
  const keyDir = resolve(dataDir, 'keys');
  const keyPath = resolve(keyDir, LIBP2P_KEY_FILENAME);

  if (existsSync(keyPath)) {
    // Dateirechte prüfen: bei zu offenen Rechten (group/other haben Bits) laut warnen.
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
      // Fail-loud (CR MEDIUM): stilles Neugenerieren würde die Identität wechseln
      // (wie ein Clone) — schlimmer als ein lauter Abbruch.
      throw new Error(
        `[libp2p-identity] Ungültige/korrupte libp2p-Key-Datei: ${keyPath}. ` +
          `Restore aus Backup oder explizite Rotation nötig — KEIN stilles Neugenerieren.`,
        { cause: cause instanceof Error ? cause : undefined },
      );
    }
    if (privateKey.type !== 'Ed25519') {
      // ADR-022-Invariante: Ed25519 ist die Identitätsbasis (CR MEDIUM).
      throw new Error(
        `[libp2p-identity] Unerwarteter Key-Typ '${privateKey.type}' in ${keyPath}; erwartet 'Ed25519'.`,
      );
    }
    const peerId = libp2pPeerIdString(privateKey);
    log?.info({ keyPath, peerId }, '[libp2p-identity] Persistierten libp2p-Key geladen (stabile PeerID)');
    return { privateKey, generated: false, peerId };
  }

  mkdirSync(keyDir, { recursive: true, mode: 0o700 }); // CR MEDIUM: owner-only keys/
  const privateKey = await generateKeyPair('Ed25519');
  const bytes = privateKeyToProtobuf(privateKey);
  atomicWriteBinary(keyPath, Buffer.from(bytes), 0o600);
  const peerId = libp2pPeerIdString(privateKey);
  log?.info(
    { keyPath, peerId },
    '[libp2p-identity] Neuer libp2p-Ed25519-Key generiert + persistiert (0600) — PeerID ab jetzt stabil',
  );
  return { privateKey, generated: true, peerId };
}
