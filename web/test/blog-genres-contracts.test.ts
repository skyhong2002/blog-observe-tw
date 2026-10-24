import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_CONTRACTS } from '../src/lib/public-contracts.ts';

const blog = { blog: { slug: 'a', name: 'A' }, posts: [] };
const state = {
  status: 'ready',
  items: [{ genre: 'food', label: '美食', source: 'ai', visible: true, agrees: 0, disagrees: 0, adminOverride: null }],
};
test('genre public fields are optional for older gateways but validated when present', () => {
  assert.equal(PUBLIC_CONTRACTS.blog(blog), true);
  assert.equal(PUBLIC_CONTRACTS.blog({ ...blog, blog: { ...blog.blog, genreState: state } }), true);
  // A reader's own genre is a valid key; text genreKey would never store (unfolded, a list, punctuation only) is not.
  assert.equal(
    PUBLIC_CONTRACTS.blog({
      ...blog,
      blog: { ...blog.blog, genreState: { ...state, items: [{ ...state.items[0], genre: '咖啡', label: '咖啡', source: 'community' }] } },
    }),
    true,
  );
  // traffic.observe.tw's editors' tags (個人, 科技) arrive as source editor.
  assert.equal(
    PUBLIC_CONTRACTS.blog({
      ...blog,
      blog: { ...blog.blog, genreState: { ...state, items: [{ ...state.items[0], genre: '個人', label: '個人', source: 'editor' }] } },
    }),
    true,
  );
  for (const patch of [
    { genre: 'Coffee' },
    { genre: '旅遊,生活' },
    { genre: '-' },
    { label: 7 },
    { source: 'feed' },
    { agrees: -1 },
    { adminOverride: 'unknown' },
    { visible: 'true' },
  ]) {
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
test('the 編輯標籤 address is accepted only as a traffic.observe.tw site page', () => {
  const withUrl = (tagsUrl: unknown) => PUBLIC_CONTRACTS.blog({ ...blog, blog: { ...blog.blog, tagsUrl } });
  assert.equal(withUrl('https://traffic.observe.tw/site/wiwi.blog/#tags'), true);
  assert.equal(withUrl(null), true);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/site/a/#tags', 'https://traffic.observe.tw/site/a b/#tags', 7])
    assert.equal(withUrl(bad), false);
});
