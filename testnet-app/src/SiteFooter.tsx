import { siteFooterMarkup } from '../generated/shared/site-footer.ts';
import '../generated/shared/site-footer.css';

/** Keep the testnet pages on the same footer as the main site. */
export function SiteFooter() {
  return <div dangerouslySetInnerHTML={{ __html: siteFooterMarkup('testnet') }}/>;
}
