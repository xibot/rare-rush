import { createArcadeAnalytics } from './arcade-analytics.mjs';
import { createPrivateBlobStore } from './arcade-analytics-store.mjs';

export const arcadeAnalytics = createArcadeAnalytics({
  store: createPrivateBlobStore(),
  settings: () => ({
    // The SDK obtains/refreshes Vercel OIDC credentials itself when BLOB_STORE_ID is
    // linked. Static read/write tokens remain supported for operator environments.
    storageReady: Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN),
    hashKey: process.env.RUSH_ANALYTICS_HASH_KEY,
    adminKey: process.env.RUSH_ANALYTICS_ADMIN_KEY,
  }),
  clientKey: request => request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'shared',
});
