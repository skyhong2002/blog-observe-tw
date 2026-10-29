import { describe, expect, it, vi } from 'vitest';
import {
  aboutPageUrl,
  candidatePreflight,
  type DiscoveryCandidate,
  publicationContains,
  validateCandidate,
} from './candidate-validation.ts';

const home = 'https://quill.test/',
  feed = home + 'feed/';
const candidate: DiscoveryCandidate = { id: 1, url: home, name: 'Quill Writer', status: 'candidate', source_type: 'blogblog-club' };
const homepage =
  '<meta name="description" content="Personal blog. About me: I am Quill Writer."><title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/feed/">';
const rss = (identity = home, title = 'Quill Writer', post = home + 'old-post') =>
  `<rss version="2.0"><channel><title>${title}</title><link>${identity}</link><item><title>Short old post</title><link>${post}</link><guid>abc</guid><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate><description>Hi</description></item></channel></rss>`;
function options(xml: string, html = homepage) {
  return {
    delayMs: 250,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const u = String(input);
      return u.endsWith('/robots.txt')
        ? new Response('User-agent: *\nAllow: /')
        : u === home
          ? new Response(html, { headers: { 'content-type': 'text/html' } })
          : u === feed
            ? new Response(xml, { headers: { 'content-type': 'application/rss+xml' } })
            : new Response(null, { status: 404 });
    }),
  };
}
describe('automatic discovery verification', () => {
  it('requires publication home; preserves platform author identity and prior decisions', () => {
    for (const url of ['https://medium.com', 'https://bearblog.dev', 'https://github.io', 'https://wordpress.com', 'https://vocus.cc'])
      expect(candidatePreflight({ ...candidate, url })).toBe('platform_root');
    for (const url of [
      'https://quill.test/2024/post',
      'https://medium.com/@one/article',
      'https://quill.test/category/a',
      'https://quill.test/?p=1',
    ])
      expect(candidatePreflight({ ...candidate, url })).toBe('needs_publication_home');
    expect(candidatePreflight({ ...candidate, url: 'https://medium.com/@one' })).toBeNull();
    // A language home the site redirects to (thelingwu.com → /zh) is the publication home.
    for (const url of ['https://quill.test/zh', 'https://quill.test/zh-tw/', 'https://quill.test/zh_Hant/blog/', 'https://quill.test/blog'])
      expect(candidatePreflight({ ...candidate, url })).toBeNull();
    for (const url of ['https://quill.test/zh/writing', 'https://quill.test/2024', 'https://quill.test/zh/?lang=1'])
      expect(candidatePreflight({ ...candidate, url })).toBe('needs_publication_home');
    expect(candidatePreflight({ ...candidate, status: 'rejected' })).toBe('decision_already_exists');
    expect(candidatePreflight({ ...candidate, url: 'http://127.0.0.1/' })).toBe('unsafe_or_invalid_url');
    expect(candidatePreflight({ ...candidate, url: 'https://m.facebook.com/' })).toBe('not_a_blog_publication');
  });
  it('validates matching home, RSS name and old short articles without stale or length thresholds', async () => {
    const result = await validateCandidate(candidate, options(rss()));
    expect(result.eligible).toBe(true);
    expect(result.feed).toMatchObject({ entries: 1, identityUrl: home, type: 'rss' });
  });
  it('does not auto-approve sitemap XML without article and Person evidence', async () => {
    const result = await validateCandidate(candidate, options('<urlset><url><loc>https://quill.test/post</loc></url></urlset>'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('rss_or_article_sitemap_required');
  });
  it('accepts a same-publication feed regardless of its title, including guessed feeds', async () => {
    const result = await validateCandidate(
      candidate,
      options(rss(home, 'Another Writer'), homepage.replace('Quill Writer', 'Another Writer').replace(/<link[^>]*>/, '')),
    );
    expect(result.eligible).toBe(true);
    expect(result.feed?.title).toBe('Another Writer');
  });
  it('skips an advertised comments feed even when it appears before the main RSS', async () => {
    const opts = options(
      rss(),
      '<meta name="description" content="Personal blog. About me: I am Quill Writer."><title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" href="/feed/">',
    );
    expect((await validateCandidate(candidate, opts)).eligible).toBe(true);
    expect(opts.fetcher.mock.calls.some(([url]) => String(url).includes('/comments/'))).toBe(false);
  });
  it('rejects a feed that changes into comments between initial and final verification', async () => {
    const opts = options(rss());
    const original = opts.fetcher.getMockImplementation()!;
    let count = 0;
    opts.fetcher.mockImplementation(async (input) =>
      String(input) === feed && ++count === 2 ? new Response(rss(home, 'Comments for Quill Writer')) : original(input),
    );
    expect((await validateCandidate(candidate, opts)).reason).toBe('comments_feed');
  });
  it('does not infer a home from an arbitrary article URL', async () => {
    const opts = options(rss());
    expect((await validateCandidate({ ...candidate, url: home + 'article' }, opts)).reason).toBe('needs_publication_home');
    expect(opts.fetcher).not.toHaveBeenCalled();
  });
  it('requires feed home identity but ignores feed name', async () => {
    // A category feed the homepage never links (found at the guessed /feed/) does not stand for the home.
    const unlinked = homepage.replace(/<link[^>]*>/, '');
    expect((await validateCandidate(candidate, options(rss(home + 'category'), unlinked))).reason).toBe('feed_home_identity_mismatch');
    expect((await validateCandidate(candidate, options(rss(home, 'Another publication'), unlinked))).eligible).toBe(true);
    expect((await validateCandidate(candidate, options(rss(home, ''), unlinked))).eligible).toBe(true);
  });
  it('does not approve a syndicated or mixed-author feed', async () => {
    expect((await validateCandidate(candidate, options(rss(home, 'Quill Writer', 'https://someone.test/post')))).reason).toBe(
      'feed_entries_outside_publication',
    );
    expect(publicationContains('https://medium.com/@two/post', 'https://medium.com/@one')).toBe(false);
    expect(publicationContains('https://medium.com/@one-more/post', 'https://medium.com/@one')).toBe(false);
    expect(publicationContains('https://medium.com/@one/post', 'https://medium.com/@one')).toBe(true);
  });
  it('retains robots and unavailable homes rather than approving via guessed feeds', async () => {
    const opts = options(rss());
    opts.fetcher.mockImplementation(async () => new Response('User-agent: *\nDisallow: /'));
    const result = await validateCandidate({ ...candidate, url: 'https://blocked-candidate.test/' }, opts);
    expect(result.reason).toBe('robots_disallowed');
    expect(result.eligible).toBe(false);
    // An unreadable robots.txt is still held closed, but reported apart from a real refusal.
    opts.fetcher.mockImplementation(async () => new Response('down', { status: 530 }));
    const down = await validateCandidate({ ...candidate, url: 'https://down-candidate.test/' }, opts);
    expect(down.reason).toBe('robots_unreachable');
    expect(down.eligible).toBe(false);
  });
  it('retains identity-matching media and ambiguous RSS sites without personal admission', async () => {
    for (const about of ['新聞媒體 編輯團隊', 'Quill Writer']) {
      const check = await validateCandidate(
        candidate,
        options(rss(), `<title>Quill Writer</title><p>${about}</p><link rel="alternate" type="application/rss+xml" href="/feed/">`),
      );
      expect(check.feed?.entries).toBe(1);
      expect(check.eligible).toBe(false);
    }
  });
  it('admits a BlogBlog.Club-listed home without self-description, still requiring its own feed and identity', async () => {
    const listed = {
      ...candidate,
      name: null,
      source_evidence: { directoryListing: { page: 'https://blogblog.club/blogrollroll', candidateId: 9, linkedUrl: `${home}blogroll` } },
    };
    const plain = `<title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/feed/">`;
    const check = await validateCandidate(listed, options(rss(), plain));
    expect(check).toMatchObject({
      eligible: true,
      enrichedName: 'Quill Writer',
      directoryListing: 'https://blogblog.club/blogrollroll',
      reason: 'verified_homepage_and_rss_directory_listed',
    });
    expect((await validateCandidate(listed, options(rss(home, 'Other Writer'), plain))).eligible).toBe(true);
    expect((await validateCandidate(listed, options('<rss version="2.0"><channel></channel></rss>', plain))).eligible).toBe(false);
    // Only the directory itself counts: a listing claimed by another host is ordinary evidence.
    const elsewhere = { ...listed, source_evidence: { directoryListing: { page: 'https://blogblog.club.evil.test/' } } };
    expect((await validateCandidate(elsewhere, options(rss(), plain))).eligible).toBe(false);
  }, 10000);
  it('a listed home whose feed names its blog section and its own domain (wiwi.blog) is admitted; others are not', async () => {
    const listed = {
      ...candidate,
      name: null,
      source_evidence: { directoryListing: { page: 'https://blogblog.club/party', candidateId: 9, linkedUrl: home } },
    };
    // Name and feed title are the domain itself: the homepage, the feed and the name all say quill.test.
    const plain = `<title>小林的部落格 | Quill.Test</title><link rel="alternate" type="application/rss+xml" href="/feed/">`;
    const section = rss(`${home}blog`, 'Quill.Test Blog', `${home}blog/old-post`);
    expect(await validateCandidate(listed, options(section, plain))).toMatchObject({
      eligible: true,
      reason: 'verified_homepage_and_rss_directory_listed',
      feed: { identityUrl: `${home}blog` },
    });
    // Not listed and not linked from the homepage: a section or category feed still does not stand for the home.
    const unlinked = plain.replace(/<link[^>]*>/, '');
    expect((await validateCandidate({ ...candidate, name: 'Quill.Test' }, options(section, unlinked))).reason).toBe(
      'feed_home_identity_mismatch',
    );
    // An advertised feed may have a different title, but never represent another host.
    expect((await validateCandidate(listed, options(rss('https://other.test/blog', 'Quill.Test Blog'), plain))).eligible).toBe(false);
    expect((await validateCandidate(listed, options(rss(`${home}blog`, 'Some Blog', `${home}blog/old-post`), plain))).eligible).toBe(true);
  }, 20_000);
  it('skips a stray title-less item (Hugo /archives/) but still refuses a feed that is mostly not articles', async () => {
    const item = (title: string, link: string) =>
      `<item><title>${title}</title><link>${link}</link><guid>${link}</guid><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate></item>`;
    const feedOf = (items: string[]) =>
      `<rss version="2.0"><channel><title>Quill Writer</title><link>${home}</link>${items.join('')}</channel></rss>`;
    const posts = Array.from({ length: 12 }, (_, i) => item(`Post ${i}`, `${home}posts/${i}`));
    const one = await validateCandidate(candidate, options(feedOf([...posts, item('', `${home}archives/`)])));
    expect(one).toMatchObject({ eligible: true, feed: { entries: 12 } });
    const mostlyPages = [item('Post', `${home}posts/1`), item('', `${home}a/`), item('', `${home}b/`)];
    expect((await validateCandidate(candidate, options(feedOf(mostlyPages)))).reason).toBe('empty_feed');
  }, 20_000);
  it('enriches article anchor into independently verified homepage and RSS identity', async () => {
    const check = await validateCandidate(
      { ...candidate, source_type: 'article-link', name: 'An unrelated linked article' },
      options(rss()),
    );
    expect(check.enrichedName).toBe('Quill Writer');
    expect(check.eligible).toBe(true);
  });
});

it('admits exact personal platform homes without collapsing owners or accepting articles', () => {
  for (const url of [
    'https://matters.town/@alice',
    'https://hackmd.io/@bob',
    'https://substack.com/@ann',
    'https://note.com/lin',
    'https://home.gamer.com.tw/homeindex.php?owner=annie',
  ]) {
    expect(candidatePreflight({ ...candidate, url })).toBeNull();
  }
  for (const url of [
    'https://note.com/lin/n/abc',
    'https://matters.town/@alice/post',
    'https://home.gamer.com.tw/creation.php?owner=annie',
    'https://home.gamer.com.tw/homeindex.php?owner=annie&x=1',
  ]) {
    expect(candidatePreflight({ ...candidate, url })).toBe('needs_publication_home');
  }
  expect(candidatePreflight({ ...candidate, url: 'https://reurl.cc/xyz' })).toBe('shortener-unresolved');
  expect(
    publicationContains('https://home.gamer.com.tw/creation.php?owner=bob', 'https://home.gamer.com.tw/homeindex.php?owner=alice'),
  ).toBe(false);
});

describe('a Hugo Blowfish profile home (april-aries.github.io)', () => {
  const site = 'https://aries.test/';
  const empty = `<rss version="2.0"><channel><title>Aries Blog</title><link>${site}</link></channel></rss>`;
  const posts = `<rss version="2.0"><channel><title>Blog Posts on Aries Blog</title><link>${site}posts/</link><item><title>CTF notes</title><link>${site}posts/ctf/</link><guid>${site}posts/ctf/</guid><pubDate>Mon, 26 Jan 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  // The head advertises the empty home feed; the real feed is only an RSS button; the bio is a title, not first person.
  const profile = `<html><head><title>Aries Blog</title><link rel="alternate" type="application/rss+xml" href="/index.xml"></head><body><nav><a href="/about/">About</a><a href="/posts/">Posts</a><a href="${site}posts/index.xml">RSS</a></nav><article><h1>Aries</h1><h2>A master student, passionate educator and future hacker</h2></article></body></html>`;
  const about = (intro: string) =>
    `<html><head><title>About Me · Aries Blog</title></head><body><article><header><h1>About Me</h1><p>Currently a master student</p></header><div class="article-content"><p>${intro}</p><h2>學歷</h2><p>我在某某公司實習，我們團隊很好</p></div></article></body></html>`;
  const firstPerson = '歡迎來到這個小世界，我是 Aries，因為我是四月生的牡羊。這個網站會放上一些個人生活紀錄，歡迎對我有興趣的人來看看。';
  const siteOptions = (routes: Record<string, string>) => ({
    delayMs: 250,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      const body = routes[u];
      if (body === undefined) return new Response(null, { status: 404 });
      return new Response(body, { headers: { 'content-type': body.startsWith('<html') ? 'text/html' : 'application/rss+xml' } });
    }),
  });
  const suggested: DiscoveryCandidate = { id: 7, url: site, name: null, status: 'candidate', source_type: 'reader-suggestion' };
  const routes = { [site]: profile, [`${site}index.xml`]: empty, [`${site}posts/index.xml`]: posts };

  it('skips the empty home feed for the linked section feed and proves the owner on the about page', async () => {
    const check = await validateCandidate(suggested, siteOptions({ ...routes, [`${site}about/`]: about(firstPerson) }));
    expect(check).toMatchObject({
      eligible: true,
      reason: 'verified_homepage_and_rss',
      feed: { url: `${site}posts/index.xml`, identityUrl: `${site}posts/`, entries: 1 },
      personalEvidence: { method: 'deterministic', personal: true, reason: 'about_page_first_person_introduction', page: `${site}about/` },
    });
    // The snippet is the opening introduction only, never the résumé after the first heading.
    expect(check.personalEvidence?.identitySnippet).toContain('我是 Aries');
    expect(check.personalEvidence?.identitySnippet).not.toContain('實習');
    expect(check.verification?.evidence.sourceChecks.map((c) => [c.url, c.reason, c.advertised])).toEqual([
      [`${site}index.xml`, 'empty_feed', true],
      [`${site}posts/index.xml`, 'valid_xml_source', true],
    ]);
  }, 20_000);

  it('still refuses an about page without a first-person owner, and one written as 我們', async () => {
    for (const intro of ['A blog about security and teaching, updated sometimes.', '我們是三個人，我和我的朋友一起寫我喜歡的東西。']) {
      const check = await validateCandidate(suggested, siteOptions({ ...routes, [`${site}about/`]: about(intro) }));
      expect(check.feed?.url).toBe(`${site}posts/index.xml`);
      expect(check.eligible).toBe(false);
      expect(check.personalEvidence?.page).toBeUndefined();
    }
  }, 20_000);

  it('does not read the about page before a feed is found', async () => {
    const opts = siteOptions({ [site]: profile, [`${site}index.xml`]: empty, [`${site}about/`]: about(firstPerson) });
    const check = await validateCandidate(suggested, opts);
    expect(check.reason).toBe('empty_feed');
    expect(opts.fetcher.mock.calls.some(([u]) => String(u) === `${site}about/`)).toBe(false);
  }, 20_000);
});

describe('aboutPageUrl', () => {
  it('finds the same-publication about link by path or label, never another site', () => {
    expect(aboutPageUrl('<a href="/about/">x</a>', 'https://a.test/')).toBe('https://a.test/about/');
    expect(aboutPageUrl('<a href="/%E9%97%9C%E6%96%BC%E6%88%91/">x</a>', 'https://a.test/')).toBe(
      'https://a.test/%E9%97%9C%E6%96%BC%E6%88%91/',
    );
    expect(aboutPageUrl('<a href="/me">關於我</a>', 'https://a.test/')).toBe('https://a.test/me');
    expect(aboutPageUrl('<a href="https://b.test/about/">About</a>', 'https://a.test/')).toBeNull();
    expect(aboutPageUrl('<a href="https://medium.com/@two/about">About</a>', 'https://medium.com/@one')).toBeNull();
    expect(aboutPageUrl('<a href="/about/?ref=nav">About</a><a href="/posts/">Posts</a>', 'https://a.test/')).toBeNull();
  });
});
