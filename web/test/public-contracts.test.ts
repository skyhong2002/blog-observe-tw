import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_CONTRACTS, validPublicPayload } from '../src/lib/public-contracts.ts';
import { PUBLIC_KINDS, type PublicKind, publicKindOf } from '../src/lib/public-paths.ts';
import { EMPTY, PATHS } from './public-payloads.ts';

const clone = <T>(value: T): T => structuredClone(value);
/** EMPTY[kind] with one top-level key replaced (undefined deletes it). */
function with_(kind: PublicKind, key: string, value: unknown) {
  const payload = clone(EMPTY[kind]) as Record<string, unknown>;
  if (value === undefined) delete payload[key];
  else payload[key] = value;
  return payload;
}

test('contracts: every public path kind has one, and the fixture paths map to their kinds', () => {
  assert.deepEqual(Object.keys(PUBLIC_CONTRACTS).sort(), [...PUBLIC_KINDS].sort());
  for (const kind of PUBLIC_KINDS) assert.equal(publicKindOf(PATHS[kind]), kind, PATHS[kind]);
});

test('contracts: valid answers with no rows stay valid (empty lists, null profile, unavailable vocabulary)', () => {
  for (const kind of PUBLIC_KINDS) assert.equal(validPublicPayload(kind, EMPTY[kind]), true, kind);
  // Optional fields older gateways omit.
  assert.equal(validPublicPayload('overview', with_('overview', 'recentBlogs', undefined)), true);
  assert.equal(validPublicPayload('blogRelations', with_('blogRelations', 'evidence', undefined)), true);
  // A ready AI profile and provenance, a disabled/pending content status.
  assert.equal(
    validPublicPayload('blogInference', {
      ...(EMPTY.blogInference as object),
      profile: { bio: '寫旅行', topics: ['旅行'] },
      provenance: { coverage: 'rss-summary', modelAlias: 'm', updatedAt: '2026-10-12T00:00:00Z' },
      topics: [{ postId: 1, title: 't', topics: ['a'], coverage: 'rss-summary', updatedAt: null, label: 'AI 推定' }],
    }),
    true,
  );
  assert.equal(validPublicPayload('blogContent', { blog: { status: 'disabled', reason: null }, sources: [{ status: 'pending' }] }), true);
  assert.equal(
    validPublicPayload(
      'topics',
      with_('topics', 'items', [{ id: 'rss:1', label: '旅行', source: 'rss-category', score: 1, posts: 2, blogs: 2 }]),
    ),
    true,
  );
});

test('contracts: {}, null, arrays, text and HTML-ish answers are never a page', () => {
  for (const kind of PUBLIC_KINDS)
    for (const raw of [{}, null, undefined, [], 'ok', 0, true, { error: 'not found' }])
      assert.equal(validPublicPayload(kind, raw), false, `${kind} ${JSON.stringify(raw)}`);
});

test('contracts: each required container of the wrong type fails', () => {
  const cases: Array<[PublicKind, string, unknown]> = [
    ['overview', 'posts', null],
    ['overview', 'tags', {}],
    ['overview', 'totals', { blogs: '3', posts: 1 }],
    ['overview', 'recentBlogs', 'x'],
    ['catalog', 'blogs', [{ slug: 'a' }]],
    ['catalog', 'pagination', { page: 1, pages: 1, pageSize: 50 }],
    ['catalog', 'filters', null],
    ['authors', 'matchedAuthors', '0'],
    ['authors', 'filters', { author: '7' }],
    ['search', 'items', null],
    ['topics', 'items', [{ id: 1, label: 'x' }]],
    ['topics', 'vocabulary', null],
    ['topic', 'topic', null],
    ['topic', 'topic', { id: 'rss:1' }],
    ['topic', 'articles', undefined],
    ['relations', 'coverage', { observedPosts: 0 }],
    ['relations', 'mutual', undefined],
    ['relations', 'generatedAt', 0],
    ['traffic', 'blogs', null],
    ['tag', 'tag', null],
    ['tag', 'posts', {}],
    ['blog', 'blog', {}],
    ['blog', 'blog', { slug: 'a', name: '甲', tags: {} }],
    ['blog', 'posts', undefined],
    ['blogRelations', 'outgoing', undefined],
    ['blogRelations', 'coverage', null],
    ['blogTopics', 'items', undefined],
    ['blogInference', 'label', undefined],
    ['blogInference', 'overridden', 'false'],
    ['blogInference', 'profile', 'bio'],
    ['blogInference', 'topics', null],
    ['blogContent', 'blog', null],
    ['blogContent', 'sources', undefined],
  ];
  for (const [kind, key, value] of cases)
    assert.equal(validPublicPayload(kind, with_(kind, key, value)), false, `${kind}.${key} = ${JSON.stringify(value)}`);
});
