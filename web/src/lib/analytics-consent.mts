// Adapted from tag.observe.tw web/src/lib/analytics-consent.mts, MIT, Copyright (c) 2026 Sky Hong.
// Who sends GA data and what it may say, decided before the Google tag loads
// (SiteAnalytics / analytics-runtime.mts): only production blog.observe.tw,
// never automation, DNT/GPC or a browser whose owner chose 不計入統計 on
// /observe/opt-out/, and only from public pages without a query string.
// Pure (only the pure public-query.ts): node --test imports this file.

import { isSlug, isTopicId } from './public-query.ts';

export const SITE_HOST = 'blog.observe.tw';
export const DEFAULT_GA_ID = 'G-VKWGDHDESV';
export const OPT_OUT_KEY = 'blog-analytics-opt-out';
/** Fired on window when this browser's choice changes (same tab; other tabs get `storage`). */
export const OPT_OUT_EVENT = 'blog-analytics-opt-out-change';
/** Fired on window by components after a completed action (detail: AnalyticsAction). */
export const ACTION_EVENT = 'blog-analytics-action';
export const OPT_OUT_PATH = '/observe/opt-out/';
/** Every GA hit carries this title instead of document.title (which can hold a blog or topic name). */
export const PAGE_TITLE = '部落格觀察';

export type AnalyticsBlock = 'environment' | 'automation' | 'unreadable' | 'opt-out' | 'privacy' | null;
export type AnalyticsAction = 'follow';

/**
 * The measurement ID from NEXT_PUBLIC_GA_ID: unset means the site default, an
 * explicitly empty value turns analytics off, anything not shaped like a GA4
 * ID is refused.
 */
export function measurementId(configured: string | undefined): string | null {
  const id = configured === undefined ? DEFAULT_GA_ID : configured;
  return /^G-[A-Z0-9]{4,16}$/.test(id) ? id : null;
}

interface Env {
  production: boolean;
  hostname: string;
  measurementId: string | null;
  webdriver: boolean | undefined;
  userAgent: string;
  /** readOptOut: true, false, or null when the choice could not be read. */
  optedOut: boolean | null;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

// Headless browsers, auditing tools and crawlers that may not set navigator.webdriver.
const AUTOMATION_UA =
  /HeadlessChrome|Chrome-Lighthouse|Lighthouse|PTST|Playwright|Puppeteer|Cypress|Selenium|PhantomJS|bot\b|bot\/|crawler|spider|slurp|facebookexternalhit|Google-InspectionTool|GoogleOther/i;

/** Why GA must stay off for this page load, or null when it may run. */
export function analyticsBlock(env: Env): AnalyticsBlock {
  if (!env.production || env.hostname !== SITE_HOST || !env.measurementId) return 'environment';
  if (env.webdriver === true || AUTOMATION_UA.test(env.userAgent)) return 'automation';
  if (env.optedOut === null) return 'unreadable';
  if (env.optedOut) return 'opt-out';
  if (env.doNotTrack === '1' || env.doNotTrack === 'yes' || env.globalPrivacyControl === true) return 'privacy';
  return null;
}

/** true/false for the stored choice; null when storage is missing or throws, which callers treat as opted out. */
export function readOptOut(storage: Pick<Storage, 'getItem'> | null | undefined): boolean | null {
  if (!storage) return null;
  try {
    return storage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return null;
  }
}

export function writeOptOut(storage: Pick<Storage, 'setItem' | 'removeItem'>, optedOut: boolean) {
  if (optedOut) storage.setItem(OPT_OUT_KEY, '1');
  else storage.removeItem(OPT_OUT_KEY);
}

// Public pages whose path may reach GA, with or without the trailing slash
// (skipTrailingSlashRedirect serves both); hits always carry the canonical
// trailing-slash path. Anything else (sign-in, reader and admin pages, the
// opt-out page, API JSON, unknown paths) is never measured. Whether a
// /blogs/<slug>/ or /topics/<id>/ path exists is not known here, only that
// its segment has the published shape, so no free text a visitor typed into
// the address bar can reach GA.
//
// Readable page URLs (page-links.ts) are deliberately not measured: a
// readable topic key is the topic's label, a readable blog key a domain or
// name. Only the pre-registry shapes below count: an ASCII blog slug without
// dots and tag:<hash> / rss:<n> topic ids. Anything else, such as
// /topics/旅行/ or /blogs/example.com/, is an unmeasured page and, after
// `config`, taints the document like any other (analytics-runtime.mts). Until
// the browser has a verified stable mapping for those paths, GA coverage of
// blog and topic detail pages is intentionally smaller than before.
const STATIC_PUBLIC: Record<string, string> = {
  '/': 'home',
  '/about/': 'about',
  '/api/': 'api',
  '/api/status/': 'api_status',
  '/articles/': 'articles',
  '/authors/': 'authors',
  '/blogs/': 'blogs',
  '/queue/': 'queue',
  '/ranking/': 'ranking',
  '/relations/': 'relations',
  '/tags/': 'tags',
  '/tech/': 'tech',
  '/topics/': 'topics',
  '/traffic/': 'traffic',
};

/** A blog slug as the gateway publishes it: lowercase ASCII, within isSlug's length. */
export const isBlogSlug = (segment: string) => /^[a-z0-9][a-z0-9_-]*$/.test(segment) && isSlug(segment);

/** The topic id in a /topics/<segment>/ path (tag:<hash> or rss:<n>, percent-encoded or not), or null. */
export function topicIdOf(segment: string): string | null {
  if (!/^[A-Za-z0-9%:]{1,200}$/.test(segment)) return null;
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return isTopicId(id) ? id : null;
}

export interface PublicPage {
  type: string;
  /** The canonical trailing-slash path, e.g. /topics/tag%3A<hash>/. */
  path: string;
}

/**
 * The public page a same-site URL shows, or null when it must not be
 * measured: any query string (even an empty `?`), a private, unknown or
 * unexpectedly shaped path. `href` is what the page was or is about to be
 * navigated to.
 */
export function publicPage(href: string, origin: string): PublicPage | null {
  let url: URL;
  try {
    url = new URL(href, `${origin}/`);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.search || /\?/.test(href.replace(/#.*$/, ''))) return null;
  if (url.pathname.length > 512) return null;
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const type = STATIC_PUBLIC[path];
  if (type) return { type, path };
  const dynamic = /^\/(blogs|topics)\/([^/]+)\/$/.exec(path);
  if (!dynamic) return null;
  if (dynamic[1] === 'blogs') return isBlogSlug(dynamic[2]) ? { type: 'blog', path } : null;
  const id = topicIdOf(dynamic[2]);
  return id ? { type: 'topic', path: `/topics/${encodeURIComponent(id)}/` } : null;
}

export const publicPageType = (href: string, origin: string) => publicPage(href, origin)?.type ?? null;

export interface PageFields {
  page_location: string;
  page_title: string;
  page_referrer: string;
}

/** origin + canonical public path, the fixed title and an origin-only referrer: no query, fragment or page text. */
export function pageFields(origin: string, page: PublicPage, referrer: string): PageFields {
  return { page_location: origin + page.path, page_title: PAGE_TITLE, page_referrer: referrerOrigin(referrer) };
}

export function referrerOrigin(referrer: string | null | undefined): string {
  try {
    const url = new URL(referrer ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

/**
 * A select_content id as a link may declare it (data-analytics-content-id, set
 * by page-links.ts from the server record's stable id): an ASCII blog slug, a
 * topic's 64-hex hash or an RSS topic number. Anything else is undefined.
 */
export function safeContentId(type: 'blog' | 'topic', value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (type === 'blog') return isBlogSlug(value) && value.length <= 180 ? value : undefined;
  return /^(?:[a-f0-9]{64}|[1-9]\d{0,9})$/.test(value) ? value : undefined;
}

/**
 * select_content for a same-site link to a blog or topic page. content_id is
 * only an ASCII slug, a numeric RSS topic id or a topic's hex hash; never a
 * label, query string or other text. A readable path gives content_type only,
 * unless the link declares a `contentId` that passes safeContentId.
 */
export function selectContentTarget(pathname: string, contentId?: string): { content_type: 'blog' | 'topic'; content_id?: string } | null {
  const blog = /^\/blogs\/([^/]+)\/?$/.exec(pathname);
  const topic = blog ? null : /^\/topics\/([^/]+)\/?$/.exec(pathname);
  if (!blog && !topic) return null;
  const declared = safeContentId(blog ? 'blog' : 'topic', contentId);
  if (declared) return { content_type: blog ? 'blog' : 'topic', content_id: declared };
  if (blog) return isBlogSlug(blog[1]) ? { content_type: 'blog', content_id: blog[1] } : { content_type: 'blog' };
  const id = topicIdOf(topic![1]);
  // tag:<hash> / rss:<n> -> the hash or the number.
  return id ? { content_type: 'topic', content_id: id.slice(4) } : { content_type: 'topic' };
}

export type ClickEvent =
  | { name: 'open_original'; params: { link_domain: string; source_page_type: string } }
  | { name: 'select_content'; params: { content_type: string; content_id?: string; source_page_type: string } }
  | { name: 'rss_click' };

/**
 * What a click on a link means, from the link's href, its data-analytics
 * marker and the current page type. Sign-in links are not events: only a
 * completed sign-in counts (loginCompleted).
 */
export function classifyClick(
  href: string,
  marker: string | undefined,
  origin: string,
  sourcePageType: string,
  contentId?: string,
): ClickEvent | null {
  let url: URL;
  try {
    url = new URL(href, `${origin}/`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== origin) {
    if (marker !== 'open_original' || !/^[a-z0-9.-]{1,253}$/i.test(url.hostname)) return null;
    return { name: 'open_original', params: { link_domain: url.hostname.toLowerCase(), source_page_type: sourcePageType } };
  }
  if (url.pathname === '/me/feed.xml' || url.pathname.startsWith('/feeds/')) return { name: 'rss_click' };
  // API JSON and query-string links are not content selections.
  if (url.search || url.pathname.startsWith('/api/')) return null;
  const target = selectContentTarget(url.pathname, contentId);
  return target ? { name: 'select_content', params: { ...target, source_page_type: sourcePageType } } : null;
}

// The gateway's /auth/google/callback sets this 5-minute boolean marker only
// after a Google sign-in created a session (app/src/auth/google-login.ts), and
// clears it when a sign-in starts, fails or the reader logs out, so a
// cancelled sign-in by an already signed-in reader never carries it. It is
// read only to send `login` (method=google), never for authentication, and
// the browser deletes it right after that event. The `__Host-` prefix makes it
// host-only (Secure, Path=/, no Domain), so a sibling subdomain cannot plant it.
export const LOGIN_COMPLETED_COOKIE = '__Host-blog_login_completed';

/** Exactly `__Host-blog_login_completed=1` among the document's cookies. */
export function loginCompleted(cookie: string): boolean {
  return cookie.split(';').some((part) => part.trim() === `${LOGIN_COMPLETED_COOKIE}=1`);
}

/** document.cookie assignment that deletes the receipt (same Path, SameSite and Secure as set; no Domain, as `__Host-` requires). */
export const CLEAR_LOGIN_COMPLETED = `${LOGIN_COMPLETED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
