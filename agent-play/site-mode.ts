declare const __RUSH_PUBLIC_SITE__: boolean;
/** The local laboratory keeps its own library; public pages use the shared API. */
export const PUBLIC_SITE = typeof __RUSH_PUBLIC_SITE__ !== 'undefined' && __RUSH_PUBLIC_SITE__;
export const AGENT_PATH = PUBLIC_SITE ? '/agent-play/' : '#agent-play';
export const FEED_PATH = PUBLIC_SITE ? '/runs-feed/' : '#runs-feed';
export const isFeedPage = () => PUBLIC_SITE ? location.pathname.startsWith('/runs-feed') : location.hash === '#runs-feed';
