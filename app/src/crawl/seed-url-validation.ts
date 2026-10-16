import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { publicationDecision } from '../relations/identity.ts';
import { type FeedCrawlerOptions, type FeedLink, isAllowedCrawlUrl, politeFetch, rankedSitemapUrls, readFeedBody } from './feed.ts';

export type SeedResearchEvidence = { alias: string; sourceUrl: string; excerpt: string };
export type SeedUrlInput = {
  id: number;
  name: string;
  url: string;
  sourceUrls?: string[];
  aliases?: string[];
  researchEvidence?: SeedResearchEvidence[];
};
export type SeedSourceCheck = { url: string; finalUrl?: string; status?: number; type?: FeedLink['type']; reason: string };
export type SeedUrlValidation = {
  id: number;
  inputUrl: string;
  finalUrl: string | null;
  validated: boolean;
  reason: string;
  title: string;
  siteName: string;
  author: string;
  feedSources: FeedLink[];
  evidence: {
    checkedAt: string;
    homepageStatus: number | null;
    homepageSha256: string | null;
    identityMatches: string[];
    sourceChecks: SeedSourceCheck[];
    researchEvidence: SeedResearchEvidence[];
  };
};
export type SeedValidationOptions = FeedCrawlerOptions & { maxSourceRequests?: number; requireSyndication?: boolean; now?: () => Date };

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const domainPattern = /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
const genericNames = new Set([
  'blog',
  'blogs',
  'blogger',
  'wordpress',
  'medium',
  'substack',
  'taiwan',
  'life',
  'travel',
  'food',
  'official',
  'kitchen',
  'diary',
  'diaries',
  'note',
  'notes',
  'photo',
  'photos',
  'photography',
  'lifestyle',
  'travels',
  'travelogue',
  'journal',
  'journals',
  'recipe',
  'recipes',
  'cooking',
  'home',
  'homepage',
  'website',
  'personal',
  'daily',
  'happy',
  'happyday',
  '日記',
  '筆記',
  '手記',
  '隨筆',
  '攝影',
  '照片',
  '廚房',
  '料理',
  '食譜',
  '小資',
  '旅行',
  '旅行日記',
  '旅遊日記',
  '生活日記',
  '生活筆記',
  '美食筆記',
  '旅遊筆記',
  '攝影日記',
  '心情日記',
  '心情隨筆',
  '個人部落格',
  '官方網站',
  '美食旅遊',
  '部落格',
  '個人',
  '網站',
  '首頁',
  '官方',
  '生活',
  '旅遊',
  '美食',
  '台灣',
  '臺灣',
  '痞客邦',
  '隨意窩',
]);
const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const summary = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500);
const sameHost = (a: string, b: string) => new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
const platformHosts = new Set([
  'blogger.com',
  'blogspot.com',
  'wordpress.com',
  'pixnet.net',
  'medium.com',
  'substack.com',
  'vocus.cc',
  'tumblr.com',
  'xuite.net',
  'wixsite.com',
  'weebly.com',
  'matters.town',
  'matters.news',
  'hackmd.io',
  'note.com',
  'note.mu',
  'home.gamer.com.tw',
  'blog.udn.com',
]);

/** Shared platforms need an author subdomain or their known publication path. */
export function isSeedPlatformRoot(value: string): boolean {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!platformHosts.has(host)) return false;
  if (
    ['substack.com', 'matters.town', 'matters.news', 'hackmd.io', 'note.com', 'note.mu', 'home.gamer.com.tw', 'blog.udn.com'].includes(host)
  )
    return !publicationDecision(value).home;
  if (host === 'medium.com')
    return !/^\/(?:@[\w.-]+|[\w-]+)(?:\/|$)/.test(url.pathname) || /^\/(?:about|membership|topics|tag|search)(?:\/|$)/.test(url.pathname);
  if (host === 'vocus.cc') return !/^\/(?:salon|user)\/[^/]+/.test(url.pathname);
  // A category/article path on a platform root does not identify a publication.
  return true;
}

function distinctToken(token: string): boolean {
  return !genericNames.has(token) && (/\p{Script=Han}/u.test(token) ? token.length >= 2 : token.length >= 4);
}

function identityParts(name: string): { full: string | null; tokens: string[] } {
  const withoutDomains = name.replace(domainPattern, ' ');
  const words = withoutDomains
    .split(/[\s|｜,，/／:：()（）\-—–]+/u)
    .map(normalized)
    .filter(Boolean);
  const tokens = [...new Set(words.filter(distinctToken))];
  const full = normalized(withoutDomains);
  // Joining generic words must not manufacture a supposedly unique identity.
  return { full: tokens.length && distinctToken(full) ? full : null, tokens };
}

function identityTokens(name: string): string[] {
  const { full, tokens } = identityParts(name);
  return [...new Set([...(full ? [full] : []), ...tokens])];
}

function isCommentsSource(value: string): boolean {
  const url = new URL(value);
  return /(?:^|\/)comments?(?:\/|$)/i.test(url.pathname) || /^comments?(?:-|$)/i.test(url.searchParams.get('feed') || '');
}

function safeEvidence(input: SeedUrlInput, finalUrl: string): SeedResearchEvidence[] {
  return (input.researchEvidence ?? [])
    .filter((item) => {
      if (!input.aliases?.includes(item.alias) || !identityTokens(item.alias).length || !isAllowedCrawlUrl(item.sourceUrl)) return false;
      if (!normalized(item.excerpt).includes(normalized(item.alias))) return false;
      // Research aliases are explicit provenance, never an unsubstantiated override.
      return (
        sameHost(item.sourceUrl, finalUrl) ||
        sameHost(item.sourceUrl, input.url) ||
        normalized(item.excerpt).includes(normalized(input.name))
      );
    })
    .map((item) => ({ alias: summary(item.alias), sourceUrl: item.sourceUrl.slice(0, 2048), excerpt: summary(item.excerpt) }))
    .slice(0, 10);
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('robots disallow')) return 'robots_disallowed';
  if (message.includes('unsafe crawl') || message.includes('validated DNS')) return 'unsafe_destination';
  if (message.includes('exceeds')) return 'response_too_large';
  if (/timeout|aborted/i.test(message)) return 'timeout';
  return 'fetch_failed';
}

function absolute(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    url.hash = '';
    return isAllowedCrawlUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

function candidates(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const result: string[] = [];
  const add = (value: string) => {
    const url = absolute(value, base);
    if (url && !isCommentsSource(url) && !result.includes(url)) result.push(url);
  };
  $('link[rel~="alternate"], link[rel~="feed"], link[rel~="sitemap"], link[rel~="index"]').each((_, element) => {
    const type = ($(element).attr('type') || '').toLowerCase();
    if (/rss|atom|xml/.test(type) || $(element).attr('rel') === 'sitemap') add($(element).attr('href') || '');
  });
  // Publication paths on shared platforms must not fall back to the platform's feeds.
  const url = new URL(base);
  const rootPlatform = platformHosts.has(url.hostname.replace(/^www\./, ''));
  if (url.hostname === 'medium.com' && url.pathname !== '/') add(`/feed${url.pathname.replace(/\/$/, '')}`);
  const prefix = rootPlatform ? `${url.pathname.replace(/\/$/, '')}/` : '/';
  for (const path of [
    'feed/',
    'feed.xml',
    'rss.xml',
    'atom.xml',
    // Hugo's default feed, often not advertised in the page head (hshuang.com, eddielv.com).
    'index.xml',
    'sitemap.xml',
    'sitemap_index.xml',
    'wp-sitemap.xml',
    'feeds/posts/default',
  ])
    add(`${prefix}${path}`);
  return result;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const array = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
type SourceInfo = { type: FeedLink['type']; indexUrls?: string[]; identityUrls: string[]; comments?: boolean };
function sourceInfo(xml: string, finalUrl: string): SourceInfo | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return null;
  const root = record(parser.parse(xml));
  if (!root) return null;
  const channel = record(record(root.rss)?.channel);
  if (channel && typeof channel.title === 'string' && channel.title.trim()) {
    return {
      type: 'rss',
      identityUrls: array(channel.link).flatMap((link) => {
        if (typeof link === 'string') return [link];
        const object = record(link);
        return object && (!object['@_rel'] || object['@_rel'] === 'alternate') && typeof object['@_href'] === 'string'
          ? [object['@_href']]
          : [];
      }),
      comments: /^(?:comments? (?:on|for)\b)|comments? feed|(?:留言|評論)(?:摘要|訂閱|回應|feed)/i.test(channel.title),
    };
  }
  const feed = record(root.feed);
  if (
    feed &&
    typeof feed.title === 'string' &&
    feed.title.trim() &&
    /xmlns(?::[\w-]+)?\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/.test(xml)
  ) {
    const links = array(feed.link)
      .map(record)
      .filter((link) => link && (!link['@_rel'] || link['@_rel'] === 'alternate'));
    return { type: 'atom', identityUrls: links.map((link) => String(link?.['@_href'] || '')).filter(Boolean) };
  }
  const sitemap = record(root.urlset ?? root.sitemapindex);
  if (!sitemap) return null;
  const urls = array(sitemap.url ?? sitemap.sitemap)
    .map((entry) => record(entry)?.loc)
    .filter((loc): loc is string => typeof loc === 'string')
    .map((loc) => absolute(loc, finalUrl))
    .filter((url): url is string => Boolean(url));
  if (!urls.length) return null;
  return { type: 'sitemap', ...(root.sitemapindex ? { indexUrls: urls } : {}), identityUrls: root.urlset ? urls : [] };
}

function inPublication(value: string, home: string): boolean {
  const resolved = absolute(value, home);
  if (!resolved || !sameHost(resolved, home)) return false;
  const homepage = new URL(home);
  if (homepage.hostname === 'home.gamer.com.tw')
    return (
      Boolean(homepage.searchParams.get('owner')) && new URL(resolved).searchParams.get('owner') === homepage.searchParams.get('owner')
    );
  const path = homepage.pathname.replace(/\/$/, '');
  if (!platformHosts.has(homepage.hostname.replace(/^www\./, ''))) return true;
  const checkedPath = new URL(resolved).pathname.replace(/\/$/, '');
  return checkedPath === path || checkedPath.startsWith(`${path}/`);
}

function sourceInScope(info: SourceInfo, feedUrl: string, home: string): boolean {
  if (info.identityUrls.length) return info.identityUrls.some((url) => inPublication(url, home));
  // Off-domain hosts (e.g. Feedburner) must explicitly identify this publication.
  return !platformHosts.has(new URL(home).hostname.replace(/^www\./, '')) && sameHost(feedUrl, home);
}

/** Read-only validation; all network requests retain the crawler's DNS pin, robots and size limits. */
export async function validateSeedUrl(input: SeedUrlInput, options: SeedValidationOptions = {}): Promise<SeedUrlValidation> {
  const result: SeedUrlValidation = {
    id: input.id,
    inputUrl: input.url,
    finalUrl: null,
    validated: false,
    reason: 'invalid_url',
    title: '',
    siteName: '',
    author: '',
    feedSources: [],
    evidence: {
      checkedAt: (options.now?.() ?? new Date()).toISOString(),
      homepageStatus: null,
      homepageSha256: null,
      identityMatches: [],
      sourceChecks: [],
      researchEvidence: [],
    },
  };
  if (!isAllowedCrawlUrl(input.url)) return result;
  if (isSeedPlatformRoot(input.url)) {
    result.reason = 'platform_root';
    return result;
  }
  let html: string;
  try {
    const response = await politeFetch(input.url, { accept: 'text/html,application/xhtml+xml;q=0.9' }, options);
    result.finalUrl = response.url || input.url;
    result.evidence.homepageStatus = response.status;
    if (!response.ok) {
      result.reason = `homepage_http_${response.status}`;
      return result;
    }
    if (isSeedPlatformRoot(result.finalUrl)) {
      result.reason = 'platform_root';
      return result;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      result.reason = 'homepage_not_html';
      return result;
    }
    html = await response.text();
    result.evidence.homepageSha256 = createHash('sha256').update(html).digest('hex');
  } catch (error) {
    result.reason = errorCode(error);
    return result;
  }
  const $ = cheerio.load(html);
  result.title = summary($('title').first().text());
  result.siteName = summary($('meta[property="og:site_name"]').first().attr('content') || '');
  result.author = summary($('meta[name="author"]').first().attr('content') || $('[rel="author"]').first().text());
  if (
    /^(?:just a moment|attention required|access denied|page not found|404\b|domain for sale|buy this domain|this domain is for sale|parked domain)/i.test(
      result.title,
    ) ||
    /(?:網域出售|網站已關閉|網站建置中)/.test(result.title) ||
    $('#challenge-running, #cf-challenge-running, form#challenge-form').length
  ) {
    result.reason = 'homepage_unavailable_or_parked';
    return result;
  }
  result.evidence.researchEvidence = safeEvidence(input, result.finalUrl);
  const acrossHosts = !sameHost(input.url, result.finalUrl);
  const seedIdentity = identityParts(input.name);
  // Domain moves need a complete brand identity, never a convenient subword.
  // Curated research aliases remain exact aliases rather than extra weak tokens.
  const seedTokens = acrossHosts ? (seedIdentity.full ? [seedIdentity.full] : []) : identityTokens(input.name);
  const aliasTokens = result.evidence.researchEvidence
    .map((item) => identityParts(item.alias).full)
    .filter((token): token is string => Boolean(token));
  const tokens = [...seedTokens, ...aliasTokens];
  const identities = [result.title, result.siteName, result.author].map(normalized);
  result.evidence.identityMatches = [...new Set(tokens.filter((token) => identities.some((identity) => identity.includes(token))))];
  // A listing named by its own domain (「Wiwi.Blog」) has no words left once domains are stripped. It is confirmed
  // only on that same host, when the homepage also names itself by that domain (「官大為的部落格 | Wiwi.Blog」).
  const host = new URL(result.finalUrl).hostname.replace(/^www\./, '').toLowerCase();
  const namedDomain = input.name
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  if (
    !result.evidence.identityMatches.length &&
    !acrossHosts &&
    namedDomain === host &&
    [result.title, result.siteName, result.author].some((value) => value.toLowerCase().includes(host))
  )
    result.evidence.identityMatches = [host];
  if (!result.evidence.identityMatches.length) {
    result.reason = 'identity_not_confirmed';
    return result;
  }
  const limit = Math.max(1, Math.min(12, Math.trunc(options.maxSourceRequests ?? 8)));
  // Research hints are only priorities, never evidence: validate their scope and XML below.
  const hints = (input.sourceUrls ?? []).slice(0, 4).filter((url) => isAllowedCrawlUrl(url) && inPublication(url, result.finalUrl!));
  const queue = [...hints, ...candidates(html, result.finalUrl)];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length && seen.size < limit; index += 1) {
    const url = queue[index];
    if (seen.has(url)) continue;
    seen.add(url);
    const check: SeedSourceCheck = { url, reason: 'fetch_failed' };
    result.evidence.sourceChecks.push(check);
    try {
      const response = await politeFetch(url, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' }, options);
      check.finalUrl = response.url || url;
      check.status = response.status;
      if (!response.ok) {
        check.reason = `http_${response.status}`;
        continue;
      }
      const xml = await readFeedBody(response);
      const info = sourceInfo(xml, check.finalUrl);
      if (!info) {
        check.reason = 'not_a_feed_or_sitemap';
        continue;
      }
      if (info.comments || isCommentsSource(check.finalUrl)) {
        check.reason = 'comments_feed';
        continue;
      }
      if (options.requireSyndication && info.type === 'sitemap') {
        check.reason = 'syndication_required';
        continue;
      }
      if (info.indexUrls) {
        const children = rankedSitemapUrls(info.indexUrls)
          .filter((childUrl) => inPublication(childUrl, result.finalUrl!) && !seen.has(childUrl))
          .slice(0, Math.max(0, limit - seen.size));
        if (children.length) queue.splice(index + 1, 0, ...children);
        check.reason = children.length ? 'sitemap_index_follow_child' : 'sitemap_index_without_scoped_child';
        continue;
      }
      if (!sourceInScope(info, check.finalUrl, result.finalUrl)) {
        check.reason = 'source_outside_publication';
        continue;
      }
      check.type = info.type;
      check.reason = 'valid_xml_source';
      result.feedSources.push({ url: check.finalUrl, type: info.type });
      result.validated = true;
      result.reason = 'verified_identity_and_source';
      return result;
    } catch (error) {
      check.reason = errorCode(error);
    }
  }
  result.reason = 'no_verified_feed_or_sitemap';
  return result;
}
