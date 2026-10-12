import { describe, expect, it, vi } from 'vitest';
import { sitemapArticleProof, verifyArticleSitemap } from './publication-sitemap.ts';

const home = 'https://personal-sitemap.test/';
const article = (kind = 'BlogPosting', authorType = 'Person') =>
  `<link rel="canonical" href="${home}post"><script type="application/ld+json">${JSON.stringify({ '@type': kind, url: home + 'post', headline: 'My personal reflection', author: { '@type': authorType, name: 'Quill Writer' } })}</script>`;
describe('personal article sitemap proof', () => {
  it('requires Person Article/BlogPosting and canonical same publication, no publication-date guessing', () => {
    expect(sitemapArticleProof(article(), home + 'post', home)).toMatchObject({
      schemaType: 'BlogPosting',
      author: 'Quill Writer',
      publishedAt: null,
    });
    expect(sitemapArticleProof(article('NewsArticle'), home + 'post', home)).toBeNull();
    expect(sitemapArticleProof(article('BlogPosting', 'Organization'), home + 'post', home)).toBeNull();
    expect(
      sitemapArticleProof(article().replace(`href="${home}post"`, 'href="https://elsewhere.test/post"'), home + 'post', home),
    ).toBeNull();
    expect(sitemapArticleProof(article().replace(/<link[^>]+>/, ''), home + 'post', home)).toBeNull();
  });
  it('follows a scoped index and verifies actual article through polite fetch', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      return new Response(
        url.endsWith('/robots.txt')
          ? 'User-agent: *\nAllow: /'
          : url.endsWith('/sitemap.xml')
            ? `<sitemapindex><sitemap><loc>${home}posts.xml</loc></sitemap></sitemapindex>`
            : url.endsWith('/posts.xml')
              ? `<urlset><url><loc>${home}post</loc></url></urlset>`
              : article(),
      );
    });
    const result = await verifyArticleSitemap(home + 'sitemap.xml', home, {
      fetcher,
      resolveHost: async () => ['93.184.216.34'],
      delayMs: 250,
    });
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(home + 'post');
    expect(fetcher.mock.calls.some(([url]) => String(url) === home + 'post')).toBe(true);
  });
});
