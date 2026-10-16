import { describe, expect, it, vi } from 'vitest';
import type { FeedFetcher } from './feed.ts';
import { isSeedPlatformRoot, validateSeedUrl } from './seed-url-validation.ts';

const rss = (home: string) =>
  `<rss version="2.0"><channel><title>小林筆記</title><link>${home}</link><description>筆記</description></channel></rss>`;
const page = (title = '小林筆記', link = '/feed/') =>
  `<html><head><title>${title}</title><link rel="alternate" type="application/rss+xml" href="${link}"></head><body>文章</body></html>`;
function fixture(routes: Record<string, string | { status: number; location?: string; body?: string }>) {
  const fetcher = vi.fn<FeedFetcher>(async (input, init) => {
    expect(init?.redirect).toBe('manual');
    expect(init?.dispatcher).toBeDefined();
    expect(((init?.headers ?? {}) as Record<string, string>)['user-agent']).toContain('blog.observe.tw');
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response(null, { status: 404 });
    if (typeof route === 'string')
      return new Response(route, { headers: { 'content-type': route.startsWith('<html') ? 'text/html' : 'application/xml' } });
    return new Response(route.body ?? null, { status: route.status, headers: route.location ? { location: route.location } : {} });
  });
  return { fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250, maxSourceRequests: 2 };
}

describe('seed official URL validation', () => {
  it('requires a matching first-party identity and a real RSS XML source', async () => {
    const home = 'https://official-seed.example/';
    const options = fixture({ [home]: page(), [`${home}feed/`]: rss(home) });
    const result = await validateSeedUrl({ id: 1, name: '小林筆記 official-seed.example', url: home }, options);
    expect(result.validated).toBe(true);
    expect(result.feedSources).toEqual([{ url: `${home}feed/`, type: 'rss' }]);
    expect(result.evidence.homepageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('<html>');
    expect(result.evidence.identityMatches).toContain('小林筆記');
  });

  it('validates scoped research sitemap hints but never fetches out-of-publication hints', async () => {
    const home = 'https://hint-seed.example/';
    const source = `${home}sitemap-0.xml`;
    const options = fixture({
      [home]: page(),
      [source]: `<urlset><url><loc>${home}article</loc></url></urlset>`,
    });
    const result = await validateSeedUrl(
      { id: 30, name: '小林筆記', url: home, sourceUrls: ['http://127.0.0.1/private', 'https://other.example/map', source] },
      options,
    );
    expect(result.validated).toBe(true);
    expect(result.feedSources).toEqual([{ url: source, type: 'sitemap' }]);
    expect(options.fetcher.mock.calls.some(([url]) => /127.0.0.1|other.example/.test(String(url)))).toBe(false);
  });

  it('does not accept a domain match when the homepage belongs to somebody else', async () => {
    const home = 'https://wrong-seed.example/';
    const options = fixture({ [home]: page('完全不同的站'), [`${home}feed/`]: rss(home) });
    const result = await validateSeedUrl({ id: 2, name: '小林筆記 wrong-seed.example', url: home }, options);
    expect(result.reason).toBe('identity_not_confirmed');
    expect(options.fetcher.mock.calls.some(([url]) => String(url).endsWith('/feed/'))).toBe(false);
  });

  it('leaves domain-only seeds unresolved without evidenced brand aliases', async () => {
    const home = 'https://domain-only.example/';
    const result = await validateSeedUrl(
      { id: 3, name: 'domain-only.example', url: home, aliases: ['小林筆記'] },
      fixture({ [home]: page() }),
    );
    expect(result.reason).toBe('identity_not_confirmed');
  });

  it('confirms a listing named by its own domain only when the homepage on that host names itself by it', async () => {
    const home = 'https://wiwi-like.blog/';
    const own = await validateSeedUrl(
      { id: 31, name: 'Wiwi-Like.Blog', url: home },
      fixture({ [home]: page('官大為的部落格 | Wiwi-Like.Blog'), [`${home}feed/`]: rss(home) }),
    );
    expect(own.validated).toBe(true);
    expect(own.evidence.identityMatches).toEqual(['wiwi-like.blog']);
    // The homepage never names the domain: still unconfirmed, and no feed is fetched.
    const silent = fixture({ [home]: page('官大為的部落格'), [`${home}feed/`]: rss(home) });
    expect((await validateSeedUrl({ id: 32, name: 'Wiwi-Like.Blog', url: home }, silent)).reason).toBe('identity_not_confirmed');
    expect(silent.fetcher.mock.calls.some(([url]) => String(url).endsWith('/feed/'))).toBe(false);
    // Another host that mentions the domain in its title is not that listing.
    const other = 'https://elsewhere.example/';
    const moved = await validateSeedUrl(
      { id: 33, name: 'Wiwi-Like.Blog', url: home },
      fixture({ [home]: { status: 301, location: other }, [other]: page('Wiwi-Like.Blog 粉絲站'), [`${other}feed/`]: rss(other) }),
    );
    expect(moved.reason).toBe('identity_not_confirmed');
  });

  it('accepts independently researched aliases with provenance and first-party confirmation', async () => {
    const home = 'https://researched-seed.example/';
    const result = await validateSeedUrl(
      {
        id: 4,
        name: 'researched-seed.example',
        url: home,
        aliases: ['小林筆記'],
        researchEvidence: [{ alias: '小林筆記', sourceUrl: `${home}about`, excerpt: '小林筆記是本站名稱' }],
      },
      fixture({ [home]: page(), [`${home}feed/`]: rss(home) }),
    );
    expect(result.validated).toBe(true);
    expect(result.evidence.researchEvidence).toHaveLength(1);
  });

  it('rejects unsupported aliases and generic identities', async () => {
    const home = 'https://unsupported-alias.example/';
    const result = await validateSeedUrl(
      {
        id: 5,
        name: '部落格',
        url: home,
        aliases: ['小林筆記'],
        researchEvidence: [{ alias: '小林筆記', sourceUrl: 'https://unrelated.example/', excerpt: '小林筆記' }],
      },
      fixture({ [home]: page() }),
    );
    expect(result.reason).toBe('identity_not_confirmed');
  });

  it('accepts a genuine move only when the new homepage still confirms identity', async () => {
    const old = 'https://move-old.example/';
    const moved = 'https://move-new.example/';
    const result = await validateSeedUrl(
      { id: 6, name: '小林筆記', url: old },
      fixture({
        [old]: { status: 301, location: moved },
        [moved]: page(),
        [`${moved}feed/`]: rss(moved),
      }),
    );
    expect(result.validated).toBe(true);
    expect(result.finalUrl).toBe(moved);
  });

  it('rejects a redirected unrelated site despite having a feed', async () => {
    const old = 'https://bad-move-old.example/';
    const moved = 'https://bad-move-new.example/';
    const result = await validateSeedUrl(
      { id: 7, name: '小林筆記', url: old },
      fixture({
        [old]: { status: 301, location: moved },
        [moved]: page('別人的網站'),
        [`${moved}feed/`]: rss(moved),
      }),
    );
    expect(result.reason).toBe('identity_not_confirmed');
  });

  it('rejects challenge pages and 404 homepages', async () => {
    for (const [host, response] of [
      ['challenge-seed', page('Just a moment...')],
      ['gone-seed', { status: 404, body: page() }],
    ] as const) {
      const home = `https://${host}.example/`;
      const result = await validateSeedUrl({ id: 8, name: '小林筆記', url: home }, fixture({ [home]: response }));
      expect(result.validated).toBe(false);
      expect(result.reason).toMatch(/homepage_/);
    }
  });

  it('rejects HTML disguised as feed and malformed RSS', async () => {
    const home = 'https://fake-feed-seed.example/';
    const result = await validateSeedUrl(
      { id: 9, name: '小林筆記', url: home },
      fixture({
        [home]: page(),
        [`${home}feed/`]: '<html><title>Feed</title></html>',
        [`${home}feed.xml`]: '<rss><channel><title>Hi</rss>',
      }),
    );
    expect(result.reason).toBe('no_verified_feed_or_sitemap');
    expect(result.evidence.sourceChecks.map((check) => check.reason)).toEqual(['not_a_feed_or_sitemap', 'not_a_feed_or_sitemap']);
  });

  it('preserves Atom type', async () => {
    const home = 'https://atom-seed.example/';
    const result = await validateSeedUrl(
      { id: 10, name: '小林筆記', url: home },
      fixture({
        [home]: page(),
        [`${home}feed/`]: `<feed xmlns="http://www.w3.org/2005/Atom"><title>小林筆記</title><link href="${home}"/></feed>`,
      }),
    );
    expect(result.feedSources[0]?.type).toBe('atom');
  });

  it('follows one sitemap index child and returns a crawlable urlset', async () => {
    const home = 'https://sitemap-seed.example/';
    const result = await validateSeedUrl(
      { id: 11, name: '小林筆記', url: home },
      fixture({
        [home]: page('小林筆記', '/sitemap.xml'),
        [`${home}sitemap.xml`]: `<sitemapindex><sitemap><loc>${home}posts.xml</loc></sitemap></sitemapindex>`,
        [`${home}posts.xml`]: `<urlset><url><loc>${home}article-1</loc></url></urlset>`,
      }),
    );
    expect(result.validated).toBe(true);
    expect(result.feedSources).toEqual([{ url: `${home}posts.xml`, type: 'sitemap' }]);
  });

  it('never accepts a shared platform root', async () => {
    for (const url of ['https://medium.com/', 'https://wordpress.com/', 'https://pixnet.net/', 'https://medium.com/topics']) {
      const options = fixture({});
      const result = await validateSeedUrl({ id: 12, name: '小林筆記', url }, options);
      expect(result.reason).toBe('platform_root');
      expect(options.fetcher).not.toHaveBeenCalled();
    }
    expect(isSeedPlatformRoot('https://someone.blogspot.com/')).toBe(false);
  });

  it('keeps a Medium author path and rejects another author feed on the same domain', async () => {
    const home = 'https://medium.com/@xiaolin';
    const result = await validateSeedUrl(
      { id: 13, name: '小林筆記', url: home },
      fixture({
        [home]: page('小林筆記', '/feed/@someone-else'),
        'https://medium.com/feed/@someone-else': rss('https://medium.com/@someone-else'),
        'https://medium.com/feed/@xiaolin': rss(home),
      }),
    );
    expect(result.validated).toBe(true);
    expect(result.finalUrl).toBe(home);
    expect(result.feedSources[0]?.url).toBe('https://medium.com/feed/@xiaolin');
    expect(result.evidence.sourceChecks[0].reason).toBe('source_outside_publication');
  });

  it('respects robots and rejects unsafe destinations before network access', async () => {
    const home = 'https://robots-seed.example/';
    const options = fixture({ [`${home}robots.txt`]: 'User-agent: *\nDisallow: /', [home]: page() });
    const denied = await validateSeedUrl({ id: 14, name: '小林筆記', url: home }, options);
    expect(denied.reason).toBe('robots_disallowed');
    expect(options.fetcher.mock.calls).toHaveLength(1);
    const unsafeOptions = fixture({});
    const unsafe = await validateSeedUrl(
      { id: 15, name: '小林筆記', url: 'https://private-seed.example/' },
      { ...unsafeOptions, resolveHost: async () => ['127.0.0.1'] },
    );
    expect(unsafe.reason).toBe('unsafe_destination');
    expect(unsafeOptions.fetcher).not.toHaveBeenCalled();
  });
});

describe('automatic identity binding safeguards', () => {
  it('rejects generic kitchen/diary/notes and Chinese travel diary matches', async () => {
    for (const [index, name, title] of [
      [1, "Mike's Kitchen", 'Kitchen stories'],
      [2, 'Amanda diary', 'Daily diary'],
      [3, 'Robert notes', 'My notes'],
      [4, '小林 旅行日記', '旅行日記'],
      [5, 'kitchen diary', 'Kitchen diary'],
    ] as const) {
      const home = `https://generic-match-${index}.test/`;
      const result = await validateSeedUrl({ id: 20 + index, name, url: home }, fixture({ [home]: page(title) }));
      expect(result.reason).toBe('identity_not_confirmed');
    }
  });

  it('requires full seed name after a cross-host redirect, even when one distinctive subword matches', async () => {
    const home = 'https://partial-move.test/';
    const moved = 'https://partial-destination.test/';
    const result = await validateSeedUrl(
      { id: 30, name: '小林 美食筆記', url: home },
      fixture({
        [home]: { status: 301, location: moved },
        [moved]: page('小林的攝影天地'),
        [`${moved}feed/`]: rss(moved),
      }),
    );
    expect(result.reason).toBe('identity_not_confirmed');
    expect(result.evidence.identityMatches).toEqual([]);
  });

  it('permits a complete curated alias on the new host, not an alias subword', async () => {
    const home = 'https://alias-move-old.test/';
    const moved = 'https://alias-move-new.test/';
    const result = await validateSeedUrl(
      {
        id: 31,
        name: '小林 美食筆記',
        url: home,
        aliases: ['小林的攝影天地'],
        researchEvidence: [{ alias: '小林的攝影天地', sourceUrl: `${moved}about`, excerpt: '小林的攝影天地由小林原站搬來' }],
      },
      fixture({ [home]: { status: 301, location: moved }, [moved]: page('小林的攝影天地'), [`${moved}feed/`]: rss(moved) }),
    );
    expect(result.validated).toBe(true);
    expect(result.evidence.identityMatches).toEqual(['小林的攝影天地']);
  });

  it('allows a distinctive name part only on the same host', async () => {
    const home = 'https://same-host-distinct.test/';
    const result = await validateSeedUrl(
      { id: 32, name: '小林 美食筆記', url: home },
      fixture({ [home]: page('小林的攝影天地'), [`${home}feed/`]: rss(home) }),
    );
    expect(result.validated).toBe(true);
    expect(result.evidence.identityMatches).toEqual(['小林']);
  });

  it('handles RSS homepage link merged with an atom:link array on a shared platform', async () => {
    const home = 'https://medium.com/@array-links';
    const feed = 'https://medium.com/feed/@array-links';
    const result = await validateSeedUrl(
      { id: 33, name: '小林筆記', url: home },
      fixture({
        [home]: page('小林筆記', feed),
        [feed]: `<rss xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>小林筆記</title><atom:link href="${feed}" rel="self"/><link>${home}</link></channel></rss>`,
      }),
    );
    expect(result.validated).toBe(true);
    expect(result.feedSources).toEqual([{ url: feed, type: 'rss' }]);
  });

  it('skips advertised comments feed and rejects a redirected comments payload', async () => {
    const home = 'https://comments-source.test/';
    const result = await validateSeedUrl(
      { id: 34, name: '小林筆記', url: home },
      fixture({
        [home]: page('小林筆記', '/comments/feed/'),
        [`${home}feed/`]: '<rss><channel><title>Comments for 小林筆記</title></channel></rss>',
        [`${home}feed.xml`]: rss(home),
      }),
    );
    expect(result.validated).toBe(true);
    expect(result.feedSources[0]?.url).toBe(`${home}feed.xml`);
    expect(result.evidence.sourceChecks[0].reason).toBe('comments_feed');
    expect(result.evidence.sourceChecks.some((check) => check.url.includes('/comments/'))).toBe(false);
  });
});

describe('article-oriented sitemap discovery', () => {
  const sitemapIndex = (home: string, files: string[]) =>
    `<sitemapindex>${files.map((file) => `<sitemap><loc>${home}${file}</loc></sitemap>`).join('')}</sitemapindex>`;
  const urlset = (home: string) => `<urlset><url><loc>${home}article</loc></url></urlset>`;
  it('prefers post partitions over the first misc sitemap, without fetching the misc source', async () => {
    const home = 'https://post-priority.test/';
    const options = fixture({
      [home]: page('小林筆記', '/sitemap.xml'),
      [`${home}sitemap.xml`]: sitemapIndex(home, ['sitemap-misc.xml', 'post-sitemap.xml']),
      [`${home}sitemap-misc.xml`]: urlset(home),
      [`${home}post-sitemap.xml`]: urlset(home),
    });
    const result = await validateSeedUrl({ id: 40, name: '小林筆記', url: home }, options);
    expect(result.feedSources).toEqual([{ url: `${home}post-sitemap.xml`, type: 'sitemap' }]);
    expect(options.fetcher.mock.calls.some(([url]) => String(url).includes('sitemap-misc'))).toBe(false);
    expect(result.evidence.sourceChecks).toHaveLength(2);
  });

  it('prioritizes latest dated article partitions and demotes post-tag/page partitions', async () => {
    const home = 'https://dated-priority.test/';
    const result = await validateSeedUrl(
      { id: 41, name: '小林筆記', url: home },
      fixture({
        [home]: page('小林筆記', '/sitemap.xml'),
        [`${home}sitemap.xml`]: sitemapIndex(home, [
          'post_tag-2026-10.xml',
          'posts-page-2026-11.xml',
          'post-2024-12.xml',
          'post-2026-09.xml',
          'post-2026-10.xml',
        ]),
        [`${home}post-2026-10.xml`]: urlset(home),
      }),
    );
    expect(result.feedSources[0]?.url).toBe(`${home}post-2026-10.xml`);
  });

  it('continues to the next article child after an invalid child without increasing request budget', async () => {
    const home = 'https://fallback-child.test/';
    const options = fixture({
      [home]: page('小林筆記', '/sitemap.xml'),
      [`${home}sitemap.xml`]: sitemapIndex(home, ['misc.xml', 'article-2026-10.xml', 'article-2026-09.xml']),
      [`${home}article-2026-10.xml`]: '<html>Not XML sitemap</html>',
      [`${home}article-2026-09.xml`]: urlset(home),
    });
    const result = await validateSeedUrl({ id: 42, name: '小林筆記', url: home }, { ...options, maxSourceRequests: 3 });
    expect(result.feedSources[0]?.url).toBe(`${home}article-2026-09.xml`);
    expect(result.evidence.sourceChecks).toHaveLength(3);
    expect(options.fetcher.mock.calls.some(([url]) => String(url).includes('misc.xml'))).toBe(false);
  });
});

it('resolves relative sitemap child locs and discards malformed locs before ranking', async () => {
  const home = 'https://relative-index.test/';
  const options = fixture({
    [home]: page('小林筆記', '/sitemap/index.xml'),
    [`${home}sitemap/index.xml`]:
      '<sitemapindex><sitemap><loc>http://[</loc></sitemap><sitemap><loc>http://127.0.0.1/private.xml</loc></sitemap><sitemap><loc>../post-current.xml</loc></sitemap></sitemapindex>',
    [`${home}post-current.xml`]: `<urlset><url><loc>${home}post</loc></url></urlset>`,
  });
  const result = await validateSeedUrl({ id: 46, name: '小林筆記', url: home }, options);
  expect(result.validated).toBe(true);
  expect(result.feedSources).toEqual([{ url: `${home}post-current.xml`, type: 'sitemap' }]);
  expect(options.fetcher.mock.calls.some(([url]) => String(url).includes('127.0.0.1'))).toBe(false);
});
