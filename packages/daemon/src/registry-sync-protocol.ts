/**
 * registry-sync-protocol.ts — Length-prefix Framing fuer den
 * /thinklocal/mesh/registry/1.0.0 libp2p-Stream.
 *
 * libp2p/Yamux liefert einen Byte-Stream, keine Message-Grenzen. Jede
 * Sync-Message wird mit einem 4-Byte uint32-LE Length-Prefix versehen.
 * Frame-Limit verhindert Memory-Exhaustion bei malformed Input.
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
 * bevor ein vollstaendiges Frame verfuegbar war (EOF).
 *
 * Wirft RegistrySyncFrameError bei Frame-Size-Verletzung oder mittendrin
 * abgebrochenem Frame.
 */
export async function readFrame(
  source: AsyncIterable<Uint8Array> | AsyncIterator<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const iterator: AsyncIterator<Uint8Array> =
    typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
      ? (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
      : (source as AsyncIterator<Uint8Array>);

  let buffer: Uint8Array | null = null;
  let needed = 4; // erst Header lesen
  let payloadLength = -1;

  while (true) {
    if (signal?.aborted) {
      throw new RegistrySyncFrameError('aborted while reading frame');
    }

    if (buffer && buffer.byteLength >= needed) {
      if (payloadLength < 0) {
        // Header vollstaendig
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        payloadLength = view.getUint32(0, true);
        if (payloadLength > REGISTRY_SYNC_MAX_FRAME_BYTES) {
          throw new RegistrySyncFrameError(
            `incoming frame size ${payloadLength} exceeds limit`,
          );
        }
        needed = 4 + payloadLength;
        if (buffer.byteLength >= needed) {
          const payload = buffer.slice(4, needed);
          return payload;
        }
      } else {
        // Payload vollstaendig
        const payload = buffer.slice(4, needed);
        return payload;
      }
    }

    const next = await iterator.next();
    if (next.done) {
      if (buffer === null && payloadLength < 0) {
        // sauberer EOF zwischen Frames
        return null;
      }
      throw new RegistrySyncFrameError(
        `stream ended mid-frame (have ${buffer?.byteLength ?? 0} of ${needed} bytes)`,
      );
    }

    const chunk = next.value;
    if (!chunk || chunk.byteLength === 0) continue;

    buffer = buffer ? concat(buffer, chunk) : chunk;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}
