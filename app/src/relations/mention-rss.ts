import type { loadProfileMentionFeed } from './home-feed.ts';

type Feed = Awaited<ReturnType<typeof loadProfileMentionFeed>>;

const xml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * /api/blogs/<slug>/mentions.xml: the articles of other collected blogs that write about this blog, so its author can
 * subscribe and hear about them. Each item is the citing article (its title, link and the sentence holding the link);
 * the guid is per article, so a reader shows each one once. No page links to it with <link rel="alternate">, and
 * robots.txt keeps /api/ out of crawlers: a feed of links to other blogs must not read as this site citing them.
 */
export function profileMentionRss(feed: Feed, blog: { slug: string; name: string }, origin: string) {
  const page = `${origin}/blogs/${encodeURIComponent(blog.slug)}/mentions/`;
  const self = `${origin}/api/blogs/${encodeURIComponent(blog.slug)}/mentions.xml`;
  const title = `誰提到了「${blog.name}」 · 部落格觀察`;
  const items = feed.items
    .map((item) => {
      const published = item.publishedAt ? new Date(item.publishedAt) : null;
      const link = item.postUrl ?? `${origin}/blogs/${encodeURIComponent(item.sourceBlogSlug)}/`;
      return `<item><title>${xml(`${item.sourceBlogName}：${item.postTitle || '未命名文章'}`)}</title><link>${xml(link)}</link><guid isPermaLink="false">${xml(`${new URL(origin).host}:mention:${item.postId}`)}</guid>${published && Number.isFinite(published.getTime()) ? `<pubDate>${published.toUTCString()}</pubDate>` : ''}<description>${xml(item.quote)}</description></item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(title)}</title><link>${xml(page)}</link><atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/><description>${xml(`其他部落格在正文裡寫到「${blog.name}」的文章，由部落格觀察收錄。`)}</description><language>zh-TW</language>${items}</channel></rss>`;
}
