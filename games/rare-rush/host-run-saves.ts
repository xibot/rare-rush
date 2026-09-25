import { createPublicClient, http, type Address } from 'viem';
import { readGenerationEligibility } from '@rarefriends/friendsdk/identity';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { publishRun, RunPublicationError, runPublicationMessage, type PublicationProvider } from './public-runs.ts';
import { RUN_SAVE_MAX_BYTES, type ArcadeRunCapture } from './run-save-bridge.ts';

type SaveContext = {
  frame: HTMLIFrameElement; player: Address; collection: 0 | 1; tokenId: string;
  provider: () => Promise<PublicationProvider>;
  verify: () => Promise<void>;
  assertActive: () => void;
};

/** Fixed save/navigation actions only, accepted from the exact active sandbox. */
export function bindArcadeRunSaves(context: () => SaveContext | null) {
  let busy = false, closed = false;
  const requests = new Set<AbortController>();
  const receive = (event: MessageEvent<unknown>) => {
    const current = context(), data = event.data as Record<string, unknown> | null;
    if (closed || !current || !current.frame.isConnected || event.source !== current.frame.contentWindow || event.origin !== 'null' || !data) return;
    if (data.type === 'rarerush:open-saved-run' && typeof data.id === 'string' && /^[a-f0-9]{64}$/.test(data.id)) {
      window.location.assign(`/runs-feed/?run=${data.id}`); return;
    }
    if (data.type !== 'rarerush:save-run' || typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.requestId)
      || typeof data.body !== 'string' || data.body.length > RUN_SAVE_MAX_BYTES || event.ports.length !== 1) return;
    const port = event.ports[0], requestId = data.requestId, controller = new AbortController();
    const respond = (value: { id?: string; error?: string }) => { try { port.postMessage({ type: 'rarerush:save-result', requestId, ...value }); } finally { port.close(); } };
    if (busy) { respond({ error: 'A run is already being saved. Finish that wallet request first.' }); return; }
    busy = true; requests.add(controller);
    port.onmessage = ({ data: message }) => { if (message?.type === 'rarerush:cancel-save' && message.requestId === requestId) controller.abort(); };
    port.start();
    void (async () => {
      try {
        if (new TextEncoder().encode(data.body as string).length > RUN_SAVE_MAX_BYTES) throw new RunPublicationError('This replay is too large to save.');
        const capture = JSON.parse(data.body as string) as ArcadeRunCapture;
        if (!capture || capture.collection !== current.collection || capture.tokenId !== current.tokenId
          || !/^0x[0-9a-f]{64}$/i.test(capture.seed) || !['easy', 'normal', 'degen'].includes(capture.difficulty)
          || capture.replay?.version !== 'rare-rush-agent-local-v1' || capture.replay.inputs?.version !== 'rare-rush-input-v2'
          || !Number.isSafeInteger(capture.replay.finalTick) || capture.replay.finalTick < 1 || capture.replay.finalTick > 14_400
          || capture.replay.inputs.frames?.length !== capture.replay.finalTick || !capture.art
          || capture.art.tokenId !== current.tokenId || capture.art.collection !== current.collection || capture.art.chainId !== 4663) {
          throw new RunPublicationError('This recording does not match the selected Friend.');
        }
        current.assertActive();
        await current.verify(); current.assertActive();
        const provider = await current.provider(); current.assertActive();
        const saved = await publishRun({ source: 'arcade', actor: 'human', collection: current.collection, tokenId: current.tokenId,
          seed: capture.seed, difficulty: capture.difficulty, replay: capture.replay, player: current.player,
          art: { ...capture.art, owner: current.player } }, provider, '/api/runs', { signal: controller.signal, assertActive: current.assertActive });
        respond({ id: saved.id });
      } catch (error) { respond({ error: runPublicationMessage(error) }); }
      finally { busy = false; requests.delete(controller); }
    })();
  };
  window.addEventListener('message', receive);
  return { close() { closed = true; window.removeEventListener('message', receive); for (const request of requests) request.abort(); requests.clear(); } };
}

/** Discover provider objects without prompting or choosing an arbitrary wallet.
 * The SDK's selected account remains authoritative; ambiguous matches fail. */
function discoverProviders() {
  const providers = new Set<PublicationProvider>();
  const remember = (value: unknown) => {
    if (value && typeof value === 'object' && typeof (value as PublicationProvider).request === 'function' && providers.size < 16) providers.add(value as PublicationProvider);
  };
  const announced = (event: Event) => remember((event as CustomEvent)?.detail?.provider);
  window.addEventListener('eip6963:announceProvider', announced);
  remember((window as Window & { ethereum?: unknown }).ethereum);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return {
    async matching(player: Address): Promise<PublicationProvider> {
      const matched = (await Promise.all([...providers].map(async provider => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const [accounts, chain] = await Promise.race([Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Wallet check timed out.')), 8_000); })]);
          return Array.isArray(accounts) && typeof accounts[0] === 'string' && accounts[0].toLowerCase() === player.toLowerCase()
            && typeof chain === 'string' && /^0x[0-9a-f]+$/i.test(chain) && BigInt(chain) === 4663n ? provider : null;
        } catch { return null; } finally { clearTimeout(timer); }
      }))).filter((provider): provider is PublicationProvider => provider !== null);
      if (matched.length !== 1) throw new RunPublicationError(matched.length ? 'More than one wallet matches this player. Keep only the selected wallet connected, then save again.' : 'The selected wallet is unavailable. Reconnect it in the Arcade, then save again.');
      return matched[0];
    },
    close() { window.removeEventListener('eip6963:announceProvider', announced); providers.clear(); },
  };
}

export function bindGenerationsRunSaves(root: HTMLElement) {
  const providers = discoverProviders();
  let player: Address | null = null;
  const selection = () => {
    const connection = root.querySelector('.rf-runtime-connection');
    if (connection) {
      const address = [...connection.querySelectorAll('p')].map(node => /^Connected:\s*(0x[0-9a-f]{40})$/i.exec(node.textContent?.trim() ?? '')?.[1]).find(Boolean);
      player = address ? address.toLowerCase() as Address : null;
    }
    const frame = root.querySelector<HTMLIFrameElement>('.rf-frame-viewport > iframe');
    const tokenId = /^Friend #([1-9][0-9]{0,77})$/.exec(root.querySelector('.rf-frame-toolbar button[aria-label="Choose Friend"]')?.textContent?.trim() ?? '')?.[1];
    return frame && player && tokenId ? { frame, player, tokenId } : null;
  };
  const bridge = bindArcadeRunSaves(() => {
    const selected = selection(); if (!selected) return null;
    const assertActive = () => {
      const current = selection();
      if (!current || current.frame !== selected.frame || current.player !== selected.player || current.tokenId !== selected.tokenId) {
        throw new RunPublicationError('The selected Friend or wallet changed. Your old run was not published.');
      }
    };
    return { ...selected, collection: 0, assertActive, provider: () => providers.matching(selected.player),
      verify: async () => {
        const client = createPublicClient({ transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { timeout: 12_000, retryCount: 0 }) });
        const friend = await readGenerationEligibility(client, BigInt(selected.tokenId), selected.player);
        if (!friend.ownedByPlayer || !friend.eligible) throw new RunPublicationError('This wallet no longer owns an eligible selected Friend.');
      } };
  });
  return { update: selection, close() { bridge.close(); providers.close(); player = null; } };
}
