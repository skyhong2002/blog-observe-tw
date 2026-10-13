import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSnippet, normalizeSearch, SNIPPET_MAX, searchHref, searchParamsOf, searchPath } from '../src/lib/search.ts';

const asked = { q: '咖啡', page: 2, blog: null };
/** Shape of the gateway's /api/search. */
const fixture = {
  items: [
    {
      id: 1,
      title: '手沖咖啡筆記',
      url: 'https://a.example/1',
      blogSlug: 'a',
      blogName: '甲',
      snippet: `<b>咖啡</b>&amp;豆子 ${'長'.repeat(400)}`,
      matchSource: 'body',
      body: 'PRIVATE FULL BODY',
      content: 'PRIVATE CONTENT',
    },
    { id: 2, title: '咖啡店清單', snippet: null, matchSource: 'metadata' },
    { id: 3, title: '奇怪來源', snippet: '片段', matchSource: 'rules' },
    { id: 4 },
  ],
  pagination: { page: 2, pageSize: 20, hasMore: true },
  coverage: { type: 'recent-indexed-posts', limit: 1000, scannedPosts: 1000, truncated: true },
  query: '咖啡',
  generatedAt: '2026-10-12T00:00:00Z',
  cacheSeconds: 60,
};

test('search params: trimmed query, positive page, slug-shaped blog', () => {
  assert.deepEqual(searchParamsOf({ q: '  手沖   咖啡 ', page: '3', blog: 'my-blog' }), { q: '手沖 咖啡', page: 3, blog: 'my-blog' });
  assert.deepEqual(searchParamsOf({ q: ['a', 'b'], page: '-1', blog: '../x?y' }), { q: 'a', page: 1, blog: null });
  assert.deepEqual(searchParamsOf({}), { q: '', page: 1, blog: null });
  assert.equal(searchParamsOf({ q: 'x'.repeat(500) }).q.length, 100);
});

test('paging links keep q and blog', () => {
  assert.equal(searchHref({ q: '咖啡 豆', page: 1, blog: null }), `/articles/?q=${encodeURIComponent('咖啡 豆').replace(/%20/g, '+')}`);
  assert.equal(searchHref({ q: 'a', page: 3, blog: 'b' }), '/articles/?q=a&blog=b&page=3');
  assert.equal(searchPath({ q: 'a', page: 2, blog: 'b' }), '/api/search?q=a&page=2&limit=20&blog=b');
  assert.equal(searchPath({ q: 'a', page: 1, blog: null }), '/api/search?q=a&page=1&limit=20');
});

test('normalizeSearch drops body fields, clamps snippets and keeps coverage', () => {
  const result = normalizeSearch(fixture, asked);
  assert.ok(result);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [1, 2, 3],
  );
  const [first, second, third] = result.items;
  assert.ok(!('body' in first) && !('content' in first));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(first.snippet?.startsWith('咖啡 &豆子'));
  assert.ok([...(first.snippet ?? '')].length <= SNIPPET_MAX);
  assert.equal(first.matchSource, 'body');
  assert.equal(second.matchSource, 'metadata');
  assert.equal(second.snippet, null);
  assert.equal(third.matchSource, null);
  assert.equal(result.page, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.coverage.limit, 1000);
  assert.equal(result.coverage.scannedPosts, 1000);
  assert.equal(result.coverage.truncated, true);
  // A gateway that predates the body index sends no historical coverage and no per-hit evidence: not provided, not 0.
  assert.equal(result.coverage.historicalBody, null);
  assert.deepEqual([first.articleId, first.matchVersion, first.contextSource, first.snippetNormalization], [null, null, null, null]);
});

test('normalizeSearch treats unreadable payloads as a failure, and empty items as no results', () => {
  for (const bad of [null, {}, { items: 'x' }, { error: 'search unavailable' }]) assert.equal(normalizeSearch(bad, asked), null);
  const empty = normalizeSearch({ items: [] }, { q: 'x', page: 1, blog: null });
  assert.ok(empty);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasMore, false);
  assert.equal(empty.coverage.scannedPosts, null, 'an unreported count stays unknown');
  // Nothing is assumed: no default scope of 1000, no "not truncated", no historical coverage.
  assert.equal(empty.coverage.limit, null);
  assert.equal(empty.coverage.truncated, null);
  assert.equal(empty.coverage.historicalBody, null);
});

/* The gateway's current shape (app/src/search.ts, search-body-index.ts). Synthetic rows only. */

const BODY_SNIPPET = '今晚煮了蛤蜊絲瓜，湯頭很清甜。';
const PRIVATE = { bodyBytes: 'PRIVATE_RAW_BODY', bodyTextHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), grams: ['c'.repeat(64)] };
const bodyHit = {
  id: 20875,
  guid: 'synthetic-20875',
  title: '夏天的蛤蜊絲瓜',
  url: 'https://a.example/p/20875',
  summary: '一道簡單的家常菜。',
  author: '甲',
  publishedAt: '2019-07-01T04:00:00.000Z',
  imageUrl: null,
  blogSlug: 'a',
  blogName: '甲的廚房',
  articleId: 20875,
  snippet: BODY_SNIPPET,
  matchSource: 'body',
  contextSource: 'body',
  matchVersion: 'nfkc-lower-trigram-prefix-v1',
  snippetNormalization: 'NFKC-then-lowercase',
};
const metadataHit = {
  id: 30001,
  title: '蛤蜊絲瓜食譜',
  url: 'https://b.example/p/30001',
  summary: '摘要',
  blogSlug: 'b',
  blogName: '乙',
  articleId: 30001,
  snippet: '蛤蜊絲瓜食譜',
  matchSource: 'metadata',
  contextSource: 'title',
  matchVersion: 'literal-metadata-ingestion-v2',
};
const partial = {
  status: 'partial',
  indexVersion: 'nfkc-lower-trigram-prefix-v1',
  normalization: 'NFKC-then-lowercase',
  scope: 'indexed-prefix-only',
  prefixCodepoints: 4096,
  rawBodyByteLimit: 65536,
  candidateLimit: 200,
  candidates: 200,
  candidateTruncated: true,
  staleOrIneligible: 3,
  invalidUtf8: 1,
  overcap: 2,
  prefixTruncatedCandidates: 5,
  unindexed: 'unknown',
  exhaustive: false,
};
const current = (historicalBody: unknown, items: unknown[] = [metadataHit, bodyHit]) => ({
  items,
  pagination: { page: 1, pageSize: 20, hasMore: false },
  coverage: {
    type: 'bounded-ingestion-metadata-and-partial-indexed-body',
    limit: 1000,
    scannedPosts: 1000,
    truncated: true,
    metadata: { scope: 'latest-ingested-ids', fields: ['title', 'summary', 'blog-name', 'public-tags'], exhaustive: false },
    historicalBody,
    statementTimeoutMs: 250,
    maximumStatements: 4,
  },
  query: '蛤蜊絲瓜',
  generatedAt: '2026-10-13T00:00:00.000Z',
  cacheSeconds: 0,
});
const q1 = { q: '蛤蜊絲瓜', page: 1, blog: null };

test('an indexed historical body hit keeps its id, version, snippet source and normalization', () => {
  const result = normalizeSearch(current(partial), q1);
  assert.ok(result);
  const hit = result.items.find((item) => item.articleId === 20875);
  assert.ok(hit);
  assert.equal(hit.id, 20875);
  assert.equal(hit.matchSource, 'body');
  assert.equal(hit.contextSource, 'body');
  assert.equal(hit.matchVersion, 'nfkc-lower-trigram-prefix-v1');
  assert.equal(hit.snippetNormalization, 'NFKC-then-lowercase');
  assert.equal(hit.snippet, BODY_SNIPPET);
  const meta = result.items.find((item) => item.articleId === 30001);
  assert.equal(meta?.contextSource, 'title');
  assert.equal(meta?.matchVersion, 'literal-metadata-ingestion-v2');
  assert.equal(meta?.snippetNormalization, null);
  assert.deepEqual(result.coverage.historicalBody, partial);
  assert.deepEqual(result.coverage.metadataFields, ['title', 'summary', 'blog-name', 'public-tags']);
  assert.equal(result.coverage.statementTimeoutMs, 250);
});

test('only listed, typed keys reach the view: raw body, hashes, tokens and unknown extras are dropped', () => {
  const dirty = {
    ...bodyHit,
    ...PRIVATE,
    body: 'PRIVATE_BODY',
    content: 'PRIVATE_CONTENT',
    sourceUrl: 'https://a.example/private-source',
    articleUrl: 'https://a.example/private-article',
    blogUrl: 'https://a.example/',
    token: 'PRIVATE_TOKEN',
    __proto__: { polluted: 'PRIVATE_PROTO' },
  };
  const result = normalizeSearch(current({ ...partial, textHash: 'PRIVATE_HASH', grams: PRIVATE.grams }, [dirty]), q1);
  assert.ok(result);
  const text = JSON.stringify(result);
  for (const secret of ['PRIVATE', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'private-source', 'private-article'])
    assert.ok(!text.includes(secret), secret);
  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    'articleId',
    'author',
    'blogName',
    'blogSlug',
    'contextSource',
    'guid',
    'id',
    'imageUrl',
    'matchSource',
    'matchVersion',
    'publishedAt',
    'snippet',
    'snippetNormalization',
    'summary',
    'title',
    'url',
  ]);
  assert.ok(!('textHash' in (result.coverage.historicalBody ?? {})));
});

test('invalid values are not provided, never coerced into zero, complete or a link', () => {
  const bad = {
    ...bodyHit,
    url: 'javascript:alert(1)',
    imageUrl: 'data:image/png;base64,AAAA',
    articleId: '20875',
    matchVersion: '<b>v1</b>',
    contextSource: 'raw-body',
    snippetNormalization: { x: 1 },
    snippet: '<script>alert(1)</script>蛤蜊',
    publishedAt: 'yesterday',
  };
  const result = normalizeSearch(
    current({ ...partial, status: 'complete', prefixCodepoints: -1, candidates: '200', candidateTruncated: 'yes', exhaustive: true }, [
      bad,
    ]),
    q1,
  );
  assert.ok(result);
  const [hit] = result.items;
  assert.equal(hit.url, null);
  assert.equal(hit.imageUrl, null);
  assert.equal(hit.articleId, null);
  assert.equal(hit.matchVersion, null);
  assert.equal(hit.contextSource, null);
  assert.equal(hit.snippetNormalization, null);
  assert.equal(hit.publishedAt, null);
  assert.ok(!hit.snippet?.includes('<'));
  const body = result.coverage.historicalBody;
  assert.ok(body);
  assert.equal(body.status, 'unrecognized');
  assert.equal(body.prefixCodepoints, null);
  assert.equal(body.candidates, null);
  assert.equal(body.candidateTruncated, null);
  assert.equal(body.exhaustive, null, 'a claimed exhaustive search is not repeated');
});

test('every historical state is kept apart: off, short query, unavailable, partial; none becomes zero', () => {
  for (const status of ['not-enabled', 'short-query', 'unavailable'] as const) {
    const result = normalizeSearch(current({ status, exhaustive: false }, []), q1);
    assert.equal(result?.coverage.historicalBody?.status, status);
    assert.equal(result?.coverage.historicalBody?.candidates, null);
    assert.equal(result?.coverage.historicalBody?.prefixCodepoints, null);
  }
  const zero = normalizeSearch(current({ ...partial, candidates: 0, candidateTruncated: false }, []), q1);
  assert.equal(zero?.coverage.historicalBody?.candidates, 0, 'a reported 0 stays 0');
  assert.equal(zero?.coverage.historicalBody?.candidateTruncated, false);
});

test('clampSnippet', () => {
  assert.equal(clampSnippet('  a\n\n b '), 'a b');
  assert.equal(clampSnippet('<p></p>'), null);
  assert.equal(clampSnippet(42), null);
  assert.equal([...(clampSnippet('字'.repeat(241)) ?? '')].length, SNIPPET_MAX);
  assert.equal(clampSnippet('字'.repeat(240)), '字'.repeat(240));
});
