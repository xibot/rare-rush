import { installFixture, createArtworkFixture } from '../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs';

export { createArtworkFixture };

/** Adapt the SDK's isolated read fixture to our same-origin server boundary.
 * A browser request to an external RPC is still a test failure, never a fallback. */
export async function installMainnetFixture(page, origin, options) {
  let state;
  state = await installFixture({
    addInitScript: (...args) => page.addInitScript(...args),
    route: (pattern, handler) => page.route(pattern, async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) {
        state.errors.push(`Unexpected external browser request: ${url.href}`);
        return route.abort('blockedbyclient');
      }
      if (url.origin !== origin || url.pathname !== '/api/mainnet-rpc') return handler(route);
      // Only the fixture sees the SDK's historical RPC URL. No fetch is issued.
      return handler({
        request: () => ({ url: () => 'https://rpc.mainnet.chain.robinhood.com',
          method: () => request.method(), postDataJSON: () => request.postDataJSON() }),
        continue: () => route.continue(), abort: reason => route.abort(reason),
        fulfill: response => route.fulfill(response),
      });
    }),
  }, origin, options);
  return state;
}
