import { isAllowedCrawlUrl } from '../crawl/feed.ts';

const PLATFORM_ROOTS = new Set([
  'blogger.com',
  'blogspot.com',
  'wordpress.com',
  'pixnet.net',
  'medium.com',
  'substack.com',
  'vocus.cc',
  'udn.com',
  'blog.udn.com',
  'tumblr.com',
  'github.io',
  'notion.site',
]);
const IGNORED_HOSTS = new Set([
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  't.co',
  'threads.net',
  'threads.com',
  'line.me',
  'lin.ee',
  'google.com',
  'amazon.com',
  'shopee.tw',
  'wikipedia.org',
]);
const RESERVED_MEDIUM = new Set([
  'about',
  'm',
  'p',
  'tag',
  'tags',
  'topic',
  'topics',
  'search',
  'membership',
  'me',
  'plans',
  'policy',
  'creators',
  'feed',
]);

/** Network-free URL normalization. Keep query semantics except known tracking keys. */
export function normalizeLink(value: string, base?: string): string | null {
  try {
    if (value.includes('\\') || value.charCodeAt(0) <= 32) return null;
    const u = new URL(value, base);
    if (!isAllowedCrawlUrl(u.href) || /(?:^|\.)(?:localhost|local|internal|ts\.net)$/.test(u.hostname) || !u.hostname.includes('.'))
      return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()])
      if (/^(?:utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) u.searchParams.delete(key);
    return u.href.length <= 1024 ? u.href : null;
  } catch {
    return null;
  }
}

/** Identity comparison ignores scheme/www/trailing slash, never the platform owner path. */
export function identityKey(value: string): string | null {
  const normalized = normalizeLink(value);
  if (!normalized) return null;
  const u = new URL(normalized);
  return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

/** Provisional candidate homepage only; never an approval or inferred ownership claim. */
export function publicationHome(value: string): string | null {
  const normalized = normalizeLink(value);
  if (!normalized) return null;
  const u = new URL(normalized);
  const host = u.hostname.replace(/^www\./, '');
  if ([...IGNORED_HOSTS].some((ignored) => host === ignored || host.endsWith(`.${ignored}`))) return null;
  const segments = u.pathname.split('/').filter(Boolean);
  if (host === 'medium.com') {
    const owner = segments[0];
    if (!owner || RESERVED_MEDIUM.has(owner.toLowerCase()) || /%2f|%5c/i.test(owner)) return null;
    // Medium article-only UUID paths cannot establish a publication identity.
    if (!owner.startsWith('@') && /-[0-9a-f]{8,}$/i.test(owner)) return null;
    return `${u.origin}/${owner}`;
  }
  if (host === 'vocus.cc') return segments[0] === 'salon' && segments[1] ? `${u.origin}/salon/${segments[1]}` : null;
  if (host === 'blog.udn.com')
    return segments[0] && !['article', 'blog', 'index.jsp'].includes(segments[0]) ? `${u.origin}/${segments[0]}` : null;
  if (PLATFORM_ROOTS.has(host)) return null;
  if (host === 'observe.tw' || host.endsWith('.observe.tw')) return null;
  return `${u.origin}/`;
}

export type PublicationAlias = { blogId: number; url: string };
export function resolvePublication(value: string, aliases: PublicationAlias[]): number | null {
  const target = identityKey(value);
  if (!target) return null;
  let result: number | null = null;
  let length = -1;
  for (const alias of aliases) {
    const key = identityKey(alias.url);
    if (!key || key.includes('?')) continue;
    if ((target === key || target.startsWith(`${key}/`) || target.startsWith(`${key}?`)) && key.length > length) {
      // Platform root aliases are never allowed to swallow personal publications.
      if (!publicationHome(alias.url)) continue;
      result = alias.blogId;
      length = key.length;
    } else if (key.length === length && (target === key || target.startsWith(`${key}/`)) && result !== alias.blogId) result = null;
  }
  return result;
}
