import { arcadeAnalytics } from '../server/arcade-analytics-runtime.mjs';

export default { fetch: request => arcadeAnalytics.events(request) };
