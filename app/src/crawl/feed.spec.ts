import { describe, expect, it } from 'vitest';
import { parseFeed, parseSitemap } from './feed.ts';

describe('feed parsing', () => {
  it('parses RSS and Atom links without fetching article bodies', () => {
    const rss =
      '<rss><channel><item><guid>r1</guid><title>RSS</title><link>https://example.test/rss/1</link><description>short</description></item></channel></rss>';
    const atom =
      '<feed><entry><id>a1</id><title>Atom</title><link href="https://example.test/atom/1" rel="alternate"/><updated>2025-01-01T00:00:00Z</updated></entry></feed>';
    expect(parseFeed(rss, 'https://example.test')).toMatchObject([{ guid: 'r1', title: 'RSS', url: 'https://example.test/rss/1' }]);
    expect(parseFeed(atom, 'https://example.test')).toMatchObject([{ guid: 'a1', title: 'Atom', url: 'https://example.test/atom/1' }]);
  });

  it('treats sitemap lastmod as updatedAt and keeps the URL as guid', () => {
    const [item] = parseSitemap(
      '<urlset><url><loc>https://example.test/post</loc><lastmod>2025-01-02</lastmod></url></urlset>',
      'https://example.test',
    );
    expect(item).toMatchObject({ guid: 'https://example.test/post', url: 'https://example.test/post' });
    expect(item.updatedAt?.toISOString()).toContain('2025-01-02');
  });
});
