import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { BlogrollLink, BlogrollOptions, BlogrollStore, DiscoveryPage } from './blogroll-contract.ts';
import { isAllowedCrawlUrl, politeFetch } from './feed.ts';

export const BLOGROLL_PARSER_VERSION = 2;
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

const isPartyIndexUrl = (url: string) => new URL(url).hostname === 'blogblog.club' && new URL(url).pathname.replace(/\/$/, '') === '/party';

/** Directory tables list blogroll pages; child pages can put URLs in any column.
 * This extracts observed links only. It does not infer ownership, merge authors or approve sites. */
function parsePage(html: string, finalUrl: string, kind: DiscoveryPage['kind'], maxLinks = 1000) {
  const $ = cheerio.load(html);
  $('nav,footer,script,style,aside,[role="navigation"],.comments,#comments').remove();
  const content = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  let anchors = (kind === 'directory' ? content.find('table tr td:first-child a[href]') : content.find('a[href]')).toArray();
  const monthSources = new Set<string>();
  const isPartyIndex = kind === 'party' && isPartyIndexUrl(finalUrl);
  if (isPartyIndex) {
    // The official index embeds all months on one page. Expand only its explicitly
    // labelled recap (or topic until a recap exists), never a participant article.
    for (const heading of content.find('h2,h3').toArray()) {
      if (!/第\s*\d+\s*期/.test($(heading).text())) continue;
      const section = $(heading).nextUntil('h2,h3');
      const list = section.filter('li').add(section.find('li'));
      const labelled = (label: RegExp) =>
        list.filter((_, el) => label.test($(el).clone().children('ul,ol').remove().end().text().trim())).find('a[href]');
      const recaps = labelled(/^回顧文章[：:]/);
      const sources = recaps.length ? recaps : labelled(/^主題頁面[：:]/);
      for (const anchor of sources.toArray().slice(0, 1)) {
        const url = discoveryUrl($(anchor).attr('href') || '', finalUrl);
        if (url) monthSources.add(url);
      }
    }
    const monthHosts = new Set([...monthSources].map((url) => new URL(url).hostname.replace(/^www\./, '')));
    const priority = (anchor: (typeof anchors)[number]) => {
      const url = discoveryUrl($(anchor).attr('href') || '', finalUrl);
      if (url && monthSources.has(url)) return 0;
      if (!/^參與者[（(]/.test($(anchor).closest('li').text().trim())) return 1;
      // A recap excludes its own host, so preserve the host's submissions here.
      return url && monthHosts.has(new URL(url).hostname.replace(/^www\./, '')) ? 2 : 3;
    };
    anchors = anchors
      .map((anchor) => ({ anchor, priority: priority(anchor) }))
      .sort((a, b) => a.priority - b.priority)
      .map(({ anchor }) => anchor);
  }
  const links = new Map<string, BlogrollLink>();
  let bytes = 2;
  const omitted = new Set<string>();
  let omittedOverflow = false;
  for (const anchor of anchors) {
    const url = discoveryUrl($(anchor).attr('href') || '', finalUrl);
    if (!url || sameHost(url, finalUrl) || links.has(url)) continue;
    const parsed = new URL(url);
    if ([...excluded].some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) continue;
    if (/\.(?:png|jpe?g|webp|gif|svg|ico|pdf|zip|mp[34]|xml|json)(?:$|\?)/i.test(parsed.pathname)) continue;
    const item = {
      url,
      text: text($(anchor).text() || $(anchor).find('img').attr('alt') || ''),
      follow: kind === 'directory' || monthSources.has(url),
    };
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (links.size >= Math.min(1000, maxLinks) || bytes + size > 700 * 1024) {
      const hash = createHash('sha256').update(url).digest('hex');
      if (omitted.size < 5000) omitted.add(hash);
      else if (!omitted.has(hash)) omittedOverflow = true;
      continue;
    }
    bytes += size;
    omitted.delete(createHash('sha256').update(url).digest('hex'));
    links.set(url, item);
  }
  return { links: [...links.values()], omitted, omittedOverflow, isPartyIndex };
}
export function parseBlogrollPage(html: string, finalUrl: string, kind: DiscoveryPage['kind'], maxLinks = 1000): BlogrollLink[] {
  return parsePage(html, finalUrl, kind, maxLinks).links;
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

/** Exactly one expansion: directory -> listed blogroll, or party index -> labelled month source.
 * Cached pages still yield paths and children; fetching and provenance deduplication are separate. */
export async function discoverBlogrolls(store: BlogrollStore, options: BlogrollOptions = {}) {
  const report = {
    source: 'blogblog-club',
    parserVersion: BLOGROLL_PARSER_VERSION,
    inserted: 0,
    observations: 0,
    blogrollEdges: 0,
    requests: 0,
    partyCoverage: [] as Array<{
      rootUrl: string;
      status: 'measured' | 'cached-unknown';
      omitted: number | null;
      recovered: number;
      remaining: number | null;
      overflow: boolean;
    }>,
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
    const partyOmissions = new Map<string, Set<string>>();
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
          if (kind === 'party' && isPartyIndexUrl(cached.finalUrl))
            report.partyCoverage.push({
              rootUrl: url,
              status: 'cached-unknown',
              omitted: null,
              recovered: 0,
              remaining: null,
              overflow: false,
            });
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const type = response.headers.get('content-type') || '';
          if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not HTML');
          const body = await response.text();
          const parsed = parsePage(body, finalUrl, kind, maxLinks);
          if (parsed.isPartyIndex) {
            partyOmissions.set(url, parsed.omitted);
            report.partyCoverage.push({
              rootUrl: url,
              status: 'measured',
              omitted: parsed.omitted.size,
              recovered: 0,
              remaining: parsed.omitted.size,
              overflow: parsed.omittedOverflow,
            });
          }
          if (parsed.omitted.size || parsed.omittedOverflow) report.truncated = true;
          page = {
            url,
            finalUrl,
            kind,
            parserVersion: BLOGROLL_PARSER_VERSION,
            etag: (response.headers.get('etag')?.length ?? 0) <= 512 ? response.headers.get('etag') : null,
            lastModified: (response.headers.get('last-modified')?.length ?? 0) <= 255 ? response.headers.get('last-modified') : null,
            bodySha256: createHash('sha256').update(body).digest('hex'),
            fetchedAt: now(),
            links: parsed.links,
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
        const relation = task.kind === 'blogroll' ? 'blogroll' : task.kind === 'directory' ? 'directory' : 'party';
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
        if (task.depth === 1 && relation === 'party') {
          const rootKey = discoveryUrl(task.rootUrl, task.rootUrl)!;
          const omitted = partyOmissions.get(rootKey);
          if (omitted?.delete(createHash('sha256').update(targetUrl).digest('hex'))) {
            const coverage = report.partyCoverage.find((item) => item.rootUrl === rootKey)!;
            coverage.recovered++;
            coverage.remaining = omitted.size;
          }
        }
        if (task.depth === 0 && link.follow && (task.kind === 'directory' || (task.kind === 'party' && isPartyIndexUrl(page.finalUrl))))
          children.push({ rootUrl: task.rootUrl, url: targetUrl, kind: task.kind === 'directory' ? 'blogroll' : 'party', depth: 1 });
      }
      queue.splice(index + 1, 0, ...children);
    }
    return report;
  } finally {
    await store.release();
  }
}
