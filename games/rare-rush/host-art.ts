import { createGenerationSpriteReader, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import { createArcadePublicClient } from './arcade-client.ts';
import { parseArcadeArtRequest, type ArcadeArt } from './art-bridge.ts';

type Selection = { frame: HTMLIFrameElement; tokenId: string };
/** The trusted parent reads art using our private RPC; the opaque game has no
 * provider, arbitrary RPC method, endpoint URL, or ability to select another NFT. */
export function bindGenerationsArtwork(root: HTMLElement,
  read = (id: bigint, signal: AbortSignal): Promise<GenerationSprites> =>
    createGenerationSpriteReader(createArcadePublicClient({ signal })).read(id)) {
  let closed = false;
  const jobs = new Set<{ current: () => boolean; cancel: () => void }>();
  const selection = (): Selection | null => {
    const frame = root.querySelector<HTMLIFrameElement>('.rf-frame-viewport > iframe');
    const tokenId = /^Friend #([1-9][0-9]{0,77})$/.exec(root.querySelector(
      '.rf-frame-toolbar button[aria-label="Choose Friend"]')?.textContent?.trim() ?? '')?.[1];
    return frame?.isConnected && tokenId ? { frame, tokenId } : null;
  };
  const receive = (event: MessageEvent<unknown>) => {
    const selected = selection(), request = parseArcadeArtRequest(event.data);
    if (closed || !selected || !request || event.source !== selected.frame.contentWindow || event.origin !== 'null'
      || event.ports.length !== 1 || request.tokenId !== selected.tokenId) return;
    const port = event.ports[0];
    if (jobs.size >= 2) { port.postMessage({ type: 'rarerush:art-result', requestId: request.requestId, error: true }); port.close(); return; }
    const controller = new AbortController();
    let settled = false;
    const current = () => { const now = selection(); return !closed && now?.frame === selected.frame && now.tokenId === selected.tokenId; };
    const finish = (art?: ArcadeArt) => {
      if (settled) return; settled = true;
      window.clearTimeout(timer); jobs.delete(job); controller.abort();
      try { port.postMessage({ type: 'rarerush:art-result', requestId: request.requestId, ...(art && current() ? { art } : { error: true }) }); }
      finally { port.close(); }
    };
    const job = { current, cancel: () => finish() };
    const timer = window.setTimeout(() => finish(), 20_000);
    jobs.add(job);
    port.onmessage = ({ data }) => { if (data?.type === 'rarerush:cancel-art' && data.requestId === request.requestId) finish(); };
    port.start();
    void Promise.resolve().then(() => read(BigInt(selected.tokenId), controller.signal)).then(art => {
      finish({ tokenId: selected.tokenId, familyId: art.familyId, seed: art.seed, frames: art.frames.map(String) });
    }).catch(() => finish());
  };
  window.addEventListener('message', receive);
  return {
    update() { for (const job of [...jobs]) if (!job.current()) job.cancel(); },
    close() { closed = true; window.removeEventListener('message', receive); for (const job of [...jobs]) job.cancel(); },
  };
}
