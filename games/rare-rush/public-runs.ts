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

/** The hosting platform can return plain text or HTML before the API starts.
 * Keep those responses out of user-facing errors while retaining bounded API messages. */
export async function readRunServiceResponse<T>(response: Response, options: { maxBytes?: number; errorMessage?: string } = {}): Promise<T> {
  const { maxBytes = 2_500_000, errorMessage = 'The run service is temporarily unavailable. Please try again.' } = options;
  const invalidMessage = response.ok ? 'The run service returned an invalid response. Please try again.' : errorMessage;
  if (Number(response.headers.get('content-length')) > maxBytes || !response.body) throw new RunPublicationError(invalidMessage);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new RunPublicationError(invalidMessage);
      text += decoder.decode(value, { stream: true });
    }
    let value: unknown;
    try { value = JSON.parse(text + decoder.decode()); }
    catch { throw new RunPublicationError(invalidMessage); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RunPublicationError(invalidMessage);
    if (!response.ok) {
      const message = (value as { error?: unknown }).error;
      throw new RunPublicationError(typeof message === 'string' && message.length > 0 && message.length <= 300
        && !/https?:\/\/|[\r\n<>]/.test(message) ? message : errorMessage);
    }
    return value as T;
  } catch (error) {
    if (error instanceof RunPublicationError) throw error;
    throw new RunPublicationError(errorMessage);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function active(options: PublishOptions) {
  if (options.signal?.aborted) throw new RunPublicationError('Saving was cancelled. Your replay is still here.');
  options.assertActive?.();
}
function normalizedPublication(input: ReplayPublication): ReplayPublication {
  const serialized = JSON.stringify(input, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  if (new TextEncoder().encode(serialized).length > MAX_PUBLIC_REPLAY_PAYLOAD_BYTES) throw new RunPublicationError('This replay is too large to publish.');
  return JSON.parse(serialized) as ReplayPublication;
}
function checkSavedIdentity(saved: PublishedRun, payload: ReplayPublication) {
  if (saved.id !== publicationPayloadHash(payload).slice(2) || saved.source !== payload.source || saved.tokenId !== payload.tokenId
    || saved.collection !== payload.collection || saved.seed !== payload.seed.toLowerCase() || saved.difficulty !== payload.difficulty
    || typeof saved.player !== 'string' || saved.player.toLowerCase() !== payload.player.toLowerCase()
    || saved.runId !== payload.runId || saved.actor !== payload.actor) {
    throw new RunPublicationError('The save service returned a different run. Try again.');
  }
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

/** Recover a previously saved replay from its content identity without using a wallet. */
export async function findPublishedRun(input: ReplayPublication, endpoint = '/api/runs', options: PublishOptions = {}): Promise<PublishedRun | null> {
  const controller = new AbortController();
  let networkTimeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    active(options);
    const payload = normalizedPublication(input);
    networkTimeout = setTimeout(() => controller.abort(new RunPublicationError('Checking saved runs timed out. Your replay is still here; try again.')), 20_000);
    const response = await bounded((options.fetcher ?? fetch)(`${endpoint.replace(/\/$/, '')}/${publicationPayloadHash(payload).slice(2)}?publication=1`,
      { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal }), 20_000, controller.signal);
    active(options);
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    // Older services may ignore the query and return full replay/art details.
    const saved = await bounded(readRunServiceResponse<PublishedRun>(response), 20_000, controller.signal);
    active(options);
    checkSavedIdentity(saved, payload);
    return saved;
  } catch (error) {
    if (error instanceof RunPublicationError) throw error;
    throw new RunPublicationError('Saved runs could not be checked. Your replay is still here; try again.');
  } finally { clearTimeout(networkTimeout); controller.abort(); options.signal?.removeEventListener('abort', cancel); }
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
    const payload = normalizedPublication(input);
    const existing = await findPublishedRun(payload, endpoint, options);
    active(options);
    if (existing) return existing;
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
    const saved = await bounded(readRunServiceResponse<PublishedRun>(response, { maxBytes: 16_384,
      errorMessage: 'The run could not be published. Your replay is still here; try again.' }), 20_000, controller.signal);
    checkSavedIdentity(saved, payload);
    active(options); return saved;
  } catch (error) {
    if (error instanceof RunPublicationError) throw error;
    if ((error as { code?: unknown })?.code === 4001 || /rejected|denied/i.test((error as Error)?.message ?? '')) {
      throw new RunPublicationError('Signature declined. Your replay is still here; save it when ready.');
    }
    throw new RunPublicationError('The run could not be published. Your replay is still here; try again.');
  } finally { clearTimeout(networkTimeout); controller.abort(); options.signal?.removeEventListener('abort', cancel); }
}
