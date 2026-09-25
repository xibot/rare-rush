import { get, list, put } from '@vercel/blob';

export const MAX_STORED_REPLAY_BYTES = 2_500_000;

/** Separate namespace, same private Blob store. Storage URLs never leave the server. */
export function createReplayBlobStore(sdk = { get, list, put }) {
  async function read(pathname, maxBytes = MAX_STORED_REPLAY_BYTES) {
    const result = await sdk.get(pathname, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream || result.blob.size > maxBytes) throw new Error('Invalid replay object.');
    const reader = result.stream.getReader(), chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw new Error('Replay object exceeds its size limit.');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return {
    read,
    async putIfAbsent(pathname, value) {
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body) > MAX_STORED_REPLAY_BYTES) throw new Error('Replay object exceeds its size limit.');
      try {
        await sdk.put(pathname, body, { access: 'private', addRandomSuffix: false, allowOverwrite: false,
          contentType: 'application/json', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000) });
        return true;
      } catch (error) {
        // Resolve duplicate and ambiguous successful PUTs by reading the exact immutable key.
        try { if (await read(pathname)) return false; } catch { /* Preserve the write failure. */ }
        throw error;
      }
    },
    list: options => sdk.list({ ...options, mode: 'expanded', abortSignal: AbortSignal.timeout(8000) }),
  };
}
