import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  type BlogToCrawl,
  canonicalArticleUrl,
  type FeedEntry,
  isAllowedCrawlUrl,
  isCommentsFeed,
  isNonSyndicationSource,
  parseFeed,
  parseSitemap,
  rankedSitemapUrls,
} from './feed.ts';
import type { HistoryPageResult, HistoryTask, HistoryTaskInput, StoredEntry } from './history-types.ts';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const many = (value: unknown): unknown[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : typeof object(value)?.['#text'] === 'string'
        ? String(object(value)?.['#text'])
        : '';
const sameHost = (a: URL, b: URL) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');
const sharedHosts = new Set(['medium.com', 'vocus.cc', 'xuite.net', 'blog.xuite.net', 'www.blogger.com', 'blogger.com']);
const safe = (value: string) => value.length <= 1024 && isAllowedCrawlUrl(value);
export const historyHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function historyTaskKey(blogId: number, task: HistoryTaskInput) {
  return historyHash(JSON.stringify([blogId, task.kind, task.url]));
}

/** Same-site author identity; the platform's global domain is never an identity. */
export function historyInPublication(value: string, homepage: string): boolean {
  if (!safe(value) || !safe(homepage)) return false;
  const url = new URL(value);
  const home = new URL(homepage);
  if (!sameHost(url, home)) return false;
  if (!sharedHosts.has(home.hostname.replace(/^www\./, ''))) return true;
  const path = home.pathname.replace(/\/+$/, '');
  if (!path) return false;
  return url.pathname.replace(/\/+$/, '') === path || url.pathname.startsWith(`${path}/`);
}
export function historySourceInScope(value: string, blog: BlogToCrawl, sourceUrl: string): boolean {
  if (!safe(value)) return false;
  if (historyInPublication(value, blog.url)) return true;
  const url = new URL(value),
    source = new URL(sourceUrl);
  // Known off-site feed services may paginate only under their already-owned
  // feed path. They still cannot supply another publication's article URLs.
  return safe(sourceUrl) && sameHost(url, source) && url.pathname.replace(/\/+$/, '') === source.pathname.replace(/\/+$/, '');
}
function absolute(value: string, base: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value, base);
    url.hash = '';
    return safe(url.href) ? url.href : null;
  } catch {
    return null;
  }
}
function utf8Prefix(value: string, bytes = 60 * 1024) {
  let result = '',
    count = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (count + size > bytes) break;
    count += size;
    result += character;
  }
  return result;
}
export function storedEntry(entry: FeedEntry): StoredEntry {
  return {
    ...entry,
    summary: utf8Prefix(entry.summary),
    title: Array.from(entry.title).slice(0, 512).join(''),
    guid: entry.guid.length > 1024 ? `sha256:${historyHash(entry.guid)}` : entry.guid,
    author: entry.author ? Array.from(entry.author).slice(0, 255).join('') : null,
    imageUrl: entry.imageUrl && entry.imageUrl.length <= 1024 ? entry.imageUrl : null,
    categories: entry.categories.slice(0, 20).map((category) => Array.from(category).slice(0, 255).join('')),
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    updatedAt: entry.updatedAt?.toISOString() ?? null,
  };
}
export function restoreEntry(entry: StoredEntry): FeedEntry {
  return {
    ...entry,
    publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : null,
  };
}
function child(
  parent: HistoryTask,
  url: string,
  kind: HistoryTaskInput['kind'],
  payload: HistoryTaskInput['payload'] = {},
): HistoryTaskInput {
  return {
    url,
    kind,
    sourceUrl: parent.sourceUrl,
    sourceType: kind === 'sitemap' || kind === 'article' ? 'sitemap' : kind === 'wordpress' ? 'wordpress' : parent.sourceType,
    depth: parent.depth + (payload.paginated ? 0 : 1),
    payload: { ...payload, lineage: [...(parent.payload?.lineage ?? []), parent.url].slice(-32) },
  };
}
function linksFromHeader(header: string | null): string[] {
  return [...(header || '').matchAll(/<([^>]+)>\s*;\s*rel\s*=\s*["']?next["']?/gi)].map((match) => match[1]);
}
function following(parent: HistoryTask, urls: string[], blog: BlogToCrawl, base: string, kind: HistoryTaskInput['kind']) {
  return [...new Set(urls.map((url) => absolute(url, base)).filter((url): url is string => Boolean(url)))]
    .filter((url) => historySourceInScope(url, blog, parent.sourceUrl) && url !== parent.url && !parent.payload?.lineage?.includes(url))
    .map((url) => child(parent, url, kind, { paginated: true }));
}

/** Queue algorithm follows tag afe0a65 crawl/pipeline.ts; its 14-day/four-shard news limits are intentionally removed. */
export function parseHistoryXml(body: string, task: HistoryTask, blog: BlogToCrawl, finalUrl: string, headers: Headers): HistoryPageResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error('invalid_xml_source');
  const root = object(parser.parse(body));
  if (!root) throw new Error('invalid_xml_source');
  const sitemapIndex = object(root.sitemapindex);
  if (sitemapIndex) {
    const urls = rankedSitemapUrls(
      many(sitemapIndex.sitemap)
        .map((item) => absolute(text(object(item)?.loc), finalUrl))
        .filter((url): url is string => Boolean(url)),
    );
    const safeUrls = urls.filter((url) => historyInPublication(url, blog.url));
    const tasks = safeUrls
      .filter((url) => url !== task.url && !task.payload?.lineage?.includes(url))
      .map((url) => child(task, url, 'sitemap'));
    return {
      entries: [],
      tasks,
      fetched: true,
      archiveSeen: true,
      fingerprint: historyHash(urls.join('\n')),
      warnings: [
        ...(tasks.length < safeUrls.length ? ['sitemap-cycle'] : []),
        ...(safeUrls.length < urls.length ? ['out-of-publication-shards-skipped'] : []),
      ],
    };
  }
  if ('urlset' in root) {
    const rawEntries = parseSitemap(body, finalUrl);
    const entries = rawEntries.filter((entry) => historyInPublication(entry.url, blog.url));
    return {
      entries: [],
      fetched: true,
      archiveSeen: true,
      tasks: entries.map((entry) =>
        child(task, canonicalArticleUrl(entry.url), 'article', { lastmod: entry.updatedAt?.toISOString() ?? null }),
      ),
      fingerprint: historyHash(entries.map((entry) => entry.url).join('\n')),
      warnings: rawEntries.length !== entries.length ? ['out-of-publication-articles-skipped'] : [],
    };
  }
  const rss = object(root.rss);
  const channel = rss && 'channel' in rss ? object(rss.channel) || {} : null;
  const atom = 'feed' in root ? object(root.feed) || {} : null;
  if (!channel && !atom) throw new Error('invalid_xml_source');
  const container = channel || atom!;
  if (isCommentsFeed(finalUrl, text(container.title)))
    return { tasks: [], entries: [], fetched: true, warnings: ['comments-feed-excluded'] };
  task = { ...task, sourceType: channel ? 'rss' : 'atom' };
  const rawEntries = parseFeed(body, finalUrl);
  const entries = rawEntries.filter((entry) => historyInPublication(entry.url, blog.url));
  const tasks = entries.map((entry) => child(task, canonicalArticleUrl(entry.url), 'entry', { entry: storedEntry(entry) }));
  const next = many(container.link)
    .map(object)
    .filter((link) => link?.['@_rel'] === 'next')
    .map((link) => text(link?.['@_href']));
  const rawNext = [...next, ...linksFromHeader(headers.get('link'))];
  const nextTasks = following(task, rawNext, blog, finalUrl, 'feed');
  const generator = text(container.generator);
  let archiveSeen = Boolean(nextTasks.length || task.payload?.paginated);
  if (/blogger/i.test(generator) && !nextTasks.length && entries.length) {
    const totalText = text(container.totalResults);
    const total = totalText.trim() ? Number(totalText) : NaN;
    const start = Number(text(container.startIndex) || new URL(task.url).searchParams.get('start-index') || '1');
    const count = Number(text(container.itemsPerPage)) || entries.length;
    if (
      Number.isSafeInteger(total) &&
      total >= start - 1 + entries.length &&
      total <= 1_000_000 &&
      Number.isSafeInteger(start) &&
      start > 0 &&
      Number.isSafeInteger(count) &&
      count > 0
    ) {
      archiveSeen = true;
      if (start + count <= total) {
        const url = new URL(task.url);
        url.searchParams.set('start-index', String(start + count));
        url.searchParams.set('max-results', String(Math.min(count, 100)));
        nextTasks.push(child(task, url.href, 'feed', { paginated: true }));
      }
    }
  }
  if (/wordpress\.org/i.test(generator) && !sharedHosts.has(new URL(blog.url).hostname.replace(/^www\./, ''))) {
    const api = new URL('wp-json/wp/v2/posts', new URL(blog.url).origin + '/');
    api.search = 'per_page=30&page=1&orderby=id&order=asc&_embed=1';
    tasks.push(child(task, api.href, 'wordpress', { optional: true, paginated: true }));
  }
  tasks.push(...nextTasks);
  return {
    entries: [],
    tasks,
    fetched: true,
    archiveSeen,
    fingerprint: historyHash(entries.map((entry) => canonicalArticleUrl(entry.url)).join('\n')),
    warnings: [
      ...(rawNext.length && !nextTasks.length ? ['pagination-cycle-or-outside-publication'] : []),
      ...(rawEntries.length !== entries.length ? ['out-of-publication-entries-skipped'] : []),
      ...(!archiveSeen && !/wordpress\.org/i.test(generator) ? ['feed-window-only'] : []),
    ],
  };
}

export function parseHistoryHome(html: string, task: HistoryTask, blog: BlogToCrawl, finalUrl: string): HistoryPageResult {
  const $ = cheerio.load(html);
  const tasks: HistoryTaskInput[] = [];
  const add = (raw: string, kind: HistoryTaskInput['kind'], optional = true) => {
    const url = absolute(raw, finalUrl);
    if (
      url &&
      !isCommentsFeed(url) &&
      !isNonSyndicationSource(url) &&
      historyInPublication(url, blog.url) &&
      !tasks.some((other) => other.url === url)
    )
      tasks.push(child(task, url, kind, { optional }));
  };
  $('link[rel~="alternate"]').each((_, element) => {
    const type = $(element).attr('type') || '';
    if (/rss|atom|xml/i.test(type) && !/oembed/i.test(type)) add($(element).attr('href') || '', 'feed');
  });
  const platform = sharedHosts.has(new URL(blog.url).hostname.replace(/^www\./, ''));
  const prefix = platform ? `${new URL(blog.url).pathname.replace(/\/$/, '')}/` : '/';
  for (const path of ['sitemap.xml', 'sitemap_index.xml', 'wp-sitemap.xml']) add(`${prefix}${path}`, 'sitemap');
  $('link[rel="https://api.w.org/"]').each((_, element) => {
    const endpoint = absolute($(element).attr('href') || '', finalUrl);
    if (endpoint && !platform)
      add(`${endpoint.replace(/\/$/, '')}/wp/v2/posts?per_page=30&page=1&orderby=id&order=asc&_embed=1`, 'wordpress');
  });
  return { entries: [], tasks, fetched: true };
}
function htmlText(value: unknown) {
  return cheerio
    .load(text(object(value)?.rendered ?? value))
    .text()
    .trim();
}
function utc(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function parseHistoryWordpress(
  body: string,
  task: HistoryTask,
  blog: BlogToCrawl,
  finalUrl: string,
  headers: Headers,
): HistoryPageResult {
  const rows: unknown = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('invalid_wordpress_source');
  const entries = rows.flatMap((value): FeedEntry[] => {
    const row = object(value);
    const url = row && absolute(text(row.link), finalUrl);
    if (
      !row ||
      !url ||
      !historyInPublication(url, blog.url) ||
      (row.type && row.type !== 'post') ||
      (row.status && row.status !== 'publish')
    )
      return [];
    const embedded = object(row._embedded);
    const author = object(many(embedded?.author)[0]);
    const media = object(many(embedded?.['wp:featuredmedia'])[0]);
    return [
      {
        guid: text(object(row.guid)?.rendered) || canonicalArticleUrl(url),
        url,
        title: htmlText(row.title) || '未命名文章',
        summary: htmlText(row.excerpt),
        author: text(author?.name) || null,
        publishedAt: utc(row.date_gmt),
        updatedAt: utc(row.modified_gmt),
        imageUrl: absolute(text(media?.source_url), finalUrl),
        categories: [],
      },
    ];
  });
  const tasks = entries.map((entry) => child(task, canonicalArticleUrl(entry.url), 'entry', { entry: storedEntry(entry) }));
  const pages = Number(headers.get('x-wp-totalpages'));
  const page = Number(new URL(finalUrl).searchParams.get('page') || '1');
  if (
    headers.has('x-wp-totalpages') &&
    (!Number.isSafeInteger(pages) || pages < 0 || pages > 1_000_000 || (rows.length > 0 && pages < page))
  )
    throw new Error('history_pagination_metadata_invalid');
  if (rows.length && (!headers.has('x-wp-totalpages') || (Number.isSafeInteger(pages) && pages > page && pages <= 1_000_000))) {
    const next = new URL(finalUrl);
    next.searchParams.set('page', String(page + 1));
    tasks.push(child(task, next.href, 'wordpress', { paginated: true }));
  } else tasks.push(...following(task, linksFromHeader(headers.get('link')), blog, finalUrl, 'wordpress'));
  return {
    entries: [],
    tasks,
    fetched: true,
    archiveSeen: true,
    fingerprint: historyHash(entries.map((entry) => canonicalArticleUrl(entry.url)).join('\n')),
    warnings: rows.length !== entries.length ? ['out-of-publication-entries-skipped'] : [],
  };
}
