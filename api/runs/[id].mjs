import { replayFeed } from '../../server/replay-feed-runtime.mjs';
export default { fetch: request => replayFeed.handle(request) };
