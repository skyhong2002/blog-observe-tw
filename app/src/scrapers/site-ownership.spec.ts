import { describe, expect, it, vi } from 'vitest';
import { extractContent } from '../content/article-content.ts';
import { CONTENT_VERSION, type ContentRule, type ContentSql } from '../content/contracts.ts';
import { ingestContentEvidence } from '../content/store.ts';
import { boundedFeedContent, type FeedCrawlerOptions } from '../crawl/feed.ts';
import { vocusProofFromHtml } from '../crawl/vocus-publication.ts';
import { type GeneratedScraper, listedPage, scraperArticleHtml } from './contract.ts';
import { PageCache, reportPasses, validateScraper } from './generate.ts';
import { scrapeBlog } from './run.ts';
import type { SandboxRunner } from './sandbox.ts';

const articleId = '111111111111111111111111';
const salonId = '222222222222222222222222';
const userId = '333333333333333333333333';
const otherId = '444444444444444444444444';
const articleUrl = `https://vocus.cc/article/${articleId}`;
const salon = `https://vocus.cc/salon/${salonId}`;
const user = `https://vocus.cc/user/${userId}`;
const metadata = { _id: articleId, salonId, userId, salon: { _id: salonId } };
const title = '一篇真正的短文';
const bodyHtml = '<p>今天在河邊散步，看到一隻安靜的白鷺鷥。</p>';
const rule: ContentRule = {
  blogId: 7,
  platform: 'generic',
  adapterId: 'generated-scraper',
  version: CONTENT_VERSION,
  rules: {},
  revision: 1,
  source: 'inferred',
};
const code = 'function listPosts() { return {posts:[],next:null}; } function parsePost() { return null; }';
const definition = (home: string): GeneratedScraper => ({
  code,
  listUrls: [home],
  maxPages: 1,
  render: false,
  noArticles: false,
  needsRender: false,
  notes: 'test fixture',
});
const html = (body: string, proof?: unknown) =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><article>${body}</article>${
    proof === undefined
      ? ''
      : `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { parsedArticle: proof } } })}</script>`
  }</body></html>`;
function fixtures(home: string, url: string, page: string, returnedBody = bodyHtml) {
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const target = String(input);
    if (target.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    if (target === home || target === url) {
      return new Response(target === home ? '<html><body>Article listing</body></html>' : page, {
        headers: { 'content-type': 'text/html' },
      });
    }
    throw Error(`Unexpected fixture request: ${target}`);
  });
  const options: FeedCrawlerOptions = { delayMs: 250, timeoutMs: 1000, resolveHost: async () => ['93.184.216.34'], fetcher };
  const sandbox: SandboxRunner = vi.fn(async (_code, task) =>
    task === 'listPosts'
      ? { posts: [{ url, title }], next: null }
      : { title, bodyHtml: returnedBody, author: 'Fixture writer', publishedAt: '2026-01-02', tags: [] },
  );
  return { options, sandbox, fetcher };
}

describe('Vocus candidate discovery and ingestion ownership', () => {
  it('discovers article candidates without treating listing output as ownership evidence', () => {
    const listed = listedPage({ posts: [{ url: articleUrl }] }, salon, salon);
    expect(listed.posts.map((post) => post.url)).toEqual([articleUrl]);
  });

  it.each([salon, user])(
    'validates and ingests an article with matching SSR ownership: %s',
    async (home) => {
      const fixture = fixtures(home, articleUrl, html(bodyHtml, metadata));
      const report = await validateScraper(definition(home), home, new PageCache(fixture.options), fixture.sandbox);
      expect(reportPasses(report)).toBe(true);
      const result = await scrapeBlog(
        { ...definition(home), id: 1, blogId: 7, consecutiveFailures: 0 },
        { id: 7, slug: 'fixture', url: home },
        async () => new Set(),
        { ...fixture.options, sandbox: fixture.sandbox },
      );
      expect(result.error).toBeNull();
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].content).toMatchObject({
        publicationProof: { articleId, salonId, userId },
        completeness: 'full',
      });
    },
    15000,
  );

  it.each([
    { home: salon, proof: { ...metadata, salonId: otherId, salon: { _id: otherId } } },
    { home: user, proof: { ...metadata, userId: otherId } },
    { home: salon, proof: { ...metadata, _id: otherId } },
    { home: salon, proof: { _id: articleId, salonId } },
    { home: salon, proof: undefined },
  ])(
    'rejects foreign authors or insufficient trusted metadata before invoking parsePost %#',
    async ({ home, proof }) => {
      const fixture = fixtures(home, articleUrl, html(bodyHtml, proof));
      const report = await validateScraper(definition(home), home, new PageCache(fixture.options), fixture.sandbox);
      expect(reportPasses(report)).toBe(false);
      expect(report.problems).toContainEqual({ stage: 'post', url: articleUrl, reason: 'publication_owner_mismatch' });
      const result = await scrapeBlog(
        { ...definition(home), id: 1, blogId: 7, consecutiveFailures: 0 },
        { id: 7, slug: 'fixture', url: home },
        async () => new Set(),
        { ...fixture.options, sandbox: fixture.sandbox },
      );
      expect(result).toMatchObject({ entries: [], listed: 1, error: 'articles_unparsed' });
      expect(vi.mocked(fixture.sandbox).mock.calls.every((call) => call[1] === 'listPosts')).toBe(true);
    },
    15000,
  );

  it.each([
    { name: 'missing proof', proof: undefined, accepted: false },
    { name: 'wrong article', proof: { ...metadata, _id: otherId }, accepted: false },
    { name: 'wrong salon', proof: { ...metadata, salonId: otherId, salon: { _id: otherId } }, accepted: false },
    { name: 'correct proof', proof: metadata, accepted: true },
  ])('extracts an article without canonical only with $name', ({ proof, accepted }) => {
    const result = extractContent(
      {
        blogId: 7,
        blogUrl: salon,
        articleUrl,
        sourceUrl: articleUrl,
        html: html(bodyHtml, proof),
        kind: 'article-html',
      },
      rule,
    );
    expect(result.status).toBe(accepted ? 'ok' : 'blocked');
    if (!accepted) expect(result.reason).toBe('article-identity-mismatch');
  });

  it('rejects wrong user ownership without a canonical link', () => {
    const result = extractContent(
      {
        blogId: 7,
        blogUrl: user,
        articleUrl,
        sourceUrl: articleUrl,
        html: html(bodyHtml, { ...metadata, userId: otherId }),
        kind: 'article-html',
      },
      rule,
    );
    expect(result).toMatchObject({ status: 'blocked', reason: 'article-identity-mismatch' });
  });

  it('keeps exact ownership through the scraper wrapper, feed bounds, extraction, and ingestion', async () => {
    const proof = vocusProofFromHtml(html(bodyHtml, metadata), articleUrl, salon)!;
    const content = boundedFeedContent({
      html: scraperArticleHtml({ title, bodyHtml, author: null, publishedAt: null, tags: [] }, articleUrl, proof),
      publicationProof: proof,
      kind: 'article-html',
      completeness: 'full',
      sourceUrl: articleUrl,
      obtainedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(content.publicationProof).toEqual(proof);
    expect(vocusProofFromHtml(content.html, articleUrl, salon)).toEqual(proof);
    const result = extractContent(
      {
        blogId: 7,
        blogUrl: salon,
        articleUrl,
        sourceUrl: content.sourceUrl,
        html: content.html,
        kind: content.kind,
        completeness: content.completeness,
      },
      rule,
    );
    expect(result).toMatchObject({ status: 'ok', completeness: 'full', bodyText: '今天在河邊散步，看到一隻安靜的白鷺鷥。' });
    const execute = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id,url,status FROM blogs')) return [[{ id: 7, url: salon, status: 'verified' }], []];
      if (sql.startsWith('SELECT id FROM posts')) return [[{ id: 19 }], []];
      if (sql.startsWith('SELECT')) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    const db = { execute } as unknown as ContentSql;
    const evidence = {
      blogId: 7,
      blogUrl: salon,
      articleUrl,
      sourceUrl: content.sourceUrl,
      html: content.html,
      kind: content.kind,
      completeness: content.completeness,
    };
    expect(await ingestContentEvidence(db, evidence)).toMatchObject({ postId: 19, status: 'ok', changed: true });
    expect(execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO content_post_bodies'))).toBe(true);
    execute.mockClear();
    expect(await ingestContentEvidence(db, { ...evidence, html: html(bodyHtml, { ...metadata, _id: otherId }) })).toMatchObject({
      postId: null,
      status: 'outside-publication',
      changed: false,
    });
    expect(execute.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('rejects a listed article redirecting to a different article by the same owner', async () => {
    const redirectedUrl = `https://vocus.cc/article/${otherId}`;
    const fixture = fixtures(salon, articleUrl, html(bodyHtml, { ...metadata, _id: otherId }));
    fixture.fetcher.mockImplementation(async (input) => {
      const target = String(input);
      if (target.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (target === articleUrl) return new Response(null, { status: 302, headers: { location: redirectedUrl } });
      if (target === salon) return new Response('<html>Listing</html>', { headers: { 'content-type': 'text/html' } });
      if (target === redirectedUrl) {
        const response = new Response(html(bodyHtml, { ...metadata, _id: otherId }), { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: redirectedUrl });
        return response;
      }
      throw Error(`Unexpected fixture request: ${target}`);
    });
    const report = await validateScraper(definition(salon), salon, new PageCache(fixture.options), fixture.sandbox);
    expect(reportPasses(report)).toBe(false);
    const result = await scrapeBlog(
      { ...definition(salon), id: 1, blogId: 7, consecutiveFailures: 0 },
      { id: 7, slug: 'fixture', url: salon },
      async () => new Set(),
      { ...fixture.options, sandbox: fixture.sandbox },
    );
    expect(result).toMatchObject({ entries: [], error: 'articles_unparsed' });
  }, 15000);
});

describe('short article content must be grounded in the fetched page', () => {
  it.each([
    { name: 'short prose', page: bodyHtml, returned: bodyHtml, passes: true },
    {
      name: 'photo with an original relative URL',
      page: '<img src="/photo.jpg">',
      returned: '<img src="https://short-note.test/photo.jpg">',
      passes: true,
    },
    { name: 'fabricated short prose', page: bodyHtml, returned: '<p>這段故事完全沒有出現在作者的原始頁面裡。</p>', passes: false },
    { name: 'fabricated photo', page: '<img src="/photo.jpg">', returned: '<img src="/unrelated.jpg">', passes: false },
    {
      name: 'all original photos with equivalent absolute and relative URLs',
      page: '<img src="/first.jpg"><img src="/second.jpg">',
      returned: '<img src="https://short-note.test/first.jpg"><img src="/second.jpg">',
      passes: true,
    },
    {
      name: 'original photo mixed with an invented photo',
      page: '<img src="/first.jpg">',
      returned: '<img src="/first.jpg"><img src="/invented.jpg">',
      passes: false,
    },
    {
      name: 'original prose mixed with an invented photo',
      page: bodyHtml,
      returned: `${bodyHtml}<img src="/invented.jpg">`,
      passes: false,
    },
  ])(
    '$name',
    async ({ page, returned, passes }) => {
      const home = 'https://short-note.test/';
      const url = `${home}note`;
      const fixture = fixtures(home, url, html(page), returned);
      const report = await validateScraper(definition(home), home, new PageCache(fixture.options), fixture.sandbox);
      expect(reportPasses(report)).toBe(passes);
      if (passes) {
        expect(report.samples).toHaveLength(1);
        expect(report.samples[0].bodyChars).toBeLessThan(200);
      } else {
        expect(report.problems.map((problem) => problem.reason)).toContain('short_body_not_on_page');
      }
    },
    15000,
  );
});
