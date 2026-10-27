import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Pool } from 'mysql2/promise';
import { Agent, type Dispatcher, fetch as undiciFetch } from 'undici';
import { type Completeness, type ContentKind, MAX_CONTENT_HTML_BYTES } from '../content/contracts.ts';
import { ingestContentEvidence } from '../content/store.ts';
import { identityKey, publicationDecision } from '../relations/identity.ts';
import { type BodyIndexOptions, createBodyIndexStages } from '../search-index-staging.ts';
import { cleanAuthorName, normalizedAuthorName } from './author-name.ts';

export type FeedSourceType = 'rss' | 'atom' | 'sitemap' | 'wordpress' | 'scraper';
export type FeedLink = { url: string; type: FeedSourceType };
/** Internal-only evidence. Public lists and RSS continue reading the bounded posts.summary. */
export type FeedContent = {
  html: string;
  kind: ContentKind;
  completeness: Completeness;
  sourceUrl: string;
  obtainedAt?: string;
  modifiedAt?: string | null;
  truncated?: boolean;
};
export type FeedEntry = {
  guid: string;
  url: string;
  title: string;
  summary: string;
  content?: FeedContent;
  author: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  imageUrl: string | null;
  categories: string[];
};
export type BlogToCrawl = { id: number; slug: string; url: string };
export type HostResolver = (hostname: string) => Promise<string[]>;
export type FeedFetcher = (input: Parameters<typeof fetch>[0], init?: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;
/** Opt-in passive tap on an existing fetch. It never owns/consumes the caller's Response. */
export type PassiveFetchObservation = {
  requestedUrl: string;
  url: string;
  status?: number;
  headers: Record<string, string>;
  html?: string;
  htmlTruncated: boolean;
  error?: 'robots' | 'timeout' | 'network' | 'invalid-response';
  observedAt: Date;
};
export type PassiveFetchObserver = (event: PassiveFetchObservation) => void | Promise<void>;
export const MAX_OBSERVER_HTML_BYTES = 512 * 1024;
const observedResponseBodies = new WeakMap<Response, { html: string; htmlTruncated: boolean }>();
function emitPassiveFetch(observer: PassiveFetchObserver | undefined, event: PassiveFetchObservation) {
  if (!observer) return;
  try {
    // No await: even a faulty asynchronous observer cannot delay/fail crawling.
    const pending = observer(event);
    if (pending && typeof pending.catch === 'function') void pending.catch(() => undefined);
  } catch {
    /* Observations are optional; never alter crawl success/retry behavior. */
  }
}
function passiveResponseHeaders(response: Response): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ['content-type', 'server', 'x-powered-by', 'cf-mitigated']) {
    const value = response.headers.get(name);
    if (value) values[name] = value.slice(0, 256);
  }
  for (const name of ['cf-ray', 'x-vercel-id', 'x-nf-request-id']) if (response.headers.has(name)) values[name] = 'present';
  return values;
}
export type FeedCrawlerOptions = BodyIndexOptions & {
  observer?: PassiveFetchObserver;
  userAgent?: string;
  delayMs?: number;
  timeoutMs?: number;
  /** Test seams; production resolves once and pins each request to those addresses. */
  resolveHost?: HostResolver;
  fetcher?: FeedFetcher;
  historyImport?: boolean;
  /** Stop at robots.txt rules. Off unless BLOG_CRAWL_OBEY_ROBOTS=true (the owner's choice, 2026-10-17): robots.txt is
   * still read for every host and its status published, but no fetch waits on it. */
  obeyRobots?: boolean;
};

const DEFAULT_USER_AGENT = 'weblog.tw/1.0 (+https://weblog.tw/about; mailto:b@blog.observe.tw)';
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
/** An unreadable robots.txt is kept ten minutes, so a crawl that does not obey it still reads it once, not per page. */
const robotsCache = new Map<string, { expiresAt: number; disallow: string[] | 'unreachable' }>();
/** What one read of a host's robots.txt said about our agent. `missing` (a 4xx other than 429: no rules) and
 * `allowed` admit everything, `partial` blocks some paths, `blocked` blocks `/`; `unreachable` (5xx, 429, a timeout
 * or a network error) is held as a disallow, so an outage is not mistaken for permission. */
export type RobotsObservation = {
  host: string;
  outcome: 'allowed' | 'missing' | 'partial' | 'blocked' | 'unreachable';
  httpStatus: number | null;
  error: 'timeout' | 'network' | 'invalid-response' | null;
  disallow: string[];
  checkedAt: Date;
};
let robotsListener: ((observation: RobotsObservation) => void) | null = null;
/** One listener per process (robots-observations.ts keeps the latest read per host for the directory). */
export function onRobotsObservation(listener: ((observation: RobotsObservation) => void) | null) {
  robotsListener = listener;
}
function observeRobots(host: string, observation: Omit<RobotsObservation, 'host' | 'checkedAt'>) {
  try {
    robotsListener?.({ host: host.toLowerCase(), checkedAt: new Date(), ...observation });
  } catch {
    // A listener never changes the crawl's decision.
  }
}
/** Marks a robots refusal that came from an unreadable robots.txt; the message still starts with `robots disallow`. */
export const ROBOTS_UNREACHABLE = 'robots.txt unreachable';
const DEFAULT_DELAY_MS = Math.max(250, Number(process.env.BLOG_CRAWL_DELAY_MS || 1200));
// 8 MiB: full-content feeds of ~1,000 posts pass 5 MiB (wiwi.blog's RSS is 5.4 MiB).
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

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
/** The first field that holds a person's name; addresses and placeholders are skipped (author-name.ts). */
const firstAuthorName = (values: unknown[]): string | null => {
  for (const value of values)
    for (const item of asArray(value)) {
      const name = cleanAuthorName(textOf(item));
      if (name) return name;
    }
  return null;
};
/** Atom allows several <author> elements, each with its own <name>; the first named one is kept. */
const atomAuthorName = (value: unknown): string | null =>
  firstAuthorName(asArray(value).map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).name : item)));
const absolute = (value: unknown, base: string): string | null => {
  try {
    const raw = textOf(value).trim();
    if (!raw) return null;
    const url = new URL(raw, base);
    return isAllowedCrawlUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
};
const dateOf = (value: unknown): Date | null => {
  const date = new Date(textOf(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const truncateCharacters = (value: string, limit: number): string => {
  let result = '';
  let count = 0;
  for (const character of value) {
    if (count++ >= limit) break;
    result += character;
  }
  return result;
};
const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
};
export const MAX_CONTENT_BYTES = MAX_CONTENT_HTML_BYTES;
export const MAX_PUBLIC_SUMMARY_CHARACTERS = 500;
/** Text-only short display preview; full content has its own private evidence field. */
export function publicSummary(html: string): string {
  const $ = cheerio.load(html);
  $('script,style,noscript,iframe').remove();
  return truncateCharacters($.root().text().replace(/\s+/g, ' ').trim(), MAX_PUBLIC_SUMMARY_CHARACTERS);
}
const escapedText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Only explicit continuation markers downgrade a content field; short/image-only entries remain valid full bodies. */
export function boundedFeedContent(content: FeedContent, maxBytes = MAX_CONTENT_BYTES): FeedContent {
  const html = truncateUtf8(content.html, Math.min(MAX_CONTENT_BYTES, maxBytes));
  const truncated = Boolean(content.truncated) || html !== content.html;
  const $ = cheerio.load(html);
  const excerpt =
    $('.more-link,.read-more,.readmore,[data-excerpt="true"]').length > 0 ||
    $('a')
      .toArray()
      .some((node) =>
        /^(?:read (?:the )?(?:full (?:post|article)|more)|continue reading|繼續閱讀|閱讀全文|阅读全文|繼續閲讀)(?:\s*[»›→…]+)?$/i.test(
          $(node).text().trim(),
        ),
      );
  return {
    ...content,
    html,
    completeness: truncated || excerpt ? 'partial' : content.completeness,
    ...(truncated ? { truncated: true } : {}),
  };
}

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

async function pinnedFetch(target: CrawlTarget, headers: Record<string, string>, timeoutMs: number, fetcher: FeedFetcher, capture = false) {
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
    return await limitedResponse(response, target.url.toString(), capture);
  } finally {
    // limitedResponse consumes/cancels the body before this runs. Destroy
    // instead of graceful close so failures/aborts cannot leave idle sockets.
    await dispatcher.destroy().catch(() => undefined);
  }
}

async function limitedResponse(response: Response, requestedUrl: string, capture = false): Promise<Response> {
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
  if (capture && /^(?:text\/html|application\/xhtml\+xml)(?:[;\s]|$)/i.test(headers.get('content-type') || '')) {
    // Invalid UTF-8 replacement can expand bytes; bound the decoded prefix too and never split a valid codepoint.
    const prefix = Buffer.from(body.subarray(0, MAX_OBSERVER_HTML_BYTES).toString('utf8'));
    let end = Math.min(prefix.length, MAX_OBSERVER_HTML_BYTES);
    while (end < prefix.length && end > 0 && (prefix[end] & 0xc0) === 0x80) end--;
    observedResponseBodies.set(buffered, {
      html: prefix.subarray(0, end).toString('utf8'),
      htmlTruncated: body.length > MAX_OBSERVER_HTML_BYTES || end < prefix.length,
    });
  }
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

const localAdmissionFailure = (error: unknown): boolean =>
  error instanceof Error && ['relation_http_budget', 'relation_batch_stopped'].includes(error.message);

async function robotsAllows(
  url: string,
  userAgent: string,
  timeoutMs: number,
  resolveHost: HostResolver,
  fetcher: FeedFetcher,
): Promise<boolean | 'unreachable'> {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now() && cached.disallow === 'unreachable') return 'unreachable';
  let disallow = cached && cached.expiresAt > Date.now() && cached.disallow !== 'unreachable' ? cached.disallow : null;
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
      // RFC 9309 §2.3.1.3–4: a 4xx robots.txt (no file, or none for us) sets no rules; a server error, 429 or an
      // unreachable server is held as a disallow so a transient outage never turns into a burst.
      const unruled = response.status >= 400 && response.status < 500 && response.status !== 429;
      if (unruled) {
        await response.body?.cancel().catch(() => {});
        disallow = [];
      } else if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        observeRobots(parsed.host, { outcome: 'unreachable', httpStatus: response.status, error: null, disallow: [] });
        robotsCache.set(origin, { expiresAt: Date.now() + 600_000, disallow: 'unreachable' });
        return 'unreachable';
      } else disallow = robotsRules(await response.text(), userAgent);
      robotsCache.set(origin, { expiresAt: Date.now() + 3_600_000, disallow });
      observeRobots(parsed.host, {
        outcome: unruled ? 'missing' : disallow.includes('/') ? 'blocked' : disallow.length ? 'partial' : 'allowed',
        httpStatus: response.status,
        error: null,
        disallow,
      });
    } catch (error) {
      // Local admission never contacted the site. Preserve its identity so the
      // outer passive tap does not misreport a site-side robots block.
      if (localAdmissionFailure(error)) throw error;
      const message = error instanceof Error ? error.message : '';
      observeRobots(parsed.host, {
        outcome: 'unreachable',
        httpStatus: null,
        error: /timeout|abort/i.test(message)
          ? 'timeout'
          : /unsafe crawl|response exceeds|too many/.test(message)
            ? 'invalid-response'
            : 'network',
        disallow: [],
      });
      robotsCache.set(origin, { expiresAt: Date.now() + 600_000, disallow: 'unreachable' });
      return 'unreachable';
    }
  }
  return !(disallow ?? []).some((rule) => parsed.pathname.startsWith(rule));
}

/** One fresh robots.txt read for the URL's host (tools/robots-refresh.ts); the answer also reaches
 * onRobotsObservation. No host delay: it is the only request the caller makes to that host. */
export async function readRobots(value: string, options: FeedCrawlerOptions = {}) {
  const url = new URL(value);
  robotsCache.delete(url.origin);
  return robotsAllows(
    url.toString(),
    options.userAgent?.trim() || USER_AGENT,
    options.timeoutMs ?? 20_000,
    options.resolveHost ?? defaultResolveHost,
    options.fetcher ?? (undiciFetch as FeedFetcher),
  );
}

/** Every request goes through this gate: one host delay and one robots.txt read (enforced only with obeyRobots). */
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
  const obeyRobots = options.obeyRobots ?? process.env.BLOG_CRAWL_OBEY_ROBOTS === 'true';
  let url = new URL(value);
  try {
    for (let hop = 0; hop <= 5; hop += 1) {
      const target = await resolveCrawlTarget(url.toString(), resolveHost);
      // Check both the initial URL and every redirect target. This prevents a
      // feed from bypassing robots by bouncing through an unrelated host.
      const host = url.host;
      // Reserve the slot before yielding: concurrent redirected requests to the
      // same host must not wake together and overwrite each other's reservation.
      const scheduled = Math.max(Date.now(), hostNextAt.get(host) ?? 0);
      hostNextAt.set(host, scheduled + delayMs);
      const wait = scheduled - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const allowed = await robotsAllows(url.toString(), userAgent, timeoutMs, resolveHost, fetcher);
      if (obeyRobots && allowed === 'unreachable') throw new Error(`robots disallow (${ROBOTS_UNREACHABLE}) ${url}`);
      if (obeyRobots && !allowed) throw new Error(`robots disallow ${url}`);
      const response = await pinnedFetch(
        target,
        {
          'user-agent': userAgent,
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
          ...headers,
        },
        timeoutMs,
        fetcher,
        !!options.observer,
      );
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        if (options.observer) {
          const body = observedResponseBodies.get(response);
          observedResponseBodies.delete(response);
          emitPassiveFetch(options.observer, {
            requestedUrl: value,
            url: response.url || url.href,
            status: response.status,
            headers: passiveResponseHeaders(response),
            ...body,
            htmlTruncated: body?.htmlTruncated ?? false,
            observedAt: new Date(),
          });
        }
        return response;
      }
      observedResponseBodies.delete(response);
      url = new URL(location, url);
    }
    throw new Error(`too many redirects from ${value}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Local budget admission is not a failed observation and must not overwrite successful metadata.
    if (!localAdmissionFailure(error)) {
      const reason = /robots disallow/.test(message)
        ? 'robots'
        : /timeout|abort/i.test(message)
          ? 'timeout'
          : /unsafe crawl|response exceeds|too many redirects/.test(message)
            ? 'invalid-response'
            : 'network';
      emitPassiveFetch(options.observer, {
        requestedUrl: value,
        url: url.href,
        headers: {},
        htmlTruncated: false,
        error: reason,
        observedAt: new Date(),
      });
    }
    throw error;
  }
}

/** oEmbed XML describes an embed, never an RSS/Atom publication. */
export function isNonSyndicationSource(value: string, mime = ''): boolean {
  if (/oembed/i.test(mime)) return true;
  try {
    const url = new URL(value);
    return /(?:^|\/)oembed(?:\/|$)/i.test(url.pathname) || /(?:^|\/)oembed(?:\/|$)/i.test(url.searchParams.get('rest_route') || '');
  } catch {
    return true;
  }
}

function discoverLinks(html: string, baseUrl: string): FeedLink[] {
  const $ = cheerio.load(html);
  const links: FeedLink[] = [];
  $('link[rel~="alternate"], link[rel~="feed"], link[rel~="index"]').each((_, element) => {
    const href = $(element).attr('href');
    const type = ($(element).attr('type') || '').toLowerCase();
    const url = absolute(href, baseUrl);
    if (url && !isNonSyndicationSource(url, type) && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
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

export function isCommentsFeed(url: string, title = ''): boolean {
  try {
    const parsed = new URL(url);
    return (
      /(?:^|\/)comments?(?:\/|$)/i.test(parsed.pathname) ||
      /^comments?(?:-|$)/i.test(parsed.searchParams.get('feed') || '') ||
      /^(?:comments? (?:on|for)\b)|comments? feed|(?:留言|評論)(?:摘要|訂閱|回應|feed)/i.test(title)
    );
  } catch {
    return true;
  }
}

export function parseFeed(xml: string, baseUrl: string): FeedEntry[] {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  // Keep XHTML markup separately; the metadata parser intentionally flattens text fields.
  const obtainedAt = new Date().toISOString();
  const xmlDocument = cheerio.load(xml, { xmlMode: true });
  const local = (name: string) => name.split(':').at(-1)?.toLowerCase();
  const xmlRoot = xmlDocument.root().children().first();
  const xmlEntries =
    local(xmlRoot[0]?.tagName || '') === 'rss'
      ? xmlRoot
          .children()
          .filter((_, node) => local(node.tagName) === 'channel')
          .first()
          .children()
          .filter((_, node) => local(node.tagName) === 'item')
      : xmlRoot.children().filter((_, node) => local(node.tagName) === 'entry');
  const fieldHtml = (index: number, name: string, atom = false): string => {
    const node = xmlEntries
      .eq(index)
      .children()
      .filter((_, child) => local(child.tagName) === name)
      .first();
    if (!node.length || node.attr('src')) return '';
    const type = (node.attr('type') || (atom ? 'text' : 'html')).toLowerCase();
    if (type === 'xhtml' || type === 'application/xhtml+xml') return node.html() || '';
    if (!['html', 'text/html', 'text', 'text/plain'].includes(type)) return '';
    const value = node.text();
    if (type === 'text' || type === 'text/plain') return escapedText(value);
    return value;
  };
  const channel = (root.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (channel) {
    if (isCommentsFeed(baseUrl, textOf(channel.title))) return [];
    // A feed whose items name nobody may still name its owner once (managingEditor, itunes:author, dc:creator).
    const channelAuthor = firstAuthorName([channel.managingEditor, channel.author, channel.creator]);
    return asArray(channel.item as unknown)
      .map((item, index): FeedEntry | null => {
        const object = (item || {}) as Record<string, unknown>;
        const url = absolute(object.link ?? object.guid, baseUrl);
        if (!url || /#comment|[?&]replytocom=/i.test(url)) return null;
        const full = fieldHtml(index, 'encoded') || textOf(object.encoded || object['content:encoded']);
        const description = fieldHtml(index, 'description') || textOf(object.description);
        const html = full || description;
        return {
          guid: textOf(object.guid || object.link || object.title).slice(0, 1024),
          url,
          title: textOf(object.title) || '未命名文章',
          summary: publicSummary(description || full),
          ...(html
            ? {
                content: boundedFeedContent({
                  html,
                  kind: 'rss-content',
                  completeness: full ? 'full' : 'partial',
                  sourceUrl: baseUrl,
                  obtainedAt,
                  modifiedAt: dateOf(object.updated || object.pubDate)?.toISOString() ?? null,
                }),
              }
            : {}),
          author: firstAuthorName([object.author, object.creator, object['dc:creator']]) ?? channelAuthor,
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
    if (isCommentsFeed(baseUrl, textOf(atom.title))) return [];
    const feedAuthor = atomAuthorName(atom.author);
    return asArray(atom.entry as unknown)
      .map((entry, index): FeedEntry | null => {
        const object = (entry || {}) as Record<string, unknown>;
        const links = asArray(object.link as unknown).map((item) => (item || {}) as Record<string, unknown>);
        const link = links.find((item) => item['@_rel'] === 'alternate') || links[0];
        const url = absolute(link?.['@_href'] || link, baseUrl);
        if (!url || /#comment|[?&]replytocom=/i.test(url)) return null;
        const full = fieldHtml(index, 'content', true);
        const summary = fieldHtml(index, 'summary', true);
        const html = full || summary;
        return {
          guid: textOf(object.id || link?.['@_href'] || object.title).slice(0, 1024),
          url,
          title: textOf(object.title) || '未命名文章',
          summary: publicSummary(summary || full),
          ...(html
            ? {
                content: boundedFeedContent({
                  html,
                  kind: 'atom-content',
                  completeness: full ? 'full' : 'partial',
                  sourceUrl: baseUrl,
                  obtainedAt,
                  modifiedAt: dateOf(object.updated || object.published)?.toISOString() ?? null,
                }),
              }
            : {}),
          author: atomAuthorName(object.author) ?? feedAuthor,
          publishedAt: dateOf(object.published),
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
  const expectedIdentity = articleIdentityKey(candidate.url);
  if (!expectedIdentity || expectedIdentity !== articleIdentityKey(finalUrl)) return null;
  const $ = cheerio.load(html);
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content') || '';
  const pageIdentity = (value: string) => articleIdentityKey(value, finalUrl);
  const canonical = $('link[rel="canonical"]').first().attr('href');
  if (canonical && pageIdentity(canonical) !== expectedIdentity) return null;
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
    summary: publicSummary(cleanMetadata(article?.description || meta('og:description') || meta('description'), 20_000)),
    content: boundedFeedContent({
      html,
      kind: 'article-html',
      completeness: 'unknown',
      sourceUrl: finalUrl,
      obtainedAt: new Date().toISOString(),
      modifiedAt: (dateOf(article?.dateModified || meta('article:modified_time')) || candidate.updatedAt)?.toISOString() ?? null,
    }),
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

/** Shared publication boundary for feed/history article URLs, including path/query-owned platforms. */
export function articleInPublication(value: string, home: string): boolean {
  if (!isAllowedCrawlUrl(value) || !isAllowedCrawlUrl(home)) return false;
  const url = new URL(value),
    blog = new URL(home);
  if (url.hostname.replace(/^www\./, '') !== blog.hostname.replace(/^www\./, '')) return false;
  const source = publicationDecision(home).home,
    target = publicationDecision(value).home;
  if (!source || !target || identityKey(source) !== identityKey(target)) return false;
  if (blog.hostname === 'home.gamer.com.tw')
    return Boolean(blog.searchParams.get('owner')) && blog.searchParams.get('owner') === url.searchParams.get('owner');
  const path = blog.pathname.replace(/\/+$/, '');
  return !path || url.pathname.replace(/\/+$/, '') === path || url.pathname.startsWith(`${path}/`);
}

async function verifySitemapArticles(entries: FeedEntry[], blogUrl: string, options: FeedCrawlerOptions): Promise<FeedEntry[]> {
  const verified: FeedEntry[] = [];
  for (const candidate of entries) {
    if (!articleInPublication(candidate.url, blogUrl)) continue;
    try {
      const response = await politeFetch(candidate.url, { accept: 'text/html,application/xhtml+xml' }, options);
      if (!response.ok || !articleInPublication(response.url || candidate.url, blogUrl)) continue;
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

/** Prefer article partitions over the often-first miscellaneous/taxonomy sitemap.
 * This only orders bounded source validation; URL names never prove an article exists. */
export function rankedSitemapUrls(urls: string[]): string[] {
  const rank = (value: string) => {
    const url = new URL(value);
    const name = `${url.pathname}${url.search}`.toLowerCase();
    const secondary =
      /(?:^|[/_.?=&-])(?:misc|pages?|categor(?:y|ies)|tags?|post_tag|taxonomies|authors?|products?|attachments?)(?=[/_.?=&\d-]|$)/.test(
        name,
      );
    const articles = /(?:^|[/_.?=&-])(?:posts?|articles?|news)(?=[/_.?=&\d-]|$)/.test(name);
    const dates = [...name.matchAll(/(?:^|\D)((?:19|20)\d{2})[-_/.]?(0[1-9]|1[0-2])(?:[-_/.]?(0[1-9]|[12]\d|3[01]))?(?=\D|$)/g)].map(
      (match) => Number(`${match[1]}${match[2]}${match[3] || '01'}`),
    );
    const date = Math.max(0, ...dates);
    return { priority: secondary ? 3 : articles ? 0 : date ? 1 : 2, date };
  };
  return [...new Set(urls)]
    .filter(isAllowedCrawlUrl)
    .map((url) => ({ url, ...rank(url) }))
    .sort((a, b) => a.priority - b.priority || b.date - a.date || a.url.localeCompare(b.url))
    .map(({ url }) => url);
}

export async function discoverFeedUrls(blogUrl: string, options: FeedCrawlerOptions = {}): Promise<FeedLink[]> {
  const response = await politeFetch(blogUrl, {}, options);
  if (!response.ok) throw new Error(`homepage ${response.status}`);
  return discoverLinks(await response.text(), blogUrl);
}

export type SqlPool = Pick<Pool, 'execute'>;

export function canonicalArticleUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

/** Article identity retains meaningful query IDs (unlike a publication/owner identity). */
export function articleIdentityKey(value: string, base?: string): string | null {
  try {
    const resolved = new URL(value, base).href;
    if (!isAllowedCrawlUrl(resolved)) return null;
    const url = new URL(canonicalArticleUrl(resolved));
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return null;
  }
}

/** Shared writer. Production callers hold the blog row in a transaction so URL/guid identity is serialized. */
export async function writeFeedEntries(
  pool: SqlPool,
  blog: BlogToCrawl,
  source: FeedLink,
  entries: FeedEntry[],
  now = new Date(),
  stageBodyIndex?: (event: unknown) => void,
): Promise<number> {
  let written = 0;
  for (const original of entries) {
    if (!articleInPublication(original.url, blog.url)) continue;
    const entry = { ...original, url: canonicalArticleUrl(original.url) };
    const [existingUrl] = await pool.execute('SELECT guid FROM posts WHERE blog_id=? AND url=? ORDER BY id LIMIT 1', [blog.id, entry.url]);
    if (Array.isArray(existingUrl) && existingUrl[0]) entry.guid = String((existingUrl[0] as { guid: string }).guid);
    const title = truncateCharacters(entry.title, 512);
    // MariaDB TEXT is limited in bytes. Chinese/emoji summaries can exceed
    // it long before a JavaScript string reaches 65k characters.
    // Parsers already emit plain text. Re-parsing it as HTML would erase literal code such as <div>.
    const summary = truncateCharacters((entry.summary || '').replace(/\s+/g, ' ').trim(), MAX_PUBLIC_SUMMARY_CHARACTERS);
    // Every writer (feeds, history imports, scrapers) passes here, so no address reaches posts or authors.
    const author = cleanAuthorName(entry.author);
    // Truncating a URL creates a different resource; omit an oversized image.
    const imageUrl = entry.imageUrl && entry.imageUrl.length <= 1024 ? entry.imageUrl : null;
    const contentHash = shortHash(`${title}\n${summary}`);
    await pool.execute(
      "INSERT INTO posts (blog_id,guid,url,title,summary,author,published_at,updated_at,image_url,content_hash,source_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE url=VALUES(url),title=COALESCE(NULLIF(NULLIF(VALUES(title),''),'未命名文章'),title),summary=COALESCE(NULLIF(VALUES(summary),''),summary),author=COALESCE(NULLIF(VALUES(author),''),author),published_at=COALESCE(VALUES(published_at),published_at),updated_at=COALESCE(VALUES(updated_at),updated_at),image_url=COALESCE(NULLIF(VALUES(image_url),''),image_url),content_hash=SHA2(CONCAT(COALESCE(NULLIF(NULLIF(VALUES(title),''),'未命名文章'),title),CHAR(10),COALESCE(NULLIF(VALUES(summary),''),summary,'')),256)",
      [
        blog.id,
        entry.guid.slice(0, 1024),
        entry.url.slice(0, 1024),
        title,
        summary || null,
        author,
        entry.publishedAt,
        entry.updatedAt,
        imageUrl,
        contentHash,
        source.type,
        now,
      ],
    );
    if (entry.content?.html) {
      const content = boundedFeedContent(entry.content);
      const body = await ingestContentEvidence(
        pool,
        {
          ...content,
          blogId: blog.id,
          blogUrl: blog.url,
          articleUrl: entry.url,
          obtainedAt: content.obtainedAt ? dateOf(content.obtainedAt) || now : now,
          modifiedAt: content.modifiedAt ? dateOf(content.modifiedAt) : entry.updatedAt,
        },
        now,
      );
      // Transaction-local staging only. SQL caller owns commit/release proof.
      try {
        stageBodyIndex?.({
          postId: body.postId,
          blogId: blog.id,
          postOwnerBlogId: blog.id,
          bodyOwnerBlogId: blog.id,
          publicationStatus: 'verified',
          status: body.status,
          changed: body.changed,
        });
      } catch {
        /* staging must not mutate ingestion success */
      }
    }
    // A pen name is resolved within this blog only. Matching names on two
    // sites therefore create two author identities until a human explicitly
    // merges them. Crawler updates never replace manual/community links.
    if (author) {
      const displayName = author;
      const normalized = normalizedAuthorName(displayName);
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
      }
      await pool.execute(
        "UPDATE authors SET last_seen_at=?,last_published_at=COALESCE(GREATEST(COALESCE(last_published_at,?),?),last_published_at),updated_at=? WHERE id=? AND source_type NOT IN ('manual','community')",
        [now, entry.publishedAt, entry.publishedAt, now, authorId],
      );
      await pool.execute(
        `INSERT INTO blog_authors (blog_id,author_id,role,status,is_primary,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_seen_at=IF(blog_authors.source_type IN ('manual','community'),blog_authors.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
        [blog.id, authorId, 'author', 'active', false, 'crawler', source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now],
      );
      await pool.execute(
        `INSERT INTO post_authors (post_id,author_id,position,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT id,?,?,?,?,?,?,?,?,? FROM posts WHERE blog_id=? AND guid=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(post_authors.source_type IN ('manual','community'),post_authors.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
        [authorId, 0, 'crawler', source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now, blog.id, entry.guid.slice(0, 1024)],
      );
    }
    let tagPosition = 0;
    for (const rawTag of entry.categories) {
      const label = rawTag.trim().slice(0, 255);
      if (!label) continue;
      // The author's feed order, so lists can show their first categories first.
      const position = tagPosition++;
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
        `INSERT INTO post_tags (post_id,tag_id,position,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT id,(SELECT id FROM tags WHERE slug=?),?,?,?,?,?,?,?,? FROM posts WHERE blog_id=? AND guid=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(post_tags.source_type IN ('manual','community'),post_tags.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
        [
          slug,
          position,
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
      await pool.execute(
        `INSERT INTO blog_tags (blog_id,tag_id,role,status,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT ?,id,'topic','active','crawler',?,?,?,?,?,? FROM tags WHERE slug=?
           ON DUPLICATE KEY UPDATE last_seen_at=IF(blog_tags.source_type IN ('manual','community'),blog_tags.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
        [blog.id, source.url, JSON.stringify({ guid: entry.guid }), now, now, now, now, slug],
      );
    }
    written += 1;
  }
  return written;
}

/** Crawl one blog using the existing schema.  The worker supplies its own
 * pool; no queue, database, or session is shared with sibling services. */
const SCRAPER_TAKEOVER_MS = 14 * 86400000;
/** A generated scraper (app/src/scrapers) crawls a blog while none of its feeds has worked for 14 days. Loaded
 * lazily: the scraper modules import this one. */
async function scraperInCharge(pool: SqlPool, blogId: number, now: Date) {
  const { activeScraper } = await import('../scrapers/store.ts');
  const scraper = await activeScraper(pool, blogId);
  if (!scraper) return null;
  const [rows] = await pool.execute('SELECT 1 FROM feed_sources WHERE blog_id=? AND last_success_at>? LIMIT 1', [
    blogId,
    new Date(now.getTime() - SCRAPER_TAKEOVER_MS),
  ]);
  return Array.isArray(rows) && rows.length ? null : scraper;
}
async function crawlWithScraper(
  pool: SqlPool,
  blog: BlogToCrawl,
  scraper: import('../scrapers/store.ts').StoredScraper,
  options: FeedCrawlerOptions,
  now: Date,
): Promise<{ blog: string; sources: number; posts: number }> {
  const [{ scrapeBlog }, { recordScraperRun }] = await Promise.all([import('../scrapers/run.ts'), import('../scrapers/store.ts')]);
  // Passive relation observations follow feed pages only; scraper pages are not tapped.
  const fetchOptions = { ...options, observer: undefined };
  const known = async (urls: string[]) => {
    if (!urls.length) return new Set<string>();
    const [rows] = await pool.execute(`SELECT url FROM posts WHERE blog_id=? AND url IN (${urls.map(() => '?').join(',')})`, [
      blog.id,
      ...urls,
    ]);
    return new Set((Array.isArray(rows) ? (rows as { url: string }[]) : []).map((row) => row.url));
  };
  const result = await scrapeBlog(scraper, blog, known, fetchOptions, now).catch(() => ({
    entries: [],
    listed: 0,
    error: 'scraper_run_failed',
  }));
  const source: FeedLink = { url: scraper.listUrls[0] ?? blog.url, type: 'scraper' };
  const posts = result.entries.length ? await commitFeedEntries(pool, blog, source, result.entries, now, fetchOptions, async () => {}) : 0;
  await recordScraperRun(pool, scraper.id, result.error, now);
  await pool.execute(
    `UPDATE blogs SET last_crawled_at=?,last_crawl_success_at=IF(?, ?, last_crawl_success_at),
     last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at) WHERE id=?`,
    [now, !result.error, now, blog.id, blog.id],
  );
  return { blog: blog.slug, sources: result.error ? 0 : 1, posts };
}
/** One source's entries in one transaction; `acknowledge` runs last inside it, so a failed write is replayable.
 * SQL work starts after all network requests. History uses the same writer in its task transaction, so both
 * paths serialize on the blog row. */
async function commitFeedEntries(
  pool: SqlPool,
  blog: BlogToCrawl,
  source: FeedLink,
  entries: FeedEntry[],
  now: Date,
  options: FeedCrawlerOptions,
  acknowledge: (writer: SqlPool) => Promise<void>,
): Promise<number> {
  const connection = 'getConnection' in pool ? await (pool as Pool).getConnection() : null;
  const writer = connection ?? pool;
  const indexStages = createBodyIndexStages(options, 'feed');
  const staged = indexStages.transaction();
  let commitAttempted = false,
    committed = false;
  try {
    if (connection) {
      await connection.beginTransaction();
      const [current] = await connection.execute('SELECT id,url,status FROM blogs WHERE id=? FOR UPDATE', [blog.id]);
      const row = Array.isArray(current) ? (current[0] as { url?: string; status?: string } | undefined) : undefined;
      if (row?.url !== blog.url || row?.status !== 'verified') throw new Error('crawl_blog_identity_changed');
    }
    const written = await writeFeedEntries(writer, blog, source, entries, now, staged.stage);
    await acknowledge(writer);
    if (connection) {
      commitAttempted = true;
      await connection.commit();
      committed = true;
    }
    return written;
  } catch (error) {
    if (commitAttempted || !connection) staged.unproven();
    else staged.discard();
    if (connection) await connection.rollback();
    throw error;
  } finally {
    try {
      connection?.release();
    } catch (error) {
      staged.unproven();
      // biome-ignore lint/correctness/noUnsafeFinally: Preserve the existing release exception; do not assert successful release.
      throw error;
    } finally {
      if (committed) staged.committed();
      else if (!connection) staged.unproven();
      await indexStages.flush();
    }
  }
}
export async function crawlBlog(
  { pool }: { pool: SqlPool },
  blog: BlogToCrawl,
  options: FeedCrawlerOptions = {},
): Promise<{ blog: string; sources: number; posts: number }> {
  const now = new Date();
  const scraper = await scraperInCharge(pool, blog.id, now);
  if (scraper) return crawlWithScraper(pool, blog, scraper, options, now);
  let links: FeedLink[];
  try {
    // Verified seed resolution registers publication-specific sources. Reuse
    // those instead of guessing a shared platform's global feed on each run.
    const [registered] = await pool.execute(
      'SELECT url,type FROM feed_sources WHERE blog_id=? AND last_success_at IS NOT NULL ORDER BY id',
      [blog.id],
    );
    const known = Array.isArray(registered) ? (registered as FeedLink[]) : [];
    const valid = known.filter(
      (source) => ['rss', 'atom', 'sitemap'].includes(source.type) && isAllowedCrawlUrl(source.url) && !isNonSyndicationSource(source.url),
    );
    const sitemaps = new Map(valid.filter((source) => source.type === 'sitemap').map((source) => [source.url, source]));
    // Older miscellaneous sources remain recorded, but cannot exhaust the page
    // budget before a newly verified article partition is visited.
    links = [
      ...valid.filter((source) => source.type !== 'sitemap'),
      ...rankedSitemapUrls([...sitemaps.keys()]).map((url) => sitemaps.get(url)!),
    ];
    if (!links.length) {
      links = await discoverFeedUrls(blog.url, options);
    }
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
    // History replay deliberately downloads content again to recover previous
    // partial imports, including validators saved by an older release.
    if (!options.historyImport && saved?.etag) headers['if-none-match'] = saved.etag;
    if (!options.historyImport && saved?.last_modified) headers['if-modified-since'] = saved.last_modified;
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
    if (response.status === 304 && !options.historyImport) {
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
    // A validator acknowledges durable import of the entire source, including
    // author/tag links. Persist it last so a failed write is replayable.
    total += await commitFeedEntries(pool, blog, source, entries, now, options, async (writer) => {
      const etag = response.headers.get('etag');
      const lastModified = response.headers.get('last-modified');
      await writer.execute(
        'INSERT INTO feed_sources (blog_id,url,type,etag,last_modified,last_success_at,consecutive_failures) VALUES (?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE etag=VALUES(etag),last_modified=VALUES(last_modified),last_success_at=VALUES(last_success_at),last_error_at=NULL,consecutive_failures=0',
        [
          blog.id,
          source.url,
          source.type,
          etag && etag.length <= 512 ? etag : null,
          lastModified && lastModified.length <= 255 ? lastModified : null,
          now,
        ],
      );
    });
    sourceCount += 1;
  }
  await pool.execute(
    `UPDATE blogs SET last_crawled_at=?,last_crawl_success_at=IF(?, ?, last_crawl_success_at),
     last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at),
     history_imported_at=history_imported_at WHERE id=?`,
    [now, sourceCount > 0, now, blog.id, blog.id],
  );
  return { blog: blog.slug, sources: sourceCount, posts: total };
}
