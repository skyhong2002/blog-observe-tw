import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { compactHtml } from './compact-html.ts';
import { generatedScraper, lintScraperCode, listedPage, parsedPost } from './contract.ts';
import { generateScraper } from './generate.ts';
import { renderAvailable, renderVetted } from './render.ts';
import { scrapeBlog } from './run.ts';

const available = existsSync(process.env.BLOG_SCRAPER_BWRAP || '/usr/bin/bwrap');
const home = 'https://quill.test/';
const posts = [
  { path: '2026/10/autumn', title: 'Autumn walk', date: '2026-10-01', tags: ['walks', 'autumn'] },
  { path: '2026/09/tea', title: 'Green tea notes', date: '2026-09-12', tags: ['tea'] },
  { path: '2026/08/bikes', title: 'Fixing old bikes', date: '2026-08-03', tags: [] },
];
const prose = (title: string) => `<p>${`${title} is what this long paragraph is about, written by hand. `.repeat(8)}</p>`;
const homepage = `<html><head><title>Quill Writer</title></head><body><nav><a href="/about/">About</a></nav><main>${posts
  .map((p) => `<div class="card"><h2><a href="/${p.path}/">${p.title}</a></h2><span class="d">${p.date}</span></div>`)
  .join('')}</main></body></html>`;
const article = (p: (typeof posts)[number]) =>
  `<html><head><title>${p.title} | Quill Writer</title></head><body><nav>menu</nav><div class="post"><h1>${p.title}</h1><span class="d">${p.date}</span><div class="text">${prose(p.title)}</div>${p.tags
    .map((t) => `<a class="tag">${t}</a>`)
    .join('')}</div><footer>© Quill</footer></body></html>`;
const site = () => ({
  delayMs: 250,
  resolveHost: async () => ['93.184.216.34'],
  fetcher: vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    const html =
      url === home ? homepage : posts.find((p) => url === `${home}${p.path}/`) && article(posts.find((p) => url === `${home}${p.path}/`)!);
    return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response(null, { status: 404 });
  }),
});
const GOOD = `function listPosts({ url, $ }) {
  return { posts: $('.card').map((i, el) => ({ url: new URL($(el).find('a').attr('href'), url).href, title: $(el).find('a').text(), publishedAt: $(el).find('.d').text() })).get(), next: null };
}
function parsePost({ $ }) {
  return { title: $('h1').text(), author: 'Quill', publishedAt: $('.post .d').text(), tags: $('.tag').map((i, t) => $(t).text()).get(), bodyHtml: $('.text').html() };
}`;
const EMPTY_LIST = GOOD.replace("$('.card')", "$('.nothing')");
const HARDCODED = GOOD.replace("title: $('h1').text()", "title: 'My blog post'");
const reply = (code: string, flags: { noArticles?: boolean; needsRender?: boolean } = {}) => ({
  result: { listUrls: [home], maxPages: 1, code, notes: 'cards on the home', noArticles: false, needsRender: false, ...flags },
  actualModel: 'test-model',
});

describe('generated scraper contract', () => {
  it('lints out code that reaches past the page', () => {
    expect(lintScraperCode(GOOD)).toBeNull();
    expect(lintScraperCode(`${GOOD}\nconst fs = require('fs');`)).toBe('code_forbidden_identifier:require');
    expect(lintScraperCode(`${GOOD}\n$.constructor`)).toBe('code_forbidden_identifier:constructor');
    expect(lintScraperCode('function listPosts() {}')).toBe('code_missing_parsePost');
  });
  it('keeps only same-publication article URLs and sane fields', () => {
    const page = listedPage(
      {
        posts: [
          { url: '/a/', title: '  A  ', publishedAt: '2026-01-02' },
          { url: 'https://quill.test/a/#top' },
          { url: 'https://evil.test/x' },
          { url: home },
          { url: 'javascript:alert(1)' },
          { url: '/b/', publishedAt: '2999-01-01' },
        ],
        next: 'https://evil.test/page/2',
      },
      home,
      home,
    );
    expect(page.posts.map((p) => p.url)).toEqual(['https://quill.test/a/', 'https://quill.test/b/']);
    expect(page.posts[0]).toMatchObject({ title: 'A', publishedAt: new Date('2026-01-02') });
    expect(page.posts[1].publishedAt).toBeNull();
    expect(page.next).toBeNull();
    expect(parsedPost({ title: 'T', bodyHtml: '<p>x</p>', tags: ['#a', 'a', '', 7] })).toMatchObject({ tags: ['a'], author: null });
    expect(parsedPost({ title: '', bodyHtml: '<p>x</p>' })).toBeNull();
    expect(generatedScraper({ listUrls: ['https://evil.test/', '/blog/'], maxPages: 9, code: 'x' }, home)).toMatchObject({
      listUrls: ['https://quill.test/blog/'],
      maxPages: 3,
    });
  });
});

describe.skipIf(!available)('scraper generation on live pages', () => {
  it('feeds validation problems back and accepts the corrected scraper', async () => {
    const gateway = vi.fn().mockResolvedValueOnce(reply(EMPTY_LIST)).mockResolvedValueOnce(reply(GOOD));
    const result = await generateScraper({ home, trigger: 'new_candidate' }, { fetchOptions: site(), renderAvailable: false, gateway });
    expect(result).toMatchObject({ ok: true, rounds: 2, actualModel: 'test-model' });
    if (!result.ok) return;
    expect(result.report.listed).toBe(3);
    expect(result.report.samples.map((s) => [s.title, s.tags])).toEqual([
      ['Autumn walk', 2],
      ['Green tea notes', 1],
      ['Fixing old bikes', 0],
    ]);
    const second = JSON.parse(gateway.mock.calls[1][0]);
    expect(second.previousAttempt.problems).toContainEqual({ stage: 'list', url: home, reason: 'no_articles_listed' });
    expect(second.untrustedPages.map((p: { role: string }) => p.role)).toEqual(['home', 'article']);
  }, 30000);
  it('rejects a title that is not on the page and stops at the round limit', async () => {
    const gateway = vi.fn().mockResolvedValue(reply(HARDCODED));
    const result = await generateScraper(
      { home, trigger: 'feed_dead' },
      { fetchOptions: site(), renderAvailable: false, gateway, maxRounds: 2 },
    );
    expect(result).toMatchObject({ ok: false, rounds: 2, reason: 'validation_failed:title_not_on_page' });
    expect(result.report?.problems.map((p) => p.reason)).toContain('title_repeats_other_article');
  }, 30000);
  it('calls the model only within the daily budget', async () => {
    const gateway = vi.fn();
    const result = await generateScraper(
      { home, trigger: 'new_candidate' },
      { fetchOptions: site(), renderAvailable: false, gateway, reserveRound: async () => false },
    );
    expect(result).toMatchObject({ ok: false, reason: 'daily_budget_exhausted', rounds: 0 });
    expect(gateway).not.toHaveBeenCalled();
  });
  it('crawls only unknown articles into feed entries with tags, author and body', async () => {
    const scraper = { id: 1, blogId: 7, code: GOOD, listUrls: [home], maxPages: 1, render: false, consecutiveFailures: 0 };
    const known = vi.fn(async () => new Set([`${home}${posts[0].path}/`]));
    const result = await scrapeBlog(scraper, { id: 7, slug: 'quill', url: home }, known, site());
    expect(result).toMatchObject({ listed: 3, error: null });
    expect(result.entries.map((e) => e.url)).toEqual([`${home}${posts[1].path}/`, `${home}${posts[2].path}/`]);
    expect(result.entries[0]).toMatchObject({
      title: 'Green tea notes',
      author: 'Quill',
      categories: ['tea'],
      publishedAt: new Date('2026-09-12'),
      content: { kind: 'article-html', completeness: 'full' },
    });
    expect(result.entries[0].content?.html).toContain('<article class="generated-scraper-body">');
    expect(result.entries[0].summary).toMatch(/^Green tea notes is what/);
  }, 30000);
  it('dates an undated site by its first fetch instead of refusing it', async () => {
    const undated = GOOD.replace(", publishedAt: $(el).find('.d').text()", '').replace(
      "publishedAt: $('.post .d').text()",
      'publishedAt: null',
    );
    const generated = await generateScraper(
      { home, trigger: 'new_candidate' },
      { fetchOptions: site(), renderAvailable: false, gateway: vi.fn().mockResolvedValue(reply(undated)) },
    );
    expect(generated).toMatchObject({ ok: true, rounds: 1 });
    expect(generated.report?.samples.every((s) => s.publishedAt === null)).toBe(true);
    const now = new Date('2026-10-17T09:00:00Z');
    const scraper = { id: 1, blogId: 7, code: undated, listUrls: [home], maxPages: 1, render: false, consecutiveFailures: 0 };
    const result = await scrapeBlog(scraper, { id: 7, slug: 'quill', url: home }, async () => new Set(), site(), now);
    expect(result.entries.map((e) => e.publishedAt)).toEqual([now, now, now]);
  }, 30000);
  it('reports a scraper that no longer lists anything', async () => {
    const scraper = { id: 1, blogId: 7, code: EMPTY_LIST, listUrls: [home], maxPages: 1, render: false, consecutiveFailures: 0 };
    const result = await scrapeBlog(scraper, { id: 7, slug: 'quill', url: home }, async () => new Set(), site());
    expect(result).toEqual({ entries: [], listed: 0, error: 'no_articles_listed' });
  }, 30000);
  it('stops at once when the model and validation agree the blog has no articles yet', async () => {
    const gateway = vi.fn().mockResolvedValue(reply(EMPTY_LIST, { noArticles: true }));
    const result = await generateScraper({ home, trigger: 'new_candidate' }, { fetchOptions: site(), renderAvailable: false, gateway });
    expect(result).toMatchObject({ ok: false, rounds: 1, reason: 'site_has_no_articles' });
  }, 30000);
  it('reads a script-only home through the browser from the first round', async () => {
    const shell = '<html><head><title>Quill Writer</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>';
    const fetchOptions = site();
    const raw = fetchOptions.fetcher.getMockImplementation()!;
    fetchOptions.fetcher.mockImplementation(async (input) =>
      String(input) === home ? new Response(shell, { headers: { 'content-type': 'text/html' } }) : raw(input),
    );
    // The stand-in browser returns the page as its scripts would leave it.
    const render = vi.fn(async (url: string) => ({
      url,
      html: url === home ? homepage : article(posts.find((p) => url.includes(p.path))!),
    }));
    const gateway = vi.fn().mockResolvedValue(reply(GOOD));
    const result = await generateScraper({ home, trigger: 'new_candidate' }, { fetchOptions, renderAvailable: true, render, gateway });
    expect(result).toMatchObject({ ok: true, rounds: 1, scraper: { render: true } });
    expect(JSON.parse(gateway.mock.calls[0][0]).untrustedPages[0]).toMatchObject({ role: 'home', rendered: true });
  }, 30000);
  it('switches to rendered pages after raw HTML lists nothing', async () => {
    const render = vi.fn(async (url: string) => ({
      url,
      html: url === home ? homepage : article(posts.find((p) => url.includes(p.path))!),
    }));
    // The raw home reads as a normal page (plenty of text), so round one is raw and lists nothing.
    const fetchOptions = site();
    const raw = fetchOptions.fetcher.getMockImplementation()!;
    const wordy = homepage.replace('<main>', `<main><p>${'An introduction to this blog and its author. '.repeat(20)}</p>`);
    fetchOptions.fetcher.mockImplementation(async (input) =>
      String(input) === home ? new Response(wordy, { headers: { 'content-type': 'text/html' } }) : raw(input),
    );
    const gateway = vi
      .fn()
      .mockResolvedValueOnce(reply(EMPTY_LIST, { needsRender: true }))
      .mockResolvedValueOnce(reply(GOOD));
    const result = await generateScraper({ home, trigger: 'new_candidate' }, { fetchOptions, renderAvailable: true, render, gateway });
    expect(result).toMatchObject({ ok: true, rounds: 2, scraper: { render: true } });
    expect(JSON.parse(gateway.mock.calls[1][0]).previousAttempt.note).toMatch(/now rendered/);
  }, 30000);
  it('drops generic section labels from tags', () => {
    expect(parsedPost({ title: 'T', bodyHtml: '<p>x</p>', tags: ['blog', 'Uncategorized', '未分類', 'Posts', 'tea'] })?.tags).toEqual([
      'tea',
    ]);
  });
  it('keeps embedded page data as valid, pruned JSON and drops other scripts', () => {
    const data = { props: { posts: Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Post ${i}`, body: 'x'.repeat(5000) })) } };
    const html = `<html><body><script>track()</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
    const skeleton = compactHtml(html);
    expect(skeleton).not.toContain('track()');
    const shown = JSON.parse(skeleton.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)![1]);
    expect(shown.props.posts).toEqual([
      { id: 0, title: 'Post 0', body: `${'x'.repeat(80)}…` },
      { id: 1, title: 'Post 1', body: `${'x'.repeat(80)}…` },
      '…+48 more',
    ]);
  });
  it('crawls a rendering scraper through the browser', async () => {
    const render = vi.fn(async (url: string) => ({
      url,
      html: url === home ? homepage : article(posts.find((p) => url.includes(p.path))!),
    }));
    const scraper = { id: 1, blogId: 7, code: GOOD, listUrls: [home], maxPages: 1, render: true, consecutiveFailures: 0 };
    const result = await scrapeBlog(scraper, { id: 7, slug: 'quill', url: home }, async () => new Set(), { ...site(), render });
    expect(result.entries).toHaveLength(3);
    expect(render).toHaveBeenCalledTimes(4);
  }, 30000);
});

describe.skipIf(!renderAvailable())('headless browser rendering', () => {
  it('returns the DOM after the page scripts ran', async () => {
    const page = await renderVetted('data:text/html,<title>t</title><div id="a"></div><script>a.textContent="from script"</script>');
    expect(page.html).toContain('<div id="a">from script</div>');
  }, 60000);
});
