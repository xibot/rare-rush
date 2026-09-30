import { decodeGenerationSprites, type GenerationSprites } from '@rarefriends/friendsdk/sprites';

export type ArcadeArt = { tokenId: string; familyId: number; seed: number; frames: string[] };
const positiveId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 1n << 256n;
export function parseArcadeArtRequest(value: unknown): { requestId: string; tokenId: string } | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  return data.type === 'rarerush:request-art' && typeof data.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(data.requestId)
    && positiveId(data.tokenId) ? { requestId: data.requestId, tokenId: data.tokenId } : null;
}

/** Validate the fixed bitmap format before it can reach the game renderer. */
export function decodeArcadeArt(value: unknown, tokenId: bigint): GenerationSprites {
  if (!value || typeof value !== 'object') throw new Error('Invalid Friend artwork.');
  const art = value as ArcadeArt;
  if (art.tokenId !== String(tokenId) || !Number.isInteger(art.familyId) || art.familyId < 0 || art.familyId > 255
    || !Number.isInteger(art.seed) || art.seed < 0 || art.seed > 0xffffffff || !Array.isArray(art.frames) || art.frames.length !== 64
    || !art.frames.every(frame => typeof frame === 'string' && /^\d{1,78}$/.test(frame) && BigInt(frame) < 1n << 256n)) {
    throw new Error('Invalid Friend artwork.');
  }
  return decodeGenerationSprites(tokenId, art.familyId, art.seed, art.frames.map(BigInt));
}

/** The opaque game requests only its selected Friend's art. No RPC URL or
 * wallet capability crosses this fixed-purpose MessageChannel. */
export function requestArcadeArt(tokenId: bigint, signal?: AbortSignal): Promise<GenerationSprites> {
  if (window.parent === window || !positiveId(String(tokenId))) return Promise.reject(new Error('Open this game through the Arcade.'));
  if (signal?.aborted) return Promise.reject(new Error('Friend loading was cancelled.'));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), requestId = crypto.randomUUID();
    let settled = false;
    const finish = (error?: Error, art?: GenerationSprites) => {
      if (settled) return; settled = true;
      window.clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      channel.port1.close(); channel.port2.close();
      if (error) reject(error); else resolve(art!);
    };
    const cancel = () => {
      channel.port1.postMessage({ type: 'rarerush:cancel-art', requestId });
      finish(new Error('Friend loading was cancelled.'));
    };
    const timer = window.setTimeout(() => {
      channel.port1.postMessage({ type: 'rarerush:cancel-art', requestId });
      finish(new Error('Friend artwork took too long to load. Please retry.'));
    }, 22_000);
    signal?.addEventListener('abort', cancel, { once: true });
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== 'rarerush:art-result' || data.requestId !== requestId) return;
      try {
        if (data.error) throw new Error('Could not load your Friend artwork. Please retry.');
        finish(undefined, decodeArcadeArt(data.art, tokenId));
      } catch { finish(new Error('Could not load your Friend artwork. Please retry.')); }
    };
    channel.port1.start();
    try { window.parent.postMessage({ type: 'rarerush:request-art', requestId, tokenId: String(tokenId) },
      new URL(window.location.href).origin, [channel.port2]); }
    catch { finish(new Error('The Arcade artwork connection is unavailable.')); }
  });
}
