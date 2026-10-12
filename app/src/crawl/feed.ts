import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Pool } from 'mysql2/promise';
import { Agent, type Dispatcher, fetch as undiciFetch } from 'undici';

export type FeedSourceType = 'rss' | 'atom' | 'sitemap';
export type FeedLink = { url: string; type: FeedSourceType };
export type FeedEntry = {
  guid: string;
  url: string;
  title: string;
  summary: string;
  author: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  imageUrl: string | null;
  categories: string[];
};
export type BlogToCrawl = { id: number; slug: string; url: string };
export type HostResolver = (hostname: string) => Promise<string[]>;
export type FeedFetcher = (input: Parameters<typeof fetch>[0], init?: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;
export type FeedCrawlerOptions = {
  userAgent?: string;
  delayMs?: number;
  timeoutMs?: number;
  /** Test seams; production resolves once and pins each request to those addresses. */
  resolveHost?: HostResolver;
  fetcher?: FeedFetcher;
  historyImport?: boolean;
};

const DEFAULT_USER_AGENT = 'blog.observe.tw/1.0 (+https://blog.observe.tw/about; mailto:b@blog.observe.tw)';
export const USER_AGENT = process.env.BLOG_CRAWL_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  removeNSPrefix: true,
  parseTagValue: false,
});
const hostNextAt = new Map<string, number>();
const robotsCache = new Map<string, { expiresAt: number; disallow: string[] }>();
const DEFAULT_DELAY_MS = Math.max(250, Number(process.env.BLOG_CRAWL_DELAY_MS || 1200));
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Read XML fetched through politeFetch. Some sitemap.xml.gz files have no Content-Encoding.
 * Detect bytes instead of the URL/header, because fetch already decompresses HTTP content encodings. */
export async function readFeedBody(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error(`crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.toString('utf8');
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_RESPONSE_BYTES }).toString('utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
      throw new Error(`decompressed crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    throw new Error('invalid gzip feed response');
  }
}

const asArray = <T>(value: T | T[] | null | undefined): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
const textOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return textOf(object.__cdata ?? object['#text'] ?? object['@_href'] ?? object.href ?? object.text ?? '');
  }
  return '';
};
const absolute = (value: unknown, base: string): string | null => {
  try {
    const url = new URL(textOf(value), base);
    return isAllowedCrawlUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
};
const dateOf = (value: unknown): Date | null => {
  const date = new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const shortHash = (value: string) => createHash('sha256').update(value).digest('hex');
const hostnameOf = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '');

const ipv4Parts = (value: string): number[] | null => {
  if (isIP(value) !== 4) return null;
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
};

const ipv6Value = (value: string): bigint | null => {
  if (isIP(value) !== 6) return null;
  const input = value.toLowerCase().split('%', 1)[0];
  const [leftRaw, rightRaw] = input.split('::');
  if (input.split('::').length > 2) return null;
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const parts = [...left, ...right];
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - parts.length;
  if (missing < 0 || (!input.includes('::') && missing !== 0)) return null;
  const expanded = input.includes('::') ? [...left, ...Array.from({ length: missing }, () => '0'), ...right] : parts;
  return expanded.reduce((result, part) => (result << 16n) + BigInt(`0x${part}`), 0n);
};

// CIDR boundaries verified against https://www.iana.org/assignments/iana-ipv4-special-registry/
// Do not reject all 192.0/16: public WordPress hosts use 192.0.78/24.
const ipv4Blocked = (value: string): boolean => {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const ipv6Blocked = (value: string): boolean => {
  // Only ordinary global unicast is eligible. This deliberately excludes all
  // mapped/compatible IPv4, NAT64, local, scoped, multicast and reserved space.
  // Special ranges: https://www.iana.org/assignments/iana-ipv6-special-registry/
  if (value.includes('%')) return true;
  const numeric = ipv6Value(value);
  if (numeric === null || numeric >> 125n !== 1n) return true; // 2000::/3
  const inPrefix = (prefix: bigint, length: number) => numeric >> BigInt(128 - length) === prefix >> BigInt(128 - length);
  return (
    inPrefix(0x20010000000000000000000000000000n, 23) || // IETF protocol assignments, including Teredo/ORCHID
    inPrefix(0x20010db8000000000000000000000000n, 32) || // Documentation
    inPrefix(0x20020000000000000000000000000000n, 16) || // 6to4 embeds an IPv4 destination
    inPrefix(0x3fff0000000000000000000000000000n, 20) // Documentation
  );
};

export const isBlockedAddress = (value: string): boolean =>
  isIP(value) === 4 ? ipv4Blocked(value) : isIP(value) === 6 ? ipv6Blocked(value) : true;

/** Synchronous URL gate used while parsing links. Hostnames are resolved again before every request. */
export function isAllowedCrawlUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const defaultPort = url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '';
    if (!defaultPort || (url.port && url.port !== defaultPort) || url.username || url.password || !url.hostname) return false;
    const hostname = hostnameOf(url);
    return isIP(hostname) === 0 || !isBlockedAddress(hostname);
  } catch {
    return false;
  }
}

const defaultResolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

type CrawlTarget = { url: URL; addresses: Array<{ address: string; family: number }> };

/** Resolve once; reject the entire answer set if any address is non-public. */
async function resolveCrawlTarget(value: string, resolveHost: HostResolver): Promise<CrawlTarget> {
  if (!isAllowedCrawlUrl(value)) throw new Error(`unsafe crawl URL: ${value}`);
  const url = new URL(value);
  const hostname = hostnameOf(url);
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some((address) => isBlockedAddress(address))) throw new Error(`unsafe crawl address: ${hostname}`);
  return { url, addresses: addresses.map((address) => ({ address, family: isIP(address) })) };
}

/** Validation-only API. Network requests use the resolved addresses below, not a second DNS lookup. */
export async function validateCrawlUrl(value: string, resolveHost: HostResolver = defaultResolveHost): Promise<URL> {
  return (await resolveCrawlTarget(value, resolveHost)).url;
}

function pinnedLookup(target: CrawlTarget): LookupFunction {
  const hostname = hostnameOf(target.url);
  return (requested, options, callback) => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const matches = target.addresses.filter((entry) => !family || entry.family === family);
    if (requested !== hostname || !matches.length) {
      callback(Object.assign(new Error('crawl connection target does not match validated DNS'), { code: 'ENOTFOUND' }), []);
      return;
    }
    // Node's autoSelectFamily requests all addresses. Never fall back to the
    // system resolver, including when the requested family is unavailable.
    if (options.all)
      callback(
        null,
        matches.map((entry) => ({ ...entry })),
      );
    else callback(null, matches[0].address, matches[0].family);
  };
}

async function pinnedFetch(target: CrawlTarget, headers: Record<string, string>, timeoutMs: number, fetcher: FeedFetcher) {
  // A request-scoped dispatcher prevents pooled connections from crossing a
  // validation boundary. Keep the URL hostname for HTTP Host and TLS SNI/name
  // verification; only socket DNS lookup is replaced with the validated set.
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(target), timeout: timeoutMs }, connections: 1, maxOrigins: 1 });
  try {
    const response = await fetcher(target.url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    });
    return await limitedResponse(response, target.url.toString());
  } finally {
    // limitedResponse consumes/cancels the body before this runs. Destroy
    // instead of graceful close so failures/aborts cannot leave idle sockets.
    await dispatcher.destroy().catch(() => undefined);
  }
}

async function limitedResponse(response: Response, requestedUrl: string): Promise<Response> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) {
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    const empty = new Response(null, { status: response.status, statusText: response.statusText, headers });
    Object.defineProperty(empty, 'url', { value: response.url || requestedUrl });
    return empty;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error(`crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  // undici fetch has already decompressed the body; compressed wire headers are no longer valid.
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  const buffered = new Response(body.length ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  // Consumers resolve relative feed/icon links against the final response URL.
  Object.defineProperty(buffered, 'url', { value: response.url || requestedUrl });
  return buffered;
}

function robotsRules(text: string, userAgent: string): string[] {
  const wanted = userAgent.toLowerCase().split(/[\s/]/)[0];
  let agents: string[] = [];
  const rules: string[] = [];
  let active = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) {
      agents = [];
      active = false;
      continue;
    }
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === 'user-agent') {
      agents.push(value.toLowerCase());
      active = agents.includes('*') || agents.some((agent) => agent && wanted.includes(agent));
    } else if (key === 'disallow' && active && value) {
      rules.push(value);
    }
  }
  return [...new Set(rules)];
}

async function robotsAllows(
  url: string,
  userAgent: string,
  timeoutMs: number,
  resolveHost: HostResolver,
  fetcher: FeedFetcher,
): Promise<boolean> {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const cached = robotsCache.get(origin);
  let disallow = cached && cached.expiresAt > Date.now() ? cached.disallow : null;
  if (!disallow) {
    try {
      let robotsUrl = `${origin}/robots.txt`;
      let response: Response = new Response(null, { status: 503 });
      for (let hop = 0; hop <= 5; hop += 1) {
        const target = await resolveCrawlTarget(robotsUrl, resolveHost);
        response = await pinnedFetch(target, { 'user-agent': userAgent, accept: 'text/plain' }, timeoutMs, fetcher);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location) break;
        robotsUrl = new URL(location, robotsUrl).toString();
        if (hop === 5) throw new Error(`too many robots redirects from ${url}`);
      }
      // A missing robots.txt grants access; an unavailable robots server is
      // treated as disallow to avoid turning a transient outage into a burst.
      if (response.status === 404 || response.status === 410) disallow = [];
      else if (!response.ok) return false;
      else disallow = robotsRules(await response.text(), userAgent);
      robotsCache.set(origin, { expiresAt: Date.now() + 3_600_000, disallow });
    } catch {
      return false;
    }
  }
  return !(disallow ?? []).some((rule) => parsed.pathname.startsWith(rule));
}

/** Every request goes through this gate: one host delay and one robots check. */
export async function politeFetch(
  value: string,
  headers: Record<string, string> = {},
  options: FeedCrawlerOptions = {},
): Promise<Response> {
  const userAgent = options.userAgent?.trim() || USER_AGENT;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const delayMs = Math.max(250, options.delayMs ?? DEFAULT_DELAY_MS);
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  // Agent and fetch must use the same undici version; Node's bundled fetch
  // can use an older dispatcher handler protocol than the installed package.
  const fetcher = options.fetcher ?? (undiciFetch as FeedFetcher);
  let url = new URL(value);
  for (let hop = 0; hop <= 5; hop += 1) {
    const target = await resolveCrawlTarget(url.toString(), resolveHost);
    // Check both the initial URL and every redirect target. This prevents a
    // feed from bypassing robots by bouncing through an unrelated host.
    const host = url.host;
    const wait = (hostNextAt.get(host) ?? 0) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostNextAt.set(host, Date.now() + delayMs);
    if (!(await robotsAllows(url.toString(), userAgent, timeoutMs, resolveHost, fetcher))) throw new Error(`robots disallow ${url}`);
    const response = await pinnedFetch(
      target,
      {
        'user-agent': userAgent,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
        ...headers,
      },
      timeoutMs,
      fetcher,
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = new URL(location, url);
  }
  throw new Error(`too many redirects from ${value}`);
}

function discoverLinks(html: string, baseUrl: string): FeedLink[] {
  const $ = cheerio.load(html);
  const links: FeedLink[] = [];
  $('link[rel~="alternate"], link[rel~="feed"], link[rel~="index"]').each((_, element) => {
    const href = $(element).attr('href');
    const type = ($(element).attr('type') || '').toLowerCase();
    const url = absolute(href, baseUrl);
    if (url && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
      links.push({ url, type: type.includes('atom') ? 'atom' : 'rss' });
    }
  });
  for (const candidate of ['/feed/', '/feed.xml', '/rss.xml', '/atom.xml', '/sitemap.xml']) {
    const url = absolute(candidate, baseUrl);
    const type: FeedSourceType = candidate.includes('sitemap') ? 'sitemap' : candidate.includes('atom') ? 'atom' : 'rss';
    if (url && !links.some((item) => item.url === url)) links.push({ url, type });
  }
  return links;
}

export function parseFeed(xml: string, baseUrl: string): FeedEntry[] {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const channel = (root.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (channel) {
    return asArray(channel.item as unknown)
      .map((item): FeedEntry | null => {
        const object = (item || {}) as Record<string, unknown>;
        const url = absolute(object.link ?? object.guid, baseUrl);
        if (!url) return null;
        return {
          guid: textOf(object.guid || object.link || object.title).slice(0, 1024),
          url,
          title: textOf(object.title) || '未命名文章',
          summary: textOf(object.description || object.encoded || object['content:encoded']),
          author: textOf(object.author || object.creator || object['dc:creator']) || null,
          publishedAt: dateOf(object.pubDate || object.published || object.date),
          updatedAt: dateOf(object.updated || object.pubDate),
          imageUrl: absolute(
            (object.enclosure as Record<string, unknown> | undefined)?.['@_url'] ||
              (object.image as Record<string, unknown> | undefined)?.url,
            baseUrl,
          ),
          categories: asArray(object.category).map(textOf).filter(Boolean).slice(0, 20),
        };
      })
      .filter((item): item is FeedEntry => Boolean(item));
  }
  const atom = root.feed as Record<string, unknown> | undefined;
  if (atom) {
    return asArray(atom.entry as unknown)
      .map((entry): FeedEntry | null => {
        const object = (entry || {}) as Record<string, unknown>;
        const links = asArray(object.link as unknown).map((item) => (item || {}) as Record<string, unknown>);
        const link = links.find((item) => item['@_rel'] === 'alternate') || links[0];
        const url = absolute(link?.['@_href'] || link, baseUrl);
        if (!url) return null;
        return {
          guid: textOf(object.id || link?.['@_href'] || object.title).slice(0, 1024),
          url,
          title: textOf(object.title) || '未命名文章',
          summary: textOf(object.summary || object.content),
          author: textOf((object.author as Record<string, unknown> | undefined)?.name || object.author) || null,
          publishedAt: dateOf(object.published || object.updated),
          updatedAt: dateOf(object.updated || object.published),
          imageUrl: null,
          categories: asArray(object.category).map(textOf).filter(Boolean).slice(0, 20),
        };
      })
      .filter((item): item is FeedEntry => Boolean(item));
  }
  return [];
}

export function parseSitemap(xml: string, baseUrl: string): FeedEntry[] {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  return asArray((root.urlset as Record<string, unknown> | undefined)?.url as unknown)
    .map((item): FeedEntry | null => {
      const object = (item || {}) as Record<string, unknown>;
      const url = absolute(object.loc, baseUrl);
      return url
        ? {
            guid: url,
            url,
            title: url.split('/').filter(Boolean).at(-1) || url,
            summary: '',
            author: null,
            // Sitemap lastmod is a modification hint, not proof of original
            // publication. Keep it out of lastPublishedAt calculations.
            publishedAt: null,
            updatedAt: dateOf(object.lastmod),
            imageUrl: null,
            categories: [],
          }
        : null;
    })
    .filter((item): item is FeedEntry => Boolean(item));
}

const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const schemaArticleTypes = new Set(['Article', 'BlogPosting', 'NewsArticle']);
const cleanMetadata = (value: unknown, max: number): string => textOf(value).replace(/\s+/g, ' ').trim().slice(0, max);

/** A sitemap proves a URL exists, not that it is an article. Never index shop/category URLs by their path alone. */
export function parseSitemapArticle(html: string, candidate: FeedEntry, finalUrl: string): FeedEntry | null {
  const $ = cheerio.load(html);
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content') || '';
  const pageIdentity = (value: string) => {
    const url = new URL(value, finalUrl);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  };
  const articles: Record<string, unknown>[] = [];
  let visited = 0;
  const inspect = (value: unknown) => {
    if (++visited > 128) return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item);
      return;
    }
    const node = objectOf(value);
    if (!node) return;
    const types = asArray(node['@type']).filter((type): type is string => typeof type === 'string');
    const isArticle = types.some((type) => schemaArticleTypes.has(type.replace(/^https?:\/\/schema\.org\//, '')));
    if (isArticle) {
      const declaredUrl = textOf(node.url || node['@id']);
      if (!declaredUrl || pageIdentity(declaredUrl) === pageIdentity(finalUrl)) articles.push(node);
    }
    // Do not inspect ItemList/recommendations/comments: those are other pages.
    if (node['@graph']) inspect(node['@graph']);
    if (node.mainEntity) inspect(node.mainEntity);
  };
  $('script[type="application/ld+json"]')
    .slice(0, 20)
    .each((_, element) => {
      const text = $(element).text();
      if (text.length > 256 * 1024) return;
      try {
        inspect(JSON.parse(text));
      } catch {
        /* A malformed schema block is not article evidence. */
      }
    });
  const article = articles[0];
  if (!article && meta('og:type').toLowerCase() !== 'article') return null;
  const title = cleanMetadata(article?.headline || article?.name || meta('og:title') || $('h1').first().text() || $('title').text(), 512);
  if (!title || /^(?:just a moment|access denied|page not found|404\b)/i.test(title)) return null;
  const author = asArray(article?.author)[0];
  const image = asArray(article?.image)[0];
  const publishedAt = dateOf(article?.datePublished || meta('article:published_time'));
  return {
    ...candidate,
    url: finalUrl,
    title,
    summary: cleanMetadata(article?.description || meta('og:description') || meta('description'), 20_000),
    author: cleanMetadata(objectOf(author)?.name || author || meta('author'), 255) || null,
    publishedAt,
    updatedAt: dateOf(article?.dateModified || meta('article:modified_time')) || candidate.updatedAt,
    imageUrl: textOf(objectOf(image)?.url || objectOf(image)?.contentUrl || image || meta('og:image'))
      ? absolute(objectOf(image)?.url || objectOf(image)?.contentUrl || image || meta('og:image'), finalUrl)
      : null,
    categories: asArray(article?.articleSection)
      .map((value) => cleanMetadata(value, 255))
      .filter(Boolean)
      .slice(0, 20),
  };
}

function sitemapUrlInBlog(value: string, home: string): boolean {
  const url = new URL(value);
  const blog = new URL(home);
  const host = (item: URL) => item.hostname.replace(/^www\./, '');
  if (host(url) !== host(blog)) return false;
  if (!['medium.com', 'vocus.cc', 'xuite.net'].includes(host(blog))) return true;
  const path = blog.pathname.replace(/\/$/, '');
  return url.pathname === path || url.pathname.startsWith(`${path}/`);
}

async function verifySitemapArticles(entries: FeedEntry[], blogUrl: string, options: FeedCrawlerOptions): Promise<FeedEntry[]> {
  const verified: FeedEntry[] = [];
  for (const candidate of entries) {
    if (!sitemapUrlInBlog(candidate.url, blogUrl)) continue;
    try {
      const response = await politeFetch(candidate.url, { accept: 'text/html,application/xhtml+xml' }, options);
      if (!response.ok || !sitemapUrlInBlog(response.url || candidate.url, blogUrl)) continue;
      const contentType = response.headers.get('content-type');
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) continue;
      const article = parseSitemapArticle(await response.text(), candidate, response.url || candidate.url);
      if (article) verified.push(article);
    } catch {
      /* A missing/blocked article does not invalidate other entries or bypass robots. */
    }
  }
  return verified;
}

export async function discoverFeedUrls(blogUrl: string, options: FeedCrawlerOptions = {}): Promise<FeedLink[]> {
  const response = await politeFetch(blogUrl, {}, options);
  if (!response.ok) throw new Error(`homepage ${response.status}`);
  return discoverLinks(await response.text(), blogUrl);
}

type SqlPool = Pick<Pool, 'execute'>;

/** Crawl one blog using the existing schema.  The worker supplies its own
 * pool; no queue, database, or session is shared with sibling services. */
export async function crawlBlog(
  { pool }: { pool: SqlPool },
  blog: BlogToCrawl,
  options: FeedCrawlerOptions = {},
): Promise<{ blog: string; sources: number; posts: number }> {
  const now = new Date();
  let links: FeedLink[];
  try {
    // Verified seed resolution registers publication-specific sources. Reuse
    // those instead of guessing a shared platform's global feed on each run.
    const [registered] = await pool.execute(
      'SELECT url,type FROM feed_sources WHERE blog_id=? AND last_success_at IS NOT NULL ORDER BY id',
      [blog.id],
    );
    const known = Array.isArray(registered) ? (registered as FeedLink[]) : [];
    links = known.filter((source) => ['rss', 'atom', 'sitemap'].includes(source.type) && isAllowedCrawlUrl(source.url));
    if (!links.length) links = await discoverFeedUrls(blog.url, options);
  } catch (error) {
    await pool.execute('UPDATE blogs SET last_crawled_at=? WHERE id=?', [now, blog.id]);
    throw error;
  }
  let total = 0;
  let sourceCount = 0;
  let sitemapBudget = 30;
  for (const source of links) {
    const [savedResult] = await pool.execute('SELECT * FROM feed_sources WHERE url=?', [source.url]);
    const saved = (Array.isArray(savedResult) ? savedResult[0] : null) as { etag?: string; last_modified?: string } | undefined;
    const headers: Record<string, string> = {};
    if (saved?.etag) headers['if-none-match'] = saved.etag;
    if (saved?.last_modified) headers['if-modified-since'] = saved.last_modified;
    let response: Response;
    try {
      response = await politeFetch(source.url, headers, options);
    } catch {
      await pool.execute(
        'INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1',
        [blog.id, source.url, source.type, now],
      );
      continue;
    }
    if (response.status === 304) {
      await pool.execute('UPDATE feed_sources SET last_success_at=?,last_error_at=NULL,consecutive_failures=0 WHERE url=?', [
        now,
        source.url,
      ]);
      sourceCount += 1;
      continue;
    }
    if (!response.ok) {
      await pool.execute(
        'INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1',
        [blog.id, source.url, source.type, now],
      );
      continue;
    }
    let body: string;
    try {
      body = await readFeedBody(response);
    } catch {
      await pool.execute(
        'INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1',
        [blog.id, source.url, source.type, now],
      );
      continue;
    }
    // A 200 HTML error page must not become a successful feed source.
    const xmlValid = !/<!DOCTYPE|<!ENTITY/i.test(body) && XMLValidator.validate(body) === true;
    const parsedRoot = xmlValid ? objectOf(parser.parse(body)) : null;
    const expectedRoot =
      source.type === 'sitemap' ? objectOf(parsedRoot?.urlset) : objectOf(objectOf(parsedRoot?.rss)?.channel) || objectOf(parsedRoot?.feed);
    if (!expectedRoot) {
      await pool.execute('UPDATE feed_sources SET last_error_at=?,consecutive_failures=consecutive_failures+1 WHERE url=? AND blog_id=?', [
        now,
        source.url,
        blog.id,
      ]);
      continue;
    }
    let entries: FeedEntry[];
    if (source.type === 'sitemap') {
      const candidates = parseSitemap(body, response.url || source.url).slice(0, sitemapBudget);
      sitemapBudget -= candidates.length;
      entries = await verifySitemapArticles(candidates, blog.url, options);
    } else entries = parseFeed(body, response.url || source.url);
    await pool.execute(
      'INSERT INTO feed_sources (blog_id,url,type,etag,last_modified,last_success_at,consecutive_failures) VALUES (?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE etag=VALUES(etag),last_modified=VALUES(last_modified),last_success_at=VALUES(last_success_at),consecutive_failures=0',
      [blog.id, source.url, source.type, response.headers.get('etag'), response.headers.get('last-modified'), now],
    );
    sourceCount += 1;
    for (const entry of entries) {
      const title = entry.title.slice(0, 512);
      const summary = entry.summary || '';
      const contentHash = shortHash(`${title}\n${summary}`);
      await pool.execute(
        'INSERT INTO posts (blog_id,guid,url,title,summary,author,published_at,updated_at,image_url,content_hash,source_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE url=VALUES(url),title=VALUES(title),summary=VALUES(summary),author=VALUES(author),published_at=VALUES(published_at),updated_at=VALUES(updated_at),image_url=VALUES(image_url),content_hash=VALUES(content_hash)',
        [
          blog.id,
          entry.guid.slice(0, 1024),
          entry.url.slice(0, 1024),
          title,
          summary || null,
          entry.author,
          entry.publishedAt,
          entry.updatedAt,
          entry.imageUrl,
          contentHash,
          source.type,
          now,
        ],
      );
      // A pen name is resolved within this blog only. Matching names on two
      // sites therefore create two author identities until a human explicitly
      // merges them. Crawler updates never replace manual/community links.
      if (entry.author?.trim()) {
        const displayName = entry.author.trim().slice(0, 255);
        const normalized = displayName.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
        const [existing] = await pool.execute(
          `SELECT a.id FROM authors a JOIN blog_authors ba ON ba.author_id=a.id
           WHERE ba.blog_id=? AND a.normalized_name=? LIMIT 1`,
          [blog.id, normalized],
        );
        let authorId = Array.isArray(existing) && existing[0] ? (existing[0] as { id: number }).id : null;
        if (!authorId) {
          const [result] = await pool.execute(
            `INSERT INTO authors (display_name,normalized_name,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [displayName, normalized, 'crawler', source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now],
          );
          authorId = (result as { insertId: number }).insertId;
        } else {
          await pool.execute(
            "UPDATE authors SET last_seen_at=?,last_published_at=COALESCE(?,last_published_at),updated_at=? WHERE id=? AND source_type NOT IN ('manual','community')",
            [now, entry.publishedAt, now, authorId],
          );
        }
        await pool.execute(
          `INSERT INTO blog_authors (blog_id,author_id,role,status,is_primary,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_seen_at=IF(blog_authors.source_type IN ('manual','community'),blog_authors.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
          [blog.id, authorId, 'author', 'active', false, 'crawler', source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now],
        );
        await pool.execute(
          `INSERT INTO post_authors (post_id,author_id,position,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT id,?,?,?,?,?,?,?,?,? FROM posts WHERE blog_id=? AND guid=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(post_authors.source_type IN ('manual','community'),post_authors.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
          [
            authorId,
            0,
            'crawler',
            source.url,
            JSON.stringify({ guid: entry.guid }),
            now,
            now,
            now,
            now,
            blog.id,
            entry.guid.slice(0, 1024),
          ],
        );
      }
      for (const rawTag of entry.categories) {
        const label = rawTag.trim().slice(0, 255);
        if (!label) continue;
        const normalized = label.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
        const slug =
          normalized
            .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 180) || `tag-${shortHash(normalized).slice(0, 12)}`;
        await pool.execute(
          `INSERT INTO tags (slug,label,normalized_label,kind,visibility,status,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           VALUES (?,?,?,'topic','public','active','crawler',?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_seen_at=IF(tags.source_type IN ('manual','community'),tags.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
          [slug, label, normalized, source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now],
        );
        await pool.execute(
          `INSERT INTO post_tags (post_id,tag_id,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT id,(SELECT id FROM tags WHERE slug=?),?,?,?,?,?,?,? FROM posts WHERE blog_id=? AND guid=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(post_tags.source_type IN ('manual','community'),post_tags.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
          [slug, 'crawler', source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now, blog.id, entry.guid.slice(0, 1024)],
        );
        await pool.execute(
          `INSERT INTO blog_tags (blog_id,tag_id,role,status,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT ?,id,'topic','active','crawler',?,?,?,?,?,? FROM tags WHERE slug=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(blog_tags.source_type IN ('manual','community'),blog_tags.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
          [blog.id, source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now, slug],
        );
      }
      total += 1;
    }
  }
  await pool.execute(
    `UPDATE blogs SET last_crawled_at=?,last_crawl_success_at=IF(?, ?, last_crawl_success_at),
     last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at),
     history_imported_at=IF(?, COALESCE(history_imported_at, ?), history_imported_at) WHERE id=?`,
    [now, sourceCount > 0, now, blog.id, Boolean(options.historyImport), now, blog.id],
  );
  return { blog: blog.slug, sources: sourceCount, posts: total };
}
