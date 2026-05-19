/**
 * registry-sync-protocol.ts — Length-prefix Framing fuer den
 * /thinklocal/mesh/registry/1.0.0 libp2p-Stream.
 *
 * libp2p/Yamux liefert einen Byte-Stream, keine Message-Grenzen. Jede
 * Sync-Message wird mit einem 4-Byte uint32-LE Length-Prefix versehen.
 * Frame-Limit verhindert Memory-Exhaustion bei malformed Input.
 *
 * Protocol-Konvention v1: **Ein Frame pro Stream**. Der Sender oeffnet pro
 * Sync-Message einen frischen libp2p-Stream, sendet genau ein Frame und
 * schliesst. Empfangsseite liest genau ein Frame und beendet den Stream.
 * Trailing Bytes nach dem Frame → Fehler.
 *
 * Authentizitaet/Integritaet kommen vom darunterliegenden libp2p-Noise-Layer
 * (mTLS-aequivalent). Der Frame-Layer hat keine eigene Crypto.
 *
 * Referenz: ADR-020 v1.2.
 */

export const REGISTRY_SYNC_MAX_FRAME_BYTES = 8 * 1024 * 1024; // 8 MiB

export class RegistrySyncFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrySyncFrameError';
  }
}

/** Verpackt eine Sync-Message in ein length-prefixed Frame. */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.byteLength > REGISTRY_SYNC_MAX_FRAME_BYTES) {
    throw new RegistrySyncFrameError(
      `frame size ${payload.byteLength} exceeds limit ${REGISTRY_SYNC_MAX_FRAME_BYTES}`,
    );
  }
  const frame = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.byteLength, true); // little-endian
  frame.set(payload, 4);
  return frame;
}

/**
 * Liest ein length-prefixed Frame aus einem AsyncIterable<Uint8Array> Stream
 * (libp2p-Source). Gibt `null` zurueck, wenn der Stream sauber zuende geht,
 * bevor ein vollstaendiges Frame verfuegbar war (EOF vor Header).
 *
 * Wirft RegistrySyncFrameError bei:
 * - Frame-Size-Verletzung
 * - Mittendrin abgebrochenem Frame (Header oder Payload incomplete)
 * - Abort via signal
 * - Trailing-Bytes nach dem Frame (1-Frame-per-Stream-Konvention)
 *
 * Bei jedem Fehlerpfad wird `iterator.return()` aufgerufen, damit
 * libp2p/Yamux den Stream sauber freigibt.
 */
export async function readFrame(
  source: AsyncIterable<Uint8Array> | AsyncIterator<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const iterator: AsyncIterator<Uint8Array> =
    typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
      ? (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
      : (source as AsyncIterator<Uint8Array>);

  const closeIterator = async (): Promise<void> => {
    try {
      await iterator.return?.();
    } catch {
      // ignore — best-effort cleanup
    }
  };

  // Race iterator.next() gegen abort signal, damit ein hangender Read auch
  // abgebrochen werden kann (libp2p-Streams haengen sonst potenziell).
  const nextWithAbort = async (): Promise<IteratorResult<Uint8Array>> => {
    if (signal?.aborted) {
      throw new RegistrySyncFrameError('aborted while reading frame');
    }
    if (!signal) return iterator.next();
    return await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
      const onAbort = () => {
        reject(new RegistrySyncFrameError('aborted while reading frame'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      iterator.next().then(
        (val) => {
          signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  };

  let headerBuf: Uint8Array | null = null;
  let payloadBuf: Uint8Array | null = null;
  let payloadFilled = 0;
  let payloadLength = -1;

  try {
    // Phase 1: 4-Byte Header lesen
    while (payloadLength < 0) {
      const next = await nextWithAbort();
      if (next.done) {
        if (headerBuf === null || headerBuf.byteLength === 0) {
          // Sauberer EOF zwischen Frames
          await closeIterator();
          return null;
        }
        throw new RegistrySyncFrameError(
          `stream ended mid-header (have ${headerBuf.byteLength} of 4 bytes)`,
        );
      }
      const chunk = next.value;
      if (!chunk || chunk.byteLength === 0) continue;

      headerBuf = headerBuf ? concat(headerBuf, chunk) : chunk;
      if (headerBuf.byteLength >= 4) {
        const view = new DataView(
          headerBuf.buffer,
          headerBuf.byteOffset,
          headerBuf.byteLength,
        );
        payloadLength = view.getUint32(0, true);
        if (payloadLength > REGISTRY_SYNC_MAX_FRAME_BYTES) {
          throw new RegistrySyncFrameError(
            `incoming frame size ${payloadLength} exceeds limit`,
          );
        }
        // Allokiere Payload-Buffer einmalig (verhindert O(n^2) concat)
        payloadBuf = new Uint8Array(payloadLength);
        // Falls Header chunk schon Payload-Bytes enthielt
        if (headerBuf.byteLength > 4) {
          const overflow = headerBuf.subarray(4);
          if (overflow.byteLength > payloadLength) {
            throw new RegistrySyncFrameError(
              'unexpected trailing bytes after registry sync frame',
            );
          }
          payloadBuf.set(overflow, 0);
          payloadFilled = overflow.byteLength;
        }
      }
    }

    // Phase 2: Payload-Bytes auffuellen
    while (payloadFilled < payloadLength) {
      const next = await nextWithAbort();
      if (next.done) {
        throw new RegistrySyncFrameError(
          `stream ended mid-payload (have ${payloadFilled} of ${payloadLength} bytes)`,
        );
      }
      const chunk = next.value;
      if (!chunk || chunk.byteLength === 0) continue;
      if (payloadFilled + chunk.byteLength > payloadLength) {
        throw new RegistrySyncFrameError(
          'unexpected trailing bytes after registry sync frame',
        );
      }
      payloadBuf!.set(chunk, payloadFilled);
      payloadFilled += chunk.byteLength;
    }

    // Phase 3: Erwarte sauberen EOF nach dem einen Frame
    const trail = await nextWithAbort();
    if (!trail.done && trail.value && trail.value.byteLength > 0) {
      throw new RegistrySyncFrameError(
        'unexpected trailing bytes after registry sync frame',
      );
    }

    await closeIterator();
    return payloadBuf!;
  } catch (err) {
    await closeIterator();
    throw err;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}
