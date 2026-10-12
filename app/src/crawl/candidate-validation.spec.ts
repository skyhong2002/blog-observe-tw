import { describe, expect, it, vi } from 'vitest';
import { candidatePreflight, type DiscoveryCandidate, publicationContains, validateCandidate } from './candidate-validation.ts';

const home = 'https://quill.test/',
  feed = home + 'feed/';
const candidate: DiscoveryCandidate = { id: 1, url: home, name: 'Quill Writer', status: 'candidate', source_type: 'blogblog-club' };
const homepage = '<title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/feed/">';
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
    expect(candidatePreflight({ ...candidate, status: 'rejected' })).toBe('decision_already_exists');
    expect(candidatePreflight({ ...candidate, url: 'http://127.0.0.1/' })).toBe('unsafe_or_invalid_url');
    expect(candidatePreflight({ ...candidate, url: 'https://m.facebook.com/' })).toBe('not_a_blog_publication');
  });
  it('validates matching home, RSS name and old short articles without stale or length thresholds', async () => {
    const result = await validateCandidate(candidate, options(rss()));
    expect(result.eligible).toBe(true);
    expect(result.feed).toMatchObject({ entries: 1, identityUrl: home, type: 'rss' });
  });
  it('does not auto-approve sitemap-only publications', async () => {
    const result = await validateCandidate(candidate, options('<urlset><url><loc>https://quill.test/post</loc></url></urlset>'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_verified_feed_or_sitemap');
  });
  it('does not accept a shared name fragment as full publication identity', async () => {
    const result = await validateCandidate(
      candidate,
      options(rss(home, 'Another Writer'), homepage.replace('Quill Writer', 'Another Writer')),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('feed_name_identity_mismatch');
  });
  it('skips an advertised comments feed even when it appears before the main RSS', async () => {
    const opts = options(
      rss(),
      '<title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" href="/feed/">',
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
  it('requires feed home identity and matching feed name', async () => {
    expect((await validateCandidate(candidate, options(rss(home + 'category')))).reason).toBe('feed_home_identity_mismatch');
    expect((await validateCandidate(candidate, options(rss(home, 'Another publication')))).reason).toBe('feed_name_identity_mismatch');
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
  });
});
