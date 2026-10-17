import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Post } from '../src/lib/api.ts';
import { articleFiltersHref, articleFiltersOf, filterLatestPosts, NO_ARTICLE_FILTERS } from '../src/lib/article-filters.ts';

const post = (id: number, patch: Partial<Post> = {}): Post => ({ id, title: `post ${id}`, blogSlug: 'a', ...patch });

test('filter URL validates caps and genres, deduplicates repeated values and roundtrips', () => {
  const filters = articleFiltersOf(new URLSearchParams('maxPerBlog=2&exclude=food&exclude=food&exclude=gadgets&exclude=unknown'));
  assert.deepEqual(filters, { maxPerBlog: 2, exclude: ['food', 'gadgets'] });
  assert.deepEqual(articleFiltersOf(new URL(articleFiltersHref(filters), 'https://example.com').searchParams), filters);
  for (const max of ['-1', '999', '2junk', '2.5', '', 'Infinity', '01'])
    assert.equal(articleFiltersOf(new URLSearchParams({ maxPerBlog: max })).maxPerBlog, 0);
  assert.deepEqual(articleFiltersOf(new URLSearchParams('exclude=__proto__&exclude=constructor')), NO_ARTICLE_FILTERS);
  assert.equal(articleFiltersHref(NO_ARTICLE_FILTERS), '/articles/');
});

test('genre exclusion precedes per-blog cap, preserves chronological order and partitions hidden counts', () => {
  const posts = [post(1, { blogGenres: ['food', 'travel'] }), post(2, { blogSlug: 'b' }), post(3, { blogSlug: 'b' }), post(4), post(5)];
  const result = filterLatestPosts(posts, { maxPerBlog: 1, exclude: ['food', 'travel'] });
  assert.deepEqual(
    result.items.map((p) => p.id),
    [2, 4],
  );
  assert.equal(result.hiddenGenre, 1);
  assert.equal(result.hiddenCap, 2);
  assert.equal(result.unclassified, 4);
  assert.equal(posts.length, result.items.length + result.hiddenGenre + result.hiddenCap);
});

test('old gateways and unidentified sources are retained; caps still work on unclassified blogs', () => {
  const posts = [post(1), post(2, { blogGenres: [] }), post(3, { blogSlug: undefined }), post(4, { blogSlug: undefined })];
  assert.equal(filterLatestPosts(posts, { maxPerBlog: 1, exclude: ['food', 'gadgets'] }).items.length, 3);
  assert.deepEqual(filterLatestPosts(posts, NO_ARTICLE_FILTERS).items, posts);
  assert.equal(filterLatestPosts([], NO_ARTICLE_FILTERS).items.length, 0);
});

test('all excluded is an explicit empty result and mixed genres hide the entire source', () => {
  const result = filterLatestPosts([post(1, { blogGenres: ['food', 'travel'] })], { maxPerBlog: 0, exclude: ['food'] });
  assert.deepEqual(result.items, []);
  assert.equal(result.hiddenGenre, 1);
  assert.equal(result.hiddenCap, 0);
});
