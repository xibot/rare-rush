import { createWalletClient, custom, getAddress, recoverTypedDataAddress, type EIP1193Provider } from 'viem';
import { prepareReplayPublication, publicationPayloadHash, type ReplayPublication } from '../../shared/replay-publication.ts';

export type PublicationProvider = { request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown> };
export type PublishedRun = Omit<ReplayPublication, 'replay' | 'art'> & {
  id: string; createdAt: string; agent: string; verification: string;
  metrics: { verified: true; outcome: 'survived' | 'lost'; finishReason: 'time' | 'hearts'; score: number;
    coins: number; bonusCoins: number; hearts: number; distance: number; ticks: number; elapsed: number;
    duration: number; pickupKinds: `0x${string}`; phasesVisited: ('side' | 'up' | 'down')[] };
  replay?: ReplayPublication['replay']; art?: ReplayPublication['art'];
};
export type PublishOptions = { signal?: AbortSignal; assertActive?: () => void; fetcher?: typeof fetch };
export class RunPublicationError extends Error {}
// Leave room for the short authorization added to the server's 1.8 MB limit.
export const MAX_PUBLIC_REPLAY_PAYLOAD_BYTES = 1_799_000;

export function runPublicationMessage(error: unknown): string {
  return error instanceof RunPublicationError ? error.message : 'The run could not be published. Your replay is still here; try again.';
}
function active(options: PublishOptions) {
  if (options.signal?.aborted) throw new RunPublicationError('Saving was cancelled. Your replay is still here.');
  options.assertActive?.();
}
async function bounded<T>(promise: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal?.reason instanceof RunPublicationError ? signal.reason : new RunPublicationError('Saving was cancelled. Your replay is still here.'));
      timer = setTimeout(() => reject(new RunPublicationError('Saving timed out. Check your wallet, then try again.')), milliseconds);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function checkWallet(provider: PublicationProvider, payload: ReplayPublication, options: PublishOptions) {
  active(options);
  const [accounts, chain] = await bounded(Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]), 15_000, options.signal);
  const expected = payload.source === 'arcade' ? 4663n : 46630n;
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== payload.player.toLowerCase()) {
    throw new RunPublicationError('Use the wallet that played this run, then try saving again.');
  }
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== expected) {
    throw new RunPublicationError('Return the connected wallet to this run’s network, then try saving again.');
  }
  active(options);
}

/** Explicit Save Run action only: one publication signature, never a transaction.
 * All JSON fields (including packed artwork) are identical when signed and sent. */
export async function publishRun(input: ReplayPublication, provider: PublicationProvider, endpoint = '/api/runs', options: PublishOptions = {}): Promise<PublishedRun> {
  const controller = new AbortController();
  let networkTimeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    active(options);
    const serialized = JSON.stringify(input, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (new TextEncoder().encode(serialized).length > MAX_PUBLIC_REPLAY_PAYLOAD_BYTES) throw new RunPublicationError('This replay is too large to publish.');
    const payload = JSON.parse(serialized) as ReplayPublication;
    await checkWallet(provider, payload, options);
    const authorization = prepareReplayPublication(payload);
    const signature = await bounded(createWalletClient({ account: getAddress(payload.player),
      transport: custom(provider as EIP1193Provider, { retryCount: 0 }) }).signTypedData(authorization.typedData), 180_000, options.signal);
    if (!/^0x[0-9a-f]{130}$/i.test(signature) || (await recoverTypedDataAddress({ ...authorization.typedData, signature })).toLowerCase() !== payload.player.toLowerCase()) {
      throw new RunPublicationError('This wallet did not return a compatible signature for the player.');
    }
    await checkWallet(provider, payload, options);
    networkTimeout = setTimeout(() => controller.abort(new RunPublicationError('Saving timed out. Your replay is still here; try again.')), 20_000);
    const response = await bounded((options.fetcher ?? fetch)(endpoint, { method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ ...payload, authorization: { expiresAt: authorization.expiresAt, signature } }) }), 20_000, controller.signal);
    if (Number(response.headers.get('content-length')) > 16_384 || !response.body) throw new RunPublicationError('The save service returned an invalid response.');
    const reader = response.body.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await bounded(reader.read(), 20_000, controller.signal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16_384) throw new RunPublicationError('The save service returned an invalid response.');
        text += decoder.decode(value, { stream: true });
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const saved = JSON.parse(text + decoder.decode()) as PublishedRun & { error?: string };
    if (!response.ok) throw new RunPublicationError(typeof saved.error === 'string' && saved.error.length <= 300
      && !/https?:\/\/|\n/.test(saved.error) ? saved.error : 'The run could not be published. Your replay is still here; try again.');
    if (saved.id !== publicationPayloadHash(payload).slice(2) || saved.source !== payload.source || saved.tokenId !== payload.tokenId
      || saved.collection !== payload.collection || saved.seed !== payload.seed.toLowerCase() || saved.difficulty !== payload.difficulty
      || saved.player?.toLowerCase() !== payload.player.toLowerCase() || saved.runId !== payload.runId) {
      throw new RunPublicationError('The save service returned a different run. Try again.');
    }
    active(options); return saved;
  } catch (error) {
    if (error instanceof RunPublicationError) throw error;
    if ((error as { code?: unknown })?.code === 4001 || /rejected|denied/i.test((error as Error)?.message ?? '')) {
      throw new RunPublicationError('Signature declined. Your replay is still here; save it when ready.');
    }
    throw new RunPublicationError('The run could not be published. Your replay is still here; try again.');
  } finally { clearTimeout(networkTimeout); controller.abort(); options.signal?.removeEventListener('abort', cancel); }
}
