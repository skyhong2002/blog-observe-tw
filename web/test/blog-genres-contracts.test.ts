import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_CONTRACTS } from '../src/lib/public-contracts.ts';

const blog = { blog: { slug: 'a', name: 'A' }, posts: [] };
const state = { status: 'ready', items: [{ genre: 'food', source: 'ai', visible: true, agrees: 0, disagrees: 0, adminOverride: null }] };
test('genre public fields are optional for older gateways but validated when present', () => {
  assert.equal(PUBLIC_CONTRACTS.blog(blog), true);
  assert.equal(PUBLIC_CONTRACTS.blog({ ...blog, blog: { ...blog.blog, genreState: state } }), true);
  for (const patch of [{ genre: 'unknown' }, { source: 'feed' }, { agrees: -1 }, { adminOverride: 'unknown' }, { visible: 'true' }]) {
    assert.equal(
      PUBLIC_CONTRACTS.blog({ ...blog, blog: { ...blog.blog, genreState: { ...state, items: [{ ...state.items[0], ...patch }] } } }),
      false,
    );
  }
});
test('unavailable genre reads remain valid public responses', () => {
  assert.equal(PUBLIC_CONTRACTS.blog({ ...blog, blog: { ...blog.blog, genreState: { status: 'unavailable', items: [] } } }), true);
  const overview = { posts: [], tags: [], authors: [], blogs: [], totals: { blogs: 0, posts: 0 } };
  assert.equal(PUBLIC_CONTRACTS.overview(overview), true);
  assert.equal(PUBLIC_CONTRACTS.overview({ ...overview, genreStatus: 'unavailable' }), true);
  assert.equal(PUBLIC_CONTRACTS.overview({ ...overview, genreStatus: 'missing' }), false);
});
