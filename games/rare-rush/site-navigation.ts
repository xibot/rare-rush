/** Shared public navigation for the React pages and the FriendSDK entry. */
export const SITE_LINKS = [
  { label: 'HOW TO PLAY', href: '/#how-to-play', className: 'nav-how-to-play' },
  { label: 'DOCS', href: '/docs/', className: 'header-docs' },
  { label: 'PITCH', href: '/pitch/', className: '' },
  { label: 'AGENT PLAY', href: '/agent-play/', className: 'nav-agent-play' },
  { label: 'RUNS FEED', href: '/runs-feed/', className: 'nav-runs-feed' },
  { label: 'TRY TESTNET', href: 'https://testnet.rarerush.app', className: 'nav-testnet' },
  { label: 'PLAY ARCADE', href: '/arcade/', className: 'header-play nav-arcade', arrow: true },
] as const;

/** Static, project-owned markup for the SDK host; no wallet or RPC data enters HTML. */
export function createSdkSiteHeader(): HTMLElement {
  const shell = document.createElement('div');
  shell.id = 'top';
  shell.className = 'site-header-shell';
  shell.innerHTML = `<header class="site-header rush-entry-header"><a class="site-logo rush-entry-logo" href="/" aria-label="Rare Rush home"><img class="brand-icon" src="/favicon.svg" width="42" height="42" alt=""><span class="brand-name">RARE<span>RUSH</span></span></a><nav aria-label="Main navigation">${SITE_LINKS.map(link => `<a class="${link.className}" href="${link.href}">${link.label}${'arrow' in link ? ' <span aria-hidden="true">↗</span>' : ''}</a>`).join('')}</nav></header>`;
  return shell;
}
