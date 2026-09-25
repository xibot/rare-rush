import { createPublicClient, http, type Address } from 'viem';
import { readGenerationEligibility } from '@rarefriends/friendsdk/identity';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { createArcadeEventReporter, EXCLUDED_ARCADE_WALLET, isArcadeAnalyticsOrigin, parseArcadeSignal } from './analytics';

/** The SDK does not expose its wallet through GameClient. Read only the trusted
 * host's connection/selection UI, then independently confirm ownership onchain.
 * An opaque child supplies lifecycle fields only, never its claimed wallet. */
export function bindGenerationsAnalytics(root: HTMLElement) {
  let wallet: Address | null = null;
  type Session = { frame: HTMLIFrameElement; wallet: Address; friendId: bigint; reporter: ReturnType<typeof createArcadeEventReporter>; starts: Map<string, Promise<boolean>> };
  let session: Session | null = null;
  const enabled = isArcadeAnalyticsOrigin(window.location.origin);
  const update = () => {
    if (!enabled) return;
    const connection = root.querySelector('.rf-runtime-connection');
    if (connection) {
      const account = [...connection.querySelectorAll('p')].map(node => /^Connected:\s*(0x[0-9a-f]{40})$/i.exec(node.textContent?.trim() ?? '')?.[1]).find(Boolean);
      wallet = account ? account.toLowerCase() as Address : null;
    }
    const frame = root.querySelector<HTMLIFrameElement>('.rf-frame-viewport > iframe');
    const selected = /^Friend #([1-9]\d{0,77})$/.exec(root.querySelector('.rf-frame-toolbar button[aria-label="Choose Friend"]')?.textContent?.trim() ?? '');
    const friendId = selected ? BigInt(selected[1]) : 0n;
    if (!frame || !wallet || friendId <= 0n || friendId >= 1n << 256n || wallet === EXCLUDED_ARCADE_WALLET) { session = null; return; }
    if (session?.frame === frame && session.wallet === wallet && session.friendId === friendId) return;
    session = { frame, wallet, friendId, reporter: createArcadeEventReporter(window.location.origin), starts: new Map() };
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (!enabled) return;
    update();
    const current = session, signal = parseArcadeSignal(event.data);
    if (!current || !signal || !current.frame.isConnected || event.source !== current.frame.contentWindow || event.origin !== 'null') return;
    if (signal.type === 'rarerush:arcade-start') {
      if (signal.collection !== 'generations' || current.starts.has(signal.runId) || current.starts.size >= 128) return;
      const task = (async () => {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 5_000);
        try {
          const client = createPublicClient({ transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { timeout: 4_000, retryCount: 0, fetchOptions: { signal: controller.signal } }) });
          const identity = await readGenerationEligibility(client, current.friendId, current.wallet);
          if (controller.signal.aborted || session !== current || !current.frame.isConnected || identity.eligible !== true) return false;
          current.reporter.start(signal, current.wallet);
          return true;
        } catch { return false; }
        finally { clearTimeout(deadline); }
      })();
      current.starts.set(signal.runId, task);
    } else {
      void current.starts.get(signal.runId)?.then(accepted => {
        if (accepted && session === current && current.frame.isConnected) current.reporter.finish(signal);
      });
    }
  };
  if (enabled) window.addEventListener('message', receive);
  return {
    update,
    close() { window.removeEventListener('message', receive); session = null; wallet = null; },
    restore() { if (enabled) window.addEventListener('message', receive); update(); },
  };
}
