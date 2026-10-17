import { load } from 'cheerio';

export const PUBLIC_SUMMARY_LIMIT = 500;
/** Public snippets are plain excerpts. Full feed/article content stays in internal snapshots. */
export function publicSummary(value: unknown, maximum = PUBLIC_SUMMARY_LIMIT): string {
  const limit = Math.max(1, Math.min(PUBLIC_SUMMARY_LIMIT, maximum));
  const $ = load(typeof value === 'string' ? value.slice(0, 120_000) : '', null, false);
  $('script,style,noscript,template,iframe,object,form').remove();
  $('br,p,div,li,section,h1,h2,h3,h4,blockquote').each((_, el) => {
    $(el).append(' ');
  });
  const text = $.root()
    .text()
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : characters
        .slice(0, limit - 1)
        .join('')
        .trimEnd() + '…';
}
const PUBLIC_POST_FIELDS = [
  'id',
  'guid',
  'title',
  'url',
  'author',
  'publishedAt',
  'updatedAt',
  'imageUrl',
  'blogSlug',
  'blogName',
  'blogGenres',
  // Author's feed categories, attached by post-tags.ts withPostTags.
  'tags',
  'tagCount',
] as const;
/** Explicit allowlist prevents a future SELECT/JOIN from exposing body snapshots or provenance payloads. */
export function publicPost(row: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_POST_FIELDS) if (row[key] !== undefined) result[key] = row[key];
  result.summary = publicSummary(row.summary);
  return result;
}
const xml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function publicRss(items: Record<string, unknown>[], title: string, link: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(title)}</title><link>${xml(link)}</link><description>${xml(title)}</description>${items
    .map((row) => {
      const item = publicPost(row);
      const published = item.publishedAt ? new Date(String(item.publishedAt)) : null;
      return `<item><title>${xml(item.title)}</title><link>${xml(item.url)}</link><guid>${xml(item.guid || item.url)}</guid>${published && Number.isFinite(published.getTime()) ? `<pubDate>${xml(published.toUTCString())}</pubDate>` : ''}<description>${xml(item.summary)}</description></item>`;
    })
    .join('')}</channel></rss>`;
}
