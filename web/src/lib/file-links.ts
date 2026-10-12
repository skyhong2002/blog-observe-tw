// Same-site links that are files, not pages: the reader's private RSS and OPML
// (/me/...), and feeds. NoPrefetchLink renders these as a plain <a>, so the
// router never requests them as RSC payloads.
export const isFileHref = (href: unknown): href is string =>
  typeof href === 'string' && /^\/(?:me|feeds)\/|\.(?:xml|opml)(?:[?#]|$)/.test(href);
