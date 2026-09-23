import { siteHeaderMarkup, type HeaderPage } from './site-header.ts';

/** Use exactly the same project-owned header markup as the test kit. */
export function SiteHeader({ page }: { page: HeaderPage }) {
  return <div className="site-header-shell" dangerouslySetInnerHTML={{ __html: siteHeaderMarkup(page) }}/>;
}
