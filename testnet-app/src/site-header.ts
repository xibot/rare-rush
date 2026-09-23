export type HeaderPage = 'kit' | 'dashboard' | 'play';

/** Shared static markup for the vanilla test kit and React pages. No wallet or RPC values enter HTML. */
export function siteHeaderMarkup(page: HeaderPage): string {
  const links = page === 'kit'
    ? '<a href="/dashboard/">DASHBOARD</a>'
    : `<a href="/#test-kit">TEST KIT</a>${page === 'play' ? '<a href="/dashboard/">DASHBOARD</a>' : ''}`;
  return `<header class="site-header${page === 'play' ? ' collection-header' : ''}">
    <a class="site-logo brand" href="/" aria-label="Rare Rush testnet home"><img class="brand-icon" src="/assets/rare-friend.svg" width="42" height="42" alt=""><span class="brand-name">RARE<span>RUSH</span><small>BY XIBOT</small></span></a>
    <nav aria-label="Main navigation">${links}<a href="https://rarerush.app" class="arcade-link">TRY ARCADE</a>${page !== 'play' ? '<a href="/play/" class="outline-link play-link">PLAY TESTNET <span aria-hidden="true">↗</span></a>' : ''}</nav>
  </header>`;
}
