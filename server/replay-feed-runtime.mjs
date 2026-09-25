import { createReplayFeed } from './replay-feed.mjs';
import { createReplayBlobStore } from './replay-feed-store.mjs';
import { createTestnetReplayBinding, testnetReplayClient } from './replay-testnet.mjs';
import { createArcadeReplayBinding, arcadeReplayClient } from './replay-arcade.mjs';

let client;
try { client = testnetReplayClient(); } catch { /* Invalid server configuration fails closed for Testnet publications. */ }
let arcadeClient;
try { arcadeClient = arcadeReplayClient(); } catch { /* Invalid server configuration fails closed for Arcade publications. */ }
export const replayFeed = createReplayFeed({
  store: createReplayBlobStore(),
  storageReady: () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN),
  bindTestnet: createTestnetReplayBinding({ client }),
  bindArcade: createArcadeReplayBinding({ client: arcadeClient }),
  // Vercel supplies this header; no IP address enters durable storage or public records.
  clientKey: request => request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'shared',
});
