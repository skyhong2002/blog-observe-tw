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
  'matters.town',
  'matters.news',
  'hackmd.io',
  'note.com',
  'note.mu',
  'home.gamer.com.tw',
]);
const PATH_PLATFORMS = new Set([
  'medium.com',
  'vocus.cc',
  'blog.udn.com',
  'matters.town',
  'matters.news',
  'hackmd.io',
  'note.com',
  'note.mu',
  'substack.com',
  'home.gamer.com.tw',
]);
const SHORTENERS = new Set([
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'reurl.cc',
  'pse.is',
  'lihi.cc',
  'lihi1.com',
  'lihi2.com',
  'lihi3.com',
  'shorturl.at',
  'is.gd',
  'v.gd',
  'cutt.ly',
  'rb.gy',
  'buff.ly',
  'ow.ly',
  's.id',
  'url.tw',
  'supr.link',
  'bit.do',
  'short.io',
  'lnkd.in',
]);
const NON_PUBLICATIONS = new Set([
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'threads.net',
  'threads.com',
  'line.me',
  'lin.ee',
  'google.com',
  'amazon.com',
  'shopee.tw',
  'wikipedia.org',
  'reddit.com',
  'ptt.cc',
  'dcard.tw',
  'plurk.com',
  'linkedin.com',
  'pinterest.com',
  'bsky.app',
  'news.google.com',
  'news.yahoo.com',
  'tw.news.yahoo.com',
  'udn.com',
  'ltn.com.tw',
  'ettoday.net',
  'chinatimes.com',
  'cna.com.tw',
  'storm.mg',
  'setn.com',
  'tvbs.com.tw',
  'thenewslens.com',
  'cw.com.tw',
  'businessweekly.com.tw',
  'businesstoday.com.tw',
  'technews.tw',
  'moneydj.com',
  'rti.org.tw',
  'bbc.com',
  'bbc.co.uk',
  'cnn.com',
  'reuters.com',
  'apnews.com',
  'nytimes.com',
  'theguardian.com',
  'msn.com',
  'feedly.com',
  'inoreader.com',
  'flipboard.com',
  'github.com',
  'linktr.ee',
  'books.com.tw',
  'spotify.com',
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
const RESERVED_NOTE = new Set([
  '',
  'about',
  'explore',
  'search',
  'topics',
  'contest',
  'info',
  'settings',
  'login',
  'signup',
  'terms',
  'privacy',
  'hashtag',
  'api',
  'i',
  'n',
  'magazines',
  'notemag',
  'note',
]);
const matchesHost = (host: string, set: Set<string>) => [...set].some((root) => host === root || host.endsWith(`.${root}`));
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
export function identityKey(value: string): string | null {
  const n = normalizeLink(value);
  if (!n) return null;
  const u = new URL(n);
  if (u.hostname === 'home.gamer.com.tw') {
    const owner = u.searchParams.get('owner');
    if (owner && /^[A-Za-z0-9_-]{1,64}$/.test(owner)) return `home.gamer.com.tw/@${owner}`;
  }
  return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}
export type PublicationDecision = {
  home: string | null;
  reason:
    | 'publication-home'
    | 'unsafe-url'
    | 'shortener-unresolved'
    | 'non-publication-host'
    | 'platform-root'
    | 'platform-owner-unresolved';
};
/** Explicit platform ownership; unknown article IDs are never collapsed to a platform root. */
export function publicationDecision(value: string): PublicationDecision {
  const n = normalizeLink(value);
  if (!n) return { home: null, reason: 'unsafe-url' };
  const u = new URL(n),
    host = u.hostname.replace(/^www\./, '');
  if (matchesHost(host, SHORTENERS)) return { home: null, reason: 'shortener-unresolved' };
  // blog.udn.com has owner paths, unlike the news publication on its parent domain.
  if (host !== 'blog.udn.com' && (matchesHost(host, NON_PUBLICATIONS) || host === 'observe.tw' || host.endsWith('.observe.tw')))
    return { home: null, reason: 'non-publication-host' };
  const s = u.pathname.split('/').filter(Boolean);
  let path: string | null = null;
  const safeOwner = (owner: string | undefined) => !!owner && /^[\p{L}\p{N}_@.-]{1,100}$/u.test(owner) && !['.', '..'].includes(owner);
  if (host === 'medium.com') {
    if (safeOwner(s[0]) && !RESERVED_MEDIUM.has(s[0].toLowerCase()) && !(!s[0].startsWith('@') && /-[0-9a-f]{8,}$/i.test(s[0])))
      path = `/${s[0]}`;
  } else if (host === 'vocus.cc') {
    if (['salon', 'user'].includes(s[0]) && safeOwner(s[1])) path = `/${s[0]}/${s[1]}`;
  } else if (host === 'blog.udn.com') {
    if (safeOwner(s[0]) && !['article', 'blog', 'index.jsp'].includes(s[0])) path = `/${s[0]}`;
  } else if (['matters.town', 'matters.news', 'hackmd.io', 'substack.com'].includes(host)) {
    if (safeOwner(s[0]) && s[0].startsWith('@') && s[0].length > 1) path = `/${s[0]}`;
  } else if (host === 'home.gamer.com.tw') {
    const owner = u.searchParams.get('owner');
    if (owner && /^[A-Za-z0-9_-]{1,64}$/.test(owner))
      return { home: `${u.origin}/homeindex.php?owner=${owner}`, reason: 'publication-home' };
  } else if (['note.com', 'note.mu'].includes(host)) {
    if (safeOwner(s[0]) && !RESERVED_NOTE.has(s[0].toLowerCase())) path = `/${s[0]}`;
  }
  if (PATH_PLATFORMS.has(host))
    return path
      ? { home: `${u.origin}${path}`, reason: 'publication-home' }
      : { home: null, reason: s.length ? 'platform-owner-unresolved' : 'platform-root' };
  if (PLATFORM_ROOTS.has(host)) return { home: null, reason: 'platform-root' };
  return { home: `${u.origin}/`, reason: 'publication-home' };
}
export function publicationHome(value: string): string | null {
  return publicationDecision(value).home;
}
export type PublicationAlias = { blogId: number; url: string; scope?: 'exact-url' | 'publication-prefix' };
export type PublicationResolver = { resolve: (value: string) => number | null };
/** Compile URL/host/path keys once per crawl batch, not once per anchor × alias. */
export function compilePublicationAliases(aliases: PublicationAlias[]): PublicationResolver {
  const hosts = new Map<string, Map<string, number | null>>();
  const exact = new Map<string, number | null>();
  for (const alias of aliases) {
    if (!Number.isSafeInteger(alias.blogId) || alias.blogId < 1) continue;
    if (alias.scope === 'exact-url') {
      // A redirect proves one URL, not its publication owner. identityKey may
      // intentionally collapse article paths/IDs on owner-based platforms.
      const key = normalizeLink(alias.url);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, alias.blogId);
      else if (exact.get(key) !== alias.blogId) exact.set(key, null);
      continue;
    }
    const key = identityKey(alias.url);
    if (!key || key.includes('?') || !publicationHome(alias.url)) continue;
    const slash = key.indexOf('/'),
      host = slash < 0 ? key : key.slice(0, slash),
      path = slash < 0 ? '' : key.slice(slash);
    let paths = hosts.get(host);
    if (!paths) {
      paths = new Map();
      hosts.set(host, paths);
    }
    if (!paths.has(path)) paths.set(path, alias.blogId);
    else if (paths.get(path) !== alias.blogId) paths.set(path, null);
  }
  const prefix = (key: string): { matched: boolean; blogId: number | null } => {
    const q = key.indexOf('?'),
      clean = q < 0 ? key : key.slice(0, q),
      slash = clean.indexOf('/'),
      host = slash < 0 ? clean : clean.slice(0, slash);
    let path = slash < 0 ? '' : clean.slice(slash);
    const paths = hosts.get(host);
    if (!paths) return { matched: false, blogId: null };
    while (true) {
      if (paths.has(path)) return { matched: true, blogId: paths.get(path) ?? null };
      if (!path) return { matched: false, blogId: null };
      const at = path.lastIndexOf('/');
      path = at <= 0 ? '' : path.slice(0, at);
    }
  };
  return {
    resolve(value) {
      const exactKey = normalizeLink(value);
      if (!exactKey) return null;
      const key = identityKey(exactKey);
      if (!key) return null;
      const owner = prefix(key);
      if (exact.has(exactKey)) {
        const blogId = exact.get(exactKey) ?? null;
        return owner.matched && owner.blogId !== blogId ? null : blogId;
      }
      return owner.blogId;
    },
  };
}
const resolverCache = new WeakMap<PublicationAlias[], PublicationResolver>();
export function resolvePublication(value: string, aliases: PublicationAlias[] | PublicationResolver): number | null {
  if (!Array.isArray(aliases)) return aliases.resolve(value);
  let resolver = resolverCache.get(aliases);
  if (!resolver) {
    resolver = compilePublicationAliases(aliases);
    resolverCache.set(aliases, resolver);
  }
  return resolver.resolve(value);
}
