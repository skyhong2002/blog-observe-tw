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
  assert.deepEqual(result.coverage, { limit: 1000, scannedPosts: 1000, truncated: true });
});

test('normalizeSearch treats unreadable payloads as a failure, and empty items as no results', () => {
  for (const bad of [null, {}, { items: 'x' }, { error: 'search unavailable' }]) assert.equal(normalizeSearch(bad, asked), null);
  const empty = normalizeSearch({ items: [] }, { q: 'x', page: 1, blog: null });
  assert.ok(empty);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasMore, false);
  assert.equal(empty.coverage.scannedPosts, null, 'an unreported count stays unknown');
});

test('clampSnippet', () => {
  assert.equal(clampSnippet('  a\n\n b '), 'a b');
  assert.equal(clampSnippet('<p></p>'), null);
  assert.equal(clampSnippet(42), null);
  assert.equal([...(clampSnippet('字'.repeat(241)) ?? '')].length, SNIPPET_MAX);
  assert.equal(clampSnippet('字'.repeat(240)), '字'.repeat(240));
});
