import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { normalizeLink, type PublicationAlias, resolvePublication } from './identity.ts';

export const PARSER_VERSION = 'semantic-links-v1';
export type LinkLocation = 'body' | 'sidebar' | 'blogroll' | 'comment';
export type ParsedLink = {
  targetUrl: string;
  targetBlogId: number | null;
  anchorText: string;
  context: string;
  location: LinkLocation;
  ordinal: number;
};
export type ParsedArticle = {
  bodyText: string | null;
  contentHash: string;
  extraction: string;
  truncated: boolean;
  externalLinks: number;
  links: ParsedLink[];
};
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const COMMENT = '[id*="comment" i],[class*="comment" i], [role="comment"]';
const BLOGROLL = '[id*="blogroll" i],[class*="blogroll" i],[id*="linkcat" i],[class*="blogroll-links" i]';
const SIDEBAR = 'aside,[role="complementary"],[id*="sidebar" i],[class*="sidebar" i]';
const BODY = '[itemprop="articleBody"],.entry-content,.post-content,.article-content,.post-body';

/** Only semantic article containers count as body. A generic page is not guessed to be an article. */
export function parseArticleLinks(
  html: string,
  pageUrl: string,
  sourceBlogId: number,
  aliases: PublicationAlias[],
  maxLinks = 100,
): ParsedArticle {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,form,input,textarea,select').remove();
  const excludedBody = `${COMMENT},${SIDEBAR},${BLOGROLL},nav,footer,header`;
  let bodies = $(BODY).filter((_, el) => $(el).closest(excludedBody).length === 0);
  let extraction = 'article-body';
  if (!bodies.length) {
    bodies = $('article').filter((_, el) => $(el).closest(excludedBody).length === 0);
    extraction = 'article';
  }
  if (!bodies.length) extraction = 'no-semantic-body';
  const bodyNodes = new Set(bodies.toArray());
  const textParts: string[] = [];
  bodies.each((_, el) => {
    if (
      $(el)
        .parents()
        .toArray()
        .some((parent) => bodyNodes.has(parent))
    )
      return;
    const copy = $(el).clone();
    copy.find(`${COMMENT},${SIDEBAR},${BLOGROLL},nav,footer,header`).remove();
    textParts.push(clean(copy.text()));
  });
  const fullBody = clean(textParts.join(' '));
  // At most 60KB even for supplementary-plane Unicode; keywords remain bounded.
  let bodyText = clip(fullBody, 18000);
  while (Buffer.byteLength(bodyText, 'utf8') > 60000) bodyText = clip(bodyText, Array.from(bodyText).length - 1000);
  let truncated = bodyText !== fullBody;
  const links: ParsedLink[] = [];
  let externalLinks = 0;
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const anchor = $(el);
    let location: LinkLocation | null = null;
    if (anchor.closest(COMMENT).length) location = 'comment';
    else if (anchor.closest(BLOGROLL).length) location = 'blogroll';
    else if (anchor.closest(SIDEBAR).length) location = 'sidebar';
    else if (
      anchor
        .parents()
        .toArray()
        .some((parent) => bodyNodes.has(parent)) &&
      !anchor.closest('nav,footer,header').length
    )
      location = 'body';
    if (!location) return;
    const raw = anchor.attr('href')?.trim();
    if (!raw || raw.startsWith('#')) return;
    const targetUrl = normalizeLink(raw, pageUrl);
    if (!targetUrl) return;
    const targetBlogId = resolvePublication(targetUrl, aliases);
    if (targetBlogId === sourceBlogId) return;
    if (
      !targetBlogId &&
      new URL(targetUrl).origin === new URL(pageUrl).origin &&
      !/^(?:www\.)?(?:medium.com|vocus.cc|blog.udn.com)$/.test(new URL(pageUrl).hostname)
    )
      return;
    const anchorText = clip(clean(anchor.text()), 255);
    const key = `${location}\n${targetUrl}\n${anchorText}`;
    if (seen.has(key)) return;
    seen.add(key);
    externalLinks++;
    if (links.filter((link) => link.location === location).length >= 100) {
      truncated = true;
      return;
    }
    const surrounding = clean(anchor.parent().text());
    const anchorIndex = surrounding.indexOf(anchorText);
    const context = clip(anchorIndex > 100 ? surrounding.slice(anchorIndex - 100) : surrounding, 320);
    links.push({ targetUrl, targetBlogId, anchorText, context, location, ordinal: links.length });
  });
  const priority = { body: 0, blogroll: 1, sidebar: 2, comment: 3 };
  const selected = links
    .sort((a, b) => priority[a.location] - priority[b.location] || a.ordinal - b.ordinal)
    .slice(0, Math.max(1, Math.min(100, maxLinks)))
    .map((link, ordinal) => ({ ...link, ordinal }));
  if (selected.length < externalLinks) truncated = true;
  return {
    bodyText: bodies.length ? bodyText : null,
    contentHash: createHash('sha256')
      .update(JSON.stringify({ bodyText, links: selected }))
      .digest('hex'),
    extraction,
    truncated,
    externalLinks,
    links: selected,
  };
}
