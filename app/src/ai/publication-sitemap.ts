import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { publicationContains } from '../crawl/candidate-validation.ts';
import {
  type FeedCrawlerOptions,
  type FeedEntry,
  parseSitemapArticle,
  politeFetch,
  rankedSitemapUrls,
  readFeedBody,
} from '../crawl/feed.ts';
export type SitemapArticleEvidence = {
  url: string;
  canonicalUrl: string;
  title: string;
  author: string;
  schemaType: 'BlogPosting' | 'Article';
  publishedAt: string | null;
  htmlSha256: string;
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const array = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const pageKey = (v: string) => {
  const u = new URL(v);
  return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search;
};
export function sitemapArticleProof(html: string, url: string, home: string): SitemapArticleEvidence | null {
  if (!publicationContains(url, home) || pageKey(url) === pageKey(home)) return null;
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical) return null;
  let canonicalUrl: string;
  try {
    canonicalUrl = new URL(canonical, url).href;
    if (!publicationContains(canonicalUrl, home) || pageKey(canonicalUrl) !== pageKey(url)) return null;
  } catch {
    return null;
  }
  const nodes: Record<string, unknown>[] = [];
  let visited = 0;
  const inspect = (v: unknown) => {
    if (++visited > 128) return;
    if (Array.isArray(v)) {
      for (const item of v) inspect(item);
      return;
    }
    const node = object(v);
    if (!Object.keys(node).length) return;
    nodes.push(node);
    if (node['@graph']) inspect(node['@graph']);
    if (node.mainEntity) inspect(node.mainEntity);
  };
  for (const el of $('script[type="application/ld+json"]').slice(0, 20).toArray()) {
    const raw = $(el).text();
    if (raw.length > 256000) continue;
    try {
      inspect(JSON.parse(raw));
    } catch {}
  }
  const types = (v: unknown) => array(v).map((x) => String(x).replace(/^https?:\/\/schema\.org\//, ''));
  for (const node of nodes) {
    const kind = types(node['@type']).find((t) => t === 'BlogPosting' || t === 'Article');
    if (!kind) continue;
    const identity = typeof node.url === 'string' ? node.url : typeof node['@id'] === 'string' ? node['@id'] : null;
    if (identity) {
      try {
        if (pageKey(new URL(identity, url).href) !== pageKey(url)) continue;
      } catch {
        continue;
      }
    }
    const author = array(node.author)
      .map(object)
      .map((a) => (Object.keys(a).length === 1 && a['@id'] ? nodes.find((n) => n['@id'] === a['@id']) || a : a))
      .find((a) => types(a['@type']).includes('Person') && typeof a.name === 'string' && a.name.trim().length >= 2);
    if (!author) continue;
    const candidate: FeedEntry = {
      guid: url,
      url,
      title: '',
      summary: '',
      author: null,
      publishedAt: null,
      updatedAt: null,
      imageUrl: null,
      categories: [],
    };
    const parsed = parseSitemapArticle(html, candidate, url);
    if (!parsed?.title || !parsed.author) continue;
    return {
      url,
      canonicalUrl,
      title: parsed.title,
      author: String(author.name).trim().slice(0, 255),
      schemaType: kind as 'BlogPosting' | 'Article',
      publishedAt: parsed.publishedAt?.toISOString() || null,
      htmlSha256: createHash('sha256').update(html).digest('hex'),
    };
  }
  return null;
}
/** At most 3 sitemap XML pages, depth 2 and 3 actual article pages; every request uses politeFetch. */
export async function verifyArticleSitemap(
  sourceUrl: string,
  home: string,
  options: FeedCrawlerOptions = {},
): Promise<SitemapArticleEvidence[]> {
  const queue = [{ url: sourceUrl, depth: 0 }];
  const visited = new Set<string>();
  let articleRequests = 0;
  while (queue.length && visited.size < 3) {
    const current = queue.shift()!;
    if (visited.has(current.url) || !publicationContains(current.url, home)) continue;
    visited.add(current.url);
    const response = await politeFetch(current.url, {}, options);
    if (!response.ok) {
      await response.body?.cancel();
      continue;
    }
    const final = response.url || current.url;
    if (!publicationContains(final, home)) {
      await response.body?.cancel();
      continue;
    }
    const xml = await readFeedBody(response);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) continue;
    const root = object(new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true }).parse(xml));
    if (root.sitemapindex && current.depth < 2) {
      const children = array(object(root.sitemapindex).sitemap)
        .map((v) => object(v).loc)
        .filter((v): v is string => typeof v === 'string')
        .filter((v) => publicationContains(v, home));
      for (const url of rankedSitemapUrls(children).slice(0, 3)) queue.push({ url, depth: current.depth + 1 });
      continue;
    }
    const urls = array(object(root.urlset).url)
      .map((v) => object(v).loc)
      .filter((v): v is string => typeof v === 'string')
      .filter((v) => publicationContains(v, home));
    for (const url of urls) {
      if (articleRequests >= 3) return [];
      if (pageKey(url) === pageKey(home)) continue;
      articleRequests++;
      const page = await politeFetch(url, {}, options);
      if (!page.ok) {
        await page.body?.cancel();
        continue;
      }
      const finalUrl = page.url || url;
      if (!publicationContains(finalUrl, home)) {
        await page.body?.cancel();
        continue;
      }
      const evidence = sitemapArticleProof(await readFeedBody(page), finalUrl, home);
      if (evidence) return [evidence];
    }
  }
  return [];
}
