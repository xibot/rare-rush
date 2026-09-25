import { BrandMark } from './BrandMark';
import { SITE_LINKS } from './site-navigation';

/** The landing header is the common site chrome, independent of page content width. */
export function SiteHeader({ page }: { page: 'landing' | 'docs' | 'pitch' | 'genesis' | 'agent-play' | 'runs-feed' | 'leaderboard' }) {
  return <div className="site-header-shell" id="top">
    <header className={`site-header ${page}-header`}>
      <a className={`site-logo ${page}-logo`} href={page === 'landing' ? '#top' : '/'} aria-label="Rare Rush home"><BrandMark/></a>
      <nav aria-label="Main navigation">{SITE_LINKS.map(link => <a key={link.href} className={link.className} href={page === 'landing' && link.className === 'nav-how-to-play' ? '#how-to-play' : link.href} aria-current={link.href === `/${page}/` ? 'page' : undefined}>{link.label}{'arrow' in link && <> <span aria-hidden="true">↗</span></>}</a>)}</nav>
    </header>
  </div>;
}
