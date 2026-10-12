import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { BlogrollLink, BlogrollOptions, BlogrollStore, DiscoveryPage } from './blogroll-contract.ts';
import { isAllowedCrawlUrl, politeFetch } from './feed.ts';

export const BLOGROLL_PARSER_VERSION = 1;
export const BLOGROLL_ROOTS = [
  { url: 'https://blogblog.club/blogrollroll', kind: 'directory' as const },
  { url: 'https://blogblog.club/party', kind: 'party' as const },
  { url: 'https://blogblog.club/random', kind: 'party' as const },
];
const text = (value: string, max = 160) => Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
export function discoveryUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!isAllowedCrawlUrl(url.href) || url.href.length > 1024) return null;
    if (/^(?:localhost|.*\.localhost)$/.test(url.hostname) || /\.(?:local|internal|ts\.net)$/.test(url.hostname)) return null;
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}
const sameHost = (a: string, b: string) => new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
const excluded = new Set([
  'creativecommons.org',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'threads.net',
  't.me',
  'youtube.com',
  'youtu.be',
  'github.com',
  'giscus.app',
  'disqus.com',
]);

/** Directory tables list blogroll pages; child pages can put URLs in any column.
 * This extracts observed links only. It does not infer ownership, merge authors or approve sites. */
export function parseBlogrollPage(html: string, finalUrl: string, kind: DiscoveryPage['kind'], maxLinks = 1000): BlogrollLink[] {
  const $ = cheerio.load(html);
  $('nav,footer,script,style,aside,[role="navigation"],.comments,#comments').remove();
  const content = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const anchors = kind === 'directory' ? content.find('table tr td:first-child a[href]') : content.find('a[href]');
  const links = new Map<string, BlogrollLink>();
  let bytes = 2;
  for (const anchor of anchors.toArray()) {
    const url = discoveryUrl($(anchor).attr('href') || '', finalUrl);
    if (!url || sameHost(url, finalUrl) || links.has(url)) continue;
    const parsed = new URL(url);
    if ([...excluded].some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) continue;
    if (/\.(?:png|jpe?g|webp|gif|svg|ico|pdf|zip|mp[34]|xml|json)(?:$|\?)/i.test(parsed.pathname)) continue;
    const item = { url, text: text($(anchor).text() || $(anchor).find('img').attr('alt') || ''), follow: kind === 'directory' };
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (links.size >= Math.min(1000, maxLinks) || bytes + size > 700 * 1024) break;
    bytes += size;
    links.set(url, item);
  }
  return [...links.values()];
}
const bounded = (value: number | undefined, fallback: number, maximum: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.trunc(value!))) : fallback;
const failure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (/robots/i.test(message)) return 'robots-disallowed';
  if (/unsafe|private|non-public/i.test(message)) return 'unsafe-target';
  if (/exceeds|too large/i.test(message)) return 'response-too-large';
  if (/HTTP \d{3}/.test(message)) return message.match(/HTTP \d{3}/)![0];
  if (/timeout|aborted/i.test(message)) return 'timeout';
  return 'fetch-or-storage-failed';
};

/** Exactly one expansion: directory -> listed blogroll -> external candidates.
 * Cached pages still yield paths and children; fetching and provenance deduplication are separate. */
export async function discoverBlogrolls(store: BlogrollStore, options: BlogrollOptions = {}) {
  const report = {
    source: 'blogblog-club',
    parserVersion: BLOGROLL_PARSER_VERSION,
    inserted: 0,
    observations: 0,
    blogrollEdges: 0,
    requests: 0,
    truncated: false,
    skipped: null as string | null,
    pages: [] as Array<{ url: string; finalUrl?: string; status: string; links?: number; error?: string }>,
  };
  if (!(await store.acquire())) return { ...report, skipped: 'discovery-already-running' };
  try {
    const maxPages = bounded(options.maxPages, 32, 64);
    const maxLinks = bounded(options.maxLinksPerPage, 1000, 1000);
    const maxObservations = bounded(options.maxObservations, 5000, 10000);
    const now = () => (options.now?.() ?? new Date()).toISOString();
    const pages = new Map<string, DiscoveryPage | null>();
    const load = async (url: string, kind: DiscoveryPage['kind']): Promise<DiscoveryPage | null> => {
      const key = `${kind}:${url}`;
      if (pages.has(key)) return pages.get(key)!;
      if (report.requests >= maxPages) {
        report.truncated = true;
        return null;
      }
      const saved = await store.getPage(url);
      let saving = false;
      try {
        const cached = saved?.parserVersion === BLOGROLL_PARSER_VERSION && saved.kind === kind ? saved : null;
        const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml' };
        if (cached?.etag) headers['if-none-match'] = cached.etag;
        if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
        const request = async (conditional: boolean) => {
          if (report.requests >= maxPages) {
            report.truncated = true;
            throw new Error('page budget exhausted');
          }
          report.requests++;
          return politeFetch(url, conditional ? headers : { accept: headers.accept }, {
            ...options,
            delayMs: options.delayMs ?? 1500,
            timeoutMs: options.timeoutMs ?? 10000,
          });
        };
        let response = await request(true);
        let finalUrl = discoveryUrl(response.url || url, url);
        if (response.status === 304 && (!cached || !finalUrl || cached.finalUrl !== finalUrl)) {
          response = await request(false);
          finalUrl = discoveryUrl(response.url || url, url);
        }
        if (!finalUrl) throw new Error('unsafe final URL');
        let page: DiscoveryPage;
        if (response.status === 304 && cached && cached.finalUrl === finalUrl) {
          page = { ...cached, fetchedAt: now() };
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const type = response.headers.get('content-type') || '';
          if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not HTML');
          const body = await response.text();
          page = {
            url,
            finalUrl,
            kind,
            parserVersion: BLOGROLL_PARSER_VERSION,
            etag: (response.headers.get('etag')?.length ?? 0) <= 512 ? response.headers.get('etag') : null,
            lastModified: (response.headers.get('last-modified')?.length ?? 0) <= 255 ? response.headers.get('last-modified') : null,
            bodySha256: createHash('sha256').update(body).digest('hex'),
            fetchedAt: now(),
            links: parseBlogrollPage(body, finalUrl, kind, maxLinks),
          };
        }
        saving = true;
        await store.savePage(page);
        saving = false;
        pages.set(key, page);
        report.pages.push({ url, finalUrl, status: response.status === 304 ? 'not-modified' : 'fetched', links: page.links.length });
        return page;
      } catch (error) {
        if (saving) throw error;
        pages.set(key, null);
        report.pages.push({ url, status: 'error', error: failure(error) });
        return null;
      }
    };
    const roots = options.roots ?? BLOGROLL_ROOTS;
    const queue = roots.map((root) => ({ rootUrl: root.url, url: root.url, kind: root.kind as DiscoveryPage['kind'], depth: 0 }));
    const expanded = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const task = queue[index];
      const url = discoveryUrl(task.url, task.url);
      if (!url) continue;
      const pathKey = `${task.rootUrl}\n${url}\n${task.kind}`;
      if (expanded.has(pathKey)) continue;
      expanded.add(pathKey);
      await store.assertLease?.();
      const page = await load(url, task.kind);
      if (!page) continue;
      const children: typeof queue = [];
      if (page.links.length >= maxLinks) report.truncated = true;
      for (const link of page.links.slice(0, maxLinks)) {
        if (report.observations >= maxObservations) {
          report.truncated = true;
          return report;
        }
        const targetUrl = discoveryUrl(link.url, page.finalUrl);
        if (!targetUrl || sameHost(targetUrl, page.finalUrl)) continue;
        const relation = task.depth === 1 ? 'blogroll' : task.kind === 'directory' ? 'directory' : 'party';
        const path = [task.rootUrl];
        if (task.depth === 1 && url !== path.at(-1)) path.push(url);
        if (page.finalUrl !== path.at(-1)) path.push(page.finalUrl);
        path.push(targetUrl);
        await store.assertLease?.();
        const result = await store.observe({
          rootUrl: task.rootUrl,
          sourceUrl: page.finalUrl,
          targetUrl,
          anchorText: text(link.text),
          relation,
          path,
          bodySha256: page.bodySha256,
          observedAt: page.fetchedAt,
        });
        report.inserted += Number(result.inserted);
        report.observations++;
        if (relation === 'blogroll') report.blogrollEdges++;
        if (task.depth === 0 && task.kind === 'directory' && link.follow)
          children.push({ rootUrl: task.rootUrl, url: targetUrl, kind: 'blogroll', depth: 1 });
      }
      queue.splice(index + 1, 0, ...children);
    }
    return report;
  } finally {
    await store.release();
  }
}
