import { replayFeed } from '../../server/generated/replay-feed-runtime.mjs';
export default { fetch: request => replayFeed.handle(request) };
