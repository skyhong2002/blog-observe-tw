import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { type GenreReview, genreMap, proposeGenres } from '../../tools/lib/blog-genres.ts';
import { loadOverview } from './overview.js';
import { publicPost } from './public-post.ts';

const blog = { slug: 'fixture', name: 'A personal blog', category: '待分類' };
describe('reviewable reader genres', () => {
  it('requires identity or repeated category evidence; does not infer gadgets from broad technology', () => {
    expect(proposeGenres([blog], [{ slug: blog.slug, labels: '美食\n日記\n工作\n程式' }], '2026-10-17').entries).toEqual([]);
    expect(proposeGenres([{ ...blog, category: '科技' }], [], '2026-10-17').entries).toEqual([]);
    const review = proposeGenres([blog], [{ slug: blog.slug, labels: '台中美食\n台北美食\n食記\n自由行\n旅遊\n景點' }], '2026-10-17');
    expect(genreMap(review)).toEqual({ fixture: ['food', 'travel'] });
    expect(genreMap(proposeGenres([{ ...blog, name: '軟體工程師的程式筆記' }], [], '2026-10-17'))).toEqual({ fixture: ['programming'] });
  });
  it('keeps the applied map in sync, is deterministic and supports assignment removal', async () => {
    const review: GenreReview = JSON.parse(await readFile(new URL('../../data/blog-genre-review.json', import.meta.url), 'utf8'));
    const deployed = JSON.parse(await readFile(new URL('../../data/blog-genres.json', import.meta.url), 'utf8'));
    expect(genreMap(review)).toEqual(deployed);
    expect(JSON.stringify(genreMap(review))).toBe(JSON.stringify(genreMap({ ...review, entries: review.entries.toReversed() })));
    expect(genreMap({ ...review, entries: [] })).toEqual({});
    expect(() => genreMap({ ...review, entries: [review.entries[0], review.entries[0]] })).toThrow();
    const reserved = genreMap({ ...review, entries: [{ ...review.entries[0], slug: '__proto__' }] });
    expect(Object.hasOwn(reserved, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(reserved)).toBe(Object.prototype);
  });
  it('attaches genres to public latest posts without any additional database read', async () => {
    const statements: string[] = [];
    const pool = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('p.guid,p.title'))
          return [
            [
              { id: 1, title: 'fixture', blogSlug: 'kocpc' },
              { id: 2, title: 'unknown', blogSlug: 'unclassified-fixture' },
              { id: 3, title: 'reserved', blogSlug: '__proto__' },
            ],
          ];
        if (sql.includes('AS blogs,')) return [[{ blogs: 2, posts: 2 }]];
        return [[]];
      },
    };
    const data = await loadOverview(pool);
    expect(data.posts.map((post: Record<string, unknown>) => post.blogGenres)).toEqual([['gadgets'], [], []]);
    expect(statements).toHaveLength(7);
    expect(publicPost({ blogGenres: ['food'], private: true })).toEqual({ blogGenres: ['food'], summary: '' });
  });
});
