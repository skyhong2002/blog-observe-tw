import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import type { Pool } from 'mysql2/promise';

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
};
export type BlogToCrawl = { id: number; slug: string; url: string };
export type HostResolver = (hostname: string) => Promise<string[]>;
export type FeedFetcher = typeof fetch;
export type FeedCrawlerOptions = {
  userAgent?: string;
  delayMs?: number;
  timeoutMs?: number;
  /** Test seam; production always uses the system resolver and fetch. */
  resolveHost?: HostResolver;
  fetcher?: FeedFetcher;
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

const ipv4Blocked = (value: string): boolean => {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 168)) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
};

const ipv6Blocked = (value: string): boolean => {
  const normalized = value.toLowerCase().split('%', 1)[0];
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped && ipv4Blocked(mapped[1])) return true;
  const numeric = ipv6Value(normalized);
  if (numeric === null) return true;
  if (numeric >> 32n === 0xffffn) {
    const mappedValue = Number(numeric & 0xffffffffn);
    const mappedAddress = [mappedValue >>> 24, (mappedValue >>> 16) & 255, (mappedValue >>> 8) & 255, mappedValue & 255].join('.');
    if (ipv4Blocked(mappedAddress)) return true;
  }
  const prefix = (bits: number, length: number) => numeric >> BigInt(128 - length) === BigInt(bits);
  return (
    numeric === 0n ||
    numeric === 1n ||
    prefix(0xfc, 8) ||
    prefix(0x3fa, 10) ||
    prefix(0x3fb, 10) ||
    prefix(0xff, 8) ||
    prefix(0x20010db8, 32)
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

/** Resolve every address so a hostname cannot hide a private or unresolved target. */
export async function validateCrawlUrl(value: string, resolveHost: HostResolver = defaultResolveHost): Promise<URL> {
  if (!isAllowedCrawlUrl(value)) throw new Error(`unsafe crawl URL: ${value}`);
  const url = new URL(value);
  const hostname = hostnameOf(url);
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some((address) => isBlockedAddress(address))) throw new Error(`unsafe crawl address: ${hostname}`);
  return url;
}

async function limitedResponse(response: Response): Promise<Response> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error(`crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  if (!response.body) return response;
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
  return new Response(body.length ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
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
        await validateCrawlUrl(robotsUrl, resolveHost);
        response = await limitedResponse(
          await fetcher(robotsUrl, {
            headers: { 'user-agent': userAgent, accept: 'text/plain' },
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          }),
        );
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
  const fetcher = options.fetcher ?? fetch;
  let url = new URL(value);
  for (let hop = 0; hop <= 5; hop += 1) {
    await validateCrawlUrl(url.toString(), resolveHost);
    // Check both the initial URL and every redirect target. This prevents a
    // feed from bypassing robots by bouncing through an unrelated host.
    const host = url.host;
    const wait = (hostNextAt.get(host) ?? 0) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostNextAt.set(host, Date.now() + delayMs);
    if (!(await robotsAllows(url.toString(), userAgent, timeoutMs, resolveHost, fetcher))) throw new Error(`robots disallow ${url}`);
    const response = await limitedResponse(
      await fetcher(url, {
        headers: {
          'user-agent': userAgent,
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
          ...headers,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }),
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
            publishedAt: dateOf(object.lastmod),
            updatedAt: dateOf(object.lastmod),
            imageUrl: null,
          }
        : null;
    })
    .filter((item): item is FeedEntry => Boolean(item));
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
    links = await discoverFeedUrls(blog.url, options);
  } catch (error) {
    await pool.execute('UPDATE blogs SET last_crawled_at=? WHERE id=?', [now, blog.id]);
    throw error;
  }
  let total = 0;
  let sourceCount = 0;
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
    if (response.status === 304) continue;
    if (!response.ok) {
      await pool.execute(
        'INSERT INTO feed_sources (blog_id,url,type,last_error_at,consecutive_failures) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_error_at=VALUES(last_error_at),consecutive_failures=consecutive_failures+1',
        [blog.id, source.url, source.type, now],
      );
      continue;
    }
    const body = await response.text();
    const entries = source.type === 'sitemap' ? parseSitemap(body, source.url) : parseFeed(body, source.url);
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
      total += 1;
    }
  }
  await pool.execute(
    'UPDATE blogs SET last_crawled_at=?,last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at) WHERE id=?',
    [now, blog.id, blog.id],
  );
  return { blog: blog.slug, sources: sourceCount, posts: total };
}
