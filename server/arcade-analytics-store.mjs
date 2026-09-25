import { get, list, put } from '@vercel/blob';

/** Every object is private and immutable. Never return Blob URLs to the browser. */
export function createPrivateBlobStore(sdk = { get, list, put }) {
  async function read(pathname) {
    const result = await sdk.get(pathname, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream || result.blob.size > 2048) throw new Error('Invalid analytics object.');
    const body = await new Response(result.stream).text();
    if (Buffer.byteLength(body) > 2048) throw new Error('Invalid analytics object.');
    return JSON.parse(body);
  }
  return {
    async putIfAbsent(pathname, value) {
      try {
        await sdk.put(pathname, JSON.stringify(value), {
          access: 'private', addRandomSuffix: false, allowOverwrite: false,
          contentType: 'application/json', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000),
        });
        return true;
      } catch (error) {
        // The SDK does not expose a distinct already-exists error. An existing exact
        // path also resolves an ambiguous response after a successful immutable PUT.
        // Its content is validated by the handler before treating this as a duplicate.
        try { if (await read(pathname)) return false; } catch { /* Do not hide a failed write without an existing object. */ }
        throw error;
      }
    },
    read,
    async list(options) {
      const timeout = AbortSignal.timeout(8000);
      return sdk.list({ ...options, mode: 'expanded',
        abortSignal: options.abortSignal ? AbortSignal.any([options.abortSignal, timeout]) : timeout });
    },
  };
}
