import { articleInPublication, canonicalArticleUrl, isAllowedCrawlUrl } from '../crawl/feed.ts';
import { type VocusArticleProof, vocusArticleCandidate } from '../crawl/vocus-publication.ts';

export const SCRAPER_POLICY = 'generated-scraper-v1';
export const MAX_CODE_BYTES = 40 * 1024;
export const MAX_LIST_PAGES = 3;
export const MAX_HISTORY_PAGES = 20;
export type ScraperTrigger = 'new_candidate' | 'feed_dead' | 'scraper_failing' | 'content_failing';
/** render: pages are read after a headless browser runs them (render.ts). The other two flags are the model's
 * reading of the site for this round only: no articles published yet, or content that needs scripts to appear. */
export type GeneratedScraper = {
  listUrls: string[];
  maxPages: number;
  code: string;
  notes: string;
  render: boolean;
  noArticles: boolean;
  needsRender: boolean;
};
export type ListedPost = { url: string; title: string | null; publishedAt: Date | null };
export type ListedPage = { posts: ListedPost[]; next: string | null };
export type ParsedPost = { title: string; author: string | null; publishedAt: Date | null; tags: string[]; bodyHtml: string };

/** Not a boundary (sandbox.ts is): a cheap refusal of code that plainly reaches for anything but the page. */
const FORBIDDEN =
  /\b(?:require|import|process|globalThis|global|constructor|__proto__|prototype|Function|eval|fetch|XMLHttpRequest|WebSocket|WebAssembly|Reflect|Proxy|setTimeout|setInterval|queueMicrotask|Atomics|SharedArrayBuffer)\b/;
export function lintScraperCode(code: string): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'code_empty';
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) return 'code_too_large';
  const match = code.match(FORBIDDEN);
  if (match) return `code_forbidden_identifier:${match[0]}`;
  if (!/\bfunction\s+listPosts\s*\(/.test(code)) return 'code_missing_listPosts';
  if (!/\bfunction\s+parsePost\s*\(/.test(code)) return 'code_missing_parsePost';
  return null;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '';
export function scraperDate(value: unknown, now = new Date()): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < Date.UTC(1990, 0, 1) || time > now.getTime() + 86400000) return null;
  return date;
}
function resolved(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol) || !isAllowedCrawlUrl(url.href)) return null;
    return canonicalArticleUrl(url.href);
  } catch {
    return null;
  }
}
/** Sandbox output is untrusted: only same-publication article URLs survive, the home itself never does. */
export function listedPage(value: unknown, pageUrl: string, home: string, now = new Date()): ListedPage {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const posts: ListedPost[] = [];
  const seen = new Set<string>();
  const homeKey = canonicalArticleUrl(home).replace(/\/$/, '');
  for (const item of Array.isArray(raw.posts) ? raw.posts.slice(0, 200) : []) {
    const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const url = resolved(entry.url, pageUrl);
    if (
      !url ||
      seen.has(url) ||
      url.replace(/\/$/, '') === homeKey ||
      !(articleInPublication(url, home) || vocusArticleCandidate(url, home))
    )
      continue;
    seen.add(url);
    posts.push({ url, title: text(entry.title, 512) || null, publishedAt: scraperDate(entry.publishedAt, now) });
  }
  const next = resolved(raw.next, pageUrl);
  return { posts, next: next && next !== canonicalArticleUrl(pageUrl) && articleInPublication(next, home) ? next : null };
}
/** Site-section and placeholder labels that say nothing about an article (Hugo's `blog` section, WordPress's
 * Uncategorized). Only scraper tags are filtered; feed categories stay as their authors wrote them. */
export const GENERIC_TAGS = new Set([
  'blog',
  'blogs',
  'post',
  'posts',
  'article',
  'articles',
  'news',
  'home',
  'uncategorized',
  'uncategorised',
  'general',
  'misc',
  'default',
  '未分類',
  '未分类',
  '無分類',
  '其他',
  '文章',
  '部落格',
  '博客',
  '網誌',
  '首頁',
]);
export function parsedPost(value: unknown, now = new Date()): ParsedPost | null {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!raw) return null;
  const title = text(raw.title, 512);
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml : '';
  if (!title || !bodyHtml.trim() || Buffer.byteLength(bodyHtml) > 512 * 1024) return null;
  const tags = [
    ...new Set(
      (Array.isArray(raw.tags) ? raw.tags : [])
        .map((tag) => text(tag, 60).replace(/^#/, ''))
        .filter((tag) => tag && !GENERIC_TAGS.has(tag.normalize('NFKC').toLowerCase())),
    ),
  ].slice(0, 20);
  return { title, author: text(raw.author, 255) || null, publishedAt: scraperDate(raw.publishedAt, now), tags, bodyHtml };
}
export function generatedScraper(value: unknown, home: string): GeneratedScraper {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const listUrls = [
    ...new Set((Array.isArray(raw.listUrls) ? raw.listUrls : []).map((u) => resolved(u, home)).filter((u): u is string => !!u)),
  ]
    .filter((u) => articleInPublication(u, home) || canonicalArticleUrl(u) === canonicalArticleUrl(home))
    .slice(0, 3);
  if (!listUrls.length) listUrls.push(canonicalArticleUrl(home));
  const maxPages = Math.max(1, Math.min(MAX_LIST_PAGES, Number.isSafeInteger(raw.maxPages) ? Number(raw.maxPages) : 1));
  return {
    listUrls,
    maxPages,
    code: typeof raw.code === 'string' ? raw.code : '',
    notes: text(raw.notes, 1000),
    render: false,
    noArticles: raw.noArticles === true,
    needsRender: raw.needsRender === true,
  };
}
/** The body parsePost chose, as a page the existing extractor reads like any article (content/article-content.ts). */
export function scraperArticleHtml(post: ParsedPost, url: string, proof?: VocusArticleProof) {
  const attr = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const ownership = proof
    ? `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { parsedArticle: { _id: proof.articleId, salonId: proof.salonId, userId: proof.userId, salon: { _id: proof.salonId } } } } })}</script>`
    : '';
  return `<!doctype html><html><head>${ownership}<title>${attr(post.title)}</title><link rel="canonical" href="${attr(url)}"></head><body><article class="generated-scraper-body">${post.bodyHtml}</article></body></html>`;
}
