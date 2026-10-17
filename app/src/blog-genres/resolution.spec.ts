import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateGenreSeed } from '../../../tools/lib/genre-seed.ts';
import { resolveGenre } from './resolve.ts';
import { loadBlogGenres, readBlogGenres } from './store.ts';

const input = { genre: 'food' as const, ai: true, admin: null, agrees: 0, disagrees: 0 };
describe('resolved blog genres', () => {
  it('retains AI ties and hides only when disagreements outnumber agreements', () => {
    expect(resolveGenre(input).visible).toBe(true);
    expect(resolveGenre({ ...input, agrees: 2, disagrees: 2 }).visible).toBe(true);
    expect(resolveGenre({ ...input, agrees: 2, disagrees: 3 }).visible).toBe(true);
    expect(resolveGenre({ ...input, disagrees: 1 }).visible).toBe(true);
    expect(resolveGenre({ ...input, agrees: 2, disagrees: 4 }).visible).toBe(false);
  });
  it('requires two net community agreements, and votes remain effective after releasing overrides', () => {
    expect(resolveGenre({ ...input, ai: false, agrees: 2, disagrees: 1 }).visible).toBe(false);
    expect(resolveGenre({ ...input, ai: false, agrees: 3, disagrees: 1 })).toMatchObject({ visible: true, source: 'community' });
    expect(resolveGenre({ ...input, admin: 'set', disagrees: 20 })).toMatchObject({ visible: true, source: 'admin', disagrees: 20 });
    expect(resolveGenre({ ...input, admin: 'hide', agrees: 20 }).visible).toBe(false);
    expect(resolveGenre({ ...input, admin: null, disagrees: 20 }).visible).toBe(false);
  });
  it('reports a failed DB read as unavailable instead of an empty successful classification', async () => {
    let failures = 0;
    const result = await readBlogGenres(
      {
        query: async () => {
          throw Error('missing migration');
        },
      } as never,
      ['a'],
      () => {
        failures++;
      },
    );
    expect(result.status).toBe('unavailable');
    expect(result.blogs.size).toBe(0);
    expect(failures).toBe(1);
  });
  it('bounds one read to requested verified slugs and resolves only known genres', async () => {
    const calls: { sql: string; args: unknown }[] = [];
    const pool = {
      query: async (sql: string, args: unknown) => {
        calls.push({ sql, args });
        return [
          [
            { slug: 'a', genre: 'food', ai: 1, adminHide: 1, agrees: 20, disagrees: 0 },
            { slug: 'a', genre: 'unknown', ai: 1 },
          ],
        ];
      },
    };
    const result = await loadBlogGenres(pool as never, ['a', 'a', 'b']);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('SET STATEMENT max_statement_time=1 FOR');
    expect(calls[0].sql).toContain("b.status='verified'");
    expect(calls[0].args).toEqual([['a', 'b']]);
    expect(result.get('a')?.items).toEqual([
      { genre: 'food', source: 'admin', visible: false, agrees: 20, disagrees: 0, adminOverride: 'hide' },
    ]);
    expect(result.get('b')).toEqual({ status: 'ready', items: [] });
    await expect(
      loadBlogGenres(
        pool as never,
        Array.from({ length: 201 }, (_, i) => String(i)),
      ),
    ).rejects.toThrow('genre-read-bound');
    expect(calls).toHaveLength(1);
  });
  it('validates complete, unique AI labels and rejects malformed seeds', async () => {
    const seed = validateGenreSeed(JSON.parse(await readFile(new URL('../../../data/blog-genre-seed.json', import.meta.url), 'utf8')));
    expect(seed.entries).toHaveLength(455);
    expect(seed.entries.find((b) => b.slug === 'saydigi')?.genres.map((g) => g.genre)).toContain('gadgets');
    expect(() => validateGenreSeed({ ...seed, entries: [seed.entries[0], seed.entries[0]], totalBlogs: 2 })).toThrow();
    expect(() => validateGenreSeed({ ...seed, entries: [{ ...seed.entries[0], genres: [] }], totalBlogs: 1 })).toThrow();
  });
});
