import { siteFooterMarkup } from '../../shared/site-footer';
import '../../shared/site-footer.css';

/** The same footer markup is used by React and the plain DOM entry pages. */
export function SiteFooter() {
  return <div dangerouslySetInnerHTML={{ __html: siteFooterMarkup() }}/>;
}
