declare const __RUSH_PUBLIC_SITE__: boolean;
/** The local laboratory keeps its own library; public pages use the shared API. */
export const PUBLIC_SITE = typeof __RUSH_PUBLIC_SITE__ !== 'undefined' && __RUSH_PUBLIC_SITE__;
export const AGENT_PATH = PUBLIC_SITE ? '/agent-play/' : '#agent-play';
export const FEED_PATH = PUBLIC_SITE ? '/runs-feed/' : '#runs-feed';
export const LEADERBOARD_PATH = PUBLIC_SITE ? '/leaderboard/' : '#leaderboard';
export type CommunityPage = 'play' | 'feed' | 'leaderboard';
export function getCommunityPage(): CommunityPage {
  const route = PUBLIC_SITE ? location.pathname : location.hash;
  if (PUBLIC_SITE ? /^\/leaderboard(?:\/|$)/.test(route) : route === '#leaderboard') return 'leaderboard';
  if (PUBLIC_SITE ? /^\/runs-feed(?:\/|$)/.test(route) : route === '#runs-feed') return 'feed';
  return 'play';
}
export const isFeedPage = () => getCommunityPage() === 'feed';
