import { createPublicClient, defineChain, getAddress, http, type Abi, type Hex } from 'viem';
import deployment from '../src/shared/deployment.json' with { type: 'json' };
import { privateKeyToAccount } from 'viem/accounts';
import gameArtifact from '../generated/infra/testnet/artifacts/RareRushGame.json' with { type: 'json' };
import nftArtifact from '../generated/infra/testnet/artifacts/TestFriends.json' with { type: 'json' };
import { ENGINE_VERSION } from '../generated/engine-version.ts';
import { verifyAndSignCore } from '../generated/infra/testnet/src/verifier-core.ts';
import { AUTH_CHAIN_ID, AUTH_GAME } from '../src/shared/authorization.ts';
import { createVerifierHandlers, RunVerificationRejected, type VerifierStatus } from './handler.ts';

const EXPECTED_VERIFIER = deployment.verifier;
const EXPECTED_REWARD_TOKEN = deployment.contracts.rewardToken;
const chain = defineChain({
  id: AUTH_CHAIN_ID, name: 'Robinhood Testnet', testnet: true,
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
});
const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { timeout: 12_000, retryCount: 1 }), cacheTime: 0 });
const gameAbi = gameArtifact.abi as Abi;
const nftAbi = nftArtifact.abi as Abi;

function signingKey(): Hex | null {
  // Server-only environment. Never imported by frontend code or accepted from a request.
  const key = process.env.RUSH_VERIFIER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  try { privateKeyToAccount(key as Hex); return key as Hex; }
  catch { return null; }
}

async function status(): Promise<VerifierStatus> {
  const base = { ready: false, chainId: AUTH_CHAIN_ID as 46630, game: AUTH_GAME, engineVersion: ENGINE_VERSION, verifier: null };
  const key = signingKey();
  if (!key) return { ...base, reason: 'not-configured' };
  const signer = privateKeyToAccount(key).address;
  if (signer !== getAddress(EXPECTED_VERIFIER)) return { ...base, reason: 'configuration-mismatch' };
  try {
    if (await client.getChainId() !== AUTH_CHAIN_ID) return { ...base, reason: 'configuration-mismatch' };
    const latest = await client.getBlockNumber({ cacheTime: 0 });
    if (latest < 2n) return { ...base, reason: 'rpc-unavailable' };
    const blockNumber = latest - 2n;
    const read = (functionName: string) => client.readContract({ address: AUTH_GAME, abi: gameAbi, functionName, blockNumber });
    const [verifier, version, token, paused] = await Promise.all([read('verifier'), read('engineVersion'), read('token'), read('paused')]);
    if (typeof verifier !== 'string' || typeof version !== 'string' || typeof token !== 'string'
      || getAddress(verifier) !== signer || version.toLowerCase() !== ENGINE_VERSION.toLowerCase()
      || getAddress(token) !== getAddress(EXPECTED_REWARD_TOKEN)) return { ...base, reason: 'configuration-mismatch' };
    if (paused === true) return { ...base, verifier: signer, reason: 'paused' };
    return { ...base, ready: true, verifier: signer, reason: 'ready' };
  } catch { return { ...base, reason: 'rpc-unavailable' }; }
}

const knownRunRejection = /^(Invalid run ID\.|Run is not claimable\.|Authorization is not from the run player\.|Invalid run collection\.|Run is unfinished or its claim window expired\.|Player no longer owns the test NFT\.|Generations Friend is not hardwired\.|Invalid contract seed\.|Invalid contract difficulty\.|Expected a replay object\.|Unsupported replay schema\.|Too many input frames\.|Invalid input frame\.|Frames must be strictly ordered|Replay has inputs after the run ended\.|Run did not survive the timer\.|Pickup limit exceeded\.)/;

export const handlers = createVerifierHandlers({
  status,
  // On Vercel this header is supplied by the edge. It is only a best-effort local bucket;
  // the deployed WAF must enforce distributed limits using its own trusted source IP.
  clientKey: request => request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'shared',
  async verify({ runId, replay, expectedPlayer }) {
    const key = signingKey();
    if (!key) throw new Error('Verifier is not configured.');
    try {
      return await verifyAndSignCore({
        client, chainId: AUTH_CHAIN_ID, game: AUTH_GAME, runId, replay, expectedPlayer,
        privateKey: key, confirmations: 2, gameAbi, nftAbi, engineVersion: ENGINE_VERSION,
      });
    } catch (error) {
      if (error instanceof Error && knownRunRejection.test(error.message)) throw new RunVerificationRejected('Run is not eligible.');
      throw new Error('Verifier service is unavailable.');
    }
  },
});
