import Link from 'next/link';
import type { AnchorHTMLAttributes, ComponentProps } from 'react';
import { isFileHref } from '@/lib/file-links';

// The site's only internal link. Every public page renders per request
// (no-store), so Next's viewport/hover prefetch turned each page view into a
// burst of extra dynamic renders that ate readers' per-IP request budget.
// Prefetch is always off and callers cannot turn it back on; a click still
// navigates on the client as before. Private files (RSS, OPML) get a plain <a>.

type Props = Omit<ComponentProps<typeof Link>, 'prefetch' | 'unstable_dynamicOnHover' | 'legacyBehavior' | 'passHref'>;

// Props only next/link understands; dropped when rendering a plain <a>.
const LINK_ONLY = new Set(['as', 'replace', 'scroll', 'shallow', 'locale', 'onNavigate', 'transitionTypes']);

export default function NoPrefetchLink(props: Props) {
  if (isFileHref(props.href)) {
    const anchor = Object.fromEntries(Object.entries(props).filter(([key]) => !LINK_ONLY.has(key)));
    return <a {...(anchor as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
  }
  return <Link {...props} prefetch={false} />;
}
