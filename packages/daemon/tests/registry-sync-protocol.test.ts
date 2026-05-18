import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  readFrame,
  RegistrySyncFrameError,
  REGISTRY_SYNC_MAX_FRAME_BYTES,
} from '../src/registry-sync-protocol.js';

async function* fromChunks(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function* truncated(payload: Uint8Array, cutAt: number): AsyncIterable<Uint8Array> {
  yield payload.slice(0, cutAt);
}

describe('registry-sync-protocol framing', () => {
  it('encode + decode round-trip via single chunk', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeFrame(payload);
    const decoded = await readFrame(fromChunks([frame]));
    expect(decoded).toEqual(payload);
  });

  it('decodes a frame split across multiple chunks', async () => {
    const payload = new Uint8Array(1024).fill(42);
    const frame = encodeFrame(payload);
    const decoded = await readFrame(
      fromChunks([frame.slice(0, 2), frame.slice(2, 6), frame.slice(6)]),
    );
    expect(decoded).toEqual(payload);
  });

  it('returns null at clean EOF between frames', async () => {
    const result = await readFrame(fromChunks([]));
    expect(result).toBeNull();
  });

  it('throws on truncated header', async () => {
    await expect(readFrame(truncated(new Uint8Array([1, 2]), 2))).rejects.toThrow(
      RegistrySyncFrameError,
    );
  });

  it('throws on truncated payload', async () => {
    const payload = new Uint8Array([9, 9, 9, 9, 9]);
    const frame = encodeFrame(payload);
    await expect(readFrame(truncated(frame, 5))).rejects.toThrow(RegistrySyncFrameError);
  });

  it('rejects encoded frames beyond size limit', () => {
    const tooBig = new Uint8Array(REGISTRY_SYNC_MAX_FRAME_BYTES + 1);
    expect(() => encodeFrame(tooBig)).toThrow(RegistrySyncFrameError);
  });

  it('rejects incoming frames beyond size limit', async () => {
    const header = new Uint8Array(4);
    const view = new DataView(header.buffer);
    view.setUint32(0, REGISTRY_SYNC_MAX_FRAME_BYTES + 1, true);
    await expect(readFrame(fromChunks([header]))).rejects.toThrow(RegistrySyncFrameError);
  });

  it('aborts when signal is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(readFrame(fromChunks([]), ac.signal)).rejects.toThrow(RegistrySyncFrameError);
  });
});
