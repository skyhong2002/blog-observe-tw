import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { identityKey, normalizeLink, type PublicationAlias, publicationHome, resolvePublication } from './identity.ts';
export const PARSER_VERSION = 'semantic-links-v3';
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
  nonBodySnapshotState?: 'current-parser' | 'unverified' | 'none';
};
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const COMMENT = new Set([
  'comment',
  'comments',
  'comment-list',
  'commentlist',
  'comment-body',
  'comment-content',
  'comment-respond',
  'respond',
]);
const BLOGROLL = new Set(['blogroll', 'blogroll-links', 'linkcat']);
const SIDEBAR = new Set(['sidebar', 'widget-area', 'secondary', 'site-sidebar']);
const WIDGETS = new Set([
  'sharedaddy',
  'jp-relatedposts',
  'yarpp',
  'yarpp-related',
  'related-posts',
  'relatedposts',
  'addtoany',
  'addtoany_share_save_container',
  'post-tags',
  'tagcloud',
  'post-navigation',
  'crp_related',
]);
const tokens = (el: Element) => [...(el.attribs.class || '').toLowerCase().split(/\s+/), (el.attribs.id || '').toLowerCase()];
function semantic(el: Element): LinkLocation | null {
  const t = tokens(el),
    role = el.attribs.role?.toLowerCase();
  if (role === 'comment' || t.some((x) => COMMENT.has(x) || /^comment-\d+$/.test(x))) return 'comment';
  if (t.some((x) => BLOGROLL.has(x) || /^linkcat-\d+$/.test(x))) return 'blogroll';
  if (el.name === 'aside' || role === 'complementary' || t.some((x) => SIDEBAR.has(x))) return 'sidebar';
  return null;
}
const excluded = (el: Element) => ['nav', 'header', 'footer'].includes(el.name) || tokens(el).some((x) => WIDGETS.has(x));
/** Class names are tokens, and article classification stops at its semantic body boundary. */
export function parseArticleLinks(
  html: string,
  pageUrl: string,
  sourceBlogId: number,
  aliases: PublicationAlias[],
  maxLinks = 100,
): ParsedArticle {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,form,input,textarea,select').remove();
  const allowedBody = (el: Element) => ![el, ...$(el).parents().toArray()].some((parent) => semantic(parent) || excluded(parent));
  let bodies = $('[itemprop="articleBody"],.entry-content,.post-content,.article-content,.post-body').filter((_, el) => allowedBody(el));
  let extraction = 'article-body';
  if (!bodies.length) {
    bodies = $('article').filter((_, el) => allowedBody(el));
    extraction = 'article';
  }
  if (!bodies.length) extraction = 'no-semantic-body';
  const bodyNodes = new Set(bodies.toArray()),
    textParts: string[] = [];
  bodies.each((_, el) => {
    if (
      $(el)
        .parents()
        .toArray()
        .some((parent) => bodyNodes.has(parent))
    )
      return;
    const copy = $(el).clone();
    copy
      .find('*')
      .filter((_, child) => !!semantic(child) || excluded(child))
      .remove();
    copy.find('a[rel~="tag"]').remove();
    textParts.push(clean(copy.text()));
  });
  const fullBody = clean(textParts.join(' '));
  let bodyText = clip(fullBody, 18000);
  while (Buffer.byteLength(bodyText) > 60000) bodyText = clip(bodyText, Array.from(bodyText).length - 1000);
  let truncated = bodyText !== fullBody,
    externalLinks = 0;
  const links: ParsedLink[] = [],
    seen = new Set<string>(),
    counts = { body: 0, blogroll: 0, sidebar: 0, comment: 0 };
  $('a[href]').each((_, el) => {
    const anchor = $(el);
    if ((anchor.attr('rel') || '').split(/\s+/).includes('tag')) return;
    const chain = [el, ...anchor.parents().toArray()];
    let location: LinkLocation | null = null;
    let blocked = false;
    for (const parent of chain) {
      if (excluded(parent)) {
        if ('tagName' in parent && parent.tagName === 'footer' && location === 'blogroll') break;
        blocked = true;
        break;
      }
      const kind = semantic(parent);
      if (kind && (!location || kind === 'comment' || (kind === 'blogroll' && location !== 'comment'))) location = kind;
      if (bodyNodes.has(parent)) {
        location ??= 'body';
        break;
      }
    }
    if (blocked || !location) return;
    const raw = anchor.attr('href')?.trim();
    if (!raw || raw.startsWith('#')) return;
    const targetUrl = normalizeLink(raw, pageUrl);
    if (!targetUrl) return;
    const targetBlogId = resolvePublication(targetUrl, aliases);
    if (targetBlogId === sourceBlogId) return;
    if (!targetBlogId && new URL(targetUrl).origin === new URL(pageUrl).origin) {
      const home = publicationHome(targetUrl);
      const sourceHome = publicationHome(pageUrl);
      if (!home || (sourceHome && identityKey(home) === identityKey(sourceHome)) || resolvePublication(home, aliases) === sourceBlogId)
        return;
    }
    const anchorText = clip(clean(anchor.text()), 255);
    const surrounding = clean(anchor.parent().text()),
      at = surrounding.indexOf(anchorText),
      context = clip(at > 100 ? surrounding.slice(at - 100) : surrounding, 320);
    const key = `${location}\n${targetUrl}\n${anchorText}\n${context}`;
    if (seen.has(key)) return;
    seen.add(key);
    externalLinks++;
    if (counts[location]++ >= 100) {
      truncated = true;
      return;
    }
    links.push({ targetUrl, targetBlogId, anchorText, context, location, ordinal: links.length });
  });
  const priority = { body: 0, blogroll: 1, sidebar: 2, comment: 3 };
  const selected = links
    .sort((a, b) => priority[a.location] - priority[b.location] || a.ordinal - b.ordinal)
    .slice(0, Math.max(1, Math.min(100, maxLinks)))
    .map((l, ordinal) => ({ ...l, ordinal }));
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
