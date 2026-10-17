import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { utf8Prefix } from '../content/contracts.ts';
import { articleInPublication, canonicalArticleUrl } from '../crawl/feed.ts';

const KEEP = new Set(['id', 'class', 'href', 'datetime', 'rel', 'itemprop', 'itemtype', 'property', 'name', 'content', 'role', 'type']);
const DROP = 'style,noscript,template,svg,iframe,canvas,video,audio,picture source,link:not([rel])';
/** Embedded page data the scraper may JSON.parse: kept, pruned to its shape. */
const DATA = 'script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__,script#__NUXT_DATA__';
const STATE = /window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__\s*=/;
/** Arrays keep a few items plus a count, strings a few dozen characters: the paths survive, the payload does not. */
export function pruneJson(value: unknown, items = 2, chars = 80, depth = 0, maxDepth = 14): unknown {
  if (depth > maxDepth) return '…';
  if (typeof value === 'string') return value.length > chars ? `${value.slice(0, chars)}…` : value;
  const next = (v: unknown) => pruneJson(v, items, chars, depth + 1, maxDepth);
  if (Array.isArray(value))
    return [...value.slice(0, items).map(next), ...(value.length > items ? [`…+${value.length - items} more`] : [])];
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, next(v)]));
  return value;
}
/** Valid JSON whenever the source is: prunes harder until the shape fits, cuts only as a last resort. */
function shownJson(source: string, max = 8000) {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return source.length > max ? `${source.slice(0, max)}…` : source;
  }
  for (const [items, chars, depth] of [
    [2, 80, 14],
    [1, 40, 12],
    [1, 24, 9],
    [1, 16, 7],
  ]) {
    const shown = JSON.stringify(pruneJson(value, items, chars, 0, depth));
    if (shown.length <= max) return shown;
  }
  const shown = JSON.stringify(pruneJson(value, 1, 16, 0, 7));
  return `${shown.slice(0, max)}…`;
}

/** A page skeleton for the model: structure and selectors survive, scripts and long prose do not. */
export function compactHtml(html: string, maxBytes = 50 * 1024, xml = false): string {
  const $ = cheerio.load(html, { xml });
  $(DROP).remove();
  $('script').each((_, el) => {
    const node = $(el);
    const source = node.text();
    if (node.is(DATA)) node.text(shownJson(source));
    else if (STATE.test(source)) node.text(source.length > 3000 ? `${source.slice(0, 3000)}…` : source);
    else node.remove();
  });
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const name of Object.keys(el.attribs)) {
      const value = el.attribs[name];
      if (!KEEP.has(name) && !name.startsWith('data-') && !/^on[a-z]+$/.test(name)) delete el.attribs[name];
      else if (value.length > 200) el.attribs[name] = `${value.slice(0, 200)}…`;
    }
  });
  const shorten = (node: AnyNode) => {
    if (node.type === 'text') {
      const value = node.data.replace(/\s+/g, ' ');
      node.data = value.length > 160 ? `${value.slice(0, 160)}…` : value;
    } else if ('children' in node && !(node.type === 'script' || ('name' in node && node.name === 'script')))
      for (const child of node.children) shorten(child);
  };
  for (const node of $.root().children().toArray()) shorten(node);
  return utf8Prefix(((xml ? null : $('html').html()) ?? $.root().html() ?? '').replace(/\n\s*\n+/g, '\n'), maxBytes);
}

const NOT_ARTICLE =
  /\/(?:tags?|categor(?:y|ies)|page|archives?|about|contact|search|feed|author|label|wp-login|privacy)(?:\/|$)|[?&](?:s|page|paged)=/i;
/** One likely article on the home, so the first round sees both a listing and a post. */
export function likelyArticleUrl(html: string, home: string): string | null {
  const $ = cheerio.load(html);
  const homeKey = canonicalArticleUrl(home).replace(/\/$/, '');
  const scores = new Map<string, number>();
  $('a[href]').each((_, el) => {
    let url: string;
    try {
      url = canonicalArticleUrl(new URL($(el).attr('href') || '', home).href);
    } catch {
      return;
    }
    if (url.replace(/\/$/, '') === homeKey || !articleInPublication(url, home) || NOT_ARTICLE.test(url)) return;
    const path = new URL(url).pathname;
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    let score = 0;
    if (/\/(?:19|20)\d{2}\b/.test(path) || /\d{4}-\d{2}/.test(path)) score += 3;
    if (/\/(?:posts?|blog|articles?|notes?|p)\//i.test(path)) score += 2;
    if (label.length >= 6 && label.length <= 120) score += 2;
    if ($(el).closest('article,main,h1,h2,h3,.post,.entry').length) score += 2;
    if (path.split('/').filter(Boolean).length >= 1) score += 1;
    scores.set(url, Math.max(scores.get(url) ?? 0, score));
  });
  const best = [...scores].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : null;
}
