/** ArticleRules/cleaned-root extraction adapted from tag.analysis.tw afe0a65.
 * MIT Copyright (c) 2026 Sky Hong. No newsroom minimum length or image-only rejection. */
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { articleIdentityKey, canonicalArticleUrl } from '../crawl/feed.ts';
import { identityKey, normalizeLink, publicationHome } from '../relations/identity.ts';
import { articleNodes } from './article-nodes.ts';
import {
  type ContentEvidence,
  type ContentRule,
  type ExtractedContent,
  MAX_CONTENT_HTML_BYTES,
  MAX_CONTENT_TEXT_BYTES,
  utf8Prefix,
} from './contracts.ts';
import { ADAPTER_SELECTORS, inferPlatform } from './registry.ts';

const GENERIC = [
  '[itemprop="articleBody"]',
  '[data-article-body]',
  '#article-body',
  '.article-body',
  '.entry-content',
  '.post-content',
  '.article-content',
  '.post-body',
  'article',
];
const REMOVE =
  'script,style,noscript,template,iframe,svg,math,object,embed,nav,aside,header,footer,form,input,button,select,textarea,[hidden],[aria-hidden="true"],[role="navigation"],[role="complementary"],.sharedaddy,.jp-relatedposts,.yarpp,.yarpp-related,.related-posts,.addtoany,.post-tags,.tagcloud,.comments,.comment,.comment-list,.commentlist,.wp-block-comments,.wp-comments,.discussion,#disqus_thread,.comment-body,.comment-content,[role="comment"],.blogroll,.blogroll-links,.linkcat,.sidebar,.widget-area,.site-sidebar,#comments,#respond';
const PAYWALL =
  /(?:請(?:先)?登入.{0,16}(?:閱讀|全文)|訂閱.{0,16}(?:閱讀|全文)|subscribe to (?:read|continue)|sign in to (?:read|continue)|members.only content)/i;
const CHALLENGE =
  /(?:checking your browser|verify (?:that )?you are (?:a )?human|just a moment|access denied|確認您是否為真人|驗證您是人類)/i;
const MORE = /(?:繼續閱讀|閱讀全文|read (?:the )?(?:full|more)|continue reading)/i;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function inPublication(article: string, home: string): boolean {
  const a = normalizeLink(article),
    b = normalizeLink(home);
  if (!a || !b) return false;
  const ah = publicationHome(a),
    bh = publicationHome(b);
  if (!ah || !bh || identityKey(ah) !== identityKey(bh)) return false;
  const base = new URL(b),
    url = new URL(a);
  if (base.hostname === 'home.gamer.com.tw') return base.searchParams.get('owner') === url.searchParams.get('owner');
  const path = base.pathname.replace(/\/$/, '');
  return !path || url.pathname === path || url.pathname.startsWith(path + '/');
}
export function extractContent(evidence: ContentEvidence, rule: ContentRule): ExtractedContent {
  const bounded = utf8Prefix(evidence.html, MAX_CONTENT_HTML_BYTES);
  let truncated = Boolean(evidence.truncated) || bounded.length !== evidence.html.length;
  const $ = cheerio.load(bounded),
    platform = rule.platform === 'generic' ? inferPlatform(evidence.articleUrl, bounded) : rule.platform;
  const syndicated = evidence.kind !== 'article-html';
  let reason: string | null = null;
  let identityMismatch =
    evidence.kind === 'article-html' && articleIdentityKey(evidence.articleUrl) !== articleIdentityKey(evidence.sourceUrl);
  let root: cheerio.Cheerio<import('domhandler').AnyNode> = syndicated ? $('body') : $([]);
  let structured = '';
  if (!syndicated) {
    const canonical = $('link[rel="canonical"]').first().attr('href');
    if (canonical) {
      const url = normalizeLink(canonical, evidence.sourceUrl);
      if (
        !url ||
        !inPublication(url, evidence.blogUrl) ||
        ![evidence.articleUrl].some((value) => articleIdentityKey(value) === articleIdentityKey(url))
      )
        identityMismatch = true;
    }
    if (
      articleIdentityKey(evidence.sourceUrl) === articleIdentityKey(evidence.blogUrl) &&
      articleIdentityKey(evidence.articleUrl) !== articleIdentityKey(evidence.blogUrl)
    )
      identityMismatch = true;
    const selectors = [...(rule.rules.bodySelector ? [rule.rules.bodySelector] : []), ...(ADAPTER_SELECTORS[platform] ?? []), ...GENERIC];
    for (const selector of selectors) {
      try {
        const candidate = $(selector)
          .filter(
            (_, el) =>
              !$(el)
                .add($(el).parents())
                .is(
                  'aside,nav,footer,header,.comment,.comments,.commentlist,.wp-block-comments,.wp-comments,.discussion,#disqus_thread,#comments,[role="comment"]',
                ),
          )
          .first();
        if (candidate.length) {
          root = candidate;
          break;
        }
      } catch {
        reason = 'invalid-body-selector';
      }
    }
    if (!root.length) {
      const nodes = articleNodes($, evidence.sourceUrl);
      const body = nodes.find((n) => typeof n.articleBody === 'string')?.articleBody;
      if (typeof body === 'string') structured = body;
    }
  }
  const pageTitle = clean($('title').text()),
    candidateText = clean(root.text());
  const blocked = CHALLENGE.test(pageTitle) || (!root.length && CHALLENGE.test(clean($('body').text()).slice(0, 500)));
  const paywall =
    PAYWALL.test(candidateText) || $('meta[property="article:content_tier"][content="locked"],.paywall,[data-paywall]').length > 0;
  const excerpt =
    syndicated &&
    (evidence.completeness === 'partial' ||
      root
        .find('a')
        .toArray()
        .some(
          (a) =>
            MORE.test($(a).text()) && normalizeLink($(a).attr('href') || '', evidence.articleUrl) === normalizeLink(evidence.articleUrl),
        ));
  const copy = root.clone();
  copy.find(REMOVE).remove();
  copy.find('a[rel~="tag"]').remove();
  if (rule.rules.bodyExcludeSelector)
    try {
      copy.find(rule.rules.bodyExcludeSelector).remove();
    } catch {
      reason = 'invalid-exclude-selector';
    }
  // Keep only static prose/link/image semantics. Never persist executable attributes or embedded documents.
  copy.find('*').each((_, el) => {
    for (const attr of Object.keys(el.attribs))
      if (!['alt', 'title', ...(el.name === 'a' ? ['href'] : []), ...(el.name === 'img' ? ['src'] : [])].includes(attr))
        $(el).removeAttr(attr);
    if (el.name === 'a') {
      const href = normalizeLink($(el).attr('href') || '', evidence.articleUrl);
      if (href) $(el).attr('href', href);
      else $(el).removeAttr('href');
    }
    if (el.name === 'img') {
      const src = normalizeLink($(el).attr('src') || '', evidence.articleUrl);
      if (src) $(el).attr('src', src);
      else $(el).removeAttr('src');
    }
  });
  copy.find('br').replaceWith('\n');
  copy.find('p,div,section,blockquote,li').append('\n');
  const text = clean(copy.text()) || clean(structured);
  const bodyText = utf8Prefix(text, MAX_CONTENT_TEXT_BYTES);
  truncated ||= bodyText.length !== text.length;
  const imageOnly = !bodyText && copy.find('img[src]').length > 0;
  let bodyHtml = structured && !root.length ? `<p>${esc(structured)}</p>` : copy.html() || '';
  bodyHtml = utf8Prefix(bodyHtml, MAX_CONTENT_HTML_BYTES);
  truncated ||= Buffer.byteLength(copy.html() || '') > MAX_CONTENT_HTML_BYTES;
  const missing = !bodyText && !imageOnly;
  let completeness = !syndicated && evidence.completeness !== 'partial' ? 'full' : (evidence.completeness ?? 'unknown');
  if (excerpt || paywall || truncated) completeness = 'partial';
  if (identityMismatch) reason = 'article-identity-mismatch';
  else if (blocked) reason = 'challenge';
  else if (paywall) reason = 'paywall';
  else if (excerpt) reason = 'publisher-excerpt';
  else if (missing) reason = 'no-semantic-body';
  else if (truncated) reason = 'content-limit';
  const status = blocked || identityMismatch ? 'blocked' : missing ? 'missing' : completeness === 'full' ? 'ok' : 'partial';
  return {
    bodyText: status === 'blocked' ? '' : bodyText,
    bodyHtml: status === 'blocked' ? '' : bodyHtml,
    hash: createHash('sha256')
      .update(JSON.stringify([bodyText, bodyHtml, completeness, rule.version, rule.revision]))
      .digest('hex'),
    platform,
    adapterId: `${platform}-public`,
    completeness,
    status,
    reason,
    imageOnly,
    truncated,
    sourceKind: evidence.kind,
    coverage: syndicated ? 'syndicated-body-only' : 'html-page',
  };
}
/** Only public REST rows for the exact requested article may become body evidence. */
export function wordpressEvidence(json: string, evidence: Omit<ContentEvidence, 'html' | 'kind'>): ContentEvidence | null {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  for (const row of rows.slice(0, 5)) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.link !== 'string' ||
      typeof row.content?.rendered !== 'string' ||
      row.content?.protected ||
      (row.status && row.status !== 'publish')
    )
      continue;
    if (!inPublication(row.link, evidence.blogUrl) || canonicalArticleUrl(row.link) !== canonicalArticleUrl(evidence.articleUrl)) continue;
    const modified = typeof row.modified_gmt === 'string' ? new Date(row.modified_gmt.replace(/Z$/, '') + 'Z') : null;
    return {
      ...evidence,
      html: row.content.rendered,
      kind: 'wordpress-api',
      completeness: 'full',
      modifiedAt: modified && Number.isFinite(modified.getTime()) ? modified : evidence.modifiedAt,
    };
  }
  return null;
}
export function discoverWordpressApi(html: string, articleUrl: string): string | null {
  const $ = cheerio.load(html);
  const raw = $('link[rel="https://api.w.org/"]').first().attr('href');
  if (!raw) return null;
  const url = normalizeLink(raw, articleUrl);
  if (!url) return null;
  const u = new URL(url);
  return u.origin === new URL(articleUrl).origin && /\/wp-json\/?$/.test(u.pathname) ? u.href : null;
}
