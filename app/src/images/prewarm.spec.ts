import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { loadHomeImages, prewarmHomeImages, selectHomeImages } from '../../../tools/prewarm-images.ts';
import type { ImageResult } from './service.ts';

describe('homepage-only image prewarming', () => {
  it('selects exactly author8/post7/recent10 before deduplicating; never backfills invisible/no-image posts', () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      slug: `post-${i}`,
      status: i === 0 ? 'seed' : 'verified',
      image_url: i === 1 ? null : 'https://source.example/p.png',
    }));
    const authors = Array.from({ length: 20 }, (_, i) => ({ slug: i === 0 ? 'post-0' : `author-${i}` }));
    const recent = Array.from({ length: 20 }, (_, i) => ({ slug: i === 0 ? 'author-1' : `recent-${i}` }));
    const selected = selectHomeImages(posts, authors, recent);
    expect(selected.posts).toEqual([3, 4, 5, 6, 7]);
    expect(selected.icons).toHaveLength(23);
    expect(selected.icons).toContain('post-0');
    expect(selected.icons).toContain('post-1');
    expect(selected.icons).not.toContain('post-7');
    expect(selected.icons).not.toContain('author-8');
    expect(selected.icons).not.toContain('recent-10');
    expect(new Set(selected.icons).size).toBe(selected.icons.length);
    expect(
      selectHomeImages(
        posts,
        Array.from({ length: 8 }, (_, i) => ({ slug: `a${i}` })),
        recent.map((_, i) => ({ slug: `b${i}` })),
      ).icons,
    ).toHaveLength(25);
  });
  it('uses three bounded read-only queries matching homepage order and filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 1, slug: 'one', status: 'verified', image_url: 'https://source.example/' }]])
      .mockResolvedValueOnce([[{ slug: 'author' }]])
      .mockResolvedValueOnce([[{ slug: 'recent' }]]);
    const selection = await loadHomeImages({ query } as unknown as Pool);
    expect(selection).toEqual({ posts: [1], icons: ['author', 'one', 'recent'] });
    expect(query).toHaveBeenCalledTimes(3);
    const sql = query.mock.calls.map((c) => c[0]);
    expect(sql.every((s) => s.startsWith('SELECT '))).toBe(true);
    expect(sql[0]).toMatch(/ORDER BY p.published_at DESC,p.id DESC LIMIT 7/);
    expect(sql[1]).toMatch(/ORDER BY a.display_name,b.slug LIMIT 8/);
    expect(sql[2]).toMatch(/ORDER BY latest.published_at DESC,latest.id DESC,b.id LIMIT 10/);
  });
  it('runs post sources first then local-only icons serially, counts complete sources and individual variants', async () => {
    const calls: string[] = [];
    let active = 0;
    const run = async (label: string, ok: boolean): Promise<ImageResult> => {
      active++;
      expect(active).toBe(1);
      calls.push(label);
      await Promise.resolve();
      active--;
      return ok ? { body: Buffer.from('webp'), etag: 'x' } : { error: 404 };
    };
    const counts = await prewarmHomeImages(
      { posts: [1, 2], icons: ['one', 'missing', 'one'] },
      {
        post: async (id, w) => run(`post:${id}:${w}`, id === 1 || w === 160),
        icon: async (slug, w) => run(`icon:${slug}:${w}`, slug === 'one'),
      },
    );
    expect(calls.slice(0, 8).every((x) => x.startsWith('post:'))).toBe(true);
    expect(calls.slice(8).every((x) => x.startsWith('icon:'))).toBe(true);
    expect(calls).toHaveLength(16);
    expect(counts).toEqual({
      posts: { sources: 2, success: 1, failed: 1, variants: { success: 5, failed: 3 } },
      icons: { sources: 2, success: 1, failed: 1, variants: { success: 4, failed: 4 } },
    });
    expect(JSON.stringify(counts)).not.toContain('http');
  });
});
